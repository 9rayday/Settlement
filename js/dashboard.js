/* ============ 정산 대시보드 (#page-dash) ============
 * 연도별 달력: 월마다 전기사용자 전력대금(+, 받을 돈)과 발전사업자 전력대금(−, 줄 돈), 손익 = 둘의 차.
 * 월을 누르면 아래에 전기사용자별 · 발전사업자별 전력대금 요약.
 * 데이터: 전기사용자 = 발행한 가정산서(bill:YYYYMM:신청번호)의 당월 청구 계,
 *         발전사업자 = 발전사업자 정산 결과(genpay:YYYYMM, js/invoice.js saveGenPay)의 지급액. 모두 부가세 포함.
 */
const dashState = { year: null, month: null, view: "month" };

const dWon = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString();
const dKwh = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString();
const dEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const signed = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(Math.round(n)).toLocaleString();

// 한 달 요약: { cust: [{app, name, ...bill}], gen: [{plant, ...}], custTotal, genTotal }
function dashMonth(ym) {
  const cust = Store.keys(`bill:${ym}:`).map(k => Object.assign({ app: k.split(":")[2] }, Store.get(k, {})));
  const gp = Store.get(`genpay:${ym}`, null);
  const gen = gp ? Object.keys(gp.plants).map(p => Object.assign({ plant: p }, gp.plants[p])) : [];
  const custTotal = cust.reduce((t, x) => t + (Number(x.grandTotal) || 0), 0);
  const genTotal = gen.reduce((t, x) => t + (Number(x.payment) || 0), 0);
  return { cust, gen, custTotal, genTotal, has: cust.length > 0 || gen.length > 0 };
}

function dashYears() {
  const cur = Number(todayYmd().slice(0, 4)), ys = new Set([cur]);
  for (let y = cur - 5; y < cur; y++) ys.add(y); // 서버에만 있는 지난 연도도 고를 수 있게
  Store.keys("bill:").concat(Store.keys("genpay:")).forEach(k => { const m = /:(\d{4})\d{2}/.exec(k); if (m) ys.add(Number(m[1])); });
  return Array.from(ys).sort();
}

