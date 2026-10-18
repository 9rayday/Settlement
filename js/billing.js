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
  if (typeof onAmiForGen === "function" && getSettleMode() !== "trueup") onAmiForGen(); // 발전사업자 집계도 사용량 기준으로 다시
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
      ${fieldHtml("청구일 (익월 N영업일 이내)", `<input type="number" id="cfg_send" min="1" max="31" step="1">`)}
      ${fieldHtml("검토일 (수령 후 N영업일 이내)", `<input type="number" id="cfg_review" min="1" max="31" step="1">`)}
      ${fieldHtml("납부기한 (매월 N일)", `<input type="number" id="cfg_pay" min="1" max="31" step="1">`)}
      ${fieldHtml("특이사항", `<input id="bill_note">`)}</div>
    <div class="rec-bill"><label>REC 청구</label><select id="recBillSel"></select><button class="btn secondary" id="recBillAdd">추가</button><div id="recBillList" class="rec-bill-list"></div></div>
    <div class="row" style="margin-top:10px"><button class="btn accent" id="calcBtn">가정산서 계산</button><span id="cfgStatus" class="status warn" style="background:none"></span></div></div>`;
}

/* 청구일·검토일·납부일: 전기사용자(신청번호)별 billcfg:<신청번호> 에 저장 → 바꾸기 전까지 기본값.
 * 저장된 값이 없으면 전기사용자 등록 값(청구서송부기한·납부일), 그것도 없으면 8 / 2 / 27. */
function billCfg(app) {
  const s = Store.get(`billcfg:${app}`, null) || {}, c = Registry.customerByApp(app) || {};
  const pick = (a, b, d) => Number(a) > 0 ? Number(a) : (Number(b) > 0 ? Number(b) : d);
  return { sendDays: pick(s.sendDays, c.sendDays, 8), reviewDays: pick(s.reviewDays, null, 2), payDay: pick(s.payDay, c.payDay, 27) };
}
function dueDateFor(month, payDay) { // 정산월 다음 달 N일 (말일 넘으면 말일)
  const nm = nextYm(month), y = Number(nm.slice(0, 4)), m = Number(nm.slice(4)), last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(payDay, last)).padStart(2, "0")}`;
}
function fillBillCfg(app, month) {
  const cfg = billCfg(app);
  setVal("cfg_send", cfg.sendDays); setVal("cfg_review", cfg.reviewDays); setVal("cfg_pay", cfg.payDay);
  const save = async () => {
    const v = { sendDays: Number($("cfg_send").value) || 8, reviewDays: Number($("cfg_review").value) || 2, payDay: Number($("cfg_pay").value) || 27 };
    const where = await Store.set(`billcfg:${app}`, v);
    if (where !== "denied") $("cfgStatus").textContent = "저장됨";
  };
  ["cfg_send", "cfg_review", "cfg_pay"].forEach(id => { $(id).onchange = save; });
}

function trueUpFormHtml() {
  return `<div class="card"><h2>비교 기준 가정산서</h2><div id="pvSource" class="hint" style="margin:0 0 8px"></div>
      <div class="adj-grid">${numField("공급량 (kWh)", "pv_supply")}${numField("전력량요금 (원)", "pv_energy")}${numField("송배전용 전기설비 이용요금 (원)", "pv_net")}${numField("거래수수료 (원)", "pv_fee")}</div></div>
    <div class="card"><h2>확정 부가정산금 · 전월 차액</h2>
      ${surchargeRowHtml()}
      <div class="adj-grid">
        ${numField("확정 부가정산금 (과세)", "cs_taxable", 0)}${numField("확정 부가정산금 (비과세)", "cs_exempt", 0)}
        ${numField("차액 (과세)", "pd_taxable", 0)}${numField("차액 (비과세)", "pd_exempt", 0)}
        ${fieldHtml("특이사항", `<input id="tu_note">`)}</div>
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
      <span id="billMonthBadge" class="badge"></span></div>
      <div id="billFlow" class="bill-flow"></div></div>
    ${trueUp ? trueUpFormHtml() : provisionalFormHtml()}
    <div id="billResult"></div>
    <div class="row no-print" id="billActions" style="display:none; margin-top:10px"><button class="btn secondary" id="billXlsx">Excel 다운</button><button class="btn secondary" id="billPrint">인쇄 / PDF 저장</button>
      <button class="btn accent" id="billSave">${trueUp ? "오차정산서 발행 (다음 달 가정산서로 이월)" : "가정산서 발행 (저장)"}</button><span id="billSaveStatus" class="status warn" style="background:none"></span></div>`;
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
  renderFlow(app, g.month);
  if (getSettleMode() === "trueup") fillTrueUpForm(app, g.month); else fillProvisionalForm(app, g.month);
}

const setVal = (id, v) => { $(id).value = v == null ? "" : v; };

/* ---------- 정산 진행 단계 ----------
 * 실무 순서: ① 가정산서 발행(bill:) → ② 전력대금 수령(bill.paidAt) → ③ 오차정산서 발행(carry:<다음달>) → ④ 다음 달 가정산서에 차액 반영(bill:<다음달>)
 */
const fmtDate = iso => iso ? String(iso).slice(0, 10) : "";
function flowSteps(app, month) {
  const bill = Store.get(`bill:${month}:${app}`, null), carry = Store.get(`carry:${nextYm(month)}:${app}`, null), next = Store.get(`bill:${nextYm(month)}:${app}`, null);
  return [
    { label: "가정산서 발행", done: !!bill, note: bill ? fmtDate(bill.savedAt) + (bill.grandTotal != null ? " · " + won(bill.grandTotal) : "") : "" },
    { label: "전력대금 수령", done: !!(bill && bill.paidAt), note: bill && bill.paidAt ? bill.paidAt + (bill.paidAmount != null ? " · " + won(bill.paidAmount) : "") : "" },
    { label: "오차정산서 발행", done: !!carry, note: carry ? fmtDate(carry.savedAt) + " · 차액 " + won((carry.prevDiff.taxable || 0) + (carry.prevDiff.exempt || 0)) : "" },
    { label: `${Number(nextYm(month).slice(4))}월 가정산서 반영`, done: !!next, note: next ? fmtDate(next.savedAt) : "" }
  ];
}
function renderFlow(app, month) {
  if (typeof renderDashboard === "function") renderDashboard(); // 정산 대시보드 갱신
  const host = $("billFlow"); if (!host) return;
  const steps = flowSteps(app, month), bill = Store.get(`bill:${month}:${app}`, null);
  host.innerHTML = steps.map((x, i) => `<span class="flow-step${x.done ? " done" : ""}"><b>${i + 1}</b> ${x.label}${x.note ? ` <small>${esc(x.note)}</small>` : ""}</span>`).join('<span class="flow-arrow">›</span>');
}

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
  fillBillCfg(app, month);
  fillRecBill(app, month);
}

/* ---------- REC 청구: 확정한 초과발전량 REC 정산(recset:)을 가정산서에 추가 ----------
 * 기본값 = 발생월(정산 기간 끝)이 정산월 2달 전인 정산. 다른 달 가정산서에 이미 넣은 정산은 목록에서 뺀다. */
