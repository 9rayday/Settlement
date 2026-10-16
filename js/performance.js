/* ============ 계약관리 > 계약이행현황 (전기사용자 / 발전사업자) ============
 * 연차별 연간보장공급량 = 1년차 보장량 × (1 − 연간효율감소)^(연차−1)
 *   1년차 보장량 = 등록된 연간보장공급량 (없으면 계약용량 × 보장시간으로 계산)
 * 연차 실적 = 실발전량(공급량) + 초과발전량(발전량 − 공급량)  ← 월별실적로그(가정산 업로드 때 기록)를 날짜 비율로 연차에 배분
 *   발전사업자 = 그 발전소, 전기사용자 = 그룹 발전소 합계
 * 미달량 = 보장량 − 실적 (종료된 연차), 위약금(단가 방식) = 미달량 × 위약금 단가
 * 처리 방식이 "청구서 차감"이면 연차 종료월 정산서에서 차감한다 (전기사용자 가정산서 / 발전사업자 정산서).
 */
const PERF_ALERT_DAYS = 30;
const perfState = { rows: null, loaded: false, open: { cust: null, gen: null } };

async function loadPerformance() {
  const r = await gasGet("getPerformanceAll");
  perfState.rows = r || []; perfState.loaded = r !== null;
}
async function refreshPerformance() { await loadPerformance(); renderPerfPages(); if (typeof renderAlerts === "function") renderAlerts(); }

function perfByPlant() { // {발전소: {YYYYMM: {gen, supply}}}
  const m = {};
  (perfState.rows || []).forEach(r => { (m[r.plant] || (m[r.plant] = {}))[r.month] = { gen: r.generation, supply: r.supply }; });
  return m;
}
const ymdDays = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); // b − a
function overlapFrac(ym, s, e) { // 월(YYYYMM) 중 [s, e] 에 들어가는 날의 비율
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(4)), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ms = `${ym.slice(0, 4)}-${ym.slice(4)}-01`, me = `${ym.slice(0, 4)}-${ym.slice(4)}-${String(last).padStart(2, "0")}`;
  const a = s > ms ? s : ms, b = e < me ? e : me;
  return b < a ? 0 : (ymdDays(a, b) + 1) / last;
}

function contractOf(kind, key) {
  const raw = kind === "gen" ? Registry.plants()[key] : Registry.rawCustomers().find(c => rStr(c["KPX신청번호"]) === key);
  if (!raw) return null;
  const num = v => Number(v), cap = num(raw["계약용량"]) || 0;
  let g1 = num(raw["연간보장공급량"]);
  if (!(g1 > 0)) { const hrs = (kind === "gen" ? num(raw["발전보장시간"]) : hoursPerDay(raw["연간보장시간"])) * 365; g1 = cap > 0 && hrs > 0 ? cap * hrs : 0; } // 보장시간(h/일) × 365
  const start = rStr(raw["계약일자"]), end = rStr(raw["계약해지일"]);
  let years = Math.round(num(raw["계약기간"]) || 0);
  if (!years && YMD.test(start) && YMD.test(end)) years = Math.max(1, Math.round(ymdDays(start, end) / 365.25));
  return {
    kind, key, name: kind === "gen" ? key : rStr(raw["수요기업명"]), cap, g1, decline: num(raw["연간효율감소"]) || 0, start, end, years,
    penType: rStr(raw["위약금유형"]), penPrice: num(raw["위약금단가"]) || 0, penMethod: rStr(raw["위약금처리방식"]),
    plants: kind === "gen" ? [key] : Registry.plantsOfGroup(key)
  };
}

function yearSchedule(c, byPlant) {
  if (!c || !YMD.test(c.start) || !(c.years > 0) || !(c.g1 > 0)) return null;
  const today = todayYmd(), out = [];
  for (let i = 1; i <= c.years; i++) {
    const s = addMonthsYmd(c.start, 12 * (i - 1), 0), e = addMonthsYmd(c.start, 12 * i, -1);
    const guar = c.g1 * Math.pow(1 - c.decline / 100, i - 1);
    let supply = 0, gen = 0;
    c.plants.forEach(p => Object.entries(byPlant[p] || {}).forEach(([ym, v]) => { const f = overlapFrac(ym, s, e); if (f > 0) { supply += v.supply * f; gen += v.gen * f; } }));
    const excess = gen - supply, actual = supply + excess;
    const state = e < today ? "ended" : (s > today ? "future" : "current");
    const totalDays = ymdDays(s, e) + 1, remain = state === "current" ? ymdDays(today, e) : (state === "future" ? totalDays : 0);
    const met = actual >= guar, short = Math.max(0, guar - actual);
    let status = "예정";
    if (state === "ended") status = met ? "달성" : "미달";
    else if (state === "current") status = met ? "달성" : (remain <= PERF_ALERT_DAYS ? "미달 위험" : "진행중");
    const penalty = state === "ended" && !met && c.penType === "단가" && c.penPrice > 0 ? Math.round(short * c.penPrice) : 0;
    out.push({ n: i, s, e, guar, supply, excess, actual, ratio: guar ? actual / guar - 1 : 0, short: state === "ended" ? short : 0,
      state, status, totalDays, remain, penalty, penaltyMonth: e.slice(0, 4) + e.slice(5, 7) });
  }
  return out;
}

