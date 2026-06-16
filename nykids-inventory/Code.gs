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
    .addItem('④ 주문 기반 재고 차감 확인', 'openDeductSidebar')
    .addSeparator()
    .addItem('📊 요약 대시보드 생성', 'generateDashboard')
    .addItem('🔍 주문→완제품 매칭 확인', 'matchOrdersWithFinished')
    .addItem('🖨️ 전사지 필요수량 계산', 'calculateTransferNeeds')
    .addSeparator()
    .addItem('🖨️ 인쇄용 무지상품 양식 생성', 'generatePrintSheet')
    .addItem('📋 전사지 출력목록 생성', 'generateTransferPrintList')
    .addSeparator()
    .addItem('📋 히스토리 기록', 'recordBackupHistory')
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

// ── 의류 이름 정규화 (NT반팔티셔츠 → NY반팔) ──
function normalizeGarmentNames() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAMES.BLANK);
  if(!sh || sh.getLastRow() < 2) return;

  const data = sh.getRange(2, 1, sh.getLastRow()-1, 1).getValues();
  data.forEach((r, i) => {
    const garment = String(r[0]).trim();
    if(garment === 'NT반팔티셔츠' || garment === 'NY반팔티셔츠') {
      sh.getRange(i+2, 1).setValue('NY반팔');
    }
  });
}

// ── 인쇄용 무지상품 양식 생성 (디즈니, NY, 통합) ──
function generatePrintSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const srcSh = ss.getSheetByName(SHEET_NAMES.BLANK);

  if(!srcSh || srcSh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('❌ 무지상품재고 탭에 데이터가 없습니다');
    return;
  }

  normalizeGarmentNames();

  const PRINT_SHEET = '인쇄용_무지상품';
  let printSh = ss.getSheetByName(PRINT_SHEET);
  if(printSh) ss.deleteSheet(printSh);
  printSh = ss.insertSheet(PRINT_SHEET);

  const data = srcSh.getRange(2, 1, srcSh.getLastRow()-1, 5).getValues();
  const SIZES = ['110','120','130','140','150','160','170'];

  // 브랜드별 + 색상별 데이터 정리
  const brandColorSizeData = {};
  data.forEach(r => {
    const brand = String(r[0]||'').trim();
    const color = String(r[1]||'').trim();
    const size = String(r[2]||'').trim();
    const stock = r[3] || 0;

    if(!color || !size || !brand) return;

    if(!brandColorSizeData[brand]) brandColorSizeData[brand] = {};
    if(!brandColorSizeData[brand][color]) brandColorSizeData[brand][color] = {};
    brandColorSizeData[brand][color][size] = stock;
  });

  // 날짜
  const today = Utilities.formatDate(new Date(),'Asia/Seoul','yyyy/M/d');
  printSh.getRange('A1').setValue(today).setFontSize(14).setFontWeight('bold');

  let currentRow = 3;

  // 헬퍼 함수: 색상별 사이즈 표 생성
  const createBrandTable = (brand, brandData) => {
    const colors = Object.keys(brandData).sort();
    if(colors.length === 0) return currentRow;

    // 브랜드 헤더
    printSh.getRange(currentRow, 1).setValue(`📦 ${brand}`).setFontWeight('bold').setFontSize(13).setBackground('#f0f0f0');
    currentRow++;

    // 사이즈 헤더
    const header = ['색상', ...SIZES];
    printSh.getRange(currentRow, 1, 1, header.length).setValues([header])
      .setBackground('#1a1814').setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
    currentRow++;

    // 색상별 데이터
    colors.forEach(color => {
      const sizeData = brandData[color];
      const dataRow = [color, ...SIZES.map(sz => sizeData[sz] || 0)];
      printSh.getRange(currentRow, 1, 1, dataRow.length).setValues([dataRow]);

      // 5 이하 모두 빨간색 (0 포함)
      for(let col = 2; col <= SIZES.length + 1; col++) {
        if(dataRow[col-1] <= 5) {
          printSh.getRange(currentRow, col).setBackground('#ffcccc');
        }
      }
      currentRow++;
    });

    currentRow++; // 섹션 간 공백
    return currentRow;
  };

  // 1번: 디즈니반팔
  if(brandColorSizeData['디즈니반팔']) {
    currentRow = createBrandTable('디즈니반팔', brandColorSizeData['디즈니반팔']);
  }

  // 2번: NY반팔
  if(brandColorSizeData['NY반팔']) {
    currentRow = createBrandTable('NY반팔', brandColorSizeData['NY반팔']);
  }

  // 3번: 통합 (디즈니 + NY)
  const mergedData = {};
  Object.entries(brandColorSizeData).forEach(([brand, colorData]) => {
    Object.entries(colorData).forEach(([color, sizeData]) => {
      if(!mergedData[color]) mergedData[color] = {};
      Object.entries(sizeData).forEach(([size, stock]) => {
        mergedData[color][size] = (mergedData[color][size] || 0) + stock;
      });
    });
  });

  if(Object.keys(mergedData).length > 0) {
    const colors = Object.keys(mergedData).sort();
    printSh.getRange(currentRow, 1).setValue('📊 통합 (디즈니+NY)').setFontWeight('bold').setFontSize(13).setBackground('#f0f0f0');
    currentRow++;

    const header = ['색상', ...SIZES];
    printSh.getRange(currentRow, 1, 1, header.length).setValues([header])
      .setBackground('#1a1814').setFontColor('#ffffff')
      .setFontWeight('bold').setFontSize(11).setHorizontalAlignment('center');
    currentRow++;

    colors.forEach(color => {
      const sizeData = mergedData[color];
      const dataRow = [color, ...SIZES.map(sz => sizeData[sz] || 0)];
      printSh.getRange(currentRow, 1, 1, dataRow.length).setValues([dataRow]);

      // 5 이하 모두 빨간색 (0 포함)
      for(let col = 2; col <= SIZES.length + 1; col++) {
        if(dataRow[col-1] <= 5) {
          printSh.getRange(currentRow, col).setBackground('#ffcccc');
        }
      }
      currentRow++;
    });
  }

  // 스타일링
  printSh.setColumnWidth(1, 70);
  SIZES.forEach((_, i) => printSh.setColumnWidth(i+2, 60));

  // 인쇄 설정
  try {
    const pageLayout = printSh.getPageLayout();
    pageLayout.setOrientation(SpreadsheetApp.PageOrientation.LANDSCAPE);
    pageLayout.setPaperSize(SpreadsheetApp.PaperSize.A4);
    pageLayout.setMargins(5, 5, 5, 5);
  } catch(e) {
    Logger.log('인쇄 설정 스킵: ' + e.message);
  }

  SpreadsheetApp.getUi().alert(
    `✅ 인쇄용 양식 생성 완료!\n\n1. 디즈니반팔\n2. NY반팔\n3. 통합 (디즈니+NY)\n\n${PRINT_SHEET} 탭에서 확인하세요.`
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
  const h=['완제품SKU','컬러','사이즈','완제품재고','업데이트날짜','발견/미발견'];
  sh.getRange(1,1,1,h.length).setValues([h]);
  _styleHeader(sh,h.length);
  [90,75,60,90,120,90].forEach((w,i)=>sh.setColumnWidth(i+1,w));
  sh.setFrozenRows(1);
  sh.getRange(2,1,1,4).setValues([['W281','화이트','130',0]]);
}

function _styleHeader(sh,n) {
  sh.getRange(1,1,1,n).setBackground('#1a1814').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10).setHorizontalAlignment('center');
  try{sh.setRowHeight(1,30);}catch(e){}
}

// ════════════════════════════════════════════════════════
// 백업 히스토리 (한 탭에 데이터 누적)
// ════════════════════════════════════════════════════════
function _ensureBackupHistorySheet(ss) {
  const HISTORY_SHEET = '📋 백업 히스토리';
  let sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh) {
    sh = ss.insertSheet(HISTORY_SHEET);
    const headers = ['백업시간', '시트명', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#1a1814').setFontColor('#ffffff')
      .setFontWeight('bold').setHorizontalAlignment('center');
    sh.setColumnWidth(1, 120);
    sh.setColumnWidth(2, 80);
    for (let i = 3; i <= 9; i++) sh.setColumnWidth(i, 100);
    sh.setFrozenRows(1);
  }
  return sh;
}

