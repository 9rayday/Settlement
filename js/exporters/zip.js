/* ============ Bulk export: 발전사업자별 PDF+엑셀을 zip 하나로 ============ */
function sanitizeFilename(name){
  return String(name).replace(/[\\/:*?"<>|]/g,"_");
}

async function exportAllPlants(){
  if(!plants.length){ alert("먼저 월별 거래데이터를 업로드하세요."); return; }
  const statusEl = document.getElementById("exportAllStatus");
  const btn = document.getElementById("exportAllBtn");
  btn.disabled = true;
  const zip = new JSZip();
  const monthLabel = settleMonth && settleMonth.length>=6 ? `${settleMonth.slice(0,4)}년 ${settleMonth.slice(4,6)}월` : "정산";
  try{
    for(let i=0;i<plants.length;i++){
      const plant = plants[i];
      statusEl.textContent = `생성 중... (${i+1}/${plants.length}) ${plant}`;
      adjustmentsByPlant[plant] = await fetchAdjustments(settleMonth, plant);
      const [pdfBlob, workbook] = await Promise.all([
        buildPdfBlobForPlant(plant),
        buildWorkbookForPlant(plant)
      ]);
      const xlsxBuffer = await workbook.xlsx.writeBuffer();
      const baseName = sanitizeFilename(`${monthLabel} 직접PPA 전력거래대금 정산서_${plant}`);
      zip.file(`${baseName}.pdf`, pdfBlob);
      zip.file(`${baseName}.xlsx`, xlsxBuffer);
    }
    statusEl.textContent = "압축 중...";
    const zipBlob = await zip.generateAsync({type:"blob"});
    downloadBlob(zipBlob, `직접PPA_정산서_전체_${settleMonth||"정산"}.zip`);
    statusEl.textContent = `완료 (${plants.length}개 발전소)`;
  }catch(err){
    statusEl.textContent = "오류: " + err.message;
  }finally{
    btn.disabled = false;
  }
}
