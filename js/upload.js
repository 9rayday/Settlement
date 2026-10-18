/* ============ Upload (drag & drop + file picker) ============ */
let kpxRowsOrig = [];  // 업로드한 KPX 원본 행 (재계산할 때마다 여기서 다시 시작)
let genSettleNotes = []; // 발전사업자 집계 산정 근거 (사용량 출처 등)

function initUploadZone(){
  bindDropZone("dropZone", "dataFile", routeKpxFile);
  bindDropZone("amiDropZone", "amiFile", file=>{ if(typeof onAmiFile === "function") onAmiFile(file); });
}

// 드래그&드롭 + 클릭 선택 영역. 같은 파일을 다시 골라도 change 가 일어나도록 처리 후 값을 비운다.
function bindDropZone(zoneId, inputId, onFile){
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if(!zone || !input) return;
  input.addEventListener("change", e=>{
    if(e.target.files[0]) onFile(e.target.files[0]);
    e.target.value = "";
  });
  ["dragenter","dragover"].forEach(evt=>{
    zone.addEventListener(evt, e=>{
      e.preventDefault(); e.stopPropagation();
      zone.classList.add("drag-over");
    });
  });
  ["dragleave","drop"].forEach(evt=>{
    zone.addEventListener(evt, e=>{
      e.preventDefault(); e.stopPropagation();
      zone.classList.remove("drag-over");
    });
  });
  zone.addEventListener("drop", e=>{
    const file = e.dataTransfer.files[0];
    if(file) onFile(file);
  });
  zone.addEventListener("click", ()=> input.click());
}

// KPX 직접전력거래량 파일 하나로 발전사업자 정산과 전기사용자 정산을 함께 처리한다.
// 오차정산은 수요기업에만 보내므로, 오차정산 모드에서는 발전사업자 집계·실적 기록을 건드리지 않는다.
function routeKpxFile(file){
  // 발전사업자 정산 페이지에는 오차정산이 없다: 항상 발전사업자 집계를 하고, 전기사용자 쪽은 가정산일 때만 같이 넘긴다
  const onGen = document.getElementById("uploadCard").dataset.ctx === "gen";
  const trueUp = typeof getSettleMode === "function" && getSettleMode() === "trueup";
  if(onGen || !trueUp){
    handleFile(file);
  } else {
    const statusEl = document.getElementById("dataStatus");
    statusEl.style.display = "inline-flex";
    statusEl.textContent = "오차정산";
    statusEl.className = "status warn";
  }
  if(typeof onKpxFile === "function" && !(onGen && trueUp)) onKpxFile(file);
}

function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function pickCol(row, candidates){
  for(const c of candidates){ if(row[c] !== undefined) return c; }
  const keys = Object.keys(row);
  for(const cand of candidates){
    const bare = cand.replace(/\(.*?\)/g,"").trim();
    const found = keys.find(k=> k.replace(/\s/g,"").includes(bare.replace(/\s/g,"")));
    if(found) return found;
  }
  return null;
}

function handleFile(file){
  const statusEl = document.getElementById("dataStatus");
  statusEl.style.display = "inline-flex";
  statusEl.textContent = "읽는 중...";
  statusEl.className = "status warn";
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const wb = XLSX.read(e.target.result, {type:"array"});
      const sheetName = wb.SheetNames[0];
      kpxRowsOrig = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {defval:null});
      rawRows = kpxRowsOrig.map(r => Object.assign({}, r));
      const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null})[0] || [];
      rawHeaders = headerRow.map(h=> h===null||h===undefined ? "" : String(h)).filter(h=>h!=="");
      buildColMap(rawRows);
      aggregate(rawRows);
      showGenStatus();
      if(typeof recCaptureKpxRows === "function") recCaptureKpxRows(kpxRowsOrig); // 초과발전량 REC 데이터 (js/rec.js, 초과전력량 있는 확정 파일만)
      document.getElementById("exportBtn").disabled = false;
      document.getElementById("pdfBtn").disabled = false;
      document.getElementById("exportAllBtn").disabled = false;
      syncPerformanceToGas();
    }catch(err){
      statusEl.textContent = "오류: " + err.message;
      statusEl.className = "status bad";
    }
  };
  reader.readAsArrayBuffer(file);
}

