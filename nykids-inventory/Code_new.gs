// ============================================================
// 뉴욕꼬맹이 출고관리(쿠팡) — Google Apps Script
// 시트: SKU마스터 / 출고기록
// ============================================================

var SS_ID   = SpreadsheetApp.getActiveSpreadsheet().getId();
var SKU_TAB = 'SKU마스터';
var LOG_TAB = '출고기록';

function ok(data) {
  var output = ContentService.createTextOutput(JSON.stringify(Object.assign({ ok: true }, data)));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function err(msg) {
  Logger.log('ERROR: ' + msg);
  var output = ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg }));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ════════════════════════════════════════════════════════
// GET: ?action=lookup&barcode=R008333640100
// SKU마스터에서 바코드로 상품 정보 조회
// ════════════════════════════════════════════════════════
function doGet(e) {
  var p = e.parameter || {};
  if (p.action === 'lookup') {
    var bc = (p.barcode || '').trim();
    if (!bc) return err('barcode 파라미터 없음');
    var ss    = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(SKU_TAB);
    if (!sheet) return err('SKU마스터 시트 없음');
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === bc) {
        return ok({
          barcode: data[i][0],
          warehouse: data[i][1],
          name: data[i][2],
          orderQty: data[i][3]
        });
      }
    }
    return err('바코드 없음: ' + bc);
  }
  return err('action 파라미터 없음');
}

// ════════════════════════════════════════════════════════
// POST: 스캔 데이터 저장
// { barcode, warehouse, name, orderQty, box }
// { action:'delete', barcode, box }
// ════════════════════════════════════════════════════════
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); }
  catch(ex) {
    Logger.log('❌ JSON 파싱 오류: ' + e.postData.contents);
    return err('JSON 파싱 오류');
  }
  Logger.log('📨 수신: ' + JSON.stringify(body));
  var ss  = SpreadsheetApp.openById(SS_ID);
  var log = ss.getSheetByName(LOG_TAB);
  if (!log) {
    Logger.log('❌ 출고기록 시트 없음');
    return err('출고기록 시트 없음');
  }

  // 삭제 액션
  if (body.action === 'delete') {
    var rows = log.getDataRange().getValues();
    for (var i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][1]).trim() === String(body.barcode).trim() &&
          String(rows[i][4]).trim() === String(body.box).trim()) {
        log.deleteRow(i + 1);
        return ok({ deleted: true });
      }
    }
    return ok({ deleted: false });
  }

  // 스캔 데이터 저장
  // 컬럼: A=물류센터 | B=상품이름 | C=발주수량 | D=스캔수량 | E=확인(공식) | F=박스번호 | G=바코드원문
  var warehouse = body.warehouse || '';
  var name = body.name || '';
  var orderQty = body.orderQty || 0;
  var box = body.box || '';
  var barcode = body.barcode || '';
  var scannedQty = body.scannedQty || 0;

  // 같은 상품+박스 행이 이미 있으면 스킵 (중복 방지)
  var rows = log.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][1]).trim() === String(name).trim() &&
        String(rows[i][5]).trim() === String(box).trim()) {
      found = true;
      break;
    }
  }

  if (!found) {
    // 새 행 추가
    var newRow = [warehouse, name, orderQty, scannedQty, '', box, barcode];
    log.appendRow(newRow);

    // 확인 공식 추가 (E열)
    var lastRow = log.getLastRow();
    log.getRange(lastRow, 5).setFormula(
      '=IF(C' + lastRow + '=D' + lastRow + ',"✅","❌")'
    );
  }

  return ok({ saved: true });
}

// ════════════════════════════════════════════════════════
// 시트 초기 설정
// ════════════════════════════════════════════════════════
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // SKU마스터 시트
  var skuSheet = ss.getSheetByName(SKU_TAB) || ss.insertSheet(SKU_TAB);
  if (skuSheet.getLastRow() === 0) {
    skuSheet.appendRow(['상품바코드','물류센터','상품이름','발주수량']);
    var headerRange = skuSheet.getRange(1, 1, 1, 4);
    headerRange.setFontWeight('bold').setBackground('#1d4ed8').setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
    skuSheet.setColumnWidth(1, 160);
    skuSheet.setColumnWidth(2, 80);
    skuSheet.setColumnWidth(3, 400);
    skuSheet.setColumnWidth(4, 80);
    skuSheet.setFrozenRows(1);
  }

  // 출고기록 시트
  var logSheet = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['물류센터','상품이름','발주수량','스캔수량','확인','박스번호','바코드원문']);
    var headerRange = logSheet.getRange(1, 1, 1, 7);
    headerRange.setFontWeight('bold').setBackground('#16a34a').setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');
    logSheet.setColumnWidth(1, 100);
    logSheet.setColumnWidth(2, 380);
    logSheet.setColumnWidth(3, 80);
    logSheet.setColumnWidth(4, 80);
    logSheet.setColumnWidth(5, 60);
    logSheet.setColumnWidth(6, 100);
    logSheet.setColumnWidth(7, 160);
    logSheet.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert('✅ 시트 세팅 완료!\n\n📋 SKU마스터: PO 파일 데이터 입력\n📦 출고기록: Scanner에서 자동 기록');
}

// ════════════════════════════════════════════════════════
// 메뉴 추가
// ════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚚 출고관리')
    .addItem('⚙️ 시트 초기 설정', 'setupSheets')
    .addToUi();
}
