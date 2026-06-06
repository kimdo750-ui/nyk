"""
데이터 모델 정의 (Pydantic)
"""
from pydantic import BaseModel, Field
from typing import Optional, Literal
from enum import Enum


# ─── 재고 상태 ───
class StockStatus(str, Enum):
    CRITICAL = "🔴 생산불가"   # 재고 = 0
    URGENT   = "🔴 긴급"       # 재고 ≤ 10
    LOW      = "🟡 부족"       # 재고 ≤ 안전재고
    SAFE     = "🟢 안전"       # 재고 > 안전재고
    UNKNOWN  = "⚠️ 없음"       # 시트에 없음


def calc_status(stock: int, safe_stock: int) -> StockStatus:
    if stock == 0:   return StockStatus.CRITICAL
    if stock <= 10:  return StockStatus.URGENT
    if stock <= safe_stock: return StockStatus.LOW
    return StockStatus.SAFE


# ─── 주문 ───
class Order(BaseModel):
    channel:  str = Field(..., description="쇼핑몰명 (쿠팡, 하프클럽 등)")
    code:     str = Field(..., description="제품코드 (W281, IT024 등)")
    color:    str = Field(..., description="컬러 (블랙, 화이트 등)")
    size:     str = Field(..., description="사이즈 (120, 130 등)")
    qty:      int = Field(..., description="주문 수량")
    status:   str = Field("", description="파싱 상태")


# ─── 무지상품재고 ───
class BlankStock(BaseModel):
    garment:    str = Field(..., description="의류종류 (반팔티, 맨투맨, 후드티)")
    color:      str = Field(..., description="컬러")
    size:       str = Field(..., description="사이즈")
    stock:      int = Field(..., description="현재재고")
    safe_stock: int = Field(30, description="안전재고")
    status:     StockStatus = StockStatus.UNKNOWN

    def model_post_init(self, __context):
        self.status = calc_status(self.stock, self.safe_stock)


# ─── 전사지재고 ───
class TransferStock(BaseModel):
    code:       str = Field(..., description="전사지코드 = 완제품 SKU")
    name:       str = Field("", description="전사지명")
    color:      str = Field("", description="전사지 색상")
    stock:      int = Field(..., description="현재재고 (매수)")
    safe_stock: int = Field(20, description="안전재고")
    status:     StockStatus = StockStatus.UNKNOWN

    def model_post_init(self, __context):
        self.status = calc_status(self.stock, self.safe_stock)


# ─── 완제품재고 ───
class FinishedStock(BaseModel):
    sku:         str = Field(..., description="완제품 SKU (= 전사지코드)")
    color:       str = Field(..., description="컬러")
    size:        str = Field(..., description="사이즈")
    stock:       int = Field(..., description="현재재고")
    daily_sales: float = Field(0, description="일평균 판매량")
    runout_days: Optional[int] = Field(None, description="예상 소진일")


# ─── 생산가능수량 계산 결과 ───
class ProductionResult(BaseModel):
    code:           str
    color:          str
    size:           str
    order_qty:      int = Field(..., description="주문 수량")
    blank_stock:    int = Field(..., description="무지상품 재고")
    transfer_stock: int = Field(..., description="전사지 재고")
    can_produce:    int = Field(..., description="생산가능수량 = MIN(무지, 전사지)")
    bottleneck:     Literal["무지부족", "전사지부족", "무지없음", "전사지없음", "가능"]
    status:         StockStatus

    @property
    def shortage(self) -> int:
        return max(0, self.order_qty - self.can_produce)


# ─── 재고 부족 알림 ───
class ShortageAlert(BaseModel):
    alert_type:    Literal["blank", "transfer"]
    code:          str = Field(..., description="컬러/사이즈 또는 전사지코드")
    name:          str = ""
    stock:         int
    safe_stock:    int
    status:        StockStatus
    affected_skus: list[str] = Field([], description="영향받는 완제품 SKU 목록")


# ─── 차감 결과 ───
class DeductResult(BaseModel):
    code:         str
    color:        str
    size:         str
    order_qty:    int
    blank_before: int
    blank_after:  int
    trans_before: int
    trans_after:  int
    fin_status:   str  # "출고가능 N개" 또는 "완제품 출고없음"
    success:      bool


# ─── AI 채팅 요청/응답 ───
class ChatRequest(BaseModel):
    message:   str = Field(..., description="사용자 메시지")
    history:   list[dict] = Field([], description="대화 히스토리")
    confirmed: bool = Field(False, description="재고 차감 확인 여부")


class ChatResponse(BaseModel):
    answer:     str
    tool_calls: list[str] = []  # 실행된 도구 목록
    data:       Optional[dict] = None