function renderDashboard() {
  const host = document.getElementById("page-dash"); if (!host || typeof Store === "undefined") return;
  const years = dashYears();
  if (!dashState.year) dashState.year = years[years.length - 1];
  const y = dashState.year;
  const months = Array.from({ length: 12 }, (_, i) => `${y}${String(i + 1).padStart(2, "0")}`);
  const data = months.map(dashMonth);
  if (!dashState.month || dashState.month.slice(0, 4) !== String(y)) {
    const last = months.filter((m, i) => data[i].has).pop();
    dashState.month = last || null;
  }
  const yc = data.reduce((t, d) => t + d.custTotal, 0), yg = data.reduce((t, d) => t + d.genTotal, 0);
  host.innerHTML = `
    <div class="card">
      <div class="dash-head">
        <div class="dash-year"><button class="btn secondary" id="dashPrev"${years[0] >= y ? " disabled" : ""}>‹</button><b>${y}년</b><button class="btn secondary" id="dashNext"${years[years.length - 1] <= y ? " disabled" : ""}>›</button>
          <div class="dash-tabs"><button class="${dashState.view === "month" ? "on" : ""}" data-v="month">월별</button><button class="${dashState.view === "year" ? "on" : ""}" data-v="year">연간 종합</button></div></div>
        <div class="dash-sum">
          <div><span>전기사용자 전력대금</span><b class="plus">+${dWon(yc)}</b></div>
          <div><span>발전사업자 전력대금</span><b class="minus">−${dWon(yg)}</b></div>
          <div><span>${y}년 손익</span><b class="${yc - yg >= 0 ? "plus" : "minus"}">${signed(yc - yg)}</b></div>
        </div>
      </div>
      ${dashState.view === "year" ? "" : `<div class="dash-cal">${months.map((m, i) => {
        const d = data[i], pl = d.custTotal - d.genTotal;
        return `<button class="dash-month${d.has ? "" : " empty"}${m === dashState.month ? " active" : ""}" data-ym="${m}">
          <div class="dm-title">${i + 1}월</div>
          ${d.has ? `<div class="dm-row"><span>전기사용자</span><b class="plus">+${dWon(d.custTotal)}</b></div>
          <div class="dm-row"><span>발전사업자</span><b class="minus">−${dWon(d.genTotal)}</b></div>
          <div class="dm-row dm-pl"><span>손익</span><b class="${pl >= 0 ? "plus" : "minus"}">${signed(pl)}</b></div>` : `<div class="dm-none">정산 없음</div>`}
        </button>`; }).join("")}</div>`}
    </div>
    ${dashState.view === "year" ? dashYearHtml(y, months, data) : `<div id="dashDetail">${dashState.month ? dashDetailHtml(dashState.month) : ""}</div>`}`;
  host.querySelectorAll(".dash-tabs button").forEach(b => b.onclick = () => { dashState.view = b.dataset.v; renderDashboard(); });
  document.getElementById("dashPrev").onclick = async () => { const i = years.indexOf(y); if (i > 0) { dashState.year = years[i - 1]; dashState.month = null; await Store.ensureYear(dashState.year); renderDashboard(); } };
  document.getElementById("dashNext").onclick = () => { const i = years.indexOf(y); if (i < years.length - 1) { dashState.year = years[i + 1]; dashState.month = null; renderDashboard(); } };
  host.querySelectorAll(".dash-month").forEach(b => b.onclick = () => {
    dashState.month = b.dataset.ym;
    host.querySelectorAll(".dash-month").forEach(x => x.classList.toggle("active", x === b));
    document.getElementById("dashDetail").innerHTML = dashDetailHtml(dashState.month);
    bindPaid();
  });
  bindPaid();
}
// 전력대금 수령 처리 (가정산서 bill:YYYYMM:신청번호 에 수령일·수령액 기록)
function bindPaid() {
  const host = document.getElementById("dashDetail"); if (!host || !dashState.month) return;
  const ym = dashState.month, key = app => `bill:${ym}:${app}`;
  const ap = document.getElementById("dashApplyPrice");
  if (ap) ap.onclick = async () => {
    if (typeof requirePerm === "function" && !requirePerm("settle")) return;
    ap.disabled = true; ap.textContent = "계산 중...";
    const w = await dashApplyPrices(ym);
    if (w === "denied") { ap.disabled = false; ap.textContent = "권한 없음"; return; }
    renderDashboard();
  };
  host.querySelectorAll(".arc-link").forEach(a => a.onclick = e => { e.preventDefault(); openArchive(a.dataset.k, a.dataset.key, a.dataset.m, a.dataset.doc); }); // 정산서 보관함 (js/archive.js)
  host.querySelectorAll(".paid-ok").forEach(b => b.onclick = async () => {
    const bill = Store.get(key(b.dataset.app), null); if (!bill) return;
    const d = host.querySelector(`.paid-date[data-app="${CSS.escape(b.dataset.app)}"]`).value || todayYmd();
    if ((await Store.set(key(b.dataset.app), Object.assign({}, bill, { paidAt: d, paidAmount: bill.grandTotal }))) !== "denied") renderDashboard();
  });
  host.querySelectorAll(".paid-undo").forEach(b => b.onclick = async () => {
    if (!confirm("수령 처리를 취소할까요?")) return;
    const bill = Object.assign({}, Store.get(key(b.dataset.app), null)); delete bill.paidAt; delete bill.paidAmount;
    if ((await Store.set(key(b.dataset.app), bill)) !== "denied") renderDashboard();
  });
}

