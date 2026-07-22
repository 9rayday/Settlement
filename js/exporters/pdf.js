/* ============ PDF export (html2canvas + jsPDF) ============ */
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
  container.innerHTML = await buildInvoiceHtml(plant);
  document.body.appendChild(container);
  const docEl = container.querySelector(".doc");
  // 화면용 스타일 대신 A4 한 장에 맞춘 조밀한 인쇄용 스타일로 캡처한다.
  docEl.classList.add("pdf-capture");
  const canvas = await html2canvas(docEl, { scale:2, useCORS:true, windowWidth:docEl.scrollWidth, windowHeight:docEl.scrollHeight });
  document.body.removeChild(container);
  return canvas;
}

async function canvasToPdfBlob(canvas){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:"mm", format:"a4" });
  const pageWidth = 210, pageHeight = 297;
  const imgData = canvas.toDataURL("image/png");
  // 가로/세로 중 더 빡빡한 쪽에 맞춰 축소해서 종횡비를 항상 유지한다(찌그러짐 방지).
  const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
  const drawW = canvas.width * scale;
  const drawH = canvas.height * scale;
  const x = (pageWidth - drawW) / 2;
  const y = (pageHeight - drawH) / 2;
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
