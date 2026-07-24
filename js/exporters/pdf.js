/* ============ PDF export (jsPDF 네이티브 드로잉) ============
 * 예전엔 GAS(gas/Code.gs의 renderInvoicePdf_)에 값을 보내 구글시트 헬퍼 시트에 그린 뒤
 * 구글시트 자체 PDF 내보내기로 받아왔다 — 비율은 정확했지만 PDF 1건마다 구글 서버
 * 왕복이 생겨 느렸다(특히 "전체 발전소 일괄 생성"). 그 GAS 버전이 쓰던 정확한 레이아웃
 * 수치(열너비 1.58/23.08자, 행높이 7/6.8/31/23pt, 배색, 병합, 서명란, 외곽선)를 그대로
 * 가져오되, 구글시트 Range API 대신 jsPDF의 rect/text로 직접 벡터 드로잉한다.
 * 네트워크 왕복이 전혀 없어 즉시 생성되고, 텍스트가 벡터라 확대해도 선명하다.
 * 레이아웃을 바꾸려면 이 파일과 js/exporters/excel.js 양쪽을 같이 고쳐야 한다.
 */
const PDF_G_DARK = "#595959";
const PDF_G_LIGHT = "#ECECEC";
const PDF_G_BORDER = "#C6CCD6";
const PDF_G_RED = "#C00000";
const PDF_G_EDITABLE = "#FFFDF4";
const PDF_G_NAVY = "#4A4A4A";

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============ 숫자 서식 (gas/Code.gs의 numFmt 문자열과 1:1 대응) ============ */
function pdfFmtWon(n){ return Math.round(Number(n) || 0).toLocaleString() + " 원"; }
function pdfFmtKwh(n){ return (Number(n) || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) + " kWh"; }
function pdfFmtPercent2(n){ return (Number(n) * 100).toFixed(2) + "%"; }
function pdfFmtUnitPrice(n){ return (Number(n) || 0).toFixed(1) + " 원/KWh"; }
function pdfFmtFeeRate(n){ return (Number(n) || 0).toFixed(4) + " 원/KWh"; }

/* ============ 로고 (최초 1회만 로드해서 재사용) ============ */
let _logoDataUrlPromise = null;
function loadLogoDataUrl(){
  if(!_logoDataUrlPromise){
    _logoDataUrlPromise = fetch("assets/logo.jpg")
      .then(r=> r.blob())
      .then(blob=> new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .catch(()=> null);
  }
  return _logoDataUrlPromise;
}

/* ============ 한글 폰트 (jsPDF 기본 폰트는 한글 글리프가 전혀 없어 필수) ============
 * jsPDF의 helvetica/times/courier는 라틴 문자만 지원한다 — 한글로 text()를 호출하면
 * 깨진 문자가 나온다(직접 겪은 버그). css/style.css가 이미 쓰는 Pretendard 폰트를
 * 그대로 임베드해서 jsPDF에 등록한다. 최초 1회만 내려받아 세션 내 재사용(2.7MB, TTF).
 * Bold 파일은 따로 안 받고 두 번 겹쳐 그리는 방식(faux-bold)으로 흉내낸다(다운로드 절반로 절감).
 */
const KOREAN_FONT_URL = "https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/alternative/Pretendard-Regular.ttf";
const KOREAN_FONT_NAME = "Pretendard";
let _koreanFontBase64Promise = null;
function loadKoreanFontBase64(){
  if(!_koreanFontBase64Promise){
    _koreanFontBase64Promise = fetch(KOREAN_FONT_URL)
      .then(r=> r.blob())
      .then(blob=> new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=> resolve(String(reader.result).split(",")[1]); // "data:...;base64," 접두어 제거
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }));
  }
  return _koreanFontBase64Promise;
}
async function registerKoreanFont(doc){
  const base64 = await loadKoreanFontBase64();
  doc.addFileToVFS("Pretendard-Regular.ttf", base64);
  doc.addFont("Pretendard-Regular.ttf", KOREAN_FONT_NAME, "normal");
  doc.setFont(KOREAN_FONT_NAME, "normal");
}

