/* ============ 수요기업 청구(가정산) 모듈 UI ============
 * 탭4: 월별 요율 / 발전소 / 수요기업 계약 등록   탭5: 업로드 → 계산 → 청구서
 * 계산은 js/engine.js, 파일 해석은 js/parsers.js. 여기서는 화면과 저장만 다룬다.
 */
const INVOICE_PREFIX = "200005"; // 수요기업 청구서 번호 접두 (발전사업자 정산서는 BUYER.invoicePrefix)
const GEN_REGIONS = ["비수도권", "수도권북", "수도권남", "제주"];
const DEMAND_REGIONS = ["수도권", "비수도권", "제주"];

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const won = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString() + " 원";
const kwhStr = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString() + " kWh";
const $ = id => document.getElementById(id);

const billState = { kpx: null, ami: null, amiName: "", result: null };

/* ---------- 요율 ---------- */
function ratesFor(month) {
  const exact = Store.get("rates:" + month, null);
  if (exact) return { rates: exact, source: "저장된 값" };
  const earlier = Store.keys("rates:").filter(k => k.slice(6) < month).pop();
  if (earlier) return { rates: Object.assign({}, Store.get(earlier), { month }), source: `${earlier.slice(6)} 값을 복사 (이번 달 KPX 통지값으로 수정 후 저장하세요)` };
  return { rates: Object.assign({}, Engine.DEFAULT_RATES, { month }), source: "기본값 (KPX 통지값으로 수정 후 저장하세요)" };
}

function numInput(id, val, step) { return `<input type="number" id="${id}" value="${val}" step="${step || "any"}" style="width:110px">`; }

function renderRatesCard(month) {
  const { rates: r, source } = ratesFor(month);
  $("ratesBody").innerHTML = `
    <div class="row"><label>정산월(YYYYMM)</label><input id="rt_month" value="${esc(month)}" maxlength="6" style="width:90px">
      <button class="btn secondary" id="rt_load">불러오기</button><span class="status warn" style="background:none">${esc(source)}</span></div>
    <div class="adj-grid">
      <div class="adj-item"><label class="adj-label">예상 부가정산금 단가 (원/kWh)</label>${numInput("rt_surcharge", r.surcharge)}</div>
      <div class="adj-item"><label class="adj-label">확정 부가정산금 과세 비율</label>${numInput("rt_taxable", r.taxableRatio)}</div>
      <div class="adj-item"><label class="adj-label">거래수수료 (원/kWh)</label>${numInput("rt_tradeFee", r.tradeFee)}</div>
      <div class="adj-item"><label class="adj-label">송전손실률</label>${numInput("rt_transLoss", r.transLossRate)}</div>
      <div class="adj-item"><label class="adj-label">종합손실률 (배전연결)</label>${numInput("rt_totalLoss", r.totalLossRate)}</div>
      <div class="adj-item"><label class="adj-label">배전 이용요금 (원/kWh)</label>${numInput("rt_dist", r.distribution)}</div>
      <div class="adj-item"><label class="adj-label">전력산업기반기금율</label>${numInput("rt_fund", r.fundRate)}</div>
      <div class="adj-item"><label class="adj-label">부가세율</label>${numInput("rt_vat", r.vatRate)}</div>
    </div>
    <h3 class="sub">발전측 송전요금 (원/kWh, 발전소 지역별)</h3>
    <div class="adj-grid">${GEN_REGIONS.map(k => `<div class="adj-item"><label class="adj-label">${k}</label>${numInput("rt_g_" + k, r.genSide[k])}</div>`).join("")}</div>
    <h3 class="sub">수요측 송전요금 (원/kWh, 수요지 지역별)</h3>
    <div class="adj-grid">${DEMAND_REGIONS.map(k => `<div class="adj-item"><label class="adj-label">${k}</label>${numInput("rt_d_" + k, r.demandSide[k])}</div>`).join("")}</div>
    <div class="row" style="margin-top:10px"><button class="btn accent" id="rt_save">이 월 요율 저장</button><span id="rt_status" class="status warn" style="background:none"></span></div>`;
  $("rt_load").onclick = () => renderRatesCard($("rt_month").value.trim());
  $("rt_save").onclick = saveRates;
}

async function saveRates() {
  const month = $("rt_month").value.trim();
  if (!/^\d{6}$/.test(month)) { $("rt_status").textContent = "정산월은 YYYYMM 6자리입니다."; return; }
  const v = id => Number($(id).value);
  const rates = {
    month, tradeFee: v("rt_tradeFee"), surcharge: v("rt_surcharge"), taxableRatio: v("rt_taxable"), fundRate: v("rt_fund"),
    vatRate: v("rt_vat"), transLossRate: v("rt_transLoss"), totalLossRate: v("rt_totalLoss"), distribution: v("rt_dist"),
    genSide: {}, demandSide: {}
  };
  GEN_REGIONS.forEach(k => rates.genSide[k] = v("rt_g_" + k));
  DEMAND_REGIONS.forEach(k => rates.demandSide[k] = v("rt_d_" + k));
  const where = await Store.set("rates:" + month, rates);
  $("rt_status").textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨 (GAS 연결 확인 필요)";
}

