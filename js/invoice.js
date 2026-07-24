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
  if(!selectedPlant || !settleMonth){
    renderPlantAdjustTab();
    renderInvoicePreview();
    return;
  }
  adjustmentsByPlant[selectedPlant] = await fetchAdjustments(settleMonth, selectedPlant);
  renderPlantAdjustTab();
  renderInvoicePreview();
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
  const payment = subtotal1!=null
    ? subtotal1 - subtotal2 - (Number(adj.전월차액)||0) - (Number(adj.전월미지급액)||0) - (Number(adj.기타정산)||0)
    : null;
  return { unitPrice, feeRate, supply, energyFee, supplyValue, vat1, subtotal1, fee, vat2, subtotal2, adj, payment };
}

/* ============ Tab 2: 발전소별 확인/조정 ============ */
function renderPlantAdjustTab(){
  const host = document.getElementById("plantAdjustHost");
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
  if(!selectedPlant || !aggByPlant[selectedPlant]){ host.style.display="none"; return; }
  host.style.display = "block";
  host.innerHTML = await buildInvoiceHtml(selectedPlant);
}

async function buildInvoiceHtml(plant){
  const a = aggByPlant[plant];
  const m = masterData[plant] || {};
  const calc = calcInvoice(plant);
  const fmt = n => n==null ? "-" : Math.round(n).toLocaleString();
  const fmtK = n => n==null ? "-" : Math.round(n).toLocaleString()+' kWh';
  const fmt2 = n => n==null ? "-" : n.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2});
  const monthLabel = settleMonth ? `${settleMonth.slice(0,4)}년 ${settleMonth.slice(4,6)}월` : "-";
  const lossRate = siteTotals.lossRatePct!=null ? siteTotals.lossRatePct
    : (siteTotals.usage ? (siteTotals.usage - siteTotals.supply)/siteTotals.usage : 0);
  const grid = await fetchYearlyGrid(plant);
  const schedule = buildGuaranteeSchedule(plant, grid);
  const today = new Date();
  const todayLabel = `${today.getFullYear()}년 ${String(today.getMonth()+1).padStart(2,"0")}월 ${String(today.getDate()).padStart(2,"0")}일`;
  const field = (label,val,editable)=> `<td class="label">${label}</td><td colspan="2"${editable?' class="editable"':''}>${val}</td>`;
  const COLGROUP = `<colgroup><col><col><col><col><col><col><col></colgroup>`;

  return `
  <div class="doc">
    <div class="doc-header"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo"></div>
    <h1 class="title">직접PPA 전력거래대금 정산서</h1>
    <div class="month">(${monthLabel} 거래분)</div>
    <table class="doc-table">
      ${COLGROUP}
      <tr><th class="section" rowspan="3">발전사업자<br>정보</th>
        ${field("사업자명 (대표자명)", m["사업자명(대표자명)"] || "입력 예정", !m["사업자명(대표자명)"])}
        ${field("사업자등록번호", m["사업자등록번호"] || "입력 예정", !m["사업자등록번호"])}</tr>
      <tr>${field("사업자 주소", m["사업자주소"] || "입력 예정", !m["사업자주소"])}
        ${field("계좌번호", m["계좌번호"] || "입력 예정", !m["계좌번호"])}</tr>
      <tr><td class="label">발전소명</td><td colspan="2">${plant}</td>
        ${field("연락처", [m["담당자"], m["연락처"]].filter(Boolean).join(" / ") || "입력 예정", !(m["담당자"]||m["연락처"]))}</tr>
    </table>
    <table class="doc-table">
      ${COLGROUP}
      <tr><th class="section" rowspan="5">전력<br>거래내역</th>
        <td class="label">총 전기사용량</td><td class="num" colspan="2">${fmtK(siteTotals.usage)}</td>
        <td class="label">총 발전량</td><td class="num" colspan="2">${fmtK(siteTotals.generation)}</td></tr>
      <tr><td class="label">전력손실률</td><td class="num" colspan="2">${(lossRate*100).toFixed(2)}%</td>
        <td class="label">총 공급량</td><td class="num" colspan="2">${fmtK(siteTotals.supply)}</td></tr>
      <tr><td class="label">총 초과발전량</td><td class="num" colspan="2">${fmtK(siteTotals.excess)}</td>
        <td class="label">총 부족전력량</td><td class="num" colspan="2">${fmtK(siteTotals.deficit)}</td></tr>
      <tr><td class="label hl-top hl-left">해당 발전소 발전량</td><td class="num hl-top" colspan="2">${fmtK(a.generation)}</td>
        <td class="label hl-top">해당 발전소 공급량</td><td class="num hl-top hl-right" colspan="2">${fmtK(a.supply)}</td></tr>
      <tr><td class="label hl-bottom hl-left">해당 발전소 초과발전량</td><td class="num hl-bottom" colspan="2">${fmtK(a.excess)}</td>
        <td class="label hl-bottom">-</td><td class="num hl-bottom hl-right" colspan="2">-</td></tr>
    </table>
    <table class="doc-table">
      ${COLGROUP}
      <tr><th class="section" rowspan="12">정산<br>내역</th><td class="label-dark">항목</td><td class="label-dark">금액</td><td colspan="4" class="label-dark">산출 근거</td></tr>
      <tr><td class="label">전력량 요금</td><td class="num${calc.energyFee==null?' editable':''}">${calc.energyFee==null? '단가 입력 필요' : fmt(calc.energyFee)+' 원'}</td>
        <td class="basis">( =</td><td class="basis">${fmt(a.supply)} kWh</td><td class="basis">x</td><td class="basis">${calc.unitPrice==null?'-':calc.unitPrice+' 원/KWh)'}</td></tr>
      <tr><td class="label">공급가액</td><td class="num">${fmt(calc.supplyValue)} 원</td><td></td><td></td><td></td><td></td></tr>
      <tr><td class="label">부가가치세</td><td class="num">${fmt(calc.vat1)} 원</td>
        <td class="basis">( =</td><td class="basis">${fmt(calc.supplyValue)} 원</td><td class="basis">x</td><td class="basis">10.00% )</td></tr>
      <tr class="total"><td class="label">계</td><td class="num">${fmt(calc.subtotal1)} 원</td><td></td><td></td><td></td><td></td></tr>
      <tr><td class="label">거래수수료</td><td class="num">${fmt(calc.fee)} 원</td>
        <td class="basis">( =</td><td class="basis">${fmt(a.supply)} kWh</td><td class="basis">x</td><td class="basis">${calc.feeRate} 원/KWh)</td></tr>
      <tr><td class="label">부가가치세</td><td class="num">${fmt(calc.vat2)} 원</td>
        <td class="basis">( =</td><td class="basis">${fmt(calc.fee)} 원</td><td class="basis">x</td><td class="basis">10.00% )</td></tr>
      <tr class="total"><td class="label">계</td><td class="num">${fmt(calc.subtotal2)} 원</td><td></td><td></td><td></td><td></td></tr>
      <tr><td class="label">전월 차액</td><td class="num">${fmt(calc.adj.전월차액)} 원</td>
        <td class="basis">( =</td><td class="basis">${fmt(calc.adj.전월차액)} 원</td><td class="basis">-</td><td class="basis">0 원)</td></tr>
      <tr><td class="label">전월 미지급액</td><td class="num">${fmt(calc.adj.전월미지급액)} 원</td>
        <td class="basis">( =</td><td class="basis">${fmt(calc.adj.전월미지급액)} 원</td><td class="basis">-</td><td class="basis">0 원)</td></tr>
      <tr><td class="label">기타정산</td><td class="num">${fmt(calc.adj.기타정산)} 원</td><td></td><td></td><td></td><td></td></tr>
      <tr class="pay"><td class="label">지급금액</td><td class="num" colspan="5">${calc.payment==null?'단가 입력 후 계산됩니다':fmt(calc.payment)+' 원'}</td></tr>
    </table>
    <table class="doc-table">
      ${COLGROUP}
      <tr><th class="section" rowspan="4">정산<br>정보</th>
        <td class="label">사업자명 (대표자명)</td><td colspan="2">${BUYER.bizName}</td>
        <td class="label">사업자등록번호</td><td colspan="2">${BUYER.bizRegNo}</td></tr>
      <tr><td class="label">주소</td><td colspan="5">${BUYER.address.replace(/\n/g,'<br>')}</td></tr>
      <tr><td class="label">담당자</td><td colspan="2">${BUYER.manager}</td>
        <td class="label">연락처</td><td colspan="2">${BUYER.contact}</td></tr>
      <tr><td class="label">정산서번호</td><td colspan="2">${BUYER.invoicePrefix}-${settleMonth}-0001</td>
        <td class="label">납부기한</td><td colspan="2">계산서 발행 후 5영업일 내</td></tr>
    </table>
    <table class="doc-table guarantee-table">
      ${COLGROUP}
      <tr><th class="section" rowspan="${schedule.length+1}">연간<br>보장<br>공급량</th>
        <td class="label">회차</td><td class="label">예상 공급량</td><td class="label">실제 공급량 누계</td><td class="label">미달 공급량</td><td class="label">미달 구매량</td><td class="label">비고</td></tr>
      ${schedule.map(row=>`
      <tr><td class="label">${row.k}회차<br>${row.label}</td>
        <td class="num">${row.expected==null?'-':fmt2(row.expected)+' kWh'}</td>
        <td class="num">${row.actualCum==null?'-':fmt2(row.actualCum)+' kWh'}</td>
        <td class="num">-</td><td class="num">-</td><td></td></tr>`).join("")}
    </table>
    <div class="doc-date">${todayLabel}</div>
    <div class="doc-signature">
      <div class="sign-block">
        <div class="sign-label">위와 같이 ${monthLabel} 직접PPA 전력거래대금을 확인합니다.</div>
        <div class="sign-role">발전사업자</div>
        <div class="sign-name">${(m["사업자명(대표자명)"] || plant).split("(")[0].trim()} (인)</div>
      </div>
      <div class="sign-block">
        <div class="sign-label">위와 같이 ${monthLabel} 직접PPA 전력거래대금을 지급합니다.</div>
        <div class="sign-role">재생에너지전기공급사업자</div>
        <div class="sign-name">한화신한테라와트아워 주식회사 (인)</div>
      </div>
    </div>
  </div>`;
}
