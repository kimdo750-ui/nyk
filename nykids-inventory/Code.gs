// ============================================================
// 뉴욕꼬맹이 재고관리 시스템 - Google Apps Script v2
// ============================================================
// [필수 순서]
// 1. 구글 시트 열기 → 확장 프로그램 → Apps Script
// 2. 이 파일 전체 붙여넣기 → 저장(Ctrl+S)
// 3. ChatSidebar.html 추가 → 저장
// 4. [배포] → 새 배포 → 웹앱 → 액세스: 모든 사용자 → 배포
// 5. 배포 URL을 모바일 앱 ⚙️에 입력
// 6. 모바일 앱 [🔧 시트 초기화] 클릭 → 4개 탭 자동 생성
// ============================================================

const SHEET_NAMES = {
  ORDER:    '주문확인(원본)',
  BLANK:    '무지상품재고',
  TRANSFER: '전사지재고',
  FINISHED: '완제품재고',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 재고관리')
    .addItem('① 시트 초기 설정 (필수!)', 'setupSheets')
    .addSeparator()
    .addItem('② 주문서 파싱 실행', 'parseOrders')
    .addItem('③ 전사지코드 자동 동기화', 'syncTransferCodes')
    .addSeparator()
    .addItem('🤖 AI 재고 분석 채팅', 'openChatSidebar')
    .addSeparator()
    .addItem('⚙️ Anthropic API 키 설정', 'setApiKey')
    .addToUi();
}

function setApiKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('API 키 설정','sk-ant-... 입력:',ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton()===ui.Button.OK) {
    PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY',r.getResponseText().trim());
    ui.alert('✅ 저장 완료');
  }
}

// ── 4개 시트 초기화 (메뉴에서 수동 실행용) ──
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _ensureAllSheets(ss);
  ['시트1','Sheet1','재고카운팅'].forEach(n=>{
    const s=ss.getSheetByName(n);
    if(s&&ss.getSheets().length>1){try{ss.deleteSheet(s);}catch(e){}}
  });
  SpreadsheetApp.getUi().alert(
    '✅ 시트 초기 설정 완료!\n\n4개 탭 생성됨:\n①주문확인(원본)\n②무지상품재고\n③전사지재고\n④완제품재고\n\n이제 모바일앱에서 재고를 입력하세요!'
  );
}

// ── 시트 존재 확인 후 없으면 생성 ──
function _ensureAllSheets(ss) {
  if(!ss.getSheetByName(SHEET_NAMES.ORDER))    _setupOrderSheet(ss);
  if(!ss.getSheetByName(SHEET_NAMES.BLANK))    _setupBlankSheet(ss);
  if(!ss.getSheetByName(SHEET_NAMES.TRANSFER)) _setupTransferSheet(ss);
  if(!ss.getSheetByName(SHEET_NAMES.FINISHED)) _setupFinishedSheet(ss);
}

