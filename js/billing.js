/* ============ 수요기업 정산 모듈 UI (가정산서 / 오차정산서) ============
 * 정산 > 전기사용자 페이지: 위쪽 업로드 카드(정산 구분 + KPX·사용량 업로드, upload.js 가 onKpxFile 호출) + 가정산서/오차정산서
 * 정산요율관리 > KPX 요율 관리(#tab4): js/kpxrates.js 발전소·전기사용자 등록은 js/registry.js
 * 계산은 js/engine.js, 파일 해석은 js/parsers.js. 여기서는 화면과 저장만 다룬다.
 */
const INVOICE_PREFIX = "200005"; // 수요기업 청구서 번호 접두 (발전사업자 정산서는 BUYER.invoicePrefix)

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const won = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString() + " 원";
const kwhStr = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString() + " kWh";
const $ = id => document.getElementById(id);

const billState = { kpx: null, ami: null, amiName: "", result: null };

/* ---------- 요율 ----------
 * 기본값(Engine.DEFAULT_RATES) 위에 KPX 요율 관리의 버전(적용일자 <= 정산월 1일 중 최신) 값을 덮어쓴다 (js/kpxrates.js)
 */
function ratesFor(month) {
  const v = /^\d{6}$/.test(month) && typeof netVersionFor === "function" ? netVersionFor(`${month.slice(0, 4)}-${month.slice(4)}-01`) : null;
  const rates = Object.assign({}, Engine.DEFAULT_RATES, { month });
  return { rates: v ? applyNetVersion(rates, v) : rates, version: v };
}

/* ---------- 정산 구분 (업로드 카드 라디오: 가정산 / 오차정산) ---------- */
const MODE_LABEL = { provisional: "가정산", trueup: "오차정산" };
const custByApp = app => Registry.customerByApp(app);
const monthLabel = m => `${m.slice(0, 4)}.${m.slice(4)}`;
const monthKo = m => `${m.slice(0, 4)}년 ${Number(m.slice(4))}월`;
function prevYm(m) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(4)) - 1; if (!mo) { y--; mo = 12; } return `${y}${String(mo).padStart(2, "0")}`; }
function nextYm(m) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(4)) + 1; if (mo > 12) { y++; mo = 1; } return `${y}${String(mo).padStart(2, "0")}`; }

function getSettleMode() { const r = document.querySelector('input[name="settleMode"]:checked'); return r ? r.value : "provisional"; }

function updateModeHint() {}

// 가정산 파일로 오차정산을 계산하는 실수를 막기 위해, 구분을 바꾸면 수요기업 쪽 업로드를 비우고 다시 올리게 한다.
function onModeChange() {
  billState.kpx = null; billState.ami = null; billState.amiName = ""; billState.result = null;
  $("dataFile").value = ""; $("amiFile").value = "";
  $("kpxStatus").style.display = "none";
  $("amiStatus").textContent = "미선택"; $("amiStatus").className = "status warn";
  updateModeHint(); renderBillingBody();
}

/* ---------- 업로드 (업로드 카드에서 호출) ---------- */
function readFileAsText(file) {
  return file.arrayBuffer().then(buf => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("euc-kr").decode(buf); }
  });
}

async function onKpxFile(file) {
  const st = $("kpxStatus"); st.style.display = "inline-flex"; st.textContent = "수요기업: 읽는 중..."; st.className = "status warn";
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
    const parsed = Parsers.parseKpxRows(rows);
    const apps = Object.keys(parsed.groups);
    if (!apps.length) throw new Error("신청번호/발전기명이 있는 행을 찾지 못했습니다. KPX 직접전력거래량 파일이 맞는지 확인하세요.");
    billState.kpx = parsed; billState.result = null;
    const unknown = apps.filter(a => !custByApp(a)).length;
    st.textContent = `수요기업 ${MODE_LABEL[getSettleMode()]}: 그룹(신청번호) ${apps.length}개` + (unknown ? ` · 미등록 ${unknown}개` : "");
    st.className = "status ok";
    renderBillingBody();
    // [그룹화]에서 이 그룹을 열어두었으면 업로드한 달의 집계로 갱신
    if (regState.openGroup && parsed.groups[regState.openGroup]) { regState.month = parsed.groups[regState.openGroup].month; renderGroupPage(); }
  } catch (e) { billState.kpx = null; st.textContent = "수요기업: " + e.message; st.className = "status bad"; renderBillingBody(); }
}

async function onAmiFile(file) {
  const st = $("amiStatus");
  try {
    const ami = Parsers.parseAmiHtml(await readFileAsText(file));
    if (!ami.dates.length) throw new Error(ami.warnings[0] || "읽을 수 있는 데이터가 없습니다.");
    billState.ami = ami; billState.amiName = file.name; billState.result = null;
    st.textContent = `${file.name} — ${ami.dates.length}일 (${ami.dates[0]} ~ ${ami.dates[ami.dates.length - 1]})`; st.className = "status ok";
  } catch (e) { billState.ami = null; st.textContent = "오류: " + e.message; st.className = "status bad"; }
  renderBillingBody();
}

/* ---------- 전기사용자 정산 화면 #tab5 (구분에 따라 가정산서 / 오차정산서) ---------- */
const fieldHtml = (label, inner) => `<div class="adj-item"><label class="adj-label">${label}</label>${inner}</div>`;
const numField = (label, id, val) => fieldHtml(label, `<input type="number" id="${id}" step="any" value="${val == null ? "" : val}">`);

function surchargeRowHtml() {
  return `<div class="row"><label>확정 부가정산금 총액</label><input type="number" id="cs_total" style="width:130px"><label>과세 비율</label><input type="number" id="cs_ratio" step="any" style="width:90px"><button class="btn secondary" id="cs_split">분할</button></div>`;
}

