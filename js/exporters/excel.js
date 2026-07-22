/* ============ Style constants (css/style.css 팔레트와 동일) ============ */
const XCOLOR = {
  navy:'FF4A4A4A', navy2:'FF4A4A4A', dark:'FF595959', label:'FFECECEC', editable:'FFFFFDF4',
  total:'FFFFF6E9', border:'FFC6CCD6', white:'FFFFFFFF', red:'FFC00000'
};
const XTHIN = { style:'thin', color:{argb:XCOLOR.border} };
const XBORDER = { top:XTHIN, left:XTHIN, bottom:XTHIN, right:XTHIN };

function xStyle(ws, r1, c1, r2, c2, opts={}){
  for(let r=r1;r<=r2;r++){
    for(let c=c1;c<=c2;c++){
      const cell = ws.getCell(r,c);
      cell.border = XBORDER;
      if(opts.bg) cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:opts.bg}};
      cell.font = Object.assign({size:10, name:"맑은 고딕"}, opts.font);
      cell.alignment = Object.assign({horizontal:'center', vertical:'middle', wrapText:true}, opts.align);
      if(opts.numFmt) cell.numFmt = opts.numFmt;
    }
  }
}
function xSection(ws, r1, r2, text){
  xStyle(ws, r1, 2, r2, 2, { bg:XCOLOR.dark, font:{bold:true, color:{argb:XCOLOR.white}}, align:{horizontal:'center'} });
  ws.getCell(r1,2).value = text;
  if(r2>r1) ws.mergeCells(r1,2,r2,2);
}
function xLabel(ws, r, c, text){
  ws.getCell(r,c).value = text;
  xStyle(ws, r, c, r, c, { bg:XCOLOR.label, font:{bold:true, color:{argb:XCOLOR.navy2}}, align:{horizontal:'center'} });
}
function xValue(ws, r, c, value, opts={}){
  if(value!==undefined && value!==null && value!=="") ws.getCell(r,c).value = value;
  xStyle(ws, r, c, r, c, Object.assign({ align:{horizontal:'center'} }, opts));
}
function xFormula(ws, r, c, formula, opts={}){
  ws.getCell(r,c).value = { formula: String(formula).replace(/^=/, "") };
  xStyle(ws, r, c, r, c, Object.assign({ align:{horizontal:'center'} }, opts));
}

