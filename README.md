# 뉴욕꼬맹이 재고관리 AI 에이전트 📦

주문 파싱 · 재고 분석 · 생산 가능 계산 · AI 채팅 대시보드

---

## 📊 시스템 개요

```
Google Sheets (4탭) 
    ↓
[sheets.py] 데이터 레이어
    ↓
[agent.py] AI 에이전트 + [tools.py] 도구
    ↓
[main.py] FastAPI 서버 (8개 엔드포인트)
    ├── [scheduler.py] 매일 09:10 자동 리포트 ← [daily_report.py]
    └── [static/dashboard.html] 웹 대시보드
```

---

## 🔧 워크플로우 & 파일 구조

### 1️⃣ **config.py** - 환경변수 설정
```python
class Settings:
    # Anthropic API
    anthropic_api_key      # Claude API 키
    anthropic_model        # "claude-sonnet-4-20250514"
    
    # Google Sheets (선택: Apps Script OR Service Account)
    apps_script_url        # 현재 사용 중
    google_service_account_file
    spreadsheet_id
    
    # 앱 설정
    app_env               # "development" or "production"
    log_level             # "INFO"
    
    # Sheet 이름 (고정)
    sheet_order           # "주문확인(원본)"
    sheet_blank           # "무지상품재고"
    sheet_transfer        # "전사지재고"
    sheet_finished        # "완제품재고"
```

**설정 방법:** `.env` 파일에 환경변수 입력

---

### 2️⃣ **models.py** - 데이터 모델 (Pydantic)
모든 데이터의 타입 정의 및 검증

#### StockStatus (재고 상태)
| 상태 | 코드 | 조건 |
|------|------|------|
| 🔴 생산불가 | `CRITICAL` | 재고 = 0 |
| 🔴 긴급 | `URGENT` | 재고 ≤ 10 |
| 🟡 부족 | `LOW` | 재고 ≤ 안전재고 |
| 🟢 안전 | `SAFE` | 재고 > 안전재고 |
| ⚠️ 없음 | `UNKNOWN` | 시트에 미등록 |

#### 핵심 모델들
- **Order** - 쇼핑몰 주문 (채널, 상품코드, 색상, 사이즈, 수량)
- **BlankStock** - 무지상품 재고 (의류종류, 색상, 사이즈, 재고, 안전재고)
- **TransferStock** - 전사지 재고 (코드, 이름, 색상, 재고)
- **FinishedStock** - 완제품 재고 (SKU, 색상, 사이즈, 재고, 예상 소진일)
- **ProductionResult** - 생산 가능 수량 계산 (주문 vs 재고, 병목 분석)

---

### 3️⃣ **sheets.py** - Google Sheets 데이터 레이어
Google Sheets에서 4개 탭의 데이터를 읽고 업데이트

```python
SheetsClient:
    # 조회 메서드
    .get_orders()                    # 오늘 주문 목록
    .get_blank_stock()               # 무지상품 재고 전체
    .get_transfer_stock()            # 전사지 재고 전체
    .get_finished_stock()            # 완제품 재고 전체
    
    # 업데이트 메서드
    .update_transfer_stock(code, qty)       # 전사지 수량 변경
    .update_finished_stock(sku, qty)        # 완제품 수량 변경
    .deduct_stock(...)                      # 재고 차감 실행
```

**연결 방식:**
- **현재:** Apps Script URL (HTTP 요청)
- **대체:** gspread + Service Account (직접 연결)

---

### 4️⃣ **models.py** (계속) - ChatRequest/ChatResponse
AI 에이전트와의 대화 인터페이스

```python
ChatRequest:
    message: str                # 사용자 메시지
    history: list[dict]         # 대화 히스토리
    confirmed: bool             # 재고 차감 확인 여부

ChatResponse:
    answer: str                 # AI 응답
    tool_calls: list[str]       # 실행된 도구 목록
    data: Optional[dict]        # 추가 데이터
```

