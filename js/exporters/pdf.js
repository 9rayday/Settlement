/* ============ PDF export (구글시트 네이티브 PDF 내보내기) ============
 * html2canvas/jsPDF로 브라우저에서 캡처하던 방식은 엑셀 인쇄 결과와 비율이 계속 미세하게
 * 어긋나서, 구글시트 자체의 인쇄 엔진을 그대로 쓰는 방식으로 바꿨다.
 * 프론트엔드(js/invoice.js의 calcInvoice/buildGuaranteeSchedule)가 이미 계산해둔 값만
 * GAS로 보내고, GAS는 숨김 헬퍼 시트("고지서 출력용")에 값을 배치·스타일링한 뒤
 * 구글시트 export URL로 PDF를 받아 돌려준다 (gas/Code.gs의 renderInvoicePdf_ 참고).
 * 레이아웃을 바꾸려면 이 파일이 아니라 js/exporters/excel.js + gas/Code.gs 양쪽을 고쳐야 한다.
 */
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function base64ToPdfBlob(base64){
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], {type:"application/pdf"});
}

async function buildPdfBlobForPlant(plant){
  const a = aggByPlant[plant];
  if(!a) throw new Error(`${plant} 데이터가 없습니다.`);
  const calc = calcInvoice(plant);
  const grid = await fetchYearlyGrid(plant);
  const schedule = buildGuaranteeSchedule(plant, grid);
  const lossRate = siteTotals.usage ? (siteTotals.usage - siteTotals.supply)/siteTotals.usage : 0;

  const payload = {
    plant, month: settleMonth,
    master: masterData[plant] || {},
    siteTotals,
    plantAgg: a,
    lossRate,
    calc,
    schedule: schedule.map(r=> ({k:r.k, label:r.label, expected:r.expected, actualCum:r.actualCum}))
  };

  const data = await gasPost("renderInvoicePdf", payload);
  if(!data || !data.pdfBase64){
    throw new Error("PDF 생성 실패 — GAS가 배포되어 있는지, js/config.js의 URL이 맞는지 확인해주세요.");
  }
  return base64ToPdfBlob(data.pdfBase64);
}

async function exportSinglePlantPdf(){
  if(!plants.length || !selectedPlant){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const btn = document.getElementById("pdfBtn");
  btn.disabled = true; btn.textContent = "PDF 생성 중... (구글시트 변환, 몇 초 걸릴 수 있음)";
  try{
    const blob = await buildPdfBlobForPlant(selectedPlant);
    downloadBlob(blob, `직접PPA_정산서_${selectedPlant}_${settleMonth||"정산"}.pdf`);
  }catch(err){
    alert(err.message);
  } finally {
    btn.disabled = false; btn.textContent = "이 발전소 고지서 PDF 다운로드";
  }
}
