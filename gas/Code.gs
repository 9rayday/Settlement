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
 *   + (등록 화면에서 저장할 때 없으면 맨 끝에 자동 추가) MASTER_FIELDS 의 나머지 컬럼
 *     (배전연결 Y/N = 화면의 "발전망" 배전망/송전망, 계약용량 = 설비용량, 계약일자 = 계약시작일, 연락처 = 전화번호)
 *
 * 전기사용자 시트("전기사용자 정보"): CUSTOMER_FIELDS. 탭0 등록 화면이 행 단위로 저장/삭제한다.
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
const SHEET_STORE = "앱데이터";
const SHEET_CUSTOMERS = "전기사용자 정보";

const ADJUSTMENTS_HEADERS = ["정산월","발전소명","전월차액","전월미지급액","기타정산","저장일시"];
const PERFORMANCE_HEADERS = ["정산월","발전소명","발전량","공급량","초과발전량","기록일시"];
const STORE_HEADERS = ["키","값","저장일시"];
const ADMIN_HEADERS = ["아이디","비밀번호","이름","권한","실패횟수","잠금","최근로그인","등록일시"];
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
  ensureSheet_(ss, SHEET_STORE, STORE_HEADERS);
  ensureSheet_(ss, SHEET_CUSTOMERS, CUSTOMER_FIELDS);
  getYearlyGridSheet_();
  installEditTrigger_(); // 시트 직접 수정 시 대시보드 자동 갱신
  rebuildDashboard_();
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
  if (name === SHEET_STORE) return ensureSheet_(ss, name, STORE_HEADERS);
  if (name === SHEET_CUSTOMERS) return ensureSheet_(ss, name, CUSTOMER_FIELDS);
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
    session_(e.parameter.token); // 모든 조회는 로그인 필요
    if (action === "getMaster") return jsonOut_({ ok: true, data: getMaster_() });
    if (action === "getAdjustments") return jsonOut_({ ok: true, data: getAdjustments_(e.parameter.month, e.parameter.plant) });
    if (action === "getPerformanceHistory") return jsonOut_({ ok: true, data: getPerformanceHistory_(e.parameter.plant) });
    if (action === "getStoreAll") return jsonOut_({ ok: true, data: getStoreAll_(e.parameter.since) });
    if (action === "getStoreRange") return jsonOut_({ ok: true, data: getStoreRange_(e.parameter.from, e.parameter.to) });
    if (action === "getCustomers") return jsonOut_({ ok: true, data: getCustomers_() });
    if (action === "getPerformanceAll") return jsonOut_({ ok: true, data: getPerformanceAll_() });
    if (action === "bootstrap") return jsonOut_({ ok: true, data: { master: getMaster_(), customers: getCustomers_(), store: getStoreAll_(e.parameter.since), performance: getPerformanceAll_() } });
    if (action === "getPerformanceMonth") return jsonOut_({ ok: true, data: getPerformanceMonth_(e.parameter.month) });
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
    if (action === "login") return jsonOut_({ ok: true, data: login_(body) });
    if (action === "logout") return jsonOut_({ ok: true, data: logout_(body.token) });
    const s = session_(body.token);
    if (action === "me") return jsonOut_({ ok: true, data: { id: s.id, role: s.role || "조회", perms: s.perms } });
    if (action === "listUsers") { need_(s, "admin"); return jsonOut_({ ok: true, data: listUsers_() }); }
    if (action === "saveUser") { need_(s, "admin"); return jsonOut_({ ok: true, data: saveUser_(body, s) }); }
    if (action === "unlockUser") { need_(s, "admin"); return jsonOut_({ ok: true, data: unlockUser_(body) }); }
    if (action === "deleteUser") { need_(s, "admin"); return jsonOut_({ ok: true, data: deleteUser_(body, s) }); }
    if (["saveAdjustments", "logPerformance", "savePdfs"].indexOf(action) >= 0) need_(s, "settle");
    if (["savePlant", "deletePlant", "saveCustomer", "deleteCustomer"].indexOf(action) >= 0) need_(s, "contract");
    if (action === "saveStore") { const p = storePerm_(body.key); if (p) need_(s, p); else if (!s.perms.length) throw new Error("권한이 없습니다. (조회 전용 계정)"); }
    if (action === "saveAdjustments") return jsonOut_({ ok: true, data: saveAdjustments_(body) });
    if (action === "logPerformance") return jsonOut_({ ok: true, data: logPerformance_(body) });
    if (action === "saveStore") return jsonOut_({ ok: true, data: saveStore_(body) });
    if (action === "savePdfs") return jsonOut_({ ok: true, data: savePdfs_(body) });
    if (action === "savePlant") return jsonOut_({ ok: true, data: upsertRegistryRow_(getSheet_(SHEET_MASTER), MASTER_FIELDS, "발전소명", body.record, body.originalKey, null, body.originalRow) });
    if (action === "deletePlant") return jsonOut_({ ok: true, data: deleteRegistryRow_(getSheet_(SHEET_MASTER), "발전소명", body.key, null, body.row) });
    if (action === "saveCustomer") return jsonOut_({ ok: true, data: upsertRegistryRow_(getSheet_(SHEET_CUSTOMERS), CUSTOMER_FIELDS, "계약ID", body.record, body.originalKey, "KPX신청번호") });
    if (action === "deleteCustomer") return jsonOut_({ ok: true, data: deleteRegistryRow_(getSheet_(SHEET_CUSTOMERS), "계약ID", body.key, "KPX신청번호") });
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

const MASTER_FIELDS = ["발전소명","사업자명(대표자명)","사업자등록번호","사업자주소","계좌번호","연락처","계약용량","발전보장시간","계약단가","계약일자","계약해지일",
  "담당자","수수료율","지역(요금구분)","배전연결","KPX신청번호",
  "사업자명","대표자명","이메일","발전기ID","접속점","한전고객번호",
  "정산방식","계약기간","연장가능여부","연장통보기한","연장통보마감일","비고",
  "연간보장공급량","연간효율감소","위약금유형","위약금단가","위약금처리방식","해지위약금","계약ID","계약상태","REC가중치"];
const CUSTOMER_FIELDS = ["계약ID","수요기업명","대표자명","사업자등록번호","전기사용장소","담당자","연락처","이메일","수요지지역","계약단가","KPX신청번호","소비계약신청번호","계약일자","계약해지일",
  "정산방식","계약기간","연장가능여부","연장통보기한","연장통보마감일","비고",
  "사용장소명","수요망","한전계약전력","한전고객번호","계약용량","연간보장시간","연간보장공급량","연간효율감소","위약금유형","위약금단가","위약금처리방식","해지위약금","계약상태","접속점","입금계좌","청구서번호","청구서송부기한","납부일","오차확인기한"];
// 앞자리 0·하이픈이 숫자/날짜로 바뀌지 않도록 텍스트 서식으로 저장할 컬럼
const TEXT_FIELDS = ["청구서번호","입금계좌","계약ID","사업자등록번호","계좌번호","연락처","담당자","KPX신청번호","소비계약신청번호","발전기ID","한전고객번호"];

