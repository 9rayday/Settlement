/* ============ Plant selection (shared across tabs) ============ */
let selectedPlant = "";

function onPlantSelectionChanged(){
  const sels = document.querySelectorAll(".plant-select");
  if(!selectedPlant || !plants.includes(selectedPlant)){
    selectedPlant = plants[0] || "";
  }
  sels.forEach(s=> s.value = selectedPlant);
  loadPlantContext();
}

function onPlantSelectChange(newPlant){
  selectedPlant = newPlant;
  document.querySelectorAll(".plant-select").forEach(s=> s.value = selectedPlant);
  loadPlantContext();
}

async function loadPlantContext(){
  renderInvoicePreview();
}

/* ============ 발전대금 계산 (버튼 하나): 실적 기록 · 발전소별 지급액 저장 · 정산서 ============ */
let genCalcDone = false;
function genReset(){
  genCalcDone = false;
  const btn = document.getElementById("genCalcBtn"); if(btn) btn.disabled = !plants.length;
  ["exportBtn","pdfBtn","exportAllBtn"].forEach(id => { const b = document.getElementById(id); if(b) b.disabled = true; });
  const r = document.getElementById("genResult"); if(r) r.innerHTML = "";
  const p = document.getElementById("genPick"); if(p) p.style.display = "none";
  const st = document.getElementById("genCalcStatus"); if(st) st.textContent = "";
  renderInvoicePreview();
}
async function genCalculate(){
  if(!plants.length || !settleMonth) return;
  if(typeof requirePerm === "function" && !requirePerm("settle")) return;
  const btn = document.getElementById("genCalcBtn"), st = document.getElementById("genCalcStatus");
  btn.disabled = true; st.textContent = "계산 중...";
  try{
    genCalcDone = true;
    await syncPerformanceToGas(); // 월별실적로그·실적그리드 기록, 계약이행현황 갱신, 발전대금 저장(genpay)
    renderGenResult();
    ["exportBtn","pdfBtn","exportAllBtn"].forEach(id => { document.getElementById(id).disabled = false; });
    document.getElementById("genPick").style.display = "flex";
    st.textContent = `${settleMonth.slice(0,4)}.${settleMonth.slice(4)} 계산 완료`;
  }catch(e){ st.textContent = "오류: " + e.message; }
  btn.disabled = false;
}
function renderGenResult(){
  const host = document.getElementById("genResult"); if(!host) return;
  const f = n => n==null ? "-" : Math.round(n).toLocaleString();
  const rows = plants.map(p => ({ p, c: calcInvoice(p) })).filter(x => x.c);
  const sum = k => rows.reduce((t, x) => t + (Number(x.c[k]) || 0), 0);
  host.innerHTML = `<div class="table-wrap" style="margin-top:12px"><table class="grid gen-result">
    <tr><th>발전소</th><th>공급량 (kWh)</th><th>계약단가</th><th>전력량요금 (VAT 포함)</th><th>거래수수료 (VAT 포함)</th><th>위약금</th><th>지급액</th></tr>
    ${rows.map(({p, c}) => `<tr data-p="${p}"><td><a href="#" class="gen-open" data-p="${p}">${p}</a></td><td class="num">${f(c.supply)}</td><td class="num">${c.unitPrice==null ? '<span class="tag bad">미등록</span>' : c.unitPrice}</td>
      <td class="num">${f(c.subtotal1)}</td><td class="num">${f(c.subtotal2)}</td><td class="num">${c.penalty ? f(c.penalty) : "-"}</td><td class="num"><b>${f(c.payment)}</b></td></tr>`).join("")}
    <tr class="total"><td>합계 (${rows.length}개소)</td><td class="num">${f(sum("supply"))}</td><td></td><td class="num">${f(sum("subtotal1"))}</td><td class="num">${f(sum("subtotal2"))}</td><td class="num">${f(sum("penalty"))}</td><td class="num"><b>${f(sum("payment"))}</b></td></tr>
  </table></div>`;
  host.querySelectorAll(".gen-open").forEach(a => a.onclick = e => { e.preventDefault(); onPlantSelectChange(a.dataset.p); document.getElementById("invoiceHost").scrollIntoView({ behavior: "smooth" }); });
}