function recordBackupHistory(ss) {
  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  const histSh = _ensureBackupHistorySheet(ss);
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  const SHEETS_TO_RECORD = [
    { name: SHEET_NAMES.TRANSFER, label: '전사지재고' },
    { name: SHEET_NAMES.BLANK, label: '무지상품재고' },
    { name: SHEET_NAMES.FINISHED, label: '완제품재고' }
  ];

  let totalRows = 0;
  SHEETS_TO_RECORD.forEach(sheet => {
    const sh = ss.getSheetByName(sheet.name);
    if (!sh || sh.getLastRow() < 2) return;

    const data = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
    data.forEach(row => {
      if (!row[0]) return;
      const histRow = [timestamp, sheet.label, row[0], row[1], row[2], row[3], row[4], row[5], row[6]];
      histSh.appendRow(histRow);
      totalRows++;
    });
  });

  SpreadsheetApp.getUi().alert(`✅ 히스토리 기록 완료!\n\n${totalRows}건의 데이터가 기록되었습니다.`);
}

// ════════════════════════════════════════════════════════
// 백업 & 복원 기능 (3개 시트: 무지상품재고, 전사지재고, 완제품재고)
// ════════════════════════════════════════════════════════
function createBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');

  // 백업할 시트들
  const BACKUP_SHEETS = [SHEET_NAMES.BLANK, SHEET_NAMES.TRANSFER, SHEET_NAMES.FINISHED];
  const backupPrefix = `🔒백업`;

  // 기존 백업 개수 세기 (timestamp 기준)
  const allSheets = ss.getSheets().map(s => s.getName());
  const existingBackups = allSheets.filter(n => n.startsWith(backupPrefix)).map(n => {
    const match = n.match(/\[(.*?)\]/);
    return match ? match[1] : null;
  }).filter(Boolean);

  const uniqueTimestamps = [...new Set(existingBackups)];

  // 최대 10개 백업 유지 (가장 오래된 것 삭제)
  if (uniqueTimestamps.length >= 10) {
    const oldestTimestamp = uniqueTimestamps.sort()[0];
    const sheetsToDelete = allSheets.filter(n => n.includes(`[${oldestTimestamp}]`));
    sheetsToDelete.forEach(name => {
      try { ss.deleteSheet(ss.getSheetByName(name)); } catch(e) {}
    });
  }

  // 각 시트별로 백업 생성
  BACKUP_SHEETS.forEach(sheetName => {
    const srcSh = ss.getSheetByName(sheetName);
    if (!srcSh) return;

    const backupName = `${backupPrefix} [${timestamp}] ${sheetName}`;
    const backupSh = ss.insertSheet(backupName);

    const srcData = srcSh.getRange(1, 1, srcSh.getLastRow(), srcSh.getLastColumn()).getValues();
    backupSh.getRange(1, 1, srcData.length, srcData[0].length).setValues(srcData);
  });

  SpreadsheetApp.getUi().alert(`✅ 백업 생성 완료!\n\n무지상품재고\n전사지재고\n완제품재고\n\n[${timestamp}]`);
}

function listBackups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets().map(s => s.getName());
  const backups = allSheets.filter(n => n.startsWith('🔒백업')).map(n => {
    const match = n.match(/\[(.*?)\]/);
    return match ? match[1] : null;
  }).filter(Boolean);

  const uniqueBackups = [...new Set(backups)].sort().reverse();

  if (uniqueBackups.length === 0) {
    SpreadsheetApp.getUi().alert('📂 백업이 없습니다.\n💾 백업 생성을 먼저 실행하세요.');
    return;
  }

  let msg = `📂 사용 가능한 백업 (${uniqueBackups.length}개):\n\n`;
  uniqueBackups.forEach((ts, i) => {
    msg += `${i+1}번: ${ts}\n`;
  });
  SpreadsheetApp.getUi().alert(msg);
}

function restoreBackupUI() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allSheets = ss.getSheets().map(s => s.getName());
  const backups = allSheets.filter(n => n.startsWith('🔒백업')).map(n => {
    const match = n.match(/\[(.*?)\]/);
    return match ? match[1] : null;
  }).filter(Boolean);

  const uniqueBackups = [...new Set(backups)].sort().reverse();

  if (uniqueBackups.length === 0) {
    SpreadsheetApp.getUi().alert('📂 백업이 없습니다.');
    return;
  }

  let msg = `📂 복원할 백업 선택 (번호 입력):\n\n`;
  uniqueBackups.forEach((ts, i) => {
    msg += `${i+1}번: ${ts}\n`;
  });

  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(msg + '\n예) 1 (엔터)', ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    const idx = parseInt(response.getResponseText().trim()) - 1;
    if (idx >= 0 && idx < uniqueBackups.length) {
      restoreBackup(uniqueBackups[idx]);
    } else {
      SpreadsheetApp.getUi().alert('❌ 잘못된 번호입니다.');
    }
  }
}

function restoreBackup(timestamp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const RESTORE_SHEETS = [SHEET_NAMES.BLANK, SHEET_NAMES.TRANSFER, SHEET_NAMES.FINISHED];

  // 확인 다이얼로그
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    `⚠️ 주의: 현재 데이터가 삭제되고 다음으로 복원됩니다:\n\n무지상품재고\n전사지재고\n완제품재고\n\n[${timestamp}]\n\n계속하시겠습니까?`,
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  // 각 시트 복원
  let restored = 0;
  RESTORE_SHEETS.forEach(sheetName => {
    const backupName = `🔒백업 [${timestamp}] ${sheetName}`;
    const backupSh = ss.getSheetByName(backupName);
    const targetSh = ss.getSheetByName(sheetName);

    if (!backupSh || !targetSh) return;

    // 데이터 복사
    const backupData = backupSh.getRange(1, 1, backupSh.getLastRow(), backupSh.getLastColumn()).getValues();

    // 기존 데이터 삭제 (헤더 제외)
    if (targetSh.getLastRow() > 1) {
      targetSh.deleteRows(2, targetSh.getLastRow() - 1);
    }

    // 새 데이터 입력
    targetSh.getRange(1, 1, backupData.length, backupData[0].length).setValues(backupData);
    restored++;
  });

  SpreadsheetApp.getUi().alert(`✅ 복원 완료!\n\n${restored}개 시트 복원됨\n[${timestamp}]`);
}

// ── 주문서 파싱 ──
function parseOrders() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  _ensureAllSheets(ss);
  const sh=ss.getSheetByName(SHEET_NAMES.ORDER);
  const lastRow=sh.getLastRow();
  if(lastRow<2){SpreadsheetApp.getUi().alert('A2부터 주문 데이터를 붙여넣으세요.');return;}
  const data=sh.getRange(2,1,lastRow-1,6).getValues();
  const now=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm');
  let ok=0,warn=0;
  data.forEach((row,i)=>{
    const pname=String(row[2]||'').trim(),ename=String(row[4]||'').trim();
    if(!pname)return;
    const res=_parseProductName(pname,ename);
    const statusWithTime=res.status==='✅ 완료'?`✅ 파싱완료 ${now}`:res.status;
    sh.getRange(i+2,8,1,5).setValues([[res.code,res.color,res.size,row[5]||1,statusWithTime]]);
    sh.getRange(i+2,1,1,12).setBackground(res.status==='✅ 완료'?'#f0fff4':res.status==='⚠️ 수동확인'?'#fffde7':'#fff8f5');
    res.status==='✅ 완료'?ok++:warn++;
  });
  SpreadsheetApp.getActiveSpreadsheet().toast(`파싱 완료: ${ok}건 완료, ${warn}건 수동확인 필요`,'✅',4);
}