/* ============ 원본 데이터 시트용 저수준 헬퍼 (시간대별 발전량 DB / 세부 사항) ============ */
function colName(n){ let s=""; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
function setV(ws,r,c,value){
  if(value===null||value===undefined||value===""){ return; }
  ws.getCell(r,c).value = value;
}
function setF(ws,r,c,formula){
  ws.getCell(r,c).value = { formula: String(formula).replace(/^=/, "") };
}

/* ============ Sheet 3: 시간대별 발전량 DB(확정) ============ */
function buildRawSheet(ws, rows){
  const nCols = rawHeaders.length;
  const dateColLetterSrc = colName(colIdx.date.index);
  const dateOutCol = nCols+1;

  rawHeaders.forEach((h,i)=> setV(ws,1,i+1,h));
  setV(ws,1,dateOutCol, "날짜 변환(자동계산)");
  ws.getRow(1).font = { bold:true, size:10 };

  rows.forEach((r,idx)=>{
    const rn = idx+2;
    rawHeaders.forEach((h,i)=>{
      const v = r[h];
      setV(ws, rn, i+1, (typeof v === "number") ? v : (v===null||v===undefined ? "" : v));
    });
    setF(ws, rn, dateOutCol, `=DATE(LEFT(${dateColLetterSrc}${rn},4),MID(${dateColLetterSrc}${rn},5,2),RIGHT(${dateColLetterSrc}${rn},2))`);
  });

  rawHeaders.concat(["날짜 변환"]).forEach((_,i)=> ws.getColumn(i+1).width = 14);
  ws.getColumn(dateOutCol).numFmt = "yyyy-mm-dd";
  [colIdx.gen, colIdx.usage, colIdx.supply, colIdx.excess, colIdx.deficit].forEach(f=>{
    if(f) ws.getColumn(f.index).numFmt = "#,##0.0";
  });
}

/* ============ Sheet 2: 직접전력거래 세부 사항(확정) ============ */
const DETAIL_SHEET = "직접전력거래 세부 사항(확정)";
const RAW_SHEET = "시간대별 발전량 DB(확정)";
const INVOICE_SHEET = "고지서 양식";

function buildDetailSheet(ws, plantList){
  const n = plantList.length;

  const rawDateCol = colName(rawHeaders.length+1);
  const rawHourCol = colName(colIdx.hour.index);
  const rawPlantCol = colName(colIdx.plant.index);
  const rawGenCol = colName(colIdx.gen.index);       const genMult = mult(colIdx.gen);
  const rawUsageCol = colName(colIdx.usage.index);   const usageMult = mult(colIdx.usage);
  const rawSupplyCol = colName(colIdx.supply.index); const supplyMult = mult(colIdx.supply);
  const rawExcessCol = colName(colIdx.excess.index); const excessMult = mult(colIdx.excess);
  const rawDeficitCol = colName(colIdx.deficit.index); const deficitMult = mult(colIdx.deficit);
  const supplyTotalRow = 7+n;
  const excessTotalRow = 8+2*n;
  const deficitRow = 9+3*n;
  const dayBlockStart = 10+3*n;
  const blockSize = 5+3*n;
  const numDays = 31;
  const lastRow = dayBlockStart + numDays*blockSize - 1;
  const HOUR_COLS = []; for(let c=4;c<=27;c++) HOUR_COLS.push(c);

  setF(ws,1,1, `='${INVOICE_SHEET}'!B3`);
  setV(ws,3,1,"날짜"); setV(ws,3,2,"항목"); setV(ws,3,28,"계"); setV(ws,3,29,"비고");

  setV(ws,4,4,1);
  for(let i=1;i<HOUR_COLS.length;i++){ const c=HOUR_COLS[i]; setF(ws,4,c, `=${colName(c-1)}4+1`); }

  setF(ws,5,1, `=LEFT(A1,4)&"년 "&RIGHT(A1,2)&"월 계"`);
  setV(ws,5,2,"전기사용량");
  HOUR_COLS.forEach(c=> setF(ws,5,c, `=SUMIFS(${colName(c)}$${dayBlockStart}:${colName(c)}$${lastRow},$B$${dayBlockStart}:$B$${lastRow},$B5)`));
  setF(ws,5,28, "=SUM(D5:AA5)");

  setV(ws,6,2,"발전량"); setV(ws,6,3,"계");
  HOUR_COLS.forEach(c=> setF(ws,6,c, `=SUM(${colName(c)}7:${colName(c)}${6+n})`));
  setF(ws,6,28, `=SUM(D6:AA6)`);
  plantList.forEach((p,i)=>{
    const r = 7+i;
    setV(ws,r,2,"발전량"); setV(ws,r,3,p);
    HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS(${colName(c)}$${dayBlockStart}:${colName(c)}$${lastRow},$B$${dayBlockStart}:$B$${lastRow},$B${r},$C$${dayBlockStart}:$C$${lastRow},$C${r})`));
    setF(ws,r,28, `=SUM(D${r}:AA${r})`);
  });

  setV(ws,supplyTotalRow,2,"공급량"); setV(ws,supplyTotalRow,3,"계");
  HOUR_COLS.forEach(c=> setF(ws,supplyTotalRow,c, `=SUM(${colName(c)}${supplyTotalRow+1}:${colName(c)}${supplyTotalRow+n})`));
  setF(ws,supplyTotalRow,28, `=SUM(D${supplyTotalRow}:AA${supplyTotalRow})`);
  plantList.forEach((p,i)=>{
    const r = supplyTotalRow+1+i;
    setV(ws,r,2,"공급량"); setV(ws,r,3,p);
    HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS(${colName(c)}$${dayBlockStart}:${colName(c)}$${lastRow},$B$${dayBlockStart}:$B$${lastRow},$B${r},$C$${dayBlockStart}:$C$${lastRow},$C${r})`));
    setF(ws,r,28, `=SUM(D${r}:AA${r})`);
  });

  setV(ws,excessTotalRow,2,"초과발전량"); setV(ws,excessTotalRow,3,"계");
  HOUR_COLS.forEach(c=> setF(ws,excessTotalRow,c, `=SUM(${colName(c)}${excessTotalRow+1}:${colName(c)}${excessTotalRow+n})`));
  setF(ws,excessTotalRow,28, `=SUM(D${excessTotalRow}:AA${excessTotalRow})`);
  plantList.forEach((p,i)=>{
    const r = excessTotalRow+1+i;
    setV(ws,r,2,"초과발전량"); setV(ws,r,3,p);
    HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS(${colName(c)}$${dayBlockStart}:${colName(c)}$${lastRow},$B$${dayBlockStart}:$B$${lastRow},$B${r},$C$${dayBlockStart}:$C$${lastRow},$C${r})`));
    setF(ws,r,28, `=SUM(D${r}:AA${r})`);
  });

  setV(ws,deficitRow,2,"부족전력량");
  HOUR_COLS.forEach(c=> setF(ws,deficitRow,c, `=SUMIFS(${colName(c)}$${dayBlockStart}:${colName(c)}$${lastRow},$B$${dayBlockStart}:$B$${lastRow},$B${deficitRow})`));
  setF(ws,deficitRow,28, `=SUM(D${deficitRow}:AA${deficitRow})`);

  let prevBlockStart = null;
  for(let d=1; d<=numDays; d++){
    const blockStart = dayBlockStart + (d-1)*blockSize;
    if(d===1){ setF(ws, blockStart, 1, `=DATE(LEFT(A1,4),RIGHT(A1,2),1)`); }
    else{ setF(ws, blockStart, 1, `=IF(A${prevBlockStart}<EOMONTH(A${prevBlockStart},0),A${prevBlockStart}+1,"-")`); }
    ws.getCell(blockStart,1).numFmt = "yyyy-mm-dd";
    setV(ws, blockStart, 2, "전기사용량");
    HOUR_COLS.forEach(c=> setF(ws, blockStart, c, `=IFERROR(AVERAGEIFS('${RAW_SHEET}'!$${rawUsageCol}:$${rawUsageCol},'${RAW_SHEET}'!$${rawDateCol}:$${rawDateCol},$A${blockStart},'${RAW_SHEET}'!$${rawHourCol}:$${rawHourCol},${colName(c)}$4-1)*${usageMult},0)`));
    setF(ws, blockStart, 28, `=SUM(D${blockStart}:AA${blockStart})`);

    const genRow = blockStart+1;
    setV(ws, genRow, 2, "발전량"); setV(ws, genRow, 3, "계");
    HOUR_COLS.forEach(c=> setF(ws, genRow, c, `=SUM(${colName(c)}${genRow+1}:${colName(c)}${genRow+n})`));
    setF(ws, genRow, 28, `=SUM(D${genRow}:AA${genRow})`);
    plantList.forEach((p,i)=>{
      const r = genRow+1+i;
      setV(ws,r,2,"발전량"); setV(ws,r,3,p);
      HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS('${RAW_SHEET}'!$${rawGenCol}:$${rawGenCol},'${RAW_SHEET}'!$${rawDateCol}:$${rawDateCol},$A${blockStart},'${RAW_SHEET}'!$${rawPlantCol}:$${rawPlantCol},$C${r},'${RAW_SHEET}'!$${rawHourCol}:$${rawHourCol},${colName(c)}$4-1)*${genMult}`));
      setF(ws,r,28, `=SUM(D${r}:AA${r})`);
    });

    const supRow = genRow+1+n;
    setV(ws, supRow, 2, "공급량"); setV(ws, supRow, 3, "계");
    HOUR_COLS.forEach(c=> setF(ws, supRow, c, `=SUM(${colName(c)}${supRow+1}:${colName(c)}${supRow+n})`));
    setF(ws, supRow, 28, `=SUM(D${supRow}:AA${supRow})`);
    plantList.forEach((p,i)=>{
      const r = supRow+1+i;
      setV(ws,r,2,"공급량"); setV(ws,r,3,p);
      HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS('${RAW_SHEET}'!$${rawSupplyCol}:$${rawSupplyCol},'${RAW_SHEET}'!$${rawDateCol}:$${rawDateCol},$A${blockStart},'${RAW_SHEET}'!$${rawPlantCol}:$${rawPlantCol},$C${r},'${RAW_SHEET}'!$${rawHourCol}:$${rawHourCol},${colName(c)}$4-1)*${supplyMult}`));
      setF(ws,r,28, `=SUM(D${r}:AA${r})`);
    });

    const excRow = supRow+1+n;
    setV(ws, excRow, 2, "초과발전량"); setV(ws, excRow, 3, "계");
    HOUR_COLS.forEach(c=> setF(ws, excRow, c, `=SUM(${colName(c)}${excRow+1}:${colName(c)}${excRow+n})`));
    setF(ws, excRow, 28, `=SUM(D${excRow}:AA${excRow})`);
    plantList.forEach((p,i)=>{
      const r = excRow+1+i;
      setV(ws,r,2,"초과발전량"); setV(ws,r,3,p);
      HOUR_COLS.forEach(c=> setF(ws,r,c, `=SUMIFS('${RAW_SHEET}'!$${rawExcessCol}:$${rawExcessCol},'${RAW_SHEET}'!$${rawDateCol}:$${rawDateCol},$A${blockStart},'${RAW_SHEET}'!$${rawPlantCol}:$${rawPlantCol},$C${r},'${RAW_SHEET}'!$${rawHourCol}:$${rawHourCol},${colName(c)}$4-1)*${excessMult}`));
      setF(ws,r,28, `=SUM(D${r}:AA${r})`);
    });

    const defRow = excRow+1+n;
    setV(ws, defRow, 2, "부족전력량");
    HOUR_COLS.forEach(c=> setF(ws, defRow, c, `=IFERROR(AVERAGEIFS('${RAW_SHEET}'!$${rawDeficitCol}:$${rawDeficitCol},'${RAW_SHEET}'!$${rawDateCol}:$${rawDateCol},$A${blockStart},'${RAW_SHEET}'!$${rawHourCol}:$${rawHourCol},${colName(c)}$4-1)*${deficitMult},0)`));
    setF(ws, defRow, 28, `=SUM(D${defRow}:AA${defRow})`);

    prevBlockStart = blockStart;
  }

  ws.getColumn(1).width = 14; ws.getColumn(2).width = 12; ws.getColumn(3).width = 22;
  for(let c=4;c<=28;c++) ws.getColumn(c).numFmt = "#,##0.0";

  return {meta:{supplyTotalRow, excessTotalRow, deficitRow, n}};
}

/* ============ Logo (fetch once, reuse) ============ */
let _logoBufferPromise = null;
function loadLogoBuffer(){
  if(!_logoBufferPromise){
    _logoBufferPromise = fetch("assets/logo.jpg").then(r=> r.arrayBuffer()).catch(()=> null);
  }
  return _logoBufferPromise;
}

/* ============ Sheet 1: 고지서 양식 (발전사업자 1인분, PDF와 동일한 디자인) ============ */
async function buildInvoiceSheet(workbook, ws, plant, meta, history){
  const {n} = meta;
  const genRange = [7, 6+n];
  const supRange = [8+n, 7+2*n];
  const excRange = [9+2*n, 8+3*n];
  const m = masterData[plant] || {};
  const calc = calcInvoice(plant);
  const schedule = buildGuaranteeSchedule(plant, history);

  // test.xlsx 원본("고지서 양식" 탭)을 직접 열어 실측한 값 그대로 적용.
  ws.getColumn(1).width = 1.58203125;
  for(let c=2;c<=8;c++) ws.getColumn(c).width = 23.08203125;
  ws.getColumn(9).width = 1.58203125;
  ws.getColumn(10).width = 3.4; // J: 회차 순번 (인쇄 영역 밖)
  for(let c=11;c<=22;c++) ws.getColumn(c).width = 9; // K~V: 회차별 월간 실적 (인쇄 영역 밖)

  const GAP_ROW_HEIGHT = 9.9;
  const CONTENT_ROW_HEIGHT = 34;
  const TALL_ROW_HEIGHT = 46; // 2줄 이상 줄바꿈되는 행(주소/연락처/서명 문구)
  const GAP_ROWS = new Set([8,14,27,32,54,59]);
  const TALL_ROWS = new Set([6,7,29,56,57,58]);
  ws.getRow(1).height = 10;
  for(let r=2;r<=59;r++){
    ws.getRow(r).height = GAP_ROWS.has(r) ? GAP_ROW_HEIGHT : (TALL_ROWS.has(r) ? TALL_ROW_HEIGHT : CONTENT_ROW_HEIGHT);
  }

  // 로고: 원본 파일의 drawing1.xml 앵커(B열 2행, 약 2.2in x 0.39in)와 동일하게 배치.
  const logoBuf = await loadLogoBuffer();
  if(logoBuf){
    const imgId = workbook.addImage({ buffer: logoBuf, extension: "jpeg" });
    ws.addImage(imgId, { tl:{col:1.1, row:1.3}, ext:{width:212, height:38} });
  }

  ws.mergeCells(2,2,2,8);
  ws.getCell(2,2).value = "직접PPA 전력거래대금 정산서";
  ws.getCell(2,2).font = { bold:true, size:16, color:{argb:XCOLOR.navy} };
  ws.getCell(2,2).alignment = { horizontal:'center', vertical:'middle' };

  // B3: 원본처럼 YYYYMM 원시 숫자값을 저장(세부 사항 시트가 그대로 참조)하되,
  // 커스텀 표시형식으로 "2026년 06월 거래분"처럼 보이게 한다.
  ws.mergeCells(3,2,3,8);
  setV(ws,3,2, Number(settleMonth) || settleMonth);
  ws.getCell(3,2).numFmt = '0000"년 "00"월 거래분"';
  ws.getCell(3,2).font = { italic:true, size:13, color:{argb:'FF5B6675'} };
  ws.getCell(3,2).alignment = { horizontal:'center' };

  // 병합 후 앵커 셀만 스타일링하면 나머지 칸의 테두리가 비어보이므로, 범위 전체에 테두리를 먼저 깔아둔다.
  const merge2 = (r,c1,c2)=>{ xStyle(ws,r,c1,r,c2,{}); ws.mergeCells(r,c1,r,c2); };

  xSection(ws,5,7,"발전사업자\n정보");
  xLabel(ws,5,3,"사업자명 (대표자명)"); merge2(5,4,5); xValue(ws,5,4, m["사업자명(대표자명)"] || "입력 예정", {bg: m["사업자명(대표자명)"]?undefined:XCOLOR.editable});
  xLabel(ws,5,6,"사업자등록번호"); merge2(5,7,8); xValue(ws,5,7, m["사업자등록번호"] || "입력 예정", {bg: m["사업자등록번호"]?undefined:XCOLOR.editable});
  xLabel(ws,6,3,"사업자 주소"); merge2(6,4,5); xValue(ws,6,4, m["사업자주소"] || "입력 예정", {bg: m["사업자주소"]?undefined:XCOLOR.editable});
  xLabel(ws,6,6,"계좌번호"); merge2(6,7,8); xValue(ws,6,7, m["계좌번호"] || "입력 예정", {bg: m["계좌번호"]?undefined:XCOLOR.editable});
  xLabel(ws,7,3,"발전소명"); merge2(7,4,5); xValue(ws,7,4, plant);
  const contact = [m["담당자"], m["연락처"]].filter(Boolean).join(" / ");
  xLabel(ws,7,6,"연락처"); merge2(7,7,8); xValue(ws,7,7, contact || "입력 예정", {bg: contact?undefined:XCOLOR.editable});

  xSection(ws,9,13,"전력\n거래\n내역");
  xLabel(ws,9,3,"총 전기사용량"); merge2(9,4,5);   ws.getCell(9,4).value = { formula: `'${DETAIL_SHEET}'!AB5` }; xStyle(ws,9,4,9,4,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,9,6,"총 발전량"); merge2(9,7,8);       ws.getCell(9,7).value = { formula: `'${DETAIL_SHEET}'!AB6` }; xStyle(ws,9,7,9,7,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,10,3,"전력손실률"); merge2(10,4,5);     ws.getCell(10,4).value = { formula: `IFERROR((D9-G10)/D9,0)` }; xStyle(ws,10,4,10,4,{numFmt:"0.00%", align:{horizontal:'center'}});
  xLabel(ws,10,6,"총 공급량"); merge2(10,7,8);      ws.getCell(10,7).value = { formula: `'${DETAIL_SHEET}'!AB${7+n}` }; xStyle(ws,10,7,10,7,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,11,3,"총 초과발전량"); merge2(11,4,5);  ws.getCell(11,4).value = { formula: `'${DETAIL_SHEET}'!AB${8+2*n}` }; xStyle(ws,11,4,11,4,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,11,6,"총 부족전력량"); merge2(11,7,8);  ws.getCell(11,7).value = { formula: `'${DETAIL_SHEET}'!AB${9+3*n}` }; xStyle(ws,11,7,11,7,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,12,3,"해당 발전소 발전량"); merge2(12,4,5); ws.getCell(12,4).value = { formula: `SUMIF('${DETAIL_SHEET}'!C${genRange[0]}:C${genRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${genRange[0]}:AB${genRange[1]})` }; xStyle(ws,12,4,12,4,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,12,6,"해당 발전소 공급량"); merge2(12,7,8); ws.getCell(12,7).value = { formula: `SUMIF('${DETAIL_SHEET}'!C${supRange[0]}:C${supRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${supRange[0]}:AB${supRange[1]})` }; xStyle(ws,12,7,12,7,{numFmt:'#,##0.00" kWh"'});
  xLabel(ws,13,3,"해당 발전소 초과발전량"); merge2(13,4,5); ws.getCell(13,4).value = { formula: `SUMIF('${DETAIL_SHEET}'!C${excRange[0]}:C${excRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${excRange[0]}:AB${excRange[1]})` }; xStyle(ws,13,4,13,4,{numFmt:'#,##0.00" kWh"'});
  merge2(13,7,8); xValue(ws,13,6,"-"); xValue(ws,13,7,"-");

  xSection(ws,15,26,"정산\n내역");
  merge2(15,5,8);
  [[15,3,"항목"],[15,4,"금액"],[15,5,"산출 근거"]].forEach(([r,c,t])=> xValue(ws,r,c,t,{bg:XCOLOR.dark, font:{bold:true, color:{argb:XCOLOR.white}}}));

  const moneyFmt = { numFmt:'#,##0" 원"', align:{horizontal:'center'} };
  const basisCell = (r,c)=> xStyle(ws,r,c,r,c,{align:{horizontal:'center'}});
  // "( = / [값] / x / [단가·요율]" 4칸 산출근거 구조 — test.xlsx와 동일, 단위는 표시형식으로 붙인다
  xValue(ws,16,3,"전력량 요금"); xValue(ws,16,4, calc.energyFee ?? 0, moneyFmt);
  xValue(ws,16,5,"( ="); basisCell(16,5); ws.getCell(16,6).value = { formula: "G12" }; xStyle(ws,16,6,16,6,{numFmt:'#,##0.00" kWh"'}); xValue(ws,16,7,"x"); basisCell(16,7); xValue(ws,16,8, calc.unitPrice ?? 0, {numFmt:'0.0" 원/KWh"'});
  xValue(ws,17,3,"공급가액"); xValue(ws,17,4, calc.supplyValue ?? 0, moneyFmt);
  xValue(ws,18,3,"부가가치세"); xValue(ws,18,4, calc.vat1 ?? 0, moneyFmt);
  xValue(ws,18,5,"( ="); basisCell(18,5); ws.getCell(18,6).value = { formula: "D17" }; xStyle(ws,18,6,18,6,{numFmt:'#,##0" 원"'}); xValue(ws,18,7,"x"); basisCell(18,7); xValue(ws,18,8, 0.1, {numFmt:"0.00%"});
  xValue(ws,19,3,"계"); xValue(ws,19,4, calc.subtotal1 ?? 0, moneyFmt);
  xValue(ws,20,3,"거래수수료"); xValue(ws,20,4, calc.fee, moneyFmt);
  xValue(ws,20,5,"( ="); basisCell(20,5); ws.getCell(20,6).value = { formula: "F16" }; xStyle(ws,20,6,20,6,{numFmt:'#,##0.00" kWh"'}); xValue(ws,20,7,"x"); basisCell(20,7); xValue(ws,20,8, calc.feeRate, {numFmt:'0.0000" 원/KWh"'});
  xValue(ws,21,3,"부가가치세"); xValue(ws,21,4, calc.vat2, moneyFmt);
  xValue(ws,21,5,"( ="); basisCell(21,5); ws.getCell(21,6).value = { formula: "D20" }; xStyle(ws,21,6,21,6,{numFmt:'#,##0" 원"'}); xValue(ws,21,7,"x"); basisCell(21,7); xValue(ws,21,8, 0.1, {numFmt:"0.00%"});
  xValue(ws,22,3,"계"); xValue(ws,22,4, calc.subtotal2, moneyFmt);
  xValue(ws,23,3,"전월 차액"); xValue(ws,23,4, calc.adj.전월차액||0, moneyFmt);
  xValue(ws,23,5,"( ="); basisCell(23,5); xValue(ws,23,6, 0, {numFmt:'#,##0" 원"'}); xValue(ws,23,7,"-"); basisCell(23,7); xValue(ws,23,8, 0, {numFmt:'#,##0" 원"'});
  xValue(ws,24,3,"전월 미지급액"); xValue(ws,24,4, calc.adj.전월미지급액||0, moneyFmt);
  xValue(ws,24,5,"( ="); basisCell(24,5); xValue(ws,24,6, 0, {numFmt:'#,##0" 원"'}); xValue(ws,24,7,"-"); basisCell(24,7); xValue(ws,24,8, 0, {numFmt:'#,##0" 원"'});
  xValue(ws,25,3,"기타정산"); xValue(ws,25,4, calc.adj.기타정산||0, moneyFmt);
  xValue(ws,26,3,"지급금액"); xValue(ws,26,4, calc.payment ?? 0, moneyFmt);
  [17,19,22].forEach(r=> xStyle(ws,r,3,r,4,{font:{bold:true}}));
  xStyle(ws,26,3,26,8,{font:{bold:true, size:11}});
  ws.mergeCells(26,5,26,8);

  xSection(ws,28,31,"정산\n정보");
  xLabel(ws,28,3,"사업자명 (대표자명)"); merge2(28,4,5); xValue(ws,28,4, BUYER.bizName);
  xLabel(ws,28,6,"사업자등록번호"); merge2(28,7,8); xValue(ws,28,7, BUYER.bizRegNo);
  xLabel(ws,29,3,"주소"); merge2(29,4,8); xValue(ws,29,4, BUYER.address);
  xLabel(ws,30,3,"담당자"); merge2(30,4,5); xValue(ws,30,4, BUYER.manager);
  xLabel(ws,30,6,"연락처"); merge2(30,7,8); xValue(ws,30,7, BUYER.contact);
  xLabel(ws,31,3,"정산서번호"); merge2(31,4,5); xValue(ws,31,4, `${BUYER.invoicePrefix}-${settleMonth}-0001`);
  xLabel(ws,31,6,"납부기한"); merge2(31,7,8); xValue(ws,31,7,"계산서 발행 후 5영업일 내");
  // K31: 계약용량(kW) 백업값 — test.xlsx 원본과 동일한 위치.
  ws.getCell(31,11).value = Number(m["계약용량"]) || 0;

  xSection(ws,33,33+schedule.length,"연간\n보장\n공급량");
  xLabel(ws,33,3,"회차"); xLabel(ws,33,4,"예상 공급량"); xLabel(ws,33,5,"실제 공급량 누계"); xLabel(ws,33,6,"미달 공급량"); xLabel(ws,33,7,"미달 구매량"); xLabel(ws,33,8,"비고");
  ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"].forEach((mn,i)=> xLabel(ws,33,11+i,mn));

  const guaranteeHours = Number(m["발전보장시간"]) || DEFAULT_GUARANTEE_HOURS;
  schedule.forEach((row,i)=>{
    const r = 34+i;
    const first = i===0;
    xValue(ws,r,3, row.k+"회차 "+row.label);
    if(row.expected==null){
      xValue(ws,r,4,"-");
    } else if(first){
      ws.getCell(r,4).value = { formula: `K31*${guaranteeHours}*365` };
      xStyle(ws,r,4,r,4,{numFmt:'#,##0.00" kWh"'});
    } else {
      ws.getCell(r,4).value = { formula: `$D$34-($D$34*0.5%*(J${r}-1))` };
      xStyle(ws,r,4,r,4,{numFmt:'#,##0.00" kWh"'});
    }
    ws.getCell(r,5).value = { formula: `SUM(K${r}:V${r})` };
    xStyle(ws,r,5,r,5,{numFmt:'#,##0.00" kWh"'});
    xValue(ws,r,6,"-"); xValue(ws,r,7,"-");
    xStyle(ws,r,8,r,8,{});
    if(first){ xValue(ws,r,10, 1); } else { ws.getCell(r,10).value = { formula: `J${r-1}+1` }; xStyle(ws,r,10,r,10,{}); }
    (row.monthly||[]).forEach((v,mi)=>{
      xValue(ws,r,11+mi, v!=null ? v : "", {numFmt: v!=null ? "#,##0.00" : undefined});
    });
  });

  const monthPlain = settleMonth ? `${settleMonth.slice(0,4)}년 ${settleMonth.slice(4,6)}월` : "";
  const today = new Date();
  const todayLabel = `${today.getFullYear()}년 ${String(today.getMonth()+1).padStart(2,"0")}월 ${String(today.getDate()).padStart(2,"0")}일`;
  // 발전사업자명에서 "(대표자명)" 괄호 부분은 서명란에서 제외 — test.xlsx의 LEFT(D5,FIND("(",D5)-2) 로직과 동일
  const bizNameOnly = (m["사업자명(대표자명)"] || plant).split("(")[0].trim();

  ws.mergeCells(55,2,55,8);
  xValue(ws,55,2, todayLabel, { align:{horizontal:'center'}, font:{bold:true, size:14} });

  merge2(56,2,4); xValue(ws,56,2, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 확인합니다.`, { align:{horizontal:'center'}, font:{size:11} });
  merge2(56,6,8); xValue(ws,56,6, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 지급합니다.`, { align:{horizontal:'center'}, font:{size:11} });

  ws.mergeCells(57,2,57,4); ws.mergeCells(57,6,57,8);
  xValue(ws,57,2, "발전사업자", { align:{horizontal:'center'}, font:{bold:true, size:12} });
  xValue(ws,57,6, "재생에너지전기공급사업자", { align:{horizontal:'center'}, font:{bold:true, size:12} });
  ws.mergeCells(58,2,58,4); ws.mergeCells(58,6,58,8);
  xValue(ws,58,2, `${bizNameOnly} (인)`, { align:{horizontal:'center'}, font:{bold:true, size:16} });
  xValue(ws,58,6, "한화신한테라와트아워 주식회사 (인)", { align:{horizontal:'center'}, font:{bold:true, size:16} });

  // 좌/우 서명 블록 사이 점선 구분선 (56~58행 구간만)
  for(let r=56;r<=58;r++){ ws.getCell(r,5).border = { right:{style:'dotted', color:{argb:XCOLOR.navy2}} }; }
  // 55~58행은 표 테두리 없이 깔끔하게 — 구분선 열(E)을 제외한 나머지 테두리 제거
  for(let r=55;r<=58;r++){
    for(let c=2;c<=8;c++){
      if(r>=56 && c===5) continue; // 점선 구분선(56~58행, E열)은 유지
      ws.getCell(r,c).border = {};
    }
  }

  // 12~13행("해당 발전소 ~") 빨간 테두리 강조
  const RED = {style:'medium', color:{argb:XCOLOR.red}};
  for(let c=3;c<=8;c++){
    ws.getCell(12,c).border = Object.assign({}, ws.getCell(12,c).border, {top:RED});
    ws.getCell(13,c).border = Object.assign({}, ws.getCell(13,c).border, {bottom:RED});
  }
  for(let r=12;r<=13;r++){
    ws.getCell(r,3).border = Object.assign({}, ws.getCell(r,3).border, {left:RED});
    ws.getCell(r,8).border = Object.assign({}, ws.getCell(r,8).border, {right:RED});
  }

  ws.pageSetup = {
    paperSize:9, orientation:'portrait',
    fitToPage:true, fitToWidth:1, fitToHeight:1,
    printArea:"A1:I59",
    margins: { left:0.35, right:0.35, top:0.35, bottom:0.35, header:0.15, footer:0.15 },
    horizontalCentered:true, verticalCentered:true
  };

  // A4 인쇄 영역(A1:I59) 바깥 테두리를 굵게 둘러 페이지 경계를 표시한다.
  const THICK = {style:'thick', color:{argb:XCOLOR.navy}};
  for(let c=1;c<=9;c++){
    ws.getCell(1,c).border = Object.assign({}, ws.getCell(1,c).border, {top:THICK});
    ws.getCell(59,c).border = Object.assign({}, ws.getCell(59,c).border, {bottom:THICK});
  }
  for(let r=1;r<=59;r++){
    ws.getCell(r,1).border = Object.assign({}, ws.getCell(r,1).border, {left:THICK});
    ws.getCell(r,9).border = Object.assign({}, ws.getCell(r,9).border, {right:THICK});
  }
}

/* ============ Workbook assembly (per plant) ============ */
async function buildWorkbookForPlant(plant){
  const history = await fetchPerformanceHistory(plant);
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;

  const invoiceWs = workbook.addWorksheet(INVOICE_SHEET);
  const detailWs = workbook.addWorksheet(DETAIL_SHEET);
  const rawWs = workbook.addWorksheet(RAW_SHEET);

  const {meta} = buildDetailSheet(detailWs, plants);
  await buildInvoiceSheet(workbook, invoiceWs, plant, meta, history);
  buildRawSheet(rawWs, rawRows);

  return workbook;
}

async function exportSinglePlantExcel(){
  if(!plants.length || !selectedPlant){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const btn = document.getElementById("exportBtn");
  btn.disabled = true;
  try{
    const workbook = await buildWorkbookForPlant(selectedPlant);
    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer], {type:"application/octet-stream"}), `직접PPA_정산서_${selectedPlant}_${settleMonth || "정산"}.xlsx`);
  } finally {
    btn.disabled = false;
  }
}
