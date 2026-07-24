/* ============ Upload (drag & drop + file picker) ============ */
function initUploadZone(){
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("dataFile");

  fileInput.addEventListener("change", e=>{
    if(e.target.files[0]) handleFile(e.target.files[0]);
  });

  ["dragenter","dragover"].forEach(evt=>{
    dropZone.addEventListener(evt, e=>{
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave","drop"].forEach(evt=>{
    dropZone.addEventListener(evt, e=>{
      e.preventDefault(); e.stopPropagation();
      dropZone.classList.remove("drag-over");
    });
  });
  dropZone.addEventListener("drop", e=>{
    const file = e.dataTransfer.files[0];
    if(file) handleFile(file);
  });
  dropZone.addEventListener("click", ()=> fileInput.click());
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
      rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {defval:null});
      const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null})[0] || [];
      rawHeaders = headerRow.map(h=> h===null||h===undefined ? "" : String(h)).filter(h=>h!=="");
      buildColMap(rawRows);
      aggregate(rawRows);
      statusEl.textContent = `발전소 수 ${plants.length} 처리 완료`;
      statusEl.className = "status ok";
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

function aggregate(rows){
  aggByPlant = {}; plants = [];
  const seenTs = new Set();
  siteTotals = {usage:0, generation:0, supply:0, excess:0, deficit:0, lossRatePct:null};
  settleMonth = "";

  rows.forEach(r=>{
    const rawPlant = colMap.plant ? r[colMap.plant] : null;
    const plant = rawPlant!=null ? String(rawPlant).trim() : null;
    if(!plant) return;
    if(!aggByPlant[plant]){ aggByPlant[plant] = {generation:0, supply:0, excess:0}; plants.push(plant); }
    const gen = num(r[colMap.gen])*1000, sup = num(r[colMap.supply])*1000, exc = num(r[colMap.excess])*1000;
    aggByPlant[plant].generation += gen;
    aggByPlant[plant].supply += sup;
    aggByPlant[plant].excess += exc;
    siteTotals.generation += gen; siteTotals.supply += sup; siteTotals.excess += exc;

    const tsKey = [r[colMap.date], r[colMap.hour], colMap.consumeAppNo ? r[colMap.consumeAppNo] : ""].join("|");
    if(!seenTs.has(tsKey)){
      seenTs.add(tsKey);
      siteTotals.usage += num(r[colMap.usage])*1000;
      siteTotals.deficit += num(r[colMap.deficit])*1000;
    }
    if(!settleMonth && r[colMap.date]){
      const d = String(r[colMap.date]).replace(/[^0-9]/g,"");
      if(d.length>=6) settleMonth = d.slice(0,6);
    }
    // 전력손실률은 계산하지 않고 원본 데이터의 "종합손실률(%)" 컬럼값을 그대로 쓴다(사이트 전체 대비
    // 계산식은 발전소별 공급량이 작아 항상 90%대로 나와 실제 의미와 달랐다).
    if(siteTotals.lossRatePct===null && colMap.totalLossRate && r[colMap.totalLossRate]!=null && r[colMap.totalLossRate]!==""){
      siteTotals.lossRatePct = num(r[colMap.totalLossRate]) / 100;
    }
  });

  document.getElementById("monthBadge").textContent = settleMonth ? `정산월 ${settleMonth.slice(0,4)}.${settleMonth.slice(4,6)}` : "정산월 미설정";
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
  renderInvoicePreview();
}
