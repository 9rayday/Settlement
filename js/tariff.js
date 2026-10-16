/* ============ 정산요율관리 > 시간대별 요금제 관리 ============
 * 부하구분(경/중간/최대) 월별 시간대 표와 공휴일 목록을 보고 고친다. 저장하면 앱데이터 "tou" 키에 들어가고,
 * Parsers.TARIFF / Parsers.HOLIDAYS 를 바꿔 이후 정산 계산의 부하구분에 바로 쓰인다.
 */
const TOU_DEFAULT = { tariff: Parsers.TARIFF.slice(), holidays: JSON.parse(JSON.stringify(Parsers.HOLIDAYS)) };
const TOU_NAME = { L: "경부하", M: "중간부하", H: "최대부하" };
const TOU_NEXT = { L: "M", M: "H", H: "L" };
const touState = { draft: null, year: String(new Date().getFullYear()) };

function applyTouSettings(v) {
  if (!v) return;
  if (Array.isArray(v.tariff) && v.tariff.length === 12 && v.tariff.every(r => /^[LMH]{24}$/.test(r))) Parsers.TARIFF = v.tariff.slice();
  if (v.holidays && typeof v.holidays === "object") Parsers.HOLIDAYS = JSON.parse(JSON.stringify(v.holidays));
}

function renderTouPage() {
  const host = document.getElementById("touPage"); if (!host) return;
  if (!touState.draft) touState.draft = { tariff: Parsers.TARIFF.slice(), holidays: JSON.parse(JSON.stringify(Parsers.HOLIDAYS)) };
  const d = touState.draft;
  const years = Array.from(new Set(Object.keys(d.holidays).concat([touState.year, String(Number(touState.year) + 1)]))).sort();
  const hol = (d.holidays[touState.year] || []).slice().sort();
  const saved = Store.get("tou", null);
  host.innerHTML = `
    <div class="card">
      <div class="reg-head"><h2>부하구분 시간대 (월 × 시간)</h2>
        <div class="tou-legend">${Object.keys(TOU_NAME).map(k => `<span class="tou-chip ${k}">${TOU_NAME[k]}</span>`).join("")}</div></div>
      <p class="hint">칸을 누르면 경부하 → 중간부하 → 최대부하 순으로 바뀝니다. 0시 = 0~1시 구간. 일요일·공휴일은 전 시간 경부하, 토요일은 최대부하 시간을 중간부하로 계산합니다.</p>
      <div class="grid-wrap"><table class="tou-table"><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join("")}</tr>
        ${d.tariff.map((row, m) => `<tr><th>${m + 1}월</th>${row.split("").map((c, h) =>
          `<td class="tou-cell ${c}" data-m="${m}" data-h="${h}" title="${m + 1}월 ${h}시 · ${TOU_NAME[c]}">${TOU_NAME[c][0]}</td>`).join("")}</tr>`).join("")}</table></div>
    </div>
    <div class="card">
      <div class="reg-head"><h2>공휴일 (관공서 공휴일·대체공휴일)</h2>
        <div class="row"><label class="adj-label">연도</label><select id="touYear" style="min-width:110px">${years.map(y => `<option${y === touState.year ? " selected" : ""}>${y}</option>`).join("")}</select></div></div>
      <p class="hint">공휴일은 해마다 바뀌니 연초에 추가하세요. 공휴일은 전 시간 경부하로 계산합니다.</p>
      <div class="tou-holidays">${hol.length ? hol.map(md => `<span class="tou-hol">${touState.year}-${md}<button type="button" data-md="${md}" aria-label="삭제">×</button></span>`).join("") : '<span class="hint" style="margin:0">등록된 공휴일이 없습니다.</span>'}</div>
      <div class="row" style="margin-top:10px"><input type="date" id="touAddDate" min="${touState.year}-01-01" max="${touState.year}-12-31"><button class="btn secondary" id="touAddBtn">공휴일 추가</button></div>
    </div>
    <div class="row"><button class="btn accent" id="touSave">저장</button><button class="btn secondary" id="touReset">기본값으로 되돌리기</button>
      <span id="touStatus" class="status warn" style="background:none">${saved ? "마지막 저장: " + new Date(saved.savedAt).toLocaleString() : "저장된 설정 없음 (기본값 사용 중)"}</span></div>`;
  host.querySelectorAll(".tou-cell").forEach(td => td.onclick = () => {
    const m = Number(td.dataset.m), h = Number(td.dataset.h), row = d.tariff[m].split("");
    row[h] = TOU_NEXT[row[h]]; d.tariff[m] = row.join("");
    td.className = "tou-cell " + row[h]; td.textContent = TOU_NAME[row[h]][0]; td.title = `${m + 1}월 ${h}시 · ${TOU_NAME[row[h]]}`;
    touDirty();
  });
  document.getElementById("touYear").onchange = e => { touState.year = e.target.value; renderTouPage(); };
  host.querySelectorAll(".tou-hol button").forEach(b => b.onclick = () => {
    d.holidays[touState.year] = (d.holidays[touState.year] || []).filter(x => x !== b.dataset.md); renderTouPage(); touDirty();
  });
  document.getElementById("touAddBtn").onclick = () => {
    const v = document.getElementById("touAddDate").value; if (!v) return;
    const [y, md] = [v.slice(0, 4), v.slice(5)];
    const list = d.holidays[y] || (d.holidays[y] = []);
    if (!list.includes(md)) list.push(md);
    touState.year = y; renderTouPage(); touDirty();
  };
  document.getElementById("touSave").onclick = saveTou;
  document.getElementById("touReset").onclick = () => {
    if (!confirm("부하구분 표와 공휴일을 기본값으로 되돌릴까요? (저장을 눌러야 반영됩니다)")) return;
    touState.draft = JSON.parse(JSON.stringify(TOU_DEFAULT)); renderTouPage(); touDirty();
  };
}
function touDirty() { const st = document.getElementById("touStatus"); st.textContent = "변경됨 — 저장을 눌러야 정산 계산에 반영됩니다"; st.className = "status warn"; }

async function saveTou() {
  const d = touState.draft;
  Object.keys(d.holidays).forEach(y => { d.holidays[y] = Array.from(new Set(d.holidays[y])).sort(); if (!d.holidays[y].length) delete d.holidays[y]; });
  const value = { tariff: d.tariff.slice(), holidays: d.holidays, savedAt: new Date().toISOString() };
  const where = await Store.set("tou", value);
  applyTouSettings(value);
  renderTouPage();
  const st = document.getElementById("touStatus");
  st.textContent = where === "remote" ? "저장 완료 (구글시트) — 이후 정산 계산에 반영" : "이 브라우저에만 저장됨 (GAS 연결 확인 필요)";
  st.className = "status " + (where === "remote" ? "ok" : "warn");
}

// Store.load 이후 호출 (billing.js initBilling)
function initTariff() {
  applyTouSettings(Store.get("tou", null));
  touState.draft = null;
  renderTouPage();
}