function provisionalFormHtml() {
  return `<div class="card"><h2>전월 오차정산 반영</h2>
    ${surchargeRowHtml()}
    <div class="adj-grid">
      ${numField("전월 확정 부가정산금 (과세)", "cs_taxable", 0)}${numField("전월 확정 부가정산금 (비과세)", "cs_exempt", 0)}
      ${numField("전월 차액 (과세)", "pd_taxable", 0)}${numField("전월 차액 (비과세)", "pd_exempt", 0)}
      ${fieldHtml("납부기한", `<input type="date" id="dueDate">`)}</div>
    <div class="row" style="margin-top:10px"><button class="btn accent" id="calcBtn">가정산서 계산</button></div></div>`;
}

function trueUpFormHtml() {
  return `<div class="card"><h2>가정산 (비교 기준)</h2>
      <div class="adj-grid">${numField("공급량 (kWh)", "pv_supply")}${numField("전력량요금 (원)", "pv_energy")}${numField("송배전용 전기설비 이용요금 (원)", "pv_net")}${numField("거래수수료 (원)", "pv_fee")}</div></div>
    <div class="card"><h2>확정 부가정산금 · 전월 차액</h2>
      ${surchargeRowHtml()}
      <div class="adj-grid">
        ${numField("확정 부가정산금 (과세)", "cs_taxable", 0)}${numField("확정 부가정산금 (비과세)", "cs_exempt", 0)}
        ${numField("차액 (과세)", "pd_taxable", 0)}${numField("차액 (비과세)", "pd_exempt", 0)}
        ${fieldHtml("메모", `<input id="tu_note">`)}</div>
      <div class="row" style="margin-top:10px"><button class="btn accent" id="calcBtn">오차정산 계산</button></div></div>`;
}

function renderBillingBody() {
  const host = $("billBody"); if (!host) return;
  const mode = getSettleMode(), trueUp = mode === "trueup";
  if (!billState.kpx) {
    host.innerHTML = `<div class="card"><h2>수요기업 ${MODE_LABEL[mode]}서</h2></div>`;
    return;
  }
  const apps = Object.keys(billState.kpx.groups);
  host.innerHTML = `
    <div class="card"><div class="row"><span class="mode-badge ${mode}">${MODE_LABEL[mode]}</span>
      <label>그룹(신청번호)</label><select id="groupSel" style="min-width:380px">${apps.map(a => {
        const g = billState.kpx.groups[a], c = custByApp(a);
        return `<option value="${esc(a)}">${esc(a)} — ${esc(c ? c.name : "미등록")} (${Object.keys(g.plants).length}개 발전소, ${monthLabel(g.month)})</option>`; }).join("")}</select>
      <span id="billMonthBadge" class="badge"></span></div></div>
    ${trueUp ? trueUpFormHtml() : provisionalFormHtml()}
    <div id="billResult"></div>
    <div class="row no-print" id="billActions" style="display:none; margin-top:10px"><button class="btn secondary" id="billXlsx">Excel 다운</button><button class="btn secondary" id="billPrint">인쇄 / PDF 저장</button>
      <button class="btn accent" id="billSave">${trueUp ? "오차정산 저장 (다음 달 가정산으로 이월)" : "가정산 기록 저장"}</button><span id="billSaveStatus" class="status warn" style="background:none"></span></div>`;
  $("groupSel").onchange = onGroupChange;
  $("cs_split").onclick = splitConfirmed;
  $("cs_total").oninput = $("cs_ratio").oninput = splitConfirmed;
  $("calcBtn").onclick = trueUp ? runTrueUp : runCalc;
  $("billXlsx").onclick = trueUp ? exportTrueUpExcel : exportBillExcel;
  $("billPrint").onclick = () => { if (!trueUp || renderTrueUpResult()) window.print(); }; // 오차정산은 입력값을 다시 읽어 문서 갱신 후 인쇄
  $("billSave").onclick = trueUp ? saveTrueUp : saveBill;
  onGroupChange();
}

function onGroupChange() {
  const app = $("groupSel").value; if (!app || !billState.kpx) return;
  const g = billState.kpx.groups[app];
  billState.result = null; $("billResult").innerHTML = ""; $("billActions").style.display = "none"; $("billSaveStatus").textContent = "";
  $("billMonthBadge").textContent = `정산월 ${monthLabel(g.month)}`;
  if (getSettleMode() === "trueup") fillTrueUpForm(app, g.month); else fillProvisionalForm(app, g.month);
}

const setVal = (id, v) => { $(id).value = v == null ? "" : v; };

// 가정산: 전월 오차정산(carry:<이번달>:<신청번호>)이 있으면 그대로 채운다
function fillProvisionalForm(app, month) {
  const prevMonth = prevYm(month);
  const carry = Store.get(`carry:${month}:${app}`, null);
  if (carry) {
    setVal("cs_total", carry.confirmedTotal); setVal("cs_ratio", carry.taxableRatio);
    setVal("cs_taxable", carry.confirmed.taxable); setVal("cs_exempt", carry.confirmed.exempt);
    setVal("pd_taxable", carry.prevDiff.taxable); setVal("pd_exempt", carry.prevDiff.exempt);
  } else {
    setVal("cs_total", ""); ["cs_taxable", "cs_exempt", "pd_taxable", "pd_exempt"].forEach(id => setVal(id, 0));
    setVal("cs_ratio", ratesFor(prevMonth).rates.taxableRatio);
  }
}

function splitConfirmed() {
  if ($("cs_total").value === "") return;
  const s = Engine.splitSurcharge(Number($("cs_total").value) || 0, { taxableRatio: Number($("cs_ratio").value) || 0 });
  $("cs_taxable").value = s.taxable; $("cs_exempt").value = s.exempt;
}

