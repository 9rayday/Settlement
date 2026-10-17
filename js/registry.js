/* ============ 정산관리 > 계약관리: 발전소 / 전기사용자 등록 + 그룹화 ============
 * 구글시트 "발전소 사업자 정보"(= 발전사업자 정산서 마스터, masterData)와 "전기사용자 정보" 탭을 읽고 행 단위로 저장/삭제한다.
 * 같은 KPX 신청번호를 가진 발전소들이 한 전기사용자 계약(그룹)이다. 계약을 누르면 그룹의 월별 발전소 집계를 보여준다.
 */
const GEN_REGIONS = ["비수도권", "수도권북", "수도권남", "제주"];
const DEMAND_REGIONS = ["수도권", "비수도권", "제주"];

// 화면 입력 항목 = 시트 컬럼명(k). req: 필수, type: text|number|date|select|textarea|group, calc: 자동 계산(읽기 전용)
// { section } 은 폼 안의 구분 제목. 기존 시트 컬럼(연락처·계약용량·계약일자·발전보장시간·배전연결)은 이름을 바꾸지 않고 라벨만 바꿔 쓴다.
const PLANT_FORM = [
  { section: "소유자정보" },
  { k: "사업자명", label: "사업자명" },
  { k: "사업자등록번호", label: "사업자등록번호" },
  { k: "대표자명", label: "대표자명" },
  { k: "이메일", label: "이메일" },
  { k: "연락처", label: "전화번호" },
  { k: "담당자", label: "담당자" },
  { k: "사업자주소", label: "사업자 주소", wide: true },
  { k: "계좌번호", label: "계좌번호" },
  { section: "발전기정보" },
  { k: "발전소명", label: "발전기명 (KPX 발전기명과 동일)", req: true },
  { k: "발전기ID", label: "발전기ID" },
  { k: "계약용량", label: "설비용량 (kW)", type: "kw" },
  { k: "배전연결", label: "발전망", type: "select", options: [["N", "송전망"], ["Y", "배전망"]] },
  { k: "변전소", label: "변전소" },
  { k: "한전고객번호", label: "한전고객번호" },
  { k: "지역(요금구분)", label: "지역 (송전요금 구분)", type: "select", options: GEN_REGIONS, req: true },
  { k: "KPX신청번호", label: "그룹 (전기사용자 계약)", type: "group" },
  { section: "계약정보" },
  { k: "정산방식", label: "정산방식", type: "select", options: ["", "실시간 정산", "월간균등 정산"] },
  { k: "계약단가", label: "계약단가 (원/kWh)", type: "number" },
  { k: "수수료율", label: "거래수수료 (원/kWh)", type: "number", placeholder: "0.1193" },
  { k: "계약기간", label: "계약기간 (년)", type: "number" },
  { k: "계약일자", label: "계약시작일", type: "date" },
  { k: "계약해지일", label: "계약해지일 (자동 계산)", type: "date", calc: true },
  { k: "연장가능여부", label: "연장가능여부", type: "select", options: ["", "가능", "불가"] },
  { k: "연장통보기한", label: "연장통보기한 (개월 전)", type: "number" },
  { k: "연장통보마감일", label: "연장통보 마감일 (자동 계산)", type: "date", calc: true },
  { k: "비고", label: "비고", type: "textarea", full: true },
  { section: "연간보장공급" },
  { k: "발전보장시간", label: "연간보장시간 (h/일)", type: "number", placeholder: "3.4" },
  { k: "연간보장공급량", label: "연간보장공급량 (kWh)", type: "number", calc: true },
  { k: "연간효율감소", label: "연간효율감소 (%/년)", type: "number" },
  { section: "위약금" },
  { info: "미달 위약금", text: "미달량 × 연차 기간 가중평균 REC 단가" },
  { k: "위약금처리방식", label: "처리 방식", type: "select", options: [["", "선택"], ["직접 납부", "직접 납부"], ["청구서 차감", "청구서 청구 (전력대금에서 차감)"]] },
  { k: "해지위약금", label: "해지 위약금", type: "textarea", full: true }
];
const CUSTOMER_FORM = [
  { section: "소유자정보" },
  { k: "수요기업명", label: "사업자명", req: true },
  { k: "사업자등록번호", label: "사업자등록번호" },
  { k: "대표자명", label: "대표자명" },
  { k: "이메일", label: "이메일" },
  { k: "연락처", label: "전화번호" },
  { k: "담당자", label: "담당자" },
  { section: "계약정보" },
  { k: "KPX신청번호", label: "KPX 신청번호 (그룹 키)", req: true, placeholder: "26-PR00000" },
  { k: "정산방식", label: "정산방식", type: "select", options: ["", "실시간 정산", "월간균등 정산"] },
  { k: "계약단가", label: "계약단가 (원/kWh)", type: "number", req: true },
  { k: "계약기간", label: "계약기간 (년)", type: "number" },
  { k: "계약일자", label: "계약시작일", type: "date" },
  { k: "계약해지일", label: "계약해지일 (자동 계산)", type: "date", calc: true },
  { k: "연장가능여부", label: "연장가능여부", type: "select", options: ["", "가능", "불가"] },
  { k: "연장통보기한", label: "연장통보기한 (개월 전)", type: "number" },
  { k: "연장통보마감일", label: "연장통보 마감일 (자동 계산)", type: "date", calc: true },
  { k: "비고", label: "비고", type: "textarea", full: true },
  { section: "전기사용장소" },
  { k: "사용장소명", label: "사용장소명" },
  { k: "소비계약신청번호", label: "소비계약신청번호" },
  { k: "전기사용장소", label: "주소", wide: true },
  { k: "수요망", label: "수요망", type: "select", options: ["", "송전망", "배전망"] },
  { k: "수요지지역", label: "수요지 지역 (송전요금 구분)", type: "select", options: DEMAND_REGIONS, req: true },
  { k: "한전계약전력", label: "한전계약전력 (kW)", type: "kw" },
  { k: "한전고객번호", label: "한전고객번호" },
  { section: "연간보장공급" },
  { k: "계약용량", label: "계약용량 (kW, 그룹 발전소 합계)", type: "kw" }, // 그룹 발전소가 있으면 합계(읽기 전용), 없으면 직접 입력
  { k: "연간보장시간", label: "연간보장시간 (h/일)", type: "number", placeholder: "3.4" },
  { k: "연간보장공급량", label: "연간보장공급량 (kWh)", type: "number", calc: true },
  { k: "연간효율감소", label: "연간효율감소 (%/년)", type: "number" },
  { section: "위약금" },
  { info: "미달 위약금", text: "미달량 × 연차 기간 가중평균 REC 단가" },
  { k: "위약금처리방식", label: "처리 방식", type: "select", options: [["", "선택"], ["직접 납부", "직접 납부"], ["청구서 차감", "청구서 청구 (전력대금에서 차감)"]] },
  { k: "해지위약금", label: "해지 위약금", type: "textarea", full: true }
];