---

### 5️⃣ **tools.py** - AI 도구 정의
Claude가 사용할 수 있는 도구들 정의

**아마도 포함될 도구들:**
- `get_inventory()` - 전체 재고 현황
- `calculate_production(order)` - 생산 가능 수량 계산
- `check_shortage_alert()` - 부족 알림 확인
- `deduct_stock(...)` - 재고 차감 시뮬레이션/실행
- `get_daily_report()` - 일일 리포트 생성

---

### 6️⃣ **agent.py** - LangChain AI 에이전트
Claude와 도구들을 통합하는 에이전트

```python
Agent:
    def __init__(self, tools):
        # Claude Sonnet 4 + tools 초기화
        # 기억 시스템 없음 (stateless)
    
    def chat(message: str, history: list[dict]):
        # 메시지 + 히스토리로 응답 생성
        # 자동으로 필요한 도구 선택해서 실행
        return {
            "answer": "응답 텍스트",
            "tool_calls": ["tool1", "tool2"]
        }
```

**특징:**
- 사용자 질문을 이해하고 필요한 도구 자율 선택
- 예: "오늘 생산불가 상품 있어?" → `calculate_production()` 자동 실행
- 재고 차감은 2단계 (시뮬레이션 → 확인)

---

### 7️⃣ **daily_report.py** - 일일 리포트 생성
매일 09:10 자동 전송되는 요약 리포트

```python
generate_daily_report() -> str:
    # 3가지 섹션으로 구성
    
    # 1️⃣ 원단 발주 필요
    # 무지상품 부족 항목만 표시
    # 예: "P016 블랙 130 → 무지 부족"
    
    # 2️⃣ 전사지 인쇄 대기
    # 계산식: 주문량 - 완제품 = 전사지 인쇄 수량
    
    # 3️⃣ 배송 일정
    # 쿠팡로켓 배송 일자별 건수
```

**전송 방식:**
- 텍스트 형식으로 생성 → 콘솔 출력/로그
- 사용자가 복사해서 대표님/카톡에 직접 전송
- 향후: 이메일/문자/Slack 자동 전송 가능

---

### 8️⃣ **scheduler.py** - 매일 09:10 자동 실행
APScheduler를 사용한 백그라운드 작업

```python
init_scheduler():
    # 매일 09:10 (한국 시간)에 daily_report 생성
    # FastAPI 앱 시작 시 자동 호출
    
stop_scheduler():
    # 앱 종료 시 자동 호출

get_report_now():
    # 테스트용: 지금 바로 리포트 생성
```

---

### 9️⃣ **main.py** - FastAPI 백엔드 서버
모든 기능을 API 엔드포인트로 제공

#### 앱 수명주기 (lifespan)
```
서버 시작
    ├── Google Sheets 클라이언트 초기화
    ├── AI 에이전트 초기화
    └── 스케줄러 시작 (매일 09:10 자동 리포트)

서버 종료
    └── 스케줄러 정지
```

#### API 엔드포인트 (8개)

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/` | GET | 서버 상태 + 엔드포인트 목록 |
| `/health` | GET | 헬스 체크 |
| `/dashboard` | GET | 웹 대시보드 (HTML) |
| **조회** | | |
| `/inventory` | GET | 4탭 전체 재고 현황 |
| `/orders` | GET | 오늘 주문 목록 |
| `/production` | GET | 생산가능수량 계산 |
| `/alerts` | GET | 재고 부족 알림 |
| `/daily-report` | GET | 일일 요약 리포트 |
| `/chat` | POST | AI 채팅 (메시지 + 도구) |
| **수정** | | |
| `/update-transfer` | POST | 전사지 수량 업데이트 |
| `/update-finished` | POST | 완제품 수량 업데이트 |
| **차감** | | |
| `/deduct/simulate` | POST | 재고 차감 시뮬레이션 |
| `/deduct/execute` | POST | 재고 차감 실행 (confirmed=true 필수) |

**예시 요청:**
```bash
# 조회
curl http://localhost:8000/inventory
curl http://localhost:8000/orders
curl http://localhost:8000/production