/* ---------- 발전소 / 계약 등록 ---------- */
function plantRow(name, p) {
  return `<tr><td><input class="pl_name" value="${esc(name)}"></td>
    <td><select class="pl_region">${GEN_REGIONS.map(g => `<option${g === p.region ? " selected" : ""}>${g}</option>`).join("")}</select></td>
    <td style="text-align:center"><input type="checkbox" class="pl_dist"${p.distConnected ? " checked" : ""}></td>
    <td><input type="number" class="pl_price" value="${p.buyPrice == null ? "" : p.buyPrice}" style="width:90px"></td>
    <td><input class="pl_app" value="${esc(p.appNo || "")}" placeholder="26-PR00000"></td>
    <td><button class="btn secondary pl_del">삭제</button></td></tr>`;
}
function renderPlantsCard() {
  const plants = Store.get("plants", {});
  $("plantsBody").innerHTML = `<table class="grid"><tr><th>발전기명 (KPX 파일과 동일)</th><th>지역(요금구분)</th><th>배전연결</th><th>발전사업자 매입단가(원/kWh)</th><th>KPX 신청번호(그룹)</th><th></th></tr>
    ${Object.keys(plants).map(n => plantRow(n, plants[n])).join("")}</table>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="pl_add">+ 발전소 추가</button><button class="btn accent" id="pl_save">발전소 저장</button><span id="pl_status" class="status warn" style="background:none"></span></div>`;
  const tbl = $("plantsBody").querySelector("table");
  $("pl_add").onclick = () => { tbl.insertAdjacentHTML("beforeend", plantRow("", { region: "비수도권" })); bindPlantDel(); };
  $("pl_save").onclick = savePlants;
  bindPlantDel();
}
function bindPlantDel() { $("plantsBody").querySelectorAll(".pl_del").forEach(b => b.onclick = () => b.closest("tr").remove()); }
async function savePlants() {
  const out = {};
  $("plantsBody").querySelectorAll("tr").forEach(tr => {
    const n = tr.querySelector(".pl_name"); if (!n || !n.value.trim()) return;
    const pr = tr.querySelector(".pl_price").value;
    out[n.value.trim()] = { region: tr.querySelector(".pl_region").value, distConnected: tr.querySelector(".pl_dist").checked,
      buyPrice: pr === "" ? null : Number(pr), appNo: tr.querySelector(".pl_app").value.trim() };
  });
  const where = await Store.set("plants", out);
  $("pl_status").textContent = (where === "remote" ? "저장 완료 (구글시트) " : "이 브라우저에만 저장됨 ") + Object.keys(out).length + "개";
}

const CUST_FIELDS = [["name", "수요기업명"], ["bizNo", "사업자등록번호"], ["address", "전기사용장소"], ["manager", "담당자"], ["contact", "연락처"],
  ["demandRegion", "수요지 지역"], ["unitPrice", "계약 단가(원/kWh)"], ["appNo", "KPX 신청번호(그룹키)"], ["consumeAppNo", "소비계약 신청번호"]];
function custRow(c) {
  return `<tr>${CUST_FIELDS.map(([k]) => k === "demandRegion"
    ? `<td><select data-k="${k}">${DEMAND_REGIONS.map(g => `<option${g === c[k] ? " selected" : ""}>${g}</option>`).join("")}</select></td>`
    : `<td><input data-k="${k}" value="${esc(c[k])}"${k === "unitPrice" ? ' type="number" style="width:80px"' : ""}></td>`).join("")}
    <td><button class="btn secondary c_del">삭제</button></td></tr>`;
}
function renderCustomersCard() {
  const list = Store.get("customers", []);
  $("custBody").innerHTML = `<div class="grid-wrap"><table class="grid"><tr>${CUST_FIELDS.map(([, l]) => `<th>${l}</th>`).join("")}<th></th></tr>${list.map(custRow).join("")}</table></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="c_add">+ 수요기업 추가</button><button class="btn accent" id="c_save">수요기업 저장</button><span id="c_status" class="status warn" style="background:none"></span></div>`;
  const tbl = $("custBody").querySelector("table");
  $("c_add").onclick = () => { tbl.insertAdjacentHTML("beforeend", custRow({ demandRegion: "비수도권" })); bindCustDel(); };
  $("c_save").onclick = saveCustomers;
  bindCustDel();
}
function bindCustDel() { $("custBody").querySelectorAll(".c_del").forEach(b => b.onclick = () => b.closest("tr").remove()); }
async function saveCustomers() {
  const list = [];
  $("custBody").querySelectorAll("tr").forEach(tr => {
    const c = {}; tr.querySelectorAll("[data-k]").forEach(el => { c[el.dataset.k] = el.value.trim(); });
    if (!c.name) return;
    c.unitPrice = Number(c.unitPrice); list.push(c);
  });
  const dup = list.map(c => c.appNo).filter((a, i, arr) => a && arr.indexOf(a) !== i);
  if (dup.length) { $("c_status").textContent = "신청번호가 중복됩니다: " + dup.join(", "); return; }
  const where = await Store.set("customers", list);
  $("c_status").textContent = (where === "remote" ? "저장 완료 (구글시트) " : "이 브라우저에만 저장됨 ") + list.length + "건";
}

/* ---------- 업로드 ---------- */
function readFileAsText(file) {
  return file.arrayBuffer().then(buf => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch (e) { return new TextDecoder("euc-kr").decode(buf); }
  });
}

