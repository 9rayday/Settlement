/* ============ 상단 헤더: 정산월 선택 / 사용자 / 알림 / 로그아웃 / 5분 무동작 자동 로그아웃 ============ */
const IDLE_LIMIT_MS = 5 * 60 * 1000;
const USER_KEY = "settlement_user";
const LOGOUT_MSG_KEY = "settlement_logout_msg";
let _idleTimer = null;

/* ----- 정산월 (YYYYMM) ----- */
function getHeaderMonth() { const v = document.getElementById("monthPicker").value; return v ? v.replace("-", "") : ""; }
function setHeaderMonth(ym, fromUser) {
  const el = document.getElementById("monthPicker");
  if (!/^\d{6}$/.test(ym || "")) return;
  el.value = `${ym.slice(0, 4)}-${ym.slice(4)}`;
  // 그룹화 월별 집계 등 월을 쓰는 화면에 반영
  if (typeof regState !== "undefined" && regState.month !== ym) { regState.month = ym; if (fromUser && typeof renderGroupPage === "function") renderGroupPage(); }
}

/* ----- 알림 -----
 * - 연장통보 마감일 7일 전부터 (D-7 ~ D-day)
 * - 계약 만료(계약해지일 당일·이후, 계약상태가 "해지"가 아니면): 계약 연장 / 계약 해지 선택
 * - 계약이행현황 미달 위험 (performance.js)
 * 날짜 기준은 todayYmd() — 주소에 ?today=YYYY-MM-DD 를 붙이면 그 날짜로 테스트할 수 있다 (kpxrates.js)
 */
const NOTICE_ALERT_DAYS = 7;
function collectAlerts() {
  if (typeof Registry === "undefined") return [];
  const today = todayYmd();
  const days = ymd => Math.round((new Date(ymd + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
  const ymdOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const out = [];
  const check = (kind, key, name, rec) => {
    if (String(rec["계약상태"] || "").trim() === "해지") return;
    const page = kind === "plant" ? "reg-plant" : "reg-cust", label = kind === "plant" ? "발전소" : "전기사용자";
    const notice = String(rec["연장통보마감일"] || ""), end = String(rec["계약해지일"] || "");
    if (ymdOk(notice)) {
      const d = days(notice);
      if (d >= 0 && d <= NOTICE_ALERT_DAYS) out.push({ id: `${label}|${name}|연장통보마감일|${notice}`, d, page,
        text: `${label} ${name}: 연장통보 마감 ${notice} (${d === 0 ? "오늘" : "D-" + d})` });
    }
    if (ymdOk(end) && days(end) <= 0) out.push({ id: `expire|${kind}|${key}|${end}`, d: days(end), page, action: { kind, key }, // 연장/해지를 고를 때까지 계속 표시
      text: `${label} ${name}: 계약 만료 ${end}${days(end) < 0 ? ` (${-days(end)}일 지남)` : " (오늘)"} — 연장 또는 해지를 선택하세요` });
  };
  Object.entries(Registry.plants()).forEach(([n, r]) => check("plant", n, n, r));
  Registry.rawCustomers().forEach(r => { const k = Registry.custKey(r); check("cust", k, `${r["수요기업명"]}${k && k !== r["수요기업명"] ? " (" + k + ")" : ""}`, r); });
  if (typeof perfAlerts === "function") out.push(...perfAlerts()); // 연차 종료 30일 이내 미달 위험
  return out.sort((a, b) => a.d - b.d);
}
// 확인한 알림은 이 브라우저에 기억해 목록에서 뺀다 (같은 계약·같은 날짜의 알림은 다시 뜨지 않음). 계약 만료 알림은 선택 전까지 남는다.
const SEEN_KEY = "settlement.alerts.seen";
function seenAlerts() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch (e) { return []; } }
function markAlertsSeen(ids) {
  const seen = new Set(seenAlerts()); ids.forEach(id => seen.add(id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-500))); } catch (e) { /* 저장 불가 환경 */ }
  renderAlerts();
}
function renderAlerts() {
  const seen = new Set(seenAlerts());
  const list = collectAlerts().filter(a => a.action || !seen.has(a.id));
  const dismissable = list.filter(a => !a.action);
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  document.getElementById("bellDot").hidden = !list.length;
  const panel = document.getElementById("bellPanel");
  panel.innerHTML = `<div class="bell-head"><span>알림</span>${dismissable.length ? `<button type="button" class="bell-all">모두 확인</button>` : ""}</div>${list.length
    ? list.map(a => a.action
      ? `<div class="bell-row expire"><div class="bell-item"><a href="#${a.page}">${esc(a.text)}</a>
          <div class="bell-act"><label>연장 <input type="number" class="ext-years" min="1" step="1" value="1"> 년</label>
            <button type="button" class="btn accent small ext-go" data-kind="${a.action.kind}" data-key="${esc(a.action.key)}">계약 연장</button>
            <button type="button" class="btn secondary danger small term-go" data-kind="${a.action.kind}" data-key="${esc(a.action.key)}">계약 해지</button></div></div></div>`
      : `<div class="bell-row"><a class="bell-item" href="#${a.page}" data-id="${esc(a.id)}">${esc(a.text)}</a><button type="button" class="bell-x" data-id="${esc(a.id)}" aria-label="확인">확인</button></div>`).join("")
    : `<div class="bell-empty">새 알림이 없습니다.</div>`}`;
  panel.querySelectorAll("a.bell-item").forEach(el => el.addEventListener("click", () => markAlertsSeen([el.dataset.id]))); // 눌러서 이동하면 확인 처리
  panel.querySelectorAll(".bell-x").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); markAlertsSeen([el.dataset.id]); }));
  panel.querySelectorAll(".ext-go").forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    const years = Number(b.closest(".bell-act").querySelector(".ext-years").value);
    b.disabled = true; const r = await extendContract(b.dataset.kind, b.dataset.key, years); b.disabled = false;
    if (!r.ok) alert("연장 실패: " + r.error);
  }));
  panel.querySelectorAll(".term-go").forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    if (!confirm(`${b.dataset.key} 계약을 해지로 확정할까요?`)) return;
    b.disabled = true; const r = await terminateContract(b.dataset.kind, b.dataset.key); b.disabled = false;
    if (!r.ok) alert("해지 실패: " + r.error);
  }));
  const all = panel.querySelector(".bell-all");
  if (all) all.addEventListener("click", e => { e.stopPropagation(); markAlertsSeen(dismissable.map(a => a.id)); });
}