const Registry = (function () {
  let customers = [];
  let loaded = false;
  const str = v => String(v == null ? "" : v).trim();

  async function load() {
    const [, c] = await Promise.all([fetchMaster(), gasGet("getCustomers")]); // fetchMaster 가 masterData 를 채운다
    customers = c || [];
    loaded = c !== null;
    return loaded;
  }
  const plants = () => masterData || {};
  const rawCustomers = () => customers;

  // 정산 엔진용 발전소 정보
  function plantInfo(name) {
    const m = plants()[name];
    if (!m) return null;
    return { region: str(m["지역(요금구분)"]), distConnected: str(m["배전연결"]).toUpperCase() === "Y", appNo: str(m["KPX신청번호"]) };
  }
  // 청구서/엔진용 전기사용자 정보
  function toCustomer(c) {
    return { name: str(c["수요기업명"]), ceo: str(c["대표자명"]), bizNo: str(c["사업자등록번호"]), address: str(c["전기사용장소"]),
      manager: str(c["담당자"]), contact: str(c["연락처"]), email: str(c["이메일"]), demandRegion: str(c["수요지지역"]),
      unitPrice: Number(c["계약단가"]), appNo: str(c["KPX신청번호"]), consumeAppNo: str(c["소비계약신청번호"]),
      start: str(c["계약일자"]), end: str(c["계약해지일"]) };
  }
  function customerByApp(app) { const c = customers.find(x => str(x["KPX신청번호"]) === str(app)); return c ? toCustomer(c) : null; }
  function plantsOfGroup(app) { return Object.keys(plants()).filter(p => str(plants()[p]["KPX신청번호"]) === str(app)); }

  async function save(kind, record, originalKey) {
    const r = await gasCall(kind === "plant" ? "savePlant" : "saveCustomer", { record, originalKey });
    if (r.ok) await load();
    return r;
  }
  async function remove(kind, key) {
    const r = await gasCall(kind === "plant" ? "deletePlant" : "deleteCustomer", { key });
    if (r.ok) await load();
    return r;
  }
  return { load, plants, rawCustomers, plantInfo, customerByApp, plantsOfGroup, save, remove, isLoaded: () => loaded };
})();