function _parseProductName(pname,ename) {
  const CODE_RE=/\b([A-Z]{1,4}\d{2,4})\b/g;
  const SIZE_RE=/\b(70|80|90|100|110|120|130|140|150|160|170|180|S|M|L|XL)\b/g;
  const COLOR_RE=/(블랙|화이트|그레이|네이비|베이지|카멜|레드|핑크|민트|카키|옐로우|바이올렛|퍼플|블루|차콜|피치|다홍|보라|스틸블루|인디핑크|네온핑크|그린|오렌지|스카이블루|아이보리|백멜란지|멜란지|청록|파랑|one\s?color)/g;
  const TYPE_RE=/(반팔|반바지|맨투맨|기모팬츠|팬츠|7부|9부)/;

  const codesE=[...ename.matchAll(CODE_RE)].map(m=>m[1]);
  const codesP=[...pname.replace(/[()아동성인]/g,'').matchAll(CODE_RE)].map(m=>m[1]);
  let code=codesE[0]||codesP[0]||'';
  const sil=pname.match(/(\d+_[\w가-힣]+(?:7부|9부))/);
  if(sil)code=sil[1];

  const sizes=[...pname.matchAll(SIZE_RE)].map(m=>m[1]);
  const colors=[...pname.matchAll(COLOR_RE)].map(m=>m[1]);
  const typeMatch=pname.match(TYPE_RE);
  const type=typeMatch?typeMatch[1]:'';
  const status=(!code||pname.includes('베개'))?'⚠️ 수동확인':'✅ 완료';
  return{code,color:colors[0]||'',size:sizes[sizes.length-1]||'',type,status};
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

// ── 요약 대시보드 생성 ──
function generateDashboard() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const DASHBOARD='요약대시보드';
  let dash=ss.getSheetByName(DASHBOARD);
  if(dash) ss.deleteSheet(dash);
  dash=ss.insertSheet(DASHBOARD,0);

  const today=Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd');
  const time=Utilities.formatDate(new Date(),'Asia/Seoul','HH:mm:ss');

  // 데이터 읽기
  const orderSh=ss.getSheetByName(SHEET_NAMES.ORDER);
  const finSh=ss.getSheetByName(SHEET_NAMES.FINISHED);
  const blankSh=ss.getSheetByName(SHEET_NAMES.BLANK);
  const transSh=ss.getSheetByName(SHEET_NAMES.TRANSFER);

  let row=1;

  // 제목
  dash.getRange(row,1,1,3).merge().setValue('📊 재고 요약 대시보드')
    .setBackground('#1a1814').setFontColor('#ffffff').setFontWeight('bold').setFontSize(16)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  dash.setRowHeight(row,30);
  row+=2;

  // 생성 정보
  dash.getRange(row,1).setValue('생성 날짜:').setFontWeight('bold');
  dash.getRange(row,2,1,2).setValue(today+' '+time);
  row+=2;

  // 주문 현황 (L열: 파싱상태+날짜)
  let orderTodayQty=0,orderTotalRows=0;
  if(orderSh && orderSh.getLastRow()>1) {
    const orderData=orderSh.getRange(2,1,orderSh.getLastRow()-1,15).getValues();
    orderTotalRows=orderData.filter(r=>r[0]).length;
    orderData.forEach((r,i)=>{
      const status=String(r[11]||'');
      const dateMatch=status.match(/(\d{4}-\d{2}-\d{2})/);
      if(status.includes('✅')) {
        Logger.log(`행 ${i+2}: status=[${status}], dateMatch=[${dateMatch}], today=[${today}]`);
        if(dateMatch && dateMatch[1]===today) {
          orderTodayQty+=1;
          Logger.log(`  ✅ 매칭됨! 개수: ${orderTodayQty}`);
        }
      }
    });
  }
  Logger.log(`최종 금일 주문: ${orderTodayQty}건`);

  dash.getRange(row,1).setValue('📋 금일 주문').setFontWeight('bold').setBackground('#fff3cd').setFontSize(12);
  dash.getRange(row,2).setValue(orderTodayQty+'건').setBackground('#fff3cd').setFontSize(12);
  row+=1;

  // 완제품재고
  let finTotalQty=0,finTotalItems=0,finTodayQty=0;
  if(finSh && finSh.getLastRow()>1) {
    const finData=finSh.getRange(2,1,finSh.getLastRow()-1,6).getValues();
    finTotalItems=finData.filter(r=>r[0]).length;
    finTotalQty=finData.reduce((sum,r)=>sum+(Number(r[3])||0),0);
    finData.forEach((r,i)=>{
      if(r[0]) {
        const date=String(r[4]||'');
        const status=String(r[5]||'');
        if(date.includes(today)&&status.includes('✅')) {
          finTodayQty+=1;
        }
      }
    });
  }

  dash.getRange(row,1).setValue('📦 완제품재고').setFontWeight('bold').setBackground('#e8f5e9').setFontSize(12);
  dash.getRange(row,2).setValue(finTotalQty+'개').setBackground('#e8f5e9').setFontSize(12);
  dash.getRange(row,3).setValue('('+finTotalItems+'항목)').setBackground('#e8f5e9').setFontSize(11).setFontColor('#666');
  row+=1;

  dash.getRange(row,2).setValue('  └ 금일 발견: '+finTodayQty+'개').setFontColor('#1a7a40').setFontWeight('bold');
  row+=1;

  // 무지상품재고
  let blankTotalQty=0,blankTotalItems=0;
  const blankByType={};
  if(blankSh && blankSh.getLastRow()>1) {
    const blankData=blankSh.getRange(2,1,blankSh.getLastRow()-1,4).getValues();
    blankTotalItems=blankData.filter(r=>r[0]).length;
    blankData.forEach(r=>{
      if(r[0]) {
        blankTotalQty+=Number(r[3])||0;
        const type=String(r[0]).trim();
        blankByType[type]=(blankByType[type]||0)+(Number(r[3])||0);
      }
    });
  }

  dash.getRange(row,1).setValue('🧵 무지상품재고').setFontWeight('bold').setBackground('#e3f2fd').setFontSize(12);
  dash.getRange(row,2).setValue(blankTotalQty+'개').setBackground('#e3f2fd').setFontSize(12);
  dash.getRange(row,3).setValue('('+blankTotalItems+'항목)').setBackground('#e3f2fd').setFontSize(11).setFontColor('#666');
  row+=1;

  // 무지상품 종류별
  Object.keys(blankByType).sort().forEach(type=>{
    const qty=blankByType[type];
    dash.getRange(row,2).setValue('  └ '+type+': '+qty+'개').setFontColor('#666');
    row+=1;
  });
  row+=1;

  // 발주 필요 (모든 사이즈 중 어느 하나라도 < 5개면 발주 필요)
  const needColors=new Set();
  const colorSizeStock={};

  if(blankSh && blankSh.getLastRow()>1) {
    const blankData=blankSh.getRange(2,1,blankSh.getLastRow()-1,4).getValues();

    blankData.forEach(r=>{
      if(!r[0] || !r[1] || !r[2]) return;
      const color=String(r[1]).trim();
      const size=String(r[2]).trim();
      const current=Number(r[3])||0;

      if(!colorSizeStock[color]) colorSizeStock[color]={};
      colorSizeStock[color][size]=current;
    });

    Object.entries(colorSizeStock).forEach(([color, sizes])=>{
      // 110~170 중 5개 미만인 사이즈가 3개 이상이면 발주 필요
      const lowStockCount=Object.values(sizes).filter(stock=>stock<5).length;
      if(lowStockCount>=3) {
        needColors.add(color);
      }
    });
  }

  if(needColors.size>0) {
    const colorList=Array.from(needColors).sort().join(', ');
    dash.getRange(row,1).setValue('📍 발주 필요').setFontWeight('bold').setBackground('#ffcccc').setFontSize(12);
    dash.getRange(row,2).setValue(colorList).setBackground('#ffcccc').setFontSize(12).setFontColor('#c02820').setFontWeight('bold');
    row+=1;
  }

  // 전사지재고
  let transTotalQty=0,transTotalItems=0;
  const transByStatus={};
  if(transSh && transSh.getLastRow()>1) {
    const transData=transSh.getRange(2,1,transSh.getLastRow()-1,5).getValues();
    transData.forEach(r=>{
      if(r[0]) {
        const qty=Number(r[2])||0;
        transTotalQty+=qty;
        transTotalItems++;
        const status=String(r[4]).trim()||'미분류';
        transByStatus[status]=(transByStatus[status]||0)+1;
      }
    });
  }

  dash.getRange(row,1).setValue('🖨️ 전사지재고').setFontWeight('bold').setBackground('#f3e5f5').setFontSize(12);
  dash.getRange(row,2).setValue(transTotalQty+'개').setBackground('#f3e5f5').setFontSize(12);
  dash.getRange(row,3).setValue('('+transTotalItems+'종류)').setBackground('#f3e5f5').setFontSize(11).setFontColor('#666');
  row+=1;

  // 전사지 상태별
  const statusOrder=['🔴 생산불가','🔴 긴급','🟡 부족','🟢 안전','미분류'];
  statusOrder.forEach(s=>{
    if(transByStatus[s]) {
      const color=s.includes('생산')?'#ffebee':s.includes('긴급')?'#ffebee':s.includes('부족')?'#fffde7':'#f1f8e9';
      dash.getRange(row,2).setValue('  └ '+s+': '+transByStatus[s]+'종').setFontColor('#666').setBackground(color);
      row+=1;
    }
  });
  row+=1;

  // 전사지 인쇄 필요량
  let transPrintNeeds=0;
  const DARK_COLORS=['레드','검은색','바이올렛','블루','차콜','다홍','보라'];
  if(orderSh && orderSh.getLastRow()>1) {
    const orderData=orderSh.getRange(2,1,orderSh.getLastRow()-1,14).getValues();
    let printList={};
    orderData.forEach(r=>{
      const transfer=String(r[13]||'').trim();
      const color=String(r[8]||'').trim();
      const qty=Number(r[10])||1;
      const status=String(r[11]||'').trim();
      if(!transfer || !color || !status.includes('✅')) return;
      const inkColor=DARK_COLORS.includes(color)?'흰색':'검은색';
      const key=`${transfer}|${inkColor}`;
      if(!printList[key]) printList[key]={code:transfer,inkColor:inkColor,totalQty:0};
      printList[key].totalQty+=qty;
    });
    const transData=transSh && transSh.getLastRow()>1?transSh.getRange(2,1,transSh.getLastRow()-1,5).getValues():[];
    Object.values(printList).forEach(item=>{
      const transRow=transData.find(t=>String(t[0]).trim()===item.code && String(t[1]).trim()===item.inkColor);
      const currentStock=transRow?Number(transRow[2])||0:0;
      const needsQty=Math.max(0,item.totalQty-currentStock);
      transPrintNeeds+=needsQty;
    });
  }

  dash.getRange(row,1).setValue('🖨️ 인쇄 필요').setFontWeight('bold').setBackground('#ffebee').setFontSize(12);
  dash.getRange(row,2).setValue(transPrintNeeds+'개').setBackground('#ffebee').setFontSize(12).setFontColor('#c02820').setFontWeight('bold');
  row+=1;

  // 컬럼 너비 조정
  dash.setColumnWidth(1,20);
  dash.setColumnWidth(2,30);
  dash.setColumnWidth(3,30);

  SpreadsheetApp.getUi().alert('✅ 대시보드 생성 완료!\n\n금일 주문: '+orderTodayQty+'건\n완제품: '+finTotalQty+'개\n무지상품: '+blankTotalQty+'개\n전사지 재고: '+transTotalQty+'개\n🔴 인쇄 필요: '+transPrintNeeds+'개');
}

