let _appInited = false;

function initApp(){
  if(_appInited) return; // 로그인 성공 시 checkAuth()가 다시 부를 수 있어 중복 초기화 방지
  _appInited = true;

  initNav(); // 사이드 메뉴 (js/nav.js)
  initHeader(); // 헤더: 정산월·사용자·알림·로그아웃·자동 로그아웃 (js/header.js)

  initUploadZone();
  document.getElementById("adjSaveBtn").addEventListener("click", handleSaveAdjustments);
  document.getElementById("refreshMasterBtn").addEventListener("click", handleRefreshMaster);
  document.getElementById("exportBtn").addEventListener("click", exportSinglePlantExcel);
  document.getElementById("pdfBtn").addEventListener("click", exportSinglePlantPdf);
  document.getElementById("exportAllBtn").addEventListener("click", exportAllPlants);

  initBilling().catch(err=> console.error("[main] 수요기업 청구 모듈 초기화 실패:", err));
  // 발전소(마스터 = masterData)와 전기사용자 등록 정보를 함께 불러온다 (탭0)
  initRegistry().then(()=> initPerformance()).catch(err=> console.error("[main] 등록 정보/계약이행현황 조회 실패:", err)); // 계약이행현황은 등록 정보가 있어야 계산
}

document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("loginBtn").addEventListener("click", handleLogin);
  document.getElementById("loginPw").addEventListener("keydown", e=>{ if(e.key==="Enter") handleLogin(); });
  document.getElementById("pwToggleBtn").addEventListener("click", togglePasswordVisibility);

  if(checkAuth()) initApp();
});
