/* ============ 정산요율관리 > SMP·REC 가격 (#marketPage) ============
 * REC: 연도별 월 육지 평균(원/REC) → 앱데이터 "market:YYYY" {rec:[12]}
 * SMP: 월별 시간대별(일 × 0~23시, 원/kWh) → "smp:YYYYMM" — 초과발전량 REC 계산이 이 값을 쓴다. 월 평균은 자동 계산.
 * 미달 위약금 = 미달량(kWh) × 해당 연차 기간 가중평균 REC 단가(원/REC ÷ 1,000 = 원/kWh, 1 REC = 1MWh)
 *   가중치 = 그 계약의 월 실적(발전량, 연차 기간에 걸친 날짜 비율 반영). 실적이 없으면 단순 평균.
 */
const mktState = { year: String(new Date().getFullYear()), month: "" };

function marketYear(y) { const v = Store.get("market:" + y, null) || {}; return { smp: v.smp || Array(12).fill(""), rec: v.rec || Array(12).fill("") }; }
function recPrice(ym) { const v = marketYear(ym.slice(0, 4)).rec[Number(ym.slice(4)) - 1]; return v === "" || v == null || isNaN(Number(v)) ? null : Number(v); }

// 기간 [s, e] 의 가중평균 REC (원/REC). weights: {YYYYMM: 가중치}
function weightedRec(s, e, weights) {
  let sum = 0, w = 0, plain = 0, n = 0;
  for (let ym = s.slice(0, 4) + s.slice(5, 7); ym <= e.slice(0, 4) + e.slice(5, 7); ym = nextYm(ym)) {
    const p = recPrice(ym); if (p == null) continue;
    const f = overlapFrac(ym, s, e); if (f <= 0) continue;
    const wt = (weights[ym] || 0) * f;
    sum += p * wt; w += wt; plain += p * f; n += f;
  }
  if (w > 0) return sum / w;
  return n > 0 ? plain / n : null;
}

// 월 범위 [lo, hi](YYYYMM) 의 가중평균 REC (원/REC). 가격 없는 달은 제외, 가중치 없으면 단순 평균
function weightedRecMonths(lo, hi, weights) {
  let sum = 0, w = 0, plain = 0, n = 0;
  for (let ym = lo; ym <= hi; ym = nextYm(ym)) {
    const p = recPrice(ym); if (p == null) continue;
    const wt = weights[ym] || 0; sum += p * wt; w += wt; plain += p; n++;
  }
  return w > 0 ? sum / w : (n > 0 ? plain / n : null);
}

/* 시간대별 SMP: 앱데이터 smp:YYYYMM = { 일: [0~23시 SMP 원/kWh] } — 초과발전량 REC 계산(js/rec.js)이 그대로 읽는다 */
const smpMonth = ym => Store.get("smp:" + ym, null) || {};
function smpMonthAvg(ym) { // 시간대별 SMP 월 평균 (없으면 null)
  const v = Object.values(smpMonth(ym)).flat().filter(x => x !== null && x !== "" && x !== undefined).map(Number).filter(x => !isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const daysIn = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(4)), 0).getDate();