// ── 전사지 필요수량 계산 (색상별 White/Black 구분) ──
function calculateTransferNeeds() {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  const orderSh=ss.getSheetByName(SHEET_NAMES.ORDER);
  const transSh=ss.getSheetByName(SHEET_NAMES.TRANSFER);

  if(!orderSh || !transSh) {
    SpreadsheetApp.getUi().alert('❌ 주문확인 또는 전사지재고 시트가 없습니다');
    return;
  }

  // White 전사지 필요 색상 (어두운색)
  const DARK_COLORS=['레드','검은색','바이올렛','블루'];

  // 전사지재고 데이터 읽기 (코드, 색상, 수량)
  const transData=transSh.getLastRow()>1?transSh.getRange(2,1,transSh.getLastRow()-1,3).getValues():[];

  // 주문 데이터 읽기 (파싱된 항목들)
  const orderData=orderSh.getLastRow()>1?orderSh.getRange(2,1,orderSh.getLastRow()-1,14).getValues():[];

  let needsList={};
  let processedCount=0;

  orderData.forEach((r,i)=>{
    const transfer=String(r[13]||'').trim();
    const color=String(r[8]||'').trim();
    const qty=Number(r[10])||1;
    const status=String(r[11]||'').trim();

    // 파싱 완료되고 transfer 코드가 있는 주문만 처리
    if(!transfer || !color || !status.includes('✅')) return;

    // 주문 색상에 따라 필요한 전사지 색상 결정
    const needsInkColor=DARK_COLORS.includes(color)?'흰색':'검은색';

    // 전사지재고에서 해당 코드+색상 찾기
    const transRow=transData.find(t=>
      String(t[0]).trim()===transfer && String(t[1]).trim()===needsInkColor
    );

    const currentStock=transRow?Number(transRow[2])||0:0;
    const needsQty=Math.max(0, qty-currentStock);

    if(needsQty>0) {
      const key=`${transfer}(${needsInkColor})`;
      if(!needsList[key]) {
        needsList[key]={code:transfer, inkColor:needsInkColor, total:0, orders:[]};
      }
      needsList[key].total+=needsQty;
      needsList[key].orders.push({color, qty, current:currentStock});
    }

    // 주문확인 시트의 O열(전사지필요)에 표시
    const needsText=needsQty>0?`🔴 ${needsInkColor} ${needsQty}개 필요`:'✅ 충분';
    orderSh.getRange(i+2, 15).setValue(needsText).setFontColor(needsQty>0?'#c02820':'#1a7a40');
    processedCount++;
  });

  // 요약 메시지 생성
  let summaryMsg='✅ 전사지 필요수량 계산 완료!\n\n';
  const needsArray=Object.values(needsList);

  if(needsArray.length===0) {
    summaryMsg+='🟢 모든 전사지 충분합니다';
  } else {
    summaryMsg+='🔴 인쇄 필요:\n\n';
    needsArray.forEach(item=>{
      summaryMsg+=`${item.code} (${item.inkColor}): ${item.total}개 필요\n`;
    });
  }

  summaryMsg+=`\n처리된 주문: ${processedCount}건`;
  SpreadsheetApp.getUi().alert(summaryMsg);
}

