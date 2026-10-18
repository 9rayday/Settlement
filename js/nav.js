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
  "page-rate-market": { group: "settle", crumb: ["정산관리", "정산", "정산요율관리"], title: "SMP · REC 가격" }
};
const DEFAULT_PAGE = "page-settle-cust";
const NAV_KEY = "settlement.page";

function setSideGroup(group) {
  document.querySelectorAll(".side-toggle button").forEach(b => b.classList.toggle("active", b.dataset.group === group));
  document.querySelectorAll(".side-menu").forEach(m => { m.hidden = m.dataset.group !== group; });
}

const pageFromHash = () => "page-" + location.hash.replace(/^#/, "");

function showPage(id) {
  if (!PAGES[id]) id = DEFAULT_PAGE;
  const meta = PAGES[id];
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
  try { localStorage.setItem(NAV_KEY, id); } catch (e) { /* 저장 불가 환경 */ }
  document.body.classList.remove("side-shown");
}

function initNav() {
  document.querySelectorAll(".side-link").forEach(a => { a.href = "#" + a.dataset.page.replace(/^page-/, ""); });
  document.querySelectorAll(".side-toggle button").forEach(b => b.addEventListener("click", () => setSideGroup(b.dataset.group)));
  document.querySelectorAll(".side-folder-btn").forEach(b => b.addEventListener("click", () => b.parentElement.classList.toggle("open")));
  document.getElementById("sideOpenBtn").addEventListener("click", () => document.body.classList.toggle("side-shown"));
  window.addEventListener("hashchange", () => { showPage(pageFromHash()); window.scrollTo(0, 0); });
  let start = pageFromHash();
  if (!PAGES[start]) { try { start = localStorage.getItem(NAV_KEY); } catch (e) { start = null; } }
  showPage(start);
}