# AI 채팅
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "오늘 주문 중 생산불가 있어?", "history": []}'

# 재고 차감
curl -X POST http://localhost:8000/deduct/simulate
curl -X POST http://localhost:8000/deduct/execute?confirmed=true
```

#### CORS 설정
```python
allow_origins = ["*"]
allow_methods = ["*"]
allow_headers = ["*"]
```
→ 모든 도메인에서 API 접근 가능 (대시보드용)

---

### 🔟 **static/dashboard.html** - 웹 대시보드
FastAPI에서 서빙되는 정적 HTML/CSS/JS

**접속:** `http://localhost:8000/dashboard`

**기능:**
- 📊 실시간 재고 현황 (색상으로 상태 표시)
- 📦 오늘 주문 목록
- ⚠️ 부족 알림
- 💬 AI 채팅 인터페이스

---

## 🚀 실행 방법

### 1. 환경 설정
```bash
# .env 파일 생성
ANTHROPIC_API_KEY=sk-ant-...
APPS_SCRIPT_URL=https://script.google.com/macros/d/.../useless?...
SPREADSHEET_ID=1A2B3C4D5E6F...
APP_ENV=development
LOG_LEVEL=INFO
```

### 2. 패키지 설치
```bash
pip install -r requirements.txt
```

### 3. 서버 실행
```bash
python main.py
# 또는 (자동 리로드)
uvicorn main:app --reload
```

### 4. 접속
- **API 문서:** `http://localhost:8000/docs` (Swagger UI)
- **대시보드:** `http://localhost:8000/dashboard`
- **API 테스트:** `http://localhost:8000/`

---

## 📱 주요 사용 시나리오

### 📋 매일 아침 09:10
```
자동으로 일일 리포트 생성
    ↓
사용자에게 텍스트로 전달
    ↓
사용자가 복사 → 대표님/카톡에 붙여넣기
```

**리포트 내용:**
1. 🟥 원단 발주 필요 (무지상품 부족)
2. 📦 전사지 인쇄 대기 (주문 - 완제품 = 인쇄량)
3. ⏰ 배송 일정 (쿠팡로켓 일자별 건수)

---

### 💬 AI 채팅으로 재고 관리
```
사용자: "오늘 주문 중 생산 불가능한 거 있어?"
    ↓
에이전트: 자동으로 주문 조회 + 무지/전사지 재고 확인
    ↓
응답: "W281 블랙 130은 무지부족으로 5개 생산불가입니다"
```

**가능한 질문들:**
- "무지상품 부족한 것 알려줘"
- "W281 생산 가능 수량이 몇 개야?"
- "재고 차감 시뮬레이션 해줘"
- "완제품 부족 항목은?"
- "배송 예정은 언제야?"

---

### 📊 웹 대시보드
- 실시간 재고 현황 (색상 코딩)
- 부족 알림 (🔴 긴급)
- 오늘 주문 현황
- AI 채팅 (현장에서 바로 질문)

---

## 🔄 데이터 흐름도