// 발전대금 계산 때 계약단가가 비어 있던 발전소 중, 지금은 계약관리에 단가가 등록된 것 { 발전소: 단가 }
const dashNum = v => v === undefined || v === null || v === "" || isNaN(v) ? null : Number(v);
function dashLatePrices(ym) {
  const gp = Store.get(`genpay:${ym}`, null), out = {};
  if (!gp || typeof masterData === "undefined") return out;
  Object.keys(gp.plants).forEach(p => { const x = gp.plants[p], up = dashNum((masterData[p] || {})["계약단가"]); if (x.unitPrice == null && up != null) out[p] = up; });
  return out;
}
// 저장된 공급량·조정값·위약금은 그대로 두고 등록된 단가로 지급액만 다시 계산
async function dashApplyPrices(ym) {
  const key = `genpay:${ym}`, gp = Store.get(key, null), late = dashLatePrices(ym);
  Object.keys(late).forEach(p => {
    const x = gp.plants[p], m = masterData[p] || {};
    const feeRate = dashNum(x.feeRate) != null ? Number(x.feeRate) : (dashNum(m["수수료율"]) != null ? Number(m["수수료율"]) : DEFAULT_FEE_RATE);
    const c = genCalcParts({ supply: x.supply, unitPrice: late[p], feeRate, adj: x.adj, penalty: x.penalty, penaltyLabel: x.penaltyLabel });
    gp.plants[p] = Object.assign({}, x, { unitPrice: c.unitPrice, feeRate: c.feeRate, energyFee: c.energyFee, supplyValue: c.supplyValue, vat1: c.vat1, subtotal1: c.subtotal1,
      fee: c.fee, vat2: c.vat2, subtotal2: c.subtotal2, payment: c.payment, editedAt: new Date().toISOString() });
  });
  return Store.set(key, gp);
}

