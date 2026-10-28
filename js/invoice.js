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
  const label = `${settleMonth.slice(0,4)}.${settleMonth.slice(4)} 계산 완료`;
  try{
    // 금액은 이 브라우저에서 바로 계산 → 결과·정산서를 먼저 보여 주고, 시트 저장은 뒤에서
    genCalcDone = true;
    mergeLocalPerf(); // 이번 달 실적을 계약이행현황·연간보장공급량에 바로 반영
    renderGenResult(); renderInvoicePreview();
    ["exportBtn","pdfBtn","exportAllBtn"].forEach(id => { document.getElementById(id).disabled = false; });
    document.getElementById("genPick").style.display = "flex";
    st.textContent = label + " · 시트 저장 중...";
    await syncPerformanceToGas(); // 월별실적로그·실적그리드 기록, 계약이행현황 갱신, 발전대금 저장(genpay)
    st.textContent = label + " · 저장됨";
    if (typeof Drive !== "undefined") Drive.saveGen(settleMonth, plants.filter(p => calcInvoice(p)).map(plant => ({ plant, snap: typeof arcGenSnap === "function" ? arcGenSnap(plant, settleMonth) : null }))); // 구글 드라이브 자동 저장
  }catch(e){ st.textContent = "오류: " + e.message; }
  btn.disabled = false;
}
// 이번 달 업로드 실적을 화면 실적(perfState)에 넣는다 (서버 실적과 같은 규칙: 실적 = max(발전량, 공급량))
function mergeLocalPerf(){
  if(typeof perfState === "undefined" || !perfState.loaded) return;
  const mine = new Set(plants);
  perfState.rows = (perfState.rows || []).filter(r => !(r.month === settleMonth && mine.has(r.plant)))
    .concat(plants.map(p => { const a = aggByPlant[p], total = Math.max(a.generation || 0, a.supply || 0);
      return { month: settleMonth, plant: p, supply: Math.min(a.supply || 0, total), generation: total }; }));
}
function renderGenResult(){
  const host = document.getElementById("genResult"); if(!host) return;
  const f = n => n==null ? "-" : Math.round(n).toLocaleString();
  const rows = plants.map(p => ({ p, c: calcInvoice(p) })).filter(x => x.c);
  const sum = k => rows.reduce((t, x) => t + (Number(x.c[k]) || 0), 0);
  host.innerHTML = `<div class="table-wrap" style="margin-top:12px"><table class="grid gen-result">
    <tr><th>발전소</th><th>공급량 (kWh)</th><th>계약단가</th><th>전력량요금 (VAT 포함)</th><th>거래수수료 (VAT 포함)</th><th>위약금</th><th>지급액</th></tr>
    ${rows.map(({p, c}) => `<tr data-p="${p}"><td><a href="#" class="gen-open" data-p="${p}">${p}</a></td><td class="num">${f(c.supply)}</td><td class="num">${c.unitPrice!=null ? c.unitPrice : !masterData[p] ? '<span class="tag bad" title="계약관리 > 발전사업자에 이 발전기명(KPX와 동일)으로 등록된 발전소가 없습니다">발전소 미등록</span>' : '<span class="tag bad" title="발전소는 등록되어 있지만 계약단가 칸이 비어 있습니다">단가 빈칸</span>'}</td>
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
  const adj = adjustmentsByPlant[plant] || {전월차액:0,전월미지급액:0,기타정산:0};
  // 계약 위약금 (연간보장공급량 미달, 처리 방식 "청구서 차감") — js/performance.js
  const pen = (typeof penaltyDue === "function" && settleMonth) ? penaltyDue("gen", plant, settleMonth) : {amount:0, label:""};
  return genCalcParts({ supply: a.supply, unitPrice, feeRate, adj, penalty: pen.amount, penaltyLabel: pen.label });
}
// 발전사업자 정산 금액 (정산서 보관함에서 수정할 때도 같은 계산)
function genCalcParts({ supply, unitPrice, feeRate, adj, penalty, penaltyLabel }){
  adj = adj || {전월차액:0,전월미지급액:0,기타정산:0}; penalty = Number(penalty) || 0;
  const energyFee = unitPrice!=null ? Math.round(supply*unitPrice) : null;
  const supplyValue = energyFee;
  const vat1 = supplyValue!=null ? Math.round(supplyValue*0.1) : null;
  const subtotal1 = supplyValue!=null ? supplyValue+vat1 : null;
  const fee = Math.round(supply*feeRate);
  const vat2 = Math.round(fee*0.1);
  const subtotal2 = fee+vat2;
  const payment = subtotal1!=null
    ? subtotal1 - subtotal2 - (Number(adj.전월차액)||0) - (Number(adj.전월미지급액)||0) - (Number(adj.기타정산)||0) - penalty
    : null;
  return { unitPrice, feeRate, supply, energyFee, supplyValue, vat1, subtotal1, fee, vat2, subtotal2, adj, payment, penalty, penaltyLabel: penaltyLabel || "" };
}

