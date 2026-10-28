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

  // 키의 기준 월 (서버 gas/Code.gs storeYm_ 와 같게): 정산 데이터만, 설정 키는 null
  function keyYm(key) {
    let m = /^(?:bill|carry|recx):(\d{6})/.exec(key) || /^(?:genpay|smp):(\d{6})/.exec(key);
    if (m) return m[1];
    m = /^recset:.*:\d{6}-(\d{6})$/.exec(key);
    return m ? m[1] : null;
  }
  function readLocal() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function writeLocal() { try { localStorage.setItem(LS, JSON.stringify(data)); } catch (e) { /* 저장 불가 환경 */ } }

  async function load() {
    data = readLocal();
    const since = String(new Date().getFullYear() - 1) + "01";
    const pre = typeof bootPart === "function" ? await bootPart("store") : null; // 로그인 직후 한 번에 받은 값
    const remote = pre || await gasGet("getStoreAll", { since }); // 실패 시 null
    remoteOk = remote !== null;
    if (remote) {
      // 서버에서 지운 정산 데이터가 이 브라우저 캐시에 남아 다시 보이지 않도록, 받은 범위 안의 키는 서버 값으로 맞춘다
      Object.keys(data).forEach(k => { const ym = keyYm(k); if (!(k in remote) && (ym == null || ym >= since)) delete data[k]; });
      Object.keys(remote).forEach(k => { data[k] = remote[k]; }); writeLocal(); loadedFrom = since;
    }
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
    data[key] = JSON.stringify(value);
    // 시트 한 칸 5만자 제한: 정산서 보관함용 재료(snap)가 크면 시간대 그래프 → 재료 전체 순으로 덜어낸다
    if (data[key].length > 48000 && value && value.snap) {
      const v = Object.assign({}, value, { snap: Object.assign({}, value.snap, { match: Object.assign({}, value.snap.match, { byHour: null }) }) });
      data[key] = JSON.stringify(v);
      if (data[key].length > 48000) { delete v.snap; data[key] = JSON.stringify(v); }
    }
    writeLocal();
    const r = await gasPost("saveStore", { key, value: data[key] });
    return r ? "remote" : "local";
  }
  return { load, ensureYear, get, set, keys, isRemote: () => remoteOk, loadedFrom: () => loadedFrom };
})();