function perfContracts(kind) {
  const keys = kind === "gen" ? Object.keys(Registry.plants()) : Registry.rawCustomers().map(c => rStr(c["KPX신청번호"])).filter(Boolean);
  const byPlant = perfByPlant();
  return keys.map(k => { const c = contractOf(kind, k); const ys = yearSchedule(c, byPlant); return { c, ys, cur: ys && (ys.find(y => y.state === "current") || null) }; });
}

// 정산서 차감용: 이 달(YYYYMM)에 종료된 연차의 위약금 중 처리 방식이 "청구서 차감"인 것
function penaltyDue(kind, key, month) {
  const c = contractOf(kind, key), ys = yearSchedule(c, perfByPlant());
  if (!ys || c.penMethod !== "청구서 차감") return { amount: 0, label: "" };
  const hit = ys.filter(y => y.penalty > 0 && y.penaltyMonth === month);
  return { amount: hit.reduce((s, y) => s + y.penalty, 0), label: hit.map(y => `${y.n}년차 미달 ${Math.round(y.short).toLocaleString()} kWh`).join(", ") };
}

// 헤더 알림: 진행 연차가 종료 30일 이내인데 미달
function perfAlerts() {
  const out = [];
  [["cust", "전기사용자", "cust-perf"], ["gen", "발전소", "gen-perf"]].forEach(([kind, label, page]) => perfContracts(kind).forEach(({ c, cur }) => {
    if (cur && cur.status === "미달 위험") out.push({ d: cur.remain, page,
      text: `${label} ${c.name}: ${cur.n}년차 미달 위험 (종료 ${cur.e}, D-${cur.remain}, 달성률 ${Math.round((cur.ratio + 1) * 100)}%)` });
  }));
  return out;
}