const recBillLabel = s => `${s.from === s.to ? monthLabel(s.from) : monthLabel(s.from) + "~" + monthLabel(s.to)} 발생 · ${s.totals.recQty} REC · ${won(s.totals.amount)}`;
function recBillCandidates(app, month) {
  if (typeof recSettlements !== "function") return [];
  return recSettlements(app).filter(s => s.totals && s.totals.amount && (!s.billedIn || s.billedIn === month));
}
function fillRecBill(app, month) {
  const cands = recBillCandidates(app, month), bill = Store.get(`bill:${month}:${app}`, null);
  const twoBefore = prevYm(prevYm(month));
  billState.recPicked = bill && bill.recBilled ? bill.recBilled.filter(k => cands.some(s => s.key === k))
    : cands.filter(s => s.to === twoBefore || s.billedIn === month).map(s => s.key);
  const draw = () => {
    const sel = $("recBillSel"), rest = cands.filter(s => !billState.recPicked.includes(s.key));
    sel.innerHTML = rest.length ? rest.map(s => `<option value="${esc(s.key)}">${esc(recBillLabel(s))}</option>`).join("") : `<option value="">-</option>`;
    $("recBillAdd").disabled = !rest.length;
    $("recBillList").innerHTML = billState.recPicked.map(k => { const s = cands.find(x => x.key === k);
      return s ? `<span class="rec-chip">${esc(recBillLabel(s))}<button data-k="${esc(k)}" title="빼기">×</button></span>` : ""; }).join("");
    $("recBillList").querySelectorAll("button").forEach(b => b.onclick = () => { billState.recPicked = billState.recPicked.filter(k => k !== b.dataset.k); draw(); });
  };
  $("recBillAdd").onclick = () => { const k = $("recBillSel").value; if (k && !billState.recPicked.includes(k)) billState.recPicked.push(k); draw(); };
  draw();
}
function recBillItems(app) {
  return (billState.recPicked || []).map(k => ({ k, s: Store.get(k, null) })).filter(x => x.s && x.s.totals).map(({ k, s }) => ({
    key: k, label: s.from === s.to ? monthLabel(s.from) : `${monthLabel(s.from)}~${monthLabel(s.to)}`, amount: s.totals.amount, qty: s.totals.recQty }));
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
  if (priceSplits && priceSplits.some(x => !(x.unitPrice > 0))) err.push(`계약단가 없음: ${priceSplits.filter(x => !(x.unitPrice > 0)).map(x => x.id).join(", ")}`);
  if (!customer) err.push(`전기사용자 미등록: ${app}`);
  const unreg = Object.keys(g.plants).filter(p => { const i = Registry.plantInfo(p); return !i || !i.region; });
  if (unreg.length) err.push("발전소 미등록·지역 없음: " + unreg.join(", "));
  const { rates, version } = ratesFor(g.month);
  if (!version) warn.push(`KPX 요율 버전 없음 (${g.month}) — 기본값 적용`);
  const plants = {}; Object.keys(g.plants).forEach(p => {
    const i = Registry.plantInfo(p);
    plants[p] = i && i.region ? i : Object.assign({ distConnected: false, distLow: false }, i || {}, { region: "비수도권", tempRegion: true }); // 미리보기용 임시값
  });
  const S = settleGroup(g, billState.ami, rates);
  const days = S.days;
  if (S.usage.source === "ami") {
    if (S.usage.amiMissing.length) warn.push(`사용량 파일 누락 ${S.usage.amiMissing.length}일`);
    billState.ami.warnings.filter(w => /합계 불일치|96칸|미수신/.test(w)).forEach(w => warn.push(w));
  } else if (S.usage.source === "none") {
    warn.push("사용량 없음 — 사용량 = 발전량으로 계산");
  }
  if (S.monthly && !g.hasPpa) warn.push("월간균등 정산 적용");
  if (S.kpxSupply > 0 && Math.abs(S.kpxSupply - S.match.totals.supplyHourly) > 1)
    warn.push(`공급량 차이: KPX ${kwhStr(S.kpxSupply)} / 계산 ${kwhStr(S.match.totals.supplyHourly)}`);
  // 정보가 부족하면 미리보기: 임시값(전기사용자 = 신청번호, 지역 비수도권, 단가 0원)으로 계산하고 저장은 막는다
  const preview = err.length > 0;
  const cust = customer ? Object.assign({}, customer) : { name: `(미등록) ${app}`, bizNo: "", address: "", manager: "", contact: "", demandRegion: "비수도권", unitPrice: 0, appNo: app, contractId: app };
  if (!cust.demandRegion) cust.demandRegion = "비수도권";
  if (!(cust.unitPrice >= 0)) cust.unitPrice = 0;
  return { app, g, customer: cust, rates, plants, days, match: S.match, loss: S.loss, priceSplits, preview };
}
const previewNotice = err => `<div class="notice bad"><b>미리보기 (저장 불가)</b><br>${err.map(esc).join("<br>")}</div>`;
// 단가가 비어 있는 계약은 0원으로 계산 (미리보기)
const safeSplits = sp => sp ? sp.map(x => Object.assign({}, x, { unitPrice: x.unitPrice > 0 ? x.unitPrice : 0 })) : sp;
/* ---------- 시간별 공통 산정 (발전사업자 정산·전기사용자 정산 공통, 가정산·오차정산 공통) ----------
 * K = KPX PPA발전량 (없으면 발전량, 정산 제외 시간은 0, 정산방식이 월간균등이면 월 균등값)
 * U = 고객 사용량 파일 → KPX 전기사용량(확정 파일) → 없으면 U = K (가정산 간주)
 * L = KPX 손실률(%) 컬럼 → 없으면 요율의 송전손실률
 * S = U > K×(1−L) ? K : U/(1−L), E = K − S (Engine.matchHour)
 */
function settleGroup(g, ami, rates, onHour) {
  const cust = Registry.customerByApp(g.app, g.month);
  const days = Parsers.buildDays(g, null);
  const monthly = /월간균등/.test(g.settleMethod || (cust && cust.settleMethod) || ""); // KPX 정산방식 컬럼 → 계약 정산방식
  if (monthly && !g.hasPpa) Engine.equalizeGen(days);
  const usage = Parsers.resolveUsage(days, ami);
  const loss = g.lossRate != null ? g.lossRate : rates.transLossRate;
  const match = Engine.matchMonth(days, Object.assign({}, rates, { transLossRate: loss }), onHour);
  const kpxSupply = days.reduce((t, x) => t + Object.values(x.supply || {}).reduce((a, arr) => a + arr.reduce((p, q) => p + (q || 0), 0), 0), 0);
  return { days, match, usage, loss, monthly, kpxSupply };
}
const noticeHtml = (list, cls) => list.length ? `<div class="notice ${cls}">${list.map(esc).join("<br>")}</div>` : "";