/* ============ 정산서 번호: <접두>-<정산월>-<그룹 신청번호>-<그룹 안 일련번호 2자리> ============
 * 예) 300025-202609-26-PR00001-01. 그룹(소비계약신청번호, 없으면 "미지정")마다 01부터, 그 달 발전소 순서대로 매긴다.
 * 한 번 발전대금 계산(genpay 저장)한 발전소는 번호가 고정되고, 나중에 추가된 발전소는 그 그룹 마지막 번호 다음을 받는다.
 */
function genDocNo(plant){
  const grp = p => (typeof Registry !== "undefined" && Registry.plantGroup(masterData[p] || {})) || "미지정";
  const g = grp(plant), head = `${BUYER.invoicePrefix}-${settleMonth}-${g}-`;
  const fmt = n => head + String(n).padStart(2, "0");
  const old = (typeof Store !== "undefined" && settleMonth && (Store.get(`genpay:${settleMonth}`, null) || {}).plants) || {};
  const kept = p => old[p] && old[p].docNo && String(old[p].docNo).indexOf(`${BUYER.invoicePrefix}-${settleMonth}-${grp(p)}-`) === 0; // 예전 형식 번호는 무시
  if(kept(plant)) return old[plant].docNo;
  let next = Object.keys(old).reduce((mx, p) => kept(p) && grp(p) === g ? Math.max(mx, Number(String(old[p].docNo).split("-").pop()) || 0) : mx, 0);
  for(const p of plants){ if(grp(p) !== g || kept(p)) continue; next++; if(p === plant) return fmt(next); }
  return fmt(next + 1);
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
    out[p] = { docNo: genDocNo(p), generation: a.generation, supply: c.supply, excess: a.excess, unitPrice: c.unitPrice, energyFee: c.energyFee, vat1: c.vat1, subtotal1: c.subtotal1,
      fee: c.fee, subtotal2: c.subtotal2, adj: c.adj, penalty: c.penalty, payment: c.payment, appNo: Registry.plantGroup(masterData[p]),
      feeRate: c.feeRate, supplyValue: c.supplyValue, vat2: c.vat2, penaltyLabel: c.penaltyLabel, docDate: todayYmd() };
  });
  await Store.set(key, { plants: Object.assign({}, old.plants, out), site: Object.assign({}, siteTotals), savedAt: new Date().toISOString() });
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