/* ============ 레이아웃 지오메트리 (gas/Code.gs와 동일 수치) ============ */
function chToPtWidth_(ch){ return Math.round(ch * 7 + 5) * 72 / 96; } // 문자수 → px(엑셀 근사) → pt

function buildInvoiceGeometry_(scheduleLen){
  const PAGE_W = 595.28, PAGE_H = 841.89; // A4, pt
  const MARGIN = 0.35 * 72; // 0.35in

  const COL_PT = [1.58, 23.08, 23.08, 23.08, 23.08, 23.08, 23.08, 23.08, 1.58].map(chToPtWidth_);
  const lastRow = 33 + scheduleLen; // 연간보장공급량 마지막 데이터 행 (헤더 33 + scheduleLen행), 그 뒤 55~59는 고정
  const GAP_ROWS = new Set([8, 14, 27, 32, 54, 59]);
  const TALL_ROWS = new Set([6, 7, 29, 56, 57, 58]);
  const totalRows = Math.max(59, lastRow + 1);
  const ROW_PT = [7]; // row1
  for(let r=2;r<=totalRows;r++){
    ROW_PT.push(GAP_ROWS.has(r) ? 6.8 : TALL_ROWS.has(r) ? 31 : 23);
  }

  const colPrefix = [0];
  COL_PT.forEach(w=> colPrefix.push(colPrefix[colPrefix.length-1] + w));
  const rowPrefix = [0];
  ROW_PT.forEach(h=> rowPrefix.push(rowPrefix[rowPrefix.length-1] + h));

  const totalW = colPrefix[colPrefix.length-1];
  const totalH = rowPrefix[59]; // 원본 레이아웃은 항상 59행 기준으로 맞춤(연간보장공급량 길이는 33+len으로 55행 이전에 들어옴)
  const usableW = PAGE_W - 2*MARGIN;
  const usableH = PAGE_H - 2*MARGIN;
  const scale = Math.min(usableW/totalW, usableH/totalH);
  const originX = MARGIN + (usableW - totalW*scale)/2;
  const originY = MARGIN + (usableH - totalH*scale)/2;

  function box(r1, c1, c2, r2){
    r2 = r2 || r1;
    return {
      x: originX + scale*colPrefix[c1-1],
      y: originY + scale*rowPrefix[r1-1],
      w: scale*(colPrefix[c2] - colPrefix[c1-1]),
      h: scale*(rowPrefix[r2] - rowPrefix[r1-1])
    };
  }
  return { scale, box };
}

/* ============ 셀 드로잉 헬퍼 ============ */
function pdfCell(doc, box, text, opts){
  opts = opts || {};
  const {x, y, w, h} = box;
  if(opts.bg){
    doc.setFillColor(opts.bg);
    doc.rect(x, y, w, h, "F");
  }
  if(opts.border !== false){
    doc.setDrawColor(opts.borderColor || PDF_G_BORDER);
    doc.setLineWidth(opts.borderWidth || 0.4);
    doc.rect(x, y, w, h, "S");
  }
  if(text != null && text !== ""){
    const fontSize = (opts.fontSize || 10) * opts._scale;
    // Pretendard는 Regular 하나만 임베드했다(한글 폰트는 굵게/기울임 파일까지 받으면
    // 용량이 두 배가 됨) — bold는 살짝 겹쳐 그리는 faux-bold로 흉내낸다.
    doc.setFont(KOREAN_FONT_NAME, "normal");
    doc.setFontSize(Math.max(fontSize, 3));
    doc.setTextColor(opts.color || "#000000");
    const lines = String(text).split("\n").reduce((acc, line)=> acc.concat(doc.splitTextToSize(line, w-4)), []);
    const lineH = fontSize * 1.2;
    const totalTextH = lines.length * lineH;
    let ty = y + (h - totalTextH)/2 + lineH*0.78;
    const boldOffset = opts.bold ? Math.max(fontSize*0.02, 0.15) : 0;
    lines.forEach(line=>{
      doc.text(line, x + w/2, ty, {align:"center"});
      if(boldOffset) doc.text(line, x + w/2 + boldOffset, ty, {align:"center"});
      ty += lineH;
    });
  }
}

