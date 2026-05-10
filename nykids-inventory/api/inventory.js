// api/inventory.js
// 브라우저 → Vercel → Apps Script (CORS 우회)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { url, action = 'getInventory' } = req.query;

  if (!url) {
    return res.status(400).json({ status: 'error', message: 'url 파라미터가 필요합니다' });
  }

  try {
    const appsScriptUrl = `${url}?action=${action}`;
    const response = await fetch(appsScriptUrl, {
      method: 'GET',
      redirect: 'follow',
    });

    const text = await response.text();

    // JSON 파싱 시도
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      return res.status(200).send(text);
    }

  } catch (e) {
    return res.status(500).json({
      status: 'error',
      message: 'Apps Script 연결 실패: ' + e.message,
      hint: 'Apps Script가 "모든 사용자" 권한으로 배포되어 있는지 확인하세요'
    });
  }
}