/* ---------- 계산 공통 ---------- */
function prepareGroup(err, warn) {
  if (!billState.kpx) throw new Error("위 업로드 카드에서 KPX 직접전력거래량 파일을 먼저 올리세요.");
  const app = $("groupSel").value, g = billState.kpx.groups[app];
  const customer = Registry.customerByApp(app, g.month);
  const nContracts = Registry.contractsOfApp(app).length;
  const priceSplits = Registry.priceSplits(app, g.month); // 그 달 유효 계약이 여러 건이면 전력량요금을 계약별 단가로
  if (priceSplits && priceSplits.some(x => !(x.unitPrice > 0))) err.push(`신청번호 ${app} 의 계약 중 계약단가가 비어 있는 계약이 있습니다: ${priceSplits.filter(x => !(x.unitPrice > 0)).map(x => x.id).join(", ")}`);
  if (!customer) err.push(`신청번호 ${app} 에 해당하는 전기사용자 계약이 없습니다. [정산관리 > 계약관리]에서 등록하세요.`);
  const unreg = Object.keys(g.plants).filter(p => { const i = Registry.plantInfo(p); return !i || !i.region; });
  if (unreg.length) err.push("등록되지 않았거나 지역이 비어 있는 발전소: " + unreg.join(", ") + " → [정산관리 > 계약관리]에서 등록하세요.");
  const { rates, version } = ratesFor(g.month);
  if (!version) warn.push(`${g.month} 에 적용되는 KPX 요율 버전이 없어 기본값으로 계산했습니다.`);
  const plants = {}; Object.keys(g.plants).forEach(p => {
    const i = Registry.plantInfo(p);
    plants[p] = i && i.region ? i : Object.assign({ distConnected: false, distLow: false }, i || {}, { region: "비수도권" }); // 미리보기용 임시값
  });
  const days = Parsers.buildDays(g, billState.ami);
  days.forEach(d => { d.amiUsage = d.usage; }); // 고객 사용량(15분) 원본 — 재생E공급량이 빈 가정산 파일일 때 공급량 계산에 사용
  // 사용량은 부하구분별 사용량·부족전력량 표시에만 쓴다 (공급량은 KPX 재생E공급량). 파일이 없거나 빈 시간은 KPX 전기사용량으로.
  if (billState.ami) {
    const miss = Parsers.missingDates(g.month, billState.ami.dates);
    if (miss.length) warn.push(`사용량 파일에 없는 날짜 ${miss.length}일 — 해당일은 KPX 전기사용량으로 표시합니다. (공급량·금액에는 영향 없음)`);
    billState.ami.warnings.filter(w => /합계 불일치|96칸/.test(w)).forEach(w => warn.push(w));
    days.forEach(d => {
      if (!d.usage) { d.usage = d.kpxUsage; return; }
      if (d.kpxUsage) d.usage = d.usage.map((v, h) => v == null ? d.kpxUsage[h] : v);
    });
  } else {
    days.forEach(d => { d.usage = d.kpxUsage; });
    warn.push("고객 사용량 파일이 없어 KPX 파일의 전기사용량으로 표시했습니다. (공급량·금액에는 영향 없음)");
  }
  // 정보가 부족하면 미리보기: 임시값(전기사용자 = 신청번호, 지역 비수도권, 단가 0원)으로 계산하고 저장은 막는다
  const preview = err.length > 0;
  const cust = customer ? Object.assign({}, customer) : { name: `(미등록) ${app}`, bizNo: "", address: "", manager: "", contact: "", demandRegion: "비수도권", unitPrice: 0, appNo: app, contractId: app };
  if (!cust.demandRegion) cust.demandRegion = "비수도권";
  if (!(cust.unitPrice >= 0)) cust.unitPrice = 0;
  return { app, g, customer: cust, rates, plants, days, priceSplits, preview };
}
const previewNotice = err => `<div class="notice bad"><b>미리보기 — 등록 정보가 부족해 임시값으로 계산했습니다 (저장 불가)</b><br>${err.map(esc).join("<br>")}<br>임시값: 미등록 전기사용자는 신청번호로 표시, 지역 없음 = 비수도권, 단가 없음 = 0원</div>`;
// 단가가 비어 있는 계약은 0원으로 계산 (미리보기)
const safeSplits = sp => sp ? sp.map(x => Object.assign({}, x, { unitPrice: x.unitPrice > 0 ? x.unitPrice : 0 })) : sp;
// 공급량 = KPX 재생E공급량 (가정산·오차정산 공통), 초과발전량 = 발전량 − 공급량
// 가정산 KPX 파일은 재생E공급량·전기사용량이 비어(0) 있다 → 엑셀 가정산 방식: 시간별 min(사용량, 발전량), 사용량 파일이 없으면 발전량 전량 공급
function matchKpx(P, warn) {
  const sum = key => P.days.reduce((t, d) => t + Object.values(d[key] || {}).reduce((a, arr) => a + arr.reduce((x, y) => x + (y || 0), 0), 0), 0);
  if (sum("supply") <= 0 && sum("gen") > 0) {
    warn.push(billState.ami ? "KPX 재생E공급량이 비어 있어(가정산 파일) 공급량 = 시간별 min(고객 사용량, 발전량)으로 계산했습니다."
                            : "KPX 재생E공급량이 비어 있어(가정산 파일) 공급량 = 발전량(전량 공급)으로 계산했습니다. 고객 사용량 파일을 올리면 시간별 min(사용량, 발전량)으로 계산합니다.");
    const i = warn.findIndex(w => w.indexOf("KPX 파일의 전기사용량으로 표시") >= 0); if (i >= 0) warn.splice(i, 1); // 이 경우엔 해당 없음
    return Engine.matchMonth(P.days.map(d => Object.assign({}, d, { usage: d.amiUsage || null })), P.rates);
  }
  const m = Engine.matchMonthKpx(P.days, P.rates);
  if (!m.totals.supply) warn.push("KPX 재생E공급량 합계가 0입니다. 파일이 맞는지 확인하세요.");
  return m;
}
const noticeHtml = (list, cls) => list.length ? `<div class="notice ${cls}">${list.map(esc).join("<br>")}</div>` : "";

