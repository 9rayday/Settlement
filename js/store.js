/* ============ 앱데이터 저장소 (GAS "앱데이터" 탭 + localStorage 캐시) ============
 * 수요기업 청구 모듈의 월별 요율 / 발전소 / 계약 / 청구 기록을 JSON 으로 보관한다.
 * GAS 연결이 없거나 실패하면 이 브라우저(localStorage)에만 저장되고 화면에 그 사실을 알린다.
 * 로그인 때는 작년 1월 이후 정산 데이터와 설정만 받고, 더 지난 연도는 그 연도를 볼 때 ensureYear 로 받는다.
 */
const Store = (function () {
  const LS = "settlement.store.v1";
  let data = {};
  let remoteOk = false;
  let loadedFrom = null; // 서버에서 받은 정산 데이터의 시작 월 (YYYYMM)

  function readLocal() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function writeLocal() { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) { /* 저장 불가 환경 */ } }

  async function load() {
    data = readLocal();
    const since = String(new Date().getFullYear() - 1) + "01";
    const remote = await gasGet("getStoreAll", { since }); // 실패 시 null
    remoteOk = remote !== null;
    if (remote) { Object.keys(remote).forEach(k => { data[k] = remote[k]; }); writeLocal(); loadedFrom = since; }
    return remoteOk;
  }
  // 그 연도(YYYY) 데이터가 아직 없으면 서버에서 받는다. 받았으면 true
  async function ensureYear(year) {
    if (!remoteOk || !loadedFrom) return false;
    const from = String(year) + "01";
    if (from >= loadedFrom) return false;
    const y = Number(loadedFrom.slice(0, 4)), m = Number(loadedFrom.slice(4)) - 1;
    const to = m ? `${y}${String(m).padStart(2, "0")}` : `${y - 1}12`;
    const remote = await gasGet("getStoreRange", { from, to });
    if (!remote) return false;
    Object.keys(remote).forEach(k => { data[k] = remote[k]; }); writeLocal(); loadedFrom = from;
    return true;
  }
  function get(key, fallback) {
    if (!(key in data)) return fallback;
    try { return JSON.parse(data[key]); } catch (e) { return fallback; }
  }
  function keys(prefix) { return Object.keys(data).filter(k => k.indexOf(prefix) === 0).sort(); }
  // 키별 쓰기 권한 (서버 gas/Code.gs storePerm_ 과 같게)
  function permOf(key) {
    if (/^(netrate:|touver:|holidays|market:|rates:|recw$|reccfg$|smp:)/.test(key)) return "rates";
    if (/^(bill:|carry:|genpay:|recx:|recset:)/.test(key)) return "settle";
    return null;
  }
  // 반환: "remote" | "local" | "denied"
  async function set(key, value) {
    const p = permOf(key);
    if (typeof requirePerm === "function" && p && !requirePerm(p)) return "denied";
    data[key] = JSON.stringify(value); writeLocal();
    const r = await gasPost("saveStore", { key, value: data[key] });
    return r ? "remote" : "local";
  }
  return { load, ensureYear, get, set, keys, isRemote: () => remoteOk, loadedFrom: () => loadedFrom };
})();