// Date 셀은 JSON.stringify가 UTC로 변환하면서 자정 근처 날짜가 하루 밀릴 수 있어
// 스프레드시트 타임존 기준 "yyyy-MM-dd" 문자열로 먼저 고정한다.
function formatDateField_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  return v;
}

let _masterMemo = null, _actMemo = null;
function clearMemo_() { _masterMemo = null; _actMemo = null; }
function getMaster_() {
  if (_masterMemo) return _masterMemo;
  return (_masterMemo = readMaster_());
}
function readMaster_() {
  const rows = sheetToObjects_(getSheet_(SHEET_MASTER));
  const byPlant = {}, count = {}, seen = {};
  rows.forEach(r => { const k = String(pickField_(r, "발전소명") || "").trim(); if (k) count[k] = (count[k] || 0) + 1; });
  rows.forEach(r => {
    const out = {};
    MASTER_FIELDS.forEach(f => out[f] = formatDateField_(pickField_(r, f)));
    let key = out["발전소명"] ? String(out["발전소명"]).trim() : "";
    if (!key) return;
    out._row = r._row;
    // 같은 발전소명이 여러 행(용량·전기사용자가 다른 별개 발전소)이면 두 번째부터 "이름 (신청번호)" 로 구분해 각 행 정보를 그대로 쓴다
    if (count[key] > 1 && seen[key]) {
      const tag = String(out["KPX신청번호"] || out["계약ID"] || "").trim();
      key = tag && !byPlant[key + " (" + tag + ")"] ? key + " (" + tag + ")" : key + " (행 " + r._row + ")";
    }
    seen[out["발전소명"]] = true;
    byPlant[key] = out;
  });
  return byPlant;
}
const stripDupKey_ = k => String(k || "").trim().replace(/ \(행 \d+\)$/, "");

/* ============ 등록 정보 (탭0: 발전소 / 전기사용자) ============ */
function getCustomers_() {
  return sheetToObjects_(getSheet_(SHEET_CUSTOMERS)).map(r => {
    const out = {};
    CUSTOMER_FIELDS.forEach(f => out[f] = formatDateField_(pickField_(r, f)));
    return out;
  }).filter(c => String(c["계약ID"] || "").trim() || String(c["소비계약신청번호"] || "").trim() || String(c["KPX신청번호"] || "").trim() || String(c["수요기업명"] || "").trim());
}

// 한 행 저장(upsert). 헤더는 공백/괄호를 무시하고 매칭하고, 없는 컬럼은 맨 끝에 추가한다.
// 시트에 수기로 만든 다른 컬럼 값은 건드리지 않는다. originalKey 가 있으면 그 행을 수정(키 변경 포함), 없으면 새로 추가.
// legacyKeyField: 키 칸이 비어 있는 예전 행은 이 칸 값으로 찾는다 (전기사용자: 계약ID 도입 전 KPX신청번호로 저장된 행)
function upsertRegistryRow_(sheet, fields, keyField, record, originalKey, legacyKeyField, originalRow) {
  clearMemo_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    record = record || {};
    let header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
    const colOf = f => header.findIndex(h => normalizeKey_(h) === normalizeKey_(f));
    const missing = fields.filter(f => colOf(f) < 0);
    if (missing.length) {
      sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
      header = header.concat(missing);
    }
    const key = String(record[keyField] == null ? "" : record[keyField]).trim();
    if (!key) throw new Error(keyField + "을(를) 입력하세요.");
    record[keyField] = key;
    const keyCol = colOf(keyField) + 1, lastRow = sheet.getLastRow();
    const keys = lastRow > 1 ? sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
    const rowOf = k => { const i = keys.indexOf(k); return i < 0 ? -1 : i + 2; };
    const origRaw = String(originalKey || "").trim(), oRow = Number(originalRow) || 0;
    // 같은 이름이 여러 행이면 행 번호로 정확히 (목록 키는 "이름 (신청번호)" 일 수 있음)
    let row = oRow >= 2 && oRow <= lastRow && (keys[oRow - 2] === origRaw || origRaw.indexOf(keys[oRow - 2] + " (") === 0) ? oRow : (origRaw ? rowOf(stripDupKey_(origRaw)) : -1);
    const orig = row > 0 ? keys[row - 2] : stripDupKey_(origRaw);
    // 같은 이름은 허용하되(별개 발전소), 같은 신청번호·계약ID까지 같으면 중복
    const groupCols = ["KPX신청번호", "계약ID"].map(f => colOf(f)).filter(c => c >= 0);
    const tagOf = vals => groupCols.map(c => String(vals[c] == null ? "" : vals[c]).trim()).join("|");
    const newTag = groupCols.map(c => { const f = header[c]; const v = record[fields.find(x => normalizeKey_(x) === normalizeKey_(f))]; return String(v == null ? "" : v).trim(); });
    if (key !== orig) {
      const all = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, header.length).getValues() : [];
      const clash = all.findIndex((vals, i) => String(vals[keyCol - 1]).trim() === key && i + 2 !== row && (keyField !== "발전소명" || tagOf(vals) === newTag.join("|")));
      if (clash >= 0) throw new Error("이미 등록된 " + keyField + "입니다: " + key + " (행 " + (clash + 2) + ")" + (keyField === "발전소명" ? ". 같은 이름이면 계약(신청번호)을 다르게 연결하세요." : ""));
    }
    if (row < 0 && orig && legacyKeyField && colOf(legacyKeyField) >= 0 && lastRow > 1) {
      const legacy = sheet.getRange(2, colOf(legacyKeyField) + 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim());
      const i = legacy.findIndex((v, j) => v === orig && !keys[j]);
      if (i >= 0) row = i + 2;
    }
    if (row < 0) row = lastRow + 1;
    const values = row <= lastRow ? sheet.getRange(row, 1, 1, header.length).getValues()[0] : new Array(header.length).fill("");
    fields.forEach(f => { if (record[f] !== undefined) values[colOf(f)] = record[f]; });
    const textCells = TEXT_FIELDS.filter(f => fields.indexOf(f) >= 0 && colOf(f) >= 0).map(f => colLetter_(colOf(f) + 1) + row);
    if (textCells.length) sheet.getRangeList(textCells).setNumberFormat("@"); // 칸마다 호출하지 않고 한 번에
    sheet.getRange(row, 1, 1, header.length).setValues([values]);
    return { saved: true, key: key };
  } finally {
    lock.releaseLock();
  }
}