function showGenStatus(){
  const statusEl = document.getElementById("dataStatus");
  statusEl.style.display = "inline-flex";
  statusEl.textContent = `발전소 수 ${plants.length} 처리 완료` + (genSettleNotes.length ? " · " + genSettleNotes.join(" · ") : "");
  statusEl.className = "status ok";
}

// 사용량 파일을 KPX 파일보다 나중에 올려도 발전사업자 집계를 다시 계산한다 (billing.js onAmiFile 에서 호출)
function onAmiForGen(){
  if(!kpxRowsOrig.length) return;
  rawRows = kpxRowsOrig.map(r => Object.assign({}, r));
  aggregate(rawRows);
  showGenStatus();
  syncPerformanceToGas();
}

function pickHeaderIndex(headers, candidates){
  for(const c of candidates){
    const idx = headers.indexOf(c);
    if(idx>=0) return {name:headers[idx], index:idx+1};
  }
  for(const cand of candidates){
    const bare = cand.replace(/\(.*?\)/g,"").trim().replace(/\s/g,"");
    const idx = headers.findIndex(h=> String(h).replace(/\s/g,"").includes(bare));
    if(idx>=0) return {name:headers[idx], index:idx+1};
  }
  return null;
}
function mult(fieldInfo){ return fieldInfo && /MWh/i.test(fieldInfo.name) ? 1000 : 1; }

function buildColMap(rows){
  const r0 = rows[0];
  colIdx = {
    date: pickHeaderIndex(rawHeaders, ["거래일자"]),
    hour: pickHeaderIndex(rawHeaders, ["시간"]),
    plant: pickHeaderIndex(rawHeaders, ["발전기명"]),
    gen: pickHeaderIndex(rawHeaders, ["발전량(MWh)","발전량"]),
    usage: pickHeaderIndex(rawHeaders, ["전기사용량(MWh)","전기사용량"]),
    supply: pickHeaderIndex(rawHeaders, ["재생E공급량(MWh)","재생에너지공급량(MWh)","공급량(MWh)"]),
    excess: pickHeaderIndex(rawHeaders, ["초과전력량(MWh)"]),
    deficit: pickHeaderIndex(rawHeaders, ["부족전력량(MWh)"]),
  };
  colMap = {
    date: pickCol(r0, ["거래일자"]),
    hour: pickCol(r0, ["시간"]),
    genId: pickCol(r0, ["발전기ID"]),
    plant: pickCol(r0, ["발전기명"]),
    appNo: pickCol(r0, ["신청번호"]),
    supplyAppNo: pickCol(r0, ["공급계약신청번호"]),
    consumeAppNo: pickCol(r0, ["소비계약신청번호"]),
    gen: pickCol(r0, ["발전량(MWh)","발전량"]),
    ppaGen: pickCol(r0, ["PPA발전량(MWh)","균등발전량(MWh)"]),
    usage: pickCol(r0, ["전기사용량(MWh)","전기사용량"]),
    loss: pickCol(r0, ["손실량(MWh)"]),
    lossRate: pickCol(r0, ["손실률(%)"]),
    totalLossRate: pickCol(r0, ["종합손실률(%)"]),
    excessDeficit: pickCol(r0, ["초과/부족구분"]),
    excess: pickCol(r0, ["초과전력량(MWh)"]),
    deficit: pickCol(r0, ["부족전력량(MWh)"]),
    supply: pickCol(r0, ["재생E공급량(MWh)","재생에너지공급량(MWh)","공급량(MWh)"]),
    settleYN: pickCol(r0, ["정산여부","정산 여부"]),
    settleMethod: pickCol(r0, ["정산방식"]),
    gridConn: pickCol(r0, ["계통연계여부","계통 연계 여부"]),
    deficitMethod: pickCol(r0, ["부족전력거래방법","부족전력량구매방법"]),
    kepcoNo: pickCol(r0, ["한전고객번호/직접구매자회원사코드"]),
    facilityId: pickCol(r0, ["수전설비ID","수전설비 ID"]),
    supplierId: pickCol(r0, ["공급사업자ID"]),
  };
}

