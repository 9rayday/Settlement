/* ============ 정산관리 > 계약관리: 발전소 / 전기사용자 등록 + 그룹화 ============
 * 구글시트 "발전소 사업자 정보"(= 발전사업자 정산서 마스터, masterData)와 "전기사용자 정보" 탭을 읽고 행 단위로 저장/삭제한다.
 * 같은 KPX 신청번호를 가진 발전소들이 한 전기사용자 계약(그룹)이다. 계약을 누르면 그룹의 월별 발전소 집계를 보여준다.
 */
const GEN_REGIONS = ["비수도권", "수도권북", "수도권남", "제주"];
const DEMAND_REGIONS = ["수도권", "비수도권", "제주"];

// 화면 입력 항목 = 시트 컬럼명(k). req: 필수, type: text|number|date|select
const PLANT_FORM = [
  { k: "발전소명", label: "발전소명 (KPX 발전기명과 동일)", req: true },
  { k: "지역(요금구분)", label: "지역 (송전요금 구분)", type: "select", options: GEN_REGIONS, req: true },
  { k: "배전연결", label: "배전 연결", type: "select", options: ["N", "Y"] },
  { k: "KPX신청번호", label: "그룹 (전기사용자 계약)", type: "group" },
  { k: "사업자명(대표자명)", label: "사업자명 (대표자명)" },
  { k: "사업자등록번호", label: "사업자등록번호" },
  { k: "사업자주소", label: "사업자 주소", wide: true },
  { k: "계좌번호", label: "계좌번호" },
  { k: "담당자", label: "담당자" },
  { k: "연락처", label: "연락처" },
  { k: "계약용량", label: "계약용량 (kW)", type: "number" },
  { k: "발전보장시간", label: "발전보장시간 (h/일)", type: "number", placeholder: "3.4" },
  { k: "계약단가", label: "매입 계약단가 (원/kWh)", type: "number" },
  { k: "수수료율", label: "거래수수료 (원/kWh)", type: "number", placeholder: "0.1193" },
  { k: "계약일자", label: "계약일자", type: "date" },
  { k: "계약해지일", label: "계약해지일", type: "date" }
];
const CUSTOMER_FORM = [
  { k: "수요기업명", label: "수요기업명", req: true },
  { k: "KPX신청번호", label: "KPX 신청번호 (그룹 키)", req: true, placeholder: "26-PR00000" },
  { k: "수요지지역", label: "수요지 지역", type: "select", options: DEMAND_REGIONS, req: true },
  { k: "계약단가", label: "계약 전력량 단가 (원/kWh)", type: "number", req: true },
  { k: "대표자명", label: "대표자명" },
  { k: "사업자등록번호", label: "사업자등록번호" },
  { k: "전기사용장소", label: "전기사용장소", wide: true },
  { k: "담당자", label: "담당자" },
  { k: "연락처", label: "연락처" },
  { k: "이메일", label: "이메일" },
  { k: "소비계약신청번호", label: "소비계약 신청번호" },
  { k: "계약일자", label: "계약일자", type: "date" },
  { k: "계약해지일", label: "계약해지일", type: "date" }
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
const regState = { openCust: null, openPlant: null, openGroup: null, month: "" };
const r$ = id => document.getElementById(id);
const rEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rNum = n => (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString();
const rStr = v => String(v == null ? "" : v).trim();
const custName = app => { const c = Registry.customerByApp(app); return c ? c.name : ""; };

function regFormHtml(form, rec, prefix) {
  return `<div class="reg-form">${form.map((f, i) => {
    const v = rec[f.k] == null ? "" : String(rec[f.k]);
    const id = `${prefix}_${i}`;
    let input;
    if (f.type === "select") input = `<select id="${id}" data-k="${rEsc(f.k)}">${f.options.map(o => `<option${o === v ? " selected" : ""}>${o}</option>`).join("")}</select>`;
    else if (f.type === "group") input = `<select id="${id}" data-k="${rEsc(f.k)}"><option value="">미연결</option>${Registry.rawCustomers().map(c => {
        const app = rStr(c["KPX신청번호"]); return `<option value="${rEsc(app)}"${app === v ? " selected" : ""}>${rEsc(app)} · ${rEsc(c["수요기업명"])}</option>`; }).join("")}
        ${v && !Registry.customerByApp(v) ? `<option value="${rEsc(v)}" selected>${rEsc(v)} (계약 미등록)</option>` : ""}</select>`;
    else input = `<input id="${id}" data-k="${rEsc(f.k)}" type="${f.type || "text"}"${f.type === "number" ? ' step="any"' : ""} value="${rEsc(v)}" placeholder="${rEsc(f.placeholder || "")}">`;
    return `<div class="reg-field${f.wide ? " wide" : ""}"><label for="${id}">${rEsc(f.label)}${f.req ? ' <span class="req">*</span>' : ""}</label>${input}</div>`;
  }).join("")}</div>`;
}
function readRegForm(hostId, form) {
  const rec = {};
  r$(hostId).querySelectorAll("[data-k]").forEach(el => { rec[el.dataset.k] = el.value.trim(); });
  form.filter(f => f.type === "number").forEach(f => { if (rec[f.k] !== "") rec[f.k] = Number(rec[f.k]); });
  const missing = form.filter(f => f.req && (rec[f.k] === "" || rec[f.k] == null)).map(f => f.label);
  if (missing.length) throw new Error("필수 항목을 입력하세요: " + missing.join(", "));
  return rec;
}
const loadFailNotice = () => Registry.isLoaded() ? "" : `<div class="notice warn">구글시트에서 등록 정보를 불러오지 못했습니다. Apps Script를 최신 Code.gs로 "새 버전" 재배포했는지 확인하세요.</div>`;
function markActive(selector, attr, value) {
  document.querySelectorAll(selector).forEach(el => el.classList.toggle("active", el.dataset[attr] === value));
}
function custCardsHtml(activeApp, cls) {
  const custs = Registry.rawCustomers();
  if (!custs.length) return `<div class="hint">등록된 전기사용자가 없습니다.</div>`;
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
  host.innerHTML = `${loadFailNotice()}<div class="card">
      <div class="reg-head"><h2>전기사용자 (수요기업) 계약</h2><button class="btn secondary" id="regAddCust">+ 전기사용자 추가</button></div>
      <p class="hint">카드를 누르면 계약 정보를 보고 수정할 수 있습니다. 발전소 묶기와 월별 집계는 [그룹화]에서 합니다.</p>
      <div class="reg-cards">${custCardsHtml(regState.openCust, "cust-card")}</div>
      <div id="regCustDetail"></div></div>`;
  host.querySelectorAll(".cust-card").forEach(b => b.onclick = () => openCustomer(b.dataset.app));
  r$("regAddCust").onclick = () => openCustomer("");
  if (regState.openCust !== null) openCustomer(regState.openCust, true);
}

function openCustomer(app, keepScroll) {
  regState.openCust = app; markActive(".cust-card", "app", app);
  const raw = Registry.rawCustomers().find(c => rStr(c["KPX신청번호"]) === app) || { "수요지지역": "비수도권" };
  const isNew = !app, plants = isNew ? [] : Registry.plantsOfGroup(app);
  r$("regCustDetail").innerHTML = `<div class="reg-detail">
    <div class="reg-head"><h3 class="sub" style="margin:0">${isNew ? "새 전기사용자" : rEsc(raw["수요기업명"]) + " 계약 정보"}</h3><button class="btn secondary" id="regCustClose">닫기</button></div>
    <div id="regCustForm">${regFormHtml(CUSTOMER_FORM, raw, "cf")}</div>
    ${isNew ? "" : `<div class="reg-linked"><span class="adj-label">연결된 발전소</span>${plants.length ? plants.map(p => `<span class="tag">${rEsc(p)}</span>`).join("") : '<span class="hint" style="margin:0">없음</span>'}
      <a class="link" href="#reg-group" id="regGoGroup">그룹화에서 관리 →</a></div>`}
    <div class="row" style="margin-top:12px"><button class="btn accent" id="regCustSave">저장</button>${isNew ? "" : '<button class="btn secondary danger" id="regCustDel">삭제</button>'}<span id="regCustStatus" class="status warn" style="background:none"></span></div>
  </div>`;
  r$("regCustClose").onclick = () => { regState.openCust = null; markActive(".cust-card", "app", null); r$("regCustDetail").innerHTML = ""; };
  r$("regCustSave").onclick = () => saveRegistry("customer", "regCustForm", CUSTOMER_FORM, isNew ? "" : app, "regCustStatus");
  if (!isNew) {
    r$("regCustDel").onclick = () => deleteRegistry("customer", app, raw["수요기업명"], "regCustStatus");
    r$("regGoGroup").onclick = () => { regState.openGroup = app; renderGroupPage(); };
  }
  if (!keepScroll) r$("regCustDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ----- 발전사업자 ----- */
function renderPlantPage() {
  const host = r$("regPlantPage"); if (!host) return;
  const plants = Registry.plants();
  host.innerHTML = `${loadFailNotice()}<div class="card">
      <div class="reg-head"><h2>발전소 (발전사업자)</h2><button class="btn secondary" id="regAddPlant">+ 발전소 추가</button></div>
      <p class="hint">발전소명은 KPX 직접전력거래량 파일의 "발전기명"과 정확히 같아야 합니다. 행을 누르면 수정할 수 있습니다.</p>
      <div class="grid-wrap"><table class="grid reg-table"><tr><th>발전소명</th><th>사업자명</th><th>지역</th><th>배전</th><th>그룹 (전기사용자)</th><th>계약용량(kW)</th><th>매입단가</th><th>계약일자</th></tr>
        ${Object.keys(plants).map(p => { const m = plants[p], app = rStr(m["KPX신청번호"]);
          return `<tr class="reg-row${regState.openPlant === p ? " active" : ""}" data-plant="${rEsc(p)}"><td><b>${rEsc(p)}</b></td><td>${rEsc(m["사업자명(대표자명)"])}</td>
            <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${rStr(m["배전연결"]).toUpperCase() === "Y" ? "Y" : "-"}</td>
            <td>${app ? `${rEsc(custName(app) || "계약 미등록")} <span class="hint" style="margin:0">${rEsc(app)}</span>` : '<span class="hint" style="margin:0">미연결</span>'}</td>
            <td class="num">${rEsc(m["계약용량"])}</td><td class="num">${rEsc(m["계약단가"])}</td><td>${rEsc(m["계약일자"])}</td></tr>`; }).join("")}</table></div>
      <div id="regPlantDetail"></div></div>`;
  host.querySelectorAll(".reg-row").forEach(tr => tr.onclick = () => openPlant(tr.dataset.plant));
  r$("regAddPlant").onclick = () => openPlant("");
  if (regState.openPlant !== null) openPlant(regState.openPlant, true);
}

function openPlant(name, keepScroll) {
  regState.openPlant = name; markActive(".reg-row", "plant", name);
  const isNew = !name;
  const raw = isNew ? { "지역(요금구분)": "비수도권", "배전연결": "N" } : Object.assign({}, Registry.plants()[name]);
  if (!isNew && rStr(raw["배전연결"]).toUpperCase() !== "Y") raw["배전연결"] = "N";
  r$("regPlantDetail").innerHTML = `<div class="reg-detail">
    <div class="reg-head"><h3 class="sub" style="margin:0">${isNew ? "새 발전소" : rEsc(name)}</h3><button class="btn secondary" id="regPlantClose">닫기</button></div>
    <div id="regPlantForm">${regFormHtml(PLANT_FORM, raw, "pf")}</div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="regPlantSave">저장</button>${isNew ? "" : '<button class="btn secondary danger" id="regPlantDel">삭제</button>'}<span id="regPlantStatus" class="status warn" style="background:none"></span></div>
  </div>`;
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
  host.innerHTML = `${loadFailNotice()}<div class="group-layout">
    <div class="card group-list"><h2>전기사용자 계약</h2>
      <div class="reg-cards single">${custCardsHtml(regState.openGroup, "group-card")}</div>
      <p class="hint" style="margin-top:10px">그룹 미연결 발전소: <b>${unlinked.length}</b>개</p></div>
    <div class="card group-main" id="regGroupMain"></div></div>`;
  host.querySelectorAll(".group-card").forEach(b => b.onclick = () => { regState.openGroup = b.dataset.app; markActive(".group-card", "app", b.dataset.app); renderGroupMain(); });
  renderGroupMain();
}

function renderGroupMain() {
  const host = r$("regGroupMain"); if (!host) return;
  const app = regState.openGroup, c = app && Registry.customerByApp(app);
  if (!c) { host.innerHTML = `<div class="hint">왼쪽에서 전기사용자 계약을 고르세요. 계약은 [전기사용자]에서 등록합니다.</div>`; return; }
  const members = Registry.plantsOfGroup(app), all = Registry.plants();
  const others = Object.keys(all).filter(p => !members.includes(p));
  if (!regState.month) regState.month = defaultMonth(app);
  host.innerHTML = `<div><h2>${rEsc(c.name)}</h2><div class="hint" style="margin:2px 0 0">${rEsc(app)} · ${rEsc(c.demandRegion || "-")} · ${rEsc(isNaN(c.unitPrice) ? "-" : c.unitPrice)} 원/kWh</div></div>
    <h3 class="sub">소속 발전소 (${members.length})</h3>
    <div class="grid-wrap"><table class="grid"><tr><th>발전소</th><th>사업자명</th><th>지역</th><th>배전</th><th>계약용량(kW)</th><th></th></tr>
      ${members.length ? members.map(p => { const m = all[p]; return `<tr><td><b>${rEsc(p)}</b></td><td>${rEsc(m["사업자명(대표자명)"])}</td>
        <td>${m["지역(요금구분)"] ? rEsc(m["지역(요금구분)"]) : '<span class="tag bad">미지정</span>'}</td><td>${rStr(m["배전연결"]).toUpperCase() === "Y" ? "Y" : "-"}</td>
        <td class="num">${rEsc(m["계약용량"])}</td><td style="text-align:center"><button class="btn secondary small grp-remove" data-plant="${rEsc(p)}">제외</button></td></tr>`; }).join("")
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
  const r = await Registry.save("plant", { "발전소명": plant, "KPX신청번호": app }, plant);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
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
    <p class="hint">${hasData ? `출처: ${rEsc(source)} · 초과발전량 = 발전량 − 공급량` : `${month.slice(0, 4)}.${month.slice(4)} 실적이 없습니다. [정산 > 전기사용자/발전사업자]에서 이 달 파일을 올리면 표시됩니다.`}</p>`;
}

async function saveRegistry(kind, formId, form, originalKey, statusId) {
  const st = r$(statusId);
  let rec;
  try { rec = readRegForm(formId, form); } catch (e) { st.textContent = e.message; st.className = "status bad"; return; }
  st.textContent = "저장 중..."; st.className = "status warn";
  const r = await Registry.save(kind, rec, originalKey);
  if (!r.ok) { st.textContent = "저장 실패: " + r.error; st.className = "status bad"; return; }
  if (kind === "plant") regState.openPlant = rec["발전소명"]; else regState.openCust = rec["KPX신청번호"];
  afterRegistryChange();
  const st2 = r$(statusId); if (st2) { st2.textContent = "저장 완료 (구글시트)"; st2.className = "status ok"; }
}

async function deleteRegistry(kind, key, label, statusId) {
  if (!confirm(`${label} 을(를) 삭제할까요? 구글시트에서도 행이 지워집니다.`)) return;
  const st = r$(statusId); st.textContent = "삭제 중..."; st.className = "status warn";
  const r = await Registry.remove(kind, key);
  if (!r.ok) { st.textContent = "삭제 실패: " + r.error; st.className = "status bad"; return; }
  if (kind === "plant") regState.openPlant = null; else regState.openCust = null;
  afterRegistryChange();
}

// 등록 정보가 바뀌면 계약관리 화면과 정산 화면(그룹 이름·발전소 지역)을 다시 그린다
function afterRegistryChange() {
  renderRegistry();
  if (typeof renderBillingBody === "function") renderBillingBody();
  if (typeof refreshPlantSelect === "function" && typeof plants !== "undefined" && plants.length) refreshPlantSelect(); // 발전사업자 정산서 미리보기 갱신
}

function renderRegistry() { renderCustomerPage(); renderPlantPage(); renderGroupPage(); }

async function initRegistry() {
  ["regCustPage", "regPlantPage", "regGroupPage"].forEach(id => { r$(id).innerHTML = `<div class="card"><div class="hint">등록 정보를 불러오는 중...</div></div>`; });
  await Registry.load();
  renderRegistry();
  if (typeof renderBillingBody === "function") renderBillingBody();
}
