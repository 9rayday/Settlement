/* ============ PDF export (html2canvas + jsPDF) ============ */
/* ------------------------------------------------------------------
 * 아래 상수는 "직접PPA_정산서_..._V2.xlsx" > '고지서 양식' 시트의
 * 인쇄 설정(A4, 여백 0.35in, 가로/세로 1페이지 맞춤, 가운데 정렬)을
 * LibreOffice로 실제 PDF 렌더링하여 픽셀 단위로 측정한 값입니다.
 * → 엑셀에서 인쇄했을 때와 완전히 동일한 위치·크기·비율로 배치됩니다.
 *
 * 엑셀 서식(열 너비/행 높이/여백)이 바뀌면 이 상수들을 다시 측정해야 합니다.
 * 측정 방법: soffice --headless --convert-to pdf 로 변환 →
 *           pdftoppm -r 150 으로 렌더링 → 흰색이 아닌 픽셀의 bounding box 탐지
 * ------------------------------------------------------------------ */
const PDF_PAGE_W = 595.28;   // A4 가로, pt (jsPDF 'a4' 기본값과 동일)
const PDF_PAGE_H = 841.89;   // A4 세로, pt

const EXCEL_CONTENT_W = 375.84; // 엑셀 인쇄 시 실제 콘텐츠 가로 크기, pt (측정값)
const EXCEL_CONTENT_H = 777.12; // 엑셀 인쇄 시 실제 콘텐츠 세로 크기, pt (측정값)
const EXCEL_ASPECT = EXCEL_CONTENT_H / EXCEL_CONTENT_W; // ≈ 2.0674 (세로/가로)

// 엑셀의 '가운데 정렬(가로+세로)' 인쇄 설정을 그대로 재현
const boxW = EXCEL_CONTENT_W;
const boxH = EXCEL_CONTENT_H;
const boxX = (PDF_PAGE_W - boxW) / 2;
const boxY = (PDF_PAGE_H - boxH) / 2;

// HTML 캡처 시 사용할 고정 픽셀 크기 (모든 발전소 문서가 항상 동일한 비율로 캡처되도록 고정)
const CAPTURE_W = 760;                                   // px
const CAPTURE_H = Math.round(CAPTURE_W * EXCEL_ASPECT);  // px, ≈ 1571 (항상 0.484 비율 유지)

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function renderPlantToCanvas(plant){
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "0";
  document.body.appendChild(container);

  // 실제 콘텐츠를 담을 내부 wrapper (내용 길이에 따라 자연스러운 높이를 가짐)
  const inner = document.createElement("div");
  inner.style.width = CAPTURE_W + "px";
  inner.innerHTML = await buildInvoiceHtml(plant);
  const docEl = inner.querySelector(".doc");
  docEl.classList.add("pdf-capture");

  // 캡처 프레임: 항상 CAPTURE_W x CAPTURE_H 로 고정 (엑셀과 동일한 세로:가로 비율)
  const frame = document.createElement("div");
  frame.style.width = CAPTURE_W + "px";
  frame.style.height = CAPTURE_H + "px";
  frame.style.overflow = "hidden";
  frame.style.position = "relative";
  frame.style.background = "#fff";
  frame.appendChild(inner);
  container.appendChild(frame);

  // 문서마다 내용 길이가 달라도, 프레임 높이(CAPTURE_H)에 맞춰 균등 축소
  // (가로/세로 동일 배율로 축소하므로 절대 찌그러지지 않음)
  const naturalH = inner.scrollHeight;
  const scale = Math.min(1, CAPTURE_H / naturalH);
  inner.style.transformOrigin = "top left";
  inner.style.transform = `scale(${scale})`;
  // 축소 후 남는 세로 여백은 프레임 안에서 가운데 정렬 (엑셀의 세로 가운데 정렬과 동일한 느낌)
  const scaledH = naturalH * scale;
  inner.style.position = "absolute";
  inner.style.top = Math.max(0, (CAPTURE_H - scaledH) / 2) + "px";
  inner.style.left = "0px";

  const canvas = await html2canvas(frame, {
    scale: 2,
    useCORS: true,
    windowWidth: CAPTURE_W,
    windowHeight: CAPTURE_H,
  });

  document.body.removeChild(container);
  return canvas;
}

async function canvasToPdfBlob(canvas){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  // canvas는 항상 CAPTURE_W:CAPTURE_H (= EXCEL 비율)로 고정 캡처되므로
  // boxW/boxH에 왜곡 없이 꽉 채워진다. Math.min은 혹시 모를 반올림 오차에 대한 안전장치.
  const scale = Math.min(boxW / canvas.width, boxH / canvas.height);
  const drawW = canvas.width * scale;
  const drawH = canvas.height * scale;
  const x = boxX + (boxW - drawW) / 2;
  const y = boxY + (boxH - drawH) / 2;

  const imgData = canvas.toDataURL("image/png");
  pdf.addImage(imgData, "PNG", x, y, drawW, drawH);
  return pdf.output("blob");
}

async function buildPdfBlobForPlant(plant){
  const canvas = await renderPlantToCanvas(plant);
  return canvasToPdfBlob(canvas);
}

async function exportSinglePlantPdf(){
  if(!plants.length || !selectedPlant){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const btn = document.getElementById("pdfBtn");
  btn.disabled = true; btn.textContent = "PDF 생성 중...";
  try{
    const blob = await buildPdfBlobForPlant(selectedPlant);
    downloadBlob(blob, `직접PPA_정산서_${selectedPlant}_${settleMonth||"정산"}.pdf`);
  } finally {
    btn.disabled = false; btn.textContent = "이 발전소 고지서 PDF 다운로드";
  }
}
