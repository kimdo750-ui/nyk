"""
뉴욕꼬맹이 재고관리 AI 에이전트 서버
FastAPI + LangChain + Claude
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from models import ChatRequest, ChatResponse
from agent import get_agent
from sheets import get_sheets_client
from scheduler import init_scheduler, stop_scheduler
from config import settings

# 로깅 설정
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ─── 앱 수명주기 ───
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 뉴욕꼬맹이 재고관리 에이전트 서버 시작")
    logger.info(f"📊 모드: {settings.app_env}")
    # 시트 클라이언트 초기화
    try:
        get_sheets_client()
        logger.info("✅ 구글시트 연결 완료")
    except Exception as e:
        logger.warning(f"⚠️ 구글시트 연결 실패: {e}")
    # 에이전트 초기화
    try:
        get_agent()
        logger.info("✅ AI 에이전트 초기화 완료")
    except Exception as e:
        logger.error(f"❌ 에이전트 초기화 실패: {e}")
    # 스케줄러 초기화 (매일 09:10 일일 리포트 생성)
    try:
        init_scheduler()
        logger.info("✅ 일일 리포트 스케줄러 시작 (매일 09:10)")
    except Exception as e:
        logger.warning(f"⚠️ 스케줄러 초기화 실패: {e}")
    yield
    logger.info("🛑 서버 종료")
    stop_scheduler()


# ─── FastAPI 앱 ───
app = FastAPI(
    title="뉴욕꼬맹이 재고관리 AI 에이전트",
    description="주문파싱 · 재고분석 · 생산가능계산 · AI채팅",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 정적 파일 마운트 (대시보드)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# ─── 헬스체크 ───
@app.get("/")
async def root():
    return {
        "service": "뉴욕꼬맹이 재고관리 AI 에이전트",
        "version": "2.0.0",
        "status": "running",
        "endpoints": [
            "POST /chat          — AI 채팅",
            "GET  /inventory     — 전체 재고 현황",
            "GET  /orders        — 오늘 주문 현황",
            "GET  /production    — 생산가능수량 계산",
            "GET  /alerts        — 재고 부족 알림",
            "POST /deduct/simulate — 차감 시뮬레이션",
            "POST /deduct/execute  — 차감 실행 (확인 필수)",
        ]
    }

@app.get("/health")
async def health():
    return {"status": "ok"}


# ─── 대시보드 ───
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    """실시간 모니터링 대시보드"""
    dashboard_path = Path(__file__).parent / "static" / "dashboard.html"
    if dashboard_path.exists():
        with open(dashboard_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>대시보드를 찾을 수 없습니다</h1>"


# ─── AI 채팅 ───
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """
    AI 에이전트와 대화합니다.
    에이전트가 필요한 도구를 자율적으로 선택해서 실행합니다.

    예시:
    - "오늘 주문 중 생산 불가능한 거 있어?"
    - "무지상품 부족한 것 알려줘"
    - "W281 생산 가능 수량이 몇 개야?"
    - "재고 차감 시뮬레이션 해줘"
    """
    try:
        agent = get_agent()
        result = agent.chat(req.message, req.history)
        return ChatResponse(
            answer=result["answer"],
            tool_calls=result.get("tool_calls", []),
        )
    except Exception as e:
        logger.error(f"채팅 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── 재고 현황 ───
@app.get("/inventory")
async def get_inventory():
    """구글시트 4탭 전체 재고 현황 조회"""
    try:
        client = get_sheets_client()
        return {
            "blank":    [b.model_dump() for b in client.get_blank_stock()],
            "transfer": [t.model_dump() for t in client.get_transfer_stock()],
            "finished": [f.model_dump() for f in client.get_finished_stock()],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/orders")
async def get_orders():
    """오늘 주문 목록 조회"""
    try:
        client = get_sheets_client()
        orders = client.get_orders()
        return {"orders": [o.model_dump() for o in orders], "count": len(orders)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/production")
async def get_production():
    """생산가능수량 계산 (전체 주문 기준)"""
    try:
        agent = get_agent()
        result = agent.chat("오늘 주문 전체 생산가능수량을 계산해줘")
        return {"result": result["answer"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/alerts")
async def get_alerts(level: str = "urgent"):
    """재고 부족 알림 (level: critical/urgent/warning/all)"""
    try:
        agent = get_agent()
        result = agent.chat(f"{level} 기준으로 재고 부족 알림 알려줘")
        return {"result": result["answer"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/daily-report")
async def get_daily_report():
    """
    일일 요약 리포트 (즉시 생성)
    → 사용자에게 텍스트로 반환 → 대표님/카톡에 복사-붙여넣기
    """
    try:
        from daily_report import generate_daily_report
        report = generate_daily_report()
        return {
            "report": report,
            "format": "text",
            "instructions": "위 텍스트를 복사해서 대표님 또는 카톡에 붙여넣으세요"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── 재고 차감 ───
@app.post("/deduct/simulate")
async def deduct_simulate():
    """차감 시뮬레이션 (실제 차감 없음)"""
    try:
        agent = get_agent()
        result = agent.chat("재고 차감 시뮬레이션 해줘")
        return {"result": result["answer"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/deduct/execute")
async def deduct_execute(confirmed: bool = False):
    """
    실제 재고 차감 실행.
    confirmed=true 필수 (안전장치)
    """
    if not confirmed:
        raise HTTPException(
            status_code=400,
            detail="confirmed=true 파라미터가 필요합니다. 먼저 /deduct/simulate로 확인하세요."
        )
    try:
        agent = get_agent()
        result = agent.chat("재고 차감 실행해줘 confirmed=yes")
        return {"result": result["answer"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── 재고 수량 수정 ───
@app.post("/update-transfer")
async def update_transfer(code: str, qty: int):
    """전사지 수량 업데이트"""
    if qty not in [5, 10, 15, 20, 25, 30]:
        raise HTTPException(
            status_code=400,
            detail="수량은 5, 10, 15, 20, 25, 30 중 하나만 선택 가능합니다"
        )
    try:
        client = get_sheets_client()
        success = client.update_transfer_stock(code, qty)
        if success:
            return {"status": "ok", "message": f"{code} 수량이 {qty}로 업데이트되었습니다"}
        else:
            raise HTTPException(status_code=400, detail="업데이트 실패. 해당 코드를 찾을 수 없습니다")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update-finished")
async def update_finished(sku: str, color: str, size: str, qty: int):
    """완제품 수량 업데이트 (gspread 사용)"""
    print(f"📝 /update-finished 요청: sku={sku}, color={color}, size={size}, qty={qty}")

    if qty not in [5, 10, 15, 20, 25, 30]:
        print(f"⚠️ 수량 범위 오류: {qty}")
        raise HTTPException(
            status_code=400,
            detail="수량은 5, 10, 15, 20, 25, 30 중 하나만 선택 가능합니다"
        )
    try:
        print("🔄 sheets_client 호출 중...")
        client = get_sheets_client()
        print(f"📊 update_finished_stock 호출: sku={sku}, color={color}, size={size}, qty={qty}")
        success = client.update_finished_stock(sku, color, size, qty)
        if success:
            return {"status": "ok", "message": f"✅ {sku} {color} {size} 수량이 {qty}로 업데이트되었습니다"}
        else:
            print(f"❌ 업데이트 실패: 항목 찾을 수 없음")
            raise HTTPException(status_code=400, detail="업데이트 실패. 해당 항목을 찾을 수 없습니다")
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ 예외 발생: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.app_env == "development",
        log_level=settings.log_level.lower(),
    )