function _setupOrderSheet(ss) {
  const sh = ss.insertSheet(SHEET_NAMES.ORDER,0);
  const h=['쇼핑몰명','수령자','판매처상품명','쿠팡옵션명','노출명','수량','','제품코드','컬러','사이즈','파싱수량','파싱상태'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _styleHeader(sh,h.length);
  [90,105,270,90,300,45,30,90,75,60,60,75].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.getRange('G1').setBackground('#cccccc').setValue('│');
  sh.setFrozenRows(1);
  sh.getRange('A1').setNote('A~F: 원본 붙여넣기 | H~L: 자동 파싱');
}

function _setupBlankSheet(ss) {
  const sh=ss.insertSheet(SHEET_NAMES.BLANK);
  const h=['의류종류','컬러','사이즈','현재재고','안전재고','상태','최종수정일','비고'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _styleHeader(sh,h.length);
  [75,75,60,75,75,90,120,150].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.setFrozenRows(1);
  sh.getRange(2,1,1,5).setValues([['반팔티','화이트','130',0,30]]);
  sh.getRange('F2').setFormula('=IF(D2="","",IF(D2=0,"🔴 생산불가",IF(D2<=10,"🔴 긴급",IF(D2<=E2,"🟡 부족","🟢 안전"))))');
  sh.getRange('G2').setFormula('=IF(D2<>"",TEXT(NOW(),"yyyy-mm-dd hh:mm"),"")');
}

function _setupTransferSheet(ss) {
  const sh=ss.insertSheet(SHEET_NAMES.TRANSFER);
  const h=['전사지코드','전사지명','현재재고','안전재고','상태','최종수정일','비고'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _styleHeader(sh,h.length);
  [90,180,75,75,90,120,150].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.setFrozenRows(1);
  sh.getRange(2,1,1,4).setValues([['W281','패밀리맨투맨 W281',0,20]]);
  sh.getRange('E2').setFormula('=IF(C2="","",IF(C2=0,"🔴 생산불가",IF(C2<=10,"🔴 긴급",IF(C2<=D2,"🟡 부족","🟢 안전"))))');
}

function _setupFinishedSheet(ss) {
  const sh=ss.insertSheet(SHEET_NAMES.FINISHED);
  const h=['완제품SKU','컬러','사이즈','완제품재고','일평균판매량','예상소진일','비고'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _styleHeader(sh,h.length);
  [90,75,60,90,90,90,150].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.setFrozenRows(1);
  sh.getRange(2,1,1,5).setValues([['W281','화이트','130',0,3]]);
  sh.getRange('F2').setFormula('=IF(OR(D2="",E2="",E2=0),"",IF(D2=0,"재고없음",ROUND(D2/E2,0)&"일"))');
}

function _styleHeader(sh,n) {
  sh.getRange(1,1,1,n).setBackground('#1a1814').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  try{sh.setRowHeight(1,30);}catch(e){}
}

// ── 주문서 파싱 ──
function parseOrders() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  _ensureAllSheets(ss);
  const sh=ss.getSheetByName(SHEET_NAMES.ORDER);
  const lastRow=sh.getLastRow();
  if(lastRow<2){SpreadsheetApp.getUi().alert('A2부터 주문 데이터를 붙여넣으세요.');return;}
  const data=sh.getRange(2,1,lastRow-1,6).getValues();
  let ok=0,warn=0;
  data.forEach((row,i)=>{
    const pname=String(row[2]||'').trim(),ename=String(row[4]||'').trim();
    if(!pname)return;
    const res=_parseProductName(pname,ename);
    sh.getRange(i+2,8,1,5).setValues([[res.code,res.color,res.size,row[5]||1,res.status]]);
    sh.getRange(i+2,1,1,12).setBackground(res.status==='✅ 완료'?'#f0fff4':res.status==='⚠️ 수동확인'?'#fffde7':'#fff8f5');
    res.status==='✅ 완료'?ok++:warn++;
  });
  SpreadsheetApp.getActiveSpreadsheet().toast(`파싱 완료: ${ok}건 완료, ${warn}건 수동확인 필요`,'✅',4);
}

function _parseProductName(pname,ename) {
  const CODE_RE=/\b([A-Z]{1,4}\d{2,4})\b/g;
  const SIZE_RE=/\b(70|80|90|100|110|120|130|140|150|160|170|180|S|M|L|XL)\b/g;
  const COLOR_RE=/(블랙|화이트|그레이|네이비|베이지|카멜|레드|핑크|민트|카키|옐로우|바이올렛|스틸블루|인디핑크|네온핑크|그린|오렌지|스카이블루|아이보리|백멜란지|멜란지|청록|파랑|one\s?color)/g;
  const codesE=[...ename.matchAll(CODE_RE)].map(m=>m[1]);
  const codesP=[...pname.replace(/[()아동성인]/g,'').matchAll(CODE_RE)].map(m=>m[1]);
  let code=codesE[0]||codesP[0]||'';
  const sil=pname.match(/(\d+_[\w가-힣]+(?:7부|9부))/);
  if(sil)code=sil[1];
  const sizes=[...pname.matchAll(SIZE_RE)].map(m=>m[1]);
  const colors=[...pname.matchAll(COLOR_RE)].map(m=>m[1]);
  const status=(!code||pname.includes('베개'))?'⚠️ 수동확인':'✅ 완료';
  return{code,color:colors[0]||'',size:sizes[sizes.length-1]||'',status};
}

function syncTransferCodes() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  _ensureAllSheets(ss);
  const orderSh=ss.getSheetByName(SHEET_NAMES.ORDER);
  const transSh=ss.getSheetByName(SHEET_NAMES.TRANSFER);
  const last=orderSh.getLastRow();
  if(last<2)return;
  const codes=orderSh.getRange(2,8,last-1,1).getValues()
    .map(r=>String(r[0]).trim()).filter(c=>c&&!/[가-힣]/.test(c));
  const unique=[...new Set(codes)].sort();
  const tLast=transSh.getLastRow();
  const existing=tLast>1?transSh.getRange(2,1,tLast-1,1).getValues().map(r=>String(r[0]).trim()):[];
  let added=0;
  unique.forEach(c=>{
    if(!existing.includes(c)){
      const rn=transSh.getLastRow()+1;
      transSh.getRange(rn,1,1,4).setValues([[c,'',0,20]]);
      transSh.getRange(rn,5).setFormula(`=IF(C${rn}="","",IF(C${rn}=0,"🔴 생산불가",IF(C${rn}<=10,"🔴 긴급",IF(C${rn}<=D${rn},"🟡 부족","🟢 안전"))))`);
      added++;
    }
  });
  SpreadsheetApp.getActiveSpreadsheet().toast(`동기화 완료. 신규 ${added}건 추가`,'✅',3);
}

function openChatSidebar() {
  const html=HtmlService.createHtmlOutputFromFile('ChatSidebar').setTitle('🤖 재고 AI').setWidth(380);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getInventoryContext() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let ctx=`[뉴욕꼬맹이 재고현황 - ${Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm')}]\n\n`;
  const read=(name,cols,head)=>{
    try{
      const sh=ss.getSheetByName(name);
      if(!sh||sh.getLastRow()<2)return;
      const data=sh.getRange(2,1,sh.getLastRow()-1,cols).getValues();
      ctx+=`## ${head}\n`;
      data.filter(r=>r[0]).forEach(r=>{ctx+='  '+r.slice(0,cols).join(' | ')+'\n';});
      ctx+='\n';
    }catch(e){}
  };
  read(SHEET_NAMES.ORDER,12,'📋 주문');
  read(SHEET_NAMES.BLANK,7,'🧵 무지상품재고');
  read(SHEET_NAMES.TRANSFER,6,'🖨️ 전사지재고');
  read(SHEET_NAMES.FINISHED,7,'📦 완제품재고');
  return ctx;
}

function callClaudeApi(userMessage,conversationHistory) {
  const apiKey=PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if(!apiKey)return{error:'API 키 없음. 메뉴 > ⚙️ API키 설정'};
  const system=`너는 뉴욕꼬맹이 커스텀 유아복 재고 분석 AI다.\n${getInventoryContext()}\n생산가능=MIN(무지재고,전사지재고). 한국어로 핵심만.`;
  try{
    const res=UrlFetchApp.fetch('https://api.anthropic.com/v1/messages',{
      method:'post',contentType:'application/json',muteHttpExceptions:true,
      headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      payload:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system,messages:[...conversationHistory,{role:'user',content:userMessage}]})
    });
    const j=JSON.parse(res.getContentText());
    return j.error?{error:j.error.message}:{text:j.content[0].text};
  }catch(e){return{error:e.message};}
}

