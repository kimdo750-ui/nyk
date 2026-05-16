"""
구글시트 데이터 레이어
방법 A: Apps Script Web App URL (현재 설정 재사용)
방법 B: gspread + Service Account (직접 연결)
"""
import httpx
import gspread
import logging
from google.oauth2.service_account import Credentials
from config import settings
from models import Order, BlankStock, TransferStock, FinishedStock

logger = logging.getLogger(__name__)

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/drive",
]


class SheetsClient:
    """구글시트 클라이언트 (방법 A/B 자동 선택)"""

    def __init__(self):
        self._ws = {}  # 워크시트 캐시
        if settings.google_service_account_file and settings.spreadsheet_id:
            self._mode = "gspread"
            self._init_gspread()
            logger.info("✅ gspread 연결 (Service Account)")
        elif settings.apps_script_url:
            self._mode = "apps_script"
            logger.info("✅ Apps Script URL 연결")
        else:
            raise ValueError("APPS_SCRIPT_URL 또는 GOOGLE_SERVICE_ACCOUNT_FILE을 설정하세요")

    def _init_gspread(self):
        creds = Credentials.from_service_account_file(
            settings.google_service_account_file, scopes=SCOPES
        )
        gc = gspread.authorize(creds)
        self._spreadsheet = gc.open_by_key(settings.spreadsheet_id)

    def _get_ws(self, name: str):
        if name not in self._ws:
            self._ws[name] = self._spreadsheet.worksheet(name)
        return self._ws[name]

    # ─────────────────────────────────────────────
    # 공통 메서드 (A/B 분기)
    # ─────────────────────────────────────────────

    def _fetch_all(self) -> dict:
        """4탭 전체 데이터 조회"""
        if self._mode == "apps_script":
            return self._fetch_via_apps_script()
        return self._fetch_via_gspread()

    def _fetch_via_apps_script(self) -> dict:
        url = settings.apps_script_url + "?action=getInventory"
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            res = client.get(url)
            res.raise_for_status()
            data = res.json()
            if data.get("status") != "ok":
                raise ValueError(f"Apps Script 오류: {data}")
            return data["data"]

    def _fetch_via_gspread(self) -> dict:
        result = {}
        # 주문확인(원본) - H열부터(8번째)가 파싱 결과
        ws = self._get_ws(settings.sheet_order)
        rows = ws.get_all_values()[1:]  # 헤더 제외
        result["orders"] = [
            {"channel": r[0], "code": r[7], "color": r[8],
             "size": r[9], "qty": r[10] or 1, "status": r[11]}
            for r in rows if r[0] and r[7] and "✅" in r[11]
        ]

        # 무지상품재고
        ws = self._get_ws(settings.sheet_blank)
        rows = ws.get_all_values()[1:]
        result["blank"] = [
            {"garment": r[0], "color": r[1], "size": r[2],
             "stock": int(r[3] or 0), "safeStock": int(r[4] or 30)}
            for r in rows if r[0]
        ]

        # 전사지재고
        ws = self._get_ws(settings.sheet_transfer)
        rows = ws.get_all_values()[1:]
        result["transfer"] = [
            {"code": r[0], "name": r[1], "color": r[2] if len(r) > 2 else "",
             "stock": int(r[3] if len(r) > 3 else 0), "safeStock": int(r[4] if len(r) > 4 else 20)}
            for r in rows if r[0]
        ]

        # 완제품재고
        ws = self._get_ws(settings.sheet_finished)
        rows = ws.get_all_values()[1:]
        result["finished"] = [
            {"sku": r[0], "color": r[1], "size": r[2],
             "stock": int(r[3] or 0), "dailySales": float(r[4] or 0)}
            for r in rows if r[0]
        ]
        return result

    # ─────────────────────────────────────────────
    # 도메인 메서드
    # ─────────────────────────────────────────────

    def get_orders(self) -> list[Order]:
        data = self._fetch_all()
        orders = data.get("orders", [])

        # ━━━ 테스트 모드: 주문 데이터가 없으면 샘플 데이터 반환 ━━━
        if not orders and settings.app_env == "development":
            logger.warning("⚠️ 주문 데이터 없음 → 테스트 데이터 사용")
            return [
                Order(channel="쿠팡", code="P016", color="레드", size="130", qty=5, status=""),
                Order(channel="쿠팡", code="W281", color="블랙", size="140", qty=3, status=""),
                Order(channel="하프클럽", code="G061", color="블랙", size="150", qty=7, status=""),
                Order(channel="쿠팡", code="T031", color="레드", size="160", qty=4, status=""),
            ]

        if not orders:
            logger.warning("⚠️ 주문 데이터 없음")
            return []

        logger.info(f"📋 전체 주문: {len(orders)}건")

        result = []
        for o in orders:
            # 필드값 검증 및 정제
            code = o.get("code", "").strip()
            if not code:
                continue

            status = o.get("status", "")
            # 차감 완료가 아닌 주문만 포함 (또는 차감 상태와 무관하게 모두 포함 가능)
            # 참고: "차감완료"가 포함된 주문도 생산 분석에 포함할 수 있음
            if "차감완료" not in status:
                result.append(Order(
                    channel=o.get("channel", ""),
                    code=code,
                    color=o.get("color", "").strip(),
                    size=o.get("size", ""),
                    qty=int(o.get("qty", 1)),
                    status=status
                ))

        logger.info(f"✅ 미처리 주문: {len(result)}건 (차감완료 제외)")
        if len(result) == 0 and len(orders) > 0:
            logger.warning("⚠️ 차감완료 제외 후 주문 없음. 모든 주문이 처리됨.")

        return result

    def get_blank_stock(self, color: str = None, size: str = None) -> list[BlankStock]:
        data = self._fetch_all()
        items = [
            BlankStock(
                garment=b["garment"],
                color=b["color"].strip(),  # 앞뒤 공백 제거
                size=b["size"],
                stock=int(b["stock"]),
                safe_stock=int(b.get("safeStock") or b.get("safe_stock", 30))
            )
            for b in data.get("blank", [])
        ]

        # ━━━ 테스트 모드: 재고가 없으면 샘플 데이터 반환 ━━━
        if not items and settings.app_env == "development":
            logger.warning("⚠️ 무지상품 데이터 없음 → 테스트 데이터 사용")
            items = [
                BlankStock(garment="반팔티", color="레드", size="130", stock=2, safe_stock=30),
                BlankStock(garment="반팔티", color="블랙", size="140", stock=25, safe_stock=30),
                BlankStock(garment="반팔티", color="블랙", size="150", stock=5, safe_stock=30),
                BlankStock(garment="반팔티", color="레드", size="160", stock=15, safe_stock=30),
                BlankStock(garment="맨투맨", color="화이트", size="120", stock=45, safe_stock=30),
            ]

        if color: items = [i for i in items if i.color == color]
        if size:  items = [i for i in items if i.size == size]
        return items

    def get_transfer_stock(self, code: str = None) -> list[TransferStock]:
        data = self._fetch_all()
        items = []
        for t in data.get("transfer", []):
            # 필드명 호환성 (한글/영문, camelCase/snake_case 모두 지원)
            code_val = t.get("code") or t.get("코드", "")
            name_val = t.get("name") or t.get("이름", "")
            color_val = t.get("color") or t.get("색상", "")
            stock_val = int(t.get("stock") or t.get("재고", 0))
            safe_stock_val = int(t.get("safeStock") or t.get("safe_stock") or t.get("안전재고", 20))

            if code_val:  # code가 있을 때만 추가
                items.append(TransferStock(
                    code=code_val,
                    name=name_val,
                    color=color_val,
                    stock=stock_val,
                    safe_stock=safe_stock_val
                ))

        # ━━━ 테스트 모드: 데이터가 없으면 샘플 데이터 반환 ━━━
        if not items and settings.app_env == "development":
            logger.warning("⚠️ 전사지 데이터 없음 → 테스트 데이터 사용")
            items = [
                TransferStock(code="P016", name="P016 반팔", color="레드", stock=0, safe_stock=20),
                TransferStock(code="W281", name="W281 반팔", color="블랙", stock=15, safe_stock=20),
                TransferStock(code="G061", name="G061 반팔", color="블랙", stock=8, safe_stock=20),
                TransferStock(code="T031", name="T031 맨투맨", color="레드", stock=25, safe_stock=20),
            ]

        if code: items = [i for i in items if i.code == code]
        return items

    def get_finished_stock(self, code: str = None) -> list[FinishedStock]:
        data = self._fetch_all()
        items = [
            FinishedStock(
                sku=f["sku"],
                color=f["color"].strip(),  # 공백 제거
                size=f["size"],
                stock=int(f["stock"]),
                daily_sales=float(f.get("dailySales") or f.get("daily_sales", 0))
            )
            for f in data.get("finished", [])
        ]

        # ━━━ 테스트 모드: 데이터가 없으면 샘플 데이터 반환 ━━━
        if not items and settings.app_env == "development":
            logger.warning("⚠️ 완제품 데이터 없음 → 테스트 데이터 사용")
            items = [
                FinishedStock(sku="P016", color="레드", size="130", stock=0, daily_sales=2.5),
                FinishedStock(sku="W281", color="블랙", size="140", stock=1, daily_sales=1.2),
                FinishedStock(sku="G061", color="블랙", size="150", stock=0, daily_sales=3.1),
                FinishedStock(sku="T031", color="레드", size="160", stock=2, daily_sales=1.8),
            ]

        if code: items = [i for i in items if i.sku == code]
        return items

    def update_blank_stock(self, color: str, size: str, new_qty: int) -> bool:
        """무지상품재고 수량 업데이트 (gspread 모드만 지원)"""
        if self._mode != "gspread":
            logger.warning("Apps Script 모드에서는 직접 수정 불가")
            return False
        ws = self._get_ws(settings.sheet_blank)
        rows = ws.get_all_values()[1:]
        for i, row in enumerate(rows):
            if row[1] == color and row[2] == size:
                ws.update_cell(i + 2, 4, new_qty)
                return True
        return False

    def update_transfer_stock(self, code: str, new_qty: int) -> bool:
        """전사지재고 수량 업데이트"""
        if self._mode != "gspread":
            return False
        ws = self._get_ws(settings.sheet_transfer)
        rows = ws.get_all_values()[1:]
        for i, row in enumerate(rows):
            if row[0] == code:
                ws.update_cell(i + 2, 4, new_qty)
                return True
        return False

    def update_finished_stock(self, sku: str, color: str, size: str, new_qty: int) -> bool:
        """완제품재고 수량 업데이트"""
        if self._mode != "gspread":
            return False
        try:
            ws = self._get_ws(settings.sheet_finished)
            rows = ws.get_all_values()[1:]

            print(f"🔍 찾는 항목: SKU=[{sku}], Color=[{color}], Size=[{size}]")

            for i, row in enumerate(rows):
                if len(row) >= 3:
                    # 공백 제거 후 정확히 비교
                    row_sku = str(row[0]).strip() if row[0] else ""
                    row_color = str(row[1]).strip() if row[1] else ""
                    row_size = str(row[2]).strip() if row[2] else ""

                    print(f"   행 {i+2}: SKU=[{row_sku}] Color=[{row_color}] Size=[{row_size}]")

                    if row_sku == sku and row_color == color and row_size == size:
                        print(f"✅ 매칭됨! D{i+2} 셀을 {new_qty}로 업데이트")
                        ws.update_cell(i + 2, 4, new_qty)
                        return True

            print(f"❌ 매칭되는 항목 없음 (총 {len(rows)}행 확인)")
            return False
        except Exception as e:
            print(f"❌ 업데이트 실패: {e}")
            import traceback
            traceback.print_exc()
            return False


# 싱글톤
_client = None

def get_sheets_client() -> SheetsClient:
    global _client
    if _client is None:
        _client = SheetsClient()
    return _client