/* ---------- 가정산 계산 ---------- */
function runCalc() {
  const out = $("billResult"); const warn = [], err = [];
  try {
    const P = prepareGroup(err, warn);
    const match = matchKpx(P, warn);
    const ctx = {
      unitPrice: P.customer.unitPrice, priceSplits: safeSplits(Registry.priceSplits(P.app, P.g.month, match.supplyByPlant)), demandRegion: P.customer.demandRegion, plants: P.plants,
      confirmedSurcharge: { taxable: Number($("cs_taxable").value) || 0, exempt: Number($("cs_exempt").value) || 0 },
      prevDiff: { taxable: Number($("pd_taxable").value) || 0, exempt: Number($("pd_exempt").value) || 0 },
      penalty: typeof penaltyDueGroup === "function" ? penaltyDueGroup(P.app, P.g.month) : null
    };
    const carry = Store.get(`carry:${P.g.month}:${P.app}`, null);
    if (carry && (ctx.confirmedSurcharge.taxable !== carry.confirmed.taxable || ctx.confirmedSurcharge.exempt !== carry.confirmed.exempt
      || ctx.prevDiff.taxable !== carry.prevDiff.taxable || ctx.prevDiff.exempt !== carry.prevDiff.exempt))
      warn.push("전월 오차정산 칸이 저장된 오차정산 값과 다릅니다. 직접 고친 값으로 계산했습니다.");
    const inv = Engine.invoice(match, ctx, P.rates);
    billState.result = { mode: "provisional", preview: P.preview, app: P.app, month: P.g.month, customer: P.customer, rates: P.rates, match, inv, ctx, dueDate: $("dueDate").value };
    out.innerHTML = (P.preview ? previewNotice(err) : "") + noticeHtml(warn, "warn") + invoiceHtml(billState.result);
    $("billActions").style.display = "flex";
    $("billSave").disabled = !!P.preview; // 미리보기는 저장 불가
  } catch (e) { out.innerHTML = `<div class="notice bad">계산 오류: ${esc(e.message)}</div>`; }
}

