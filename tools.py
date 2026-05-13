"""
LangChain Function Calling 도구 정의
에이전트의 '손과 발' — 실제 데이터를 조회·계산·차감하는 함수들
"""
import json
import logging
from langchain.tools import tool
from models import (
    Order, BlankStock, TransferStock, ProductionResult,
    ShortageAlert, DeductResult, StockStatus, calc_status
)
from sheets import get_sheets_client

logger = logging.getLogger(__name__)


@tool
def get_orders(status: str = "pending") -> str:
    """
    주문확인(원본) 시트에서 오늘 주문 데이터를 조회합니다.

    Args:
        status: 조회할 주문 상태
                "pending" = 아직 차감 안 된 주문 (기본값)
                "all"     = 전체 주문

    Returns:
        주문 목록 JSON (channel, code, color, size, qty)

    Example:
        get_orders() → "IT024/화이트/150: 5개(쿠팡), W281/블랙/130: 3개(하프클럽)"
    """
    try:
        client = get_sheets_client()
        orders = client.get_orders()

        if not orders:
            return "📭 처리할 주문이 없습니다. (파싱 완료된 주문이 없거나 모두 차감 완료)"

        # 코드/컬러/사이즈별 집계
        summary = {}
        for o in orders:
            key = f"{o.code}/{o.color}/{o.size}"
            if key not in summary:
                summary[key] = {"code": o.code, "color": o.color,
                                "size": o.size, "qty": 0, "channels": []}
            summary[key]["qty"] += o.qty
            if o.channel not in summary[key]["channels"]:
                summary[key]["channels"].append(o.channel)

        lines = [f"📋 오늘 주문 {len(summary)}종 (총 {sum(v['qty'] for v in summary.values())}개):"]
        for k, v in summary.items():
            lines.append(f"  • {k}: {v['qty']}개 [{', '.join(v['channels'])}]")

        return "\n".join(lines)
    except Exception as e:
        logger.error(f"get_orders 오류: {e}")
        return f"❌ 주문 조회 실패: {str(e)}"