function deleteRegistryRow_(sheet, keyField, key, legacyKeyField, rowNo) {
  clearMemo_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const k0 = String(key || "").trim(), rows = sheetToObjects_(sheet), n = Number(rowNo) || 0;
    const nameOf = r => String(pickField_(r, keyField) || "").trim(), k = stripDupKey_(k0);
    const found = (n ? rows.find(r => r._row === n && (nameOf(r) === k0 || k0.indexOf(nameOf(r) + " (") === 0)) : null)
      || rows.find(r => String(pickField_(r, keyField) || "").trim() === k)
      || (legacyKeyField ? rows.find(r => !String(pickField_(r, keyField) || "").trim() && String(pickField_(r, legacyKeyField) || "").trim() === k) : null);
    if (!found) throw new Error("삭제할 항목을 찾지 못했습니다: " + key);
    sheet.deleteRow(found._row);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

// 정산월의 발전소별 실적 (탭0 그룹 월별 집계). 초과발전량은 발전량 − 공급량으로 계산한다.
function getPerformanceMonth_(month) {
  const out = {};
  sheetToObjects_(getSheet_(SHEET_PERFORMANCE)).filter(r => String(r["정산월"]) === String(month)).forEach(r => {
    const gen = Number(r["발전량"]) || 0, supply = Number(r["공급량"]) || 0;
    out[String(r["발전소명"]).trim()] = { generation: gen, supply: supply, excess: gen - supply, loggedAt: r["기록일시"] };
  });
  return out;
}

/* ============ 실적 (월별실적로그 + 실적그리드) ============
 * 실적 = 발전량 = 공급량(재생E공급량) + 초과발전량. 실적그리드(시트에서 고친 값 우선)와 월별실적로그를 합쳐 쓴다 — monthlyActuals_ 는 실적그리드 부분에 있다.
 */
// 웹 화면용: 월별 실적 (generation = 실적 합계, supply = 실발전량)
function getPerformanceAll_() {
  const act = monthlyActuals_(), rows = [];
  Object.keys(act).forEach(plant => Object.keys(act[plant]).forEach(ym => {
    rows.push({ month: ym, plant: plant, supply: act[plant][ym].supply, generation: act[plant][ym].total });
  }));
  return rows;
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
  // 발전소가 수천 개여도 읽기 1번 · 쓰기 1~2번 (행마다 appendRow 하지 않음)
  const sheet = getSheet_(SHEET_PERFORMANCE), last = sheet.getLastRow();
  const all = last > 1 ? sheet.getRange(2, 1, last - 1, 6).getValues() : [];
  const idx = {}; all.forEach((r, i) => { idx[String(r[0]) + "|" + trimName_(r[1])] = i; });
  const now = new Date(), month = String(body.month), updates = {}, appended = [];
  let firstChanged = all.length;
  (body.rows || []).forEach(r => {
    const plant = trimName_(r.plant); if (!plant) return;
    const gen = Number(r.generation) || 0, supply = Number(r.supply) || 0;
    const excess = r.excess != null ? Number(r.excess) || 0 : gen - supply;
    const values = [month, plant, gen, supply, excess, now], key = month + "|" + plant;
    if (key in idx && idx[key] < all.length) { all[idx[key]] = values; firstChanged = Math.min(firstChanged, idx[key]); }
    else if (key in idx) appended[idx[key] - all.length] = values;
    else { idx[key] = all.length + appended.length; appended.push(values); }
    updates[plant] = { gen: Math.max(gen, supply), supply: supply };
  });
  if (firstChanged < all.length) sheet.getRange(2 + firstChanged, 1, all.length - firstChanged, 6).setValues(all.slice(firstChanged));
  if (appended.length) sheet.getRange(2 + all.length, 1, appended.length, 6).setValues(appended);
  refreshGrid_(month, updates); // 실적그리드: 이 달만 새 값, 시트에서 고친 다른 달은 유지
  _actMemo = null;
  const cumulative = rebuildDashboard_();
  return { logged: Object.keys(updates).length, cumulative: cumulative, performance: getPerformanceAll_() };
}

/* ============ 정산서 PDF → 구글 드라이브 ============
 * 폴더: TWh 정산서 / <연도> / 전기사용자 | 발전사업자 / <사업자명> / 파일
 * 올해 이전 연도 폴더는 "TWh 정산서 / 백업" 아래로 옮겨 둔다 (지난 연도 문서를 늦게 저장해도 백업/<연도> 로 바로 들어감).
 * 같은 이름의 파일이 있으면 휴지통으로 보내고 새로 만든다 (다시 발행·수정). 최초 1회 편집기에서 setupDrive 실행 → 권한 승인.
 */
const DRIVE_ROOT_NAME = "TWh 정산서", DRIVE_BACKUP_NAME = "백업";
function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function driveRoot_() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty("DRIVE_ROOT_ID");
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 지워졌으면 새로 */ } }
  const f = childFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_NAME);
  props.setProperty("DRIVE_ROOT_ID", f.getId());
  return f;
}
// 올해보다 이전 연도 폴더를 백업 폴더로 옮긴다 (하루 한 번만 확인)
function rollDriveYears_(root) {
  const props = PropertiesService.getScriptProperties(), today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  if (props.getProperty("DRIVE_ROLLED") === today) return;
  const cur = Number(today.slice(0, 4)), backup = childFolder_(root, DRIVE_BACKUP_NAME), it = root.getFolders();
  while (it.hasNext()) { const f = it.next(), y = Number(f.getName()); if (/^\d{4}$/.test(f.getName()) && y < cur) f.moveTo(backup); }
  props.setProperty("DRIVE_ROLLED", today);
}
function yearFolder_(root, year) {
  const cur = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy"));
  return childFolder_(Number(year) < cur ? childFolder_(root, DRIVE_BACKUP_NAME) : root, String(year));
}
const driveName_ = s => String(s == null ? "" : s).replace(/[\/:*?"<>|]/g, "_").trim() || "미지정";
// files: [{ year, kind: "cust"|"gen", owner, name, base64 }]
function savePdfs_(body) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const root = driveRoot_(); rollDriveYears_(root);
    return (body.files || []).map(f => {
      const folder = childFolder_(childFolder_(yearFolder_(root, f.year), f.kind === "gen" ? "발전사업자" : "전기사용자"), driveName_(f.owner));
      const name = driveName_(f.name).replace(/(\.pdf)?$/i, ".pdf");
      const old = folder.getFilesByName(name); while (old.hasNext()) old.next().setTrashed(true);
      const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), "application/pdf", name));
      return { name, url: file.getUrl() };
    });
  } finally { lock.releaseLock(); }
}
// 편집기에서 최초 1회 실행: 드라이브 권한 승인 + 폴더 만들기
function setupDrive() {
  const root = driveRoot_(); rollDriveYears_(root);
  console.log("드라이브 폴더: " + root.getUrl());
  return root.getUrl();
}

/* ============ 앱데이터 (수요기업 청구 모듈: 월별 요율/발전소/계약/이월값을 JSON 으로 저장) ============
 * 키 예: "rates:202609", "plants", "customers", "carry:202609:<신청번호>". 값은 JSON 문자열.
 * 시트 셀 한 칸은 5만자 제한이므로 값이 커지면 키를 나눠서 저장한다. */
