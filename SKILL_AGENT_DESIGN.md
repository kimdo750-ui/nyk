# 🤖 SKILL: 뉴욕꼬맹이 재고관리 AI 에이전트 설계서

**목표**: Google Sheets 기반 → 독립형 AI 에이전트 콘솔로 고도화  
**패턴**: ReAct (Reasoning + Acting) + Function Calling  

---

## 1. 에이전트 사고 설계 (ReAct 패턴)

```
사용자: "오늘 주문 중 생산 못 하는 거 있어?"

[Thought]  주문 데이터와 재고 현황을 확인해야 한다.
           무지재고(컬러·사이즈)와 전사지재고(코드)를 비교해야 한다.

[Action]   get_orders()          → 오늘 주문 목록 조회
[Observe]  IT024/화이트/150 × 5개, W281/블랙/130 × 3개 ...

[Action]   get_blank_stock(color="화이트", size="150")
[Observe]  재고: 2개 (안전재고: 30개)

[Action]   get_transfer_stock(code="IT024")
[Observe]  재고: 0매

[Thought]  IT024는 전사지 재고 0 → 생산불가
           W281 블랙 130은 무지 확인 필요

[Action]   calculate_production(orders)
[Observe]  IT024/화이트/150: 생산가능 0개 (전사지 없음) 🔴
           W281/블랙/130: 생산가능 3개 🟢

[Answer]   "🔴 IT024 화이트 150 — 전사지 재고 없음 (즉시 발주 필요)"
```

---

## 2. Function Calling 설계

### 📌 Tool 1: `get_orders`
```python
def get_orders(date: str = "today", status: str = "parsed") -> list[Order]:
    """
    주문확인(원본) 시트에서 주문 데이터를 조회합니다.
    
    Args:
        date: 조회 날짜 ("today", "YYYY-MM-DD")
        status: 파싱 상태 ("all", "parsed", "deducted")
    
    Returns:
        주문 목록 [{ code, color, size, qty, channel, status }]
    
    Example:
        get_orders() → [{ code:"IT024", color:"화이트", size:"150", qty:5 }]
    """
```

### 📌 Tool 2: `get_blank_stock`
```python
def get_blank_stock(color: str = None, size: str = None) -> list[BlankStock]:
    """
    무지상품재고를 조회합니다. 컬러·사이즈 필터 가능.
    
    Args:
        color: 컬러 필터 (None이면 전체)
        size:  사이즈 필터 (None이면 전체)
    
    Returns:
        [{ garment, color, size, stock, safe_stock, status }]
    """
```

### 📌 Tool 3: `get_transfer_stock`
```python
def get_transfer_stock(code: str = None) -> list[TransferStock]:
    """
    전사지재고를 조회합니다.
    
    Args:
        code: 전사지코드 (W281, IT024 등. None이면 전체)
    
    Returns:
        [{ code, name, stock, safe_stock, status }]
    """
```

### 📌 Tool 4: `calculate_production`
```python
def calculate_production(orders: list[Order]) -> list[ProductionResult]:
    """
    주문 목록 기준으로 생산가능수량을 계산합니다.
    생산가능수량 = MIN(무지재고[컬러][사이즈], 전사지재고[코드])
    
    Returns:
        [{
            code, color, size,
            order_qty,       # 주문 수량
            blank_stock,     # 무지 재고
            transfer_stock,  # 전사지 재고
            can_produce,     # MIN(무지, 전사지)
            bottleneck,      # "무지부족" | "전사지부족" | "가능"
            status           # "🔴생산불가" | "🟠긴급" | "🟢가능"
        }]
    """
```

### 📌 Tool 5: `deduct_inventory`
```python
def deduct_inventory(items: list[DeductItem], confirmed: bool) -> DeductResult:
    """
    재고를 차감합니다. confirmed=True일 때만 실제 차감 실행.
    
    Args:
        items:     차감할 항목 목록
        confirmed: True=실제 차감, False=시뮬레이션만
    
    Returns:
        {
            blank_results:    [{ color, size, before, after, diff }],
            transfer_results: [{ code, before, after, diff }],
            finished_results: [{ sku, color, size, status }]
        }
    
    Safety: confirmed=False로 먼저 시뮬레이션 후 사용자 확인 필수
    """
```

### 📌 Tool 6: `get_shortage_alerts`
```python
def get_shortage_alerts(threshold: str = "urgent") -> list[Alert]:
    """
    재고 부족 알림을 반환합니다.
    
    Args:
        threshold: "critical"(=0) | "urgent"(≤10) | "warning"(≤안전재고)
    
    Returns:
        [{
            type,        # "blank" | "transfer"
            item,        # 품목명
            stock,       # 현재 재고
            safe_stock,  # 안전 재고
            affected_skus # 영향받는 완제품 목록
        }]
    """
```

