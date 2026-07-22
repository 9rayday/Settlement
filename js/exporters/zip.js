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
  try{
    for(let i=0;i<plants.length;i++){
      const plant = plants[i];
      statusEl.textContent = `생성 중... (${i+1}/${plants.length}) ${plant}`;
      adjustmentsByPlant[plant] = await fetchAdjustments(settleMonth, plant);
      const folder = zip.folder(sanitizeFilename(plant));
      const [pdfBlob, wb] = await Promise.all([
        buildPdfBlobForPlant(plant),
        buildWorkbookForPlant(plant)
      ]);
      const xlsxArray = XLSX.write(wb, {bookType:"xlsx", type:"array"});
      folder.file("고지서.pdf", pdfBlob);
      folder.file("정산서.xlsx", xlsxArray);
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
