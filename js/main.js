document.addEventListener("DOMContentLoaded", ()=>{
  document.querySelectorAll(".tab-btn").forEach(b=>{
    b.addEventListener("click", ()=>{
      document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById(b.dataset.tab).classList.add("active");
    });
  });

  initUploadZone();
  document.getElementById("adjSaveBtn").addEventListener("click", handleSaveAdjustments);
  document.getElementById("exportBtn").addEventListener("click", exportSinglePlantExcel);
  document.getElementById("pdfBtn").addEventListener("click", exportSinglePlantPdf);
  document.getElementById("exportAllBtn").addEventListener("click", exportAllPlants);

  fetchMaster().catch(err=> console.error("[main] 마스터 데이터 조회 실패:", err));
});