const SHEET_STORE_ARCHIVE = "앱데이터_보관";
// 키의 기준 월 (YYYYMM): 정산 데이터만 해당, 요율·설정 같은 키는 null (항상 불러옴)
function storeYm_(key) {
  key = String(key || "");
  let m = /^(?:bill|carry|recx):(\d{6})/.exec(key) || /^(?:genpay|smp):(\d{6})/.exec(key);
  if (m) return m[1];
  m = /^recset:.*:\d{6}-(\d{6})$/.exec(key);
  return m ? m[1] : null;
}
function storeArchiveSheet_(create) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_STORE_ARCHIVE);
  if (!sh && create) sh = ensureSheet_(ss, SHEET_STORE_ARCHIVE, STORE_HEADERS);
  return sh;
}
function storeValues_(sheet) { const last = sheet ? sheet.getLastRow() : 0; return last > 1 ? sheet.getRange(2, 1, last - 1, 2).getValues() : []; }
// since(YYYYMM) 를 주면 그 달 이후 정산 데이터 + 설정 키만 (로그인 때 전체를 받지 않도록)
function getStoreAll_(since) {
  const out = {};
  storeValues_(getSheet_(SHEET_STORE)).forEach(r => { const k = String(r[0]); if (!k) return; const ym = storeYm_(k); if (!since || ym == null || ym >= since) out[k] = String(r[1]); });
  return out;
}
// 지난 기간 데이터 (보관 시트 포함): from ~ to (YYYYMM)
function getStoreRange_(from, to) {
  const out = {};
  [storeArchiveSheet_(false), getSheet_(SHEET_STORE)].forEach(sh => storeValues_(sh).forEach(r => {
    const k = String(r[0]), ym = storeYm_(k); if (k && ym != null && ym >= from && ym <= to) out[k] = String(r[1]);
  }));
  return out;
}
function saveStore_(body) {
  const key = String(body.key || "");
  if (!key) throw new Error("key 가 필요합니다.");
  const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
  if (value.length > 49000) throw new Error("값이 너무 큽니다(5만자 제한): " + key);
  const values = [key, value, new Date()];
  const findRow = sh => { const last = sh ? sh.getLastRow() : 0; if (last < 2) return 0; const i = sh.getRange(2, 1, last - 1, 1).getValues().findIndex(r => String(r[0]) === key); return i >= 0 ? i + 2 : 0; };
  const main = getSheet_(SHEET_STORE), row = findRow(main); // 키 열만 읽는다
  if (row) { main.getRange(row, 1, 1, 3).setValues([values]); return { saved: true }; }
  const arch = storeArchiveSheet_(false), arow = findRow(arch);
  if (arow) { arch.getRange(arow, 1, 1, 3).setValues([values]); return { saved: true }; }
  main.appendRow(values);
  return { saved: true };
}
// 편집기에서 수동 실행(1년에 한 번 정도): 작년 1월보다 오래된 정산 데이터를 "앱데이터_보관" 시트로 옮긴다
function archiveOldData() {
  const now = new Date(), cutoff = String(now.getFullYear() - 1) + "01";
  const main = getSheet_(SHEET_STORE), last = main.getLastRow(); if (last < 2) return 0;
  const rows = main.getRange(2, 1, last - 1, 3).getValues();
  const keep = [], move = [];
  rows.forEach(r => { const ym = storeYm_(r[0]); (ym != null && ym < cutoff ? move : keep).push(r); });
  if (!move.length) return 0;
  const arch = storeArchiveSheet_(true);
  arch.getRange(arch.getLastRow() + 1, 1, move.length, 3).setValues(move);
  main.getRange(2, 1, last - 1, 3).clearContent();
  if (keep.length) main.getRange(2, 1, keep.length, 3).setValues(keep);
  return move.length;
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
// 대시보드: 발전소별 연차 표 — 연간보장공급량 / 실발전량(재생E공급량) / 초과발전량 / 합계 / 비교(합계−보장) / 이행여부
// 연간보장공급량 = 등록값(없으면 용량 × 보장시간(h/일) × 365), n년차 = 1년차 × (1 − 연간효율감소)^(n−1)
function rebuildDashboard_() {
  const master = getMaster_();
  const act = monthlyActuals_();
  const dashSheet = getSheet_(SHEET_DASHBOARD);
  const now = new Date(), curYm = ymKey_({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const header = ["발전소명", "계약용량", "발전보장시간", "구분"].concat(Array.from({ length: DASHBOARD_YEARS }, (_, i) => (i + 1) + "차년도"));
  const LABELS = ["연간보장공급량", "실발전량(재생E공급량)", "초과발전량", "합계", "비교(합계−보장)", "이행여부"];
  const out = [header], bgs = [header.map(() => "#D9D9D9")], cumulativeByPlant = {};
  Object.keys(master).forEach(plant => {
    const m = master[plant];
    const capacity = Number(m["계약용량"]) || 0;
    const hours = Number(m["발전보장시간"]) || DEFAULT_GUARANTEE_HOURS;
    const decline = (m["연간효율감소"] === "" || m["연간효율감소"] == null) ? 0.5 : Number(m["연간효율감소"]) || 0;
    const startYm = parseYearMonth_(m["계약일자"]);
    let years = Math.round(Number(m["계약기간"]) || 0);
    const endYm = parseYearMonth_(m["계약해지일"]);
    if (!years && startYm && endYm) years = Math.max(1, Math.round(((endYm.y - startYm.y) * 12 + (endYm.m - startYm.m) + 1) / 12));
    if (!years) years = DASHBOARD_YEARS;
    const g1 = Number(m["연간보장공급량"]) > 0 ? Number(m["연간보장공급량"]) : capacity * hours * 365;
    const monthly = act[plant] || {};
    cumulativeByPlant[plant] = Object.keys(monthly).reduce((t, ym) => t + monthly[ym].total, 0);
    const rowsOut = LABELS.map(() => []);
    for (let y = 1; y <= DASHBOARD_YEARS; y++) {
      if (!startYm || !g1 || y > years) { rowsOut.forEach(r => r.push("")); continue; }
      const guar = g1 * Math.pow(1 - decline / 100, y - 1);
      const ws = ymKey_(addMonths_(startYm, (y - 1) * 12)), we = ymKey_(addMonths_(startYm, y * 12 - 1));
      let supply = 0, total = 0, has = false;
      Object.keys(monthly).forEach(ym => { if (ym >= ws && ym <= we) { supply += monthly[ym].supply; total += monthly[ym].total; has = true; } });
      const state = we < curYm ? "ended" : (ws > curYm ? "future" : "current");
      let status = "예정";
      if (state === "ended") status = total >= guar ? "달성" : "미달";
      else if (state === "current") status = total >= guar ? "달성" : "진행중";
      rowsOut[0].push(Math.round(guar));
      rowsOut[1].push(has ? Math.round(supply) : "");
      rowsOut[2].push(has ? Math.round(total - supply) : "");
      rowsOut[3].push(has ? Math.round(total) : "");
      rowsOut[4].push(has ? Math.round(total - guar) : "");
      rowsOut[5].push(status);
    }
    LABELS.forEach((l, i) => {
      out.push((i === 0 ? [plant, capacity, hours, l] : [plant, "", "", l]).concat(rowsOut[i]));
      bgs.push(header.map((h, c) => i === 5 && c >= 4 ? (rowsOut[5][c - 4] === "달성" ? "#E3F3EA" : rowsOut[5][c - 4] === "미달" ? "#FBE3E1" : null) : (i === 5 ? "#F7F7F7" : null)));
    });
  });
  dashSheet.getCharts().forEach(c => dashSheet.removeChart(c)); // 예전 버전의 발전소별 차트 정리
  dashSheet.clear();
  const rng = dashSheet.getRange(1, 1, out.length, header.length);
  rng.setValues(out); rng.setBackgrounds(bgs);
  dashSheet.getRange(1, 1, 1, header.length).setFontWeight("bold");
  dashSheet.setFrozenRows(1); dashSheet.setFrozenColumns(4);
  return cumulativeByPlant;
}

// 시트를 직접 고치면 대시보드를 다시 만든다 (setupSheets 실행 시 설치되는 편집 트리거)
function onSheetEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : "";
  if ([SHEET_YEARLY_GRID, SHEET_PERFORMANCE, SHEET_MASTER].indexOf(name) < 0) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { rebuildDashboard_(); } finally { lock.releaseLock(); }
}
// appsscript.json 에 script.scriptapp 권한이 없으면 트리거 설치만 건너뛴다 (대시보드는 업로드 때 갱신)
function installEditTrigger_() {
  try {
    const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "onSheetEdit");
    if (!exists) ScriptApp.newTrigger("onSheetEdit").forSpreadsheet(SHEET_ID).onEdit().create();
  } catch (err) {
    console.warn("편집 트리거 설치 건너뜀 (appsscript.json oauthScopes 에 https://www.googleapis.com/auth/script.scriptapp 추가 필요): " + err);
  }
}

// 편집기에서 수동 실행: 정산 테스트 결과만 지운다 — 발전소·전기사용자 등록, 계정, 요율·설정은 남긴다.
// 삭제: 앱데이터의 가정산서(bill)·오차정산 이월(carry)·발전대금(genpay)·초과발전량(recx)·REC 정산(recset), 앱데이터_보관,
//       월별실적로그, 월별정산조정, 실적그리드 → 대시보드는 빈 실적으로 다시 계산
// 유지: KPX 요율(netrate), 시간대별 요금제(touver)·휴일, SMP·REC 가격(market·smp), 청구일 설정(billcfg), REC 가중치(recw)
function resetTestData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const isResult = k => /^(bill|carry|genpay|recx|recset):/.test(String(k));
  const main = getSheet_(SHEET_STORE), last = main.getLastRow();
  let removed = 0;
  if (last > 1) {
    const rows = main.getRange(2, 1, last - 1, 3).getValues(), keep = rows.filter(r => r[0] !== "" && !isResult(r[0]));
    removed = rows.length - keep.length;
    main.getRange(2, 1, last - 1, 3).clearContent();
    if (keep.length) main.getRange(2, 1, keep.length, 3).setValues(keep);
  }
  const arch = ss.getSheetByName(SHEET_STORE_ARCHIVE);
  if (arch && arch.getLastRow() > 1) { removed += arch.getLastRow() - 1; arch.deleteRows(2, arch.getLastRow() - 1); }
  [SHEET_PERFORMANCE, SHEET_ADJUSTMENTS].forEach(name => { const sh = getSheet_(name), n = sh.getLastRow(); if (n > 1) sh.deleteRows(2, n - 1); });
  const grid = ss.getSheetByName(SHEET_YEARLY_GRID); if (grid) { grid.getRange(1, 1, Math.max(1, grid.getLastRow()), Math.max(1, grid.getLastColumn())).breakApart(); grid.clear(); }
  rebuildDashboard_();
  return "정산 테스트 데이터 " + removed + "건 삭제 (발전소·전기사용자·요율·설정은 유지)";
}