```
┌─────────────────────────────────────────────────────────────┐
│         Google Sheets (4탭)                                 │
│  ┌──────────────┬──────────────┬──────────────┬─────────┐  │
│  │ 주문확인(원본)│ 무지상품재고 │ 전사지재고   │ 완제품  │  │
│  └──────────────┴──────────────┴──────────────┴─────────┘  │
└─────────────────────┬──────────────────────────────────────┘
                      │
        ┌─────────────▼──────────────┐
        │   sheets.py (Data Layer)   │
        │  - get_orders()            │
        │  - get_blank_stock()       │
        │  - get_transfer_stock()    │
        │  - get_finished_stock()    │
        │  - update_*_stock()        │
        └─────────────┬──────────────┘
                      │
        ┌─────────────▼──────────────────────┐
        │   agent.py (AI Agent)              │
        │   ┌──────────────────────────────┐ │
        │   │ Claude Sonnet 4              │ │
        │   │ + tools (도구 모음)           │ │
        │   └──────────────────────────────┘ │
        └─────────────┬──────────────────────┘
                      │
    ┌─────────────────┼─────────────────┬──────────────┐
    │                 │                 │              │
    ▼                 ▼                 ▼              ▼
┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐
│ main.py    │  │ scheduler.py │  │ daily_report │  │ static/    │
│ (API 8개)  │  │ (매일 09:10) │  │ .py (생성)   │  │ dashboard  │
└────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────────┘
     │                  │                 │
     └──────────────────┼─────────────────┘
                        │
              ┌─────────▼──────────┐
              │  사용자             │
              │  ├── 웹 대시보드    │
              │  ├── AI 채팅        │
              │  └── 일일 리포트    │
              └────────────────────┘
```

---

## 🛠️ 개발 & 유지보수

### 테스트용 명령어
```bash
# 지금 바로 리포트 생성
curl http://localhost:8000/daily-report

# 인벤토리 확인
curl http://localhost:8000/inventory | jq

# AI 채팅 테스트
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "오늘 주문 뭐야?", "history": []}'
```

### 로그 확인
```bash
# 서버 로그에서:
# ✅ 구글시트 연결 완료
# ✅ AI 에이전트 초기화 완료
# ✅ 일일 리포트 스케줄러 시작 (매일 09:10)
# ✅ 일일 리포트 생성 및 전송 완료
```

### 배포 (Docker)
```bash
# Dockerfile로 이미지 빌드
docker build -t nykids-agent .
docker run -d \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e APPS_SCRIPT_URL=https://... \
  -e SPREADSHEET_ID=... \
  -p 8000:8000 \
  nykids-agent
```

---

## 📝 파일 요약

| 파일 | 역할 | 의존성 |
|------|------|--------|
| `config.py` | 환경변수 관리 | pydantic |
| `models.py` | 데이터 타입 정의 | pydantic |
| `sheets.py` | Google Sheets 연동 | gspread/httpx |
| `tools.py` | AI 도구 정의 | sheets.py |
| `agent.py` | LangChain 에이전트 | anthropic, tools.py |
| `daily_report.py` | 일일 리포트 생성 | sheets.py |
| `scheduler.py` | 스케줄러 | apscheduler, daily_report.py |
| `main.py` | FastAPI 서버 | fastapi, agent.py, scheduler.py |
| `static/dashboard.html` | 웹 UI | main.py (API) |

---

## ❓ FAQ

### Q: 대시보드를 보려면 Python을 반드시 실행해야 하나요?
**A:** 네. FastAPI 백엔드가 `/inventory`, `/orders` 등의 API를 제공하므로 Python 서버가 필수입니다.

### Q: 일일 리포트는 언제 자동 생성되나요?
**A:** 매일 **09:10** (한국 시간)에 자동 생성됩니다. 스케줄러가 백그라운드에서 실행 중입니다.

### Q: AI 에이전트가 실행할 수 있는 도구는?
**A:** tools.py에 정의된 도구들을 자동으로 선택 실행합니다. 재고 조회, 생산가능 계산, 차감 등.

### Q: 재고 차감은 어떻게 이루어지나요?
**A:** 2단계 프로세스:
1. `/deduct/simulate` - 시뮬레이션 (실제 차감 X)
2. `/deduct/execute?confirmed=true` - 실제 차감 (확인 필수)

### Q: Google Sheets 외에 다른 소스를 사용할 수 있나요?
**A:** 현재는 Google Sheets만 지원. `sheets.py`를 수정하면 다른 DB 연동 가능.

---

**최종 업데이트:** 2026-05-16