/* ============ Date helpers (연간보장공급량 회차 계산) ============ */
function parseYm(s){
  const digits = String(s||"").replace(/[^0-9]/g,"");
  if(digits.length<6) return null;
  return { y:Number(digits.slice(0,4)), m:Number(digits.slice(4,6)) };
}
function addMonths(ym, n){
  const total = ym.y*12 + (ym.m-1) + n;
  return { y: Math.floor(total/12), m: (total%12)+1 };
}
function ymLabel(ym){ return `'${String(ym.y).slice(2)}.${String(ym.m).padStart(2,"0")}.`; }

// grid: fetchYearlyGrid()가 반환하는 { "1":[12개 값 또는 null...], ..., "20":[...] } 형태.
// 구글시트 "실적그리드" 탭(발전소별 연차 x 월 블록)을 그대로 읽어온 값이라, 시트에서 수동으로
// 고친 값도 여기 바로 반영된다 — 프론트는 그걸 합산/표시만 한다.
function buildGuaranteeSchedule(plant, grid){
  const m = masterData[plant] || {};
  const capacity = Number(m["계약용량"]) || 0;
  const hours = Number(m["발전보장시간"]) || DEFAULT_GUARANTEE_HOURS;
  const startYm = parseYm(m["계약일자"]);
  const rows = [];
  let yearlyExpected = capacity * hours * 365;
  for(let k=1;k<=20;k++){
    if(!startYm || !capacity){ rows.push({k, label:"-", expected:null, actualCum:null}); continue; }
    if(k>1) yearlyExpected = yearlyExpected - yearlyExpected*0.005;
    const windowStart = addMonths(startYm, (k-1)*12);
    const windowEnd = addMonths(startYm, k*12-1);
    const label = `(${ymLabel(windowStart)} ~ ${ymLabel(windowEnd)})`;
    const monthly = (grid && grid[String(k)]) || new Array(12).fill(null);
    const filled = monthly.filter(v=> v!=null);
    const actualCum = filled.length ? filled.reduce((s,v)=>s+v,0) : null;
    rows.push({k, label, expected: yearlyExpected, actualCum, monthly});
  }
  return rows;
}

/* ============ Invoice calculation ============ */
function calcInvoice(plant){
  const a = aggByPlant[plant];
  if(!a) return null;
  const m = masterData[plant] || {};
  const unitPrice = (m["계약단가"]!==undefined && m["계약단가"]!=="" && m["계약단가"]!==null) ? Number(m["계약단가"]) : null;
  const feeRate = (m["수수료율"]!==undefined && m["수수료율"]!=="" && m["수수료율"]!==null) ? Number(m["수수료율"]) : DEFAULT_FEE_RATE;
  const supply = a.supply;
  const energyFee = unitPrice!=null ? Math.round(supply*unitPrice) : null;
  const supplyValue = energyFee;
  const vat1 = supplyValue!=null ? Math.round(supplyValue*0.1) : null;
  const subtotal1 = supplyValue!=null ? supplyValue+vat1 : null;
  const fee = Math.round(supply*feeRate);
  const vat2 = Math.round(fee*0.1);
  const subtotal2 = fee+vat2;
  const adj = adjustmentsByPlant[plant] || {전월차액:0,전월미지급액:0,기타정산:0};
  // 계약 위약금 (연간보장공급량 미달, 처리 방식 "청구서 차감") — js/performance.js
  const pen = (typeof penaltyDue === "function" && settleMonth) ? penaltyDue("gen", plant, settleMonth) : {amount:0, label:""};
  const payment = subtotal1!=null
    ? subtotal1 - subtotal2 - (Number(adj.전월차액)||0) - (Number(adj.전월미지급액)||0) - (Number(adj.기타정산)||0) - pen.amount
    : null;
  return { unitPrice, feeRate, supply, energyFee, supplyValue, vat1, subtotal1, fee, vat2, subtotal2, adj, payment, penalty: pen.amount, penaltyLabel: pen.label };
}

/* ============ 정산 대시보드용 발전사업자 전력대금 기록 (genpay:YYYYMM) ============
 * 업로드·조정 저장 때마다 그 달 모든 발전소의 정산 요약을 저장한다. 조정값을 아직 안 불러온 발전소는 이전 기록의 조정값을 쓴다.
 */
