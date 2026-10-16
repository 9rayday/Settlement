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
      out.push({ d, text: `${kind} ${name}: ${label} ${v} (${d === 0 ? "오늘" : "D-" + d})`, page: kind === "발전소" ? "reg-plant" : "reg-cust" });
    });
  };
  Object.entries(Registry.plants()).forEach(([n, r]) => check("발전소", n, r));
  Registry.rawCustomers().forEach(r => check("전기사용자", r["수요기업명"], r));
  if (typeof perfAlerts === "function") out.push(...perfAlerts()); // 연차 종료 30일 이내 미달 위험
  return out.sort((a, b) => a.d - b.d);
}
function renderAlerts() {
  const list = collectAlerts();
  document.getElementById("bellDot").hidden = !list.length;
  document.getElementById("bellPanel").innerHTML = `<div class="bell-head">알림</div>${list.length
    ? list.map(a => `<a class="bell-item" href="#${a.page}">${a.text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))}</a>`).join("")
    : `<div class="bell-empty">새 알림이 없습니다.</div>`}`;
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
  document.addEventListener("click", e => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  const picker = document.getElementById("monthPicker");
  if (!picker.value) { const d = new Date(); d.setMonth(d.getMonth() - 1); setHeaderMonth(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`); }
  picker.addEventListener("change", () => setHeaderMonth(getHeaderMonth(), true));
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "scroll"].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
  resetIdle();
  renderAlerts(); // 등록 정보를 불러온 뒤에는 registry.js 가 다시 부른다
}
