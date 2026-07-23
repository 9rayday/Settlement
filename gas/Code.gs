/**
 * Settlement 프로젝트 백엔드 (Google Apps Script Web App)
 *
 * 배포 절차:
 * 1. 대상 구글시트(https://docs.google.com/spreadsheets/d/10ulJzwqjxS6Gc-I6HsEtrljYn-OgBJ7q7yuhSY8u4Pg)를 연다.
 * 2. 확장 프로그램 > Apps Script 를 열고, 기본 Code.gs 내용을 이 파일 내용으로 전부 교체한다.
 * 3. 저장 후 상단 실행(▶) 드롭다운에서 setupSheets 함수를 한 번 실행해 필요한 탭(월별정산조정/월별실적로그/대시보드)을 생성한다.
 *    ("발전소 사업자 정보" 탭은 이미 수기로 만들어둔 컬럼 구조를 그대로 쓴다 — 아래 마스터 시트 컬럼 참고.)
 * 4. 코드 수정 후에는 배포 > 배포 관리 > 수정(연필 아이콘) > 새 버전으로 다시 배포해야 반영된다.
 *
 * 마스터 시트("발전소 사업자 정보") 컬럼 (이미 존재하는 시트, 헤더 텍스트는 공백/괄호 유무와 무관하게
 * pickField_() 가 유연하게 매칭한다):
 *   발전소명, 사업자명(대표자명), 사업자등록번호, 사업자주소, 계좌번호, 연락처,
 *   계약용량(kW), 발전보장시간(h/일), 계약단가(원/kWh), 계약일자, 계약해지일
 *
 * ※ renderInvoicePdf_ (고지서 PDF 내보내기)가 구글시트 자체 export URL을 호출하는데,
 * 이때 "권한이 부족합니다"/401/403 오류가 나면 Apps Script 편집기에서
 * 톱니바퀴(프로젝트 설정) > "appsscript.json 매니페스트 파일을 편집기에 표시" 체크 후,
 * appsscript.json에 아래 oauthScopes를 추가하고 다시 배포한다:
 *   "oauthScopes": [
 *     "https://www.googleapis.com/auth/spreadsheets",
 *     "https://www.googleapis.com/auth/script.external_request",
 *     "https://www.googleapis.com/auth/drive.readonly"
 *   ]
 */

const SHEET_ID = "10ulJzwqjxS6Gc-I6HsEtrljYn-OgBJ7q7yuhSY8u4Pg";
const SHEET_MASTER = "발전소 사업자 정보";
const SHEET_ADJUSTMENTS = "월별정산조정";
const SHEET_PERFORMANCE = "월별실적로그";
const SHEET_DASHBOARD = "대시보드";
const SHEET_YEARLY_GRID = "실적그리드";
const SHEET_ADMIN = "관리자";

const ADJUSTMENTS_HEADERS = ["정산월","발전소명","전월차액","전월미지급액","기타정산","저장일시"];
const PERFORMANCE_HEADERS = ["정산월","발전소명","발전량","공급량","초과발전량","기록일시"];
const ADMIN_HEADERS = ["아이디","비밀번호","이름","등록일시"];
const DASHBOARD_YEARS = 20;
const DEFAULT_GUARANTEE_HOURS = 3.4; // 발전보장시간이 비어있을 때 기본값

/* ============ Setup ============ */
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  ensureSheet_(ss, SHEET_MASTER, MASTER_FIELDS);
  ensureSheet_(ss, SHEET_ADJUSTMENTS, ADJUSTMENTS_HEADERS);
  ensureSheet_(ss, SHEET_PERFORMANCE, PERFORMANCE_HEADERS);
  ensureSheet_(ss, SHEET_DASHBOARD, ["발전소명","계약용량","발전보장시간","구분"]);
  ensureSheet_(ss, SHEET_ADMIN, ADMIN_HEADERS);
  getYearlyGridSheet_();
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findSheetFuzzy_(ss, name) {
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  const target = normalizeKey_(name);
  return ss.getSheets().find(s => normalizeKey_(s.getName()) === target) || null;
}

function getSheet_(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (name === SHEET_MASTER) {
    const existing = findSheetFuzzy_(ss, name);
    return existing || ensureSheet_(ss, name, MASTER_FIELDS);
  }
  if (name === SHEET_ADJUSTMENTS) return ensureSheet_(ss, name, ADJUSTMENTS_HEADERS);
  if (name === SHEET_PERFORMANCE) return ensureSheet_(ss, name, PERFORMANCE_HEADERS);
  if (name === SHEET_DASHBOARD) return ensureSheet_(ss, name, ["발전소명","계약용량","발전보장시간","구분"]);
  if (name === SHEET_ADMIN) return ensureSheet_(ss, name, ADMIN_HEADERS);
  const sheet = findSheetFuzzy_(ss, name);
  if (!sheet) {
    const actual = ss.getSheets().map(s => s.getName()).join(", ");
    throw new Error(`시트를 찾을 수 없습니다: "${name}" (실제 탭 목록: ${actual})`);
  }
  return sheet;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.every(v => v === "" || v === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);
    obj._row = i + 1;
    rows.push(obj);
  }
  return rows;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============ HTTP entry points ============ */