async function onKpxFile(file) {
  const st = $("kpxStatus"); st.textContent = "읽는 중..."; st.className = "status warn";
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
    const parsed = Parsers.parseKpxRows(rows);
    const apps = Object.keys(parsed.groups);
    if (!apps.length) throw new Error("신청번호/발전기명이 있는 행을 찾지 못했습니다. KPX 직접전력거래량 파일이 맞는지 확인하세요.");
    billState.kpx = parsed;
    st.textContent = `${file.name} — 그룹(신청번호) ${apps.length}개`; st.className = "status ok";
    $("groupSel").innerHTML = apps.map(a => {
      const g = parsed.groups[a]; const c = (Store.get("customers", [])).find(x => x.appNo === a);
      return `<option value="${esc(a)}">${esc(a)} — ${esc(c ? c.name : "미등록")} (${Object.keys(g.plants).length}개 발전소, ${g.month})</option>`;
    }).join("");
    onGroupChange();
  } catch (e) { st.textContent = "오류: " + e.message; st.className = "status bad"; }
}

async function onAmiFile(file) {
  const st = $("amiStatus");
  try {
    const ami = Parsers.parseAmiHtml(await readFileAsText(file));
    if (!ami.dates.length) throw new Error(ami.warnings[0] || "읽을 수 있는 데이터가 없습니다.");
    billState.ami = ami; billState.amiName = file.name;
    st.textContent = `${file.name} — ${ami.dates.length}일 (${ami.dates[0]} ~ ${ami.dates[ami.dates.length - 1]})`; st.className = "status ok";
  } catch (e) { billState.ami = null; st.textContent = "오류: " + e.message; st.className = "status bad"; }
}

function onGroupChange() {
  const app = $("groupSel").value; if (!app || !billState.kpx) return;
  const g = billState.kpx.groups[app];
  $("billMonthBadge").textContent = `정산월 ${monthLabel(g.month)}`;
  const prevMonth = prevYm(g.month);
  const set = (id, v) => { $(id).value = v; };
  // 탭6에서 저장한 전월 오차정산 값이 있으면 그대로 채운다. 없으면 비우고 전월 청구 기록을 참고로 보여준다.
  const carry = Store.get(`carry:${g.month}:${app}`, null);
  if (carry) {
    set("cs_total", carry.confirmedTotal); set("cs_ratio", carry.taxableRatio);
    set("cs_taxable", carry.confirmed.taxable); set("cs_exempt", carry.confirmed.exempt);
    set("pd_taxable", carry.prevDiff.taxable); set("pd_exempt", carry.prevDiff.exempt);
    $("prevHint").textContent = `${monthLabel(prevMonth)} 오차정산서 값을 자동으로 채웠습니다. 고치려면 [6. 오차정산]에서 수정 후 저장하세요.`;
  } else {
    set("cs_total", ""); ["cs_taxable", "cs_exempt", "pd_taxable", "pd_exempt"].forEach(id => set(id, 0));
    set("cs_ratio", ratesFor(prevMonth).rates.taxableRatio); // 과세 비율은 부가정산금이 발생한 달(전월)의 통지값
    const prev = Store.get(`bill:${prevMonth}:${app}`, null);
    $("prevHint").textContent = (prev ? `${monthLabel(prevMonth)} 청구 기록: 예상 부가정산금 ${won(prev.expectedSurcharge)}. ` : "전월 청구 기록 없음. ")
      + "[6. 오차정산]에서 확정값을 저장하면 이 칸이 자동으로 채워집니다. (직접 입력해도 됩니다)";
  }
}
function prevYm(m) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(4)) - 1; if (!mo) { y--; mo = 12; } return `${y}${String(mo).padStart(2, "0")}`; }
function nextYm(m) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(4)) + 1; if (mo > 12) { y++; mo = 1; } return `${y}${String(mo).padStart(2, "0")}`; }
const monthLabel = m => `${m.slice(0, 4)}.${m.slice(4)}`;

function splitConfirmed() {
  const total = Number($("cs_total").value) || 0, ratio = Number($("cs_ratio").value);
  const taxable = Engine.round(total * ratio);
  $("cs_taxable").value = taxable; $("cs_exempt").value = total - taxable;
}