/* ----- 로그아웃 ----- */
function logout(msg) {
  try {
    const tok = sessionStorage.getItem(TOKEN_KEY);
    if (tok && typeof GAS_WEBAPP_URL === "string" && GAS_WEBAPP_URL) navigator.sendBeacon && navigator.sendBeacon(GAS_WEBAPP_URL, new Blob([JSON.stringify({ action: "logout", token: tok })], { type: "text/plain" }));
    [AUTH_KEY, USER_KEY, TOKEN_KEY, ROLE_KEY, PERMS_KEY].forEach(k => sessionStorage.removeItem(k));
    if (msg) sessionStorage.setItem(LOGOUT_MSG_KEY, msg);
  } catch (e) { /* 저장 불가 환경 */ }
  location.reload(); // 화면 상태(업로드 데이터 등)를 모두 비운다
}
function resetIdle() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => logout("5분 동안 사용이 없어 자동 로그아웃되었습니다."), IDLE_LIMIT_MS);
}

function initHeader() {
  let name = ""; try { name = sessionStorage.getItem(USER_KEY) || ""; } catch (e) { /* 무시 */ }
  document.getElementById("hdrUser").textContent = name ? `${name}님 · ${userRole()}` : "";
  if (TEST_TODAY) { const t = document.getElementById("testToday"); t.hidden = false; t.textContent = `테스트 날짜 ${TEST_TODAY}`; }
  document.getElementById("logoutBtn").addEventListener("click", () => logout());
  const bell = document.getElementById("bellBtn"), panel = document.getElementById("bellPanel");
  bell.addEventListener("click", e => { e.stopPropagation(); renderAlerts(); panel.hidden = !panel.hidden; });
  document.addEventListener("click", e => { if (!panel.hidden && e.target.isConnected && !panel.contains(e.target)) panel.hidden = true; }); // 목록 안에서 확인을 눌러 다시 그려져도 닫히지 않게
  const picker = document.getElementById("monthPicker");
  if (!picker.value) { const d = new Date(); d.setMonth(d.getMonth() - 1); setHeaderMonth(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`); }
  picker.addEventListener("change", () => setHeaderMonth(getHeaderMonth(), true));
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
  resetIdle();
  renderAlerts(); // 등록 정보를 불러온 뒤에는 registry.js 가 다시 부른다
}