/* ---------- 화면: 정산관리 > 계약관리 (전기사용자 / 발전사업자 / 그룹화) ---------- */
const regState = { openCust: null, openPlant: null, openGroup: null, month: "", pages: { cust: 1, plant: 1, group: 1, perfCust: 1, perfGen: 1 } };
// 목록이 길면 페이지로 나눠 보여준다
const PAGE_SIZE = { cust: 12, plant: 10, group: 8, perfCust: 10, perfGen: 10 };
function pageSlice(kind, items) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE[kind]));
  const page = Math.min(Math.max(1, regState.pages[kind] || 1), pages);
  regState.pages[kind] = page;
  return { items: items.slice((page - 1) * PAGE_SIZE[kind], page * PAGE_SIZE[kind]), page, pages };
}
function pagerHtml(kind, page, pages) {
  if (pages <= 1) return "";
  const from = Math.max(1, Math.min(page - 2, pages - 4)), to = Math.min(pages, from + 4), nums = [];
  for (let i = from; i <= to; i++) nums.push(`<button type="button" data-kind="${kind}" data-page="${i}"${i === page ? ' class="active"' : ""}>${i}</button>`);
  return `<div class="pager"><button type="button" data-kind="${kind}" data-page="${page - 1}"${page === 1 ? " disabled" : ""}>이전</button>${nums.join("")}<button type="button" data-kind="${kind}" data-page="${page + 1}"${page === pages ? " disabled" : ""}>다음</button></div>`;
}
function bindPager(host, rerender) {
  host.querySelectorAll(".pager button[data-page]").forEach(b => b.onclick = () => { regState.pages[b.dataset.kind] = Number(b.dataset.page); rerender(); });
}
const r$ = id => document.getElementById(id);
const rEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rNum = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString();
const rStr = v => String(v == null ? "" : v).trim();
const custName = app => { const c = Registry.customerByApp(app); return c ? c.name : ""; };