function dashDetailHtml(ym) {
  const d = dashMonth(ym), label = `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
  const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const late = dashLatePrices(ym);
  const custName = x => x.customerName || (typeof Registry !== "undefined" && Registry.customerByApp(x.app, ym) ? Registry.customerByApp(x.app, ym).name : x.app);
  const custRows = d.cust.map(x => `<tr><td><a href="#" class="arc-link" data-k="cust" data-key="${dEsc(x.app)}" data-m="${ym}" data-doc="bill" title="정산서 보관함에서 가정산서 보기">${dEsc(custName(x))}</a></td><td>${dEsc(x.app)}</td><td class="num">${dKwh(x.supplyTotal)}</td><td class="num">${dWon(x.energy)}</td><td class="num">${dWon(x.netTotal)}</td><td class="num">${dWon(x.fee)}</td><td class="num"><b class="plus">${dWon(x.grandTotal)}</b></td><td class="paid-cell">${x.paidAt
    ? `<span class="tag ok-tag">수령 ${dEsc(x.paidAt)}</span> <button class="btn-link paid-undo" data-app="${dEsc(x.app)}">취소</button>`
    : `<input type="date" class="paid-date" data-app="${dEsc(x.app)}" value="${todayYmd()}"><button class="btn secondary paid-ok" data-app="${dEsc(x.app)}">수령 처리</button>`}</td></tr>`).join("");
  const genRows = d.gen.map(x => `<tr><td><a href="#" class="arc-link" data-k="gen" data-key="${dEsc(x.plant)}" data-m="${ym}" data-doc="gen" title="정산서 보관함에서 정산서 보기">${dEsc(x.plant)}</a></td><td>${dEsc(x.appNo || "-")}</td><td class="num">${dKwh(x.supply)}</td><td class="num">${x.unitPrice != null ? x.unitPrice : late[x.plant] != null ? `<span class="tag warn-tag" title="발전대금 계산 때는 단가가 비어 있었고, 지금은 ${late[x.plant]}원으로 등록되어 있습니다">계산 때 미등록</span>` : "미등록"}</td><td class="num">${dWon(x.subtotal1)}</td><td class="num">${dWon(x.subtotal2)}</td><td class="num">${x.penalty ? dWon(x.penalty) : "-"}</td><td class="num"><b class="minus">${dWon(x.payment)}</b></td></tr>`).join("");
  const pl = d.custTotal - d.genTotal;
  const lateN = Object.keys(late).length;
  return `
    <div class="card">
      <h2>${label} 상세 <span class="dash-pl ${pl >= 0 ? "plus" : "minus"}">손익 ${signed(pl)} 원</span></h2>
      <h3 class="sub">전기사용자별 전력대금 요약</h3>
      ${d.cust.length ? `<div class="table-wrap"><table class="grid dash-table"><tr><th>전기사용자</th><th>신청번호</th><th>공급량(kWh)</th><th>전력량요금</th><th>망이용요금</th><th>거래수수료</th><th>당월 청구 계</th><th>전력대금 수령</th></tr>${custRows}
        <tr class="total"><td colspan="2">합계 (${d.cust.length}건)</td><td class="num">${dKwh(sum(d.cust, "supplyTotal"))}</td><td class="num">${dWon(sum(d.cust, "energy"))}</td><td class="num">${dWon(sum(d.cust, "netTotal"))}</td><td class="num">${dWon(sum(d.cust, "fee"))}</td><td class="num"><b class="plus">+${dWon(d.custTotal)}</b></td><td></td></tr></table></div>`
        : `<div class="empty">없음</div>`}
      <h3 class="sub" style="margin-top:18px">발전사업자별 전력대금 요약</h3>
      ${lateN ? `<div class="notice warn">${lateN}개 발전소는 발전대금 계산 때 계약단가가 비어 있어 지급액이 빠져 있습니다. 지금은 계약관리에 단가가 등록되어 있습니다.
        <button type="button" class="btn accent" id="dashApplyPrice" style="margin-left:8px">등록된 계약단가로 다시 계산 (${lateN}개소)</button></div>` : ""}
      ${d.gen.length ? `<div class="table-wrap"><table class="grid dash-table"><tr><th>발전소</th><th>신청번호</th><th>공급량(kWh)</th><th>계약단가</th><th>전력량요금(VAT 포함)</th><th>수수료(VAT 포함)</th><th>위약금</th><th>지급액</th></tr>${genRows}
        <tr class="total"><td colspan="2">합계 (${d.gen.length}개소)</td><td class="num">${dKwh(sum(d.gen, "supply"))}</td><td></td><td class="num">${dWon(sum(d.gen, "subtotal1"))}</td><td class="num">${dWon(sum(d.gen, "subtotal2"))}</td><td class="num">${dWon(sum(d.gen, "penalty"))}</td><td class="num"><b class="minus">−${dWon(d.genTotal)}</b></td></tr></table></div>`
        : `<div class="empty">없음</div>`}
    </div>`;
}

function dashYearHtml(y, months, data) {
  const recByMonth = {}; // REC 정산: 확정 기간의 마지막 달 기준 (js/rec.js)
  Store.keys("recset:").forEach(k => { const s = Store.get(k, {}); if (!s || !s.to || !s.to.startsWith(String(y))) return; const r = recByMonth[s.to] || (recByMonth[s.to] = { amount: 0, fee: 0, qty: 0 }); r.amount += (s.totals && s.totals.amount) || 0; r.fee += s.fee || 0; r.qty += (s.totals && s.totals.recQty) || 0; });
  const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.custTotal - d.genTotal)));
  let cum = 0;
  const trend = months.map((m, i) => { const d = data[i], pl = d.custTotal - d.genTotal, rec = recByMonth[m]; cum += pl;
    return `<tr${d.has ? "" : ' class="muted"'}><td>${i + 1}월</td><td class="num plus">${d.custTotal ? "+" + dWon(d.custTotal) : "-"}</td><td class="num minus">${d.genTotal ? "−" + dWon(d.genTotal) : "-"}</td>
      <td class="num ${pl >= 0 ? "plus" : "minus"}">${d.has ? signed(pl) : "-"}</td><td class="bar-cell">${d.has ? `<span class="pl-bar ${pl >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(pl) / maxAbs * 100).toFixed(1)}%"></span>` : ""}</td>
      <td class="num">${d.has ? signed(cum) : "-"}</td><td class="num">${rec ? rec.qty : "-"}</td><td class="num">${rec ? dWon(rec.amount) : "-"}</td><td class="num">${rec ? dWon(rec.fee) : "-"}</td></tr>`; }).join("");
  const sumBy = (getList, keyOf, valOf, nameOf) => { const rows = {};
    data.forEach((d, i) => getList(d).forEach(x => { const k = keyOf(x), r = rows[k] || (rows[k] = { name: nameOf(x), m: new Array(12).fill(0) }); r.m[i] += Number(valOf(x)) || 0; }));
    return Object.values(rows).sort((a, b) => a.name.localeCompare(b.name)); };
  const custName = x => x.customerName || (typeof Registry !== "undefined" && Registry.customerByApp(x.app) ? Registry.customerByApp(x.app).name : x.app);
  const custRows = sumBy(d => d.cust, x => x.app, x => x.grandTotal, custName), genRows = sumBy(d => d.gen, x => x.plant, x => x.payment, x => x.plant);
  const table = (title, rows, cls, sign) => `<div class="card"><h2>${title}</h2>${rows.length ? `<div class="table-wrap"><table class="grid dash-table dash-year-table">
      <tr><th>구분</th>${months.map((m, i) => `<th>${i + 1}월</th>`).join("")}<th>합계</th></tr>
      ${rows.map(r => `<tr><td>${dEsc(r.name)}</td>${r.m.map(v => `<td class="num">${v ? dWon(v) : "-"}</td>`).join("")}<td class="num ${cls}"><b>${sign}${dWon(r.m.reduce((a, b) => a + b, 0))}</b></td></tr>`).join("")}
      <tr class="total"><td>합계</td>${months.map((m, i) => { const v = rows.reduce((t, r) => t + r.m[i], 0); return `<td class="num">${v ? dWon(v) : "-"}</td>`; }).join("")}<td class="num ${cls}"><b>${sign}${dWon(rows.reduce((t, r) => t + r.m.reduce((a, b) => a + b, 0), 0))}</b></td></tr>
    </table></div>` : `<div class="empty">없음</div>`}</div>`;
  const yc = data.reduce((t, d) => t + d.custTotal, 0), yg = data.reduce((t, d) => t + d.genTotal, 0), recY = Object.values(recByMonth);
  return `<div class="card"><h2>${y}년 월별 추이</h2><div class="table-wrap"><table class="grid dash-table dash-trend">
      <tr><th rowspan="2">월</th><th rowspan="2">전기사용자</th><th rowspan="2">발전사업자</th><th rowspan="2" colspan="2">손익</th><th rowspan="2">누적 손익</th><th colspan="3">REC 정산</th></tr>
      <tr><th>수량</th><th>매매금액</th><th>용역 수수료</th></tr>
      ${trend}
      <tr class="total"><td>합계</td><td class="num plus">+${dWon(yc)}</td><td class="num minus">−${dWon(yg)}</td><td class="num ${yc - yg >= 0 ? "plus" : "minus"}" colspan="2">${signed(yc - yg)}</td><td></td>
        <td class="num">${recY.reduce((t, r) => t + r.qty, 0) || "-"}</td><td class="num">${dWon(recY.reduce((t, r) => t + r.amount, 0))}</td><td class="num">${dWon(recY.reduce((t, r) => t + r.fee, 0))}</td></tr>
    </table></div></div>
    ${table("전기사용자별", custRows, "plus", "+")}
    ${table("발전사업자별", genRows, "minus", "−")}`;
}