/* ----- 화면 ----- */
const mwh = v => (v == null || isNaN(v)) ? "-" : (v / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = v => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
const STATUS_CLS = { "달성": "ok", "미달": "bad", "미달 위험": "bad", "진행중": "run", "예정": "wait" };

function renderPerfPages() { renderPerfPage("cust"); renderPerfPage("gen"); }

function renderPerfPage(kind) {
  const host = document.getElementById(kind === "gen" ? "perfGenPage" : "perfCustPage"); if (!host) return;
  const list = perfContracts(kind), label = kind === "gen" ? "발전소" : "전기사용자";
  const ended = list.flatMap(x => x.ys || []).filter(y => y.state === "ended");
  const kpi = [
    ["계약", list.length + "건"],
    ["진행 연차 달성", list.filter(x => x.cur && x.cur.status === "달성").length + "건"],
    ["미달 위험 (30일 이내)", list.filter(x => x.cur && x.cur.status === "미달 위험").length + "건"],
    ["종료 연차 미달", ended.filter(y => y.status === "미달").length + "건"],
    ["위약금 합계", ended.reduce((s, y) => s + y.penalty, 0).toLocaleString() + " 원"]
  ];
  const pk = kind === "gen" ? "perfGen" : "perfCust", pg = pageSlice(pk, list);
  host.innerHTML = `${perfState.loaded ? "" : `<div class="notice warn">월별 실적을 불러오지 못했습니다. Apps Script를 최신 Code.gs로 재배포했는지 확인하세요.</div>`}
    <div class="perf-kpis">${kpi.map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("")}</div>
    <div class="card"><h2>${label} 계약이행현황</h2>
      <div class="grid-wrap perf-wrap"><table class="grid perf-table"><tr><th>${label}</th><th class="num">계약용량(kW)</th><th class="num">효율감소</th><th>계약기간</th>
        <th>진행 연차</th><th style="min-width:170px">연차 남은 기간</th><th class="num">보장량(MWh)</th><th class="num">실적(MWh)</th><th class="num">달성률</th><th>상태</th></tr>
        ${pg.items.length ? pg.items.map(({ c, ys, cur }) => {
          const sub = kind === "cust" ? `${rEsc(c.key)} · 발전소 ${c.plants.length}개` : rEsc(rStr((Registry.plants()[c.key] || {})["사업자명(대표자명)"]));
          if (!ys) return `<tr class="perf-row" data-key="${rEsc(c.key)}"><td><b>${rEsc(c.name)}</b><div class="perf-sub">${sub}</div></td>
            <td colspan="9"><span class="tag bad">계약정보 부족</span> <span class="hint" style="margin:0">계약시작일·계약기간·연간보장공급량(또는 용량·보장시간)을 등록하세요</span></td></tr>`;
          const y = cur || (ys[ys.length - 1].state === "ended" ? ys[ys.length - 1] : ys[0]);
          const left = cur ? cur.remain / cur.totalDays : (y.state === "future" ? 1 : 0);
          return `<tr class="perf-row${perfState.open[kind] === c.key ? " active" : ""}" data-key="${rEsc(c.key)}"><td><b>${rEsc(c.name)}</b><div class="perf-sub">${sub}</div></td>
            <td class="num">${c.cap ? c.cap.toLocaleString() : "-"}</td><td class="num">${c.decline}%</td><td>${c.years}년<div class="perf-sub">${c.start} ~ ${ys[ys.length - 1].e}</div></td>
            <td>${cur ? `${cur.n} / ${c.years}년차` : (y.state === "future" ? "시작 전" : "계약 종료")}</td>
            <td>${cur ? `<div class="perf-bar"><span style="width:${(left * 100).toFixed(1)}%"></span></div><div class="perf-sub">D-${cur.remain} · ${cur.s} ~ ${cur.e}</div>` : "-"}</td>
            <td class="num">${mwh(y.guar)}</td><td class="num">${mwh(y.actual)}</td><td class="num">${Math.round((y.ratio + 1) * 100)}%</td>
            <td><span class="perf-badge ${STATUS_CLS[y.status]}">${y.status}</span></td></tr>`;
        }).join("") : `<tr><td colspan="10" class="hint">등록된 계약이 없습니다.</td></tr>`}</table></div>
      ${pagerHtml(pk, pg.page, pg.pages)}
      <div id="${kind}PerfDetail"></div></div>`;
  bindPager(host, () => renderPerfPage(kind));
  host.querySelectorAll(".perf-row").forEach(tr => tr.onclick = () => { perfState.open[kind] = perfState.open[kind] === tr.dataset.key ? null : tr.dataset.key; renderPerfPage(kind); });
  if (perfState.open[kind]) renderPerfDetail(kind, list.find(x => x.c.key === perfState.open[kind]));
}

function renderPerfDetail(kind, item) {
  const host = document.getElementById(kind + "PerfDetail"); if (!host || !item) return;
  const { c, ys } = item;
  if (!ys) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="reg-detail"><div class="reg-head"><h3 class="sub" style="margin:0">${rEsc(c.name)} 연차별 이행 현황</h3>
      <span class="hint" style="margin:0">1년차 보장량 ${mwh(c.g1)} MWh · 효율감소 ${c.decline}%/년 · 위약금 ${c.penType === "단가" ? `${c.penPrice.toLocaleString()}원/kWh` : "미정"} · ${rEsc(c.penMethod || "처리방식 미정")}</span></div>
    <div class="grid-wrap" style="max-height:none;margin-top:10px"><table class="grid perf-years"><tr><th>연차</th><th>기간</th><th class="num">보장량(MWh)</th><th class="num">실발전량(MWh)</th>
      <th class="num">초과발전량(MWh)</th><th class="num">합계(MWh)</th><th class="num">미달 비율</th><th class="num">미달량(MWh)</th><th class="num">위약금(원)</th><th>상태</th></tr>
      ${ys.map(y => `<tr class="yr-${STATUS_CLS[y.status]}"><td>${y.n}년차</td><td>${y.s} ~ ${y.e}</td><td class="num">${mwh(y.guar)}</td>
        <td class="num">${y.state === "future" ? "-" : mwh(y.supply)}</td><td class="num">${y.state === "future" ? "-" : mwh(y.excess)}</td><td class="num">${y.state === "future" ? "-" : mwh(y.actual)}</td>
        <td class="num">${y.state === "future" ? "-" : pct(y.ratio)}</td><td class="num">${y.short ? mwh(y.short) : "-"}</td>
        <td class="num">${y.penalty ? y.penalty.toLocaleString() + (c.penMethod === "청구서 차감" ? `<div class="perf-sub">${y.penaltyMonth.slice(0, 4)}.${y.penaltyMonth.slice(4)} 정산서 차감</div>` : "") : "-"}</td>
        <td><span class="perf-badge ${STATUS_CLS[y.status]}">${y.status}</span></td></tr>`).join("")}</table></div></div>`;
}

async function initPerformance() {
  await loadPerformance();
  renderPerfPages();
  if (typeof renderAlerts === "function") renderAlerts();
}