// 편집기에서 수동 실행: 모든 데이터를 지운다 (발전소·전기사용자 등록까지). 헤더 행·관리자(로그인) 탭은 남김.
// 대상: 발전소 사업자 정보, 전기사용자 정보, 월별실적로그, 월별정산조정, 앱데이터, 실적그리드, 대시보드
function resetAllData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  [SHEET_MASTER, SHEET_CUSTOMERS, SHEET_PERFORMANCE, SHEET_ADJUSTMENTS, SHEET_STORE].forEach(name => {
    const sh = getSheet_(name), last = sh.getLastRow();
    if (last > 1) sh.deleteRows(2, last - 1);
  });
  const grid = ss.getSheetByName(SHEET_YEARLY_GRID);
  if (grid) grid.clear();
  rebuildDashboard_();
}

/* ============ 실적그리드 (발전소 × 월: 발전량 · 공급량 · 초과발전량) ============
 * 1행 = 헤더: 발전소 | 구분 | 2025-11 | 2025-12 | …  (월 열은 시간순, 새 달이 오면 그 자리에 열 추가)
 * 발전소마다 3행: 발전량 / 공급량(재생E공급량) / 초과발전량(= 발전량 − 공급량 수식). A열에 발전소명을 모든 행에 둔다.
 * 업로드하면 그 달 열 하나만 한 번에 쓴다 (발전소가 수천 개여도 호출 몇 번). 시트에서 고친 다른 달 값은 그대로.
 * 연차 기준(계약일자)은 대시보드·정산서가 계산하므로 계약일자가 바뀌어도 그리드는 다시 그릴 필요가 없다.
 * 예전 형식(발전소별 연차 블록)은 처음 갱신할 때 자동으로 새 형식으로 옮긴다.
 */