// 용량(kW): 000.00 형식, 1,000 이상은 천 단위 쉼표
const parseKw = v => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? NaN : n; };
const fmtKw = v => { if (v === "" || v == null) return ""; const n = parseKw(v); return isNaN(n) ? String(v) : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
function bindKwInputs(host) {
  host.querySelectorAll("input.kw-in").forEach(el => el.addEventListener("blur", () => { if (!el.readOnly) el.value = fmtKw(el.value); }));
}

function regFormHtml(form, rec, prefix) {
  return `<div class="reg-form">${form.map((f, i) => {
    if (f.section) return `<div class="reg-section">${rEsc(f.section)}</div>`;
    if (f.info) return `<div class="reg-field"><label>${rEsc(f.info)}</label><div class="reg-info">${rEsc(f.text)}</div></div>`; // 입력 없는 안내 칸
    const v = rec[f.k] == null ? "" : String(rec[f.k]);
    const id = `${prefix}_${i}`, attrs = `id="${id}" data-k="${rEsc(f.k)}"`;
    let input;
    if (f.type === "select") input = `<select ${attrs}>${f.options.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${rEsc(val)}"${val === v ? " selected" : ""}>${rEsc(lab || "선택")}</option>`; }).join("")}</select>`;
    else if (f.type === "group") input = `<select ${attrs}><option value="">미연결</option>${Registry.rawCustomers().map(c => {
        const app = rStr(c["KPX신청번호"]); return `<option value="${rEsc(app)}"${app === v ? " selected" : ""}>${rEsc(app)} · ${rEsc(c["수요기업명"])}</option>`; }).join("")}
        ${v && !Registry.customerByApp(v) ? `<option value="${rEsc(v)}" selected>${rEsc(v)} (계약 미등록)</option>` : ""}</select>`;
    else if (f.type === "textarea") input = `<textarea ${attrs} rows="3">${rEsc(v)}</textarea>`;
    else if (f.type === "kw") input = `<input ${attrs} type="text" inputmode="decimal" class="kw-in"${f.calc ? " readonly" : ""} value="${rEsc(fmtKw(v))}" placeholder="0.00">`;
    else input = `<input ${attrs} type="${f.type || "text"}"${f.type === "number" ? ' step="any"' : ""}${f.calc ? " readonly" : ""} value="${rEsc(v)}" placeholder="${rEsc(f.placeholder || "")}">`;
    return `<div class="reg-field${f.wide ? " wide" : ""}${f.full ? " full" : ""}"><label for="${id}">${rEsc(f.label)}${f.req ? ' <span class="req">*</span>' : ""}</label>${input}</div>`;
  }).join("")}</div>`;
}

/* ----- 발전소 폼 자동 계산 ----- */
function addMonthsYmd(ymd, months, dayOffset) { // 말일 넘침은 그 달 말일로
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last) + (dayOffset || 0));
  return t.toISOString().slice(0, 10);
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
// 계약해지일 = 시작일 + 계약기간 − 1일, 연장통보 마감일 = 해지일 − 통보기한(개월)
function calcContractDates(rec) {
  const start = rStr(rec["계약일자"]), yrs = Number(rec["계약기간"]), notice = Number(rec["연장통보기한"]);
  if (YMD.test(start) && yrs > 0) rec["계약해지일"] = addMonthsYmd(start, Math.round(yrs * 12), -1);
  const end = rStr(rec["계약해지일"]);
  rec["연장통보마감일"] = YMD.test(end) && notice > 0 ? addMonthsYmd(end, -notice, 0) : "";
  return rec;
}
/* ----- 전기사용자 계약용량 = 그룹 발전소 설비용량 합, 연간보장공급량 = 계약용량 × 보장시간(h/일) × 365 ----- */
const hoursPerDay = v => { v = Number(v); return v > 24 ? v / 365 : v; }; // 예전에 h/년으로 저장된 값도 h/일로 해석
const groupCapacity = app => Registry.plantsOfGroup(app).reduce((s, p) => s + (Number(Registry.plants()[p]["계약용량"]) || 0), 0);
const guaranteeOf = (cap, hours) => { cap = Number(cap); hours = Number(hours); return cap > 0 && hours > 0 ? Number((cap * hours).toFixed(3)) : ""; };
// 그룹 구성이나 발전소 용량이 바뀌면 해당 전기사용자 행의 계약용량·연간보장공급량을 다시 저장한다
async function syncGroupTotals(apps) {
  for (const app of new Set(apps.map(rStr).filter(Boolean))) {
    const raw = Registry.rawCustomers().find(c => rStr(c["KPX신청번호"]) === app);
    if (!raw) continue;
    const cap = groupCapacity(app); if (!(cap > 0)) continue; // 그룹 발전소가 없으면 직접 입력값 유지
    const g = guaranteeOf(cap, hoursPerDay(raw["연간보장시간"]) * 365);
    if (Number(raw["계약용량"]) === cap && String(raw["연간보장공급량"]) === String(g)) continue;
    await Registry.save("customer", { "KPX신청번호": app, "계약용량": cap, "연간보장공급량": g }, app);
  }
}
const plantGroupOf = name => name && Registry.plants()[name] ? rStr(Registry.plants()[name]["KPX신청번호"]) : "";

// 발전소·전기사용자 폼 공통. 발전소 폼에만 있는 설비용량/보장시간이 있으면 연간보장공급량 참고값도 보여준다
function bindContractCalc(hostId) {
  const host = r$(hostId), el = k => host.querySelector(`[data-k="${k}"]`);
  const update = () => {
    const rec = calcContractDates({ "계약일자": el("계약일자").value, "계약기간": el("계약기간").value, "연장통보기한": el("연장통보기한").value, "계약해지일": el("계약해지일").value });
    el("계약해지일").value = rec["계약해지일"] || ""; el("연장통보마감일").value = rec["연장통보마감일"];
    const hEl = el("연간보장시간") || el("발전보장시간"); // 전기사용자 / 발전소
    if (el("계약용량") && hEl) el("연간보장공급량").value = guaranteeOf(parseKw(el("계약용량").value), Number(hEl.value) * 365); // 용량 × 시간(h/일) × 365
  };
  ["계약일자", "계약기간", "연장통보기한", "계약용량", "연간보장시간", "발전보장시간"].forEach(k => { if (el(k)) el(k).addEventListener("input", update); });
  bindKwInputs(host);
  update();
}
// 발전사업자 정산서는 "사업자명(대표자명)" 한 칸을 쓰므로 저장할 때 합쳐 두고, 열 때는 나눠서 보여준다
function splitOwnerName(raw) {
  const comb = rStr(raw["사업자명(대표자명)"]);
  if (!rStr(raw["사업자명"]) && comb) { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(comb); raw["사업자명"] = m ? m[1] : comb; if (m && !rStr(raw["대표자명"])) raw["대표자명"] = m[2]; }
  return raw;
}
const joinOwnerName = rec => rec["대표자명"] ? `${rec["사업자명"]}(${rec["대표자명"]})` : rec["사업자명"];
function readRegForm(hostId, form) {
  const rec = {};
  r$(hostId).querySelectorAll("[data-k]").forEach(el => { rec[el.dataset.k] = el.value.trim(); });
  form.filter(f => f.type === "number").forEach(f => { if (rec[f.k] !== "") rec[f.k] = Number(rec[f.k]); });
  form.filter(f => f.type === "kw").forEach(f => { if (rec[f.k] !== "") { const n = parseKw(rec[f.k]); if (isNaN(n)) throw new Error(f.label + " 은(는) 숫자로 입력하세요."); rec[f.k] = n; } });
  const missing = form.filter(f => f.req && (rec[f.k] === "" || rec[f.k] == null)).map(f => f.label);
  if (missing.length) throw new Error("필수 항목을 입력하세요: " + missing.join(", "));
  return rec;
}
const loadFailNotice = () => Registry.isLoaded() ? "" : `<div class="notice warn">구글시트에서 등록 정보를 불러오지 못했습니다. Apps Script를 최신 Code.gs로 "새 버전" 재배포했는지 확인하세요.</div>`;
function markActive(selector, attr, value) {
  document.querySelectorAll(selector).forEach(el => el.classList.toggle("active", el.dataset[attr] === value));
}
function custCardsHtml(activeApp, cls, custs) {
  if (!custs.length) return `<div class="hint">등록된 계약이 없습니다.</div>`;
  return custs.map(c => {
    const app = rStr(c["KPX신청번호"]), n = Registry.plantsOfGroup(app).length;
    return `<button class="reg-card ${cls}${activeApp === app ? " active" : ""}" data-app="${rEsc(app)}">
      <div class="reg-card-title">${rEsc(c["수요기업명"])}</div><div class="reg-card-sub">${rEsc(app)}</div>
      <div class="reg-card-meta"><span>${rEsc(c["수요지지역"] || "-")}</span><span>${rEsc(c["계약단가"] === "" ? "-" : c["계약단가"])} 원/kWh</span><span>발전소 ${n}개</span></div></button>`;
  }).join("");
}

/* ----- 전기사용자 ----- */
function renderCustomerPage() {
  const host = r$("regCustPage"); if (!host) return;
  const pg = pageSlice("cust", Registry.rawCustomers());
  host.innerHTML = `${loadFailNotice()}<div class="card">
      <div class="reg-head"><h2>전력거래계약</h2><button class="btn secondary" id="regAddCust">+ 전기사용자 추가</button></div>
      <div class="reg-cards">${custCardsHtml(regState.openCust, "cust-card", pg.items)}</div>${pagerHtml("cust", pg.page, pg.pages)}
      <div id="regCustDetail"></div></div>`;
  bindPager(host, renderCustomerPage);
  host.querySelectorAll(".cust-card").forEach(b => b.onclick = () => openCustomer(b.dataset.app));
  r$("regAddCust").onclick = () => openCustomer("");
  if (regState.openCust !== null) openCustomer(regState.openCust, true);
}

function openCustomer(app, keepScroll) {
  regState.openCust = app; markActive(".cust-card", "app", app);
  const raw = Object.assign({}, Registry.rawCustomers().find(c => rStr(c["KPX신청번호"]) === app) || { "수요지지역": "비수도권" });
  const isNew = !app, plants = isNew ? [] : Registry.plantsOfGroup(app);
  const gcap = isNew ? 0 : groupCapacity(app);
  if (gcap > 0) raw["계약용량"] = gcap;
  if (Number(raw["연간보장시간"]) > 24) raw["연간보장시간"] = Number((raw["연간보장시간"] / 365).toFixed(4)); // 예전 h/년 값 → h/일
  r$("regCustDetail").innerHTML = `<div class="reg-detail">
    <div class="reg-head"><h3 class="sub" style="margin:0">${isNew ? "새 전기사용자" : rEsc(raw["수요기업명"]) + " 계약 정보"}</h3><button class="btn secondary" id="regCustClose">닫기</button></div>
    <div id="regCustForm">${regFormHtml(CUSTOMER_FORM, raw, "cf")}</div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="regCustSave">저장</button>${isNew ? "" : '<button class="btn secondary danger" id="regCustDel">삭제</button>'}<span id="regCustStatus" class="status warn" style="background:none"></span></div>
  </div>`;
  if (gcap > 0) r$("regCustForm").querySelector('[data-k="계약용량"]').readOnly = true;
  bindContractCalc("regCustForm");
  r$("regCustClose").onclick = () => { regState.openCust = null; markActive(".cust-card", "app", null); r$("regCustDetail").innerHTML = ""; };
  r$("regCustSave").onclick = () => saveRegistry("customer", "regCustForm", CUSTOMER_FORM, isNew ? "" : app, "regCustStatus");
  if (!isNew) {
    r$("regCustDel").onclick = () => deleteRegistry("customer", app, raw["수요기업명"], "regCustStatus");
  }
  if (!keepScroll) r$("regCustDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ----- 발전사업자 ----- */
function renderPlantPage() {
  const host = r$("regPlantPage"); if (!host) return;
  const plants = Registry.plants(), pg = pageSlice("plant", Object.keys(plants));
  host.innerHTML = `${loadFailNotice()}<div class="card">
      <div class="reg-head"><h2>전력공급계약</h2><button class="btn secondary" id="regAddPlant">+ 발전소 추가</button></div>
      <div class="grid-wrap"><table class="grid reg-table"><tr><th>발전소명</th><th>사업자명</th><th>지역</th><th>배전</th><th>그룹 (전기사용자)</th><th>계약용량(kW)</th><th>매입단가</th><th>계약일자</th></tr>
        ${pg.items.map(p => { const m = plants[p], app = rStr(m["KPX신청번호"]);
          return `<tr class="reg-row${regState.openPlant === p ? " active" : ""}" data-plant="${rEsc(p)}"><td><b>${rEsc(p)}</b></td><td>${rEsc(m["사업자명(대표자명)"])}</td>
            <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${rStr(m["배전연결"]).toUpperCase() === "Y" ? "Y" : "-"}</td>
            <td>${app ? `${rEsc(custName(app) || "계약 미등록")} <span class="hint" style="margin:0">${rEsc(app)}</span>` : '<span class="hint" style="margin:0">미연결</span>'}</td>
            <td class="num">${rEsc(fmtKw(m["계약용량"]))}</td><td class="num">${rEsc(m["계약단가"])}</td><td>${rEsc(m["계약일자"])}</td></tr>`; }).join("")}</table></div>${pagerHtml("plant", pg.page, pg.pages)}
      <div id="regPlantDetail"></div></div>`;
  bindPager(host, renderPlantPage);
  host.querySelectorAll(".reg-row").forEach(tr => tr.onclick = () => openPlant(tr.dataset.plant));
  r$("regAddPlant").onclick = () => openPlant("");
  if (regState.openPlant !== null) openPlant(regState.openPlant, true);
}

function openPlant(name, keepScroll) {
  regState.openPlant = name; markActive(".reg-row", "plant", name);
  const isNew = !name;
  const raw = isNew ? { "지역(요금구분)": "비수도권", "배전연결": "N" } : splitOwnerName(Object.assign({}, Registry.plants()[name]));
  raw["배전연결"] = rStr(raw["배전연결"]).toUpperCase() === "Y" ? "Y" : "N";
  r$("regPlantDetail").innerHTML = `<div class="reg-detail">
    <div class="reg-head"><h3 class="sub" style="margin:0">${isNew ? "새 발전소" : rEsc(name)}</h3><button class="btn secondary" id="regPlantClose">닫기</button></div>
    <div id="regPlantForm">${regFormHtml(PLANT_FORM, raw, "pf")}</div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="regPlantSave">저장</button>${isNew ? "" : '<button class="btn secondary danger" id="regPlantDel">삭제</button>'}<span id="regPlantStatus" class="status warn" style="background:none"></span></div>
  </div>`;
  bindContractCalc("regPlantForm");
  r$("regPlantClose").onclick = () => { regState.openPlant = null; markActive(".reg-row", "plant", null); r$("regPlantDetail").innerHTML = ""; };
  r$("regPlantSave").onclick = () => saveRegistry("plant", "regPlantForm", PLANT_FORM, name, "regPlantStatus");
  if (!isNew) r$("regPlantDel").onclick = () => deleteRegistry("plant", name, name, "regPlantStatus");
  if (!keepScroll) r$("regPlantDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ----- 그룹화: 전기사용자 계약 하나 = 같은 KPX 신청번호의 발전소 묶음 ----- */
function renderGroupPage() {
  const host = r$("regGroupPage"); if (!host) return;
  const custs = Registry.rawCustomers(), all = Registry.plants();
  const unlinked = Object.keys(all).filter(p => { const a = rStr(all[p]["KPX신청번호"]); return !a || !Registry.customerByApp(a); });
  if (regState.openGroup === null && custs.length) regState.openGroup = rStr(custs[0]["KPX신청번호"]);
  const pg = pageSlice("group", custs);
  host.innerHTML = `${loadFailNotice()}<div class="group-layout">
    <div class="card group-list"><h2>PPA 계약</h2>
      <div class="reg-cards single">${custCardsHtml(regState.openGroup, "group-card", pg.items)}</div>${pagerHtml("group", pg.page, pg.pages)}
      <p class="hint" style="margin-top:10px">그룹 미연결 발전소: <b>${unlinked.length}</b>개</p></div>
    <div class="card group-main" id="regGroupMain"></div></div>`;
  bindPager(host, renderGroupPage);
  host.querySelectorAll(".group-card").forEach(b => b.onclick = () => { regState.openGroup = b.dataset.app; markActive(".group-card", "app", b.dataset.app); renderGroupMain(); });
  renderGroupMain();
}

function renderGroupMain() {
  const host = r$("regGroupMain"); if (!host) return;
  const app = regState.openGroup, c = app && Registry.customerByApp(app);
  if (!c) { host.innerHTML = `<div class="hint">등록된 계약이 없습니다.</div>`; return; }
  const members = Registry.plantsOfGroup(app), all = Registry.plants();
  const others = Object.keys(all).filter(p => !members.includes(p));
  if (!regState.month) regState.month = defaultMonth(app);
  host.innerHTML = `<div><h2>${rEsc(c.name)}</h2><div class="hint" style="margin:2px 0 0">${rEsc(app)} · ${rEsc(c.demandRegion || "-")} · ${rEsc(isNaN(c.unitPrice) ? "-" : c.unitPrice)} 원/kWh</div></div>
    <h3 class="sub">소속 발전소 (${members.length})</h3>
    <div class="grid-wrap"><table class="grid"><tr><th>발전소</th><th>사업자명</th><th>지역</th><th>배전</th><th>계약용량(kW)</th><th></th></tr>
      ${members.length ? members.map(p => { const m = all[p]; return `<tr><td><b>${rEsc(p)}</b></td><td>${rEsc(m["사업자명(대표자명)"])}</td>
        <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${rStr(m["배전연결"]).toUpperCase() === "Y" ? "Y" : "-"}</td>
        <td class="num">${rEsc(fmtKw(m["계약용량"]))}</td><td style="text-align:center"><button class="btn secondary small grp-remove" data-plant="${rEsc(p)}">제외</button></td></tr>`; }).join("")
        : `<tr><td colspan="6" class="hint">아직 묶인 발전소가 없습니다.</td></tr>`}</table></div>
    <div class="row" style="margin-top:10px"><select id="grpAddSel" style="min-width:300px">${others.map(p => { const a = rStr(all[p]["KPX신청번호"]);
        return `<option value="${rEsc(p)}">${rEsc(p)}${a ? ` (현재: ${rEsc(custName(a) || a)})` : " (미연결)"}</option>`; }).join("")}</select>
      <button class="btn accent" id="grpAddBtn"${others.length ? "" : " disabled"}>그룹에 추가</button><span id="grpStatus" class="status warn" style="background:none"></span></div>
    <div class="reg-group">
      <div class="reg-head"><h3 class="sub" style="margin:0">월별 발전소 집계</h3>
        <div class="row"><label class="adj-label">정산월</label><input type="month" id="regMonth" value="${regState.month.slice(0, 4)}-${regState.month.slice(4)}"></div></div>
      <div id="regAgg"><div class="hint">불러오는 중...</div></div></div>`;
  host.querySelectorAll(".grp-remove").forEach(b => b.onclick = () => setPlantGroup(b.dataset.plant, ""));
  r$("grpAddBtn").onclick = () => {
    const p = r$("grpAddSel").value, cur = rStr(all[p]["KPX신청번호"]);
    if (cur && cur !== app && !confirm(`${p} 은(는) 지금 ${custName(cur) || cur} 그룹입니다. ${c.name} 그룹으로 옮길까요?`)) return;
    setPlantGroup(p, app);
  };
  r$("regMonth").onchange = e => { regState.month = e.target.value.replace("-", ""); renderGroupAgg(app); };
  renderGroupAgg(app);
}

// 발전소의 KPX 신청번호(그룹)만 바꿔 저장 (시트의 다른 칸은 그대로)
async function setPlantGroup(plant, app) {
  const st = r$("grpStatus"); st.textContent = "저장 중..."; st.className = "status warn";
  const oldGroup = plantGroupOf(plant);
  const r = await Registry.save("plant", { "발전소명": plant, "KPX신청번호": app }, plant);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
  await syncGroupTotals([oldGroup, app]); // 계약용량·연간보장공급량 자동 갱신
  afterRegistryChange();
  const st2 = r$("grpStatus"); if (st2) { st2.textContent = `${plant} → ${app ? "그룹에 추가" : "그룹에서 제외"} (구글시트 저장)`; st2.className = "status ok"; }
}

function defaultMonth(app) {
  const g = typeof billState !== "undefined" && billState.kpx && (app ? billState.kpx.groups[app] : Object.values(billState.kpx.groups)[0]);
  if (g) return g.month;
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 업로드한 KPX 파일에 이 그룹·월이 있으면 그 값을, 없으면 월별실적로그(가정산 업로드 때 기록)를 쓴다.
// 공급량 = KPX 재생E공급량, 초과발전량 = 발전량 − 공급량
async function renderGroupAgg(app) {
  const host = r$("regAgg"); if (!host) return;
  const month = regState.month;
  const registered = Registry.plantsOfGroup(app);
  const g = typeof billState !== "undefined" && billState.kpx && billState.kpx.groups[app];
  let rows = {}, source;
  if (g && g.month === month) {
    const sum = obj => Object.values(obj).reduce((s, arr) => s + arr.reduce((a, b) => a + (b || 0), 0), 0);
    Object.keys(g.plants).forEach(p => { const gen = sum(g.plants[p].gen), sup = sum(g.plants[p].kpxSupply); rows[p] = { generation: gen, supply: sup, excess: gen - sup }; });
    source = `업로드한 KPX 파일 (${typeof getSettleMode === "function" && getSettleMode() === "trueup" ? "오차정산" : "가정산"})`;
  } else {
    host.innerHTML = `<div class="hint">불러오는 중...</div>`;
    const perf = await gasGet("getPerformanceMonth", { month });
    if (regState.openGroup !== app || regState.month !== month) return; // 그새 다른 계약/월을 고름
    if (perf === null) { host.innerHTML = `<div class="notice warn">월별 실적을 불러오지 못했습니다. (Apps Script 재배포 필요할 수 있음)</div>`; return; }
    registered.forEach(p => { if (perf[p]) rows[p] = perf[p]; });
    source = "월별실적로그 (가정산 업로드 시 기록)";
  }
  const names = Array.from(new Set(registered.concat(Object.keys(rows))));
  if (!names.length) { host.innerHTML = `<div class="hint">이 신청번호로 연결된 발전소가 없습니다. 위에서 [그룹에 추가]로 발전소를 묶으세요.</div>`; return; }
  const tot = { generation: 0, supply: 0, excess: 0 };
  const body = names.map(p => {
    const r = rows[p], info = Registry.plantInfo(p);
    if (r) { tot.generation += r.generation; tot.supply += r.supply; tot.excess += r.excess; }
    const flag = !info ? '<span class="tag bad">미등록</span>' : (!registered.includes(p) ? '<span class="tag">다른 그룹</span>' : "");
    return `<tr><td>${rEsc(p)} ${flag}</td><td>${rEsc(info ? info.region || "-" : "-")}</td><td class="num">${r ? rNum(r.generation) : "-"}</td><td class="num">${r ? rNum(r.supply) : "-"}</td><td class="num">${r ? rNum(r.excess) : "-"}</td></tr>`;
  }).join("");
  const hasData = Object.keys(rows).length > 0;
  host.innerHTML = `<div class="kpi-grid">
      <div class="kpi"><div class="label">발전량 (kWh)</div><div class="value">${rNum(tot.generation)}</div></div>
      <div class="kpi"><div class="label">공급량 · 재생E (kWh)</div><div class="value">${rNum(tot.supply)}</div></div>
      <div class="kpi"><div class="label">초과발전량 (kWh)</div><div class="value">${rNum(tot.excess)}</div></div></div>
    <div class="grid-wrap" style="margin-top:10px"><table class="grid"><tr><th>발전소</th><th>지역</th><th>발전량 (kWh)</th><th>공급량 (kWh)</th><th>초과발전량 (kWh)</th></tr>${body}
      <tr class="total"><td><b>계</b></td><td></td><td class="num"><b>${rNum(tot.generation)}</b></td><td class="num"><b>${rNum(tot.supply)}</b></td><td class="num"><b>${rNum(tot.excess)}</b></td></tr></table></div>
    ${hasData ? "" : `<p class="hint">${month.slice(0, 4)}.${month.slice(4)} 실적이 없습니다.</p>`}`;
}

async function saveRegistry(kind, formId, form, originalKey, statusId) {
  const st = r$(statusId);
  let rec;
  try { rec = readRegForm(formId, form); } catch (e) { st.textContent = e.message; st.className = "status bad"; return; }
  calcContractDates(rec);
  if (kind === "plant") {
    rec["사업자명(대표자명)"] = joinOwnerName(rec);
    rec["연간보장공급량"] = guaranteeOf(rec["계약용량"], Number(rec["발전보장시간"]) * 365);
  }
  else { const gc = groupCapacity(rec["KPX신청번호"]); if (gc > 0) rec["계약용량"] = gc; rec["연간보장공급량"] = guaranteeOf(rec["계약용량"], hoursPerDay(rec["연간보장시간"]) * 365); }
  const oldGroup = kind === "plant" ? plantGroupOf(originalKey) : "";
  st.textContent = "저장 중..."; st.className = "status warn";
  const r = await Registry.save(kind, rec, originalKey);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
  if (kind === "plant") await syncGroupTotals([oldGroup, rec["KPX신청번호"]]);
  if (kind === "plant") regState.openPlant = rec["발전소명"]; else regState.openCust = rec["KPX신청번호"];
  afterRegistryChange();
  const st2 = r$(statusId); if (st2) { st2.textContent = "저장 완료 (구글시트)"; st2.className = "status ok"; }
}

async function deleteRegistry(kind, key, label, statusId) {
  if (!confirm(`${label} 을(를) 삭제할까요? 구글시트에서도 행이 지워집니다.`)) return;
  const st = r$(statusId); st.textContent = "삭제 중..."; st.className = "status warn";
  const oldGroup = kind === "plant" ? plantGroupOf(key) : "";
  const r = await Registry.remove(kind, key);
  if (!r.ok) { st.textContent = "삭제 실패: " + r.error; st.className = "status bad"; return; }
  if (oldGroup) await syncGroupTotals([oldGroup]);
  if (kind === "plant") regState.openPlant = null; else regState.openCust = null;
  afterRegistryChange();
}

// 등록 정보가 바뀌면 계약관리 화면과 정산 화면(그룹 이름·발전소 지역)을 다시 그린다
function afterRegistryChange() {
  renderRegistry();
  if (typeof renderPerfPages === "function") renderPerfPages();
  if (typeof renderAlerts === "function") renderAlerts();
  if (typeof renderBillingBody === "function") renderBillingBody();
  if (typeof refreshPlantSelect === "function" && typeof plants !== "undefined" && plants.length) refreshPlantSelect(); // 발전사업자 정산서 미리보기 갱신
}

function renderRegistry() { renderCustomerPage(); renderPlantPage(); renderGroupPage(); }

async function initRegistry() {
  ["regCustPage", "regPlantPage", "regGroupPage"].forEach(id => { r$(id).innerHTML = `<div class="card"><div class="hint">등록 정보를 불러오는 중...</div></div>`; });
  await Registry.load();
  renderRegistry();
  if (typeof renderAlerts === "function") renderAlerts(); // 헤더 알림 (계약 마감 임박)
  if (typeof renderBillingBody === "function") renderBillingBody();
}