/* 발전사업자 집계: 발전량 = KPX 실측 발전량 합, 공급량·초과발전량·부족전력량은 전기사용자 정산과 같은 시간별 산정(settleGroup, billing.js)
 * 계산한 시간별 값을 원본 행(재생E공급량·초과전력량·전기사용량·부족전력량)에도 써 넣어 엑셀/PDF 내보내기와 맞춘다.
 * 신청번호가 없는 행만 KPX 파일 값을 그대로 쓴다.
 */
const dateKeyOf = v => { const d = String(v == null ? "" : v).replace(/[^0-9]/g, ""); return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`; };
function aggregate(rows){
  aggByPlant = {}; plants = [];
  siteTotals = {usage:0, generation:0, supply:0, excess:0, deficit:0, lossRatePct:null};
  settleMonth = ""; genSettleNotes = [];
  const raw = {}; // 신청번호 없는 행용 KPX 값
  const rowIdx = {};
  rows.forEach(r=>{
    const rawPlant = colMap.plant ? r[colMap.plant] : null;
    const plant = rawPlant!=null ? String(rawPlant).trim() : null;
    if(!plant) return;
    if(!aggByPlant[plant]){ aggByPlant[plant] = {generation:0, supply:0, excess:0}; plants.push(plant); raw[plant] = {supply:0, excess:0}; }
    const gen = num(r[colMap.gen])*1000;
    aggByPlant[plant].generation += gen; siteTotals.generation += gen;
    raw[plant].supply += num(r[colMap.supply])*1000; raw[plant].excess += num(r[colMap.excess])*1000;
    const app = colMap.appNo ? String(r[colMap.appNo] || "").trim() : "";
    const k = [app, plant, dateKeyOf(r[colMap.date]), Math.round(num(r[colMap.hour]))].join("|");
    (rowIdx[k] || (rowIdx[k] = [])).push(r);
    if(!settleMonth && r[colMap.date]){
      const d = String(r[colMap.date]).replace(/[^0-9]/g,"");
      if(d.length>=6) settleMonth = d.slice(0,6);
    }
    // 전력손실률은 원본 데이터의 "종합손실률(%)" 컬럼값을 그대로 쓴다
    if(siteTotals.lossRatePct===null && colMap.totalLossRate && r[colMap.totalLossRate]!=null && r[colMap.totalLossRate]!==""){
      siteTotals.lossRatePct = num(r[colMap.totalLossRate]) / 100;
    }
  });

  const parsed = Parsers.parseKpxRows(rows);
  const apps = Object.keys(parsed.groups);
  // 사용량 파일(한 수요가 것)은 그룹이 하나일 때만 적용, 여럿이면 KPX 전기사용량 사용
  const ami = (typeof billState !== "undefined" && billState.ami && apps.length === 1) ? billState.ami : null;
  if(typeof billState !== "undefined" && billState.ami && apps.length > 1) genSettleNotes.push("그룹이 여러 개라 사용량 파일 대신 KPX 전기사용량 사용");
  const put = (r, col, info, kwh) => { if(col) r[col] = Engine.round(kwh / mult(info), 6); };
  const covered = new Set(), sources = new Set();
  apps.forEach(app=>{
    const g = parsed.groups[app];
    const R = settleGroup(g, ami, ratesFor(g.month).rates, (d, h, m)=>{
      const deficit = Math.max(0, m.deficitSimple + m.deficitLoss); // = U − S×(1−L)
      Object.keys(m.supply).forEach(p=>{
        (rowIdx[[app, p, d.date, h].join("|")] || []).forEach(r=>{
          put(r, colMap.supply, colIdx.supply, m.supply[p]);
          put(r, colMap.excess, colIdx.excess, m.excess[p]);
          put(r, colMap.usage, colIdx.usage, m.usage);
          put(r, colMap.deficit, colIdx.deficit, deficit);
        });
      });
    });
    const M = R.match;
    Object.keys(M.supplyByPlant).forEach(p=>{
      if(!aggByPlant[p]) return;
      aggByPlant[p].supply += M.supplyByPlant[p]; aggByPlant[p].excess += M.excessByPlant[p]; covered.add(p);
    });
    siteTotals.usage += M.totals.usage;
    siteTotals.deficit += Math.max(0, M.totals.deficitSimple + M.totals.deficitLoss);
    sources.add(R.usage.source);
    if(R.monthly && !g.hasPpa) genSettleNotes.push(`${app} 월간균등 정산 (발전량 월 균등 환산)`);
  });
  plants.filter(p => !covered.has(p)).forEach(p=>{ aggByPlant[p].supply = raw[p].supply; aggByPlant[p].excess = raw[p].excess; });
  plants.forEach(p=>{ siteTotals.supply += aggByPlant[p].supply; siteTotals.excess += aggByPlant[p].excess; });
  if(sources.has("none")) genSettleNotes.push("사용량 정보가 없어 사용량 = 발전량으로 계산(가정산, 초과 0)");
  if(sources.has("ami")) genSettleNotes.push("사용량 파일 기준 공급량 계산");

  if(settleMonth && typeof setHeaderMonth === "function") setHeaderMonth(settleMonth); // 헤더 정산월을 업로드한 달로
  renderSiteKpis();
  renderAggTable();
  refreshPlantSelect();
}

function renderSiteKpis(){
  const el = document.getElementById("siteKpis");
  el.style.display = "grid";
  const lossRate = siteTotals.lossRatePct!=null ? siteTotals.lossRatePct
    : (siteTotals.usage ? ((siteTotals.usage - siteTotals.supply) / siteTotals.usage) : 0);
  const kpis = [
    ["총 전기사용량 (kWh)", Math.round(siteTotals.usage).toLocaleString()],
    ["총 발전량 (kWh)", Math.round(siteTotals.generation).toLocaleString()],
    ["총 공급량 (kWh)", Math.round(siteTotals.supply).toLocaleString()],
    ["총 초과발전량 (kWh)", Math.round(siteTotals.excess).toLocaleString()],
    ["총 부족전력량 (kWh)", Math.round(siteTotals.deficit).toLocaleString()],
    ["전력손실률", (lossRate*100).toFixed(2)+"%"],
  ];
  el.innerHTML = kpis.map(([l,v])=>`<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
}

