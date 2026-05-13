# 📦 SKILL: 뉴욕꼬맹이 재고관리 AI 에이전트

**버전**: v1.0  
**카테고리**: E-commerce / Inventory Management / AI Agent  
**스택**: Google Apps Script · Vercel · Claude API · Google Sheets  

---

## 🗺 시스템 전체 구조

```
[사방넷 주문서.xlsx]
        ↓ 복사 붙여넣기
[구글시트 4탭]
  ├── 주문확인(원본)  ← 파싱: 제품코드·컬러·사이즈 추출
  ├── 무지상품재고    ← 컬러+사이즈별 수량
  ├── 전사지재고      ← 제품코드별 수량
  └── 완제품재고      ← SKU+컬러+사이즈별 수량
        ↕ Apps Script Web App (REST API)
[Vercel 모바일 앱]
  ├── 재고 입력 (3탭)
  ├── ☁️ 구글시트 동기화
  └── 🤖 AI 분석 채팅
        ↕ Anthropic Claude API
[AI 분석 엔진]
  └── 4탭 데이터 → 생산가능수량 계산 → 병목 탐지 → 발주 추천
```

---

## 🔧 구현된 기능 목록

### A. 구글시트 (Apps Script)

| 함수 | 역할 | 트리거 |
|------|------|--------|
| `setupSheets()` | 4개 탭 자동 생성 | 메뉴 ① |
| `parseOrders()` | 주문서 파싱 (코드·컬러·사이즈) | 메뉴 ② |
| `syncTransferCodes()` | 전사지코드 자동 동기화 | 메뉴 ③ |
| `openDeductSidebar()` | 재고 차감 확인 사이드바 | 메뉴 ④ |
| `getDeductionList()` | 차감 목록 계산 | 사이드바 호출 |
| `executeDeduction()` | 실제 재고 차감 실행 | 사이드바 확인 |
| `doGet(action=getInventory)` | 4탭 전체 데이터 반환 | API |
| `doPost(action=updateInventory)` | 모바일→시트 동기화 수신 | API |
| `callClaudeApi()` | Claude AI 호출 프록시 | 사이드바 |

### B. Vercel 모바일 앱 (HTML/JS)

| 기능 | 설명 |
|------|------|
| 무지상품 재고 입력 | 의류종류·컬러·사이즈·수량 입력 |
| 전사지 재고 입력 | 코드 선택·수량 입력 |
| 완제품 재고 입력 | SKU·컬러·사이즈·수량 입력 |
| 텍스트 일괄입력 | "화이트 120 15개" → 자동 파싱 |
| 구글시트 동기화 | text/plain POST → Apps Script |
| AI 재고 분석 | /api/chat → Claude API 프록시 |

### C. Vercel 서버리스 함수 (api/chat.js)

```
요청 → Apps Script?action=getInventory (4탭 데이터 조회)
     → 시스템 컨텍스트 구성
       (주문현황 + 무지재고 + 전사지재고 + 완제품재고 + 생산가능수량 계산)
     → Claude API 호출
     → 응답 반환
```

---

## 🧠 AI 분석 로직

### 생산가능수량 계산
```
생산가능수량 = MIN(무지상품재고[컬러][사이즈], 전사지재고[코드])

병목 탐지:
- 무지 < 전사지 → 무지병목 (더 심각: 여러 SKU 동시 영향)
- 전사지 < 무지 → 전사지병목
- 어느 쪽이든 0 → 생산불가
```

### 재고 상태 분류
```
🔴 생산불가: 재고 = 0
🔴 긴급:     재고 ≤ 10
🟡 부족:     재고 ≤ 안전재고
🟢 안전:     재고 > 안전재고
```

### 주문 파싱 패턴
```
판매처상품명 → 제품코드 추출 (W281, IT024, TJ071 등)
            → 컬러 추출  (블랙, 화이트, 인디핑크 등)
            → 사이즈 추출 (110, 120, 130, 140, 150 등)

특수케이스:
- (아동)W142 NY반팔/화이트 / 140 → W142, 화이트, 140
- 10_소풍양7부 150 → 10_소풍양7부(실내복코드), 150
- 컬러만 있는 경우 → 노출명(E열)에서 코드 추출
```

---

## 📡 API 설계

### Apps Script Web App 엔드포인트

```
GET  ?action=ping           → 연결 확인
GET  ?action=status         → 4탭 데이터 행 수 반환
GET  ?action=getInventory   → 4탭 전체 데이터 JSON 반환
GET  ?action=setup          → 4탭 자동 생성

POST (body: text/plain JSON)
  action: updateInventory   → 무지·전사지·완제품 재고 업서트
  action: setup             → 시트 초기화
```

> ⚠️ no-cors 환경에서 `Content-Type: text/plain` 사용 필수
> `application/json`은 preflight 요청으로 차단됨

### Vercel API Route

```
POST /api/chat
  body: { messages, appsScriptUrl }
  → GET appsScriptUrl?action=getInventory (서버사이드, CORS 없음)
  → 컨텍스트 구성
  → POST api.anthropic.com/v1/messages
  → { text: 응답 }
```

---

## ⚠️ 핵심 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| 동기화 안 됨 | `Content-Type: application/json` 차단 | `text/plain`으로 변경 |
| AI가 구글시트 못 봄 | Code.gs 재배포 안 함 | 배포 → 새 버전 → 배포 |
| 404 오류 | Vercel Root Directory 미설정 | Settings → General → `nykids-inventory` |
| 접근 차단 | Vercel Authentication 활성화 | Deployment Protection → Disabled |
| 권한 오류 | Apps Script 최초 실행 권한 미승인 | 함수 직접 실행 → 권한 허용 |
| 탭 4개 없음 | setupSheets() 미실행 | 메뉴 ① 또는 🔧 시트초기화 |

---

## 🚀 다음 단계: 에이전트 아키텍처

→ `SKILL_AGENT_DESIGN.md` 참조

---

## 📁 파일 구조

```
nykids-inventory/          ← Vercel 배포 루트
├── index.html             ← 모바일 앱 (재고입력 + AI채팅)
├── vercel.json            ← Vercel 설정
└── api/
    └── chat.js            ← Claude API 프록시

Google Apps Script/
├── Code.gs                ← 메인 로직
├── ChatSidebar.html       ← AI 채팅 사이드바
└── DeductSidebar.html     ← 재고 차감 확인 사이드바
```
