/* ============ 앱데이터 저장소 (GAS "앱데이터" 탭 + localStorage 캐시) ============
 * 수요기업 청구 모듈의 월별 요율 / 발전소 / 계약 / 청구 기록을 JSON 으로 보관한다.
 * GAS 연결이 없거나 실패하면 이 브라우저(localStorage)에만 저장되고 화면에 그 사실을 알린다.
 */
const Store = (function () {
  const LS = "settlement.store.v1";
  let data = {};
  let remoteOk = false;

  function readLocal() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function writeLocal() { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) { /* 저장 불가 환경 */ } }

  async function load() {
    data = readLocal();
    const remote = await gasGet("getStoreAll"); // 실패 시 null
    remoteOk = remote !== null;
    if (remote) { Object.keys(remote).forEach(k => { data[k] = remote[k]; }); writeLocal(); }
    return remoteOk;
  }
  function get(key, fallback) {
    if (!(key in data)) return fallback;
    try { return JSON.parse(data[key]); } catch (e) { return fallback; }
  }
  function keys(prefix) { return Object.keys(data).filter(k => k.indexOf(prefix) === 0).sort(); }
  // 키별 쓰기 권한 (서버 gas/Code.gs storePerm_ 과 같게)
  function permOf(key) {
    if (/^(netrate:|touver:|holidays|market:|rates:|recw$|reccfg$)/.test(key)) return "rates";
    if (/^(bill:|carry:|genpay:|recx:|smp:|recset:)/.test(key)) return "settle";
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
  return { load, get, set, keys, isRemote: () => remoteOk };
})();