// ── 주문→완제품/무지상품 차감 ──
function matchOrdersWithFinished() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSh = ss.getSheetByName(SHEET_NAMES.ORDER);
  const finSh = ss.getSheetByName(SHEET_NAMES.FINISHED);
  const blankSh = ss.getSheetByName(SHEET_NAMES.BLANK);
  const transSh = ss.getSheetByName(SHEET_NAMES.TRANSFER);

  if(!orderSh || !finSh) {
    SpreadsheetApp.getUi().alert('❌ 주문확인 또는 완제품재고 시트가 없습니다');
    return;
  }

  const finData = finSh && finSh.getLastRow() > 1
    ? finSh.getRange(2, 1, finSh.getLastRow()-1, 6).getValues() : [];
  const blankData = blankSh && blankSh.getLastRow() > 1
    ? blankSh.getRange(2, 1, blankSh.getLastRow()-1, 4).getValues() : [];
  const transData = transSh && transSh.getLastRow() > 1
    ? transSh.getRange(2, 1, transSh.getLastRow()-1, 6).getValues() : [];
  const orderData = orderSh.getRange(2, 1, orderSh.getLastRow()-1, 14).getValues();

  let matched = 0, unmatched = 0, finDeleted = 0, blankDeleted = 0, transDeleted = 0;
  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const finRowsToDelete = [];
  const blankRowsToDelete = [];
  const transRowsToDelete = [];

  orderData.forEach((r, i) => {
    const code = String(r[7]||'').trim();
    const color = String(r[8]||'').trim();
    const size = String(r[9]||'').trim();
    const garment = String(r[12]||'').trim();
    const transfer = String(r[13]||'').trim();
    const orderQty = Number(r[10]) || 1;
    const status = String(r[11]||'').trim();

    if(!code || !color || !size) {
      orderSh.getRange(i+2, 13).setValue('⚠️ 불완전');
      return;
    }

    // 이미 차감완료된 주문은 스킵
    if(status.includes('차감완료')) return;

    // 1. 완제품재고 차감 (코드 + 색상 + 사이즈)
    let finFoundIdx = -1;
    for(let j = 0; j < finData.length; j++) {
      if(String(finData[j][0]||'').trim() === code &&
         String(finData[j][1]||'').trim() === color &&
         String(finData[j][2]||'').trim() === size) {
        finFoundIdx = j;
        break;
      }
    }

    if(finFoundIdx >= 0) {
      const finRow = finData[finFoundIdx];
      const currentStock = Number(finRow[3]) || 0;
      const newStock = currentStock - orderQty;
      const finSheetRow = finFoundIdx + 2;

      orderSh.getRange(i+2, 12).setValue('✅ 차감완료 ' + today);
      orderSh.getRange(i+2, 1, 1, 12).setBackground('#e8f5e9');

      finSh.getRange(finSheetRow, 4).setValue(newStock);
      finSh.getRange(finSheetRow, 5).setValue(today);

      if(newStock <= 0) {
        finSh.getRange(finSheetRow, 6).setValue('✅ 완매').setFontColor('#e67e22');
        finDeleted++;
      } else {
        finSh.getRange(finSheetRow, 6).setValue('✅ 발견').setFontColor('#1a7a40');
      }
      matched++;
    } else {
      orderSh.getRange(i+2, 12).setValue('❌ 미발견 ' + today);
      unmatched++;
    }

    // 2. 무지상품재고 차감 (의류종류 + 색상 + 사이즈)
    if(garment && blankSh) {
      let blankFoundIdx = -1;
      for(let j = 0; j < blankData.length; j++) {
        if(String(blankData[j][0]||'').trim() === garment &&
           String(blankData[j][1]||'').trim() === color &&
           String(blankData[j][2]||'').trim() === size) {
          blankFoundIdx = j;
          break;
        }
      }

      if(blankFoundIdx >= 0) {
        const blankRow = blankData[blankFoundIdx];
        const currentBlankStock = Number(blankRow[3]) || 0;
        const newBlankStock = currentBlankStock - orderQty;
        const blankSheetRow = blankFoundIdx + 2;

        if(newBlankStock <= 0) {
          blankRowsToDelete.push(blankSheetRow);
          blankDeleted++;
        } else {
          blankSh.getRange(blankSheetRow, 4).setValue(newBlankStock);
        }

        blankSh.getRange(blankSheetRow, 7).setValue(today);
      }
    }

    // 3. 전사지재고 차감 (전사지 코드)
    if(transfer && transSh) {
      let transFoundIdx = -1;
      for(let j = 0; j < transData.length; j++) {
        if(String(transData[j][0]||'').trim() === transfer) {
          transFoundIdx = j;
          break;
        }
      }

      if(transFoundIdx >= 0) {
        const transRow = transData[transFoundIdx];
        const currentTransStock = Number(transRow[2]) || 0;
        const newTransStock = currentTransStock - orderQty;
        const transSheetRow = transFoundIdx + 2;

        if(newTransStock <= 0) {
          transRowsToDelete.push(transSheetRow);
          transDeleted++;
        } else {
          transSh.getRange(transSheetRow, 3).setValue(newTransStock);
        }

        transSh.getRange(transSheetRow, 6).setValue(today);
      }
    }
  });

  // 역순으로 삭제 (무지상품, 전사지만)
  blankRowsToDelete.sort((a, b) => b - a).forEach(row => {
    blankSh.deleteRow(row);
  });

  transRowsToDelete.sort((a, b) => b - a).forEach(row => {
    transSh.deleteRow(row);
  });

  SpreadsheetApp.getUi().alert(
    `✅ 완료!\n\n완제품:\n  발견 & 처리: ${matched}건\n  미발견: ${unmatched}건\n  삭제: ${finDeleted}건\n\n무지상품:\n  삭제: ${blankDeleted}건\n\n전사지:\n  삭제: ${transDeleted}건`
  );
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
// 텔레그램 대시보드 발송
// ════════════════════════════════════════════════════════
function sendDashboardToTelegram() {
  const TELEGRAM_TOKEN = '8695707104:AAGqDo1BANfoz94EsECd4suADMdVE5nA2gE';
  const CHAT_ID = '439664573';
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const time = Utilities.formatDate(new Date(), 'Asia/Seoul', 'HH:mm:ss');

  let msg = `📊 *뉴욕꼬맹이 일일 재고현황*\n\n`;
  msg += `📅 ${today} ${time}\n\n`;

  // 주문 현황
  const orderSh = ss.getSheetByName(SHEET_NAMES.ORDER);
  let orderTodayQty = 0;
  if (orderSh && orderSh.getLastRow() > 1) {
    const orderData = orderSh.getRange(2, 1, orderSh.getLastRow()-1, 12).getValues();
    orderData.forEach(r => {
      if (r[0] && String(r[11]||'').includes('✅')) {
        orderTodayQty += Number(r[5]) || 1;
      }
    });
  }
  msg += `📋 파싱완료 주문: *${orderTodayQty}건*\n`;

  // 완제품재고
  const finSh = ss.getSheetByName(SHEET_NAMES.FINISHED);
  let finTotalQty = 0, finTotalItems = 0, finTodayQty = 0;
  if (finSh && finSh.getLastRow() > 1) {
    const finData = finSh.getRange(2, 1, finSh.getLastRow()-1, 6).getValues();
    finTotalItems = finData.filter(r => r[0]).length;
    finData.forEach(r => {
      if (r[0]) {
        finTotalQty += Number(r[3]) || 0;
        if (String(r[4]||'').includes(today) && String(r[5]||'').includes('✅')) {
          finTodayQty += Number(r[3]) || 0;
        }
      }
    });
  }
  msg += `📦 완제품: *${finTotalQty}개* (${finTotalItems}항목)\n`;
  msg += `  └ 금일 발견: ${finTodayQty}개\n\n`;

  // 무지상품재고
  const blankSh = ss.getSheetByName(SHEET_NAMES.BLANK);
  let blankTotalQty = 0;
  if (blankSh && blankSh.getLastRow() > 1) {
    const blankData = blankSh.getRange(2, 1, blankSh.getLastRow()-1, 4).getValues();
    blankData.forEach(r => {
      if (r[0]) {
        blankTotalQty += Number(r[3]) || 0;
      }
    });
  }
  msg += `🧵 무지상품: *${blankTotalQty}개*\n`;

  // 발주 필요 색상
  const needColors = new Set();
  const colorSizeStock = {};
  if (blankSh && blankSh.getLastRow() > 1) {
    const blankData = blankSh.getRange(2, 1, blankSh.getLastRow()-1, 4).getValues();
    blankData.forEach(r => {
      if (!r[0] || !r[1] || !r[2]) return;
      const color = String(r[1]).trim();
      const size = String(r[2]).trim();
      const current = Number(r[3]) || 0;
      if (!colorSizeStock[color]) colorSizeStock[color] = {};
      colorSizeStock[color][size] = current;
    });
    Object.entries(colorSizeStock).forEach(([color, sizes]) => {
      const lowStockCount = Object.values(sizes).filter(stock => stock < 5).length;
      if (lowStockCount >= 3) {
        needColors.add(color);
      }
    });
  }
  if (needColors.size > 0) {
    const colorList = Array.from(needColors).sort().join(', ');
    msg += `📍 *발주 필요: ${colorList}*\n`;
  }
  msg += `\n`;

  // 전사지재고
  const transSh = ss.getSheetByName(SHEET_NAMES.TRANSFER);
  let transTotalQty = 0;
  if (transSh && transSh.getLastRow() > 1) {
    const transData = transSh.getRange(2, 1, transSh.getLastRow()-1, 5).getValues();
    transData.forEach(r => {
      if (r[0]) {
        transTotalQty += Number(r[2]) || 0;
      }
    });
  }
  msg += `🖨️ 전사지: *${transTotalQty}개*\n\n`;

  // 인쇄 필요량
  let transPrintNeeds = 0;
  const DARK_COLORS = ['레드','검은색','바이올렛','블루','차콜','다홍','보라'];
  if (orderSh && orderSh.getLastRow() > 1) {
    const orderData = orderSh.getRange(2, 1, orderSh.getLastRow()-1, 14).getValues();
    let printList = {};
    orderData.forEach(r => {
      const transfer = String(r[13]||'').trim();
      const color = String(r[8]||'').trim();
      const qty = Number(r[10]) || 1;
      const status = String(r[11]||'').trim();
      if (!transfer || !color || !status.includes('✅')) return;
      const inkColor = DARK_COLORS.includes(color) ? '흰색' : '검은색';
      const key = `${transfer}|${inkColor}`;
      if (!printList[key]) printList[key] = {code: transfer, inkColor: inkColor, totalQty: 0};
      printList[key].totalQty += qty;
    });
    const transData = transSh && transSh.getLastRow() > 1 ? transSh.getRange(2, 1, transSh.getLastRow()-1, 5).getValues() : [];
    Object.values(printList).forEach(item => {
      const transRow = transData.find(t => String(t[0]).trim() === item.code && String(t[1]).trim() === item.inkColor);
      const currentStock = transRow ? Number(transRow[2]) || 0 : 0;
      const needsQty = Math.max(0, item.totalQty - currentStock);
      transPrintNeeds += needsQty;
    });
  }

  if (transPrintNeeds > 0) {
    msg += `🔴 *인쇄 필요: ${transPrintNeeds}개*\n`;
  } else {
    msg += `✅ *전사지 충분*\n`;
  }

  // 텔레그램 발송
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: CHAT_ID,
    text: msg,
    parse_mode: 'Markdown'
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });
    Logger.log('✅ 텔레그램 발송 완료');
  } catch (e) {
    Logger.log('❌ 텔레그램 발송 실패: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════
// doGet: 연결 테스트 & 상태 확인 & 재고 전체 조회
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

  // ── AI분석용: 구글시트 4개 탭 전체 데이터 반환 ──
  if(action==='getInventory'){
    const result={orders:[],blank:[],transfer:[],finished:[]};

    // ① 주문확인(원본) — 파싱된 H~L열 (제품코드·컬러·사이즈·수량·상태)
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.ORDER);
      if(sh&&sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,12).getValues()
          .filter(r=>r[0]&&r[7])  // 쇼핑몰명 + 제품코드 있는 행만
          .forEach(r=>{
            result.orders.push({
              channel:String(r[0]),
              code:String(r[7]),
              color:String(r[8]),
              size:String(r[9]),
              qty:r[10]||1,
              status:String(r[11]||'')
            });
          });
      }
    }catch(er){}

    // ② 무지상품재고
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.BLANK);
      if(sh&&sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,6).getValues()
          .filter(r=>r[0])
          .forEach(r=>{
            result.blank.push({
              garment:String(r[0]),color:String(r[1]),size:String(r[2]),
              stock:r[3]||0,safeStock:r[4]||30,status:String(r[5]||'')
            });
          });
      }
    }catch(er){}

    // ③ 전사지재고
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.TRANSFER);
      if(sh&&sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,5).getValues()
          .filter(r=>r[0])
          .forEach(r=>{
            result.transfer.push({
              code:String(r[0]),name:String(r[1]||''),
              stock:r[2]||0,safeStock:r[3]||20,status:String(r[4]||'')
            });
          });
      }
    }catch(er){}

    // ④ 완제품재고
    try{
      const sh=ss.getSheetByName(SHEET_NAMES.FINISHED);
      if(sh&&sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,7).getValues()
          .filter(r=>r[0])
          .forEach(r=>{
            const stock = r[3]||0;
            const dailySales = r[4]||0;
            // 상태 계산: Google Sheets G열(비고/상태)에서 읽기
            let status = String(r[6]||'');
            if(!status) {
              // 상태값이 없으면 재고 기반으로 자동 계산
              if(stock === 0) status = '🔴 긴급';
              else if(stock < dailySales * 3) status = '🟡 부족';
              else status = '🟢 안전';
            }
            result.finished.push({
              sku:String(r[0]),color:String(r[1]),size:String(r[2]),
              stock:stock,dailySales:dailySales,runout:String(r[5]||''),
              status:status
            });
          });
      }
    }catch(er){}

    return ContentService
      .createTextOutput(JSON.stringify({status:'ok',data:result}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── 완제품 재고 수량 업데이트 ──
  if(action==='updateFinished'){
    const sku = (e.parameter.sku||'').trim();
    const color = (e.parameter.color||'').trim();
    const size = (e.parameter.size||'').trim();
    const qty = parseInt(e.parameter.qty||0);

    Logger.log(`🔍 updateFinished 요청: sku=[${sku}], color=[${color}], size=[${size}], qty=${qty}`);

    if(!sku || !color || !size || !qty) {
      return _json({status:'error', message:'sku, color, size, qty 모두 필수입니다'});
    }

    const sh = ss.getSheetByName(SHEET_NAMES.FINISHED);
    if(!sh || sh.getLastRow() < 2) {
      Logger.log('❌ 완제품재고 시트 없음');
      return _json({status:'error', message:'완제품재고 시트가 없거나 비어있습니다'});
    }

    Logger.log(`📊 시트 데이터 행 수: ${sh.getLastRow()-1}`);
    const rows = sh.getRange(2,1,sh.getLastRow()-1,4).getValues();

    for(let i=0; i<rows.length; i++) {
      const row_sku = String(rows[i][0]||'').trim();
      const row_color = String(rows[i][1]||'').trim();
      const row_size = String(rows[i][2]||'').trim();

      Logger.log(`   행 ${i+2}: [${row_sku}] [${row_color}] [${row_size}]`);

      if(row_sku === sku && row_color === color && row_size === size) {
        Logger.log(`✅ 매칭! D${i+2} 셀을 ${qty}로 업데이트`);
        sh.getRange(i+2, 4).setValue(qty);
        sh.getRange(i+2, 7).setValue(Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd HH:mm'));
        Logger.log(`✅ 업데이트 완료`);
        return _json({status:'ok', message:`✅ ${sku} ${color} ${size} 수량이 ${qty}로 업데이트되었습니다`});
      }
    }

    Logger.log(`❌ 매칭되는 항목 없음`);
    return _json({status:'error', message:`❌ 해당 항목을 찾을 수 없습니다: ${sku} ${color} ${size}`});
  }

  return _json({status:'ok',message:'뉴욕꼬맹이 재고관리 연결됨 ✅',version:'2.0',sheets:Object.values(SHEET_NAMES)});
}

// ════════════════════════════════════════════════════════
// doPost: 모바일앱 → 구글시트 동기화
// Content-Type: text/plain으로 받아서 JSON.parse 처리
// ════════════════════════════════════════════════════════
function doPost(e) {
  Logger.log('═══ doPost 함수 시작 ═══');
  try {
    // text/plain 또는 application/json 모두 처리
    const raw = e.postData ? e.postData.contents : '';
    Logger.log(`📨 수신 body 길이: ${raw.length}`);
    if (!raw) {
      Logger.log('❌ body 비어있음');
      return _json({status:'error', message:'body가 비어있습니다. Content-Type: text/plain 으로 전송하세요'});
    }

    const data = JSON.parse(raw);
    Logger.log(`📦 파싱된 action: ${data.action}`);
    Logger.log(`📋 데이터: ${JSON.stringify(data)}`);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    _ensureAllSheets(ss);

    if (data.action === 'setup') {
      Logger.log('🔧 setup action 처리 중');
      ['시트1','Sheet1','재고카운팅'].forEach(n => {
        const s = ss.getSheetByName(n);
        if (s && ss.getSheets().length > 1) { try { ss.deleteSheet(s); } catch(er) {} }
      });
      return _json({status:'ok', message:'시트 초기화 완료', sheets:Object.values(SHEET_NAMES)});
    }

    // 완제품 단일 항목 업데이트 (대시보드 수정 버튼)
    if (data.action === 'updateFinished') {
      Logger.log('🎯 updateFinished action 감지됨!');
      const success = updateFinishedFromDashboard(data.sku, data.color, data.size, data.qty);
      Logger.log(`📊 updateFinishedFromDashboard 결과: ${success}`);
      if (success) {
        Logger.log(`✅ 업데이트 성공`);
        return _json({status:'ok', message:`✅ ${data.sku} ${data.color} ${data.size} 수량이 ${data.qty}로 업데이트됨`});
      } else {
        Logger.log(`❌ 업데이트 실패: 항목을 찾을 수 없음`);
        return _json({status:'error', message:`❌ ${data.sku} ${data.color} ${data.size} 항목을 찾을 수 없습니다`});
      }
    }

    Logger.log('🔄 모바일 앱 동기화 처리 중');
    const res = {blank:0, transfer:0, finished:0};
    if (data.blank    && data.blank.length)    res.blank    = _upsertBlank(ss, data.blank);
    if (data.transfer && data.transfer.length) res.transfer = _upsertTransfer(ss, data.transfer);
    if (data.finished && data.finished.length) res.finished = _upsertFinished(ss, data.finished);

    Logger.log(`✅ doPost 완료: ${JSON.stringify(res)}`);
    return _json({status:'ok', updated:res, timestamp:new Date().toISOString()});

  } catch(err) {
    Logger.log(`❌ doPost 예외: ${err.message}`);
    return _json({status:'error', message:err.message, hint:'JSON.parse 실패 시 body 형식을 확인하세요'});
  }
}

// ════════════════════════════════════════════════════════
// 완제품재고 수량 업데이트 (대시보드 수정 버튼 처리)
// ════════════════════════════════════════════════════════
function updateFinishedFromDashboard(sku, color, size, qty) {
  Logger.log(`🔍 updateFinishedFromDashboard: sku=[${sku}], color=[${color}], size=[${size}], qty=${qty}`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAMES.FINISHED);
  if (!sh || sh.getLastRow() < 2) {
    Logger.log('❌ 완제품재고 시트 없음 또는 데이터 없음');
    return false;
  }

  Logger.log(`📊 완제품 데이터 행 수: ${sh.getLastRow()-1}`);
  const rows = sh.getRange(2, 1, sh.getLastRow()-1, 7).getValues();

  for (let i = 0; i < rows.length; i++) {
    const row_sku = String(rows[i][0]||'').trim();
    const row_color = String(rows[i][1]||'').trim();
    const row_size = String(rows[i][2]||'').trim();

    Logger.log(`   행 ${i+2}: [${row_sku}] [${row_color}] [${row_size}]`);

    if (row_sku === sku && row_color === color && row_size === size) {
      Logger.log(`✅ 매칭! D${i+2}에 ${qty} 입력`);
      sh.getRange(i+2, 4).setValue(qty);
      Logger.log(`✅ 업데이트 완료`);
      return true;
    }
  }

  Logger.log(`❌ 매칭되는 항목 없음`);
  return false;
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

// ════════════════════════════════════════════════════════
// ④ 주문 기반 재고 차감 — 수동 확인 후 실행
// ════════════════════════════════════════════════════════

function openDeductSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('DeductSidebar')
    .setTitle('📦 재고 차감 확인').setWidth(480);
  SpreadsheetApp.getUi().showSidebar(html);
}

// 차감 목록 계산 (사이드바 호출)
function getDeductionList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSh  = ss.getSheetByName(SHEET_NAMES.ORDER);
  const blankSh  = ss.getSheetByName(SHEET_NAMES.BLANK);
  const transSh  = ss.getSheetByName(SHEET_NAMES.TRANSFER);
  const finSh    = ss.getSheetByName(SHEET_NAMES.FINISHED);

  if (!orderSh || orderSh.getLastRow() < 2)
    return { error: '주문확인(원본) 시트에 데이터가 없습니다. 먼저 파싱을 실행하세요.' };

  // 파싱 완료 주문만 (L열 ✅)
  const orders = orderSh.getRange(2, 1, orderSh.getLastRow()-1, 12).getValues()
    .filter(r => r[0] && String(r[11]).includes('✅') && !String(r[11]).includes('차감완료'));

  if (orders.length === 0)
    return { error: '차감 처리할 주문이 없습니다.\n(이미 차감완료되었거나 파싱 미완료)' };

  // 코드/컬러/사이즈별 수량 집계
  const summary = {};
  orders.forEach(r => {
    const code    = String(r[7]).trim();
    const color   = String(r[8]).trim();
    const size    = String(r[9]).trim();
    const qty     = Number(r[10]) || 1;
    const channel = String(r[0]).trim();
    if (!code) return;
    const key = `${code}||${color}||${size}`;
    if (!summary[key]) summary[key] = { code, color, size, orderQty: 0, channels: [] };
    summary[key].orderQty += qty;
    if (!summary[key].channels.includes(channel)) summary[key].channels.push(channel);
  });

  // 현재 재고 데이터
  const blankData = blankSh && blankSh.getLastRow() > 1
    ? blankSh.getRange(2,1,blankSh.getLastRow()-1,5).getValues() : [];
  const transData = transSh && transSh.getLastRow() > 1
    ? transSh.getRange(2,1,transSh.getLastRow()-1,4).getValues() : [];
  const finData   = finSh && finSh.getLastRow() > 1
    ? finSh.getRange(2,1,finSh.getLastRow()-1,5).getValues() : [];

  const items = Object.values(summary).map(item => {

    // ① 무지상품: 컬러 + 사이즈 매핑
    const blankRow  = blankData.find(r =>
      String(r[1]).trim() === item.color && String(r[2]).trim() === item.size
    );
    const blankStock  = blankRow ? Number(blankRow[3]) : null;
    const blankAfter  = blankStock !== null ? blankStock - item.orderQty : null;
    const blankStatus = blankStock === null  ? '⚠️ 없음'
      : blankAfter < 0 ? `🔴 ${Math.abs(blankAfter)}개 부족`
      : blankAfter === 0 ? '🟡 재고소진'
      : `🟢 ${blankAfter}개 남음`;

    // ② 전사지: 제품코드 매핑
    const transRow   = transData.find(r => String(r[0]).trim() === item.code);
    const transStock = transRow ? Number(transRow[2]) : null;
    const transAfter = transStock !== null ? transStock - item.orderQty : null;
    const transStatus = transStock === null ? '⚠️ 없음'
      : transAfter < 0 ? `🔴 ${Math.abs(transAfter)}매 부족`
      : transAfter === 0 ? '🟡 재고소진'
      : `🟢 ${transAfter}매 남음`;

    // ③ 완제품: 코드 + 컬러 + 사이즈 매핑
    const finRow   = finData.find(r =>
      String(r[0]).trim() === item.code &&
      String(r[1]).trim() === item.color &&
      String(r[2]).trim() === item.size
    );
    const finStock   = finRow ? Number(finRow[3]) : null;
    const finStatus  = finStock === null ? '완제품 출고없음'
      : finStock === 0  ? '완제품 출고없음 (재고0)'
      : `출고가능 ${finStock}개`;
    const hasFinished = finStock !== null && finStock > 0;

    const canDeduct = blankStock !== null && transStock !== null;

    return {
      code: item.code, color: item.color, size: item.size,
      orderQty: item.orderQty,
      channels: item.channels.join(', '),
      // 무지
      blankStock: blankStock !== null ? blankStock : '-',
      blankAfter: blankAfter !== null ? blankAfter : '-',
      blankStatus,
      // 전사지
      transStock: transStock !== null ? transStock : '-',
      transAfter: transAfter !== null ? transAfter : '-',
      transStatus,
      // 완제품
      finStock: finStock !== null ? finStock : '-',
      finStatus,
      hasFinished,
      canDeduct,
    };
  });

  return {
    items,
    totalOrders: orders.length,
    totalSkus: items.length,
    warnCount: items.filter(i => !i.canDeduct).length,
  };
}

// 실제 차감 실행
function executeDeduction(selectedItems) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const blankSh = ss.getSheetByName(SHEET_NAMES.BLANK);
  const transSh = ss.getSheetByName(SHEET_NAMES.TRANSFER);
  const orderSh = ss.getSheetByName(SHEET_NAMES.ORDER);
  const now     = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const results = [];

  selectedItems.forEach(item => {
    let blankResult = '-', transResult = '-';

    // ① 무지상품: 컬러+사이즈 매핑 → 수량 차감
    if (blankSh && blankSh.getLastRow() > 1) {
      const data = blankSh.getRange(2,1,blankSh.getLastRow()-1,5).getValues();
      const idx  = data.findIndex(r =>
        String(r[1]).trim() === item.color && String(r[2]).trim() === item.size
      );
      if (idx >= 0) {
        const cur    = Number(data[idx][3]) || 0;
        const newQty = Math.max(0, cur - item.orderQty);
        blankSh.getRange(idx+2, 4).setValue(newQty);
        blankSh.getRange(idx+2, 7).setValue(now);
        blankResult = `${cur}개 → ${newQty}개 (${item.orderQty}개 차감)`;
      } else {
        blankResult = '❌ 해당 컬러/사이즈 행 없음';
      }
    }

    // ② 전사지: 제품코드 매핑 → 수량 차감
    if (transSh && transSh.getLastRow() > 1) {
      const data = transSh.getRange(2,1,transSh.getLastRow()-1,4).getValues();
      const idx  = data.findIndex(r => String(r[0]).trim() === item.code);
      if (idx >= 0) {
        const cur    = Number(data[idx][2]) || 0;
        const newQty = Math.max(0, cur - item.orderQty);
        transSh.getRange(idx+2, 3).setValue(newQty);
        transResult = `${cur}매 → ${newQty}매 (${item.orderQty}매 차감)`;
      } else {
        transResult = '❌ 해당 제품코드 행 없음';
      }
    }

    results.push({
      code: item.code, color: item.color, size: item.size,
      qty: item.orderQty,
      blankResult, transResult,
      finStatus: item.finStatus,
      hasFinished: item.hasFinished,
    });
  });

  // 주문확인 시트: 차감완료 표시 + 초록 배경
  try {
    if (orderSh && orderSh.getLastRow() > 1) {
      const rows = orderSh.getRange(2,1,orderSh.getLastRow()-1,12).getValues();
      rows.forEach((r, i) => {
        if (!String(r[11]).includes('✅') || String(r[11]).includes('차감완료')) return;
        const match = selectedItems.find(it =>
          String(r[7]).trim() === it.code &&
          String(r[8]).trim() === it.color &&
          String(r[9]).trim() === it.size
        );
        if (match) {
          orderSh.getRange(i+2, 12).setValue('✅ 차감완료 ' + now);
          orderSh.getRange(i+2, 1, 1, 12).setBackground('#e8f5e9');
        }
      });
    }
  } catch(e) {}

  return { status: 'ok', results, timestamp: now };
}