function getScriptProperty(key){return PropertiesService.getScriptProperties().getProperty(key);}

// ════════════════════════════════════════════════════════
// doGet: 연결 테스트 & 상태 확인
// ════════════════════════════════════════════════════════
function doGet(e) {
  const action=(e&&e.parameter&&e.parameter.action)||'ping';
  const ss=SpreadsheetApp.getActiveSpreadsheet();

  if(action==='setup'){
    _ensureAllSheets(ss);
    ['시트1','Sheet1','재고카운팅'].forEach(n=>{
      const s=ss.getSheetByName(n);
      if(s&&ss.getSheets().length>1){try{ss.deleteSheet(s);}catch(er){}}
    });
    return _json({status:'ok',message:'4개 시트 생성 완료',sheets:Object.values(SHEET_NAMES)});
  }

  if(action==='status'){
    const info={};
    Object.entries(SHEET_NAMES).forEach(([k,name])=>{
      const sh=ss.getSheetByName(name);
      info[name]=sh?(sh.getLastRow()-1)+'행':'없음 ❌';
    });
    return _json({status:'ok',sheets:info});
  }

  return _json({status:'ok',message:'뉴욕꼬맹이 재고관리 연결됨 ✅',version:'2.0',sheets:Object.values(SHEET_NAMES)});
}

