/* ============ 상단 헤더: 정산월 선택 / 사용자 / 알림 / 로그아웃 / 5분 무동작 자동 로그아웃 ============ */
const IDLE_LIMIT_MS = 5 * 60 * 1000;
const USER_KEY = "settlement_user";
const LOGOUT_MSG_KEY = "settlement_logout_msg";
const ALERT_DAYS = 60; // 연장통보 마감일·계약해지일이 이 기간 안이면 알림
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

/* ----- 알림: 연장통보 마감일·계약해지일 임박 ----- */
function collectAlerts() {
  if (typeof Registry === "undefined") return [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = ymd => Math.round((new Date(ymd + "T00:00:00") - today) / 86400000);
  const out = [];
  const check = (kind, name, rec) => {
    [["연장통보마감일", "연장통보 마감"], ["계약해지일", "계약 해지"]].forEach(([k, label]) => {
      const v = String(rec[k] || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const d = days(v); if (d < 0 || d > ALERT_DAYS) return;
      out.push({ id: `${kind}|${name}|${k}|${v}`, d, text: `${kind} ${name}: ${label} ${v} (${d === 0 ? "오늘" : "D-" + d})`, page: kind === "발전소" ? "reg-plant" : "reg-cust" });
    });
  };
  Object.entries(Registry.plants()).forEach(([n, r]) => check("발전소", n, r));
  Registry.rawCustomers().forEach(r => check("전기사용자", r["수요기업명"], r));
  if (typeof perfAlerts === "function") out.push(...perfAlerts()); // 연차 종료 30일 이내 미달 위험
  return out.sort((a, b) => a.d - b.d);
}
// 확인한 알림은 이 브라우저에 기억해 목록에서 뺀다 (같은 계약·같은 날짜의 알림은 다시 뜨지 않음)
const SEEN_KEY = "settlement.alerts.seen";
function seenAlerts() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch (e) { return []; } }
function markAlertsSeen(ids) {
  const seen = new Set(seenAlerts()); ids.forEach(id => seen.add(id));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-500))); } catch (e) { /* 저장 불가 환경 */ }
  renderAlerts();
}
function renderAlerts() {
  const seen = new Set(seenAlerts());
  const list = collectAlerts().filter(a => !seen.has(a.id));
  const esc = t => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  document.getElementById("bellDot").hidden = !list.length;
  const panel = document.getElementById("bellPanel");
  panel.innerHTML = `<div class="bell-head"><span>알림</span>${list.length ? `<button type="button" class="bell-all">모두 확인</button>` : ""}</div>${list.length
    ? list.map(a => `<div class="bell-row"><a class="bell-item" href="#${a.page}" data-id="${esc(a.id)}">${esc(a.text)}</a><button type="button" class="bell-x" data-id="${esc(a.id)}" aria-label="확인">확인</button></div>`).join("")
    : `<div class="bell-empty">새 알림이 없습니다.</div>`}`;
  panel.querySelectorAll(".bell-item").forEach(el => el.addEventListener("click", () => markAlertsSeen([el.dataset.id]))); // 눌러서 이동하면 확인 처리
  panel.querySelectorAll(".bell-x").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); markAlertsSeen([el.dataset.id]); }));
  const all = panel.querySelector(".bell-all");
  if (all) all.addEventListener("click", e => { e.stopPropagation(); markAlertsSeen(list.map(a => a.id)); });
}

/* ----- 로그아웃 ----- */
function logout(msg) {
  try {
    sessionStorage.removeItem(AUTH_KEY); sessionStorage.removeItem(USER_KEY);
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
  document.getElementById("hdrUser").textContent = name ? `${name}님` : "";
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