---

## 3. 워크플로우 설계 (LangGraph 스타일)

```
                    [START]
                       ↓
              [주문서 파싱 노드]
          parseOrders() → 제품코드·컬러·사이즈
                       ↓
         [재고 조회 병렬 노드] ←── 병렬 실행
        ┌──────┬──────┬──────┐
    무지조회  전사지조회  완제품조회
        └──────┴──────┴──────┘
                       ↓
         [생산가능 계산 노드]
     MIN(무지, 전사지) → 병목 탐지
                       ↓
          [상태 판단 분기]
        ┌────────┬────────┐
    생산가능    부족·불가
        ↓           ↓
    [차감 확인]  [알림 생성]
    사용자 확인      ↓
        ↓      [발주 추천]
    [차감 실행]
        ↓
      [END: 결과 리포트]
```

---

## 4. 콘솔 구현 로드맵

### Phase 1: 현재 (완료) ✅
```
구글시트 + Apps Script + Vercel 모바일 앱
- 재고 입력/동기화
- 주문서 파싱
- 재고 차감 확인
- AI 채팅 분석
```

### Phase 2: 에이전트 API 서버 (다음 단계)
```
기술 스택: Python + FastAPI + LangChain
├── API 서버 (FastAPI)
│   ├── POST /api/orders/parse     ← 주문서 파싱
│   ├── GET  /api/inventory        ← 재고 조회
│   ├── POST /api/inventory/deduct ← 재고 차감
│   └── POST /api/ai/analyze       ← AI 분석
│
├── 에이전트 (LangChain ReAct)
│   ├── Tools: 위 6개 Function
│   ├── Memory: 대화 히스토리
│   └── Prompt: ReAct 템플릿
│
└── 데이터 레이어
    ├── Google Sheets API (현재)
    └── → PostgreSQL (향후 마이그레이션)
```

### Phase 3: 멀티 에이전트 (고도화)
```
CrewAI 기반 멀티 에이전트:

[주문 파서 에이전트]   → 주문서 해석·분류
[재고 분석 에이전트]   → 생산가능·부족 분석
[발주 추천 에이전트]   → 우선순위·수량 결정
[리포트 에이전트]      → 일일 리포트 생성
```

---

## 5. 프롬프트 템플릿 (ReAct)

```python
SYSTEM_PROMPT = """
너는 뉴욕꼬맹이 커스텀 유아복 브랜드의 재고관리 AI 에이전트다.

## 역할
- 주문 분석 및 생산 가능 여부 판단
- 재고 부족 탐지 및 발주 우선순위 결정
- 재고 차감 시뮬레이션 및 실행

## 핵심 공식
생산가능수량 = MIN(무지상품재고[컬러][사이즈], 전사지재고[코드])

## 우선순위
1. 무지상품 부족 (여러 SKU 동시 영향 → 최우선)
2. 전사지 부족 (단일 SKU 영향)
3. 완제품 출고 가능 여부

## ReAct 형식
Thought: [현재 상황 분석]
Action: [호출할 함수명]
Action Input: [파라미터]
Observation: [함수 결과]
... (반복)
Answer: [최종 답변 - 한국어, 구체적 수치 포함]

## 제약사항
- 재고 차감은 반드시 사용자 확인 후 실행
- 부족 재고 차감 시 경고 표시
- 숫자는 항상 구체적으로 명시
"""
```

---

## 6. 최적화 체크리스트

### 프롬프트 튜닝
- [ ] 제품코드 패턴 정규식 고도화 (엣지케이스 추가)
- [ ] 컬러명 동의어 처리 (sky=스카이블루, navy=네이비)
- [ ] 사이즈 정규화 (FREE, free, 프리 → FREE)

### 성능 최적화
- [ ] 구글시트 일괄 읽기 (Range 최소화)
- [ ] 재고 데이터 캐싱 (5분 TTL)
- [ ] 비동기 병렬 조회

### 모니터링
- [ ] 차감 이력 로그 시트 추가
- [ ] 일별 재고 스냅샷 자동 저장
- [ ] 파싱 실패율 추적

---

## 7. 콘솔 빌드 시작점

```python
# main.py
from langchain.agents import create_react_agent
from langchain_anthropic import ChatAnthropic
from tools import (
    get_orders, get_blank_stock, get_transfer_stock,
    calculate_production, deduct_inventory, get_shortage_alerts
)

llm = ChatAnthropic(model="claude-sonnet-4-20250514")
tools = [get_orders, get_blank_stock, get_transfer_stock,
         calculate_production, deduct_inventory, get_shortage_alerts]

agent = create_react_agent(llm, tools, SYSTEM_PROMPT)

# 실행
result = agent.invoke({
    "input": "오늘 주문 중 생산 불가능한 제품 있어?"
})
```
