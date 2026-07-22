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
  const canvas = await html2canvas(docEl, { scale:2, useCORS:true });
  document.body.removeChild(container);
  return canvas;
}

async function canvasToPdfBlob(canvas){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit:"mm", format:"a4" });
  const pageWidth = 210, pageHeight = 297;
  const imgData = canvas.toDataURL("image/png");
  const imgHeightMm = canvas.height * pageWidth / canvas.width;
  const y = imgHeightMm < pageHeight ? (pageHeight - imgHeightMm)/2 : 0;
  pdf.addImage(imgData, "PNG", 0, y, pageWidth, Math.min(imgHeightMm, pageHeight));
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