/* ---------- 계산 ---------- */
function runCalc() {
  const out = $("billResult"); const warn = [], err = [];
  try {
    if (!billState.kpx) throw new Error("KPX 직접전력거래량 파일을 먼저 업로드하세요.");
    const app = $("groupSel").value, g = billState.kpx.groups[app];
    const customer = Store.get("customers", []).find(c => c.appNo === app);
    if (!customer) err.push(`신청번호 ${app} 에 해당하는 수요기업 계약이 없습니다. [4. 등록·요율]에서 수요기업을 등록하세요.`);
    const plantReg = Store.get("plants", {});
    const unreg = Object.keys(g.plants).filter(p => !plantReg[p]);
    if (unreg.length) err.push("등록되지 않은 발전소: " + unreg.join(", ") + " → [4. 등록·요율]에서 지역(요금구분)을 지정하세요.");
    const { rates, source } = ratesFor(g.month);
    if (!Store.get("rates:" + g.month, null)) warn.push(`${g.month} 요율이 저장되어 있지 않아 ${source}을 사용했습니다.`);
    if (err.length) { out.innerHTML = `<div class="notice bad">${err.map(esc).join("<br>")}</div>`; return; }

    const days = Parsers.buildDays(g, billState.ami);
    if (billState.ami) {
      const miss = Parsers.missingDates(g.month, billState.ami.dates);
      if (miss.length) warn.push(`사용량 파일에 없는 날짜 ${miss.length}일 (${miss.join(", ")}) — 해당일은 발전량 전량 공급으로 간주되어 공급량이 과대할 수 있습니다.`);
      days.filter(d => d.usage && d.gaps.length).forEach(d => warn.push(`${d.date}: 사용량 미수신 ${d.gaps.length}시간 (${d.gaps.map(h => h + "시").join(", ")}) — 해당 시간은 발전량 전량 공급으로 간주됩니다.`));
      billState.ami.warnings.filter(w => /합계 불일치|96칸/.test(w)).forEach(w => warn.push(w));
    } else {
      warn.push("고객 사용량 파일이 없어 전기사용량 = 발전량(전량 공급)으로 계산했습니다 (엑셀 가정산 방식).");
    }
    const match = Engine.matchMonth(days, rates);
    const plants = {}; Object.keys(g.plants).forEach(p => plants[p] = plantReg[p]);
    const ctx = {
      unitPrice: customer.unitPrice, demandRegion: customer.demandRegion, plants,
      confirmedSurcharge: { taxable: Number($("cs_taxable").value) || 0, exempt: Number($("cs_exempt").value) || 0 },
      prevDiff: { taxable: Number($("pd_taxable").value) || 0, exempt: Number($("pd_exempt").value) || 0 }
    };
    const carry = Store.get(`carry:${g.month}:${app}`, null);
    if (carry && (ctx.confirmedSurcharge.taxable !== carry.confirmed.taxable || ctx.confirmedSurcharge.exempt !== carry.confirmed.exempt
      || ctx.prevDiff.taxable !== carry.prevDiff.taxable || ctx.prevDiff.exempt !== carry.prevDiff.exempt))
      warn.push("전월 오차정산 칸이 [6. 오차정산]에 저장된 값과 다릅니다. 직접 고친 값으로 계산했습니다.");
    const inv = Engine.invoice(match, ctx, rates);
    billState.result = { app, month: g.month, customer, rates, match, inv, ctx, dueDate: $("dueDate").value };
    out.innerHTML = (warn.length ? `<div class="notice warn">${warn.map(esc).join("<br>")}</div>` : "") + invoiceHtml(billState.result);
    $("billActions").style.display = "flex";
  } catch (e) { out.innerHTML = `<div class="notice bad">계산 오류: ${esc(e.message)}</div>`; }
}