// ════════════════════════════════════════════════════════
// 인쇄큐 → 단일 항목 차감 (print_queue.html 연동)
// POST action: deductItem
// body: { action:'deductItem', code, color, size, qty }
// ════════════════════════════════════════════════════════
function _deductItem(ss, code, color, size, qty) {
  const blankSh  = ss.getSheetByName(SHEET_NAMES.BLANK);
  const transSh  = ss.getSheetByName(SHEET_NAMES.TRANSFER);
  const orderSh  = ss.getSheetByName(SHEET_NAMES.ORDER);
  const now      = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  const result   = { blank:'', transfer:'', order:0 };

  // ① 무지상품재고 차감 (컬러 + 사이즈 매핑)
  if (blankSh && blankSh.getLastRow() > 1) {
    const data = blankSh.getRange(2,1,blankSh.getLastRow()-1,5).getValues();
    const idx  = data.findIndex(r =>
      String(r[1]).trim() === color && String(r[2]).trim() === size
    );
    if (idx >= 0) {
      const cur    = Number(data[idx][3]) || 0;
      const newQty = Math.max(0, cur - qty);
      blankSh.getRange(idx+2, 4).setValue(newQty);
      blankSh.getRange(idx+2, 7).setValue(now);
      result.blank = `${cur} → ${newQty}`;
    } else {
      result.blank = '해당 행 없음';
    }
  }

  // ② 전사지재고 차감 (제품코드 매핑)
  if (transSh && transSh.getLastRow() > 1) {
    const data = transSh.getRange(2,1,transSh.getLastRow()-1,4).getValues();
    const idx  = data.findIndex(r => String(r[0]).trim() === code);
    if (idx >= 0) {
      const cur    = Number(data[idx][2]) || 0;
      const newQty = Math.max(0, cur - qty);
      transSh.getRange(idx+2, 3).setValue(newQty);
      result.transfer = `${cur} → ${newQty}`;
    } else {
      result.transfer = '해당 행 없음';
    }
  }

  // ③ 주문확인(원본) 차감완료 마킹
  if (orderSh && orderSh.getLastRow() > 1) {
    const rows = orderSh.getRange(2,1,orderSh.getLastRow()-1,12).getValues();
    rows.forEach((r, i) => {
      if (
        String(r[7]).trim() === code &&
        String(r[8]).trim() === color &&
        String(r[9]).trim() === size &&
        String(r[11]).includes('✅') &&
        !String(r[11]).includes('차감완료')
      ) {
        orderSh.getRange(i+2, 12).setValue('✅ 차감완료 ' + now);
        orderSh.getRange(i+2, 1, 1, 12).setBackground('#e8f5e9');
        result.order++;
      }
    });
  }

  return result;
}

