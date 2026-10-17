/* ============ 계약관리 > 계약이행현황 (전기사용자 / 발전사업자) ============
 * 연차별 연간보장공급량 = 1년차 보장량 × (1 − 연간효율감소)^(연차−1)
 *   1년차 보장량 = 등록된 연간보장공급량 (없으면 계약용량 × 보장시간으로 계산)
 * 연차 실적 = 실발전량(공급량) + 초과발전량(발전량 − 공급량)  ← 월별실적로그(가정산 업로드 때 기록)를 날짜 비율로 연차에 배분
 *   발전사업자 = 그 발전소, 전기사용자 = 그룹(KPX 신청번호) 발전소 합계
 *   같은 신청번호에 계약이 여러 건이면 그 달에 유효한 계약끼리 계약용량 비율로 나눈다
 * 미달량 = 보장량 − 실적 (종료된 연차), 미달 위약금 = 미달량 × 연차 기간 가중평균 REC 단가 (js/market.js). 해지 위약금은 방식 정리 후 추가
 * 처리 방식이 "청구서 차감"이면 연차 종료월 정산서에서 차감한다 (전기사용자 가정산서 / 발전사업자 정산서).
 */
const PERF_ALERT_DAYS = 30;
const perfState = { rows: null, loaded: false, open: { cust: null, gen: null }, year: { cust: "", gen: "" } }; // year: "" = 진행 중 연차, "1"~"20"

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
  const raw = kind === "gen" ? Registry.plants()[key] : Registry.customerByKey(key);
  if (!raw) return null;
  const num = v => Number(v), cap = num(raw["계약용량"]) || 0;
  let g1 = num(raw["연간보장공급량"]);
  if (!(g1 > 0)) { const hrs = (kind === "gen" ? num(raw["발전보장시간"]) : hoursPerDay(raw["연간보장시간"])) * 365; g1 = cap > 0 && hrs > 0 ? cap * hrs : 0; } // 보장시간(h/일) × 365
  const start = rStr(raw["계약일자"]), end = rStr(raw["계약해지일"]);
  let years = Math.round(num(raw["계약기간"]) || 0);
  if (!years && YMD.test(start) && YMD.test(end)) years = Math.max(1, Math.round(ymdDays(start, end) / 365.25));
  const app = kind === "gen" ? "" : rStr(raw["KPX신청번호"]);
  const endOf = r => rStr(r["계약해지일"]) || (YMD.test(rStr(r["계약일자"])) && Number(r["계약기간"]) > 0 ? addMonthsYmd(rStr(r["계약일자"]), 12 * Math.round(Number(r["계약기간"])), -1) : "");
  // 같은 신청번호의 다른 계약과 그룹 실적을 나눌 비율 (그 달에 유효한 계약들의 계약용량 비율)
  let shareOf = () => 1;
  if (kind === "cust") {
    const sibs = Registry.contractsOfApp(app).map(r => ({ key: Registry.custKey(r), cap: Number(r["계약용량"]) || 0, start: rStr(r["계약일자"]), end: endOf(r) }));
    if (sibs.length > 1) shareOf = ym => {
      const ms = `${ym.slice(0, 4)}-${ym.slice(4)}-01`, me = `${ym.slice(0, 4)}-${ym.slice(4)}-31`;
      const act = sibs.filter(x => x.cap > 0 && (!x.start || x.start <= me) && (!x.end || x.end >= ms));
      const tot = act.reduce((t, x) => t + x.cap, 0);
      return tot > 0 && act.some(x => x.key === key) ? cap / tot : 0;
    };
  }
  return {
    kind, key, app, name: kind === "gen" ? key : rStr(raw["수요기업명"]), cap, g1, decline: num(raw["연간효율감소"]) || 0, start, end, years,
    penMethod: rStr(raw["위약금처리방식"]), shareOf,
    plants: kind === "gen" ? [key] : Registry.plantsOfGroup(app)
  };
}