// 정산서 공통 틀 (발전사업자 정산서와 같은 A4 양식: 로고 · 제목 · 왼쪽 구분 열 + 6칸 · 서명)
const DOC_COLS = `<colgroup><col><col><col><col><col><col><col></colgroup>`;
const docField = (label, val) => `<td class="label">${label}</td><td colspan="2">${val}</td>`;
function customerInfoTable(c, R) {
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="3">전기사용자<br>정보</th>${docField("사업자명 (대표자명)", esc(c.name) + (c.ceo ? ` (${esc(c.ceo)})` : ""))}${docField("사업자등록번호", esc(c.bizNo || "-"))}</tr>
      <tr>${docField("전기사용장소", esc(c.address || "-"))}${docField("계약 / 신청번호", esc((c.contractId && c.contractId !== R.app ? c.contractId + " / " : "") + R.app))}</tr>
      <tr>${docField("담당자", esc(c.manager || "-"))}${docField("연락처", esc(c.contact || "-"))}</tr></table>`;
}
function usageTable(match, title) {
  const loads = ["경부하", "중간부하", "최대부하"];
  const cell = b => `<td class="num">${kwhStr(b.usage)}</td><td class="num">${kwhStr(b.supply)}</td><td class="num">${kwhStr(b.deficitSimple)}</td><td class="num">${kwhStr(b.deficitLoss)}</td><td class="num">${kwhStr(b.deficitSimple + b.deficitLoss)}</td>`;
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="5">${title}</th><td class="label">구분</td><td class="label">전기사용량</td><td class="label">공급량</td><td class="label">부족전력량<br>(단순)</td><td class="label">부족전력량<br>(전력손실률)</td><td class="label">부족전력량 계</td></tr>
      ${loads.map(l => `<tr><td class="label">${l}</td>${cell(match.byLoad[l] || { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 })}</tr>`).join("")}
      <tr class="total"><td class="label">계</td>${cell(match.totals)}</tr></table>`;
}
function buyerTable(R, docNo) {
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="3">청구<br>정보</th>${docField("사업자명 (대표자명)", esc(BUYER.bizName))}${docField("사업자등록번호", esc(BUYER.bizRegNo))}</tr>
      <tr>${docField("담당자", esc(BUYER.manager))}${docField("연락처", esc(BUYER.contact))}</tr>
      <tr>${docField("문서번호", docNo)}${docField("납부기한", esc(R.dueDate || "-"))}</tr></table>`;
}
function docSignature(R, what, c) {
  const t = new Date(todayYmd() + "T00:00:00");
  return `<div class="doc-date">${t.getFullYear()}년 ${String(t.getMonth() + 1).padStart(2, "0")}월 ${String(t.getDate()).padStart(2, "0")}일</div>
    <div class="doc-signature">
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthKo(R.month)} 직접PPA 전력거래대금 ${what}을 확인합니다.</div><div class="sign-role">전기사용자</div><div class="sign-name">${esc(c.name)} (인)</div></div>
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthKo(R.month)} 직접PPA 전력거래대금 ${what}을 제출합니다.</div><div class="sign-role">재생에너지전기공급사업자</div><div class="sign-name">한화신한테라와트아워 주식회사 (인)</div></div>
    </div>`;
}

function invoiceHtml(R) {
  const { inv, match, customer: c, rates, ctx } = R;
  const prevM = Number(prevYm(R.month).slice(4)), curM = Number(R.month.slice(4));
  // 금액 행: 항목 | 금액 | 산출근거(4칸)
  const row = (l, a, basis, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="label">${l}</td><td class="num">${a}</td><td class="basis" colspan="4">${basis || ""}</td></tr>`;
  const energyBasis = inv.energyParts.length > 1
    ? inv.energyParts.map(x => `${esc(x.id)} ${kwhStr(x.kwh)} × ${x.unitPrice} 원/kWh = ${x.amount.toLocaleString()} 원`).join("<br>")
    : `공급량 ${kwhStr(inv.supplyTotal)} × ${ctx.unitPrice} 원/kWh`;
  const taxRows = [
    row("전력량요금", won(inv.energy), energyBasis),
    row("송배전용 전기설비<br>이용요금 (망이용요금)", won(inv.netTotal), "발전소별 합계 (아래 상세)"),
    row("거래수수료", won(inv.fee), `공급량 ${kwhStr(inv.supplyTotal)} × ${rates.tradeFee} 원/kWh`),
    row(`${prevM}월 확정 부가정산금 (과세)`, won(inv.confirmedSurcharge.taxable), `${prevM}월 오차 정산서`),
    row("공급가액 (전월 차액 반영 전)", won(inv.supplyBefore), "전력량요금 + 망이용요금 + 거래수수료 + 확정 부가정산금(과세)", "total"),
    row("전월 차액 (과세)", won(inv.prevDiff.taxable), `${prevM}월 오차 정산서`),
    row("공급가액 (전월 차액 반영 후)", won(inv.supplyAfter), "", "total"),
    row("부가가치세 계", won(inv.vatTotal), `전력량 ${inv.vat.energy.toLocaleString()} + 망이용 ${inv.vat.network.toLocaleString()} + 수수료 ${inv.vat.fee.toLocaleString()} + 부가정산금 ${inv.vat.surcharge.toLocaleString()} + 전월차액 ${inv.vat.prevDiff.toLocaleString()}`),
    row("세금계산서 계", won(inv.taxInvoice), "공급가액 + 부가가치세", "total")
  ];
  const exRows = [
    row(`${prevM}월 확정 부가정산금 (비과세)`, won(inv.confirmedSurcharge.exempt), `${prevM}월 오차 정산서`),
    row(`${curM}월 예상 부가정산금`, won(inv.expectedSurcharge), `공급량 × ${rates.surcharge} 원/kWh, 익월 확정 후 청구 (청구서 계 미포함, 기금 산정에만 사용)`),
    row("전력산업기반기금 (비과세)", won(inv.fund), `(전력량요금 + 망이용요금 + 거래수수료 + 예상 부가정산금) × ${(rates.fundRate * 100).toFixed(1)}%, 10원 미만 절사`),
    row("전월 차액 (비과세)", won(inv.prevDiff.exempt), `${prevM}월 오차 정산서`)
  ].concat(inv.penalty ? [row("위약금 차감", won(-inv.penalty), `연간보장공급량 ${esc(inv.penaltyLabel)}`)] : [])
   .concat([row("청구서 계", won(inv.exemptSubtotal), "확정 부가정산금(비과세) + 기금 + 전월 차액(비과세)", "total")]);
  const plantsN = Object.keys(inv.netByPlant);
  return `<div class="doc">
    <div class="doc-header"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo"></div>
    <h1 class="title">직접PPA 전력거래대금 청구서</h1><div class="month">(${monthKo(R.month)} 가정산)</div>
    ${customerInfoTable(c, R)}
    ${usageTable(match, "거래<br>내역")}
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${taxRows.length + 1}">세금<br>계산서</th><td class="label">항목</td><td class="label">금액</td><td class="label" colspan="4">산출근거</td></tr>
      ${taxRows.join("")}
      <tr><th class="section" rowspan="${exRows.length}">청구서</th>${exRows[0].replace(/^<tr[^>]*>/, "")}
      ${exRows.slice(1).join("")}
      <tr class="pay"><th class="section">합계</th><td class="label">당월 청구 계</td><td class="num" colspan="5">${won(inv.grandTotal)}</td></tr></table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${plantsN.length + 1}">발전소별<br>망이용요금</th><td class="label" colspan="2">발전소</td><td class="label" colspan="2">공급량 (반올림)</td><td class="label" colspan="2">망이용요금</td></tr>
      ${plantsN.map(p => `<tr><td colspan="2">${esc(p)}</td><td class="num" colspan="2">${inv.netByPlant[p].supplyRounded.toLocaleString()} kWh</td><td class="num" colspan="2">${won(inv.netByPlant[p].fee)}</td></tr>`).join("")}</table>
    ${buyerTable(R, `${INVOICE_PREFIX}-${R.month}-0001`)}
    ${docSignature(R, "가정산", c)}
  </div>`;
}

// 가정산 스냅샷: 오차정산 때 비교 기준이 된다 (bill:YYYYMM:신청번호)
async function saveBill() {
  const R = billState.result; if (!R || R.mode !== "provisional" || R.preview) return; // 미리보기는 저장하지 않음
  const key = `bill:${R.month}:${R.app}`;
  if (Store.get(key, null) && !confirm(`${monthLabel(R.month)} ${R.customer.name} 가정산 기록이 이미 있습니다. 덮어쓸까요?\n(오차정산은 이 기록과 비교합니다)`)) return;
  const inv = R.inv, netByPlant = {};
  Object.keys(inv.netByPlant).forEach(p => netByPlant[p] = inv.netByPlant[p].fee);
  const where = await Store.set(key, {
    supplyTotal: inv.supplyTotal, supply: inv.supplyTotal, energy: inv.energy, netTotal: inv.netTotal, netByPlant, fee: inv.fee,
    expectedSurcharge: inv.expectedSurcharge, fund: inv.fund, grandTotal: inv.grandTotal,
    unitPrice: R.ctx.unitPrice, customerName: R.customer.name, savedAt: new Date().toISOString()
  });
  $("billSaveStatus").textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨";
}