/* ---------- 가정산 계산 ---------- */
function runCalc() {
  const out = $("billResult"); const warn = [], err = [];
  try {
    const P = prepareGroup(err, warn);
    const match = P.match;
    const ctx = {
      unitPrice: P.customer.unitPrice, priceSplits: safeSplits(Registry.priceSplits(P.app, P.g.month, match.supplyByPlant)), demandRegion: P.customer.demandRegion, demandGrid: P.customer.demandGrid, demandNode: P.customer.demandNode, plants: P.plants,
      confirmedSurcharge: { taxable: Number($("cs_taxable").value) || 0, exempt: Number($("cs_exempt").value) || 0 },
      prevDiff: { taxable: Number($("pd_taxable").value) || 0, exempt: Number($("pd_exempt").value) || 0 },
      penalty: typeof penaltyDueGroup === "function" ? penaltyDueGroup(P.app, P.g.month) : null,
      recItems: recBillItems(P.app)
    };
    const carry = Store.get(`carry:${P.g.month}:${P.app}`, null);
    if (carry && (ctx.confirmedSurcharge.taxable !== carry.confirmed.taxable || ctx.confirmedSurcharge.exempt !== carry.confirmed.exempt
      || ctx.prevDiff.taxable !== carry.prevDiff.taxable || ctx.prevDiff.exempt !== carry.prevDiff.exempt))
      warn.push("전월 오차정산 값을 직접 수정함");
    const inv = Engine.invoice(match, ctx, P.rates);
    const days = { sendDays: Number($("cfg_send").value) || 8, reviewDays: Number($("cfg_review").value) || 2, payDay: Number($("cfg_pay").value) || 27 };
    billState.result = { mode: "provisional", preview: P.preview, app: P.app, month: P.g.month, customer: Object.assign({}, P.customer, days), rates: P.rates, match, inv, ctx, loss: P.loss, note: $("bill_note").value.trim(), dueDate: dueDateFor(P.g.month, days.payDay) };
    out.innerHTML = (P.preview ? previewNotice(err) : "") + noticeHtml(warn, "warn") + invoiceHtml(billState.result);
    fitDocs(out);
    $("billActions").style.display = "flex";
    $("billSave").disabled = !!P.preview; // 미리보기는 저장 불가
  } catch (e) { out.innerHTML = `<div class="notice bad">계산 오류: ${esc(e.message)}</div>`; }
}