async function saveGenPay(){
  if(!settleMonth || !plants.length || typeof Store === "undefined") return;
  const key = `genpay:${settleMonth}`, old = Store.get(key, null) || { plants: {} };
  const out = {};
  plants.forEach(p=>{
    if(!adjustmentsByPlant[p] && old.plants[p] && old.plants[p].adj) adjustmentsByPlant[p] = old.plants[p].adj;
    const c = calcInvoice(p); if(!c) return;
    const a = aggByPlant[p];
    out[p] = { generation: a.generation, supply: c.supply, excess: a.excess, unitPrice: c.unitPrice, energyFee: c.energyFee, vat1: c.vat1, subtotal1: c.subtotal1,
      fee: c.fee, subtotal2: c.subtotal2, adj: c.adj, penalty: c.penalty, payment: c.payment, appNo: Registry.plantGroup(masterData[p]) };
  });
  await Store.set(key, { plants: Object.assign({}, old.plants, out), savedAt: new Date().toISOString() });
  if(typeof renderDashboard === "function") renderDashboard();
}

/* ============ Tab 2: 발전소별 확인/조정 ============ */
function renderPlantAdjustTab(){
  const host = document.getElementById("plantAdjustHost");
  if(!host) return; // 발전소별 확인/조정 화면은 없앰 (발전대금 계산 버튼 하나로)
  if(!selectedPlant || !aggByPlant[selectedPlant]){ host.style.display="none"; return; }
  host.style.display = "block";
  const a = aggByPlant[selectedPlant];
  const adj = adjustmentsByPlant[selectedPlant] || {전월차액:0,전월미지급액:0,기타정산:0};
  document.getElementById("plantKpis").innerHTML = `
    <div class="kpi"><div class="label">발전량</div><div class="value">${Math.round(a.generation).toLocaleString()} kWh</div></div>
    <div class="kpi"><div class="label">공급량</div><div class="value">${Math.round(a.supply).toLocaleString()} kWh</div></div>
    <div class="kpi"><div class="label">초과발전량</div><div class="value">${Math.round(a.excess).toLocaleString()} kWh</div></div>
  `;
  document.getElementById("adjPrevDiff").value = adj.전월차액 || 0;
  document.getElementById("adjPrevUnpaid").value = adj.전월미지급액 || 0;
  document.getElementById("adjOtherSettle").value = adj.기타정산 || 0;
  document.getElementById("adjStatus").textContent = "";
}

async function handleSaveAdjustments(){
  if(!selectedPlant || !settleMonth){ alert("먼저 데이터를 업로드하세요."); return; }
  const prevDiff = Number(document.getElementById("adjPrevDiff").value) || 0;
  const prevUnpaid = Number(document.getElementById("adjPrevUnpaid").value) || 0;
  const otherSettle = Number(document.getElementById("adjOtherSettle").value) || 0;
  const statusEl = document.getElementById("adjStatus");
  statusEl.textContent = "저장 중...";
  const result = await saveAdjustments(settleMonth, selectedPlant, prevDiff, prevUnpaid, otherSettle);
  adjustmentsByPlant[selectedPlant] = { 전월차액: prevDiff, 전월미지급액: prevUnpaid, 기타정산: otherSettle };
  // 저장 시점에 구글시트("발전소 사업자 정보")가 그새 바뀌었을 수 있으니 해당 발전소 값도 최신으로 다시 가져온다.
  await fetchMaster();
  statusEl.textContent = result ? "저장 완료 (마스터 정보도 최신으로 갱신됨)" : "저장 실패 (GAS 배포 전이면 로컬에만 반영됩니다)";
  renderInvoicePreview();
  saveGenPay();
}

async function handleRefreshMaster(){
  const btn = document.getElementById("refreshMasterBtn");
  const statusEl = document.getElementById("refreshMasterStatus");
  btn.disabled = true;
  statusEl.textContent = "전체 발전소 마스터 정보 불러오는 중...";
  await fetchMaster();
  statusEl.textContent = `완료 (${Object.keys(masterData).length}개 발전소 정보 반영)`;
  renderPlantAdjustTab();
  renderInvoicePreview();
  btn.disabled = false;
}

/* ============ Tab 3: 정산서 미리보기 ============ */
async function renderInvoicePreview(){
  const host = document.getElementById("invoiceHost");
  if(!genCalcDone || !selectedPlant || !aggByPlant[selectedPlant]){ host.style.display="none"; return; }
  host.style.display = "block";
  host.innerHTML = await buildInvoiceHtml(selectedPlant);
  if(typeof fitDocs === "function") fitDocs(host); // A4 한 장 맞춤 (js/billing.js)
}

