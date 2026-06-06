"""
매일 09:10에 자동으로 생성되는 재고 현황 요약 리포트
사용자에게 텍스트로 전송 → 대표님/카톡에 복사-붙여넣기
"""
import logging
from datetime import datetime
from sheets import get_sheets_client
from models import Order, BlankStock, TransferStock, FinishedStock

logger = logging.getLogger(__name__)


def generate_daily_report() -> str:
    """
    매일 09:10에 실행될 일일 요약 리포트 생성

    Returns:
        카톡에 복사-붙여넣기 가능한 텍스트 리포트
    """
    try:
        client = get_sheets_client()

        # 4개 시트에서 데이터 조회
        orders: list[Order] = client.get_orders()
        blanks: list[BlankStock] = client.get_blank_stock()
        transfers: list[TransferStock] = client.get_transfer_stock()
        finished_items: list[FinishedStock] = client.get_finished_stock()

        # 날짜
        today = datetime.now().strftime("%Y-%m-%d")

        # 섹션 1: 원단 발주 필요 (무지상품 부족)
        fabric_needed = _get_fabric_orders(orders, blanks, transfers)

        # 섹션 2: 전사지 인쇄 대기 (주문 - 완제품 = 전사지 수량)
        transfer_print = _get_transfer_print_list(orders, finished_items, transfers)

        # 섹션 3: 배송 일정
        shipping_schedule = _get_shipping_schedule(orders)

        # 리포트 조합
        report = f"""📅 {today} 일일 재고 현황 요약

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{fabric_needed}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{transfer_print}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{shipping_schedule}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

        logger.info("✅ 일일 리포트 생성 완료")
        return report

    except Exception as e:
        logger.error(f"❌ 일일 리포트 생성 실패: {e}")
        return f"❌ 리포트 생성 실패: {str(e)}"


def _get_fabric_orders(orders: list[Order], blanks: list[BlankStock],
                       transfers: list[TransferStock]) -> str:
    """
    섹션 1: 원단 발주 필요 항목
    (무지상품 재고가 부족하거나 없는 경우)
    """
    if not orders:
        return "⚠️ 【원단 발주】\n처리할 주문이 없습니다."

    fabric_needs = []

    # 주문 집계 (코드/컬러/사이즈별)
    order_summary = {}
    for o in orders:
        key = f"{o.code}|{o.color}|{o.size}"
        order_summary[key] = order_summary.get(key, 0) + o.qty

    # 각 주문에 대해 무지 재고 확인
    for key, order_qty in order_summary.items():
        code, color, size = key.split("|")

        # 무지상품 재고 찾기
        blank = next((b for b in blanks if b.color == color and b.size == size), None)
        blank_stock = blank.stock if blank else 0

        # 무지 부족 시에만 표시
        if blank_stock < order_qty:
            shortage = order_qty - blank_stock
            blank_status = f"{blank_stock}개 (부족: {shortage}개)" if blank_stock > 0 else "없음"
            fabric_needs.append(f"  • {code} {color} {size}")
            fabric_needs.append(f"    → 주문: {order_qty}개 | 무지재고: {blank_status}")

    if not fabric_needs:
        return "⚠️ 【원단 발주】필요\n✅ 현재 원단 발주 필요 항목 없음"

    return "⚠️ 【원단 발주】필요\n" + "\n".join(fabric_needs)


def _get_transfer_print_list(orders: list[Order], finished_items: list[FinishedStock],
                             transfers: list[TransferStock]) -> str:
    """
    섹션 2: 전사지 인쇄 대기 목록
    계산: 주문량 - 완제품재고 = 전사지 인쇄 수량
    """
    if not orders:
        return "📦 【전사지 인쇄】대기\n처리할 주문이 없습니다."

    print_list = []
    total_prints = 0

    # 주문 집계
    order_summary = {}
    for o in orders:
        key = f"{o.code}|{o.color}|{o.size}"
        order_summary[key] = order_summary.get(key, 0) + o.qty

    # 전사지 인쇄 수량 계산
    for key, order_qty in sorted(order_summary.items()):
        code, color, size = key.split("|")

        # 완제품 재고 찾기
        finished = next((f for f in finished_items
                        if f.sku == code and f.color == color and f.size == size), None)
        finished_stock = finished.stock if finished else 0

        # 전사지 인쇄 수량 = 주문 - 완제품
        print_qty = max(0, order_qty - finished_stock)

        if print_qty > 0:
            print_list.append(f"  • {code} {color} {size}")
            print_list.append(f"    → 주문: {order_qty}개 - 완제품: {finished_stock}개 = 전사지: {print_qty}개 ✏️")
            total_prints += print_qty

    if not print_list:
        return "📦 【전사지 인쇄】대기\n✅ 모든 주문이 완제품으로 처리 가능"

    header = f"📦 【전사지 인쇄】대기 (총 {total_prints}개)\n"
    return header + "\n".join(print_list)


def _get_shipping_schedule(orders: list[Order]) -> str:
    """
    섹션 3: 배송 일정
    (향후 확장: 쿠팡 배송일자 정보가 시트에 있으면 활용)
    """
    if not orders:
        return "⏰ 【배송 예정】\n예정된 배송이 없습니다."

    # 현재는 채널별로 집계
    channel_summary = {}
    for o in orders:
        if o.channel not in channel_summary:
            channel_summary[o.channel] = 0
        channel_summary[o.channel] += o.qty

    lines = ["⏰ 【배송 예정】"]
    for channel, qty in sorted(channel_summary.items()):
        lines.append(f"  • {channel}: {qty}개")

    lines.append(f"\n  📊 총 주문: {sum(channel_summary.values())}개")

    return "\n".join(lines)


# ─────────────────────────────────────────
# 테스트용 실행
# ─────────────────────────────────────────
if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    report = generate_daily_report()
    print("\n" + "="*50)
    print(report)
    print("="*50 + "\n")

    # 클립보드에 복사 (Windows)
    try:
        import pyperclip
        pyperclip.copy(report)
        print("✅ 리포트가 클립보드에 복사되었습니다!")
    except ImportError:
        print("(pyperclip 미설치 - pip install pyperclip)")