function exportBillExcel() {
  const R = billState.result; if (!R) return;
  const { inv, match } = R; const aoa = [
    ["직접PPA 전력거래대금 청구서", R.month], ["수요기업", R.customer.name], [],
    ["구분", "전기사용량", "공급량", "부족(단순)", "부족(손실률)"],
    ...["경부하", "중간부하", "최대부하"].map(l => { const b = match.byLoad[l] || {}; return [l, b.usage || 0, b.supply || 0, b.deficitSimple || 0, b.deficitLoss || 0]; }), [],
    ["항목", "금액"], ["전력량요금", inv.energy], ...(inv.energyParts.length > 1 ? inv.energyParts.map(x => ["  " + x.id + " (" + Math.round(x.kwh) + " kWh × " + x.unitPrice + ")", x.amount]) : []), ["망이용요금", inv.netTotal], ["거래수수료", inv.fee],
    ["전월 확정 부가정산금(과세)", inv.confirmedSurcharge.taxable], ["전월 차액(과세)", inv.prevDiff.taxable],
    ["공급가액", inv.supplyAfter], ["부가가치세", inv.vatTotal], ["세금계산서 계", inv.taxInvoice],
    ["전월 확정 부가정산금(비과세)", inv.confirmedSurcharge.exempt], ["예상 부가정산금(참고)", inv.expectedSurcharge],
    ["전력산업기반기금", inv.fund], ["전월 차액(비과세)", inv.prevDiff.exempt], ["청구서 계", inv.exemptSubtotal], ["당월 청구 계", inv.grandTotal], [],
    ["발전소", "공급량", "망이용요금"], ...Object.keys(inv.netByPlant).map(p => [p, inv.netByPlant[p].supplyRounded, inv.netByPlant[p].fee])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "청구서");
  XLSX.writeFile(wb, `청구서_${R.customer.name}_${R.month}.xlsx`);
}

/* ---------- 오차정산 ----------
 * 같은 달을 KPX 확정 파일로 다시 계산해 저장된 가정산(bill:)과 전력량요금·망이용요금·거래수수료를 비교한다.
 * 확정 부가정산금(과세/비과세)과 차액(과세/비과세)을 carry:<다음달>:<신청번호> 로 저장 → 다음 달 가정산서에 자동으로 들어간다.
 * 시스템 밖(엑셀)에서 만든 가정산은 비교 기준 값을 직접 입력한다.
 */
function fillTrueUpForm(app, month) {
  const bill = Store.get(`bill:${month}:${app}`, null);
  const hasBill = !!(bill && bill.energy != null);
  const saved = Store.get(`carry:${nextYm(month)}:${app}`, null);
  const prov = hasBill ? bill : (saved && saved.provisional) || {};
  setVal("pv_supply", prov.supplyTotal); setVal("pv_energy", prov.energy); setVal("pv_net", prov.netTotal); setVal("pv_fee", prov.fee);
  ["pv_supply", "pv_energy", "pv_net", "pv_fee"].forEach(id => { $(id).readOnly = hasBill; });
  if (saved) {
    setVal("cs_total", saved.confirmedTotal); setVal("cs_ratio", saved.taxableRatio);
    setVal("cs_taxable", saved.confirmed.taxable); setVal("cs_exempt", saved.confirmed.exempt);
    setVal("pd_taxable", saved.prevDiff.taxable); setVal("pd_exempt", saved.prevDiff.exempt); setVal("tu_note", saved.note);
    $("billSaveStatus").textContent = `저장된 오차정산 있음 (${new Date(saved.savedAt).toLocaleString()})`;
  } else {
    setVal("cs_total", ""); setVal("cs_ratio", ratesFor(month).rates.taxableRatio); setVal("tu_note", "");
    ["cs_taxable", "cs_exempt", "pd_taxable", "pd_exempt"].forEach(id => setVal(id, 0));
  }
}

function readProvisional(month, app) {
  const v = id => $(id).value === "" ? NaN : Number($(id).value);
  const p = { supplyTotal: v("pv_supply"), energy: v("pv_energy"), netTotal: v("pv_net"), fee: v("pv_fee") };
  if (Object.values(p).some(isNaN)) return null;
  const bill = Store.get(`bill:${month}:${app}`, null);
  if (bill && bill.netByPlant) p.netByPlant = bill.netByPlant;
  if (bill && bill.expectedSurcharge != null) p.expectedSurcharge = bill.expectedSurcharge;
  return p;
}

function readTrueUpFields() {
  const n = id => Number($(id).value) || 0;
  const t = {
    confirmedTotal: n("cs_total"), taxableRatio: Number($("cs_ratio").value),
    confirmed: { taxable: n("cs_taxable"), exempt: n("cs_exempt") },
    prevDiff: { taxable: n("pd_taxable"), exempt: n("pd_exempt") }, note: $("tu_note").value.trim()
  };
  if (t.confirmed.taxable + t.confirmed.exempt !== t.confirmedTotal)
    throw new Error(`확정 부가정산금 과세+비과세(${(t.confirmed.taxable + t.confirmed.exempt).toLocaleString()})가 총액(${t.confirmedTotal.toLocaleString()})과 다릅니다.`);
  return t;
}