function yearSchedule(c, byPlant) {
  if (!c || !YMD.test(c.start) || !(c.years > 0) || !(c.g1 > 0)) return null;
  const today = todayYmd(), out = [];
  for (let i = 1; i <= c.years; i++) {
    const s = addMonthsYmd(c.start, 12 * (i - 1), 0), e = addMonthsYmd(c.start, 12 * i, -1);
    const guar = c.g1 * Math.pow(1 - c.decline / 100, i - 1);
    let supply = 0, gen = 0; const weights = {}; // weights: 월 발전량 (가중평균 REC 용)
    c.plants.forEach(p => Object.entries(byPlant[p] || {}).forEach(([ym, v]) => {
      const sh = c.shareOf(ym); weights[ym] = (weights[ym] || 0) + v.gen * sh;
      const f = overlapFrac(ym, s, e) * sh; if (f > 0) { supply += v.supply * f; gen += v.gen * f; }
    }));
    const excess = gen - supply, actual = supply + excess;
    const state = e < today ? "ended" : (s > today ? "future" : "current");
    const totalDays = ymdDays(s, e) + 1, remain = state === "current" ? ymdDays(today, e) : (state === "future" ? totalDays : 0);
    const met = actual >= guar, short = Math.max(0, guar - actual);
    let status = "예정";
    if (state === "ended") status = met ? "달성" : "미달";
    else if (state === "current") status = met ? "달성" : (remain <= PERF_ALERT_DAYS ? "미달 위험" : "진행중");
    const rec = state === "ended" && !met && typeof weightedRec === "function" ? weightedRec(s, e, weights) : null; // 원/REC
    const penalty = rec != null ? Math.round(short * rec / 1000) : 0; // 1 REC = 1MWh
    out.push({ n: i, s, e, guar, rec, recMissing: state === "ended" && !met && rec == null, supply, excess, actual, ratio: guar ? actual / guar - 1 : 0, short: state === "ended" ? short : 0,
      state, status, totalDays, remain, penalty, penaltyMonth: e.slice(0, 4) + e.slice(5, 7) });
  }
  return out;
}

