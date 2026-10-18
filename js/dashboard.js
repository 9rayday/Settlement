/* ============ 정산 대시보드 (#page-dash) ============
 * 연도별 달력: 월마다 전기사용자 전력대금(+, 받을 돈)과 발전사업자 전력대금(−, 줄 돈), 손익 = 둘의 차.
 * 월을 누르면 아래에 전기사용자별 · 발전사업자별 전력대금 요약.
 * 데이터: 전기사용자 = 발행한 가정산서(bill:YYYYMM:신청번호)의 당월 청구 계,
 *         발전사업자 = 발전사업자 정산 결과(genpay:YYYYMM, js/invoice.js saveGenPay)의 지급액. 모두 부가세 포함.
 */
const dashState = { year: null, month: null };

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
  const ys = new Set([Number(todayYmd().slice(0, 4))]);
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
        <div class="dash-year"><button class="btn secondary" id="dashPrev"${years[0] >= y ? " disabled" : ""}>‹</button><b>${y}년</b><button class="btn secondary" id="dashNext"${years[years.length - 1] <= y ? " disabled" : ""}>›</button></div>
        <div class="dash-sum">
          <div><span>전기사용자 전력대금</span><b class="plus">+${dWon(yc)}</b></div>
          <div><span>발전사업자 전력대금</span><b class="minus">−${dWon(yg)}</b></div>
          <div><span>${y}년 손익</span><b class="${yc - yg >= 0 ? "plus" : "minus"}">${signed(yc - yg)}</b></div>
        </div>
      </div>
      <div class="dash-cal">${months.map((m, i) => {
        const d = data[i], pl = d.custTotal - d.genTotal;
        return `<button class="dash-month${d.has ? "" : " empty"}${m === dashState.month ? " active" : ""}" data-ym="${m}">
          <div class="dm-title">${i + 1}월</div>
          ${d.has ? `<div class="dm-row"><span>전기사용자</span><b class="plus">+${dWon(d.custTotal)}</b></div>
          <div class="dm-row"><span>발전사업자</span><b class="minus">−${dWon(d.genTotal)}</b></div>
          <div class="dm-row dm-pl"><span>손익</span><b class="${pl >= 0 ? "plus" : "minus"}">${signed(pl)}</b></div>` : `<div class="dm-none">정산 없음</div>`}
        </button>`; }).join("")}</div>
      <p class="hint" style="margin:10px 0 0">전기사용자 = 발행한 가정산서의 당월 청구 계, 발전사업자 = 발전사업자 정산서의 지급액 (모두 부가세 포함). 단위: 원</p>
    </div>
    <div id="dashDetail">${dashState.month ? dashDetailHtml(dashState.month) : ""}</div>`;
  document.getElementById("dashPrev").onclick = () => { const i = years.indexOf(y); if (i > 0) { dashState.year = years[i - 1]; dashState.month = null; renderDashboard(); } };
  document.getElementById("dashNext").onclick = () => { const i = years.indexOf(y); if (i < years.length - 1) { dashState.year = years[i + 1]; dashState.month = null; renderDashboard(); } };
  host.querySelectorAll(".dash-month").forEach(b => b.onclick = () => {
    dashState.month = b.dataset.ym;
    host.querySelectorAll(".dash-month").forEach(x => x.classList.toggle("active", x === b));
    document.getElementById("dashDetail").innerHTML = dashDetailHtml(dashState.month);
  });
}

function dashDetailHtml(ym) {
  const d = dashMonth(ym), label = `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
  const sum = (arr, k) => arr.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  const custName = x => x.customerName || (typeof Registry !== "undefined" && Registry.customerByApp(x.app, ym) ? Registry.customerByApp(x.app, ym).name : x.app);
  const custRows = d.cust.map(x => `<tr><td>${dEsc(custName(x))}</td><td>${dEsc(x.app)}</td><td class="num">${dKwh(x.supplyTotal)}</td><td class="num">${dWon(x.energy)}</td><td class="num">${dWon(x.netTotal)}</td><td class="num">${dWon(x.fee)}</td><td class="num"><b class="plus">${dWon(x.grandTotal)}</b></td><td>${x.paidAt ? "수령 " + dEsc(x.paidAt) : "미수령"}</td></tr>`).join("");
  const genRows = d.gen.map(x => `<tr><td>${dEsc(x.plant)}</td><td>${dEsc(x.appNo || "-")}</td><td class="num">${dKwh(x.supply)}</td><td class="num">${x.unitPrice == null ? "미등록" : x.unitPrice}</td><td class="num">${dWon(x.subtotal1)}</td><td class="num">${dWon(x.subtotal2)}</td><td class="num">${x.penalty ? dWon(x.penalty) : "-"}</td><td class="num"><b class="minus">${dWon(x.payment)}</b></td></tr>`).join("");
  const pl = d.custTotal - d.genTotal;
  return `
    <div class="card">
      <h2>${label} 상세 <span class="dash-pl ${pl >= 0 ? "plus" : "minus"}">손익 ${signed(pl)} 원</span></h2>
      <h3 class="sub">전기사용자별 전력대금 요약</h3>
      ${d.cust.length ? `<div class="table-wrap"><table class="grid dash-table"><tr><th>전기사용자</th><th>신청번호</th><th>공급량(kWh)</th><th>전력량요금</th><th>망이용요금</th><th>거래수수료</th><th>당월 청구 계</th><th>대금</th></tr>${custRows}
        <tr class="total"><td colspan="2">합계 (${d.cust.length}건)</td><td class="num">${dKwh(sum(d.cust, "supplyTotal"))}</td><td class="num">${dWon(sum(d.cust, "energy"))}</td><td class="num">${dWon(sum(d.cust, "netTotal"))}</td><td class="num">${dWon(sum(d.cust, "fee"))}</td><td class="num"><b class="plus">+${dWon(d.custTotal)}</b></td><td></td></tr></table></div>`
        : `<p class="hint">발행한 가정산서가 없습니다. [전기사용자 정산]에서 가정산서를 발행하면 여기에 표시됩니다.</p>`}
      <h3 class="sub" style="margin-top:18px">발전사업자별 전력대금 요약</h3>
      ${d.gen.length ? `<div class="table-wrap"><table class="grid dash-table"><tr><th>발전소</th><th>신청번호</th><th>공급량(kWh)</th><th>계약단가</th><th>전력량요금(VAT 포함)</th><th>수수료(VAT 포함)</th><th>위약금</th><th>지급액</th></tr>${genRows}
        <tr class="total"><td colspan="2">합계 (${d.gen.length}개소)</td><td class="num">${dKwh(sum(d.gen, "supply"))}</td><td></td><td class="num">${dWon(sum(d.gen, "subtotal1"))}</td><td class="num">${dWon(sum(d.gen, "subtotal2"))}</td><td class="num">${dWon(sum(d.gen, "penalty"))}</td><td class="num"><b class="minus">−${dWon(d.genTotal)}</b></td></tr></table></div>`
        : `<p class="hint">발전사업자 정산 결과가 없습니다. [발전사업자 정산]에서 KPX 파일을 올리면 여기에 표시됩니다.</p>`}
    </div>`;
}