const GRID_YEARS_MAX = 20;
const GRID_TITLE_RE = /^(.+) \| 시작 (\d{4})-(\d{2}) \| (\d+)년차/; // 예전 형식 (연차 블록)
const GRID_OLD_RE = /^(.+) \(계약용량 /;                             // 더 예전 형식 (실적 합계 한 줄)
const GRID_KINDS = ["발전량", "공급량", "초과발전량"];

function getYearlyGridSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_YEARLY_GRID);
  if (!sheet) sheet = ss.insertSheet(SHEET_YEARLY_GRID);
  return sheet;
}
const gridNum_ = v => (v === "" || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const trimName_ = s => String(s == null ? "" : s).trim();
const isMonthGrid_ = sheet => sheet.getLastRow() >= 1 && String(sheet.getRange(1, 1).getValue()).trim() === "발전소";
function colLetter_(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function gridMonthKey_(v) { // 헤더 셀 → "YYYYMM" (문자열 "2025-11" 또는 날짜로 바뀐 셀)
  if (v instanceof Date) return ymKey_({ y: v.getFullYear(), m: v.getMonth() + 1 });
  const m = /(\d{4})\D+(\d{1,2})/.exec(String(v)); return m ? m[1] + String(m[2]).padStart(2, "0") : "";
}
const gridMonthLabel_ = ym => ym.slice(0, 4) + "-" + ym.slice(4);
const excessFormula_ = (col, genRow) => { const c = colLetter_(col); return `=IF(AND(${c}${genRow}="",${c}${genRow + 1}=""),"",N(${c}${genRow})-N(${c}${genRow + 1}))`; };

// 시트에 적힌 값(수동 보정 포함): { 발전소: { YYYYMM: { gen, supply } } } — 새 형식·예전 형식 모두 읽는다
function readGrid_(sheet, master) {
  const out = {};
  const last = sheet.getLastRow(), lastCol = Math.max(14, sheet.getLastColumn());
  if (last < 1) return out;
  const values = sheet.getRange(1, 1, last, lastCol).getValues();
  const put = (plant, ym, k, v) => { if (v == null || !ym) return; const p = out[plant] || (out[plant] = {}); (p[ym] || (p[ym] = {}))[k] = v; };
  if (String(values[0][0]).trim() === "발전소") { // 새 형식
    const months = values[0].map((h, i) => i >= 2 ? gridMonthKey_(h) : "");
    for (let i = 1; i < values.length; i++) {
      const plant = trimName_(values[i][0]), kind = String(values[i][1]).trim();
      if (!plant || (kind !== "발전량" && kind !== "공급량")) continue;
      for (let c = 2; c < months.length; c++) put(plant, months[c], kind === "발전량" ? "gen" : "supply", gridNum_(values[i][c]));
    }
    return out;
  }
  for (let i = 0; i < values.length; i++) { // 예전 형식 블록
    const a = String(values[i][0]);
    const nw = GRID_TITLE_RE.exec(a);
    if (nw) {
      const plant = trimName_(nw[1]), start = { y: Number(nw[2]), m: Number(nw[3]) }, years = Number(nw[4]);
      for (let k = 0; k < years; k++) {
        const g = values[i + 2 + 3 * k], s = values[i + 3 + 3 * k];
        if (!g || !s) break;
        for (let pos = 0; pos < 12; pos++) { const ym = ymKey_(addMonths_(start, k * 12 + pos)); put(plant, ym, "gen", gridNum_(g[2 + pos])); put(plant, ym, "supply", gridNum_(s[2 + pos])); }
      }
      i += 1 + 3 * years; continue;
    }
    const old = GRID_OLD_RE.exec(a);
    if (old) {
      const plant = trimName_(old[1]), start = master[plant] ? parseYearMonth_(master[plant]["계약일자"]) : null;
      if (start) for (let k = 0; k < 20; k++) { const row = values[i + 2 + k]; if (!row) break; for (let pos = 0; pos < 12; pos++) put(plant, ymKey_(addMonths_(start, k * 12 + pos)), "gen", gridNum_(row[1 + pos])); }
      i += 21;
    }
  }
  return out;
}

// 월별실적로그: { 발전소: { YYYYMM: { gen, supply } } }
function readLog_() {
  const out = {};
  sheetToObjects_(getSheet_(SHEET_PERFORMANCE)).forEach(r => {
    const plant = trimName_(r["발전소명"]), ym = String(r["정산월"]);
    if (!plant || !/^\d{6}$/.test(ym)) return;
    (out[plant] || (out[plant] = {}))[ym] = { gen: Number(r["발전량"]) || 0, supply: Number(r["공급량"]) || 0 };
  });
  return out;
}

// 그리드 값 우선, 비어 있는 칸은 로그 값으로
function mergeActuals_(grid, log) {
  const out = {};
  [grid, log].forEach(src => Object.keys(src).forEach(p => { out[p] = out[p] || {}; }));
  Object.keys(out).forEach(p => {
    const yms = {}; Object.keys(grid[p] || {}).forEach(y => yms[y] = 1); Object.keys(log[p] || {}).forEach(y => yms[y] = 1);
    Object.keys(yms).forEach(ym => {
      const g = (grid[p] || {})[ym] || {}, l = (log[p] || {})[ym] || {};
      const gen = g.gen != null ? g.gen : (l.gen != null ? l.gen : null), supply = g.supply != null ? g.supply : (l.supply != null ? l.supply : null);
      if (gen == null && supply == null) return;
      out[p][ym] = { gen: gen == null ? supply : gen, supply: supply == null ? 0 : supply };
    });
  });
  return out;
}

// 전체 다시 쓰기 (예전 형식 이전 · refillYearlyGrid). 한 번에 쓰고 서식도 몇 번의 호출로 끝낸다.
function writeGridFull_(sheet, master, data) {
  _actMemo = null;
  const plants = Object.keys(master).filter(p => data[p]).concat(Object.keys(data).filter(p => !master[p]).sort());
  const months = Array.from(new Set(plants.reduce((a, p) => a.concat(Object.keys(data[p])), []))).sort();
  const header = ["발전소", "구분"].concat(months.map(gridMonthLabel_));
  const rows = [header], excessRows = [];
  plants.forEach(p => {
    const r = rows.length + 1; // 이 발전소 발전량 행 번호
    rows.push([p, "발전량"].concat(months.map(ym => data[p][ym] ? data[p][ym].gen : "")));
    rows.push([p, "공급량"].concat(months.map(ym => data[p][ym] ? data[p][ym].supply : "")));
    rows.push([p, "초과발전량"].concat(months.map((ym, i) => data[p][ym] ? excessFormula_(3 + i, r) : "")));
    excessRows.push(r + 2);
  });
  const old = sheet.getLastRow(), oldCols = sheet.getLastColumn();
  if (old > 0) { sheet.getRange(1, 1, old, Math.max(1, oldCols)).breakApart(); sheet.clear(); }
  sheet.getRange(1, 3, 1, Math.max(1, months.length)).setNumberFormat("@"); // "2025-11" 이 날짜로 바뀌지 않게
  sheet.getRange(1, 1, rows.length, header.length).setValues(rows);
  sheet.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#D9D9D9");
  if (rows.length > 1 && months.length) sheet.getRange(2, 3, rows.length - 1, months.length).setNumberFormat("#,##0.000");
  if (excessRows.length) sheet.getRangeList(excessRows.map(r => `A${r}:${colLetter_(header.length)}${r}`)).setBackground("#FFF8EC");
  sheet.setFrozenRows(1); sheet.setFrozenColumns(2);
}

// 업로드한 달(updates: {발전소: {gen, supply}})의 열만 쓴다 — 발전소 수와 상관없이 몇 번의 호출
function refreshGrid_(month, updates) {
  _actMemo = null;
  const sheet = getYearlyGridSheet_();
  if (!isMonthGrid_(sheet)) { // 비어 있거나 예전 형식 → 새 형식으로 한 번 전체 작성
    const master = getMaster_(), data = mergeActuals_(readGrid_(sheet, master), readLog_());
    Object.keys(updates || {}).forEach(p => { (data[p] || (data[p] = {}))[month] = updates[p]; });
    writeGridFull_(sheet, master, data);
    return;
  }
  const names = Object.keys(updates || {}); if (!names.length || !/^\d{6}$/.test(month)) return;
  let lastCol = sheet.getLastColumn(), lastRow = sheet.getLastRow();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let col = header.findIndex((h, i) => i >= 2 && gridMonthKey_(h) === month) + 1;
  if (!col) { // 새 달: 시간순 자리에 열 추가
    const after = header.findIndex((h, i) => i >= 2 && gridMonthKey_(h) > month);
    if (after >= 0) { sheet.insertColumnBefore(after + 1); col = after + 1; } else { col = lastCol + 1; }
    sheet.getRange(1, col).setNumberFormat("@").setValue(gridMonthLabel_(month)).setFontWeight("bold").setBackground("#D9D9D9");
    lastCol = Math.max(lastCol + 1, col);
  }
  const ab = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  const rowOf = {}; ab.forEach((r, i) => { if (String(r[1]).trim() === "발전량") rowOf[trimName_(r[0])] = i + 2; });
  const missing = names.filter(p => !rowOf[p]);
  if (missing.length) { // 새 발전소: 맨 아래에 3행 추가
    const start = lastRow + 1, add = [];
    missing.forEach((p, i) => { rowOf[p] = start + 3 * i; GRID_KINDS.forEach(k => add.push([p, k])); });
    sheet.getRange(start, 1, add.length, 2).setValues(add);
    sheet.getRangeList(missing.map((p, i) => `A${start + 3 * i + 2}:${colLetter_(lastCol)}${start + 3 * i + 2}`)).setBackground("#FFF8EC");
    lastRow = start + add.length - 1;
  }
  // 그 달 열 전체를 읽어서 업로드한 발전소만 바꾸고 한 번에 쓴다 (초과발전량은 수식)
  const n = lastRow - 1, colVals = sheet.getRange(2, col, n, 1).getFormulas().map((f, i) => [f[0] || ""]);
  const raw = sheet.getRange(2, col, n, 1).getValues();
  for (let i = 0; i < n; i++) if (!colVals[i][0]) colVals[i][0] = raw[i][0];
  names.forEach(p => {
    const r = rowOf[p] - 2, u = updates[p];
    colVals[r][0] = u.gen; colVals[r + 1][0] = u.supply; colVals[r + 2][0] = excessFormula_(col, rowOf[p]);
  });
  const rng = sheet.getRange(2, col, n, 1);
  rng.setValues(colVals); rng.setNumberFormat("#,##0.000");
}

// 웹·대시보드용 실적: {발전소: {YYYYMM: {supply, total}}}  (total = 발전량 = 공급량 + 초과발전량)
function monthlyActuals_() {
  if (_actMemo) return _actMemo;
  return (_actMemo = readActuals_());
}
function readActuals_() {
  const data = mergeActuals_(readGrid_(getYearlyGridSheet_(), getMaster_()), readLog_());
  const out = {};
  Object.keys(data).forEach(p => Object.keys(data[p]).forEach(ym => {
    const v = data[p][ym], total = Math.max(v.gen || 0, v.supply || 0);
    (out[p] || (out[p] = {}))[ym] = { supply: Math.min(v.supply || 0, total), total };
  }));
  return out;
}

// 정산서 연간보장공급량용: {연차: [12달 실적 합계]} (계약일자 기준)
function getYearlyGrid_(plant) {
  const master = getMaster_(), m = master[plant];
  const start = m ? parseYearMonth_(m["계약일자"]) : null;
  if (!start) return {};
  const act = monthlyActuals_()[plant] || {};
  const out = {};
  for (let k = 0; k < GRID_YEARS_MAX; k++) {
    out[String(k + 1)] = Array.from({ length: 12 }, (_, pos) => { const v = act[ymKey_(addMonths_(start, k * 12 + pos))]; return v ? v.total : null; });
  }
  return out;
}

// 편집기에서 수동 실행: 실적그리드를 새 형식으로 다시 그린다 (시트에 고친 값 유지, 빈 칸은 월별실적로그로 채움)
function refillYearlyGrid() {
  const sheet = getYearlyGridSheet_(), master = getMaster_();
  writeGridFull_(sheet, master, mergeActuals_(readGrid_(sheet, master), readLog_()));
  rebuildDashboard_();
}
function backfillYearlyGrid() { refillYearlyGrid(); }

/* ============ 로그인 · 계정 · 권한 (구글시트 "관리자" 탭) ============
 * 권한: 관리자(전체 + 계정관리) / 정산담당자(정산 발행·대금 수령·발전사업자 정산) / 실무담당자(계약 등록·수정). 빈칸 = 조회만.
 *   시트 "권한" 칸을 직접 고치거나, 웹의 [정산관리 > 권한관리]에서 관리자가 바꾼다. MASTER_ADMIN_ID 는 항상 관리자.
 * 비밀번호: 시트에 평문으로 넣어도 되고(첫 로그인 때 해시로 바뀜), 웹에서 바꾸면 해시로 저장된다.
 * 잠금: 5회 틀리면 "잠금" = Y. 관리자가 웹에서 [잠금 해제]하거나 시트에서 잠금·실패횟수 칸을 비우면 풀린다.
 * 세션: 로그인하면 토큰(6시간, 사용할 때마다 연장)을 주고, 모든 요청은 토큰과 권한을 서버에서 확인한다.
 */
const MASTER_ADMIN_ID = "9rayday";
const ROLE_PERMS = { "관리자": ["admin", "rates", "contract", "settle"], "정산담당자": ["settle"], "실무담당자": ["contract"] };
const AUTH_COLS = ["아이디", "비밀번호", "이름", "권한", "실패횟수", "잠금", "최근로그인", "등록일시"];
const SESSION_TTL = 21600; // 초 (CacheService 최대 6시간)
const MAX_FAIL = 5;

function hex_(bytes) { return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, "0")).join(""); }
function hashPw_(pw, salt) {
  salt = salt || Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  return "sha256:" + salt + ":" + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pw, Utilities.Charset.UTF_8));
}
function checkPw_(stored, pw) {
  stored = String(stored == null ? "" : stored);
  if (stored.indexOf("sha256:") === 0) return hashPw_(pw, stored.split(":")[1]) === stored;
  return stored !== "" && stored === pw;
}
function roleOf_(row) {
  if (String(row["아이디"]).trim() === MASTER_ADMIN_ID) return "관리자";
  const r = String(row["권한"] || "").trim();
  return ROLE_PERMS[r] ? r : "";
}
// 관리자 탭 + 필요한 칸 보장 (없는 칸은 오른쪽에 추가)
function authSheet_() {
  const sheet = getSheet_(SHEET_ADMIN);
  const lastCol = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const missing = AUTH_COLS.filter(c => header.indexOf(c) < 0);
  if (missing.length) sheet.getRange(1, header.filter(Boolean).length + 1, 1, missing.length).setValues([missing]).setFontWeight("bold");
  const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = name => h.indexOf(name) + 1;
  return { sheet, col, rows: sheetToObjects_(sheet) };
}
function setCell_(A, row, name, v) { const c = A.col(name); if (c) A.sheet.getRange(row, c).setValue(v); }