function renderMarketPage() {
  const host = document.getElementById("marketPage"); if (!host) return;
  const y = mktState.year, v = marketYear(y), now = new Date().getFullYear();
  const years = Array.from(new Set([String(now - 2), String(now - 1), String(now), String(now + 1), y].concat(Store.keys("market:").map(k => k.slice(7))).concat(Store.keys("smp:").map(k => k.slice(4, 8))))).sort();
  if (!mktState.month || mktState.month.slice(0, 4) !== y) {
    const has = Store.keys("smp:" + y).map(k => k.slice(4)).sort();
    mktState.month = has.length ? has[has.length - 1] : `${y}${String(Math.min(12, new Date().getMonth() + 1)).padStart(2, "0")}`;
  }
  const months = Array.from({ length: 12 }, (_, m) => `${y}${String(m + 1).padStart(2, "0")}`);
  const fmt = x => x == null ? "-" : x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const recNums = v.rec.map(Number).filter(x => !isNaN(x) && x !== 0);
  const smpAvgs = months.map(smpMonthAvg), smpYear = smpAvgs.filter(x => x != null);
  const ym = mktState.month, cur = smpMonth(ym), nd = daysIn(ym);
  host.innerHTML = `<div class="card">
    <div class="reg-head"><h2>SMP · REC 가격</h2>
      <div class="row"><select id="mktYear" style="min-width:110px">${years.map(x => `<option value="${x}"${x === y ? " selected" : ""}>${x}년</option>`).join("")}</select></div></div>
    <div class="grid-wrap" style="max-height:none;margin-top:12px"><table class="grid mkt-table">
      <tr><th style="width:120px">구분</th>${months.map((m, i) => `<th>${i + 1}월</th>`).join("")}<th>평균</th></tr>
      <tr><th class="rowh">SMP<div class="perf-sub">원/kWh · 시간대별 평균</div></th>${smpAvgs.map((a, i) => `<td class="num${months[i] === ym ? " mkt-cur" : ""}"><a href="#" class="mkt-m" data-ym="${months[i]}">${fmt(a)}</a></td>`).join("")}
        <td class="num">${fmt(smpYear.length ? smpYear.reduce((s, x) => s + x, 0) / smpYear.length : null)}</td></tr>
      <tr><th class="rowh">REC<div class="perf-sub">원/REC · 육지 평균</div></th>${v.rec.map((x, m) => `<td><input type="number" step="any" class="mkt-in" data-k="rec" data-m="${m}" value="${x === "" || x == null ? "" : x}"></td>`).join("")}
        <td class="num">${fmt(recNums.length ? recNums.reduce((s, x) => s + x, 0) / recNums.length : null)}</td></tr>
    </table></div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="mktSave">REC 저장</button><span id="mktStatus" class="status warn" style="background:none"></span></div></div>
  <div class="card">
    <div class="reg-head"><h2>시간대별 SMP</h2>
      <div class="row"><select id="smpMonth" style="min-width:150px">${months.map(m => { const n = Object.keys(smpMonth(m)).length; return `<option value="${m}"${m === ym ? " selected" : ""}>${Number(m.slice(4))}월 (${n}/${daysIn(m)}일)</option>`; }).join("")}</select>
        <label class="btn secondary" style="cursor:pointer">파일 불러오기<input type="file" id="smpFile" accept=".xlsx,.xls,.csv" multiple hidden></label>
        <button class="btn accent" id="smpSave">SMP 저장</button></div></div>
    <span id="smpStatus" class="status warn" style="background:none"></span>
    <div class="grid-wrap smp-wrap"><table class="grid smp-table">
      <tr><th>일</th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join("")}<th>평균</th></tr>
      ${Array.from({ length: nd }, (_, i) => { const d = i + 1, row = cur[d] || [];
        const nums = row.filter(x => x !== null && x !== "" && x !== undefined).map(Number).filter(x => !isNaN(x)), av = nums.length === 24 ? nums.reduce((a, b) => a + b, 0) / 24 : null;
        return `<tr><th>${d}</th>${Array.from({ length: 24 }, (_, h) => `<td><input type="text" inputmode="decimal" class="smp-in" data-d="${d}" data-h="${h}" value="${row[h] == null || row[h] === "" ? "" : row[h]}"></td>`).join("")}<td class="num">${fmt(av)}</td></tr>`; }).join("")}
    </table></div></div>`;
  document.getElementById("mktYear").onchange = async e => { mktState.year = e.target.value; mktState.month = ""; await Store.ensureYear(Number(mktState.year)); renderMarketPage(); };
  document.getElementById("mktSave").onclick = saveMarket;
  document.getElementById("smpMonth").onchange = e => { mktState.month = e.target.value; renderMarketPage(); };
  host.querySelectorAll(".mkt-m").forEach(a => a.onclick = e => { e.preventDefault(); mktState.month = a.dataset.ym; renderMarketPage(); });
  document.getElementById("smpSave").onclick = saveSmp;
  document.getElementById("smpFile").onchange = async e => { const files = [...e.target.files]; e.target.value = ""; await importSmpFiles(files); };
  // 엑셀에서 복사한 표(탭·줄바꿈)를 붙여넣으면 그 칸부터 채운다
  host.querySelectorAll(".smp-in").forEach(inp => inp.addEventListener("paste", ev => {
    const text = (ev.clipboardData || window.clipboardData).getData("text"); if (!/[\t\n]/.test(text)) return;
    ev.preventDefault();
    const d0 = Number(inp.dataset.d), h0 = Number(inp.dataset.h);
    text.replace(/\r/g, "").split("\n").filter(l => l.trim() !== "").forEach((line, r) => line.split("\t").forEach((val, c) => {
      const el = host.querySelector(`.smp-in[data-d="${d0 + r}"][data-h="${h0 + c}"]`); if (el) el.value = String(val).replace(/,/g, "").trim();
    }));
  }));
}