// ════════════════════════════════════════════════════════
// doPost: 모바일앱 → 구글시트 동기화
// Content-Type: text/plain으로 받아서 JSON.parse 처리
// ════════════════════════════════════════════════════════
function doPost(e) {
  try {
    // text/plain 또는 application/json 모두 처리
    const raw = e.postData ? e.postData.contents : '';
    if (!raw) return _json({status:'error', message:'body가 비어있습니다. Content-Type: text/plain 으로 전송하세요'});

    const data = JSON.parse(raw);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    _ensureAllSheets(ss);

    if (data.action === 'setup') {
      ['시트1','Sheet1','재고카운팅'].forEach(n => {
        const s = ss.getSheetByName(n);
        if (s && ss.getSheets().length > 1) { try { ss.deleteSheet(s); } catch(er) {} }
      });
      return _json({status:'ok', message:'시트 초기화 완료', sheets:Object.values(SHEET_NAMES)});
    }

    const res = {blank:0, transfer:0, finished:0};
    if (data.blank    && data.blank.length)    res.blank    = _upsertBlank(ss, data.blank);
    if (data.transfer && data.transfer.length) res.transfer = _upsertTransfer(ss, data.transfer);
    if (data.finished && data.finished.length) res.finished = _upsertFinished(ss, data.finished);

    return _json({status:'ok', updated:res, timestamp:new Date().toISOString()});

  } catch(err) {
    return _json({status:'error', message:err.message, hint:'JSON.parse 실패 시 body 형식을 확인하세요'});
  }
}

function _upsertBlank(ss,items) {
  const sh=ss.getSheetByName(SHEET_NAMES.BLANK);
  const last=sh.getLastRow();
  const ex=last>1?sh.getRange(2,1,last-1,5).getValues():[];
  let n=0;
  items.forEach(item=>{
    const idx=ex.findIndex(r=>String(r[0])===String(item.garment||'')&&String(r[1])===String(item.color||'')&&String(r[2])===String(item.size||''));
    const now=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
    if(idx>=0){sh.getRange(idx+2,4).setValue(item.qty);sh.getRange(idx+2,7).setValue(now);ex[idx][3]=item.qty;}
    else{
      const rn=sh.getLastRow()+1;
      sh.getRange(rn,1,1,5).setValues([[item.garment||'',item.color||'',item.size||'',item.qty,30]]);
      sh.getRange(rn,6).setFormula(`=IF(D${rn}="","",IF(D${rn}=0,"🔴 생산불가",IF(D${rn}<=10,"🔴 긴급",IF(D${rn}<=E${rn},"🟡 부족","🟢 안전"))))`);
      sh.getRange(rn,7).setValue(now);
      ex.push([item.garment||'',item.color||'',item.size||'',item.qty,30]);
    }
    n++;
  });
  return n;
}

function _upsertTransfer(ss,items) {
  const sh=ss.getSheetByName(SHEET_NAMES.TRANSFER);
  const last=sh.getLastRow();
  const ex=last>1?sh.getRange(2,1,last-1,3).getValues():[];
  let n=0;
  items.forEach(item=>{
    const idx=ex.findIndex(r=>String(r[0])===String(item.code||''));
    if(idx>=0){sh.getRange(idx+2,3).setValue(item.qty);ex[idx][2]=item.qty;}
    else{
      const rn=sh.getLastRow()+1;
      sh.getRange(rn,1,1,4).setValues([[item.code||'','',item.qty,20]]);
      sh.getRange(rn,5).setFormula(`=IF(C${rn}="","",IF(C${rn}=0,"🔴 생산불가",IF(C${rn}<=10,"🔴 긴급",IF(C${rn}<=D${rn},"🟡 부족","🟢 안전"))))`);
      ex.push([item.code||'','',item.qty,20]);
    }
    n++;
  });
  return n;
}

function _upsertFinished(ss,items) {
  const sh=ss.getSheetByName(SHEET_NAMES.FINISHED);
  const last=sh.getLastRow();
  const ex=last>1?sh.getRange(2,1,last-1,4).getValues():[];
  let n=0;
  items.forEach(item=>{
    const idx=ex.findIndex(r=>String(r[0])===String(item.code||'')&&String(r[1])===String(item.color||'')&&String(r[2])===String(item.size||''));
    if(idx>=0){sh.getRange(idx+2,4).setValue(item.qty);ex[idx][3]=item.qty;}
    else{
      const rn=sh.getLastRow()+1;
      sh.getRange(rn,1,1,4).setValues([[item.code||'',item.color||'',item.size||'',item.qty]]);
      sh.getRange(rn,6).setFormula(`=IF(OR(D${rn}="",E${rn}="",E${rn}=0),"",IF(D${rn}=0,"재고없음",ROUND(D${rn}/E${rn},0)&"일"))`);
      ex.push([item.code||'',item.color||'',item.size||'',item.qty]);
    }
    n++;
  });
  return n;
}

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