function runTrueUp() {
  const out = $("billResult"); const warn = [], err = [];
  try {
    const P = prepareGroup(err, warn);
    const prov = readProvisional(P.g.month, P.app);
    if (!prov) { out.innerHTML = noticeHtml(["가정산 값(공급량·전력량요금·망이용요금·거래수수료)을 모두 입력하세요."], "bad"); return; }
    const match = matchKpx(P, warn);
    const conf = Engine.invoice(match, { unitPrice: P.customer.unitPrice, priceSplits: safeSplits(Registry.priceSplits(P.app, P.g.month, match.supplyByPlant)), demandRegion: P.customer.demandRegion, plants: P.plants }, P.rates);
    const diff = Engine.trueUpDiff(prov, conf);
    setVal("pd_taxable", diff.taxable); // 비교 결과로 채움 (직접 고친 값은 다시 계산하면 덮어씀)
    billState.result = { mode: "trueup", preview: P.preview, err: err.slice(), app: P.app, month: P.g.month, customer: P.customer, rates: P.rates, match, conf, prov, diff, warn };
    renderTrueUpResult();
  } catch (e) { out.innerHTML = `<div class="notice bad">계산 오류: ${esc(e.message)}</div>`; }
}

function renderTrueUpResult() {
  const R = billState.result;
  try { R.fields = readTrueUpFields(); } catch (e) { $("billResult").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; $("billActions").style.display = "none"; return false; }
  $("billResult").innerHTML = (R.preview ? previewNotice(R.err || []) : "") + noticeHtml(R.warn, "warn") + trueUpHtml(R);
  $("billActions").style.display = "flex";
  $("billSave").disabled = !!R.preview; // 미리보기는 저장 불가
  return true;
}