// 정산서 공통 (실무 엑셀 양식: 한 페이지 A4 — 로고 · 제목 · 고객정보 · 거래내역 · 청구내역 · 청구정보 · 서명)
// A4 한 장 맞춤: 넘치면 글자 크기(--dfs)를 0.25px씩 줄이고(11px → 최소 7.5px), 남으면 행 간격(--dpad)을 늘려 고르게 채운다
function fitDocs(root) {
  (root || document).querySelectorAll(".doc.bill").forEach(doc => {
    if (!doc.offsetWidth) return; // 화면에 안 보이면 건너뜀
    const a4 = doc.offsetWidth * 297 / 210, set = (k, v) => doc.style.setProperty(k, v);
    const natural = () => { doc.style.minHeight = "0"; const h = doc.offsetHeight; doc.style.minHeight = ""; return h; };
    const prev = doc.classList.contains("page2") && doc.previousElementSibling && doc.previousElementSibling.style.getPropertyValue("--dfs");
    let fs = prev ? parseFloat(prev) : 11, pad = 0.26; set("--dfs", fs + "px"); set("--dpad", pad); // 같은 청구서 2쪽은 1쪽 글자 크기로
    while (natural() > a4 + 1 && fs > 7.5) { fs -= 0.25; set("--dfs", fs + "px"); }
    while (pad < 0.55 && natural() < a4 - 40) { pad += 0.03; set("--dpad", pad); }
    if (natural() > a4 + 1) set("--dpad", Math.max(0.26, pad - 0.03));
  });
}
const DOC_COLS = `<colgroup><col style="width:7%"><col style="width:19%"><col><col><col style="width:19%"><col><col></colgroup>`;
const kwh2 = n => (n == null || isNaN(n)) ? "-" : (Math.abs(n) < 0.005 ? 0 : Number(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kWh";
const kwh3 = n => (n == null || isNaN(n)) ? "-" : (Math.abs(n) < 0.0005 ? 0 : Number(n)).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kWh";
const pctStr = x => (x == null || isNaN(x)) ? "-" : +(x * 100).toFixed(4) + "%";
const TYPE_MARK = "①②③④⑤⑥⑦⑧";
const invPrefix = c => (c && c.invoicePrefix) || INVOICE_PREFIX;
const docNo = (R, n) => `${invPrefix(R.customer)}-${R.month}-${n}`;
const ymdKo = ymd => { const d = String(ymd || "").replace(/[^0-9]/g, ""); return d.length >= 8 ? `${d.slice(0, 4)}년 ${d.slice(4, 6)}월 ${d.slice(6, 8)}일` : "-"; };
const lastDay = m => new Date(Number(m.slice(0, 4)), Number(m.slice(4)), 0).getDate();

function docHead(title, R, no) {
  return `<div class="doc-header bill-head"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo">
      <div class="bill-title"><h1 class="title">${title}</h1><div class="month">(${R.month.slice(0, 4)}년 ${R.month.slice(4)}월 거래분)</div></div>
      <div class="bill-no">${no ? `${title.includes("오차") ? "오차 정산서" : "청구서"} 번호<br><b class="nw">${esc(no)}</b>` : ""}</div></div>`;
}
const docField = (label, val, span) => `<td class="label">${label}</td><td colspan="${span || 2}">${val}</td>`;
function customerInfoTable(c) {
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="3">고객<br>정보</th>${docField("사업자명 (대표자명)", esc(c.name) + (c.ceo ? `<br>(${esc(c.ceo)})` : ""))}${docField("사업자등록번호", esc(c.bizNo || "-"))}</tr>
      <tr>${docField("전기사용장소", esc(c.address || "-"), 5)}</tr>
      <tr>${docField("담당자", esc(c.manager || "-"))}${docField("연락처", esc(c.contact || "-") + (c.email ? `<br>${esc(c.email)}` : ""))}</tr></table>`;
}
// 거래내역 요약 (청구서)
function tradeSummaryTable(T, loss, note) {
  const ds = T.deficitSimple, dl = T.deficitLoss;
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="5">거래<br>내역</th>${docField("전기사용량 계", kwh2(T.usage))}${docField("발전량 계", kwh2(T.gen))}</tr>
      <tr>${docField("전력손실률", pctStr(loss))}${docField("공급량 계", kwh2(T.supply))}</tr>
      <tr>${docField("초과발전량 계", kwh2(T.excess))}${docField("부족전력량(단순) 계", kwh2(ds))}</tr>
      <tr>${docField("부족전력량(전력손실률) 계", kwh2(dl))}${docField("부족전력량 계", kwh2(ds + dl))}</tr>
      <tr>${docField("특이사항", esc(note || ""), 5)}</tr></table>`;
}
// 부하구분별 (청구서 2쪽)
function usageTable(match, title) {
  const loads = ["경부하", "중간부하", "최대부하"];
  const cell = b => `<td class="num">${kwh2(b.usage)}</td><td class="num">${kwh2(b.supply)}</td><td class="num">${kwh2(b.deficitSimple)}</td><td class="num">${kwh2(b.deficitLoss)}</td><td class="num">${kwh2(b.deficitSimple + b.deficitLoss)}</td>`;
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="5">${title}</th><td class="label">구분</td><td class="label">전기사용량</td><td class="label">공급량</td><td class="label">부족전력량(단순)</td><td class="label">부족전력량(전력손실률)</td><td class="label">부족전력량 계</td></tr>
      ${loads.map(l => `<tr><td class="label">${l}</td>${cell(match.byLoad[l] || { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 })}</tr>`).join("")}
      <tr class="total"><td class="label">계</td>${cell(match.totals)}</tr></table>`;
}
function buyerTable(R, no) {
  const c = R.customer;
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="4">청구<br>정보</th>${docField("사업자명 (대표자명)", esc(BUYER.bizName).replace(" (", "<br>("))}${docField("사업자등록번호", esc(BUYER.bizRegNo))}</tr>
      <tr>${docField("주소", esc(BUYER.address).replace(/\n/g, "<br>"))}${docField("계좌번호", esc((c && c.payAccount) || BUYER.account || "-"))}</tr>
      <tr>${docField("담당자", esc(BUYER.manager))}${docField("연락처", esc(BUYER.contact).replace(" / ", "<br>"))}</tr>
      <tr>${docField(no.label, esc(no.value))}${docField("납부기한", R.dueDate ? ymdKo(R.dueDate) : "-")}</tr></table>`;
}
function docSignature(R, what, c) {
  return `<div class="doc-date">${ymdKo(todayYmd())}</div>
    <div class="doc-signature">
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthKo(R.month)} 직접PPA 전력거래대금 ${what}을 확인합니다.</div><div class="sign-role">전기사용자</div><div class="sign-name">${esc(c.name)}</div></div>
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthKo(R.month)} 직접PPA 전력거래대금 ${what}을 제출합니다.</div><div class="sign-role">재생에너지전기공급사업자</div><div class="sign-name">${esc(BUYER.bizNameLegal)}</div></div>
    </div>`;
}

/* ---------- 가정산 청구서 ---------- */
const BILL_COLS = `<colgroup><col style="width:3.5%"><col style="width:3.5%"><col style="width:15%"><col style="width:15%"><col style="width:17%"><col></colgroup>`;
function invoiceHtml(R) {
  const { inv, match, customer: c, rates, ctx } = R;
  const prevM = Number(prevYm(R.month).slice(4)), curM = Number(R.month.slice(4));
  const plantsN = Object.keys(inv.netByPlant);
  // 행: 항목(2칸) | 금액 | 산출근거
  const row = (l, a, basis, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="label" colspan="2">${l}</td><td class="num">${a}</td><td class="basis">${basis || ""}</td></tr>`;
  const sub = (l, a, basis, cls) => `<td class="label${cls ? " " + cls : ""}">${l}</td><td class="num">${a}</td><td class="basis">${basis || ""}</td>`;
  const energyBasis = inv.energyParts.length > 1
    ? inv.energyParts.map(x => `${esc(x.id)} ${kwh2(x.kwh)} × ${x.unitPrice} 원/kWh`).join("<br>")
    : `공급량 계 × ${ctx.unitPrice} 원/kWh`;
  const netRows = 2 + plantsN.length;
  const plantRows = plantsN.map(p => { const n = inv.netByPlant[p];
    const temp = ctx.plants[p] && ctx.plants[p].tempRegion ? ' <b class="warn-t">※ 발전소 지역 미등록 → 임시 비수도권</b>' : "";
    return `<tr>${sub(`<span class="plant">${esc(p)}</span>`, won(n.fee), `${n.type ? `유형 ${TYPE_MARK[n.type - 1]} ` : ""}= ${esc(n.basis || "")}${temp}`)}</tr>`; }).join("");
  const taxRows = [
    row("전력량요금", won(inv.energy), energyBasis),
    `<tr><td class="label" rowspan="${netRows}">송배전용<br>전기설비<br>이용요금<br>(망이용요금)</td>${sub("기본요금", "0 원", "0.00 kW (미적용)")}</tr>`,
    `<tr class="total">${sub("사용요금 계", won(inv.netTotal), "발전소별 합계")}</tr>`,
    plantRows,
    row("거래수수료", won(inv.fee), `공급량 계 × ${rates.tradeFee} 원/kWh`),
    ...(inv.recTotal ? [row("REC 대금", won(inv.recTotal), inv.recItems.map(x => `${esc(x.label)} 발생 ${x.qty} REC`).join(", "))] : []),
    row(`${prevM}월 확정 부가정산금 (과세)`, won(inv.confirmedSurcharge.taxable), `${prevM}월 직접PPA 전력거래대금 오차 정산서`),
    row("공급가액 (전월 차액 반영 전)", won(inv.supplyBefore), "전력량요금 + 망이용요금 + 거래수수료" + (inv.recTotal ? " + REC 대금" : "") + " + 확정 부가정산금 (과세)", "total"),
    row("전월 차액 (과세)", won(inv.prevDiff.taxable), `${prevM}월 직접PPA 전력거래대금 오차 정산서`),
    row("공급가액 (전월 차액 반영 후)", won(inv.supplyAfter), "공급가액 (전월 차액 반영 전) + 전월 차액 (과세)", "total"),
    `<tr><td class="label" rowspan="${inv.recTotal ? 6 : 5}">항목별<br>부가세</td>${sub("전력량요금", won(inv.vat.energy), "전력량요금 × 10%")}</tr>`,
    `<tr>${sub("망이용요금", won(inv.vat.network), "망이용요금 × 10%")}</tr>`,
    `<tr>${sub("거래수수료", won(inv.vat.fee), "거래수수료 × 10%")}</tr>`,
    ...(inv.recTotal ? [`<tr>${sub("REC 대금", won(inv.vat.rec), "REC 대금 × 10%")}</tr>`] : []),
    `<tr>${sub("부가정산금", won(inv.vat.surcharge), `${prevM}월 확정 부가정산금 (과세) × 10%`)}</tr>`,
    `<tr>${sub("전월 차액", won(inv.vat.prevDiff), "전월 차액 (과세) × 10%")}</tr>`,
    row("부가가치세 계", won(inv.vatTotal), "항목별 부가가치세 합계"),
    row("세금계산서 계", won(inv.taxInvoice), "공급가액 (전월 차액 반영 후) + 부가가치세 계", "total")
  ];
  const exRows = [
    row(`${prevM}월 확정 부가정산금 (비과세)`, won(inv.confirmedSurcharge.exempt), `${prevM}월 직접PPA 전력거래대금 오차 정산서`),
    row(`${curM}월 예상 부가정산금`, `( ${won(inv.expectedSurcharge)} 예상 )`, `공급량 계 × ${rates.surcharge} 원/kWh, 익월 확정 후 청구`),
    row("전력산업기반기금 (비과세)", won(inv.fund), `( 전력량요금 + 망이용요금 + 거래수수료 + ${curM}월 예상 부가정산금 ) × ${+(rates.fundRate * 100).toFixed(2)}%`),
    row("전월 차액 (비과세)", won(inv.prevDiff.exempt), `${prevM}월 직접PPA 전력거래대금 오차 정산서`)
  ].concat(inv.penalty ? [row("위약금 차감", won(-inv.penalty), `연간보장공급량 ${esc(inv.penaltyLabel)}`)] : [])
   .concat([row("청구서 계", won(inv.exemptSubtotal), `${prevM}월 확정 부가정산금 (비과세) + 전력산업기반기금 + 전월 차액 (비과세)` + (inv.penalty ? " − 위약금" : ""), "total")]);
  const nTax = (taxRows.join("").match(/<tr/g) || []).length, nEx = exRows.length;
  const no = docNo(R, "0001");
  return `<div class="doc bill">
    ${docHead("직접PPA 전력거래대금 청구서", R, "")}
    ${customerInfoTable(c)}
    ${tradeSummaryTable(match.totals, R.loss, R.note)}
    <table class="doc-table bill-table">${BILL_COLS}
      <tr><th class="section" colspan="4">구분</th><th class="section">금액</th><th class="section">산출근거</th></tr>
      <tr><th class="section" rowspan="${nTax + nEx}">청<br>구<br>내<br>역</th><th class="section sub" rowspan="${nTax}">세<br>금<br>계<br>산<br>서</th>${taxRows[0].replace(/^<tr[^>]*>/, "")}
      ${taxRows.slice(1).join("")}
      <tr><th class="section sub" rowspan="${nEx}">청<br>구<br>서</th>${exRows[0].replace(/^<tr[^>]*>/, "")}
      ${exRows.slice(1).join("")}
      <tr class="pay"><th class="section" colspan="4">당월 청구 계</th><td class="num">${won(inv.grandTotal)}</td><td></td></tr></table>
    ${buyerTable(R, { label: "청구서 번호", value: no })}
    ${docSignature(R, "가정산", c)}
  </div>
  ${invoicePage2(R)}`;
}


// 가정산 스냅샷: 오차정산 때 비교 기준이 된다 (bill:YYYYMM:신청번호)
async function saveBill() {
  const R = billState.result; if (!R || R.mode !== "provisional" || R.preview) return; // 미리보기는 저장하지 않음
  const key = `bill:${R.month}:${R.app}`;
  const old = Store.get(key, null);
  if (old && !confirm(`${monthLabel(R.month)} ${R.customer.name} 가정산서가 이미 발행되어 있습니다${old.paidAt ? " (대금 수령 " + old.paidAt + ")" : ""}. 덮어쓸까요?\n(오차정산은 이 가정산서와 비교합니다)`)) return;
  const inv = R.inv, netByPlant = {}, supplyByPlant = {};
  Object.keys(inv.netByPlant).forEach(p => { netByPlant[p] = inv.netByPlant[p].fee; supplyByPlant[p] = inv.netByPlant[p].supplyRounded; });
  const T = R.match.totals;
  const where = await Store.set(key, Object.assign({
    supplyTotal: inv.supplyTotal, supply: inv.supplyTotal, energy: inv.energy, netTotal: inv.netTotal, netByPlant, supplyByPlant, fee: inv.fee,
    usage: T.usage, gen: T.gen, excess: T.excess, deficit: T.deficitSimple + T.deficitLoss,
    confirmedSurcharge: inv.confirmedSurcharge, prevDiff: inv.prevDiff,
    expectedSurcharge: inv.expectedSurcharge, fund: inv.fund, taxInvoice: inv.taxInvoice, grandTotal: inv.grandTotal,
    unitPrice: R.ctx.unitPrice, customerName: R.customer.name, dueDate: R.dueDate || "", note: R.note || "",
    invFull: R.inv, totals: R.match.totals, loss: R.loss, recBilled: (R.inv.recItems || []).map(x => x.key), savedAt: new Date().toISOString()
  }, old && old.paidAt ? { paidAt: old.paidAt, paidAmount: old.paidAmount } : {}));
  // REC 정산에 청구한 달 표시 (빠진 것은 해제)
  const now = (R.inv.recItems || []).map(x => x.key), before = (old && old.recBilled) || [];
  for (const k of before.filter(k => !now.includes(k))) { const s = Store.get(k, null); if (s && s.billedIn === R.month) { delete s.billedIn; await Store.set(k, s); } }
  for (const k of now) { const s = Store.get(k, null); if (s && s.billedIn !== R.month) await Store.set(k, Object.assign(s, { billedIn: R.month })); }
  $("billSaveStatus").textContent = (where === "remote" ? "발행 완료 (구글시트)" : "이 브라우저에만 저장됨") + "";
  renderFlow(R.app, R.month);
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
  $("pvSource").innerHTML = hasBill
    ? `${monthLabel(month)} 발행 가정산서 (${fmtDate(bill.savedAt)}${bill.grandTotal != null ? ", 당월 청구 계 " + won(bill.grandTotal) : ""}${bill.paidAt ? ", 대금 수령 " + esc(bill.paidAt) : ", <b>대금 수령 전</b>"}) 값을 그대로 비교합니다.`
    : `<span style="color:#c0392b">${monthLabel(month)} 발행된 가정산서가 없습니다.</span> 가정산 모드에서 가정산서를 먼저 발행하거나, 시스템 밖에서 만든 가정산서 값을 직접 입력하세요.`;
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
  if (bill && bill.supplyByPlant) p.supplyByPlant = bill.supplyByPlant;
  if (bill) {
    p.fromBill = true; p.savedAt = bill.savedAt; p.paidAt = bill.paidAt || ""; p.paidAmount = bill.paidAmount; p.grandTotal = bill.grandTotal;
    p.inv = bill.invFull || null; p.totals = bill.totals || null;
    ["usage", "gen", "excess", "deficit", "confirmedSurcharge", "prevDiff", "fund", "taxInvoice"].forEach(k => { if (bill[k] != null) p[k] = bill[k]; });
  }
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
    const match = P.match;
    const A = prov.inv;
    const conf = Engine.invoice(match, { unitPrice: P.customer.unitPrice, priceSplits: safeSplits(Registry.priceSplits(P.app, P.g.month, match.supplyByPlant)), demandRegion: P.customer.demandRegion, demandGrid: P.customer.demandGrid, demandNode: P.customer.demandNode, plants: P.plants,
      confirmedSurcharge: (A && A.confirmedSurcharge) || prov.confirmedSurcharge || { taxable: 0, exempt: 0 },
      prevDiff: (A && A.prevDiff) || prov.prevDiff || { taxable: 0, exempt: 0 },
      penalty: A && A.penalty ? { amount: A.penalty, label: A.penaltyLabel } : null, recItems: A && A.recItems ? A.recItems : [] }, P.rates);
    const diff = Engine.trueUpDiff(prov, conf);
    setVal("pd_taxable", diff.taxable); // 비교 결과로 채움 (직접 고친 값은 다시 계산하면 덮어씀)
    const aFund = A ? A.fund : prov.fund;
    if (aFund != null) setVal("pd_exempt", conf.fund - aFund); // 비과세 차액 = 전력산업기반기금 차이
    billState.result = { mode: "trueup", preview: P.preview, err: err.slice(), app: P.app, month: P.g.month, customer: P.customer, rates: P.rates, loss: P.loss, match, conf, prov, diff, warn };
    renderTrueUpResult();
  } catch (e) { out.innerHTML = `<div class="notice bad">계산 오류: ${esc(e.message)}</div>`; }
}

function renderTrueUpResult() {
  const R = billState.result;
  try { R.fields = readTrueUpFields(); } catch (e) { $("billResult").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; $("billActions").style.display = "none"; return false; }
  $("billResult").innerHTML = (R.preview ? previewNotice(R.err || []) : "") + noticeHtml(R.warn, "warn") + trueUpHtml(R);
  fitDocs($("billResult"));
  $("billActions").style.display = "flex";
  $("billSave").disabled = !!R.preview; // 미리보기는 저장 불가
  return true;
}

/* ---------- 청구서 2쪽: 부하별 거래내역 · 시간대별 누계 그래프 · 연간보장공급량 · 계약 안내 ---------- */
// 시간대별(1~24시) 월 누계 누적 영역 그래프 (SVG, 인쇄 가능)
function hourlyChartSvg(byHour) {
  if (!byHour) return "";
  const layers = [["supply", "공급량", "#D5EFCF"], ["deficitSimple", "부족전력량 (단순)", "#BFD7EE"], ["deficitLoss", "부족전력량 (전력손실률)", "#8DB4E2"], ["excess", "초과발전량", "#F8CBAD"]];
  const W = 720, H = 230, L = 64, Rm = 10, Tm = 10, Bm = 26;
  const cum = byHour.map(b => { let acc = 0; return layers.map(([k]) => (acc += Math.max(0, b[k] || 0))); });
  const max = Math.max(1, ...cum.map(c => c[c.length - 1]));
  const step = Math.pow(10, Math.floor(Math.log10(max / 5))), nice = [1, 2, 2.5, 5, 10].map(x => x * step).find(x => max / x <= 6) || step * 10;
  const top = Math.ceil(max / nice) * nice;
  const x = i => L + (W - L - Rm) * i / 23, y = v => Tm + (H - Tm - Bm) * (1 - v / top);
  let svg = "";
  for (let v = 0; v <= top + 1e-9; v += nice) svg += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#E3E6EA"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${Math.round(v).toLocaleString()}</text>`;
  layers.forEach((ly, li) => {
    const upper = cum.map((c, i) => `${x(i)},${y(c[li])}`), lower = cum.map((c, i) => `${x(i)},${y(li ? c[li - 1] : 0)}`).reverse();
    svg += `<polygon points="${upper.concat(lower).join(" ")}" fill="${ly[2]}" stroke="none"/>`;
  });
  for (let i = 0; i < 24; i++) svg += `<text x="${x(i)}" y="${H - Bm + 14}" text-anchor="middle">${i + 1}</text>`;
  const legend = layers.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="hour-chart" xmlns="http://www.w3.org/2000/svg">${svg}</svg><div class="chart-legend">${legend}</div>`;
}

// 연간보장공급량: 계약관리 이행현황과 같은 계산 (시트 월별실적 기준), 정산월까지의 실적만
function guaranteeRows(app, month) {
  if (typeof contractOf !== "function" || typeof yearSchedule !== "function" || typeof perfByPlant !== "function") return [];
  const byPlant = {}; Object.entries(perfByPlant()).forEach(([p, ms]) => { byPlant[p] = {}; Object.entries(ms).forEach(([ym, v]) => { if (ym <= month) byPlant[p][ym] = v; }); });
  const yy = ymd => `'${ymd.slice(2, 4)}.${ymd.slice(5, 7)}.`;
  const out = [];
  Registry.contractsOfApp(app).forEach(raw => {
    const key = Registry.custKey(raw), c = contractOf("cust", key), ys = yearSchedule(c, byPlant);
    if (!ys) return;
    const multi = Registry.contractsOfApp(app).length > 1;
    ys.forEach(y => {
      const started = y.s.slice(0, 7).replace("-", "") <= month;
      const lastYm = started ? (month < y.e.slice(0, 7).replace("-", "") ? month : y.e.slice(0, 7).replace("-", "")) : "";
      out.push({ label: `${multi ? esc(key) + " " : ""}${y.n}회차<br><small>(${yy(y.s)} ~ ${yy(y.e)})</small>`, guar: y.guar,
        actual: started ? y.actual : null, short: y.state === "ended" ? y.short : null,
        note: started ? `${yy(y.s)}~'${lastYm.slice(2, 4)}.${lastYm.slice(4)}. 누계` : "" });
    });
  });
  return out;
}
function guaranteeTable(app, month) {
  const rows = guaranteeRows(app, month);
  const body = rows.length ? rows.map(r => `<tr><td class="label">${r.label}</td><td class="num">${kwh2(r.guar)}</td><td class="num">${r.actual == null ? "-" : kwh2(r.actual)}</td><td class="num">${r.short ? kwh2(r.short) : "-"}</td><td class="num">${r.short ? kwh2(r.short) : "-"}</td><td class="basis">${r.note}</td></tr>`).join("")
    : `<tr><td colspan="6" class="basis">계약 정보(계약일자·계약기간·연간보장공급량)가 없어 표시할 수 없습니다.</td></tr>`;
  return `<table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${Math.max(rows.length, 1) + 1}">연간<br>보장<br>공급량</th><td class="label">구분</td><td class="label">예상 공급량</td><td class="label">실제 공급량 누계</td><td class="label">미달 공급량</td><td class="label">미달 구매량</td><td class="label">비고</td></tr>
      ${body}</table>`;
}
function contractNotes(c) {
  const send = c.sendDays || 8, pay = c.payDay || 27, check = c.checkDays || 5;
  return `<div class="bill-notes">
    <p>. 재생에너지 전기공급사업자는 거래가 종료된 익월 [${esc(send)}]영업일 이내에 전기사용자에게 해당 월 발생한 전력거래 대금 및 전력량을 가정산하여 명시한 청구서를 송부합니다.</p>
    <p>. 전기사용자는 가정산 청구서를 수령한 후 [${esc(c.reviewDays || 2)}]영업일 이내에 검토하여 재생에너지 전기공급사업자에게 세금계산서발행을 요청하고, 요청을 받은 재생에너지 전기공급사업자는 세금계산서를 발행합니다.</p>
    <p>. 전기사용자는 세금계산서를 수령한 후 매월 [${esc(pay)}]일까지 재생에너지 전기공급사업자가 지정한 은행 계좌로 전력거래대금을 지급합니다. 단, 매월 ${esc(pay)}일이 공휴일일 경우 다음 영업일에 지급합니다.</p>
    <p>. 재생에너지 전기공급사업자는 한국전력공사, 한국전력거래소 등 관계 기관의 개별 청구서 수령 후 [${esc(check)}]영업일 이내에 가정산과의 오차를 확인하여 그 내역을 전기사용자에게 송부합니다.</p>
    <p>. 당사자가 본 계약에 따른 전력거래대금 계산상 착오가 있음을 발견하거나 기타 추가 정산할 사항이 있는 경우 추가 정산을 요청하는 당사자는 전력거래대금 지급일이 속한달의 말일까지 상대방 당사자에게 재정산을 요청하여야 하고, 당사자들은 본 항에 따른 다시 정산된 금액을 해당 금액이 발생한 월의 익월에 재정산합니다.</p></div>`;
}
function invoicePage2(R) {
  return `<div class="doc bill page2">
    ${docHead("직접PPA 전력거래대금 청구서", R, "")}
    ${usageTable(R.match, "거래<br>내역")}
    <table class="doc-table">${DOC_COLS}<tr><th class="section">당월<br>시간대별<br>사용량<br>누계</th><td colspan="6" class="chart-cell">${hourlyChartSvg(R.match.byHour)}</td></tr></table>
    ${guaranteeTable(R.app, R.month)}
    ${contractNotes(R.customer)}
  </div>`;
}

/* ---------- 오차 정산서: 당초(가정산서) · 수령(A) · 정정(B, 확정 재계산) · 차이(B−A) ---------- */
function trueUpHtml(R) {
  const { customer: c, prov, conf, match, fields: t, rates } = R;
  const m = Number(R.month.slice(4)), prevM = Number(prevYm(R.month).slice(4)), nm = nextYm(R.month), nmM = Number(nm.slice(4));
  const A = prov.inv || null, PT = prov.totals || null; // 발행한 가정산서 상세 (예전 기록·직접 입력이면 없음)
  const aVal = (k, fb) => A && A[k] != null ? A[k] : (prov[k] != null ? prov[k] : fb);
  const sign = (n, u) => n == null || isNaN(n) ? "-" : (n > 0 ? "+" : n < 0 ? "−" : "") + (u === "kWh" ? Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " kWh" : Math.abs(Math.round(n)).toLocaleString() + " 원");
  const won0 = n => n == null || isNaN(n) ? "-" : won(n);
  // 행: 항목 | 당초 | 수령(A) | 정정(B) | 차이 | 비고  (a: 당초, r: 수령, b: 정정)
  const line = (l, a, b, opt) => { opt = opt || {}; const kwh = opt.kwh, f = kwh ? kwh3 : won0, r = opt.r !== undefined ? opt.r : a;
    const d = (b == null || r == null || isNaN(b) || isNaN(r)) ? null : b - r;
    return `<tr${opt.cls ? ` class="${opt.cls}"` : ""}><td class="label${opt.plant ? " plant-l" : ""}">${l}</td><td class="num">${opt.fa ? opt.fa(a) : f(a)}</td><td class="num">${opt.fa ? opt.fa(r) : f(r)}</td><td class="num">${opt.fa ? opt.fa(b) : f(b)}</td><td class="num">${opt.noDiff ? "-" : sign(d, kwh ? "kWh" : "")}</td><td class="basis">${opt.note || ""}</td></tr>`; };
  const T = match.totals, aDef = PT ? PT.deficitSimple + PT.deficitLoss : prov.deficit;
  const tradeRows = [
    line("전기사용량 계", PT ? PT.usage : prov.usage, T.usage, { kwh: true }),
    line("발전량 계", PT ? PT.gen : prov.gen, T.gen, { kwh: true, note: prov.fromBill ? "" : "가정산 상세 없음" }),
    `<tr><td class="label">전력손실률</td><td class="num">${pctStr(R.loss)}</td><td class="num">${pctStr(R.loss)}</td><td class="num">${pctStr(R.loss)}</td><td class="num">-</td><td></td></tr>`,
    line("공급량 계", aVal("supplyTotal"), conf.supplyTotal, { kwh: true }),
    line("초과발전량 계", PT ? PT.excess : prov.excess, T.excess, { kwh: true }),
    line("부족전력량(단순) 계", PT ? PT.deficitSimple : null, T.deficitSimple, { kwh: true }),
    line("부족전력량(전력손실률) 계", PT ? PT.deficitLoss : null, T.deficitLoss, { kwh: true }),
    line("부족전력량 계", aDef, T.deficitSimple + T.deficitLoss, { kwh: true }),
    `<tr><td class="label">특이사항</td><td colspan="5" class="basis">${esc(t.note || "")}</td></tr>`
  ];
  const plantsN = Object.keys(conf.netByPlant);
  const aNet = p => A && A.netByPlant && A.netByPlant[p] ? A.netByPlant[p].fee : (prov.netByPlant && prov.netByPlant[p] != null ? prov.netByPlant[p] : null);
  const cs = (A && A.confirmedSurcharge) || prov.confirmedSurcharge || { taxable: 0, exempt: 0 };
  const pd = (A && A.prevDiff) || prov.prevDiff || { taxable: 0, exempt: 0 };
  const av = k => A && A.vat ? A.vat[k] : null;
  const paid = prov.paidAmount != null ? prov.paidAmount : aVal("grandTotal");
  const taxRows = [
    line("전력량요금", aVal("energy"), conf.energy, { note: `${conf.energyParts.length > 1 ? conf.energyParts.map(x => `${esc(x.id)} ${x.unitPrice}`).join(" / ") : c.unitPrice} 원/kWh` }),
    line("기본요금", 0, 0, { noDiff: true }),
    line("망이용요금 계", aVal("netTotal"), conf.netTotal, { cls: "total", note: "한전 청구 내역 기준" }),
    ...plantsN.map(p => { const n = conf.netByPlant[p];
      return line(`<span class="plant">${esc(p)}</span>`, aNet(p), n.fee, { plant: true, note: `${n.type ? "유형 " + TYPE_MARK[n.type - 1] + " · " : ""}${n.supplyRounded.toLocaleString()} kWh` }); }),
    line("거래수수료", aVal("fee"), conf.fee),
    ...(conf.recTotal || (A && A.recTotal) ? [line("REC 대금", A ? A.recTotal || 0 : null, conf.recTotal, { note: (conf.recItems || []).map(x => esc(x.label) + " 발생").join(", ") })] : []),
    line(`${prevM}월 확정 부가정산금 (과세)`, cs.taxable, conf.confirmedSurcharge.taxable),
    line("공급가액 (전월 차액 반영 전)", aVal("supplyBefore"), conf.supplyBefore, { cls: "total" }),
    line("전월 차액 (과세)", pd.taxable, conf.prevDiff.taxable),
    line("공급가액 (전월 차액 반영 후)", aVal("supplyAfter"), conf.supplyAfter, { cls: "total" }),
    line("부가세 · 전력량요금", av("energy"), conf.vat.energy),
    line("부가세 · 망이용요금", av("network"), conf.vat.network),
    line("부가세 · 거래수수료", av("fee"), conf.vat.fee),
    ...(conf.recTotal ? [line("부가세 · REC 대금", av("rec"), conf.vat.rec)] : []),
    line("부가세 · 부가정산금", av("surcharge"), conf.vat.surcharge),
    line("부가세 · 전월 차액", av("prevDiff"), conf.vat.prevDiff),
    line("부가가치세 계", aVal("vatTotal"), conf.vatTotal),
    line("세금계산서 계", aVal("taxInvoice"), conf.taxInvoice, { cls: "total" })
  ];
  const exRows = [
    line(`${prevM}월 확정 부가정산금 (비과세)`, cs.exempt, conf.confirmedSurcharge.exempt),
    line(`${m}월 예상 부가정산금`, aVal("expectedSurcharge"), conf.expectedSurcharge, { noDiff: true, fa: x => x == null ? "-" : `( ${won(x)} 예상 )`, note: "기반기금 산정용 (청구 미포함)" }),
    line("전력산업기반기금 (비과세)", aVal("fund"), conf.fund, { note: `${nmM}월 거래분 청구서에 반영` }),
    line("전월 차액 (비과세)", pd.exempt, conf.prevDiff.exempt)
  ].concat(conf.penalty || (A && A.penalty) ? [line("위약금 차감", A ? -A.penalty : null, -conf.penalty)] : [])
   .concat([line("청구서 계", aVal("exemptSubtotal"), conf.exemptSubtotal, { cls: "total" })]);
  const no = docNo(R, "0002");
  const vatRate = rates.vatRate, csVat = Engine.round(t.confirmed.taxable * vatRate);
  const ratio = t.taxableRatio;
  return `<div class="doc bill">
    ${docHead("직접PPA 전력거래대금 오차 정산서", R, no)}
    <table class="doc-table tu-table">${TU_COLS}
      <tr><th class="section" colspan="2">구분</th><th class="section">당초</th><th class="section">수령 (A)</th><th class="section">정정 (B)</th><th class="section">차이 (B−A)</th><th class="section">비고</th></tr>
      <tr><th class="section" rowspan="${tradeRows.length}">거래<br>내역</th>${tradeRows[0].replace(/^<tr[^>]*>/, "")}
      ${tradeRows.slice(1).join("")}
    </table>
    <table class="doc-table tu-table">${TU_COLS}
      <tr><th class="section" rowspan="${taxRows.length}">세<br>금<br>계<br>산<br>서</th>${taxRows[0].replace(/^<tr[^>]*>/, "")}
      ${taxRows.slice(1).join("")}
      <tr><th class="section" rowspan="${exRows.length}">청<br>구<br>서</th>${exRows[0].replace(/^<tr[^>]*>/, "")}
      ${exRows.slice(1).join("")}
      ${line("당월 청구 계", aVal("grandTotal"), conf.grandTotal, { cls: "pay", r: paid, note: prov.paidAt ? `수령 ${esc(prov.paidAt)}` : "" }).replace("<tr class=\"pay\"><td class=\"label\">", "<tr class=\"pay\"><th class=\"section\" colspan=\"2\">").replace("당월 청구 계</td>", "당월 청구 계</th>")}
    </table>
    <table class="doc-table tu-table">${CS_COLS}
      <tr><th class="section" rowspan="4">${m}월<br>확정<br>부가<br>정산금</th><td class="label">구분</td><td class="label">정산기간</td><td class="label">구성비</td><td class="label">공급량</td><td class="label">공급가액</td><td class="label">부가세</td><td class="label">계</td></tr>
      <tr><td class="label">과세</td><td rowspan="3">${R.month.slice(0, 4)}년 ${String(m).padStart(2, "0")}월<br>1~${lastDay(R.month)}일</td><td>${pctStr(ratio)}</td><td rowspan="3">${kwh3(conf.supplyTotal)}</td><td class="num">${won(t.confirmed.taxable)}</td><td class="num">${won(csVat)}</td><td class="num">${won(t.confirmed.taxable + csVat)}</td></tr>
      <tr><td class="label">비과세</td><td>${pctStr(1 - ratio)}</td><td class="num">${won(t.confirmed.exempt)}</td><td class="num">0 원</td><td class="num">${won(t.confirmed.exempt)}</td></tr>
      <tr class="total"><td class="label">계</td><td>100%</td><td class="num">${won(t.confirmedTotal)}</td><td class="num">${won(csVat)}</td><td class="num">${won(t.confirmedTotal + csVat)}</td></tr>
    </table>
    <p class="doc-note">${nmM}월 거래분 청구서 반영 — 전월 차액 (과세) ${sign(t.prevDiff.taxable)} · 전월 차액 (비과세) ${sign(t.prevDiff.exempt)} · ${m}월 확정 부가정산금 과세 ${won(t.confirmed.taxable)} / 비과세 ${won(t.confirmed.exempt)}</p>
    ${docSignature(R, "오차", c)}
  </div>`;
}
const TU_COLS = `<colgroup><col style="width:7%"><col style="width:19%"><col><col><col><col><col style="width:15%"></colgroup>`;
const CS_COLS = `<colgroup><col style="width:7%"><col style="width:8%"><col style="width:15%"><col style="width:9%"><col style="width:15%"><col><col><col></colgroup>`;

async function saveTrueUp() {
  const R = billState.result; if (!R || R.mode !== "trueup" || R.preview) return;
  if (!renderTrueUpResult()) return; // 입력값을 다시 읽어 문서를 갱신하고 검증
  if (R.prov.fromBill && !R.prov.paidAt && !confirm(`${monthLabel(R.month)} 가정산서의 전력대금 수령이 확인되지 않았습니다. 그래도 오차정산서를 발행할까요?`)) return;
  const key = `carry:${nextYm(R.month)}:${R.app}`;
  const pick = o => ({ supplyTotal: o.supplyTotal, energy: o.energy, netTotal: o.netTotal, fee: o.fee });
  const rec = Object.assign({
    sourceMonth: R.month, app: R.app, customerName: R.customer.name,
    provisional: pick(R.prov), confirmedCalc: pick(R.conf),
    diff: { supply: R.diff.supply, energy: R.diff.energy, net: R.diff.net, fee: R.diff.fee, taxable: R.diff.taxable },
    expectedSurcharge: R.prov.expectedSurcharge == null ? null : R.prov.expectedSurcharge
  }, R.fields, { savedAt: new Date().toISOString() });
  const where = await Store.set(key, rec);
  $("billSaveStatus").textContent = (where === "remote" ? "발행 완료 (구글시트)" : "이 브라우저에만 저장됨") + ` → ${monthLabel(nextYm(R.month))} 가정산서에 자동 반영`;
  // 초과발전량 REC: 확정 데이터로 계산한 발전소별 시간별 초과발전량 저장 (js/rec.js)
  if (where !== "denied" && typeof recSaveTrueUpExcess === "function" && billState.kpx && billState.kpx.groups[R.app]) {
    const byPlant = {};
    settleGroup(billState.kpx.groups[R.app], billState.ami, R.rates, (d, h, m) => {
      Object.keys(m.excess).forEach(p => { if (m.excess[p] > 0) (byPlant[p] || (byPlant[p] = [])).push([Number(d.date.slice(8)), h, m.excess[p]]); });
    });
    await recSaveTrueUpExcess(R.app, R.month, byPlant);
  }
  renderFlow(R.app, R.month);
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
  if (typeof renderDashboard === "function") renderDashboard(); // 정산 대시보드 (js/dashboard.js)
  if (typeof renderMarketPage === "function") renderMarketPage(); // SMP·REC 가격 (js/market.js)
  if (typeof initTariff === "function") initTariff(); // 시간대별 요금제·공휴일 설정 적용 (js/tariff.js)
}
