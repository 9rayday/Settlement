/* ============ 정산요율관리 > 시간대별 요금제 관리 (#touPage) ============
 * 탭 3개: 시간대별 부하 테이블(버전) / 휴일 목록 / 일별 구분(공·토·평)
 * - 부하 테이블 버전: 앱데이터 "touver:<저장시각 ms>" {name, start, end, memo, tariff[12개월 × 24자 L/M/H]}
 *   날짜에 맞는 버전(start <= 날짜 <= end, 시작일 최신) → Parsers.tariffFor 로 정산 부하구분에 쓰인다. 기본 버전은 조회 전용.
 * - 휴일: 앱데이터 "holidays" {연도: [{d:"MM-DD", name, src}]} (수정한 연도만 저장, 없으면 기본 목록) → Parsers.HOLIDAYS
 */
const TOU_NAME = { L: "경부하", M: "중간부하", H: "최대부하" };
const TOU_NEXT = { L: "M", M: "H", H: "L" };
const TOU_BASE = { key: "", name: "기본 부하 프로파일", start: "2025-01-01", end: "", memo: "KEPCO 계시별 요금제 기준 기본값", tariff: Parsers.TARIFF.slice(), builtin: true };
const HOL_BASE = {
  2026: [["01-01", "1월1일"], ["02-16", "설날"], ["02-17", "설날"], ["02-18", "설날"], ["03-01", "삼일절"], ["03-02", "대체공휴일(삼일절)"],
    ["05-05", "어린이날"], ["05-24", "부처님오신날"], ["05-25", "대체공휴일(부처님오신날)"], ["06-03", "전국동시지방선거"], ["06-06", "현충일"],
    ["08-15", "광복절"], ["08-17", "대체공휴일(광복절)"], ["09-24", "추석"], ["09-25", "추석"], ["09-26", "추석"], ["10-03", "개천절"],
    ["10-05", "대체공휴일(개천절)"], ["10-09", "한글날"], ["12-25", "기독탄신일"]]
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const touState = { tab: "load", key: null, draft: null, year: String(new Date().getFullYear()) };
const tEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ----- 부하 테이블 버전 ----- */
function touVersions() { // 기본 버전 + 저장 버전 (시작일 최신순)
  const saved = Store.keys("touver:").map(k => Object.assign({ key: k }, Store.get(k, {}))).filter(v => Array.isArray(v.tariff));
  return [TOU_BASE].concat(saved).sort((a, b) => (a.start === b.start ? ((a.savedAt || "") < (b.savedAt || "") ? 1 : -1) : (a.start < b.start ? 1 : -1)));
}
function touVersionFor(date) {
  return touVersions().find(v => v.start <= date && (!v.end || date <= v.end)) || TOU_BASE;
}
const touLabel = v => `${v.name} (${v.start} ~ ${v.end || ""})`;

/* ----- 휴일 ----- */
function holidayList(year) { // [{d, name, src}]
  const saved = Store.get("holidays", {})[year];
  if (saved) return saved.slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  return (HOL_BASE[year] || (Parsers.HOLIDAYS[year] || []).map(d => [d, ""])).map(([d, name]) => ({ d, name, src: "기본" }));
}
function applyHolidays() {
  const all = Store.get("holidays", {}), years = new Set(Object.keys(HOL_BASE).concat(Object.keys(all)));
  const out = {}; years.forEach(y => { out[y] = holidayList(y).map(h => h.d); });
  Parsers.HOLIDAYS = out;
}
async function saveHolidayYear(year, list) {
  const all = Store.get("holidays", {}); all[year] = list.slice().sort((a, b) => (a.d < b.d ? -1 : 1));
  const where = await Store.set("holidays", all);
  applyHolidays();
  return where;
}

/* ----- 화면 ----- */
function renderTouPage() {
  const host = document.getElementById("touPage"); if (!host) return;
  const tabs = [["load", "시간대별 부하 테이블"], ["hol", "휴일 목록"], ["day", "일별 구분 (공/토/평)"]];
  host.innerHTML = `<div class="subtabs">${tabs.map(([k, l]) => `<button type="button" class="${touState.tab === k ? "active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
    <div class="card" id="touBody"></div>`;
  host.querySelectorAll(".subtabs button").forEach(b => b.onclick = () => { touState.tab = b.dataset.tab; renderTouPage(); });
  if (touState.tab === "load") renderLoadTab(); else if (touState.tab === "hol") renderHolidayTab(); else renderDayTab();
}

function yearSelect(id) {
  const now = new Date().getFullYear(), years = new Set([String(now - 1), String(now), String(now + 1), touState.year].concat(Object.keys(HOL_BASE), Object.keys(Store.get("holidays", {}))));
  return `<div class="row"><label class="adj-label">연도</label><select id="${id}" style="min-width:110px">${Array.from(years).sort().map(y => `<option value="${y}"${y === touState.year ? " selected" : ""}>${y}년</option>`).join("")}</select></div>`;
}

function renderLoadTab() {
  const body = document.getElementById("touBody");
  const versions = touVersions();
  if (touState.key === null && !touState.draft) touState.key = touVersionFor(todayYmd()).key;
  const v = touState.draft || versions.find(x => x.key === touState.key) || TOU_BASE;
  const editable = !!touState.draft || !v.builtin, ro = editable ? "" : " readonly";
  body.innerHTML = `
    <div class="row" style="align-items:flex-end">
      <div class="reg-field" style="min-width:320px"><label>버전 선택</label><select id="touVer">${touState.draft ? `<option value="">(새 버전 작성 중)</option>` : ""}
        ${versions.map(x => `<option value="${tEsc(x.key)}"${!touState.draft && x.key === v.key ? " selected" : ""}>${tEsc(touLabel(x))}</option>`).join("")}</select></div>
      ${touState.draft ? "" : `<button class="btn secondary" id="touNew">새 버전 만들기</button>`}
    </div>
    <div class="tou-meta">
      <div class="reg-field"><label>버전명</label><input id="touName" value="${tEsc(v.name)}"${ro}></div>
      <div class="reg-field"><label>적용 시작일</label><input type="date" id="touStart" value="${tEsc(v.start)}"${ro}></div>
      <div class="reg-field"><label>적용 종료일</label><input type="date" id="touEnd" value="${tEsc(v.end)}"${ro}></div>
      <div class="reg-field"><label>메모</label><input id="touMemo" value="${tEsc(v.memo)}"${ro}></div>
    </div>
    <div class="tou-legend">${Object.keys(TOU_NAME).map(k => `<span class="tou-key ${k}"></span>${TOU_NAME[k]}`).join("")}</div>
    <div class="grid-wrap tou-wrap"><table class="tou-table"><tr><th>구분</th>${Array.from({ length: 12 }, (_, m) => `<th>${m + 1}</th>`).join("")}</tr>
      ${Array.from({ length: 24 }, (_, h) => `<tr><th>${h + 1}</th>${v.tariff.map((row, m) =>
        `<td class="tou-cell ${row[h]}${editable ? " edit" : ""}" data-m="${m}" data-h="${h}">${TOU_NAME[row[h]]}</td>`).join("")}</tr>`).join("")}</table></div>
    ${editable ? `<div class="row" style="margin-top:12px"><button class="btn accent" id="touSave">저장</button>
      ${touState.draft ? `<button class="btn secondary" id="touCancel">취소</button>` : `<button class="btn secondary danger" id="touDel">삭제</button>`}
      <span id="touStatus" class="status warn" style="background:none"></span></div>` : ""}`;
  document.getElementById("touVer").onchange = e => { if (!e.target.value && touState.draft) return; touState.draft = null; touState.key = e.target.value; renderLoadTab(); };
  if (!touState.draft) document.getElementById("touNew").onclick = () => {
    touState.draft = { key: null, name: "", start: todayYmd(), end: "", memo: "", tariff: v.tariff.slice() }; renderLoadTab();
  };
  if (!editable) return;
  body.querySelectorAll(".tou-cell.edit").forEach(td => td.onclick = () => {
    const m = Number(td.dataset.m), h = Number(td.dataset.h), row = v.tariff[m].split("");
    row[h] = TOU_NEXT[row[h]]; v.tariff[m] = row.join("");
    td.className = `tou-cell ${row[h]} edit`; td.textContent = TOU_NAME[row[h]];
  });
  document.getElementById("touSave").onclick = () => saveTouVersion(v);
  if (touState.draft) document.getElementById("touCancel").onclick = () => { touState.draft = null; renderLoadTab(); };
  else document.getElementById("touDel").onclick = async () => {
    if (!confirm(`${v.name} 버전을 삭제할까요?`)) return;
    await Store.set(v.key, { deleted: true }); // 저장소는 키 삭제가 없어 표시만 남기고 목록에서 뺀다
    touState.key = null; renderLoadTab();
  };
}

async function saveTouVersion(v) {
  const st = document.getElementById("touStatus");
  const rec = { name: document.getElementById("touName").value.trim(), start: document.getElementById("touStart").value,
    end: document.getElementById("touEnd").value, memo: document.getElementById("touMemo").value.trim(), tariff: v.tariff.slice(), savedAt: new Date().toISOString() };
  if (!rec.name || !rec.start) { st.textContent = "버전명과 적용 시작일을 입력하세요."; st.className = "status bad"; return; }
  if (rec.end && rec.end < rec.start) { st.textContent = "적용 종료일이 시작일보다 빠릅니다."; st.className = "status bad"; return; }
  const key = v.key || "touver:" + Date.now();
  const where = await Store.set(key, rec);
  touState.draft = null; touState.key = key; renderLoadTab();
  const st2 = document.getElementById("touStatus");
  if (st2) { st2.textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨"; st2.className = "status " + (where === "remote" ? "ok" : "warn"); }
}

function renderHolidayTab() {
  const body = document.getElementById("touBody"), y = touState.year, list = holidayList(y);
  body.innerHTML = `${yearSelect("holYear")}
    <div class="grid-wrap" style="margin-top:12px; max-height:none"><table class="grid"><tr><th style="width:160px">날짜</th><th>휴일명</th><th style="width:120px">출처</th><th style="width:70px"></th></tr>
      ${list.length ? list.map((h, i) => `<tr><td>${y}-${h.d}</td><td>${tEsc(h.name)}</td><td><span class="tag">${tEsc(h.src || "수동")}</span></td>
        <td style="text-align:center"><button class="btn secondary small hol-del" data-i="${i}">삭제</button></td></tr>`).join("")
        : `<tr><td colspan="4" class="empty">없음</td></tr>`}</table></div>
    <div class="row" style="margin-top:12px"><input type="date" id="holDate" min="${y}-01-01" max="${y}-12-31"><input id="holName" placeholder="휴일명" style="padding:7px 9px;border:1px solid var(--line);border-radius:6px;font-size:13px">
      <button class="btn secondary" id="holAdd">휴일 추가</button><span id="holStatus" class="status warn" style="background:none"></span></div>`;
  document.getElementById("holYear").onchange = e => { touState.year = e.target.value; renderHolidayTab(); };
  body.querySelectorAll(".hol-del").forEach(b => b.onclick = async () => {
    const next = list.filter((_, i) => i !== Number(b.dataset.i));
    await saveHolidayYear(y, next); renderHolidayTab();
  });
  document.getElementById("holAdd").onclick = async () => {
    const d = document.getElementById("holDate").value, name = document.getElementById("holName").value.trim();
    const st = document.getElementById("holStatus");
    if (!d || d.slice(0, 4) !== y) { st.textContent = `${y}년 날짜를 고르세요.`; st.className = "status bad"; return; }
    if (list.some(h => h.d === d.slice(5))) { st.textContent = "이미 등록된 날짜입니다."; st.className = "status bad"; return; }
    await saveHolidayYear(y, list.concat([{ d: d.slice(5), name: name || "휴일", src: "수동" }])); renderHolidayTab();
  };
}

function renderDayTab() {
  const body = document.getElementById("touBody"), y = Number(touState.year);
  const days = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 86400000) days.push(new Date(t).toISOString().slice(0, 10));
  const cls = { "공": "hol", "토": "sat", "평": "wd" };
  const cell = d => { if (!d) return "<td></td><td></td><td></td>"; const t = Parsers.dayType(d);
    return `<td>${d}</td><td>${DOW[new Date(d + "T00:00:00Z").getUTCDay()]}</td><td class="c"><span class="day-badge ${cls[t]}">${t}</span></td>`; };
  const rows = [];
  for (let i = 0; i < days.length; i += 3) rows.push(`<tr>${cell(days[i])}${cell(days[i + 1])}${cell(days[i + 2])}</tr>`);
  body.innerHTML = `${yearSelect("dayYear")}
    <div class="tou-legend" style="margin-top:12px"><span class="day-badge hol">공</span>공휴일·일요일<span class="day-badge sat">토</span>토요일<span class="day-badge wd">평</span>평일(월~금)</div>
    <div class="grid-wrap" style="max-height:620px"><table class="grid day-table"><tr>${"<th>날짜</th><th>요일</th><th class=\"c\">구분</th>".repeat(3)}</tr>${rows.join("")}</table></div>`;
  document.getElementById("dayYear").onchange = e => { touState.year = e.target.value; renderDayTab(); };
}

// Store.load 이후 호출 (billing.js initBilling)
function initTariff() {
  applyHolidays();
  Parsers.tariffFor = date => touVersionFor(date).tariff;
  touState.key = null; touState.draft = null;
  renderTouPage();
}
