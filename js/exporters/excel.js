/* ============ Excel column helpers ============ */
function colName(n){ let s=""; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
function setV(ws,r,c,value){
  const addr = colName(c)+r;
  if(value===null||value===undefined||value===""){ return; }
  if(typeof value === "number") ws[addr] = {t:"n", v:value};
  else ws[addr] = {t:"s", v:String(value)};
}
function setF(ws,r,c,formula){ ws[colName(c)+r] = {t:"n", f:formula}; }

/* ============ Sheet 3: 시간대별 발전량 DB(확정) ============ */
function buildRawSheet(rows){
  const ws = {};
  const nCols = rawHeaders.length;
  const dateColLetterSrc = colName(colIdx.date.index);
  const dateOutCol = nCols+1;

  rawHeaders.forEach((h,i)=> setV(ws,1,i+1,h));
  setV(ws,1,dateOutCol, "날짜 변환(자동계산)");

  rows.forEach((r,idx)=>{
    const rn = idx+2;
    rawHeaders.forEach((h,i)=>{
      const v = r[h];
      setV(ws, rn, i+1, (typeof v === "number") ? v : (v===null||v===undefined ? "" : v));
    });
    setF(ws, rn, dateOutCol, `=DATE(LEFT(${dateColLetterSrc}${rn},4),MID(${dateColLetterSrc}${rn},5,2),RIGHT(${dateColLetterSrc}${rn},2))`);
  });

  ws["!ref"] = `A1:${colName(dateOutCol)}${rows.length+1}`;
  ws["!cols"] = rawHeaders.concat(["날짜 변환"]).map(()=>({wch:14}));
  return ws;
}

/* ============ Sheet 2: 직접전력거래 세부 사항(확정) ============ */
const DETAIL_SHEET = "직접전력거래 세부 사항(확정)";
const RAW_SHEET = "시간대별 발전량 DB(확정)";
const INVOICE_SHEET = "고지서 양식";

function buildDetailSheet(plantList){
  const ws = {};
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

  ws["!ref"] = `A1:AC${lastRow}`;
  ws["!cols"] = [{wch:14},{wch:12},{wch:22}];
  return {ws, meta:{supplyTotalRow, excessTotalRow, deficitRow, n}};
}

/* ============ Sheet 1: 고지서 양식 (발전사업자 1인분) ============ */
function buildInvoiceSheet(plant, meta, history){
  const ws = {};
  const {n} = meta;
  const genRange = [7, 6+n];
  const supRange = [8+n, 7+2*n];
  const excRange = [9+2*n, 8+3*n];
  const m = masterData[plant] || {};
  const calc = calcInvoice(plant);
  const schedule = buildGuaranteeSchedule(plant, history);

  setV(ws,2,2,"직접PPA 전력거래대금 정산서");
  setV(ws,3,2, Number(settleMonth) || settleMonth);

  setV(ws,5,2,"발전사업자\n정보");
  setV(ws,5,3,"사업자명 (대표자명)"); setV(ws,5,4, m["사업자명(대표자명)"] || "");
  setV(ws,5,6,"사업자등록번호"); setV(ws,5,7, m["사업자등록번호"] || "");
  setV(ws,6,3,"사업자 주소"); setV(ws,6,4, m["사업자주소"] || "");
  setV(ws,6,6,"계좌번호"); setV(ws,6,7, m["계좌번호"] || "");
  setV(ws,7,3,"발전소명"); setV(ws,7,4, plant);
  setV(ws,7,6,"연락처"); setV(ws,7,7, m["연락처"] || "");

  setV(ws,9,2,"전력\n거래\n내역");
  setV(ws,9,3,"총 전기사용량");  setF(ws,9,4, `='${DETAIL_SHEET}'!AB5`);
  setV(ws,9,6,"총 발전량");      setF(ws,9,7, `='${DETAIL_SHEET}'!AB6`);
  setV(ws,10,3,"전력손실률");     setF(ws,10,4, `=IFERROR((D9-G10)/D9,0)`);
  setV(ws,10,6,"총 공급량");      setF(ws,10,7, `='${DETAIL_SHEET}'!AB${7+n}`);
  setV(ws,11,3,"총 초과발전량");  setF(ws,11,4, `='${DETAIL_SHEET}'!AB${8+2*n}`);
  setV(ws,11,6,"총 부족전력량");  setF(ws,11,7, `='${DETAIL_SHEET}'!AB${9+3*n}`);
  setV(ws,12,3,"해당 발전소 발전량"); setF(ws,12,4, `=SUMIF('${DETAIL_SHEET}'!C${genRange[0]}:C${genRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${genRange[0]}:AB${genRange[1]})`);
  setV(ws,12,6,"해당 발전소 공급량"); setF(ws,12,7, `=SUMIF('${DETAIL_SHEET}'!C${supRange[0]}:C${supRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${supRange[0]}:AB${supRange[1]})`);
  setV(ws,13,3,"해당 발전소 초과발전량"); setF(ws,13,4, `=SUMIF('${DETAIL_SHEET}'!C${excRange[0]}:C${excRange[1]},'${INVOICE_SHEET}'!D7,'${DETAIL_SHEET}'!AB${excRange[0]}:AB${excRange[1]})`);
  setV(ws,13,6,"-"); setV(ws,13,7,"-");

  setV(ws,15,2,"정산\n내역"); setV(ws,15,4,"금액"); setV(ws,15,5,"산출 근거");
  setV(ws,16,3,"전력량 요금"); setV(ws,16,4, calc.energyFee ?? 0);
  setV(ws,16,5,"( ="); setF(ws,16,6,"=G12"); setV(ws,16,7,"x"); setV(ws,16,8, calc.unitPrice ?? 0);
  setV(ws,17,3,"공급가액"); setV(ws,17,4, calc.supplyValue ?? 0);
  setV(ws,18,3,"부가가치세"); setV(ws,18,4, calc.vat1 ?? 0);
  setV(ws,18,5,"( ="); setF(ws,18,6,"=D17"); setV(ws,18,7,"x"); setV(ws,18,8,0.1);
  setV(ws,19,3,"계"); setV(ws,19,4, calc.subtotal1 ?? 0);
  setV(ws,20,3,"거래수수료"); setV(ws,20,4, calc.fee);
  setV(ws,20,5,"( ="); setF(ws,20,6,"=F16"); setV(ws,20,7,"x"); setV(ws,20,8, calc.feeRate);
  setV(ws,21,3,"부가가치세"); setV(ws,21,4, calc.vat2);
  setV(ws,21,5,"( ="); setF(ws,21,6,"=D20"); setV(ws,21,7,"x"); setV(ws,21,8,0.1);
  setV(ws,22,3,"계"); setV(ws,22,4, calc.subtotal2);
  setV(ws,23,3,"전월 차액"); setV(ws,23,4, calc.adj.전월차액||0); setV(ws,23,5,"( ="); setV(ws,23,6,0); setV(ws,23,7,"-"); setV(ws,23,8,0);
  setV(ws,24,3,"전월 미지급액"); setV(ws,24,4, calc.adj.전월미지급액||0); setV(ws,24,5,"( ="); setV(ws,24,6,0); setV(ws,24,7,"-"); setV(ws,24,8,0);
  setV(ws,25,3,"기타정산"); setV(ws,25,4, calc.adj.기타정산||0);
  setV(ws,26,3,"지급금액"); setV(ws,26,4, calc.payment ?? 0);

  setV(ws,28,2,"정산\n정보");
  setV(ws,28,3,"사업자명 (대표자명)"); setV(ws,28,4, BUYER.bizName);
  setV(ws,28,6,"사업자등록번호"); setV(ws,28,7, BUYER.bizRegNo);
  setV(ws,29,3,"주소"); setV(ws,29,4, BUYER.address);
  setV(ws,30,3,"담당자"); setV(ws,30,4, BUYER.manager);
  setV(ws,30,6,"연락처"); setV(ws,30,7, BUYER.contact);
  setV(ws,31,3,"정산서번호"); setV(ws,31,4, `${BUYER.invoicePrefix}-${settleMonth}-0001`);
  setV(ws,31,6,"납부기한"); setV(ws,31,7,"계산서 발행 후 5영업일 내");
  setV(ws,31,11, Number(m["계약용량"]) || 0);

  setV(ws,33,2,"연간\n보장\n공급량");
  setV(ws,33,4,"예상 공급량"); setV(ws,33,5,"실제 공급량 누계"); setV(ws,33,6,"미달 공급량"); setV(ws,33,7,"미달 구매량"); setV(ws,33,8,"비고");
  schedule.forEach((row,i)=>{
    const r = 34+i;
    setV(ws,r,3, row.k+"회차 "+row.label);
    setV(ws,r,4, row.expected!=null ? row.expected : "-");
    setV(ws,r,5, row.actualCum!=null ? row.actualCum : "-");
    setV(ws,r,6,"-"); setV(ws,r,7,"-");
  });

  ws["!ref"] = "A1:V54";
  ws["!cols"] = [{wch:4},{wch:10},{wch:16},{wch:20},{wch:16},{wch:10},{wch:16},{wch:8}];
  return ws;
}

/* ============ Workbook assembly (per plant) ============ */
async function buildWorkbookForPlant(plant){
  const history = await fetchPerformanceHistory(plant);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { CalcPr: { fullCalcOnLoad: true } };

  const {ws: detailWs, meta} = buildDetailSheet(plants);
  const invoiceWs = buildInvoiceSheet(plant, meta, history);
  const rawWs = buildRawSheet(rawRows);

  XLSX.utils.book_append_sheet(wb, invoiceWs, INVOICE_SHEET);
  XLSX.utils.book_append_sheet(wb, detailWs, DETAIL_SHEET);
  XLSX.utils.book_append_sheet(wb, rawWs, RAW_SHEET);
  return wb;
}

async function exportSinglePlantExcel(){
  if(!plants.length || !selectedPlant){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const wb = await buildWorkbookForPlant(selectedPlant);
  XLSX.writeFile(wb, `직접PPA_정산서_${selectedPlant}_${settleMonth || "정산"}.xlsx`);
}