// 미리보기 = PDF(js/exporters/pdf.js drawInvoicePdf)와 같은 배치 · 같은 값 서식. 한쪽을 바꾸면 다른 쪽도 같이 고친다.
// snap: { month, agg, site, calc, docNo, docDate } — 정산서 보관함에서 저장된 값으로 다시 그릴 때
async function buildInvoiceHtml(plant, snap){
  const a = snap ? snap.agg : aggByPlant[plant];
  const m = masterData[plant] || {};
  const calc = snap ? snap.calc : calcInvoice(plant), adj = calc.adj || {};
  const site = snap ? snap.site : siteTotals, month = snap ? snap.month : settleMonth;
  const won = pdfFmtWon, kwh = pdfFmtKwh;
  const lossRate = site.lossRatePct!=null ? site.lossRatePct
    : (site.usage ? (site.usage - site.supply)/site.usage : 0);
  const schedule = buildGuaranteeSchedule(plant, await fetchYearlyGrid(plant));
  const monthPlain = month ? `${month.slice(0,4)}년 ${month.slice(4,6)}월` : "";
  const t = snap && snap.docDate ? new Date(snap.docDate + "T00:00:00") : new Date();
  const todayLabel = `${t.getFullYear()}년 ${String(t.getMonth()+1).padStart(2,"0")}월 ${String(t.getDate()).padStart(2,"0")}일`;
  const todo = "입력 예정";
  const td = (v, o) => { o = o || {}; return `<td${o.span ? ` colspan="${o.span}"` : ""}${o.cls ? ` class="${o.cls}"` : ""}>${v == null ? "" : v}</td>`; };
  const lab = v => td(v, { cls: "label" });
  const val = (v, span) => td(v || todo, { span: span || 2, cls: v ? "" : "editable" });
  const sec = (n, text) => `<th class="section" rowspan="${n}">${text}</th>`;
  const COLS = `<colgroup>${"<col>".repeat(7)}</colgroup>`;
  const contact = [m["담당자"], m["연락처"]].filter(Boolean).join(" / ");
  // 정산내역 산출근거: ( = | a | 연산 | b
  const basis = (x, op, y) => td("( =") + td(x) + td(op) + td(y);
  const b4 = () => td("") + td("") + td("") + td("");
  const item = (l, amt, rest, bold) => `<tr${bold ? ' class="total"' : ""}>${td(l)}${td(amt, { cls: "num" })}${rest}</tr>`;
  const rows = [
    item("전력량 요금", won(calc.energyFee), basis(kwh(calc.supply), "x", pdfFmtUnitPrice(calc.unitPrice))),
    item("공급가액", won(calc.supplyValue), b4()),
    item("부가가치세", won(calc.vat1), basis(won(calc.supplyValue), "x", "10.00%")),
    item("계", won(calc.subtotal1), b4(), true),
    item("거래수수료", won(calc.fee), basis(kwh(calc.supply), "x", pdfFmtFeeRate(calc.feeRate))),
    item("부가가치세", won(calc.vat2), basis(won(calc.fee), "x", "10.00%")),
    item("계", won(calc.subtotal2), b4(), true),
    item("전월 차액", won(adj.전월차액), basis(won(adj.전월차액), "-", won(0))),
    item("전월 미지급액", won(adj.전월미지급액), basis(won(adj.전월미지급액), "-", won(0))),
    item(calc.penalty ? "기타정산·위약금" : "기타정산", won((Number(adj.기타정산)||0) + (calc.penalty||0)), b4())
  ];
  return `
  <div class="doc bill gen">
    <div class="doc-header bill-head"><img src="assets/logo.jpg" alt="한화 신한 테라와트아워" class="doc-logo">
      <div class="bill-title"><h1 class="title">직접PPA 전력거래대금 정산서</h1><div class="month">(${monthPlain} 거래분)</div></div><div></div></div>
    <table class="doc-table">${COLS}
      <tr>${sec(3, "발전사업자<br>정보")}${lab("사업자명 (대표자명)")}${val(m["사업자명(대표자명)"])}${lab("사업자등록번호")}${val(m["사업자등록번호"])}</tr>
      <tr>${lab("사업자 주소")}${val(m["사업자주소"])}${lab("계좌번호")}${val(m["계좌번호"])}</tr>
      <tr>${lab("발전소명")}${val(plant)}${lab("연락처")}${val(contact)}</tr>
    </table>
    <table class="doc-table">${COLS}
      <tr>${sec(5, "전력<br>거래<br>내역")}${lab("총 전기사용량")}${val(kwh(site.usage))}${lab("총 발전량")}${val(kwh(site.generation))}</tr>
      <tr>${lab("전력손실률")}${val(pdfFmtPercent2(lossRate))}${lab("총 공급량")}${val(kwh(site.supply))}</tr>
      <tr>${lab("총 초과발전량")}${val(kwh(site.excess))}${lab("총 부족전력량")}${val(kwh(site.deficit))}</tr>
      <tr class="red-top">${lab("해당 발전소 발전량")}${val(kwh(a.generation))}${lab("해당 발전소 공급량")}${val(kwh(a.supply))}</tr>
      <tr class="red-bottom">${lab("해당 발전소 초과발전량")}${val(kwh(a.excess))}${lab("-")}${val("-")}</tr>
    </table>
    <table class="doc-table">${COLS}
      <tr>${sec(rows.length + 2, "정산<br>내역")}${td("항목", { cls: "label-dark" })}${td("금액", { cls: "label-dark" })}${td("산출 근거", { span: 4, cls: "label-dark" })}</tr>
      ${rows.join("")}
      <tr class="pay">${td("지급금액")}${td(won(calc.payment), { cls: "num" })}${td("", { span: 4 })}</tr>
    </table>
    <table class="doc-table">${COLS}
      <tr>${sec(4, "정산<br>정보")}${lab("사업자명 (대표자명)")}${val(BUYER.bizName)}${lab("사업자등록번호")}${val(BUYER.bizRegNo)}</tr>
      <tr>${lab("주소")}${val(BUYER.address.replace(/\n/g, "<br>"), 5)}</tr>
      <tr>${lab("담당자")}${val(BUYER.manager)}${lab("연락처")}${val(BUYER.contact)}</tr>
      <tr>${lab("정산서번호")}${val(snap ? snap.docNo || "-" : genDocNo(plant))}${lab("납부기한")}${val("계산서 발행 후 5영업일 내")}</tr>
    </table>
    <table class="doc-table">${COLS}
      <tr>${sec(schedule.length + 1, "연간<br>보장<br>공급량")}${lab("회차")}${lab("예상 공급량")}${lab("실적 누계 (공급+초과)")}${lab("미달 공급량")}${lab("미달 구매량")}${lab("비고")}</tr>
      ${schedule.map(r => `<tr>${td(`${r.k}회차 ${r.label}`, { cls: "nw" })}${td(r.expected != null ? kwh(r.expected) : "-", { cls: "num" })}${td(r.actualCum != null ? kwh(r.actualCum) : "-", { cls: "num" })}${td("-")}${td("-")}${td("")}</tr>`).join("")}
    </table>
    <div class="doc-date">${todayLabel}</div>
    <div class="doc-signature">
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthPlain} 직접PPA 전력거래대금을 확인합니다.</div><div class="sign-role">발전사업자</div>
        <div class="sign-name">${(m["사업자명(대표자명)"] || plant).split("(")[0].trim()} (인)</div></div>
      <div class="sign-block"><div class="sign-label">위와 같이 ${monthPlain} 직접PPA 전력거래대금을 지급합니다.</div><div class="sign-role">재생에너지전기공급사업자</div>
        <div class="sign-name">${BUYER.bizNameLegal} (인)</div></div>
    </div>
  </div>`;
}
