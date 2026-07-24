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
 * ※ 고지서 PDF는 이제 GAS를 거치지 않고 프론트엔드(js/exporters/pdf.js)에서 jsPDF로 직접
 * 그린다 — 이 파일은 UrlFetchApp을 쓰지 않으므로 script.external_request 스코프도 불필요하다.
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
const ADMIN_HEADERS = ["아이디","비밀번호","이름","등록일시","실패횟수","잠금시점비밀번호"];
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
  sheet.getRange(start, 1).setValue(`${plant} (계약용량 ${capacity} kW)`).setFontWeight("bold").setBackground("#ECECEC");

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
 *
 * 5회 이상 비밀번호 오류 시 잠금: "관리자" 탭에 "실패횟수"/"잠금시점비밀번호" 두 컬럼을 추가로
 * 두면 동작한다(없으면 잠금 기능만 조용히 비활성화, 로그인 자체는 그대로 동작).
 * 담당자가 "비밀번호" 컬럼 값을 바꾸면, 잠긴 시점에 저장해둔 비밀번호와 달라지므로
 * 다음 로그인 시도부터 자동으로 잠금이 풀린다(별도 초기화 조작 불필요).
 */
function login_(body) {
  const id = String(body.id || "").trim();
  const pw = String(body.pw || "");
  if (!id || !pw) throw new Error("아이디/비밀번호를 입력하세요.");
  const sheet = getSheet_(SHEET_ADMIN);
  const rows = sheetToObjects_(sheet);
  const found = rows.find(r => String(r["아이디"]).trim() === id);
  if (!found) throw new Error("등록되지 않은 아이디입니다.");

  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const failCol = header.indexOf("실패횟수") + 1;
  const lockPwCol = header.indexOf("잠금시점비밀번호") + 1;
  const currentPw = String(found["비밀번호"]);
  const failCount = Number(found["실패횟수"]) || 0;
  const lockedAtPw = found["잠금시점비밀번호"] || "";

  if (failCol && lockPwCol && failCount >= 5 && lockedAtPw === currentPw) {
    throw new Error("비밀번호를 5회 이상 틀려 잠겼습니다. 담당자에게 문의해 비밀번호를 변경해주세요.");
  }

  if (currentPw !== pw) {
    if (failCol) {
      const newFailCount = failCount + 1;
      sheet.getRange(found._row, failCol).setValue(newFailCount);
      if (newFailCount >= 5 && lockPwCol) sheet.getRange(found._row, lockPwCol).setValue(currentPw);
    }
    throw new Error("비밀번호가 일치하지 않습니다.");
  }

  if (failCol) sheet.getRange(found._row, failCol).setValue(0);
  if (lockPwCol) sheet.getRange(found._row, lockPwCol).setValue("");
  return { name: found["이름"] || id };
}