async function buildInvoiceHtml(plant){
  const a = aggByPlant[plant];
  const m = masterData[plant] || {};
  const calc = calcInvoice(plant);
  const fmt = n => n==null ? "-" : Math.round(n).toLocaleString();
  const won = n => n==null ? "-" : Math.round(n).toLocaleString() + " 원";
  const kwh = n => n==null ? "-" : Number(n).toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2}) + " kWh";
  const monthLabel = settleMonth ? `${settleMonth.slice(0,4)}년 ${settleMonth.slice(4,6)}월` : "-";
  const lossRate = siteTotals.lossRatePct!=null ? siteTotals.lossRatePct
    : (siteTotals.usage ? (siteTotals.usage - siteTotals.supply)/siteTotals.usage : 0);
  const grid = await fetchYearlyGrid(plant);
  const schedule = buildGuaranteeSchedule(plant, grid);
  const t = new Date(todayYmd() + "T00:00:00");
  const todayLabel = `${t.getFullYear()}년 ${String(t.getMonth()+1).padStart(2,"0")}월 ${String(t.getDate()).padStart(2,"0")}일`;
  const todo = "입력 예정";
  const field = (label, val, span) => `<td class="label">${label}</td><td colspan="${span||2}"${val===todo?' class="editable"':''}>${val}</td>`;
  const docNo = `${BUYER.invoicePrefix}-${settleMonth}-0001`;
  // 연간보장공급량: 계약기간 안에서 진행 중인 회차 + 2회차까지만 (최소 3회차) — 20회차를 모두 넣으면 A4를 넘는다
  const years = Math.min(20, Math.round(Number(m["계약기간"])) || 20);
  const startYm = parseYm(m["계약일자"]), curYm = parseYm(settleMonth);
  const curK = startYm && curYm ? Math.floor(((curYm.y - startYm.y) * 12 + (curYm.m - startYm.m)) / 12) + 1 : 1;
  const shown = schedule.slice(0, Math.min(years, Math.max(3, curK + 2)));
  const hasSchedule = shown.some(r => r.expected != null);
  // 정산내역 행: 항목 | 금액 | 산출근거(4칸)
  const row = (l, amt, basis, cls) => `<tr${cls?` class="${cls}"`:""}><td class="label">${l}</td><td class="num">${amt}</td><td class="basis" colspan="4">${basis||""}</td></tr>`;
  const adj = calc.adj;
  const rows = [
    row("전력량 요금", calc.energyFee==null ? '<span class="editable">단가 입력 필요</span>' : won(calc.energyFee), calc.unitPrice==null ? "계약단가 미등록" : `공급량 ${fmt(a.supply)} kWh × ${calc.unitPrice} 원/kWh`),
    row("공급가액", won(calc.supplyValue), "전력량 요금"),
    row("부가가치세", won(calc.vat1), "공급가액 × 10%"),
    row("계 (전력량 요금)", won(calc.subtotal1), "공급가액 + 부가가치세", "total"),
    row("거래수수료", won(calc.fee), `공급량 ${fmt(a.supply)} kWh × ${calc.feeRate} 원/kWh`),
    row("부가가치세", won(calc.vat2), "거래수수료 × 10%"),
    row("계 (거래수수료)", won(calc.subtotal2), "거래수수료 + 부가가치세", "total"),
    row("전월 차액", won(adj.전월차액), "전월 정산 차액 (차감)"),
    row("전월 미지급액", won(adj.전월미지급액), "전월 미지급분 (차감)"),
    row("기타정산", won(adj.기타정산), "기타 정산 (차감)")
  ].concat(calc.penalty ? [row("위약금 차감", won(calc.penalty), `연간보장공급량 ${calc.penaltyLabel}`)] : []);
  return `
  <div class="doc bill gen">
    <div class="doc-header bill-head"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo">
      <div class="bill-title"><h1 class="title">직접PPA 전력거래대금 정산서</h1><div class="month">(${monthLabel} 거래분)</div></div>
      <div class="bill-no">정산서 번호: ${docNo}</div></div>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="3">발전<br>사업자<br>정보</th>
        ${field("사업자명 (대표자명)", m["사업자명(대표자명)"] || todo)}${field("사업자등록번호", m["사업자등록번호"] || todo)}</tr>
      <tr>${field("사업자 주소", m["사업자주소"] || todo)}${field("계좌번호", m["계좌번호"] || todo)}</tr>
      <tr>${field("발전소명", m["발전소명"] || plant)}${field("연락처", [m["담당자"], m["연락처"]].filter(Boolean).join("<br>") || todo)}</tr>
    </table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="5">전력<br>거래<br>내역</th>${field("총 전기사용량", kwh(siteTotals.usage))}${field("총 발전량", kwh(siteTotals.generation))}</tr>
      <tr>${field("전력손실률", (lossRate*100).toFixed(2) + "%")}${field("총 공급량", kwh(siteTotals.supply))}</tr>
      <tr>${field("총 초과발전량", kwh(siteTotals.excess))}${field("총 부족전력량", kwh(siteTotals.deficit))}</tr>
      <tr class="hl">${field("해당 발전소 발전량", kwh(a.generation))}${field("해당 발전소 공급량", kwh(a.supply))}</tr>
      <tr class="hl">${field("해당 발전소 초과발전량", kwh(a.excess))}<td class="label">-</td><td colspan="2">-</td></tr>
    </table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${rows.length + 2}">정산<br>내역</th><td class="label-dark">항목</td><td class="label-dark">금액</td><td colspan="4" class="label-dark">산출근거</td></tr>
      ${rows.join("")}
      <tr class="pay"><td class="label">지급금액</td><td class="num">${calc.payment==null ? "단가 입력 후 계산" : won(calc.payment)}</td><td class="basis" colspan="4">계 (전력량 요금) − 계 (거래수수료) − 전월 차액 − 전월 미지급액 − 기타정산${calc.penalty ? " − 위약금" : ""}</td></tr>
    </table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="4">정산<br>정보</th>${field("사업자명 (대표자명)", BUYER.bizName.replace(" (", "<br>("))}${field("사업자등록번호", BUYER.bizRegNo)}</tr>
      <tr>${field("주소", BUYER.address.replace(/\n/g, "<br>"), 5)}</tr>
      <tr>${field("담당자", BUYER.manager)}${field("연락처", BUYER.contact.replace(" / ", "<br>"))}</tr>
      <tr>${field("정산서 번호", docNo)}${field("지급기한", "계산서 발행 후 5영업일 내")}</tr>
    </table>
    <table class="doc-table">${DOC_COLS}
      <tr><th class="section" rowspan="${(hasSchedule ? shown.length : 1) + 1}">연간<br>보장<br>공급량</th>
        <td class="label">회차</td><td class="label">예상 공급량</td><td class="label">실적 누계<br>(공급+초과)</td><td class="label">미달 공급량</td><td class="label">미달 구매량</td><td class="label">비고</td></tr>
      ${hasSchedule ? shown.map(r => `<tr><td class="label">${r.k}회차<br><small>${r.label}</small></td><td class="num">${r.expected==null ? "-" : fmt(r.expected) + " kWh"}</td>
        <td class="num">${r.actualCum==null ? "-" : fmt(r.actualCum) + " kWh"}</td><td class="num">-</td><td class="num">-</td><td class="basis">${r.k === curK ? "진행 회차" : ""}</td></tr>`).join("")
        : `<tr><td colspan="6" class="basis">계약 정보(설비용량·계약일자)가 없어 표시할 수 없습니다.</td></tr>`}
    </table>
    ${hasSchedule && years > shown.length ? `<p class="doc-note">총 ${years}회차 중 ${shown.length}회차까지 표시 (전체는 [계약관리 > 계약이행현황])</p>` : ""}
    <div class="doc-date">${todayLabel}</div>
    <div class="doc-signature">
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthLabel} 직접PPA 전력거래대금을 확인합니다.</div><div class="sign-role">발전사업자</div>
        <div class="sign-name">${(m["사업자명(대표자명)"] || plant).split("(")[0].trim()} (인)</div></div>
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthLabel} 직접PPA 전력거래대금을 지급합니다.</div><div class="sign-role">재생에너지전기공급사업자</div>
        <div class="sign-name">${BUYER.bizNameLegal} (인)</div></div>
    </div>
  </div>`;
}