/* ============ 본체: gas/Code.gs의 renderInvoicePdf_와 동일한 순서로 이식 ============ */
async function drawInvoicePdf(doc, ctx){
  const { plant, month, master:m, siteTotals:site, plantAgg:agg, lossRate, calc, schedule } = ctx;
  const adj = calc.adj || {};
  const geo = buildInvoiceGeometry_(schedule.length);
  const s = geo.scale;
  const cell = (r1, c1, c2, r2, text, opts)=> pdfCell(doc, geo.box(r1, c1, c2, r2), text, Object.assign({_scale:s}, opts));
  const section = (r1, r2, text)=> cell(r1, 2, 2, r2, text, {bg:PDF_G_DARK, bold:true, color:"#FFFFFF"});
  const label = (r, c, text)=> cell(r, c, c, null, text, {bg:PDF_G_LIGHT, bold:true, color:PDF_G_NAVY});
  const value = (r, c1, c2, text, opts)=> cell(r, c1, c2, null, text, opts || {});
  const basis = (r, c)=> cell(r, c, c, null, null, {});

  // 로고 + 타이틀 (테두리 없음)
  const logoDataUrl = await loadLogoDataUrl();
  const logoAnchor = geo.box(2, 2, 2); // gas/Code.gs: sheet.insertImage(logoBlob, col=2, row=2, offsetX=8, offsetY=8)
  if(logoDataUrl){
    try{ doc.addImage(logoDataUrl, "JPEG", logoAnchor.x + 6*s, logoAnchor.y + 6*s, 212*0.75*s, 38*0.75*s); }catch(e){ /* 로고 실패해도 계속 */ }
  }
  cell(2, 2, 8, null, "직접PPA 전력거래대금 정산서", {border:false, bold:true, fontSize:16, color:PDF_G_NAVY});
  const monthLabel = String(month||"").length >= 6 ? `${month.slice(0,4)}년 ${month.slice(4,6)}월 거래분` : "";
  cell(3, 2, 8, null, `(${monthLabel})`, {border:false, fontSize:13, color:"#5B6675"});

  // 발전사업자 정보
  section(5, 7, "발전사업자\n정보");
  label(5,3,"사업자명 (대표자명)"); value(5,4,5, m["사업자명(대표자명)"] || "입력 예정", {bg: m["사업자명(대표자명)"] ? null : PDF_G_EDITABLE});
  label(5,6,"사업자등록번호"); value(5,7,8, m["사업자등록번호"] || "입력 예정", {bg: m["사업자등록번호"] ? null : PDF_G_EDITABLE});
  label(6,3,"사업자 주소"); value(6,4,5, m["사업자주소"] || "입력 예정", {bg: m["사업자주소"] ? null : PDF_G_EDITABLE});
  label(6,6,"계좌번호"); value(6,7,8, m["계좌번호"] || "입력 예정", {bg: m["계좌번호"] ? null : PDF_G_EDITABLE});
  label(7,3,"발전소명"); value(7,4,5, plant, {});
  const contact = [m["담당자"], m["연락처"]].filter(Boolean).join(" / ");
  label(7,6,"연락처"); value(7,7,8, contact || "입력 예정", {bg: contact ? null : PDF_G_EDITABLE});

  // 전력거래내역
  section(9, 13, "전력\n거래\n내역");
  label(9,3,"총 전기사용량"); value(9,4,5, pdfFmtKwh(site.usage));
  label(9,6,"총 발전량"); value(9,7,8, pdfFmtKwh(site.generation));
  label(10,3,"전력손실률"); value(10,4,5, pdfFmtPercent2(lossRate));
  label(10,6,"총 공급량"); value(10,7,8, pdfFmtKwh(site.supply));
  label(11,3,"총 초과발전량"); value(11,4,5, pdfFmtKwh(site.excess));
  label(11,6,"총 부족전력량"); value(11,7,8, pdfFmtKwh(site.deficit));
  label(12,3,"해당 발전소 발전량"); value(12,4,5, pdfFmtKwh(agg.generation));
  label(12,6,"해당 발전소 공급량"); value(12,7,8, pdfFmtKwh(agg.supply));
  label(13,3,"해당 발전소 초과발전량"); value(13,4,5, pdfFmtKwh(agg.excess));
  label(13,6,"-"); value(13,7,8, "-");

  // 정산내역
  section(15, 26, "정산\n내역");
  value(15,5,8,"산출 근거", {bg:PDF_G_DARK, bold:true, color:"#FFFFFF"});
  cell(15,3,3,null,"항목", {bg:PDF_G_DARK, bold:true, color:"#FFFFFF"});
  cell(15,4,4,null,"금액", {bg:PDF_G_DARK, bold:true, color:"#FFFFFF"});

  cell(16,3,3,null,"전력량 요금"); value(16,4,4, pdfFmtWon(calc.energyFee));
  cell(16,5,5,null,"( ="); cell(16,6,6,null, pdfFmtKwh(calc.supply)); cell(16,7,7,null,"x"); cell(16,8,8,null, pdfFmtUnitPrice(calc.unitPrice));
  cell(17,3,3,null,"공급가액"); value(17,4,4, pdfFmtWon(calc.supplyValue));
  cell(18,3,3,null,"부가가치세"); value(18,4,4, pdfFmtWon(calc.vat1));
  cell(18,5,5,null,"( ="); cell(18,6,6,null, pdfFmtWon(calc.supplyValue)); cell(18,7,7,null,"x"); cell(18,8,8,null,"10.00%");
  cell(19,3,3,null,"계",{bold:true}); value(19,4,4, pdfFmtWon(calc.subtotal1), {bold:true});
  cell(20,3,3,null,"거래수수료"); value(20,4,4, pdfFmtWon(calc.fee));
  cell(20,5,5,null,"( ="); cell(20,6,6,null, pdfFmtKwh(calc.supply)); cell(20,7,7,null,"x"); cell(20,8,8,null, pdfFmtFeeRate(calc.feeRate));
  cell(21,3,3,null,"부가가치세"); value(21,4,4, pdfFmtWon(calc.vat2));
  cell(21,5,5,null,"( ="); cell(21,6,6,null, pdfFmtWon(calc.fee)); cell(21,7,7,null,"x"); cell(21,8,8,null,"10.00%");
  cell(22,3,3,null,"계",{bold:true}); value(22,4,4, pdfFmtWon(calc.subtotal2), {bold:true});
  cell(23,3,3,null,"전월 차액"); value(23,4,4, pdfFmtWon(adj.전월차액));
  cell(23,5,5,null,"( ="); cell(23,6,6,null, pdfFmtWon(adj.전월차액)); cell(23,7,7,null,"-"); cell(23,8,8,null, pdfFmtWon(0));
  cell(24,3,3,null,"전월 미지급액"); value(24,4,4, pdfFmtWon(adj.전월미지급액));
  cell(24,5,5,null,"( ="); cell(24,6,6,null, pdfFmtWon(adj.전월미지급액)); cell(24,7,7,null,"-"); cell(24,8,8,null, pdfFmtWon(0));
  cell(25,3,3,null,"기타정산"); value(25,4,4, pdfFmtWon(adj.기타정산));
  cell(26,3,3,null,"지급금액",{bold:true,fontSize:11}); value(26,4,4, pdfFmtWon(calc.payment), {bold:true,fontSize:11}); value(26,5,8,null);

  // 정산정보
  section(28, 31, "정산\n정보");
  label(28,3,"사업자명 (대표자명)"); value(28,4,5, BUYER.bizName);
  label(28,6,"사업자등록번호"); value(28,7,8, BUYER.bizRegNo);
  label(29,3,"주소"); value(29,4,8, BUYER.address);
  label(30,3,"담당자"); value(30,4,5, BUYER.manager);
  label(30,6,"연락처"); value(30,7,8, BUYER.contact);
  label(31,3,"정산서번호"); value(31,4,5, `${BUYER.invoicePrefix}-${month}-0001`);
  label(31,6,"납부기한"); value(31,7,8, "계산서 발행 후 5영업일 내");

  // 연간보장공급량
  const lastYearRow = 33 + schedule.length;
  section(33, lastYearRow, "연간\n보장\n공급량");
  label(33,3,"회차"); label(33,4,"예상 공급량"); label(33,5,"실제 공급량 누계"); label(33,6,"미달 공급량"); label(33,7,"미달 구매량"); label(33,8,"비고");
  schedule.forEach((row, i)=>{
    const r = 34 + i;
    cell(r,3,3,null, `${row.k}회차 ${row.label}`);
    cell(r,4,4,null, row.expected!=null ? pdfFmtKwh(row.expected) : "-");
    cell(r,5,5,null, row.actualCum!=null ? pdfFmtKwh(row.actualCum) : "-");
    cell(r,6,6,null,"-"); cell(r,7,7,null,"-"); basis(r,8);
  });

  // 서명란 (55~58행, 표 테두리 없음 — 날짜 + 확인/지급 문구 + 점선 구분선)
  const today = new Date();
  const todayLabel = `${today.getFullYear()}년 ${String(today.getMonth()+1).padStart(2,"0")}월 ${String(today.getDate()).padStart(2,"0")}일`;
  const monthPlain = String(month||"").length >= 6 ? `${month.slice(0,4)}년 ${month.slice(4,6)}월` : "";
  const bizNameOnly = (m["사업자명(대표자명)"] || plant).split("(")[0].trim();

  cell(55,2,8,null, todayLabel, {border:false, bold:true, fontSize:14});
  cell(56,2,4,null, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 확인합니다.`, {border:false, fontSize:11});
  cell(56,6,8,null, `위와 같이 ${monthPlain} 직접PPA 전력거래대금을 지급합니다.`, {border:false, fontSize:11});
  cell(57,2,4,null, "발전사업자", {border:false, fontSize:12, bold:true});
  cell(57,6,8,null, "재생에너지전기공급사업자", {border:false, fontSize:12, bold:true});
  cell(58,2,4,null, `${bizNameOnly} (인)`, {border:false, fontSize:16, bold:true});
  cell(58,6,8,null, `${BUYER.bizNameLegal} (인)`, {border:false, fontSize:16, bold:true});

  // 56~58행 좌우 서명 블록 사이 점선 구분선
  const divTop = geo.box(56, 5, 5).y;
  const divBottom = geo.box(58, 5, 5).y + geo.box(58, 5, 5).h;
  const divX = geo.box(56, 4, 4).x + geo.box(56, 4, 4).w;
  doc.setDrawColor(PDF_G_NAVY);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setLineWidth(0.6);
  doc.line(divX, divTop, divX, divBottom);
  doc.setLineDashPattern([], 0);

  // 12~13행("해당 발전소 ~") 바깥쪽만 빨간 테두리
  const redBox = geo.box(12, 3, 8, 13);
  doc.setDrawColor(PDF_G_RED);
  doc.setLineWidth(1);
  doc.rect(redBox.x, redBox.y, redBox.w, redBox.h, "S");

  // 외곽 굵은 테두리
  const outer = geo.box(1, 1, 9, 59);
  doc.setDrawColor(PDF_G_NAVY);
  doc.setLineWidth(1.6);
  doc.rect(outer.x, outer.y, outer.w, outer.h, "S");
}

/* ============ Blob 생성 ============ */
async function buildPdfBlobForPlant(plant){
  const a = aggByPlant[plant];
  if(!a) throw new Error(`${plant} 데이터가 없습니다.`);
  const calc = calcInvoice(plant);
  const grid = await fetchYearlyGrid(plant);
  const schedule = buildGuaranteeSchedule(plant, grid);
  const lossRate = siteTotals.lossRatePct!=null ? siteTotals.lossRatePct
    : (siteTotals.usage ? (siteTotals.usage - siteTotals.supply)/siteTotals.usage : 0);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:"pt", format:"a4"});
  await registerKoreanFont(doc);
  await drawInvoicePdf(doc, {
    plant, month: settleMonth,
    master: masterData[plant] || {},
    siteTotals, plantAgg: a, lossRate, calc, schedule
  });
  return doc.output("blob");
}

async function exportSinglePlantPdf(){
  if(!plants.length || !selectedPlant){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const btn = document.getElementById("pdfBtn");
  btn.disabled = true; btn.textContent = "생성 중...";
  try{
    const blob = await buildPdfBlobForPlant(selectedPlant);
    downloadBlob(blob, `직접PPA_정산서_${selectedPlant}_${settleMonth||"정산"}.pdf`);
  }catch(err){
    alert(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "PDF";
  }
}