function invoiceHtml(R) {
  const { inv, match, customer: c, rates, ctx } = R;
  const ml = `${R.month.slice(0, 4)}년 ${R.month.slice(4)}월`;
  const loads = ["경부하", "중간부하", "최대부하"];
  const prevM = prevYm(R.month).slice(4).replace(/^0/, "");
  const row = (l, a, basis, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="label">${l}</td><td class="num">${a}</td><td class="basis">${basis || ""}</td></tr>`;
  return `<div class="doc">
    <h1 class="title">직접PPA 전력거래대금 청구서</h1><div class="month">(${ml} 가정산)</div>
    <table class="doc-table"><tr><td class="label">수요기업</td><td>${esc(c.name)}</td><td class="label">사업자등록번호</td><td>${esc(c.bizNo)}</td></tr>
      <tr><td class="label">전기사용장소</td><td>${esc(c.address)}</td><td class="label">담당자/연락처</td><td>${esc(c.manager)} ${esc(c.contact)}</td></tr></table>
    <table class="doc-table"><tr><th>구분</th><th>전기사용량</th><th>공급량</th><th>부족전력량(단순)</th><th>부족전력량(손실률)</th></tr>
      ${loads.map(l => { const b = match.byLoad[l] || { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 };
        return `<tr><td>${l}</td><td class="num">${kwhStr(b.usage)}</td><td class="num">${kwhStr(b.supply)}</td><td class="num">${kwhStr(b.deficitSimple)}</td><td class="num">${kwhStr(b.deficitLoss)}</td></tr>`; }).join("")}
      <tr class="total"><td>계</td><td class="num">${kwhStr(match.totals.usage)}</td><td class="num">${kwhStr(match.totals.supply)}</td><td class="num">${kwhStr(match.totals.deficitSimple)}</td><td class="num">${kwhStr(match.totals.deficitLoss)}</td></tr></table>
    <table class="doc-table"><tr><th>항목</th><th>금액</th><th>산출근거</th></tr>
      ${row("전력량요금", won(inv.energy), `${kwhStr(inv.supplyTotal)} × ${ctx.unitPrice} 원/kWh`)}
      ${row("송배전용 전기설비 이용요금(망이용요금)", won(inv.netTotal), "발전소별 합계 (아래 상세)")}
      ${row("거래수수료", won(inv.fee), `${kwhStr(inv.supplyTotal)} × ${rates.tradeFee} 원/kWh`)}
      ${row(prevM + "월 확정 부가정산금 (과세)", won(inv.confirmedSurcharge.taxable), "전월 오차 정산서")}
      ${row("공급가액 (전월 차액 반영 전)", won(inv.supplyBefore), "", "total")}
      ${row("전월 차액 (과세)", won(inv.prevDiff.taxable), "전월 오차 정산서")}
      ${row("공급가액 (전월 차액 반영 후)", won(inv.supplyAfter), "", "total")}
      ${row("부가가치세 계", won(inv.vatTotal), `전력량 ${inv.vat.energy.toLocaleString()} + 망이용 ${inv.vat.network.toLocaleString()} + 수수료 ${inv.vat.fee.toLocaleString()} + 부가정산금 ${inv.vat.surcharge.toLocaleString()} + 전월차액 ${inv.vat.prevDiff.toLocaleString()}`)}
      ${row("세금계산서 계", won(inv.taxInvoice), "", "total")}
      ${row(prevM + "월 확정 부가정산금 (비과세)", won(inv.confirmedSurcharge.exempt), "전월 오차 정산서")}
      ${row(R.month.slice(4).replace(/^0/, "") + "월 예상 부가정산금", won(inv.expectedSurcharge), `${kwhStr(inv.supplyTotal)} × ${rates.surcharge} 원/kWh, 익월 확정 후 청구 (※ 청구서 계에는 미포함, 기금 산정에만 사용)`)}
      ${row("전력산업기반기금 (비과세)", won(inv.fund), `(전력량요금+망이용요금+거래수수료+예상부가정산금) × ${(rates.fundRate * 100).toFixed(1)}%, 10원 미만 절사`)}
      ${row("전월 차액 (비과세)", won(inv.prevDiff.exempt), "전월 오차 정산서")}
      ${row("청구서 계", won(inv.exemptSubtotal), "", "total")}
      ${row("당월 청구 계", won(inv.grandTotal), "", "pay")}</table>
    <h3 class="sub">발전소별 망이용요금</h3>
    <table class="doc-table"><tr><th>발전소</th><th>공급량(반올림)</th><th>망이용요금</th></tr>
      ${Object.keys(inv.netByPlant).map(p => `<tr><td>${esc(p)}</td><td class="num">${inv.netByPlant[p].supplyRounded.toLocaleString()} kWh</td><td class="num">${won(inv.netByPlant[p].fee)}</td></tr>`).join("")}</table>
    <table class="doc-table"><tr><td class="label">청구서 번호</td><td>${INVOICE_PREFIX}-${R.month}-0001</td><td class="label">납부기한</td><td>${esc(R.dueDate || "-")}</td></tr>
      <tr><td class="label">청구처</td><td>${esc(BUYER.bizName)}</td><td class="label">사업자등록번호</td><td>${esc(BUYER.bizRegNo)}</td></tr></table>
  </div>`;
}

async function saveBill() {
  const R = billState.result; if (!R) return;
  const where = await Store.set(`bill:${R.month}:${R.app}`, { expectedSurcharge: R.inv.expectedSurcharge, supply: R.inv.supplyTotal, fund: R.inv.fund,
    grandTotal: R.inv.grandTotal, customerName: R.customer.name, savedAt: new Date().toISOString() });
  $("billSaveStatus").textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨";
  renderTrueUpTab(); // 탭6 목록에 이번 청구를 추가
}

function exportBillExcel() {
  const R = billState.result; if (!R) return;
  const { inv, match } = R; const aoa = [
    ["직접PPA 전력거래대금 청구서", R.month], ["수요기업", R.customer.name], [],
    ["구분", "전기사용량", "공급량", "부족(단순)", "부족(손실률)"],
    ...["경부하", "중간부하", "최대부하"].map(l => { const b = match.byLoad[l] || {}; return [l, b.usage || 0, b.supply || 0, b.deficitSimple || 0, b.deficitLoss || 0]; }), [],
    ["항목", "금액"], ["전력량요금", inv.energy], ["망이용요금", inv.netTotal], ["거래수수료", inv.fee],
    ["전월 확정 부가정산금(과세)", inv.confirmedSurcharge.taxable], ["전월 차액(과세)", inv.prevDiff.taxable],
    ["공급가액", inv.supplyAfter], ["부가가치세", inv.vatTotal], ["세금계산서 계", inv.taxInvoice],
    ["전월 확정 부가정산금(비과세)", inv.confirmedSurcharge.exempt], ["예상 부가정산금(참고)", inv.expectedSurcharge],
    ["전력산업기반기금", inv.fund], ["전월 차액(비과세)", inv.prevDiff.exempt], ["청구서 계", inv.exemptSubtotal], ["당월 청구 계", inv.grandTotal], [],
    ["발전소", "공급량", "망이용요금"], ...Object.keys(inv.netByPlant).map(p => [p, inv.netByPlant[p].supplyRounded, inv.netByPlant[p].fee])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "청구서");
  XLSX.writeFile(wb, `청구서_${R.customer.name}_${R.month}.xlsx`);
}

/* ---------- 오차정산 (탭6): 확정 부가정산금 → 익월 청구 이월 ----------
 * 가정산 청구(bill:YYYYMM:신청번호)에 KPX 확정 부가정산금을 입력하면 과세/비과세로 나눠
 * carry:<익월>:<신청번호> 로 저장한다. 탭5에서 익월 그룹을 고르면 전월 오차정산 칸이 자동으로 채워진다.
 * 시스템 밖(엑셀)에서 만든 청구도 "직접 입력"으로 이월할 수 있다.
 */
const TU_MANUAL = "__manual";
const custByApp = app => Store.get("customers", []).find(c => c.appNo === app);
const monthKo = m => `${m.slice(0, 4)}년 ${Number(m.slice(4))}월`;
const tuState = { last: null };

function trueUpItems() { // 청구 기록 + 이월 기록의 (대상월, 신청번호) 목록, 최신순
  const items = {};
  Store.keys("bill:").forEach(k => { const [, month, app] = k.split(":"); items[month + ":" + app] = { month, app }; });
  Store.keys("carry:").forEach(k => { const t = Store.get(k, null); if (t && t.sourceMonth) items[t.sourceMonth + ":" + t.app] = { month: t.sourceMonth, app: t.app }; });
  return Object.keys(items).sort().reverse().map(k => items[k]);
}

function renderTrueUpTab() {
  const keep = $("tu_sel") ? $("tu_sel").value : null;
  const items = trueUpItems();
  $("tab6").innerHTML = `
    <div class="card"><h2>오차정산 (확정 부가정산금 → 익월 청구 이월)</h2>
      <p class="hint">[5. 수요기업 청구]에서 "청구 기록 저장"한 가정산 청구가 목록에 나옵니다. KPX 확정 부가정산금을 입력해 저장하면 다음 달 청구서의 전월 확정 부가정산금·전월 차액 칸이 자동으로 채워집니다.</p>
      <div class="row"><label>가정산 청구</label><select id="tu_sel" style="min-width:380px">
        ${items.map(it => { const c = custByApp(it.app); const done = Store.get(`carry:${nextYm(it.month)}:${it.app}`, null);
          return `<option value="${esc(it.month + ":" + it.app)}">${monthLabel(it.month)} — ${esc(c ? c.name : "미등록")} (${esc(it.app)})${done ? " ✓ 이월 저장됨" : ""}</option>`; }).join("")}
        <option value="${TU_MANUAL}">직접 입력 (시스템 밖에서 만든 청구)</option></select></div>
      <div id="tu_form"></div></div>
    <div id="tu_doc"></div>
    <div class="row no-print" id="tu_actions" style="display:none; margin-top:10px"><button class="btn secondary" id="tu_xlsx">Excel 다운</button><button class="btn secondary" id="tu_print">인쇄 / PDF 저장</button></div>`;
  if (keep && Array.from($("tu_sel").options).some(o => o.value === keep)) $("tu_sel").value = keep;
  $("tu_sel").onchange = renderTrueUpForm;
  $("tu_xlsx").onclick = exportTrueUpExcel;
  $("tu_print").onclick = () => window.print();
  renderTrueUpForm();
}

function renderTrueUpForm() {
  const sel = $("tu_sel").value, manual = sel === TU_MANUAL;
  const [month, app] = manual ? ["", ""] : sel.split(":");
  const bill = manual ? null : Store.get(`bill:${month}:${app}`, null);
  const carry = manual ? null : Store.get(`carry:${nextYm(month)}:${app}`, null);
  const c = carry || { confirmed: { taxable: 0, exempt: 0 }, prevDiff: { taxable: 0, exempt: 0 } };
  const ratio = carry ? carry.taxableRatio : ratesFor(month || cur6()).rates.taxableRatio;
  const expected = bill ? bill.expectedSurcharge : (carry ? carry.expectedSurcharge : 0);
  const field = (label, html) => `<div class="adj-item"><label class="adj-label">${label}</label>${html}</div>`;
  const num = (id, v, extra) => `<input type="number" id="${id}" value="${v == null ? "" : v}" step="any"${extra || ""}>`;
  $("tu_form").innerHTML = `
    <div class="adj-grid">
      ${field("대상 정산월 (YYYYMM)", `<input id="tu_month" value="${esc(month)}" maxlength="6"${manual ? ' placeholder="예: 202608"' : " readonly"}>`)}
      ${field("수요기업 (신청번호)", manual
        ? `<select id="tu_app">${Store.get("customers", []).map(x => `<option value="${esc(x.appNo)}">${esc(x.name)} (${esc(x.appNo)})</option>`).join("")}</select>`
        : `<input id="tu_app" value="${esc(app)}" readonly>`)}
      ${field("가정산 예상 부가정산금 (원)", num("tu_expected", expected, bill ? " readonly" : ""))}
    </div>
    <h3 class="sub">KPX 확정 부가정산금</h3>
    <div class="adj-grid">
      ${field("확정 부가정산금 총액 (원)", num("tu_total", carry ? carry.confirmedTotal : ""))}
      ${field("과세 비율 (대상월 KPX 통지값)", num("tu_ratio", ratio))}
      ${field("과세분 / 비과세분 (원)", `<div class="row" style="gap:6px; margin:0">${num("tu_taxable", c.confirmed.taxable)}${num("tu_exempt", c.confirmed.exempt)}</div>`)}
    </div>
    <p class="hint">총액·비율을 입력하면 자동으로 나눕니다. KPX 통지서에 과세/비과세 금액이 따로 있으면 그 금액으로 고쳐 쓰세요.</p>
    <h3 class="sub">전월 차액 (오차정산 결과, 익월 청구서에 가감)</h3>
    <div class="adj-grid">
      ${field("차액 (과세, 원)", num("tu_pd_taxable", c.prevDiff.taxable))}
      ${field("차액 (비과세, 원)", num("tu_pd_exempt", c.prevDiff.exempt))}
      ${field("메모", `<input id="tu_note" value="${esc(carry ? carry.note : "")}">`)}
    </div>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="tu_view">오차정산서 보기</button><button class="btn accent" id="tu_save">저장 (익월 청구로 이월)</button>
      <span id="tu_status" class="status warn" style="background:none">${carry ? "저장됨: " + new Date(carry.savedAt).toLocaleString() : ""}</span></div>`;
  $("tu_total").oninput = $("tu_ratio").oninput = splitTrueUp;
  $("tu_view").onclick = () => showTrueUp(false);
  $("tu_save").onclick = () => showTrueUp(true);
  $("tu_doc").innerHTML = ""; $("tu_actions").style.display = "none"; tuState.last = null;
  if (carry) showTrueUp(false);
}
function cur6() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`; }

function splitTrueUp() {
  if ($("tu_total").value === "") return;
  const s = Engine.splitSurcharge(Number($("tu_total").value) || 0, { taxableRatio: Number($("tu_ratio").value) || 0 });
  $("tu_taxable").value = s.taxable; $("tu_exempt").value = s.exempt;
}

function readTrueUp() {
  const n = id => Number($(id).value) || 0;
  const t = {
    sourceMonth: $("tu_month").value.trim(), app: $("tu_app").value.trim(),
    expectedSurcharge: n("tu_expected"), confirmedTotal: n("tu_total"), taxableRatio: Number($("tu_ratio").value),
    confirmed: { taxable: n("tu_taxable"), exempt: n("tu_exempt") },
    prevDiff: { taxable: n("tu_pd_taxable"), exempt: n("tu_pd_exempt") }, note: $("tu_note").value.trim()
  };
  if (!/^\d{6}$/.test(t.sourceMonth)) throw new Error("대상 정산월은 YYYYMM 6자리입니다.");
  if (!t.app) throw new Error("수요기업을 선택하세요. (없으면 [4. 등록·요율]에서 먼저 등록)");
  if (t.confirmed.taxable + t.confirmed.exempt !== t.confirmedTotal)
    throw new Error(`과세분+비과세분(${(t.confirmed.taxable + t.confirmed.exempt).toLocaleString()})이 확정 총액(${t.confirmedTotal.toLocaleString()})과 다릅니다.`);
  return t;
}

async function showTrueUp(save) {
  const st = $("tu_status");
  try {
    const t = readTrueUp();
    if (save) {
      const key = `carry:${nextYm(t.sourceMonth)}:${t.app}`;
      if (t.sourceMonth !== ($("tu_sel").value.split(":")[0]) && Store.get(key, null) && !confirm(`${monthLabel(t.sourceMonth)} ${t.app} 오차정산이 이미 있습니다. 덮어쓸까요?`)) return;
      t.savedAt = new Date().toISOString();
      const where = await Store.set(key, t);
      // 탭5에서 바로 그 그룹·월을 보고 있으면 즉시 반영
      const g = billState.kpx && billState.kpx.groups[$("groupSel").value];
      if (g && $("groupSel").value === t.app && g.month === nextYm(t.sourceMonth)) onGroupChange();
      // 목록(✓ 표시)을 새로 그리고 방금 저장한 항목을 다시 연다
      renderTrueUpTab(); $("tu_sel").value = t.sourceMonth + ":" + t.app; renderTrueUpForm();
      $("tu_status").textContent = (where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨") + ` → ${monthLabel(nextYm(t.sourceMonth))} 청구서에 반영됩니다.`;
      $("tu_status").className = "status " + (where === "remote" ? "ok" : "warn");
      return;
    }
    tuState.last = t;
    $("tu_doc").innerHTML = trueUpHtml(t);
    $("tu_actions").style.display = "flex";
  } catch (e) { st.textContent = e.message; st.className = "status bad"; }
}

function trueUpHtml(t) {
  const c = custByApp(t.app) || { name: t.app };
  const nm = nextYm(t.sourceMonth), vatRate = ratesFor(nm).rates.vatRate, vat = x => Engine.round(x * vatRate);
  const m = Number(t.sourceMonth.slice(4));
  const row = (l, a, basis, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="label">${l}</td><td class="num">${a}</td><td class="basis">${basis || ""}</td></tr>`;
  const taxableSum = t.confirmed.taxable + t.prevDiff.taxable, exemptSum = t.confirmed.exempt + t.prevDiff.exempt;
  const vatSum = vat(t.confirmed.taxable) + vat(t.prevDiff.taxable);
  return `<div class="doc">
    <h1 class="title">직접PPA 부가정산금 오차정산서</h1><div class="month">(${monthKo(t.sourceMonth)} 확정 → ${monthKo(nm)} 청구 반영)</div>
    <table class="doc-table"><tr><td class="label">수요기업</td><td>${esc(c.name)}</td><td class="label">KPX 신청번호</td><td>${esc(t.app)}</td></tr></table>
    <table class="doc-table"><tr><th>항목</th><th>금액</th><th>산출근거</th></tr>
      ${row(`${m}월 예상 부가정산금 (가정산)`, won(t.expectedSurcharge), "가정산 청구 시 기반기금 산정에만 사용 (청구 미포함)")}
      ${row(`${m}월 확정 부가정산금`, won(t.confirmedTotal), "KPX 확정 통지")}
      ${row("차이 (확정 − 예상)", won(t.confirmedTotal - t.expectedSurcharge), "참고")}
      ${row("과세분", won(t.confirmed.taxable), `확정 총액 × 과세 비율 ${t.taxableRatio}`)}
      ${row("비과세분", won(t.confirmed.exempt), "확정 총액 − 과세분")}</table>
    <h3 class="sub">${monthKo(nm)} 청구서 반영 내역</h3>
    <table class="doc-table"><tr><th>항목</th><th>금액</th><th>비고</th></tr>
      ${row(`${m}월 확정 부가정산금 (과세)`, won(t.confirmed.taxable), `세금계산서 · 부가세 ${won(vat(t.confirmed.taxable))} 별도`)}
      ${row("전월 차액 (과세)", won(t.prevDiff.taxable), `세금계산서 · 부가세 ${won(vat(t.prevDiff.taxable))} 별도`)}
      ${row(`${m}월 확정 부가정산금 (비과세)`, won(t.confirmed.exempt), "청구서 계")}
      ${row("전월 차액 (비과세)", won(t.prevDiff.exempt), "청구서 계")}
      ${row("반영 합계 (부가세 포함)", won(taxableSum + vatSum + exemptSum), `과세 ${won(taxableSum)} + 부가세 ${won(vatSum)} + 비과세 ${won(exemptSum)}`, "pay")}</table>
    ${t.note ? `<p class="hint">메모: ${esc(t.note)}</p>` : ""}
  </div>`;
}

function exportTrueUpExcel() {
  const t = tuState.last; if (!t) return;
  const c = custByApp(t.app) || { name: t.app };
  const aoa = [["직접PPA 부가정산금 오차정산서", t.sourceMonth, "→ " + nextYm(t.sourceMonth) + " 청구 반영"], ["수요기업", c.name, t.app], [],
    ["항목", "금액"], ["예상 부가정산금(가정산)", t.expectedSurcharge], ["확정 부가정산금", t.confirmedTotal], ["차이(확정-예상)", t.confirmedTotal - t.expectedSurcharge],
    ["과세 비율", t.taxableRatio], ["과세분", t.confirmed.taxable], ["비과세분", t.confirmed.exempt],
    ["전월 차액(과세)", t.prevDiff.taxable], ["전월 차액(비과세)", t.prevDiff.exempt], ["메모", t.note]];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "오차정산서");
  XLSX.writeFile(wb, `오차정산서_${c.name}_${t.sourceMonth}.xlsx`);
}

/* ---------- 초기화 ---------- */
function renderBillingTabs() {
  $("tab4").innerHTML = `
    <div class="card"><h2>월별 요율 (KPX 통지서)</h2><div id="ratesBody"></div></div>
    <div class="card"><h2>발전소 등록</h2><p class="hint">발전기명은 KPX 직접전력거래량 파일의 "발전기명"과 정확히 같아야 합니다. 지역은 최초 등록 시 한 번만 지정합니다.</p><div id="plantsBody"></div></div>
    <div class="card"><h2>수요기업 계약</h2><p class="hint">KPX 신청번호가 같은 발전소들이 한 그룹입니다. 신청번호로 업로드 파일과 수요기업이 자동으로 연결됩니다.</p><div id="custBody"></div></div>`;
  $("tab5").innerHTML = `
    <div class="card"><div class="row"><label>① KPX 직접전력거래량 (.xlsx)</label><input type="file" id="kpxFile" accept=".xlsx,.xls"><span id="kpxStatus" class="status warn" style="display:inline-flex">미선택</span></div>
      <div class="row"><label>② 고객 15분 사용량 (.xls)</label><input type="file" id="amiFile" accept=".xls,.html,.htm"><span id="amiStatus" class="status warn" style="display:inline-flex">미선택 (없으면 발전량 전량 공급으로 계산)</span></div>
      <div class="row"><label>③ 그룹(신청번호)</label><select id="groupSel" style="min-width:380px"></select><span id="billMonthBadge" class="badge"></span></div></div>
    <div class="card"><h2>전월 오차정산 반영</h2><p class="hint" id="prevHint"></p>
      <div class="row"><label>확정 부가정산금 총액</label><input type="number" id="cs_total" style="width:130px"><label>과세 비율</label><input type="number" id="cs_ratio" step="any" style="width:90px"><button class="btn secondary" id="cs_split">분할</button>
        <span class="hint">비율은 해당 부가정산금 월의 KPX 통지값입니다.</span></div>
      <div class="adj-grid">
        <div class="adj-item"><label class="adj-label">전월 확정 부가정산금 (과세)</label><input type="number" id="cs_taxable" value="0"></div>
        <div class="adj-item"><label class="adj-label">전월 확정 부가정산금 (비과세)</label><input type="number" id="cs_exempt" value="0"></div>
        <div class="adj-item"><label class="adj-label">전월 차액 (과세)</label><input type="number" id="pd_taxable" value="0"></div>
        <div class="adj-item"><label class="adj-label">전월 차액 (비과세)</label><input type="number" id="pd_exempt" value="0"></div>
        <div class="adj-item"><label class="adj-label">납부기한</label><input type="date" id="dueDate"></div></div>
      <div class="row" style="margin-top:10px"><button class="btn accent" id="calcBtn">계산하기</button></div></div>
    <div id="billResult"></div>
    <div class="row no-print" id="billActions" style="display:none; margin-top:10px"><button class="btn secondary" id="billXlsx">Excel 다운</button><button class="btn secondary" id="billPrint">인쇄 / PDF 저장</button><button class="btn accent" id="billSave">청구 기록 저장</button><span id="billSaveStatus" class="status warn" style="background:none"></span></div>`;
  $("kpxFile").onchange = e => e.target.files[0] && onKpxFile(e.target.files[0]);
  $("amiFile").onchange = e => e.target.files[0] && onAmiFile(e.target.files[0]);
  $("groupSel").onchange = onGroupChange;
  $("cs_split").onclick = splitConfirmed;
  $("calcBtn").onclick = runCalc;
  $("billXlsx").onclick = exportBillExcel;
  $("billPrint").onclick = () => window.print();
  $("billSave").onclick = saveBill;
}

async function initBilling() {
  renderBillingTabs();
  const ok = await Store.load();
  if (!ok) console.warn("[billing] GAS 앱데이터를 불러오지 못해 이 브라우저의 저장값만 사용합니다.");
  const m = new Date(); const cur = `${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, "0")}`;
  renderRatesCard(cur); renderPlantsCard(); renderCustomersCard(); renderTrueUpTab();
}
