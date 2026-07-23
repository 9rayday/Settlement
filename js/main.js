let _appInited = false;

function initApp(){
  if(_appInited) return; // 로그인 성공 시 checkAuth()가 다시 부를 수 있어 중복 초기화 방지
  _appInited = true;

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
  document.getElementById("refreshMasterBtn").addEventListener("click", handleRefreshMaster);
  document.getElementById("exportBtn").addEventListener("click", exportSinglePlantExcel);
  document.getElementById("pdfBtn").addEventListener("click", exportSinglePlantPdf);
  document.getElementById("exportAllBtn").addEventListener("click", exportAllPlants);

  fetchMaster().catch(err=> console.error("[main] 마스터 데이터 조회 실패:", err));
}

document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("loginPw").addEventListener("keydown", e=>{ if(e.key==="Enter") handleLogin(); });

  if(checkAuth()) initApp();
});
