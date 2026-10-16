/* ============ 정산요율관리 > SMP·REC 가격 (#marketPage) ============
 * 연도별 월 SMP(원/kWh)·REC(원/REC) 를 직접 입력해 앱데이터 "market:YYYY" {smp:[12], rec:[12]} 로 저장한다.
 * 미달 위약금 = 미달량(kWh) × 해당 연차 기간 가중평균 REC 단가(원/REC ÷ 1,000 = 원/kWh, 1 REC = 1MWh)
 *   가중치 = 그 계약의 월 실적(발전량, 연차 기간에 걸친 날짜 비율 반영). 실적이 없으면 단순 평균.
 */
const mktState = { year: String(new Date().getFullYear()) };

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

function renderMarketPage() {
  const host = document.getElementById("marketPage"); if (!host) return;
  const y = mktState.year, v = marketYear(y), now = new Date().getFullYear();
  const years = Array.from(new Set([String(now - 2), String(now - 1), String(now), String(now + 1), y].concat(Store.keys("market:").map(k => k.slice(7))))).sort();
  const num = arr => arr.map(Number).filter(x => !isNaN(x) && x !== 0);
  const avg = arr => { const a = num(arr); return a.length ? (a.reduce((s, x) => s + x, 0) / a.length) : null; };
  const fmtAvg = x => x == null ? "-" : x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  host.innerHTML = `<div class="card">
    <div class="reg-head"><h2>SMP · REC 가격</h2>
      <div class="row"><label class="adj-label">연도</label><select id="mktYear" style="min-width:110px">${years.map(x => `<option value="${x}"${x === y ? " selected" : ""}>${x}년</option>`).join("")}</select></div></div>
    <div class="grid-wrap" style="max-height:none;margin-top:12px"><table class="grid mkt-table">
      <tr><th style="width:110px">구분</th>${Array.from({ length: 12 }, (_, m) => `<th>${m + 1}월</th>`).join("")}<th>평균</th></tr>
      <tr><th class="rowh">SMP<div class="perf-sub">원/kWh</div></th>${v.smp.map((x, m) => `<td><input type="number" step="any" class="mkt-in" data-k="smp" data-m="${m}" value="${x === "" || x == null ? "" : x}"></td>`).join("")}<td class="num">${fmtAvg(avg(v.smp))}</td></tr>
      <tr><th class="rowh">REC<div class="perf-sub">원/REC</div></th>${v.rec.map((x, m) => `<td><input type="number" step="any" class="mkt-in" data-k="rec" data-m="${m}" value="${x === "" || x == null ? "" : x}"></td>`).join("")}<td class="num">${fmtAvg(avg(v.rec))}</td></tr>
    </table></div>
    <div class="row" style="margin-top:12px"><button class="btn accent" id="mktSave">저장</button><span id="mktStatus" class="status warn" style="background:none"></span></div></div>`;
  document.getElementById("mktYear").onchange = e => { mktState.year = e.target.value; renderMarketPage(); };
  document.getElementById("mktSave").onclick = saveMarket;
}

async function saveMarket() {
  const v = { smp: Array(12).fill(""), rec: Array(12).fill(""), savedAt: new Date().toISOString() };
  document.querySelectorAll("#marketPage .mkt-in").forEach(el => { v[el.dataset.k][Number(el.dataset.m)] = el.value === "" ? "" : Number(el.value); });
  const where = await Store.set("market:" + mktState.year, v);
  renderMarketPage();
  if (typeof renderPerfPages === "function") renderPerfPages(); // 미달 위약금 다시 계산
  const st = document.getElementById("mktStatus");
  st.textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨"; st.className = "status " + (where === "remote" ? "ok" : "warn");
}