function login_(body) {
  const id = String(body.id || "").trim(), pw = String(body.pw || "");
  if (!id || !pw) throw new Error("아이디/비밀번호를 입력하세요.");
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const A = authSheet_();
    const found = A.rows.find(r => String(r["아이디"]).trim() === id);
    if (!found) throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
    const fails = Number(found["실패횟수"]) || 0;
    if (String(found["잠금"]).trim().toUpperCase() === "Y" || fails >= MAX_FAIL)
      throw new Error(`비밀번호를 ${MAX_FAIL}회 이상 틀려 잠긴 계정입니다. 관리자에게 잠금 해제를 요청하세요.`);
    if (!checkPw_(found["비밀번호"], pw)) {
      const n = fails + 1;
      setCell_(A, found._row, "실패횟수", n);
      if (n >= MAX_FAIL) { setCell_(A, found._row, "잠금", "Y"); throw new Error(`비밀번호를 ${MAX_FAIL}회 틀려 계정이 잠겼습니다. 관리자에게 잠금 해제를 요청하세요.`); }
      throw new Error(`아이디 또는 비밀번호가 올바르지 않습니다. (${n}/${MAX_FAIL})`);
    }
    setCell_(A, found._row, "실패횟수", 0);
    setCell_(A, found._row, "잠금", "");
    setCell_(A, found._row, "최근로그인", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"));
    if (String(found["비밀번호"]).indexOf("sha256:") !== 0) setCell_(A, found._row, "비밀번호", hashPw_(pw)); // 평문 → 해시
    const role = roleOf_(found);
    if (id === MASTER_ADMIN_ID && String(found["권한"]).trim() !== "관리자") setCell_(A, found._row, "권한", "관리자");
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put("tok:" + token, JSON.stringify({ id, role }), SESSION_TTL);
    return { name: found["이름"] || id, id, role: role || "조회", perms: ROLE_PERMS[role] || [], token };
  } finally { lock.releaseLock(); }
}
function logout_(token) { if (token) CacheService.getScriptCache().remove("tok:" + token); return true; }

