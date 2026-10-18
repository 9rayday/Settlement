/* ============ 정산관리 > 계약관리: 발전소 / 전기사용자 등록 + 그룹화 ============
 * 구글시트 "발전소 사업자 정보"(= 발전사업자 정산서 마스터, masterData)와 "전기사용자 정보" 탭을 읽고 행 단위로 저장/삭제한다.
 * 같은 KPX 신청번호를 가진 발전소들이 한 전기사용자 계약(그룹)이다. 계약을 누르면 그룹의 월별 발전소 집계를 보여준다.
 */
const GEN_REGIONS = ["비수도권", "수도권북", "수도권남"];  // 등록 화면 지역 선택 (제주 제외)
const DEMAND_REGIONS = ["수도권", "비수도권"];
const GRID_LABEL = { N: "송전", L: "배전저압", Y: "배전고압" };
const gridOf = v => { v = String(v == null ? "" : v).trim().toUpperCase(); return v === "Y" || v === "L" ? v : "N"; };

// 화면 입력 항목 = 시트 컬럼명(k). req: 필수, type: text|number|date|select|textarea|group, calc: 자동 계산(읽기 전용)
// { section } 은 폼 안의 구분 제목. 기존 시트 컬럼(연락처·계약용량·계약일자·발전보장시간·배전연결)은 이름을 바꾸지 않고 라벨만 바꿔 쓴다.
const PLANT_FORM = [
  { section: "소유자정보" },
  { k: "사업자명", label: "사업자명" },
  { k: "사업자등록번호", label: "사업자등록번호" },
  { k: "대표자명", label: "대표자명" },
  { k: "담당자", label: "담당자" },
  { k: "이메일", label: "이메일" },
  { k: "연락처", label: "전화번호" },
  { k: "사업자주소", label: "사업자 주소", wide: true },
  { k: "계좌번호", label: "계좌번호" },
  { section: "발전기정보" },
  { k: "발전소명", label: "발전기명 (KPX 발전기명과 동일)", req: true },
  { k: "발전기ID", label: "발전기ID" },
  { k: "계약용량", label: "설비용량 (kW)", type: "kw" },
  { k: "배전연결", label: "발전망", type: "select", options: [["N", "송전망"], ["L", "배전저압망"], ["Y", "배전고압망"]] },
  { k: "접속점", label: "접속점" },
  { k: "한전고객번호", label: "한전고객번호" },
  { k: "지역(요금구분)", label: "지역 (송전요금 구분)", type: "select", options: GEN_REGIONS, req: true },
  { k: "계약ID", label: "PPA 계약 (계약ID)", type: "contract" }, // 저장 시 KPX신청번호는 계약에서 자동으로
  { section: "계약정보" },
  { k: "정산방식", label: "정산방식", type: "select", options: ["", "실시간 정산", "월간균등 정산"] },
  { k: "계약단가", label: "계약단가 (원/kWh)", type: "number" },
  { k: "수수료율", label: "거래수수료 (원/kWh)", type: "number", placeholder: "0.1193" },
  { k: "계약기간", label: "계약기간 (년)", type: "number" },
  { k: "계약일자", label: "계약시작일", type: "date" },
  { k: "계약해지일", label: "계약해지일 (자동 계산)", type: "date", calc: true },
  { k: "계약상태", label: "계약상태", type: "select", options: [["", "진행"], ["해지", "해지"]] },
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
  { k: "담당자", label: "담당자" },
  { k: "이메일", label: "이메일" },
  { k: "연락처", label: "전화번호" },
  { section: "계약정보" },
  { k: "계약ID", label: "계약ID", req: true, placeholder: "예: 삼성D_5년" },
  { k: "KPX신청번호", label: "KPX 신청번호 (그룹)", req: true, placeholder: "26-PR00000" },
  { k: "정산방식", label: "정산방식", type: "select", options: ["", "실시간 정산", "월간균등 정산"] },
  { k: "계약단가", label: "계약단가 (원/kWh)", type: "number", req: true },
  { k: "입금계좌", label: "입금계좌 (청구서 계좌번호)", placeholder: "예: 기업은행 001-983767-04-015" },
  { k: "청구서번호", label: "청구서 번호 앞자리", placeholder: "200005" },
  { k: "계약기간", label: "계약기간 (년)", type: "number" },
  { k: "계약일자", label: "계약시작일", type: "date" },
  { k: "계약해지일", label: "계약해지일 (자동 계산)", type: "date", calc: true },
  { k: "계약상태", label: "계약상태", type: "select", options: [["", "진행"], ["해지", "해지"]] },
  { k: "연장가능여부", label: "연장가능여부", type: "select", options: ["", "가능", "불가"] },
  { k: "연장통보기한", label: "연장통보기한 (개월 전)", type: "number" },
  { k: "연장통보마감일", label: "연장통보 마감일 (자동 계산)", type: "date", calc: true },
  { k: "비고", label: "비고", type: "textarea", full: true },
  { section: "전기사용장소" },
  { k: "사용장소명", label: "사용장소명" },
  { k: "소비계약신청번호", label: "소비계약신청번호" },
  { k: "전기사용장소", label: "주소", wide: true },
  { k: "수요망", label: "수요망 (배전망이면 망이용요금에 배전요금 추가)", type: "select", options: ["", "송전망", "배전망"] },
  { k: "접속점", label: "접속점 (배전망: 발전소와 같으면 배전요금만)" },
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
    const grid = gridOf(m["배전연결"]); // 배전망이면 배전이용요금 추가 (저압/고압 요금 구분)
    return { region: str(m["지역(요금구분)"]), distConnected: grid !== "N", distLow: grid === "L", node: str(m["접속점"]), appNo: str(m["KPX신청번호"]) };
  }
  // 청구서/엔진용 전기사용자 정보
  function toCustomer(c) {
    return { name: str(c["수요기업명"]), ceo: str(c["대표자명"]), bizNo: str(c["사업자등록번호"]), address: str(c["전기사용장소"]),
      manager: str(c["담당자"]), contact: str(c["연락처"]), email: str(c["이메일"]), demandRegion: str(c["수요지지역"]), demandGrid: str(c["수요망"]), demandNode: str(c["접속점"]),
      unitPrice: Number(c["계약단가"]), appNo: str(c["KPX신청번호"]), consumeAppNo: str(c["소비계약신청번호"]), settleMethod: str(c["정산방식"]), payAccount: str(c["입금계좌"]), invoicePrefix: str(c["청구서번호"]),
      start: str(c["계약일자"]), end: str(c["계약해지일"]), contractId: custKey(c) };
  }
  // 계약 키 = 계약ID (예전 행은 KPX신청번호). 같은 신청번호에 계약이 여러 건일 수 있다.
  const custKey = c => str(c["계약ID"]) || str(c["KPX신청번호"]);
  const contractsOfApp = app => customers.filter(x => str(x["KPX신청번호"]) === str(app));
  const customerByKey = key => customers.find(x => custKey(x) === str(key)) || null;
  function groups() { const out = []; customers.forEach(c => { const a = str(c["KPX신청번호"]); if (a && !out.includes(a)) out.push(a); }); return out; }
  // 그 달(YYYYMM)에 유효한 계약과 계약용량 비율 → 정산서 전력량요금을 계약별 단가로 나눌 때 사용
  // supplyByPlant 가 있으면 각 계약에 매핑된 발전소 공급량 비율, 매핑 안 된 발전소 공급량은 계약용량 비율로 나눈다
  function priceSplits(app, month, supplyByPlant) {
    const ms = `${month.slice(0, 4)}-${month.slice(4)}-01`, me = `${month.slice(0, 4)}-${month.slice(4)}-31`;
    const act = contractsOfApp(app).filter(c => (!str(c["계약일자"]) || str(c["계약일자"]) <= me) && (!str(c["계약해지일"]) || str(c["계약해지일"]) >= ms));
    if (act.length <= 1) return null;
    const tot = act.reduce((t, c) => t + (Number(c["계약용량"]) || 0), 0);
    const capShare = c => tot > 0 ? (Number(c["계약용량"]) || 0) / tot : 1 / act.length;
    const total = supplyByPlant ? Object.values(supplyByPlant).reduce((t, v) => t + (v || 0), 0) : 0;
    if (total > 0) {
      const byC = {}; act.forEach(c => { byC[custKey(c)] = 0; }); let unmapped = 0;
      Object.entries(supplyByPlant).forEach(([p, v]) => { const k = plantContract(p); if (k in byC) byC[k] += v || 0; else unmapped += v || 0; });
      return act.map(c => ({ id: custKey(c), unitPrice: Number(c["계약단가"]), share: (byC[custKey(c)] + unmapped * capShare(c)) / total }));
    }
    return act.map(c => ({ id: custKey(c), unitPrice: Number(c["계약단가"]), share: capShare(c) }));
  }
  // 정산서용: 그 달에 유효한 계약 우선 (없으면 첫 계약)
  function customerByApp(app, month) {
    const list = contractsOfApp(app); if (!list.length) return null;
    let pick = list[0];
    if (/^\d{6}$/.test(month || "")) {
      const ms = `${month.slice(0, 4)}-${month.slice(4)}-01`, me = `${month.slice(0, 4)}-${month.slice(4)}-31`;
      pick = list.find(c => (!str(c["계약일자"]) || str(c["계약일자"]) <= me) && (!str(c["계약해지일"]) || str(c["계약해지일"]) >= ms)) || pick;
    }
    return toCustomer(pick);
  }
  function plantsOfGroup(app) { return Object.keys(plants()).filter(p => str(plants()[p]["KPX신청번호"]) === str(app)); }
  // 발전소가 매핑된 계약: 계약ID 칸, 없으면 신청번호 그룹에 계약이 1건일 때 그 계약
  function plantContract(name) {
    const m = plants()[name]; if (!m) return "";
    const k = str(m["계약ID"]); if (k && customerByKey(k)) return k;
    const list = contractsOfApp(str(m["KPX신청번호"])); return list.length === 1 ? custKey(list[0]) : "";
  }
  const plantsOfContract = key => Object.keys(plants()).filter(p => plantContract(p) === str(key));

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
  return { load, plants, rawCustomers, plantInfo, customerByApp, customerByKey, contractsOfApp, custKey, groups, priceSplits, plantsOfGroup, plantContract, plantsOfContract, save, remove, isLoaded: () => loaded };
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
    else if (f.type === "contract") input = `<select ${attrs}><option value="">미연결</option>${Registry.rawCustomers().map(c => { const k = Registry.custKey(c);
        return `<option value="${rEsc(k)}"${k === v ? " selected" : ""}>${rEsc(k)} · ${rEsc(c["수요기업명"])} · ${rEsc(c["KPX신청번호"])}</option>`; }).join("")}
        ${v && !Registry.customerByKey(v) ? `<option value="${rEsc(v)}" selected>${rEsc(v)} (계약 미등록)</option>` : ""}</select>`;
    else if (f.type === "group") input = `<select ${attrs}><option value="">미연결</option>${Registry.groups().map(app =>
        `<option value="${rEsc(app)}"${app === v ? " selected" : ""}>${rEsc(app)} · ${rEsc(groupLabel(app))}</option>`).join("")}
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
const groupLabel = app => Array.from(new Set(Registry.contractsOfApp(app).map(c => rStr(c["수요기업명"])))).join(", ");
const singleContract = app => Registry.contractsOfApp(app).length === 1;
const contractCapacity = key => Registry.plantsOfContract(key).reduce((s, p) => s + (Number(Registry.plants()[p]["계약용량"]) || 0), 0);
// 매핑이 바뀌거나 발전소 용량이 바뀌면 해당 계약의 계약용량·연간보장공급량을 다시 저장한다
async function syncContractTotals(keys) {
  for (const k of new Set(keys.map(rStr).filter(Boolean))) {
    const raw = Registry.customerByKey(k); if (!raw) continue;
    const cap = contractCapacity(k); if (!(cap > 0)) continue; // 매핑된 발전소가 없으면 직접 입력값 유지
    const g = guaranteeOf(cap, hoursPerDay(raw["연간보장시간"]) * 365);
    if (Number(raw["계약용량"]) === cap && String(raw["연간보장공급량"]) === String(g)) continue;
    const key = Registry.custKey(raw);
    await Registry.save("customer", { "계약ID": key, "계약용량": cap, "연간보장공급량": g }, key);
  }
}
const plantContractOf = name => name ? Registry.plantContract(name) : "";

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
function custCardsHtml(activeKey, cls, custs) {
  if (!custs.length) return `<div class="hint">등록된 계약이 없습니다.</div>`;
  return custs.map(c => {
    const key = Registry.custKey(c), app = rStr(c["KPX신청번호"]);
    return `<button class="reg-card ${cls}${activeKey === key ? " active" : ""}" data-key="${rEsc(key)}">
      <div class="reg-card-title">${rEsc(c["수요기업명"])}</div><div class="reg-card-sub">${rEsc(key)}${key !== app ? ` · ${rEsc(app)}` : ""}</div>
      <div class="reg-card-meta"><span>${rEsc(c["수요지지역"] || "-")}</span><span>${rEsc(c["계약단가"] === "" ? "-" : c["계약단가"])} 원/kWh</span><span>${c["계약용량"] === "" || c["계약용량"] == null ? "-" : fmtKw(c["계약용량"]) + " kW"}</span></div></button>`;
  }).join("");
}
// 그룹 카드: 신청번호 단위 (계약 n건 · 발전소 m개)
function groupCardsHtml(activeApp, apps) {
  if (!apps.length) return `<div class="hint">등록된 계약이 없습니다.</div>`;
  return apps.map(app => `<button class="reg-card group-card${activeApp === app ? " active" : ""}" data-app="${rEsc(app)}">
      <div class="reg-card-title">${rEsc(groupLabel(app))}</div><div class="reg-card-sub">${rEsc(app)}</div>
      <div class="reg-card-meta"><span>계약 ${Registry.contractsOfApp(app).length}건</span><span>발전소 ${Registry.plantsOfGroup(app).length}개</span></div></button>`).join("");
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
  host.querySelectorAll(".cust-card").forEach(b => b.onclick = () => openCustomer(b.dataset.key));
  r$("regAddCust").onclick = () => openCustomer("");
  if (regState.openCust !== null) openCustomer(regState.openCust, true);
}

function openCustomer(key, keepScroll) {
  regState.openCust = key; markActive(".cust-card", "key", key);
  const found = key ? Registry.customerByKey(key) : null;
  const raw = Object.assign({}, found || { "수요지지역": "비수도권" });
  const isNew = !found, app = rStr(raw["KPX신청번호"]);
  if (!isNew && !rStr(raw["계약ID"])) raw["계약ID"] = key; // 예전 행: 신청번호를 계약ID 로
  const gcap = !isNew ? contractCapacity(key) : 0; // 이 계약에 매핑된 발전소 설비용량 합
  if (gcap > 0) raw["계약용량"] = gcap;
  if (Number(raw["연간보장시간"]) > 24) raw["연간보장시간"] = Number((raw["연간보장시간"] / 365).toFixed(4)); // 예전 h/년 값 → h/일
  r$("regCustDetail").innerHTML = `<div class="reg-detail">
    <div class="reg-head"><h3 class="sub" style="margin:0">${isNew ? "새 전기사용자" : rEsc(raw["수요기업명"]) + " 계약 정보"}</h3><button class="btn secondary" id="regCustClose">닫기</button></div>
    <div id="regCustForm">${regFormHtml(CUSTOMER_FORM, raw, "cf")}</div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="regCustSave">저장</button>${isNew ? "" : '<button class="btn secondary danger" id="regCustDel">삭제</button>'}<span id="regCustStatus" class="status warn" style="background:none"></span></div>
  </div>`;
  if (gcap > 0) r$("regCustForm").querySelector('[data-k="계약용량"]').readOnly = true;
  bindContractCalc("regCustForm");
  r$("regCustClose").onclick = () => { regState.openCust = null; markActive(".cust-card", "key", null); r$("regCustDetail").innerHTML = ""; };
  r$("regCustSave").onclick = () => saveRegistry("customer", "regCustForm", CUSTOMER_FORM, isNew ? "" : key, "regCustStatus");
  if (!isNew) {
    r$("regCustDel").onclick = () => deleteRegistry("customer", key, `${raw["수요기업명"]} (${key})`, "regCustStatus");
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
            <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${GRID_LABEL[gridOf(m["배전연결"])]}</td>
            <td>${app ? `${rEsc(Registry.plantContract(p) || groupLabel(app) || "계약 미등록")} <span class="hint" style="margin:0">${rEsc(app)}</span>` : '<span class="hint" style="margin:0">미연결</span>'}</td>
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
  raw["배전연결"] = gridOf(raw["배전연결"]);
  if (!isNew) raw["계약ID"] = Registry.plantContract(name); // 예전 데이터: 신청번호 그룹의 계약이 1건이면 그 계약
  if (!rStr(raw["접속점"]) && rStr(raw["변전소"])) raw["접속점"] = raw["변전소"]; // 예전 변전소 칸 값 이어받기
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
  const apps = Registry.groups(), all = Registry.plants();
  const unlinked = Object.keys(all).filter(p => { const a = rStr(all[p]["KPX신청번호"]); return !a || !apps.includes(a); });
  if ((regState.openGroup === null || !apps.includes(regState.openGroup)) && apps.length) regState.openGroup = apps[0];
  const pg = pageSlice("group", apps);
  host.innerHTML = `${loadFailNotice()}<div class="group-layout">
    <div class="card group-list"><h2>PPA 계약</h2>
      <div class="reg-cards single">${groupCardsHtml(regState.openGroup, pg.items)}</div>${pagerHtml("group", pg.page, pg.pages)}
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
  const contracts = Registry.contractsOfApp(app);
  host.innerHTML = `<div><h2>${rEsc(groupLabel(app))}</h2><div class="hint" style="margin:2px 0 0">${rEsc(app)} · ${rEsc(c.demandRegion || "-")}</div></div>
    <h3 class="sub">계약 (${contracts.length})</h3>
    <div class="grid-wrap" style="max-height:none"><table class="grid"><tr><th>계약ID</th><th>사업자명</th><th>계약용량(kW)</th><th>계약단가</th><th>계약기간</th></tr>
      ${contracts.map(x => `<tr><td><b>${rEsc(Registry.custKey(x))}</b></td><td>${rEsc(x["수요기업명"])}</td><td class="num">${x["계약용량"] === "" || x["계약용량"] == null ? "-" : fmtKw(x["계약용량"])}</td>
        <td class="num">${rEsc(x["계약단가"])}</td><td>${rEsc(x["계약일자"] || "-")} ~ ${rEsc(x["계약해지일"] || "")}</td></tr>`).join("")}</table></div>
    <h3 class="sub">소속 발전소 (${members.length})</h3>
    <div class="grid-wrap"><table class="grid"><tr><th>발전소</th><th>계약</th><th>사업자명</th><th>지역</th><th>배전</th><th>계약용량(kW)</th><th></th></tr>
      ${members.length ? members.map(p => { const m = all[p], pk = Registry.plantContract(p); return `<tr><td><b>${rEsc(p)}</b></td>
        <td><select class="grp-contract" data-plant="${rEsc(p)}"><option value="">미지정</option>${contracts.map(x => { const k = Registry.custKey(x); return `<option value="${rEsc(k)}"${k === pk ? " selected" : ""}>${rEsc(k)}</option>`; }).join("")}</select></td>
        <td>${rEsc(m["사업자명(대표자명)"])}</td>
        <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${GRID_LABEL[gridOf(m["배전연결"])]}</td>
        <td class="num">${rEsc(fmtKw(m["계약용량"]))}</td><td style="text-align:center"><button class="btn secondary small grp-remove" data-plant="${rEsc(p)}">제외</button></td></tr>`; }).join("")
        : `<tr><td colspan="7" class="hint">아직 묶인 발전소가 없습니다.</td></tr>`}</table></div>
    <div class="row" style="margin-top:10px"><select id="grpAddSel" style="min-width:300px">${others.map(p => { const a = rStr(all[p]["KPX신청번호"]);
        return `<option value="${rEsc(p)}">${rEsc(p)}${a ? ` (현재: ${rEsc(groupLabel(a) || a)})` : " (미연결)"}</option>`; }).join("")}</select>
      <select id="grpAddContract" style="min-width:180px">${contracts.map(x => `<option value="${rEsc(Registry.custKey(x))}">${rEsc(Registry.custKey(x))}</option>`).join("")}</select>
      <button class="btn accent" id="grpAddBtn"${others.length ? "" : " disabled"}>계약에 추가</button><span id="grpStatus" class="status warn" style="background:none"></span></div>
    <div class="reg-group">
      <div class="reg-head"><h3 class="sub" style="margin:0">월별 발전소 집계</h3>
        <div class="row"><label class="adj-label">정산월</label><input type="month" id="regMonth" value="${regState.month.slice(0, 4)}-${regState.month.slice(4)}"></div></div>
      <div id="regAgg"><div class="hint">불러오는 중...</div></div></div>`;
  host.querySelectorAll(".grp-remove").forEach(b => b.onclick = () => setPlantContract(b.dataset.plant, ""));
  host.querySelectorAll(".grp-contract").forEach(sel => sel.onchange = () => setPlantContract(sel.dataset.plant, sel.value, app));
  r$("grpAddBtn").onclick = () => {
    const p = r$("grpAddSel").value, k = r$("grpAddContract").value, cur = rStr(all[p]["KPX신청번호"]);
    if (cur && cur !== app && !confirm(`${p} 은(는) 지금 ${groupLabel(cur) || cur} 그룹입니다. ${k} 계약으로 옮길까요?`)) return;
    setPlantContract(p, k);
  };
  r$("regMonth").onchange = e => { regState.month = e.target.value.replace("-", ""); renderGroupAgg(app); };
  renderGroupAgg(app);
}