function perfContracts(kind) {
  const keys = kind === "gen" ? Object.keys(Registry.plants()) : Registry.rawCustomers().map(c => Registry.custKey(c)).filter(Boolean);
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

// 전기사용자 정산서(신청번호 단위): 그 신청번호의 모든 계약 위약금 합계
function penaltyDueGroup(app, month) {
  const hits = Registry.contractsOfApp(app).map(c => ({ key: Registry.custKey(c), p: penaltyDue("cust", Registry.custKey(c), month) })).filter(x => x.p.amount > 0);
  return { amount: hits.reduce((s, x) => s + x.p.amount, 0), label: hits.map(x => (hits.length > 1 ? x.key + " " : "") + x.p.label).join(" / ") };
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
  const list = perfContracts(kind), label = kind === "gen" ? "발전소" : "전기사용자", sel = perfState.year[kind];
  const pick = ({ ys, cur }) => !ys ? null : (sel ? ys[Number(sel) - 1] || null : cur); // 표에 보일 연차
  const shown = list.map(pick).filter(Boolean);
  const ended = list.flatMap(x => x.ys || []).filter(y => y.state === "ended");
  const kpi = [
    ["계약", list.length + "건"],
    [`${sel ? sel + "년차" : "진행 연차"} 달성`, shown.filter(y => y.status === "달성").length + "건"],
    ["미달 위험 (30일 이내)", list.filter(x => x.cur && x.cur.status === "미달 위험").length + "건"],
    ["종료 연차 미달", ended.filter(y => y.status === "미달").length + "건"],
    ["미달 위약금 합계", ended.reduce((sum, y) => sum + y.penalty, 0).toLocaleString() + " 원"]
  ];
  const pk = kind === "gen" ? "perfGen" : "perfCust", pg = pageSlice(pk, list);
  host.innerHTML = `${perfState.loaded ? "" : `<div class="notice warn">월별 실적을 불러오지 못했습니다. Apps Script를 최신 Code.gs로 재배포했는지 확인하세요.</div>`}
    <div class="perf-kpis">${kpi.map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("")}</div>
    <div class="card"><div class="reg-head"><h2>${label} 계약이행현황</h2>
      <div class="row"><label class="adj-label">해당 연차</label><select id="${kind}PerfYear" style="min-width:140px"><option value="">진행 중 연차</option>
        ${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}"${sel === String(i + 1) ? " selected" : ""}>${i + 1}년차</option>`).join("")}</select></div></div>
      <div class="grid-wrap perf-wrap" style="margin-top:10px"><table class="grid perf-table"><tr><th>${label}</th><th class="num">계약용량(kW)</th><th class="num">효율감소</th><th>계약기간</th>
        <th>해당 연차</th><th>연차 남은 기간</th><th class="num">보장량(MWh)</th><th class="num">실적(MWh)</th><th class="num">달성률</th><th>상태</th></tr>
        ${pg.items.length ? pg.items.map(item => {
          const { c, ys } = item;
          const sub = kind === "cust" ? `${rEsc(c.key)}${c.key !== c.app ? " · " + rEsc(c.app) : ""} · 발전소 ${c.plants.length}개` : rEsc(rStr((Registry.plants()[c.key] || {})["사업자명(대표자명)"]));
          const head = `<td><b>${rEsc(c.name)}</b><div class="perf-sub">${sub}</div></td>`;
          if (!ys) return `<tr class="perf-row" data-key="${rEsc(c.key)}">${head}<td colspan="9"><span class="tag bad">계약정보 부족</span></td></tr>`;
          const y = pick(item);
          const period = `<td class="num">${c.cap ? fmtKw(c.cap) : "-"}</td><td class="num">${c.decline}%</td><td>${c.years}년<div class="perf-sub"><span class="nw">${c.start}</span> ~ <span class="nw">${ys[ys.length - 1].e}</span></div></td>`;
          if (!y) return `<tr class="perf-row" data-key="${rEsc(c.key)}">${head}${period}<td colspan="6" class="hint">${sel ? "계약기간 밖" : (ys[0].state === "future" ? "시작 전" : "계약 종료")}</td></tr>`;
          const left = y.state === "current" ? y.remain / y.totalDays : (y.state === "future" ? 1 : 0);
          const bar = y.state === "current" ? `<div class="perf-bar"><span style="width:${(left * 100).toFixed(1)}%"></span></div><div class="perf-sub">D-${y.remain} · <span class="nw">${y.s}</span> ~ <span class="nw">${y.e}</span></div>`
            : `<div class="perf-bar"><span style="width:${left * 100}%"></span></div><div class="perf-sub">${y.state === "future" ? "시작 전" : "종료"} · <span class="nw">${y.s}</span> ~ <span class="nw">${y.e}</span></div>`;
          const future = y.state === "future";
          return `<tr class="perf-row${perfState.open[kind] === c.key ? " active" : ""}" data-key="${rEsc(c.key)}">${head}${period}
            <td>${y.n} / ${c.years}년차</td><td>${bar}</td>
            <td class="num">${mwh(y.guar)}</td><td class="num">${future ? "-" : mwh(y.actual)}</td><td class="num">${future ? "-" : Math.round((y.ratio + 1) * 100) + "%"}</td>
            <td><span class="perf-badge ${STATUS_CLS[y.status]}">${y.status}</span></td></tr>`;
        }).join("") : `<tr><td colspan="10" class="hint">등록된 계약이 없습니다.</td></tr>`}</table></div>
      ${pagerHtml(pk, pg.page, pg.pages)}
      <div id="${kind}PerfDetail"></div></div>`;
  bindPager(host, () => renderPerfPage(kind));
  document.getElementById(kind + "PerfYear").onchange = e => { perfState.year[kind] = e.target.value; renderPerfPage(kind); };
  host.querySelectorAll(".perf-row").forEach(tr => tr.onclick = () => { perfState.open[kind] = perfState.open[kind] === tr.dataset.key ? null : tr.dataset.key; renderPerfPage(kind); });
  if (perfState.open[kind]) renderPerfDetail(kind, list.find(x => x.c.key === perfState.open[kind]));
}

function renderPerfDetail(kind, item) {
  const host = document.getElementById(kind + "PerfDetail"); if (!host || !item) return;
  const { c, ys } = item;
  if (!ys) { host.innerHTML = ""; return; }
  host.innerHTML = `<div class="reg-detail"><div class="reg-head"><h3 class="sub" style="margin:0">${rEsc(c.name)} 연차별 이행 현황</h3>
      <span class="hint" style="margin:0">1년차 보장량 ${mwh(c.g1)} MWh · 효율감소 ${c.decline}%/년 · 위약금 처리 ${rEsc(c.penMethod || "미정")}</span></div>
    <div class="grid-wrap" style="max-height:none;margin-top:10px"><table class="grid perf-years"><tr><th>연차</th><th>기간</th><th class="num">보장량(MWh)</th><th class="num">실발전량(MWh)</th>
      <th class="num">초과발전량(MWh)</th><th class="num">합계(MWh)</th><th class="num">미달 비율</th><th class="num">미달량(MWh)</th><th class="num">가중평균 REC(원)</th><th class="num">미달 위약금(원)</th><th>상태</th></tr>
      ${ys.map(y => `<tr class="yr-${STATUS_CLS[y.status]}"><td>${y.n}년차</td><td><span class="nw">${y.s}</span> ~ <span class="nw">${y.e}</span></td><td class="num">${mwh(y.guar)}</td>
        <td class="num">${y.state === "future" ? "-" : mwh(y.supply)}</td><td class="num">${y.state === "future" ? "-" : mwh(y.excess)}</td><td class="num">${y.state === "future" ? "-" : mwh(y.actual)}</td>
        <td class="num">${y.state === "future" ? "-" : pct(y.ratio)}</td><td class="num">${y.short ? mwh(y.short) : "-"}</td>
        <td class="num">${y.rec != null ? Math.round(y.rec).toLocaleString() : (y.recMissing ? '<span class="tag bad">REC 미입력</span>' : "-")}</td>
        <td class="num">${y.penalty ? y.penalty.toLocaleString() + (c.penMethod === "청구서 차감" ? `<div class="perf-sub">${y.penaltyMonth.slice(0, 4)}.${y.penaltyMonth.slice(4)} 정산서 차감</div>` : "") : "-"}</td>
        <td><span class="perf-badge ${STATUS_CLS[y.status]}">${y.status}</span></td></tr>`).join("")}</table></div></div>`;
}

async function initPerformance() {
  await loadPerformance();
  renderPerfPages();
  if (typeof renderAlerts === "function") renderAlerts();
}
