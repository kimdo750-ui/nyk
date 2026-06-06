export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Vercel 환경변수에 ANTHROPIC_API_KEY가 없습니다' });

  const { messages, appsScriptUrl } = req.body;

  // ── 1. 구글시트 4개 탭 전체 데이터 가져오기 ──
  let sheetData = null;
  if (appsScriptUrl) {
    try {
      const sheetRes = await fetch(appsScriptUrl + '?action=getInventory', {
        method: 'GET', redirect: 'follow',
      });
      const json = await sheetRes.json();
      if (json.status === 'ok') sheetData = json.data;
    } catch (e) { console.log('구글시트 조회 실패:', e.message); }
  }

  // ── 2. 시스템 컨텍스트 구성 ──
  let ctx = `너는 뉴욕꼬맹이 커스텀 유아복 브랜드의 재고 분석 AI다.
분석 원칙:
- 생산가능수량 = MIN(무지상품재고, 전사지재고)
- 재고 0=생산불가 / 1~10=긴급 / 안전재고이하=부족
- 무지상품 부족이 우선순위 높음 (여러 SKU 동시 영향)
- 한국어로, 숫자 구체적으로, 핵심부터 간결하게\n\n`;

  if (sheetData) {
    const today = new Date().toLocaleDateString('ko-KR');
    ctx += `[기준일: ${today}]\n\n`;

    // 주문확인(원본)
    if (sheetData.orders?.length > 0) {
      ctx += `## 오늘 주문 (${sheetData.orders.length}건)\n채널|코드|컬러|사이즈|수량|상태\n`;
      sheetData.orders.forEach(o => { ctx += `${o.channel}|${o.code}|${o.color}|${o.size}|${o.qty}개|${o.status}\n`; });
      // 코드별 집계
      const sum = {};
      sheetData.orders.forEach(o => {
        const k = `${o.code}/${o.color}/${o.size}`;
        sum[k] = (sum[k]||0) + Number(o.qty);
      });
      ctx += `\n[주문 집계]\n`;
      Object.entries(sum).forEach(([k,v]) => { ctx += `${k}: 총 ${v}개\n`; });
      ctx += '\n';
    } else { ctx += `## 주문: 없음\n\n`; }

    // 무지상품
    if (sheetData.blank?.length > 0) {
      ctx += `## 무지상품재고 (${sheetData.blank.length}종)\n의류|컬러|사이즈|재고|안전재고|상태\n`;
      sheetData.blank.forEach(b => { ctx += `${b.garment}|${b.color}|${b.size}|${b.stock}개|${b.safeStock}개|${b.status}\n`; });
      ctx += '\n';
    } else { ctx += `## 무지상품: 없음\n\n`; }

    // 전사지
    if (sheetData.transfer?.length > 0) {
      ctx += `## 전사지재고 (${sheetData.transfer.length}종)\n코드|이름|재고|안전재고|상태\n`;
      sheetData.transfer.forEach(t => { ctx += `${t.code}|${t.name}|${t.stock}매|${t.safeStock}매|${t.status}\n`; });
      ctx += '\n';
    } else { ctx += `## 전사지: 없음\n\n`; }

    // 완제품
    if (sheetData.finished?.length > 0) {
      ctx += `## 완제품재고 (${sheetData.finished.length}종)\nSKU|컬러|사이즈|재고|일판매|소진\n`;
      sheetData.finished.forEach(f => { ctx += `${f.sku}|${f.color}|${f.size}|${f.stock}개|${f.dailySales}|${f.runout}\n`; });
      ctx += '\n';
    } else { ctx += `## 완제품: 없음\n\n`; }

    // 생산가능수량 자동 계산
    if (sheetData.transfer?.length > 0 && sheetData.blank?.length > 0 && sheetData.finished?.length > 0) {
      ctx += `## 생산가능수량 계산 (MIN(무지,전사지))\nSKU/컬러/사이즈|무지|전사지|생산가능|상태\n`;
      sheetData.finished.forEach(f => {
        const t = sheetData.transfer.find(x => x.code === f.sku);
        const b = sheetData.blank.find(x => x.color === f.color && x.size === f.size);
        const ts = t ? Number(t.stock) : 0;
        const bs = b ? Number(b.stock) : 0;
        const can = Math.min(ts, bs);
        const bn = !t ? '전사지없음' : !b ? '무지없음' : ts<=bs ? '전사지병목' : '무지병목';
        const st = can===0 ? '🔴생산불가' : can<=10 ? '🟠긴급' : can<=30 ? '🟡주의' : '🟢가능';
        ctx += `${f.sku}/${f.color}/${f.size}|${bs}개|${ts}매|${can}개|${st}[${bn}]\n`;
      });
      ctx += '\n';
    }

  } else {
    ctx += `※ 구글시트 연결 안됨. ⚙️ 설정에서 Apps Script URL 확인 필요.\n앱에 직접 입력된 재고 데이터만 참고 가능합니다.\n\n`;
  }

  // ── 3. Claude 호출 ──
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: ctx,
        messages,
      }),
    });
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    return res.json({ text: data.content[0].text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