// 토큰 확인 (없거나 만료 → AUTH 오류, 화면은 로그인으로 돌아간다)
function session_(token) {
  const cache = CacheService.getScriptCache();
  const raw = token ? cache.get("tok:" + token) : null;
  if (!raw) throw new Error("AUTH: 로그인이 필요합니다. 다시 로그인하세요.");
  cache.put("tok:" + token, raw, SESSION_TTL); // 사용할 때마다 연장
  const s = JSON.parse(raw);
  s.perms = ROLE_PERMS[s.role] || [];
  return s;
}
function need_(s, perm) {
  if (s.perms.indexOf(perm) < 0) throw new Error(`권한이 없습니다. (${({ admin: "계정 관리", rates: "요율 관리", contract: "계약 등록·수정", settle: "정산" })[perm] || perm} 권한 필요)`);
}
// 앱데이터 키별 쓰기 권한
function storePerm_(key) {
  key = String(key || "");
  if (/^(netrate:|touver:|holidays|market:|rates:|recw$|reccfg$|smp:)/.test(key)) return "rates";
  if (/^(bill:|carry:|genpay:|recx:|recset:)/.test(key)) return "settle";
  return null; // 그 밖의 키는 쓰기 권한이 하나라도 있으면 허용
}

/* ---- 계정 관리 (관리자) ---- */
function listUsers_() {
  return authSheet_().rows.map(r => ({ id: String(r["아이디"]).trim(), name: r["이름"] || "", role: roleOf_(r) || "", fails: Number(r["실패횟수"]) || 0,
    locked: String(r["잠금"]).trim().toUpperCase() === "Y" || (Number(r["실패횟수"]) || 0) >= MAX_FAIL, lastLogin: r["최근로그인"] ? String(r["최근로그인"]) : "",
    master: String(r["아이디"]).trim() === MASTER_ADMIN_ID })).filter(u => u.id);
}
function saveUser_(body, s) {
  const u = body.user || {}, id = String(u.id || "").trim();
  if (!/^[A-Za-z0-9_.@-]{3,40}$/.test(id)) throw new Error("아이디는 영문·숫자 3~40자로 입력하세요.");
  if (u.role && !ROLE_PERMS[u.role]) throw new Error("권한 값이 올바르지 않습니다: " + u.role);
  if (id === MASTER_ADMIN_ID && u.role && u.role !== "관리자") throw new Error("마스터 관리자의 권한은 바꿀 수 없습니다.");
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const A = authSheet_();
    let found = A.rows.find(r => String(r["아이디"]).trim() === id);
    if (body.isNew && found) throw new Error("이미 있는 아이디입니다: " + id);
    if (!found) {
      if (!u.password) throw new Error("새 계정은 초기 비밀번호가 필요합니다.");
      const row = A.sheet.getLastRow() + 1;
      setCell_(A, row, "아이디", id);
      setCell_(A, row, "등록일시", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"));
      found = { _row: row };
    }
    if (u.name != null) setCell_(A, found._row, "이름", String(u.name));
    if (u.role != null) setCell_(A, found._row, "권한", id === MASTER_ADMIN_ID ? "관리자" : u.role);
    if (u.password) {
      if (String(u.password).length < 6) throw new Error("비밀번호는 6자 이상으로 입력하세요.");
      setCell_(A, found._row, "비밀번호", hashPw_(String(u.password)));
      setCell_(A, found._row, "실패횟수", 0); setCell_(A, found._row, "잠금", "");
    }
    return listUsers_();
  } finally { lock.releaseLock(); }
}
function unlockUser_(body) {
  const A = authSheet_(), found = A.rows.find(r => String(r["아이디"]).trim() === String(body.id || "").trim());
  if (!found) throw new Error("계정을 찾을 수 없습니다.");
  setCell_(A, found._row, "실패횟수", 0); setCell_(A, found._row, "잠금", "");
  return listUsers_();
}
function deleteUser_(body, s) {
  const id = String(body.id || "").trim();
  if (id === MASTER_ADMIN_ID) throw new Error("마스터 관리자 계정은 삭제할 수 없습니다.");
  if (id === s.id) throw new Error("자기 계정은 삭제할 수 없습니다.");
  const A = authSheet_(), found = A.rows.find(r => String(r["아이디"]).trim() === id);
  if (!found) throw new Error("계정을 찾을 수 없습니다.");
  A.sheet.deleteRow(found._row);
  return listUsers_();
}