function trueUpHtml(R) {
  const { customer: c, prov, conf, diff, match, fields: t, rates } = R;
  const m = Number(R.month.slice(4)), nm = nextYm(R.month);
  const vatRate = ratesFor(nm).rates.vatRate, vat = x => Engine.round(x * vatRate);
  const sign = n => (n > 0 ? "+" : "") + Math.round(n).toLocaleString();
  // 비교 행: 항목 | 가정산 | 확정 | 차액 | 비고(2칸)
  const cmp = (l, a, b, d, unit, note) => `<tr><td class="label">${l}</td><td class="num">${a == null ? "-" : Math.round(a).toLocaleString() + unit}</td><td class="num">${Math.round(b).toLocaleString()}${unit}</td><td class="num">${d == null ? "-" : sign(d) + unit}</td><td class="basis" colspan="2">${note || ""}</td></tr>`;
  const row = (l, a, basis, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="label">${l}</td><td class="num">${a}</td><td class="basis" colspan="4">${basis || ""}</td></tr>`;
  const provSum = prov.energy + prov.netTotal + prov.fee, confSum = conf.energy + conf.netTotal + conf.fee;
  const taxableSum = t.confirmed.taxable + t.prevDiff.taxable, exemptSum = t.confirmed.exempt + t.prevDiff.exempt;
  const vatSum = vat(t.confirmed.taxable) + vat(t.prevDiff.taxable);
  const price = conf.energyParts.length > 1 ? conf.energyParts.map(x => `${esc(x.id)} ${x.unitPrice}`).join(" / ") : c.unitPrice;
  const surRows = (prov.expectedSurcharge != null ? [row(`${m}월 예상 부가정산금 (가정산)`, won(prov.expectedSurcharge), "가정산 시 기반기금 산정에만 사용 (청구 미포함)")] : []).concat([
    row(`${m}월 확정 부가정산금`, won(t.confirmedTotal), "KPX 확정 통지"),
    row("과세분", won(t.confirmed.taxable), `과세 비율 ${t.taxableRatio}`),
    row("비과세분", won(t.confirmed.exempt), "총액 − 과세분")]);
  const carryRows = [
    row(`${m}월 확정 부가정산금 (과세)`, won(t.confirmed.taxable), `부가세 ${won(vat(t.confirmed.taxable))} 별도`),
    row("전월 차액 (과세)", won(t.prevDiff.taxable), `부가세 ${won(vat(t.prevDiff.taxable))} 별도` + (t.prevDiff.taxable !== diff.taxable ? ` · ※ 비교 결과(${sign(diff.taxable)})와 다르게 입력` : "")),
    row(`${m}월 확정 부가정산금 (비과세)`, won(t.confirmed.exempt), ""),
    row("전월 차액 (비과세)", won(t.prevDiff.exempt), ""),
    row("반영 합계 (부가세 포함)", won(taxableSum + vatSum + exemptSum), `과세 ${won(taxableSum)} + 부가세 ${won(vatSum)} + 비과세 ${won(exemptSum)}`, "pay")];
  const plantsN = Object.keys(conf.netByPlant);
  const first = rows => rows[0].replace(/^<tr[^>]*>/, "");
  return `<div class="doc">
    <div class="doc-header"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo"></div>
    <h1 class="title">직접PPA 전력거래대금 오차정산서</h1><div class="month">(${monthKo(R.month)} 확정)</div>
    ${customerInfoTable(c, R)}
    ${usageTable(match, "거래<br>내역<br>(확정)")}
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="6">가정산<br>대비<br>차액</th><td class="label">항목</td><td class="label">가정산</td><td class="label">확정</td><td class="label">차액<br>(확정 − 가정산)</td><td class="label" colspan="2">비고</td></tr>
      ${cmp("공급량", prov.supplyTotal, conf.supplyTotal, diff.supply, " kWh")}
      ${cmp("전력량요금", prov.energy, conf.energy, diff.energy, " 원", `${price} 원/kWh`)}
      ${cmp("송배전용 전기설비<br>이용요금", prov.netTotal, conf.netTotal, diff.net, " 원")}
      ${cmp("거래수수료", prov.fee, conf.fee, diff.fee, " 원", `${rates.tradeFee} 원/kWh`)}
      <tr class="total"><td class="label">계 (과세)</td><td class="num">${won(provSum)}</td><td class="num">${won(confSum)}</td><td class="num">${sign(diff.taxable)} 원</td><td colspan="2"></td></tr></table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${surRows.length}">${m}월<br>부가정산금</th>${first(surRows)}
      ${surRows.slice(1).join("")}
      <tr><th class="section" rowspan="${carryRows.length}">${Number(nm.slice(4))}월<br>가정산서<br>반영</th>${first(carryRows)}
      ${carryRows.slice(1).join("")}</table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${plantsN.length + 1}">발전소별<br>망이용요금</th><td class="label" colspan="2">발전소</td><td class="label">확정 공급량</td><td class="label">가정산</td><td class="label">확정</td><td class="label">차액</td></tr>
      ${plantsN.map(p => { const d = diff.netByPlant[p];
        return `<tr><td colspan="2">${esc(p)}</td><td class="num">${conf.netByPlant[p].supplyRounded.toLocaleString()} kWh</td><td class="num">${d.prov == null ? "-" : won(d.prov)}</td><td class="num">${won(d.conf)}</td><td class="num">${d.diff == null ? "-" : sign(d.diff) + " 원"}</td></tr>`; }).join("")}</table>
    ${t.note ? `<p class="hint">메모: ${esc(t.note)}</p>` : ""}
    ${buyerTable(R, `${INVOICE_PREFIX}-${R.month}-T001`)}
    ${docSignature(R, "오차정산", c)}
  </div>`;
}

async function saveTrueUp() {
  const R = billState.result; if (!R || R.mode !== "trueup" || R.preview) return;
  if (!renderTrueUpResult()) return; // 입력값을 다시 읽어 문서를 갱신하고 검증
  const key = `carry:${nextYm(R.month)}:${R.app}`;
  const pick = o => ({ supplyTotal: o.supplyTotal, energy: o.energy, netTotal: o.netTotal, fee: o.fee });
  const rec = Object.assign({
    sourceMonth: R.month, app: R.app, customerName: R.customer.name,
    provisional: pick(R.prov), confirmedCalc: pick(R.conf),
    diff: { supply: R.diff.supply, energy: R.diff.energy, net: R.diff.net, fee: R.diff.fee, taxable: R.diff.taxable },
    expectedSurcharge: R.prov.expectedSurcharge == null ? null : R.prov.expectedSurcharge
  }, R.fields, { savedAt: new Date().toISOString() });
  const where = await Store.set(key, rec);
  $("billSaveStatus").textContent = (where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨") + ` → ${monthLabel(nextYm(R.month))} 가정산서에 자동 반영`;
}

function exportTrueUpExcel() {
  const R = billState.result; if (!R || R.mode !== "trueup" || !renderTrueUpResult()) return;
  const { prov, conf, diff, fields: t } = R;
  const aoa = [["직접PPA 전력거래대금 오차정산서", R.month + " 확정"], ["수요기업", R.customer.name, R.app], [],
    ["항목", "가정산", "확정", "차액"],
    ["공급량(kWh)", prov.supplyTotal, conf.supplyTotal, diff.supply], ["전력량요금", prov.energy, conf.energy, diff.energy],
    ["망이용요금", prov.netTotal, conf.netTotal, diff.net], ["거래수수료", prov.fee, conf.fee, diff.fee],
    ["계(과세)", prov.energy + prov.netTotal + prov.fee, conf.energy + conf.netTotal + conf.fee, diff.taxable], [],
    ["확정 부가정산금", t.confirmedTotal], ["과세 비율", t.taxableRatio], ["과세분", t.confirmed.taxable], ["비과세분", t.confirmed.exempt], [],
    [nextYm(R.month) + " 가정산 반영"], ["전월 확정 부가정산금(과세)", t.confirmed.taxable], ["전월 차액(과세)", t.prevDiff.taxable],
    ["전월 확정 부가정산금(비과세)", t.confirmed.exempt], ["전월 차액(비과세)", t.prevDiff.exempt], ["메모", t.note], [],
    ["발전소", "확정 공급량", "가정산 망이용", "확정 망이용", "차액"],
    ...Object.keys(conf.netByPlant).map(p => [p, conf.netByPlant[p].supplyRounded, diff.netByPlant[p].prov, diff.netByPlant[p].conf, diff.netByPlant[p].diff])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "오차정산서");
  XLSX.writeFile(wb, `오차정산서_${R.customer.name}_${R.month}.xlsx`);
}

/* ---------- 초기화 ---------- */
function renderBillingTabs() {
  $("tab5").innerHTML = `<div id="billBody"></div>`;
}

async function initBilling() {
  renderBillingTabs();
  document.querySelectorAll('input[name="settleMode"]').forEach(r => r.addEventListener("change", onModeChange));
  updateModeHint(); renderBillingBody();
  const ok = await Store.load();
  if (!ok) console.warn("[billing] GAS 앱데이터를 불러오지 못해 이 브라우저의 저장값만 사용합니다.");
  if (typeof renderKpxPage === "function") renderKpxPage(); // KPX 요율 관리 (js/kpxrates.js)
  renderBillingBody();
  if (typeof renderMarketPage === "function") renderMarketPage(); // SMP·REC 가격 (js/market.js)
  if (typeof initTariff === "function") initTariff(); // 시간대별 요금제·공휴일 설정 적용 (js/tariff.js)
}