@tool
def get_blank_stock(color: str = "", size: str = "") -> str:
    """
    무지상품재고를 조회합니다. 컬러와 사이즈로 필터 가능.

    Args:
        color: 컬러 필터 (예: "블랙", "화이트". 빈 문자열이면 전체 조회)
        size:  사이즈 필터 (예: "130", "150". 빈 문자열이면 전체 조회)

    Returns:
        무지상품 재고 현황 (의류종류, 컬러, 사이즈, 현재재고, 상태)

    Example:
        get_blank_stock(color="블랙") → "블랙 130: 45개 🟢안전"
        get_blank_stock()             → 전체 목록
    """
    try:
        client = get_sheets_client()
        items = client.get_blank_stock(
            color=color or None,
            size=size or None
        )
        if not items:
            q = f"{color} {size}".strip()
            return f"⚠️ {q} 무지상품 재고 없음 (시트에 없거나 해당 항목 없음)"

        lines = [f"🧵 무지상품재고 ({len(items)}종):"]
        for item in sorted(items, key=lambda x: x.stock):
            lines.append(
                f"  {item.garment} {item.color} {item.size}: "
                f"{item.stock}개 / 안전재고:{item.safe_stock}개 {item.status.value}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"❌ 무지재고 조회 실패: {str(e)}"


@tool
def get_transfer_stock(code: str = "") -> str:
    """
    전사지재고를 조회합니다. 제품코드로 필터 가능.

    Args:
        code: 전사지코드 필터 (예: "W281", "IT024". 빈 문자열이면 전체)

    Returns:
        전사지 재고 현황 (코드, 이름, 현재재고, 상태)

    Example:
        get_transfer_stock(code="IT024") → "IT024(브레인롯반팔): 0매 🔴생산불가"
        get_transfer_stock()             → 전체 목록
    """
    try:
        client = get_sheets_client()
        items = client.get_transfer_stock(code=code or None)
        if not items:
            q = code or "전체"
            return f"⚠️ {q} 전사지 재고 없음"

        lines = [f"🖨️ 전사지재고 ({len(items)}종):"]
        for item in sorted(items, key=lambda x: x.stock):
            name = f"({item.name})" if item.name else ""
            lines.append(
                f"  {item.code}{name}: {item.stock}매 "
                f"/ 안전재고:{item.safe_stock}매 {item.status.value}"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"❌ 전사지재고 조회 실패: {str(e)}"


@tool
def calculate_production(filter_code: str = "") -> str:
    """
    주문 기준으로 생산가능수량을 계산합니다.
    생산가능수량 = MIN(무지상품재고[컬러][사이즈], 전사지재고[제품코드])

    Args:
        filter_code: 특정 제품코드만 계산 (빈 문자열이면 전체 주문 기준)

    Returns:
        각 주문 SKU별 생산가능수량, 병목 원인, 부족 수량

    Example:
        calculate_production() →
            "IT024/화이트/150: 생산가능 0개 🔴 [전사지없음] (5개 부족)"
            "W281/블랙/130: 생산가능 3개 🟢 [가능]"
    """
    try:
        client = get_sheets_client()
        orders = client.get_orders()
        if not orders:
            return "📭 계산할 주문이 없습니다."

        if filter_code:
            orders = [o for o in orders if o.code == filter_code]
            if not orders:
                return f"⚠️ {filter_code} 주문 없음"

        blank_all    = client.get_blank_stock()
        transfer_all = client.get_transfer_stock()

        # 코드/컬러/사이즈별 집계
        summary = {}
        for o in orders:
            key = f"{o.code}|{o.color}|{o.size}"
            summary[key] = summary.get(key, 0) + o.qty

        results = []
        for key, order_qty in summary.items():
            code, color, size = key.split("|")

            blank = next((b for b in blank_all
                          if b.color == color and b.size == size), None)
            transfer = next((t for t in transfer_all
                             if t.code == code), None)

            b_stock = blank.stock if blank else 0
            t_stock = transfer.stock if transfer else 0

            can_produce = min(b_stock, t_stock)
            shortage = max(0, order_qty - can_produce)

            if not blank:    bottleneck = "무지없음"
            elif not transfer: bottleneck = "전사지없음"
            elif b_stock <= t_stock: bottleneck = "무지부족"
            else:            bottleneck = "전사지부족"

            if can_produce == 0: status = "🔴 생산불가"
            elif can_produce < order_qty: status = "🟠 부분생산"
            else: status = "🟢 가능"

            results.append(
                f"  {code}/{color}/{size}: "
                f"주문 {order_qty}개 → 생산가능 {can_produce}개 {status} "
                f"[{bottleneck}]"
                + (f" ※ {shortage}개 부족" if shortage > 0 else "")
            )

        critical = sum(1 for r in results if "🔴" in r)
        partial  = sum(1 for r in results if "🟠" in r)
        ok       = sum(1 for r in results if "🟢" in r)

        header = (f"⚙️ 생산가능수량 계산 결과 "
                  f"(🔴{critical}건 / 🟠{partial}건 / 🟢{ok}건):")
        return header + "\n" + "\n".join(results)
    except Exception as e:
        return f"❌ 생산가능수량 계산 실패: {str(e)}"


@tool
def get_shortage_alerts(level: str = "urgent") -> str:
    """
    재고 부족 알림을 조회합니다. 긴급도에 따라 필터 가능.

    Args:
        level: 알림 기준
               "critical" = 재고 0 (생산불가)
               "urgent"   = 재고 ≤ 10 (긴급)
               "warning"  = 재고 ≤ 안전재고 (주의)
               "all"      = 전체

    Returns:
        부족 항목 목록 및 영향받는 완제품 SKU

    Example:
        get_shortage_alerts(level="urgent") →
            "🔴 무지상품 블랙/130: 재고 8개 → 영향 SKU: IT004, W285, IT011"
    """
    try:
        client = get_sheets_client()
        blank_all    = client.get_blank_stock()
        transfer_all = client.get_transfer_stock()
        finished_all = client.get_finished_stock()

        thresholds = {
            "critical": [StockStatus.CRITICAL],
            "urgent":   [StockStatus.CRITICAL, StockStatus.URGENT],
            "warning":  [StockStatus.CRITICAL, StockStatus.URGENT, StockStatus.LOW],
            "all":      list(StockStatus),
        }
        target = thresholds.get(level, thresholds["urgent"])

        alerts = []

        # 무지상품 부족
        for b in sorted(blank_all, key=lambda x: x.stock):
            if b.status in target:
                affected = [f.sku for f in finished_all
                            if f.color == b.color and f.size == b.size]
                alerts.append(
                    f"🧵 무지 [{b.color}/{b.size}]: {b.stock}개 {b.status.value}"
                    + (f" → 영향 SKU: {', '.join(set(affected))}" if affected else "")
                )

        # 전사지 부족
        for t in sorted(transfer_all, key=lambda x: x.stock):
            if t.status in target:
                alerts.append(
                    f"🖨️ 전사지 [{t.code}]: {t.stock}매 {t.status.value}"
                )

        if not alerts:
            return f"✅ {level} 기준 이하 재고 부족 없음"

        return f"⚠️ 재고 부족 알림 ({len(alerts)}건):\n" + "\n".join(f"  {a}" for a in alerts)
    except Exception as e:
        return f"❌ 알림 조회 실패: {str(e)}"


@tool
def simulate_deduction(dummy: str = "") -> str:
    """
    재고 차감 시뮬레이션 (실제 차감 없음, 확인용).
    현재 주문 기준으로 차감 후 예상 재고를 보여줍니다.

    Args:
        dummy: 사용하지 않음 (LangChain 호환용)

    Returns:
        차감 시뮬레이션 결과 (차감 전→후 수량, 부족 여부)

    Note:
        실제 차감은 execute_deduction() 도구를 사용하세요.
        반드시 사용자 확인 후 실행해야 합니다.
    """
    try:
        client = get_sheets_client()
        orders = client.get_orders()
        if not orders:
            return "📭 차감할 주문이 없습니다."

        blank_all    = client.get_blank_stock()
        transfer_all = client.get_transfer_stock()
        finished_all = client.get_finished_stock()

        # 집계
        summary = {}
        for o in orders:
            key = f"{o.code}|{o.color}|{o.size}"
            summary[key] = summary.get(key, 0) + o.qty

        lines = ["📊 재고 차감 시뮬레이션 (실제 차감 아님):"]
        lines.append("─" * 40)

        for key, qty in summary.items():
            code, color, size = key.split("|")

            blank = next((b for b in blank_all
                          if b.color == color and b.size == size), None)
            transfer = next((t for t in transfer_all if t.code == code), None)
            finished = next((f for f in finished_all
                             if f.sku == code and f.color == color and f.size == size), None)

            b_before = blank.stock if blank else 0
            t_before = transfer.stock if transfer else 0
            b_after  = max(0, b_before - qty)
            t_after  = max(0, t_before - qty)

            fin_status = (f"출고가능 {finished.stock}개" if finished and finished.stock > 0
                          else "완제품 출고없음")

            warn = ""
            if b_before < qty: warn += f" ⚠️무지{qty-b_before}개부족"
            if t_before < qty: warn += f" ⚠️전사지{qty-t_before}매부족"

            lines.append(
                f"  {code}/{color}/{size} ({qty}개 차감){warn}\n"
                f"    🧵 무지: {b_before}→{b_after}개\n"
                f"    🖨️ 전사지: {t_before}→{t_after}매\n"
                f"    📦 완제품: {fin_status}"
            )

        lines.append("─" * 40)
        lines.append("⚡ 실제 차감하려면 '차감 실행해줘'라고 말씀하세요.")
        return "\n".join(lines)
    except Exception as e:
        return f"❌ 시뮬레이션 실패: {str(e)}"


@tool
def execute_deduction(confirmed: str = "no") -> str:
    """
    실제 재고 차감을 실행합니다.
    반드시 simulate_deduction() 확인 후 사용자 동의를 받아야 합니다.

    Args:
        confirmed: "yes"일 때만 실제 차감 실행 (안전장치)

    Returns:
        차감 결과 (성공/실패, 무지·전사지·완제품 처리 결과)

    Safety:
        - confirmed="yes"가 아니면 절대 실행하지 않음
        - 부족 재고는 0으로 처리 (음수 없음)
    """
    if confirmed.lower() not in ("yes", "확인", "실행"):
        return ("⚠️ 안전장치: 차감을 실행하려면 confirmed='yes'를 전달하세요.\n"
                "먼저 simulate_deduction()으로 결과를 확인하세요.")
    try:
        client = get_sheets_client()
        orders = client.get_orders()
        if not orders:
            return "📭 차감할 주문이 없습니다."

        blank_all    = client.get_blank_stock()
        transfer_all = client.get_transfer_stock()
        finished_all = client.get_finished_stock()

        # 집계
        summary = {}
        for o in orders:
            key = f"{o.code}|{o.color}|{o.size}"
            summary[key] = summary.get(key, 0) + o.qty

        results = []
        for key, qty in summary.items():
            code, color, size = key.split("|")

            blank    = next((b for b in blank_all
                             if b.color == color and b.size == size), None)
            transfer = next((t for t in transfer_all if t.code == code), None)
            finished = next((f for f in finished_all
                             if f.sku == code and f.color == color and f.size == size), None)

            b_before = blank.stock if blank else 0
            t_before = transfer.stock if transfer else 0
            b_after  = max(0, b_before - qty)
            t_after  = max(0, t_before - qty)

            b_ok = client.update_blank_stock(color, size, b_after) if blank else False
            t_ok = client.update_transfer_stock(code, t_after) if transfer else False

            fin_status = (f"출고가능 {finished.stock}개" if finished and finished.stock > 0
                          else "완제품 출고없음")

            results.append(
                f"  ✅ {code}/{color}/{size}\n"
                f"    🧵 무지: {b_before}→{b_after}개 {'✓' if b_ok else '❌시트업데이트실패'}\n"
                f"    🖨️ 전사지: {t_before}→{t_after}매 {'✓' if t_ok else '❌시트업데이트실패'}\n"
                f"    📦 완제품: {fin_status}"
            )

        return "✅ 재고 차감 완료!\n" + "\n".join(results)
    except Exception as e:
        return f"❌ 차감 실행 실패: {str(e)}"


# 도구 목록 (에이전트에 등록)
ALL_TOOLS = [
    get_orders,
    get_blank_stock,
    get_transfer_stock,
    calculate_production,
    get_shortage_alerts,
    simulate_deduction,
    execute_deduction,
]