async function saveSmp() {
  const ym = mktState.month, out = {};
  document.querySelectorAll("#marketPage .smp-in").forEach(el => {
    const n = Number(String(el.value).replace(/,/g, "").trim());
    if (el.value.trim() === "" || isNaN(n)) return;
    const d = Number(el.dataset.d), row = out[d] || (out[d] = Array(24).fill(null)); row[Number(el.dataset.h)] = n;
  });
  const partial = Object.keys(out).filter(d => out[d].some(v => v == null));
  if (partial.length && !confirm(`${partial.length}일은 24시간이 다 채워지지 않았습니다. 그대로 저장할까요?`)) return;
  const where = await Store.set("smp:" + ym, out);
  if (where === "denied") return;
  afterSmpChange();
  renderMarketPage();
  const s2 = document.getElementById("smpStatus"); s2.textContent = `${Number(ym.slice(4))}월 ${Object.keys(out).length}일 저장 · 초과발전량 REC 반영`; s2.className = "status ok";
}
async function importSmpFiles(files) {
  const st = document.getElementById("smpStatus"), done = [];
  for (const f of files) {
    try {
      const p = recParseWorkbook(XLSX.read(await f.arrayBuffer(), { type: "array" }));
      for (const ym of Object.keys(p.smp)) {
        const cur = smpMonth(ym); Object.assign(cur, p.smp[ym]);
        if ((await Store.set("smp:" + ym, cur)) === "denied") return;
        done.push(`${ym.slice(0, 4)}.${ym.slice(4)} ${Object.keys(p.smp[ym]).length}일`);
      }
    } catch (e) { done.push(`⚠ ${f.name}: ${e.message}`); }
  }
  afterSmpChange();
  const last = done.filter(x => !/⚠/.test(x)).pop(); if (last) { mktState.year = last.slice(0, 4); mktState.month = last.slice(0, 4) + last.slice(5, 7); }
  renderMarketPage();
  const s2 = document.getElementById("smpStatus"); s2.textContent = done.length ? done.join(", ") : "시간별 SMP 표를 찾지 못했습니다"; s2.className = "status " + (done.length && !done.some(x => /⚠/.test(x)) ? "ok" : "warn");
}
// SMP가 바뀌면 초과발전량 REC 계산을 다시 (js/rec.js)
function afterSmpChange() {
  if (typeof recState !== "undefined") recState.result = null;
  if (typeof renderRecPage === "function" && document.getElementById("recPage") && document.getElementById("recPage").innerHTML) renderRecPage();
}

async function saveMarket() {
  const old = Store.get("market:" + mktState.year, null) || {};
  const v = { smp: old.smp || Array(12).fill(""), rec: Array(12).fill(""), savedAt: new Date().toISOString() };
  document.querySelectorAll("#marketPage .mkt-in").forEach(el => { v[el.dataset.k][Number(el.dataset.m)] = el.value === "" ? "" : Number(el.value); });
  const where = await Store.set("market:" + mktState.year, v);
  if (where === "denied") return;
  renderMarketPage();
  if (typeof renderPerfPages === "function") renderPerfPages(); // 미달 위약금 다시 계산
  const st = document.getElementById("mktStatus");
  st.textContent = where === "remote" ? "저장 완료" : "이 브라우저에만 저장됨"; st.className = "status " + (where === "remote" ? "ok" : "warn");
}