// 발전소의 계약ID(와 그 계약의 KPX 신청번호)만 바꿔 저장 (시트의 다른 칸은 그대로)
// keepApp: 계약 "미지정"으로 바꿔도 그룹(신청번호)에는 남겨 둘 때
async function setPlantContract(plant, key, keepApp) {
  const st = r$("grpStatus"); st.textContent = "저장 중..."; st.className = "status warn";
  const oldContract = plantContractOf(plant);
  const cc = key ? Registry.customerByKey(key) : null;
  const app = cc ? rStr(cc["KPX신청번호"]) : (keepApp || "");
  const r = await Registry.save("plant", { "발전소명": plant, "계약ID": key, "KPX신청번호": app }, plant);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
  await syncContractTotals([oldContract, key]); // 계약용량·연간보장공급량 자동 갱신
  afterRegistryChange();
  const st2 = r$("grpStatus"); if (st2) { st2.textContent = `${plant} → ${key ? key + " 계약" : (app ? "계약 미지정" : "그룹에서 제외")} (구글시트 저장)`; st2.className = "status ok"; }
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
  else { const gc = originalKey ? contractCapacity(originalKey) : 0; if (gc > 0) rec["계약용량"] = gc; rec["연간보장공급량"] = guaranteeOf(rec["계약용량"], hoursPerDay(rec["연간보장시간"]) * 365); }
  const oldContract = kind === "plant" ? plantContractOf(originalKey) : "";
  if (kind === "plant") { const cc = rec["계약ID"] ? Registry.customerByKey(rec["계약ID"]) : null; rec["KPX신청번호"] = cc ? rStr(cc["KPX신청번호"]) : ""; }
  st.textContent = "저장 중..."; st.className = "status warn";
  const r = await Registry.save(kind, rec, originalKey);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
  if (kind === "plant") await syncContractTotals([oldContract, rec["계약ID"]]);
  if (kind === "plant") regState.openPlant = rec["발전소명"]; else regState.openCust = rec["계약ID"];
  afterRegistryChange();
  const st2 = r$(statusId); if (st2) { st2.textContent = "저장 완료 (구글시트)"; st2.className = "status ok"; }
}