function renderAggTable(){
  document.getElementById("aggCard").style.display = "block";
  const t = document.getElementById("aggTable");
  let html = "<tr><th>발전소명</th><th>발전량(kWh)</th><th>공급량(kWh)</th><th>초과발전량(kWh)</th></tr>";
  plants.forEach(p=>{
    const a = aggByPlant[p];
    html += `<tr><td>${p}</td><td style="text-align:right;">${Math.round(a.generation).toLocaleString()}</td><td style="text-align:right;">${Math.round(a.supply).toLocaleString()}</td><td style="text-align:right;">${Math.round(a.excess).toLocaleString()}</td></tr>`;
  });
  t.innerHTML = html;
}

function refreshPlantSelect(){
  const sels = document.querySelectorAll(".plant-select");
  const optionsHtml = plants.map(p=>`<option value="${p}">${p}</option>`).join("");
  sels.forEach(sel=>{ sel.innerHTML = optionsHtml; });
  onPlantSelectionChanged();
}

async function syncPerformanceToGas(){
  if(!plants.length || !settleMonth) return;
  const rows = plants.map(p=> ({ plant: p, generation: aggByPlant[p].generation, supply: aggByPlant[p].supply, excess: aggByPlant[p].excess }));
  await logPerformance(settleMonth, rows);
  if(typeof refreshPerformance === "function") await refreshPerformance(); // 계약이행현황·위약금 갱신
  renderInvoicePreview();
  saveGenPay(); // 정산 대시보드용 발전사업자 전력대금 (js/invoice.js)
}
