/* ============ GAS Web App API wrapper ============ */
// GAS_WEBAPP_URL이 비어있으면(js/config.js) 배포 전 상태이므로 경고만 남기고 조용히 실패한다.
// -> 로컬 상태만으로 나머지 기능(업로드/집계/미리보기/개별 다운로드)은 계속 동작한다.

function gasConfigured_(){
  return typeof GAS_WEBAPP_URL === "string" && GAS_WEBAPP_URL.trim() !== "";
}

async function gasGet(action, params){
  if(!gasConfigured_()){
    console.warn(`[api] GAS_WEBAPP_URL이 설정되지 않아 ${action} 호출을 건너뜁니다.`);
    return null;
  }
  const url = new URL(GAS_WEBAPP_URL);
  url.searchParams.set("action", action);
  Object.entries(params||{}).forEach(([k,v])=> url.searchParams.set(k, v));
  try{
    const res = await fetch(url.toString());
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || "unknown GAS error");
    return json.data;
  }catch(err){
    console.error(`[api] ${action} 실패:`, err);
    return null;
  }
}

async function gasPost(action, body){
  if(!gasConfigured_()){
    console.warn(`[api] GAS_WEBAPP_URL이 설정되지 않아 ${action} 호출을 건너뜁니다.`);
    return null;
  }
  try{
    // Apps Script doPost는 CORS preflight(OPTIONS)를 처리하지 못하므로
    // text/plain으로 보내 브라우저가 preflight를 생략하게 한다.
    const res = await fetch(GAS_WEBAPP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...body })
    });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || "unknown GAS error");
    return json.data;
  }catch(err){
    console.error(`[api] ${action} 실패:`, err);
    return null;
  }
}

async function fetchMaster(){
  const data = await gasGet("getMaster");
  masterData = data || {};
  return masterData;
}

async function fetchPerformanceHistory(plant){
  const data = await gasGet("getPerformanceHistory", { plant });
  return data || [];
}

async function fetchAdjustments(month, plant){
  const data = await gasGet("getAdjustments", { month, plant });
  return data || { 전월차액:0, 전월미지급액:0, 기타정산:0 };
}

async function saveAdjustments(month, plant, prevDiff, prevUnpaid, otherSettle){
  return gasPost("saveAdjustments", { month, plant, prevDiff, prevUnpaid, otherSettle });
}

async function logPerformance(month, rows){
  const data = await gasPost("logPerformance", { month, rows });
  if(data && data.cumulative) cumulativeSupplyByPlant = data.cumulative;
  return data;
}