// ── 전사지 코드별 출력목록 자동 생성 ──
function generateTransferPrintList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSh = ss.getSheetByName(SHEET_NAMES.ORDER);
  const transSh = ss.getSheetByName(SHEET_NAMES.TRANSFER);

  if(!orderSh || !transSh) {
    SpreadsheetApp.getUi().alert('❌ 주문확인 또는 전사지재고 시트가 없습니다');
    return;
  }

  const orderData = orderSh.getLastRow() > 1
    ? orderSh.getRange(2, 1, orderSh.getLastRow()-1, 14).getValues()
    : [];

  const transData = transSh.getLastRow() > 1
    ? transSh.getRange(2, 1, transSh.getLastRow()-1, 5).getValues()
    : [];

  // Dark color (흰색 잉크가 필요한 색상)
  const DARK_COLORS = ['레드','검은색','바이올렛','블루','차콜','다홍','보라'];

  // 전사지 코드별 수량 합계 (색상별)
  let printList = {};

  orderData.forEach(r => {
    const transfer = String(r[13] || '').trim();
    const color = String(r[8] || '').trim();
    const qty = Number(r[10]) || 1;
    const status = String(r[11] || '').trim();

    if(!transfer || !color || !status.includes('✅')) return;

    const inkColor = DARK_COLORS.includes(color) ? '흰색' : '검은색';
    const key = `${transfer}|${inkColor}`;

    if(!printList[key]) {
      printList[key] = {code: transfer, inkColor: inkColor, totalQty: 0};
    }
    printList[key].totalQty += qty;
  });

  // 시트 생성
  const PRINT_SHEET = '전사지출력목록';
  let printSh = ss.getSheetByName(PRINT_SHEET);
  if(printSh) ss.deleteSheet(printSh);
  printSh = ss.insertSheet(PRINT_SHEET);

  // 헤더
  const headers = ['전사지코드', '필요잉크', '주문수량', '현재재고', '부족수량', '상태'];
  printSh.getRange(1, 1, 1, 6).setValues([headers])
    .setBackground('#4285f4')
    .setFontColor('#ffffff')
    .setFontWeight('bold');

  // 데이터 입력 (코드순 정렬)
  let row = 2;
  let totalNeeds = 0;

  Object.values(printList)
    .sort((a, b) => a.code.localeCompare(b.code))
    .forEach(item => {
      const transfer = item.code;
      const inkColor = item.inkColor;
      const orderQty = item.totalQty;

      // 재고에서 찾기
      const transRow = transData.find(t =>
        String(t[0]).trim() === transfer &&
        String(t[1]).trim() === inkColor
      );

      const currentStock = transRow ? Number(transRow[2]) || 0 : 0;
      const needsQty = Math.max(0, orderQty - currentStock);
      const status = needsQty === 0 ? '✅ 완매' : '🔴 인쇄필요';

      printSh.getRange(row, 1).setValue(transfer);
      printSh.getRange(row, 2).setValue(inkColor);
      printSh.getRange(row, 3).setValue(orderQty);
      printSh.getRange(row, 4).setValue(currentStock);
      printSh.getRange(row, 5).setValue(needsQty);
      printSh.getRange(row, 6).setValue(status);

      if(needsQty > 0) {
        printSh.getRange(row, 1, 1, 6).setBackground('#ffebee');
        totalNeeds += needsQty;
      } else {
        printSh.getRange(row, 1, 1, 6).setBackground('#f1f8e9');
      }

      row++;
    });

  // 컬럼 너비 조정
  printSh.setColumnWidths(1, 6, 100);

  SpreadsheetApp.getUi().alert(
    `✅ 전사지 출력목록 생성 완료!\n\n🔴 인쇄 필요: ${totalNeeds}개`
  );
}

