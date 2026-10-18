/* ============ 사이드 메뉴 / 페이지 전환 ============
 * 메뉴 링크(href="#settle-cust" 처럼 page id 에서 "page-" 를 뺀 값)를 누르면 주소의 # 이 바뀌고, hashchange 에서 해당 .page 를 보여준다.
 * (# 값이 요소 id 와 같으면 브라우저가 그 위치로 스크롤해 헤더가 가려지므로 일부러 다르게 둔다)
 * 새로고침해도 같은 페이지가 열린다. 업로드 카드(#uploadCard)는 하나만 두고 정산 페이지의 .upload-slot 으로 옮겨 쓴다.
 */
const PAGES = {
  "page-cust-perf":   { group: "contract", crumb: ["계약관리", "전기사용자"], title: "계약이행현황" },
  "page-gen-perf":    { group: "contract", crumb: ["계약관리", "발전사업자"], title: "계약이행현황" },
  "page-dash":        { group: "settle", crumb: ["정산관리"], title: "정산 대시보드" },
  "page-reg-cust":    { group: "settle", crumb: ["정산관리", "계약관리"], title: "전기사용자" },
  "page-reg-plant":   { group: "settle", crumb: ["정산관리", "계약관리"], title: "발전사업자" },
  "page-reg-group":   { group: "settle", crumb: ["정산관리", "계약관리"], title: "그룹화" },
  "page-settle-cust": { group: "settle", crumb: ["정산관리", "정산"], title: "전기사용자 정산" },
  "page-settle-gen":  { group: "settle", crumb: ["정산관리", "정산"], title: "발전사업자 정산" },
  "page-rate-kpx":    { group: "settle", crumb: ["정산관리", "정산", "정산요율관리"], title: "KPX 요율 관리" },
  "page-rate-tou":    { group: "settle", crumb: ["정산관리", "정산", "정산요율관리"], title: "시간대별 요금제 관리" },
  "page-rate-market": { group: "settle", crumb: ["정산관리", "정산", "정산요율관리"], title: "SMP · REC 가격" },
  "page-rec":         { group: "settle", crumb: ["정산관리"], title: "초과발전량 REC 관리" },
  "page-admin-users": { group: "settle", crumb: ["정산관리"], title: "권한관리", need: "admin" }
};
// 페이지별 수정 권한 (없으면 "조회 전용" 표시, 실제 저장은 서버가 막는다)
const PAGE_EDIT = { "page-cust-perf": "contract", "page-gen-perf": "contract", "page-reg-cust": "contract", "page-reg-plant": "contract", "page-reg-group": "contract",
  "page-settle-cust": "settle", "page-settle-gen": "settle", "page-rate-kpx": "rates", "page-rate-tou": "rates", "page-rate-market": "rates", "page-rec": "settle" };
const DEFAULT_PAGE = "page-settle-cust";
const NAV_KEY = "settlement.page";

function setSideGroup(group) {
  document.querySelectorAll(".side-toggle button").forEach(b => b.classList.toggle("active", b.dataset.group === group));
  document.querySelectorAll(".side-menu").forEach(m => { m.hidden = m.dataset.group !== group; });
}

const pageFromHash = () => "page-" + location.hash.replace(/^#/, "");

function showPage(id) {
  if (!PAGES[id] || (PAGES[id].need && typeof can === "function" && !can(PAGES[id].need))) id = DEFAULT_PAGE;
  const meta = PAGES[id];
  const ro = PAGE_EDIT[id] && typeof can === "function" && !can(PAGE_EDIT[id]);
  const roEl = document.getElementById("pageRo");
  if (roEl) { roEl.hidden = !ro; roEl.textContent = ro ? `조회 전용 · ${PERM_LABEL[PAGE_EDIT[id]]} 권한 없음` : ""; }
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".side-link").forEach(a => a.classList.toggle("active", a.dataset.page === id));
  setSideGroup(meta.group);
  // 활성 메뉴를 품은 폴더는 펼친다
  let folder = document.querySelector(`.side-link[data-page="${id}"]`);
  while (folder && (folder = folder.parentElement.closest(".side-folder"))) folder.classList.add("open");
  document.getElementById("pageCrumb").textContent = meta.crumb.join("  ›  ");
  document.getElementById("pageTitle").textContent = meta.title;
  const slot = document.querySelector(`#${id} .upload-slot`);
  if (slot) slot.appendChild(document.getElementById("uploadCard"));
  document.getElementById("uploadCard").dataset.ctx = id === "page-settle-gen" ? "gen" : "cust"; // 발전사업자 정산은 정산 구분 숨김
  if (id === "page-dash" && typeof renderDashboard === "function") renderDashboard(); // 정산 대시보드 (js/dashboard.js)
  if (id === "page-admin-users" && typeof renderUsersPage === "function") renderUsersPage(); // 권한관리 (js/users.js)
  if (id === "page-rec" && typeof renderRecPage === "function") renderRecPage(); // 초과발전량 REC (js/rec.js)
  try { localStorage.setItem(NAV_KEY, id); } catch (e) { /* 저장 불가 환경 */ }
  document.body.classList.remove("side-shown");
}

function initNav() {
  document.querySelectorAll(".side-link").forEach(a => {
    a.href = "#" + a.dataset.page.replace(/^page-/, "");
    const need = PAGES[a.dataset.page] && PAGES[a.dataset.page].need;
    if (need && typeof can === "function" && !can(need)) a.hidden = true; // 권한 없는 메뉴 숨김
  });
  document.querySelectorAll(".side-toggle button").forEach(b => b.addEventListener("click", () => setSideGroup(b.dataset.group)));
  document.querySelectorAll(".side-folder-btn").forEach(b => b.addEventListener("click", () => b.parentElement.classList.toggle("open")));
  document.getElementById("sideOpenBtn").addEventListener("click", () => document.body.classList.toggle("side-shown"));
  window.addEventListener("hashchange", () => { showPage(pageFromHash()); window.scrollTo(0, 0); });
  let start = pageFromHash();
  if (!PAGES[start]) { try { start = localStorage.getItem(NAV_KEY); } catch (e) { start = null; } }
  showPage(start);
}