function doGet(e) {
  try {
    const action = e.parameter.action;
    if (action === "getMaster") return jsonOut_({ ok: true, data: getMaster_() });
    if (action === "getAdjustments") return jsonOut_({ ok: true, data: getAdjustments_(e.parameter.month, e.parameter.plant) });
    if (action === "getPerformanceHistory") return jsonOut_({ ok: true, data: getPerformanceHistory_(e.parameter.plant) });
    if (action === "getYearlyGrid") return jsonOut_({ ok: true, data: getYearlyGrid_(e.parameter.plant) });
    return jsonOut_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === "saveAdjustments") return jsonOut_({ ok: true, data: saveAdjustments_(body) });
    if (action === "logPerformance") return jsonOut_({ ok: true, data: logPerformance_(body) });
    if (action === "renderInvoicePdf") return jsonOut_({ ok: true, data: renderInvoicePdf_(body) });
    if (action === "login") return jsonOut_({ ok: true, data: login_(body) });
    return jsonOut_({ ok: false, error: "unknown action: " + action });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* ============ Master (헤더 공백/괄호 유무에 관계없이 유연하게 매칭) ============ */
function normalizeKey_(s) {
  return String(s).replace(/[\s()（）]/g, "");
}

function pickField_(row, canonical) {
  if (row[canonical] !== undefined) return row[canonical];
  const target = normalizeKey_(canonical);
  const key = Object.keys(row).find(k => normalizeKey_(k) === target);
  return key !== undefined ? row[key] : undefined;
}

const MASTER_FIELDS = ["발전소명","사업자명(대표자명)","사업자등록번호","사업자주소","계좌번호","연락처","계약용량","발전보장시간","계약단가","계약일자","계약해지일"];

// Date 셀은 JSON.stringify가 UTC로 변환하면서 자정 근처 날짜가 하루 밀릴 수 있어
// 스프레드시트 타임존 기준 "yyyy-MM-dd" 문자열로 먼저 고정한다.
function formatDateField_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return v;
}

function getMaster_() {
  const rows = sheetToObjects_(getSheet_(SHEET_MASTER));
  const byPlant = {};
  rows.forEach(r => {
    const out = {};
    MASTER_FIELDS.forEach(f => out[f] = formatDateField_(pickField_(r, f)));
    const key = out["발전소명"] ? String(out["발전소명"]).trim() : "";
    if (key) byPlant[key] = out;
  });
  return byPlant;
}

