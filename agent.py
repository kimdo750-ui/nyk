"""
LangChain ReAct 에이전트
Claude + Function Calling으로 자율적으로 도구를 선택하고 실행
"""
import logging
from typing import Optional
from langchain_anthropic import ChatAnthropic
from tools import ALL_TOOLS
from config import settings

logger = logging.getLogger(__name__)

# ─── 시스템 프롬프트 ───
SYSTEM_PROMPT = """너는 뉴욕꼬맹이 커스텀 유아복 브랜드의 재고관리 AI 에이전트다.

## 역할
- 주문 분석 및 생산 가능 여부 판단
- 재고 부족 탐지 및 발주 우선순위 결정
- 재고 차감 시뮬레이션 및 실행

## 핵심 공식
생산가능수량 = MIN(무지상품재고[컬러][사이즈], 전사지재고[제품코드])

## 우선순위
1. 무지상품 부족 (여러 SKU 동시 영향 → 최우선)
2. 전사지 부족 (단일 SKU 영향)
3. 완제품 출고 가능 여부

## 사용 가능한 도구
- get_orders: 오늘 주문 목록 조회
- get_blank_stock: 무지상품 재고 조회 (컬러·사이즈 필터 가능)
- get_transfer_stock: 전사지 재고 조회 (제품코드 필터 가능)
- calculate_production: 주문 기준 생산가능수량 계산
- get_shortage_alerts: 재고 부족 알림 조회 (긴급도 필터 가능)
- simulate_deduction: 재고 차감 시뮬레이션 (실제 차감 없음)
- execute_deduction: 실제 재고 차감 실행 (확인 필수)

## 사용 방식
사용자의 질문에 필요한 도구를 자동으로 선택해서 호출합니다.
각 도구의 결과를 종합해서 명확하고 구체적인 답변을 제공합니다.

## 제약사항
- 재고 차감은 반드시 사용자 확인 후 execute_deduction() 도구로만 실행
- simulate_deduction()으로 먼저 시뮬레이션 후 사용자 동의 필수
- 부족 재고는 경고 표시 필수
- 숫자는 항상 구체적으로 명시"""


# ─── 에이전트 싱글톤 ───
_agent_instance: Optional['InventoryAgent'] = None


def get_agent() -> 'InventoryAgent':
    """에이전트 싱글톤 인스턴스 반환"""
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = InventoryAgent()
    return _agent_instance


class InventoryAgent:
    """재고관리 AI 에이전트"""

    def __init__(self):
        """에이전트 초기화"""
        self.llm = ChatAnthropic(
            model=settings.anthropic_model,
            api_key=settings.anthropic_api_key,
            temperature=0,
        )

        # 도구 바인딩 + 시스템 프롬프트
        self.tools = ALL_TOOLS
        self.llm_with_tools = self.llm.bind_tools(
            self.tools,
            system=SYSTEM_PROMPT
        )

        logger.info("✅ AI 에이전트 초기화 완료")

    def chat(self, message: str, history: list = None) -> dict:
        """
        사용자 메시지에 대해 에이전트가 답변합니다.
        필요한 도구를 자율적으로 선택해서 호출합니다.

        Args:
            message: 사용자 메시지 (한국어)
            history: 대화 히스토리 (미사용)

        Returns:
            {
                "answer": "최종 답변",
                "tool_calls": ["호출한 도구 목록"]
            }
        """
        try:
            logger.info(f"💬 사용자 메시지: {message}")

            # 메시지 히스토리 (시스템 프롬프트 제외 - llm_with_tools에서 처리)
            messages = [
                {"role": "user", "content": message}
            ]

            tool_calls = []
            max_iterations = 5
            iteration = 0

            while iteration < max_iterations:
                iteration += 1

                # LLM 호출
                response = self.llm_with_tools.invoke(messages)

                # 응답을 dict로 변환해서 메시지에 추가
                messages.append({
                    "role": "assistant",
                    "content": response.content or ""
                })

                # 도구 호출이 있는지 확인
                if not (hasattr(response, 'tool_calls') and response.tool_calls):
                    # 도구 없음 = 최종 답변
                    final_answer = response.content
                    break

                # 도구 실행
                tool_results = []
                for tool_call in response.tool_calls:
                    tool_name = tool_call.get('name') or getattr(tool_call, 'name', '')
                    tool_input = tool_call.get('args') or getattr(tool_call, 'args', {})
                    tool_id = tool_call.get('id') or getattr(tool_call, 'id', '')

                    logger.info(f"  🔧 도구 실행: {tool_name}")

                    # 도구 찾기 및 실행
                    result = ""
                    for tool in self.tools:
                        if tool.name == tool_name:
                            result = tool.invoke(tool_input)
                            tool_calls.append(tool_name)
                            break

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": str(result)
                    })

                # 도구 결과를 하나의 메시지로 추가
                messages.append({
                    "role": "user",
                    "content": tool_results
                })

            logger.info(f"✅ 에이전트 응답: {final_answer[:100]}...")

            return {
                "answer": final_answer,
                "tool_calls": list(set(tool_calls)),
            }
        except Exception as e:
            logger.error(f"❌ 에이전트 실행 오류: {e}")
            return {
                "answer": f"죄송합니다. 오류가 발생했습니다: {str(e)}",
                "tool_calls": [],
            }