async function deleteRegistry(kind, key, label, statusId) {
  if (!confirm(`${label} 을(를) 삭제할까요? 구글시트에서도 행이 지워집니다.`)) return;
  const st = r$(statusId); st.textContent = "삭제 중..."; st.className = "status warn";
  const oldContract = kind === "plant" ? plantContractOf(key) : "";
  const r = await Registry.remove(kind, key);
  if (!r.ok) { st.textContent = "삭제 실패: " + r.error; st.className = "status bad"; return; }
  if (oldContract) await syncContractTotals([oldContract]);
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


/* ----- 계약 연장 / 해지 (헤더 알림의 "계약 만료"에서 선택) -----
 * 연장: 계약기간 + n년 → 계약해지일·연장통보 마감일 다시 계산, 비고에 이력. 계약이행현황은 늘어난 연차(6년차…)까지 계산된다.
 * 해지: 계약상태 = 해지 (알림 종료), 비고에 이력
 */
function contractRaw(kind, key) { return kind === "plant" ? Registry.plants()[key] : Registry.customerByKey(key); }
function appendNote(raw, text) { const old = rStr(raw["비고"]); return (old ? old + "\n" : "") + text; }
async function extendContract(kind, key, years) {
  const raw = contractRaw(kind, key);
  if (!raw) return { ok: false, error: "계약을 찾지 못했습니다." };
  years = Math.round(Number(years));
  if (!(years > 0)) return { ok: false, error: "연장 기간(년)을 1 이상으로 입력하세요." };
  const start = rStr(raw["계약일자"]);
  if (!YMD.test(start)) return { ok: false, error: "계약시작일이 없어 연장 기간을 계산할 수 없습니다." };
  const oldEnd = rStr(raw["계약해지일"]);
  let cur = Math.round(Number(raw["계약기간"]) || 0);
  if (!cur && YMD.test(oldEnd)) cur = Math.max(1, Math.round((new Date(oldEnd) - new Date(start)) / (365.25 * 86400000)));
  const rec = calcContractDates({ "계약일자": start, "계약기간": cur + years, "연장통보기한": raw["연장통보기한"], "계약해지일": oldEnd });
  const keyField = kind === "plant" ? "발전소명" : "계약ID";
  const out = { [keyField]: key, "계약기간": cur + years, "계약해지일": rec["계약해지일"], "연장통보마감일": rec["연장통보마감일"], "계약상태": "",
    "비고": appendNote(raw, `${todayYmd()} 계약 ${years}년 연장 (${oldEnd || "-"} → ${rec["계약해지일"]}, 계약기간 ${cur}년 → ${cur + years}년)`) };
  const r = await Registry.save(kind === "plant" ? "plant" : "customer", out, key);
  if (r.ok) afterRegistryChange();
  return r;
}
async function terminateContract(kind, key) {
  const raw = contractRaw(kind, key);
  if (!raw) return { ok: false, error: "계약을 찾지 못했습니다." };
  const keyField = kind === "plant" ? "발전소명" : "계약ID";
  const r = await Registry.save(kind === "plant" ? "plant" : "customer",
    { [keyField]: key, "계약상태": "해지", "비고": appendNote(raw, `${todayYmd()} 계약 해지 확정 (계약해지일 ${rStr(raw["계약해지일"]) || "-"})`) }, key);
  if (r.ok) afterRegistryChange();
  return r;
}

function renderRegistry() { renderCustomerPage(); renderPlantPage(); renderGroupPage(); }

async function initRegistry() {
  ["regCustPage", "regPlantPage", "regGroupPage"].forEach(id => { r$(id).innerHTML = `<div class="card"><div class="hint">등록 정보를 불러오는 중...</div></div>`; });
  await Registry.load();
  renderRegistry();
  if (typeof renderAlerts === "function") renderAlerts(); // 헤더 알림 (계약 마감 임박)
  if (typeof renderBillingBody === "function") renderBillingBody();
}