/* ============ Performance history (per plant, for 연간보장공급량 회차 계산) ============ */
function getPerformanceHistory_(plant) {
  const rows = sheetToObjects_(getSheet_(SHEET_PERFORMANCE));
  return rows
    .filter(r => r["발전소명"] === plant)
    .map(r => ({ month: String(r["정산월"]), supply: Number(r["공급량"]) || 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/* ============ Adjustments (upsert by 정산월+발전소명) ============ */
function getAdjustments_(month, plant) {
  const rows = sheetToObjects_(getSheet_(SHEET_ADJUSTMENTS));
  const found = rows.find(r => String(r["정산월"]) === String(month) && r["발전소명"] === plant);
  if (!found) return { 전월차액: 0, 전월미지급액: 0, 기타정산: 0 };
  return { 전월차액: found["전월차액"] || 0, 전월미지급액: found["전월미지급액"] || 0, 기타정산: found["기타정산"] || 0 };
}

function saveAdjustments_(body) {
  const sheet = getSheet_(SHEET_ADJUSTMENTS);
  const rows = sheetToObjects_(sheet);
  const found = rows.find(r => String(r["정산월"]) === String(body.month) && r["발전소명"] === body.plant);
  const now = new Date();
  const values = [body.month, body.plant, Number(body.prevDiff) || 0, Number(body.prevUnpaid) || 0, Number(body.otherSettle) || 0, now];
  if (found) {
    sheet.getRange(found._row, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  return { saved: true };
}

/* ============ Performance log (upsert by 정산월+발전소명) + dashboard refresh ============ */
function logPerformance_(body) {
  const sheet = getSheet_(SHEET_PERFORMANCE);
  const rows = sheetToObjects_(sheet);
  const now = new Date();
  const ss = SpreadsheetApp.openById(SHEET_ID);
  (body.rows || []).forEach(r => {
    const found = rows.find(x => String(x["정산월"]) === String(body.month) && x["발전소명"] === r.plant);
    const values = [body.month, r.plant, Number(r.generation) || 0, Number(r.supply) || 0, Number(r.excess) || 0, now];
    if (found) {
      sheet.getRange(found._row, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    // 실적그리드는 이 월의 셀 하나만 갱신한다 — 수동으로 보정해둔 다른 셀은 건드리지 않는다.
    upsertYearlyGridCell_(ss, r.plant, body.month, r.supply);
  });
  const cumulative = rebuildDashboard_();
  return { logged: (body.rows || []).length, cumulative: cumulative };
}

/* ============ Date helpers ============ */
function parseYearMonth_(s) {
  if (s instanceof Date) return { y: s.getFullYear(), m: s.getMonth() + 1 };
  const digits = String(s || "").replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  return { y: Number(digits.slice(0, 4)), m: Number(digits.slice(4, 6)) };
}
function addMonths_(ym, n) {
  const total = ym.y * 12 + (ym.m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}
function ymKey_(ym) { return String(ym.y) + String(ym.m).padStart(2, "0"); }

/**
 * 대시보드: 발전소별로 [연간보장공급량 / 실제공급량 / 차이] 3행 블록을 1차년도~20차년도 컬럼으로 구성.
 * 연간보장공급량 = 계약용량 × 발전보장시간 × 365, 이후 매 연차 0.5%씩 감소(원본 엑셀 공식과 동일 가정).
 * 계약해지일이 있으면 그 이후 연차는 비워둔다.
 */
function rebuildDashboard_() {
  const master = getMaster_();
  const perfRows = sheetToObjects_(getSheet_(SHEET_PERFORMANCE));
  const dashSheet = getSheet_(SHEET_DASHBOARD);

  dashSheet.getCharts().forEach(c => dashSheet.removeChart(c));
  dashSheet.clear();

  const header = ["발전소명", "계약용량", "발전보장시간", "구분"].concat(
    Array.from({ length: DASHBOARD_YEARS }, (_, i) => (i + 1) + "차년도")
  );
  dashSheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight("bold");
  dashSheet.setFrozenRows(1);

  const cumulativeByPlant = {};
  let row = 2;
  Object.keys(master).forEach(plant => {
    const m = master[plant];
    const capacity = Number(m["계약용량"]) || 0;
    const hours = Number(m["발전보장시간"]) || DEFAULT_GUARANTEE_HOURS;
    const startYm = parseYearMonth_(m["계약일자"]);
    const endYm = parseYearMonth_(m["계약해지일"]);
    const perfForPlant = perfRows.filter(p => p["발전소명"] === plant);
    cumulativeByPlant[plant] = perfForPlant.reduce((s, p) => s + (Number(p["공급량"]) || 0), 0);

    const guaranteeRow = [], actualRow = [], diffRow = [];
    let yearlyExpected = capacity * hours * 365;
    for (let y = 1; y <= DASHBOARD_YEARS; y++) {
      if (y > 1) yearlyExpected = yearlyExpected - yearlyExpected * 0.005;
      if (!startYm || !capacity) { guaranteeRow.push(""); actualRow.push(""); diffRow.push(""); continue; }
      const windowStart = addMonths_(startYm, (y - 1) * 12);
      if (endYm && ymKey_(windowStart) > ymKey_(endYm)) { guaranteeRow.push(""); actualRow.push(""); diffRow.push(""); continue; }
      const windowEnd = addMonths_(startYm, y * 12 - 1);
      const inWindow = perfForPlant.filter(p => {
        const ym = String(p["정산월"]);
        return ym >= ymKey_(windowStart) && ym <= ymKey_(windowEnd);
      });
      const actualY = inWindow.length ? inWindow.reduce((s, p) => s + (Number(p["공급량"]) || 0), 0) : "";
      guaranteeRow.push(Math.round(yearlyExpected));
      actualRow.push(actualY === "" ? "" : Math.round(actualY));
      diffRow.push(actualY === "" ? "" : Math.round(yearlyExpected - actualY));
    }

    dashSheet.getRange(row, 1, 3, 4).setValues([
      [plant, capacity, hours, "연간보장공급량"],
      ["", "", "", "실제공급량"],
      ["", "", "", "차이"]
    ]);
    dashSheet.getRange(row, 5, 1, DASHBOARD_YEARS).setValues([guaranteeRow]);
    dashSheet.getRange(row + 1, 5, 1, DASHBOARD_YEARS).setValues([actualRow]);
    dashSheet.getRange(row + 2, 5, 1, DASHBOARD_YEARS).setValues([diffRow]);
    dashSheet.getRange(row, 1, 3, 1).mergeVertically();
    dashSheet.getRange(row, 2, 3, 1).mergeVertically();
    dashSheet.getRange(row, 3, 3, 1).mergeVertically();

    const chart = dashSheet.newChart()
      .asColumnChart()
      .addRange(dashSheet.getRange(1, 5, 1, DASHBOARD_YEARS))
      .addRange(dashSheet.getRange(row, 5, 1, DASHBOARD_YEARS))
      .addRange(dashSheet.getRange(row + 1, 5, 1, DASHBOARD_YEARS))
      .setTransposeRowsAndColumns(true)
      .setPosition(row, header.length + 2, 0, 0)
      .setOption("title", plant + " - 연간보장 vs 실제 공급량")
      .setOption("legend", { position: "top" })
      .build();
    dashSheet.insertChart(chart);

    row += 3;
  });

  return cumulativeByPlant;
}

/* ============ 실적그리드 (발전소별 연차 x 월 실적, 수동 보정 가능) ============
 * "실적그리드" 탭에 발전소마다 23행짜리 블록을 아래로 쌓는다:
 *   R      : 타이틀 ("{발전소명} (계약용량 {kW} kW)", A:M 병합)
 *   R+1    : 헤더 (A="연차", B~M="1월"~"12월")
 *   R+2~21 : 연차 1~20 데이터 행 (A=연차 번호, B~M=해당 연차 1~12번째 달 공급량)
 *   R+22   : 빈 줄(다음 블록과 구분)
 * 업로드 시에는 해당 월 셀 하나만 덮어써서, 시트에서 수동으로 고친 다른 셀은 보존한다.
 * 정산서의 "실제 공급량 누계"는 이 그리드를 읽어서 계산한다(js/invoice.js의 buildGuaranteeSchedule).
 */
function getYearlyGridSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_YEARLY_GRID);
  if (!sheet) sheet = ss.insertSheet(SHEET_YEARLY_GRID);
  return sheet;
}

function findPlantBlockRow_(sheet, plant) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  const prefix = plant + " (";
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).indexOf(prefix) === 0) return i + 1;
  }
  return null;
}

// 계약일자(startYm) 기준으로 month(예: "202606")가 몇 차년도(k, 1~20)의 몇 번째 달(pos, 0~11)인지 계산.
// 계약일자 이전이거나 20차년도를 넘어가면 null.
function findYearPos_(startYm, month) {
  if (!startYm) return null;
  const ym = parseYearMonth_(month);
  if (!ym) return null;
  const totalMonths = (ym.y - startYm.y) * 12 + (ym.m - startYm.m);
  if (totalMonths < 0) return null;
  const k = Math.floor(totalMonths / 12) + 1;
  if (k > 20) return null;
  return { k: k, pos: totalMonths % 12 };
}

function ensurePlantBlock_(sheet, plant, m) {
  const existing = findPlantBlockRow_(sheet, plant);
  if (existing) return existing;

  const lastRow = sheet.getLastRow();
  const start = lastRow > 0 ? lastRow + 1 : 1;
  const capacity = Number(m["계약용량"]) || 0;

  sheet.getRange(start, 1, 1, 13).merge();
  sheet.getRange(start, 1).setValue(`${plant} (계약용량 ${capacity} kW)`).setFontWeight("bold").setBackground(G_LIGHT);

  const headerRow = ["연차"].concat(Array.from({ length: 12 }, (_, i) => (i + 1) + "월"));
  sheet.getRange(start + 1, 1, 1, 13).setValues([headerRow]).setFontWeight("bold");

  const yearCol = Array.from({ length: 20 }, (_, i) => [i + 1]);
  sheet.getRange(start + 2, 1, 20, 1).setValues(yearCol);

  // 기존 월별실적로그에 이미 쌓인 과거 데이터로 최초 백필 (이후로는 upsertYearlyGridCell_이 셀 단위로만 갱신)
  const startYm = parseYearMonth_(m["계약일자"]);
  if (startYm) {
    const history = sheetToObjects_(getSheet_(SHEET_PERFORMANCE)).filter(r => r["발전소명"] === plant);
    history.forEach(r => {
      const pos = findYearPos_(startYm, r["정산월"]);
      if (pos) sheet.getRange(start + 2 + (pos.k - 1), 2 + pos.pos).setValue(Number(r["공급량"]) || 0);
    });
  }

  return start;
}

function upsertYearlyGridCell_(ss, plant, month, supply) {
  const master = getMaster_();
  const m = master[plant];
  if (!m) return; // 마스터에 없는 발전소명이면 연차 계산 불가 — 조용히 건너뜀
  const startYm = parseYearMonth_(m["계약일자"]);
  const pos = findYearPos_(startYm, month);
  if (!pos) return;
  const sheet = getYearlyGridSheet_();
  const start = ensurePlantBlock_(sheet, plant, m);
  sheet.getRange(start + 2 + (pos.k - 1), 2 + pos.pos).setValue(Number(supply) || 0);
}

function getYearlyGrid_(plant) {
  const sheet = getYearlyGridSheet_();
  const start = findPlantBlockRow_(sheet, plant);
  if (!start) return {};
  const values = sheet.getRange(start + 2, 2, 20, 12).getValues();
  const out = {};
  values.forEach((row, i) => {
    out[String(i + 1)] = row.map(v => (v === "" || v === null ? null : Number(v)));
  });
  return out;
}

// 편집기에서 수동 실행: 최초 롤아웃 시 모든 발전소의 실적그리드 블록을 월별실적로그 데이터로 채워준다.
function backfillYearlyGrid() {
  const sheet = getYearlyGridSheet_();
  const master = getMaster_();
  Object.keys(master).forEach(plant => ensurePlantBlock_(sheet, plant, master[plant]));
}

/* ============ 로그인 (구글시트 "관리자" 탭 대조) ============
 * 가벼운 화면 진입 잠금이다 — 웹앱이 ANYONE_ANONYMOUS로 배포되어 있어 URL을 아는 사람은
 * 로그인 여부와 무관하게 doGet/doPost를 직접 호출할 수 있다. 진짜 보안 경계가 아님에 유의.
 * 계정은 "관리자" 탭에 아이디/비밀번호를 평문으로 직접 입력해서 관리한다(별도 함수 실행 불필요).
 */
function login_(body) {
  const id = String(body.id || "").trim();
  const pw = String(body.pw || "");
  if (!id || !pw) throw new Error("아이디/비밀번호를 입력하세요.");
  const rows = sheetToObjects_(getSheet_(SHEET_ADMIN));
  const found = rows.find(r => String(r["아이디"]).trim() === id);
  if (!found) throw new Error("등록되지 않은 아이디입니다.");
  if (String(found["비밀번호"]) !== pw) throw new Error("비밀번호가 일치하지 않습니다.");
  return { name: found["이름"] || id };
}

/* ============ Invoice PDF rendering ============
 * "프론트엔드가 계산, GAS는 그리기만" 원칙: js/invoice.js의 calcInvoice()/buildGuaranteeSchedule()가
 * 이미 계산해둔 최종 값만 받아서 시트에 배치 + 스타일링한 뒤 구글시트 자체 PDF 내보내기로 변환한다.
 * 레이아웃(열너비/행높이/배색/병합/테두리)은 js/exporters/excel.js의 buildInvoiceSheet()와 동일하게
 * 유지해야 한다 — 고지서 디자인을 바꾸면 두 파일을 함께 고칠 것.
 */
const PDF_HELPER_SHEET = "고지서 출력용";
const G_DARK = "#595959";
const G_LIGHT = "#ECECEC";
const G_BORDER = "#C6CCD6";
const G_RED = "#C00000";
const G_EDITABLE = "#FFFDF4";
const G_BUYER = {
  bizName: "한화신한테라와트아워 (김 한 성)",
  bizNameLegal: "한화신한테라와트아워 주식회사",
  bizRegNo: "243-81-02905",
  address: "서울특별시 중구 삼일대로 363 1107호\n(장교동, 장교빌딩)",
  manager: "홍인성 프로",
  contact: "02-318-2309 / insunghong@hanwha.com",
  invoicePrefix: "300025"
};
// assets/logo.jpg를 base64로 인코딩해 고정(코드 두 곳 — excel.js는 fetch, 여기는 GAS라 base64로 내장).
const LOGO_BASE64 = "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";

function chToPx_(ch) { return Math.round(ch * 7 + 5); }
function ptToPx_(pt) { return Math.round(pt * 96 / 72); }

function gStyle_(sheet, r1, c1, r2, c2, opts) {
  opts = opts || {};
  const range = sheet.getRange(r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  range.setBorder(true, true, true, true, false, false, G_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  range.setBackground(opts.bg || "#FFFFFF");
  range.setFontFamily("Arial");
  range.setFontSize(opts.fontSize || 10);
  range.setFontWeight(opts.bold ? "bold" : "normal");
  range.setFontStyle(opts.italic ? "italic" : "normal");
  range.setFontColor(opts.color || "#000000");
  range.setHorizontalAlignment(opts.align || "center");
  range.setVerticalAlignment("middle");
  range.setWrap(true);
  if (opts.numFmt) range.setNumberFormat(opts.numFmt);
  return range;
}
function gSection_(sheet, r1, r2, text) {
  gStyle_(sheet, r1, 2, r2, 2, { bg: G_DARK, bold: true, color: "#FFFFFF" });
  sheet.getRange(r1, 2).setValue(text);
  if (r2 > r1) sheet.getRange(r1, 2, r2 - r1 + 1, 1).merge();
}
function gLabel_(sheet, r, c, text) {
  sheet.getRange(r, c).setValue(text);
  gStyle_(sheet, r, c, r, c, { bg: G_LIGHT, bold: true, color: "#4A4A4A" });
}
function gValue_(sheet, r, c, value, opts) {
  if (value !== undefined && value !== null && value !== "") sheet.getRange(r, c).setValue(value);
  // 이미 gMerge2_로 병합된 셀이면 앵커 주소 1칸만 재스타일링할 경우 병합 범위를 완전히
  // 덮지 않아 테두리가 undefined 동작(오른쪽 테두리 소실)을 일으킨다 — 병합 전체 범위를 찾아 스타일링한다.
  const merged = sheet.getRange(r, c).getMergedRanges();
  if (merged.length) {
    const mr = merged[0];
    gStyle_(sheet, mr.getRow(), mr.getColumn(), mr.getLastRow(), mr.getColumn() + mr.getNumColumns() - 1, opts);
  } else {
    gStyle_(sheet, r, c, r, c, opts);
  }
}
function gMerge2_(sheet, r, c1, c2) {
  gStyle_(sheet, r, c1, r, c2, {});
  sheet.getRange(r, c1, 1, c2 - c1 + 1).merge();
}

// 편집기 실행 드롭다운에서 UrlFetchApp 권한 동의 팝업을 띄우기 위한 테스트용 래퍼.
// (이름에 _가 붙은 함수는 드롭다운에 안 보여서 별도로 둠)
function testRenderInvoicePdf() {
  renderInvoicePdf_({});
}

function renderInvoicePdf_(body) {
  body = body || {}; // 편집기에서 인자 없이 "실행"으로 돌려서 UrlFetchApp 권한 동의를 받기 위한 방어 코드
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(PDF_HELPER_SHEET);
  if (!sheet) sheet = ss.insertSheet(PDF_HELPER_SHEET);
  sheet.getCharts().forEach(c => sheet.removeChart(c));
  sheet.getImages().forEach(img => img.remove());
  sheet.clear();
  sheet.clearFormats();

  const plant = body.plant || "";
  const month = String(body.month || "");
  const m = body.master || {};
  const site = body.siteTotals || {};
  const agg = body.plantAgg || {};
  const calc = body.calc || {};
  const adj = calc.adj || {};
  const schedule = body.schedule || [];
  const lossRate = Number(body.lossRate) || 0;

  sheet.setColumnWidth(1, chToPx_(1.58));
  for (let c = 2; c <= 8; c++) sheet.setColumnWidth(c, chToPx_(23.08));
  sheet.setColumnWidth(9, chToPx_(1.58));

  // 열너비(23.08자×7칸, test.xlsx 실측값)는 고정, 행 높이만 축소했다.
  // 원래 값(GAP 9.9/CONTENT 34/TALL 46, 총 높이 약 1909pt)은 세로가 A4 폭 비율보다 훨씬 길어서
  // scale=4(페이지에 맞추기)로 축소하면 좌우 여백이 상하 여백보다 훨씬 커지는 문제가 있었다(약 68%로 축소, excel.js와 동일 비율 유지).
  const GAP_ROWS = [8, 14, 27, 32, 54, 59];
  const TALL_ROWS = [6, 7, 29, 56, 57, 58];
  sheet.setRowHeight(1, ptToPx_(7));
  for (let r = 2; r <= 59; r++) {
    if (GAP_ROWS.indexOf(r) >= 0) sheet.setRowHeight(r, ptToPx_(6.8));
    else if (TALL_ROWS.indexOf(r) >= 0) sheet.setRowHeight(r, ptToPx_(31));
    else sheet.setRowHeight(r, ptToPx_(23));
  }

  try {
    const logoBlob = Utilities.newBlob(Utilities.base64Decode(LOGO_BASE64), "image/jpeg", "logo.jpg");
    const logoImg = sheet.insertImage(logoBlob, 2, 2, 8, 8);
    logoImg.setWidth(212).setHeight(38); // excel.js의 ext:{width:212,height:38}과 동일 크기로 맞춤
  } catch (e) { /* 로고 삽입 실패해도 나머지는 계속 진행 */ }

  sheet.getRange(2, 2, 1, 7).merge();
  sheet.getRange(2, 2).setValue("직접PPA 전력거래대금 정산서")
    .setFontWeight("bold").setFontSize(16).setFontColor("#4A4A4A")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  const monthLabel = month.length >= 6 ? `${month.slice(0, 4)}년 ${month.slice(4, 6)}월 거래분` : "";
  sheet.getRange(3, 2, 1, 7).merge();
  sheet.getRange(3, 2).setValue(`(${monthLabel})`)
    .setFontStyle("italic").setFontSize(13).setFontColor("#5B6675")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");

  gSection_(sheet, 5, 7, "발전사업자\n정보");
  gLabel_(sheet, 5, 3, "사업자명 (대표자명)"); gMerge2_(sheet, 5, 4, 5); gValue_(sheet, 5, 4, m["사업자명(대표자명)"] || "입력 예정", { bg: m["사업자명(대표자명)"] ? null : G_EDITABLE });
  gLabel_(sheet, 5, 6, "사업자등록번호"); gMerge2_(sheet, 5, 7, 8); gValue_(sheet, 5, 7, m["사업자등록번호"] || "입력 예정", { bg: m["사업자등록번호"] ? null : G_EDITABLE });
  gLabel_(sheet, 6, 3, "사업자 주소"); gMerge2_(sheet, 6, 4, 5); gValue_(sheet, 6, 4, m["사업자주소"] || "입력 예정", { bg: m["사업자주소"] ? null : G_EDITABLE });
  gLabel_(sheet, 6, 6, "계좌번호"); gMerge2_(sheet, 6, 7, 8); gValue_(sheet, 6, 7, m["계좌번호"] || "입력 예정", { bg: m["계좌번호"] ? null : G_EDITABLE });
  gLabel_(sheet, 7, 3, "발전소명"); gMerge2_(sheet, 7, 4, 5); gValue_(sheet, 7, 4, plant, {});
  const contact = [m["담당자"], m["연락처"]].filter(Boolean).join(" / ");
  gLabel_(sheet, 7, 6, "연락처"); gMerge2_(sheet, 7, 7, 8); gValue_(sheet, 7, 7, contact || "입력 예정", { bg: contact ? null : G_EDITABLE });

  const kwh = { numFmt: '#,##0.00" kWh"' };
  gSection_(sheet, 9, 13, "전력\n거래\n내역");
  gLabel_(sheet, 9, 3, "총 전기사용량"); gMerge2_(sheet, 9, 4, 5); gValue_(sheet, 9, 4, Number(site.usage) || 0, kwh);
  gLabel_(sheet, 9, 6, "총 발전량"); gMerge2_(sheet, 9, 7, 8); gValue_(sheet, 9, 7, Number(site.generation) || 0, kwh);
  gLabel_(sheet, 10, 3, "전력손실률"); gMerge2_(sheet, 10, 4, 5); gValue_(sheet, 10, 4, lossRate, { numFmt: "0.00%" });
  gLabel_(sheet, 10, 6, "총 공급량"); gMerge2_(sheet, 10, 7, 8); gValue_(sheet, 10, 7, Number(site.supply) || 0, kwh);
  gLabel_(sheet, 11, 3, "총 초과발전량"); gMerge2_(sheet, 11, 4, 5); gValue_(sheet, 11, 4, Number(site.excess) || 0, kwh);
  gLabel_(sheet, 11, 6, "총 부족전력량"); gMerge2_(sheet, 11, 7, 8); gValue_(sheet, 11, 7, Number(site.deficit) || 0, kwh);
  gLabel_(sheet, 12, 3, "해당 발전소 발전량"); gMerge2_(sheet, 12, 4, 5); gValue_(sheet, 12, 4, Number(agg.generation) || 0, kwh);
  gLabel_(sheet, 12, 6, "해당 발전소 공급량"); gMerge2_(sheet, 12, 7, 8); gValue_(sheet, 12, 7, Number(agg.supply) || 0, kwh);
  gLabel_(sheet, 13, 3, "해당 발전소 초과발전량"); gMerge2_(sheet, 13, 4, 5); gValue_(sheet, 13, 4, Number(agg.excess) || 0, kwh);
  gLabel_(sheet, 13, 6, "-"); gMerge2_(sheet, 13, 7, 8); gValue_(sheet, 13, 7, "-", {});

  gSection_(sheet, 15, 26, "정산\n내역");
  gMerge2_(sheet, 15, 5, 8);
  [[15, 3, "항목"], [15, 4, "금액"], [15, 5, "산출 근거"]].forEach(([r, c, t]) => gValue_(sheet, r, c, t, { bg: G_DARK, bold: true, color: "#FFFFFF" }));

  const won = { numFmt: '#,##0" 원"' };
  const basis = (r, c) => gStyle_(sheet, r, c, r, c, {});
  gValue_(sheet, 16, 3, "전력량 요금", {}); gValue_(sheet, 16, 4, Number(calc.energyFee) || 0, won);
  gValue_(sheet, 16, 5, "( =", {}); basis(16, 5); gValue_(sheet, 16, 6, Number(calc.supply) || 0, kwh); gValue_(sheet, 16, 7, "x", {}); basis(16, 7); gValue_(sheet, 16, 8, Number(calc.unitPrice) || 0, { numFmt: '0.0" 원/KWh"' });
  gValue_(sheet, 17, 3, "공급가액", {}); gValue_(sheet, 17, 4, Number(calc.supplyValue) || 0, won);
  gValue_(sheet, 18, 3, "부가가치세", {}); gValue_(sheet, 18, 4, Number(calc.vat1) || 0, won);
  gValue_(sheet, 18, 5, "( =", {}); basis(18, 5); gValue_(sheet, 18, 6, Number(calc.supplyValue) || 0, won); gValue_(sheet, 18, 7, "x", {}); basis(18, 7); gValue_(sheet, 18, 8, 0.1, { numFmt: "0.00%" });
  gValue_(sheet, 19, 3, "계", { bold: true }); gValue_(sheet, 19, 4, Number(calc.subtotal1) || 0, Object.assign({}, won, { bold: true }));
  gValue_(sheet, 20, 3, "거래수수료", {}); gValue_(sheet, 20, 4, Number(calc.fee) || 0, won);
  gValue_(sheet, 20, 5, "( =", {}); basis(20, 5); gValue_(sheet, 20, 6, Number(calc.supply) || 0, kwh); gValue_(sheet, 20, 7, "x", {}); basis(20, 7); gValue_(sheet, 20, 8, Number(calc.feeRate) || 0, { numFmt: '0.0000" 원/KWh"' });
  gValue_(sheet, 21, 3, "부가가치세", {}); gValue_(sheet, 21, 4, Number(calc.vat2) || 0, won);
  gValue_(sheet, 21, 5, "( =", {}); basis(21, 5); gValue_(sheet, 21, 6, Number(calc.fee) || 0, won); gValue_(sheet, 21, 7, "x", {}); basis(21, 7); gValue_(sheet, 21, 8, 0.1, { numFmt: "0.00%" });
  gValue_(sheet, 22, 3, "계", { bold: true }); gValue_(sheet, 22, 4, Number(calc.subtotal2) || 0, Object.assign({}, won, { bold: true }));
  gValue_(sheet, 23, 3, "전월 차액", {}); gValue_(sheet, 23, 4, Number(adj.전월차액) || 0, won);
  gValue_(sheet, 23, 5, "( =", {}); basis(23, 5); gValue_(sheet, 23, 6, Number(adj.전월차액) || 0, won); gValue_(sheet, 23, 7, "-", {}); basis(23, 7); gValue_(sheet, 23, 8, 0, won);
  gValue_(sheet, 24, 3, "전월 미지급액", {}); gValue_(sheet, 24, 4, Number(adj.전월미지급액) || 0, won);
  gValue_(sheet, 24, 5, "( =", {}); basis(24, 5); gValue_(sheet, 24, 6, Number(adj.전월미지급액) || 0, won); gValue_(sheet, 24, 7, "-", {}); basis(24, 7); gValue_(sheet, 24, 8, 0, won);
  gValue_(sheet, 25, 3, "기타정산", {}); gValue_(sheet, 25, 4, Number(adj.기타정산) || 0, won);
  gValue_(sheet, 26, 3, "지급금액", { bold: true, fontSize: 11 }); gMerge2_(sheet, 26, 5, 8); gValue_(sheet, 26, 4, Number(calc.payment) || 0, Object.assign({}, won, { bold: true, fontSize: 11 }));

  gSection_(sheet, 28, 31, "정산\n정보");
  gLabel_(sheet, 28, 3, "사업자명 (대표자명)"); gMerge2_(sheet, 28, 4, 5); gValue_(sheet, 28, 4, G_BUYER.bizName, {});
  gLabel_(sheet, 28, 6, "사업자등록번호"); gMerge2_(sheet, 28, 7, 8); gValue_(sheet, 28, 7, G_BUYER.bizRegNo, {});
  gLabel_(sheet, 29, 3, "주소"); gMerge2_(sheet, 29, 4, 8); gValue_(sheet, 29, 4, G_BUYER.address, {});
  gLabel_(sheet, 30, 3, "담당자"); gMerge2_(sheet, 30, 4, 5); gValue_(sheet, 30, 4, G_BUYER.manager, {});
  gLabel_(sheet, 30, 6, "연락처"); gMerge2_(sheet, 30, 7, 8); gValue_(sheet, 30, 7, G_BUYER.contact, {});
  gLabel_(sheet, 31, 3, "정산서번호"); gMerge2_(sheet, 31, 4, 5); gValue_(sheet, 31, 4, `${G_BUYER.invoicePrefix}-${month}-0001`, {});
  gLabel_(sheet, 31, 6, "납부기한"); gMerge2_(sheet, 31, 7, 8); gValue_(sheet, 31, 7, "계산서 발행 후 5영업일 내", {});

  gSection_(sheet, 33, 33 + schedule.length, "연간\n보장\n공급량");
  gLabel_(sheet, 33, 3, "회차"); gLabel_(sheet, 33, 4, "예상 공급량"); gLabel_(sheet, 33, 5, "실제 공급량 누계"); gLabel_(sheet, 33, 6, "미달 공급량"); gLabel_(sheet, 33, 7, "미달 구매량"); gLabel_(sheet, 33, 8, "비고");
  schedule.forEach((row, i) => {
    const r = 34 + i;
    gValue_(sheet, r, 3, row.k + "회차 " + row.label, {});
    gValue_(sheet, r, 4, row.expected != null ? row.expected : "-", row.expected != null ? kwh : {});
    gValue_(sheet, r, 5, row.actualCum != null ? row.actualCum : "-", row.actualCum != null ? kwh : {});
    gValue_(sheet, r, 6, "-", {}); gValue_(sheet, r, 7, "-", {}); basis(r, 8);
  });

  const today = new Date();
  const todayLabel = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy'년 'MM'월 'dd'일'");
  const monthPlain = month.length >= 6 ? `${month.slice(0, 4)}년 ${month.slice(4, 6)}월` : "";
  const bizNameOnly = (m["사업자명(대표자명)"] || plant).split("(")[0].trim();

  sheet.getRange(55, 2, 1, 7).merge();
  sheet.getRange(55, 2).setValue(todayLabel).setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setVerticalAlignment("middle");

  const mergeText = (r, c1, c2, text, opts) => {
    sheet.getRange(r, c1, 1, c2 - c1 + 1).merge();
    const cell = sheet.getRange(r, c1).setValue(text).setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
    cell.setFontSize(opts.fontSize || 10);
    cell.setFontWeight(opts.bold ? "bold" : "normal");
  };
  mergeText(56, 2, 4, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 확인합니다.`, { fontSize: 11 });
  mergeText(56, 6, 8, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 지급합니다.`, { fontSize: 11 });
  mergeText(57, 2, 4, "발전사업자", { fontSize: 12, bold: true });
  mergeText(57, 6, 8, "재생에너지전기공급사업자", { fontSize: 12, bold: true });
  mergeText(58, 2, 4, `${bizNameOnly} (인)`, { fontSize: 16, bold: true });
  mergeText(58, 6, 8, `${G_BUYER.bizNameLegal} (인)`, { fontSize: 16, bold: true });

  // 55~58행: 표 테두리 없이 깔끔하게, 좌우 서명 블록 사이만 점선 구분선
  sheet.getRange(55, 2, 4, 7).setBorder(false, false, false, false, false, false);
  for (let r = 56; r <= 58; r++) {
    sheet.getRange(r, 5).setBorder(null, null, null, true, null, null, "#4A4A4A", SpreadsheetApp.BorderStyle.DOTTED);
  }

  // 12~13행("해당 발전소 ~") 바깥쪽만 빨간 테두리
  sheet.getRange(12, 3, 1, 6).setBorder(true, null, null, null, null, null, G_RED, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(13, 3, 1, 6).setBorder(null, null, true, null, null, null, G_RED, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(12, 3, 2, 1).setBorder(null, true, null, null, null, null, G_RED, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(12, 8, 2, 1).setBorder(null, null, null, true, null, null, G_RED, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // A1:I59 외곽 굵은 테두리
  // vertical/horizontal은 null로 둬서 이미 그려둔 내부 셀 테두리를 건드리지 않는다(false를 주면 내부 테두리가 전부 지워짐).
  sheet.getRange(1, 1, 59, 9).setBorder(true, true, true, true, null, null, "#4A4A4A", SpreadsheetApp.BorderStyle.SOLID_THICK);

  sheet.setFrozenRows(0);
  SpreadsheetApp.flush();

  // scale=4 = "페이지에 맞추기"(가로/세로 모두 한 페이지). fitw/fith 파라미터는 실제로 동작하지 않아
  // 원본 크기 그대로 내보내져서 2페이지로 잘렸었다.
  const url = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/export"
    + "?format=pdf&gid=" + sheet.getSheetId()
    + "&size=A4&portrait=true&scale=4"
    + "&horizontal_centered=true&vertical_centered=true"
    + "&top_margin=0.35&bottom_margin=0.35&left_margin=0.35&right_margin=0.35"
    + "&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED";
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("PDF export 실패 (HTTP " + res.getResponseCode() + ")");
  }
  const pdfBase64 = Utilities.base64Encode(res.getBlob().getBytes());
  return { pdfBase64: pdfBase64 };
}
