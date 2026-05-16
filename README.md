# 🤖 뉴욕꼬맹이 재고관리 AI 에이전트 v2

Python + FastAPI + LangChain + Claude 기반 자율 에이전트

---

## 빠른 시작

```bash
# 1. 의존성 설치
pip install -r requirements.txt

# 2. 환경변수 설정
cp .env.example .env
# .env 파일에서 API 키, URL 설정

# 3. 서버 실행
python main.py
# 또는
uvicorn main:app --reload

# 4. API 문서
# http://localhost:8000/docs
```

---

## 파일 구조

```
nykids-agent/
├── main.py          # FastAPI 서버 (엔드포인트)
├── agent.py         # LangChain ReAct 에이전트
├── tools.py         # Function Calling 도구 6개
├── sheets.py        # 구글시트 데이터 레이어
├── models.py        # Pydantic 데이터 모델
├── config.py        # 환경변수 설정
├── requirements.txt
└── .env.example
```

---

## AI 에이전트 도구 6개

| 도구 | 설명 |
|------|------|
| `get_orders` | 주문확인 시트 조회 |
| `get_blank_stock` | 무지상품재고 조회 |
| `get_transfer_stock` | 전사지재고 조회 |
| `calculate_production` | 생산가능수량 계산 |
| `get_shortage_alerts` | 재고 부족 알림 |
| `simulate_deduction` | 차감 시뮬레이션 |
| `execute_deduction` | 실제 차감 실행 |

---

## API 엔드포인트

```
POST /chat                 AI 채팅 (자율 에이전트)
GET  /inventory            전체 재고 현황
GET  /orders               오늘 주문
GET  /production           생산가능수량
GET  /alerts?level=urgent  재고 부족 알림
POST /deduct/simulate      차감 시뮬레이션
POST /deduct/execute       차감 실행 (?confirmed=true)
```

---

## 채팅 예시

```python
import httpx

res = httpx.post("http://localhost:8000/chat", json={
    "message": "오늘 주문 중 생산 불가능한 거 있어?",
    "history": []
})
print(res.json()["answer"])
# → 🔴 IT024/화이트/150: 전사지 재고 없음 (즉시 발주 필요)
# → 🟢 W281/블랙/130: 생산가능 3개 (가능)
```

---

## 구글시트 연결 방법

### 방법 A: Apps Script URL (현재 설정 재사용)
```env
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
```

### 방법 B: Service Account (직접 연결, 권장)
1. Google Cloud Console → 서비스 계정 생성
2. JSON 키 다운로드 → `service_account.json`
3. 구글시트 공유 → 서비스 계정 이메일 편집자로 추가
```env
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json
SPREADSHEET_ID=...
```