// ── 완제품 시트 날짜/상태 자동 채우기 ──
function fillMissingFinishedDates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const finSh = ss.getSheetByName(SHEET_NAMES.FINISHED);

  if(!finSh || finSh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('❌ 완제품재고 탭에 데이터가 없습니다');
    return;
  }

  const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  const lastRow = finSh.getLastRow();

  // E칼럼(업데이트날짜), F칼럼(발견/미발견) 데이터 읽기
  const eData = finSh.getRange(2, 5, lastRow - 1, 1).getValues();
  const fData = finSh.getRange(2, 6, lastRow - 1, 1).getValues();

  let filledCount = 0;

  // E칼럼이 비어있는 행에 날짜 입력, F칼럼이 비어있으면 상태 입력
  for(let i = 0; i < eData.length; i++) {
    const eValue = String(eData[i][0]).trim();
    const fValue = String(fData[i][0]).trim();

    if(!eValue) {
      finSh.getRange(i + 2, 5).setValue(today);
      filledCount++;
    }

    if(!fValue) {
      finSh.getRange(i + 2, 6).setValue('✅ 완매');
    }
  }

  SpreadsheetApp.getUi().alert(`✅ 완료!\n${filledCount}행의 업데이트날짜를 오늘(${today})로 채웠습니다.`);
}
