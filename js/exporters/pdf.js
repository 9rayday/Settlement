/* ============ PDF export: 화면 미리보기 정산서를 그대로 A4 PDF로 ============
 * 미리보기(js/invoice.js buildInvoiceHtml)와 같은 HTML을 화면 밖에 그려 html2canvas 로 찍고 jsPDF A4 한 장에 넣는다.
 * → 미리보기와 PDF가 항상 같다 (예전엔 PDF를 따로 그려 항목·회차·위약금 표시가 달랐음). 한글 폰트를 받지 않아 더 빠르다.
 */
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 정산서 HTML → canvas (미리보기와 같은 폭 794px, A4 맞춤 fitDocs 적용)
async function renderDocCanvas(html){
  const box = document.createElement("div");
  box.style.cssText = "position:fixed; left:-10000px; top:0; width:794px; background:#fff;";
  box.innerHTML = html;
  document.body.appendChild(box);
  try{
    await Promise.all(Array.from(box.querySelectorAll("img")).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    if(typeof fitDocs === "function") fitDocs(box);
    const doc = box.querySelector(".doc") || box;
    return await html2canvas(doc, { scale: 2, backgroundColor: "#ffffff", logging: false });
  } finally { box.remove(); }
}

async function buildPdfBlobForPlant(plant){
  if(!aggByPlant[plant]) throw new Error(`${plant} 데이터가 없습니다.`);
  const canvas = await renderDocCanvas(await buildInvoiceHtml(plant));
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const PW = 595.28, PH = 841.89, M = 18;
  const s = Math.min((PW - 2 * M) / canvas.width, (PH - 2 * M) / canvas.height);
  const w = canvas.width * s, h = canvas.height * s;
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (PW - w) / 2, M, w, h);
  return pdf.output("blob");
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
    btn.disabled = false; btn.textContent = "PDF 다운";
  }
}
