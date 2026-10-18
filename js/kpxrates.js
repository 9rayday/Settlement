/* ============ 정산요율관리 > KPX 요율 관리 (#tab4) ============
 * 망이용 유형 참고표 + KPX 요금·손실률·정산 요율 버전(적용일자 기준)
 * 버전은 앱데이터 "netrate:<저장시각 ms>" 키로 쌓는다. 정산월에는 적용일자가 그 달 1일 이전(포함)인 버전 중 가장 최근 것을 쓴다.
 */
const NET_TYPES = [
  [1, "송전 발전사 – 송전 사용자", [["발전측 송전", "미적용"], ["수요측 송전", "송전손실률 적용"]]],
  [2, "송전 발전사 – 배전고압 사용자", [["발전측 송전", "미적용"], ["수요측 송전", "송전손실률 적용"], ["배전고압", "종합손실률 적용"]]],
  [3, "배전고압 발전사 – 배전고압 사용자 (동일변전소)", [["배전고압", "배전손실률 적용"]]],
  [4, "배전저압 발전사 – 배전고압 사용자 (동일변전소)", [["배전고압", "배전손실률 적용"]]],
  [5, "배전고압 발전사 – 송전 사용자", [["발전측 송전", "미적용"], ["수요측 송전", "송전손실률 적용"]]],
  [6, "배전저압 발전사 – 송전 사용자", [["발전측 송전", "미적용"], ["수요측 송전", "송전손실률 적용"]]],
  [7, "기존 데이터 포맷 (2번과 같은 계산식)", [["발전측 송전 + 수요측 송전 + 배전고압", "송전손실률 / 종합손실률 적용"]]],
  [8, "기존 데이터 포맷 (2번과 같은 계산식)", [["발전측 송전 + 수요측 송전 + 배전고압", "송전손실률 / 종합손실률 적용"]]]
];
// 섹션: [키, 제목, 첫 열 제목, 값 열 제목, [[행 키, 행 이름], ...]]
const NET_SECTIONS = [
  ["gen", "1. 발전지역 송전 요금 (원/kWh)", "발전지역", "사용요금", [["수도권북", "수도권 북부"], ["수도권남", "수도권 남부"], ["비수도권", "비수도권"], ["제주", "제주지역"]]],
  ["demand", "2. 수요지역 송전 요금 (원/kWh)", "수요지역", "사용요금", [["수도권", "수도권"], ["비수도권", "비수도권"], ["제주", "제주지역"]]],
  ["dist", "3. 배전이용 요금 (원/kWh)", "이용전압별", "사용요금", [["low", "저압 (600V 이하)"], ["high", "고압 (600V 초과)"]]],
  ["loss", "4. 손실률 (%)", "종류", "손실률(%)", [["trans", "송전손실률"], ["dist", "배전손실률"], ["total", "종합손실률"]]],
  ["etc", "5. 정산 요율", "항목", "값", [["surcharge", "예상 부가정산금 단가 (원/kWh)"], ["taxable", "확정 부가정산금 과세 비율 (%)"],
    ["tradeFee", "거래수수료 (원/kWh)"], ["fund", "전력산업기반기금 (%)"], ["vat", "부가가치세 (%)"]]]
];
const NET_DEFAULT = {
  effective: "", savedAt: "",
  gen: Object.assign({}, Engine.DEFAULT_RATES.genSide), demand: Object.assign({}, Engine.DEFAULT_RATES.demandSide),
  dist: { low: 11.33, high: Engine.DEFAULT_RATES.distribution },
  loss: { trans: 1.57, dist: 1.98, total: 3.52 },
  etc: { surcharge: Engine.DEFAULT_RATES.surcharge, taxable: Engine.DEFAULT_RATES.taxableRatio * 100, tradeFee: Engine.DEFAULT_RATES.tradeFee,
    fund: Engine.DEFAULT_RATES.fundRate * 100, vat: Engine.DEFAULT_RATES.vatRate * 100 },
  memo: {}
};
const kpxState = { key: null };

function netVersions() { // 최근 저장 순
  return Store.keys("netrate:").map(k => Object.assign({ key: k }, Store.get(k, {}))).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}
function netVersionFor(dateStr) { // 적용일자 <= dateStr 인 버전 중 적용일자가 가장 늦은 것 (같으면 나중에 저장한 것)
  return netVersions().filter(v => v.effective && v.effective <= dateStr)
    .sort((a, b) => (a.effective === b.effective ? (a.savedAt < b.savedAt ? 1 : -1) : (a.effective < b.effective ? 1 : -1)))[0] || null;
}
// 정산 엔진 rates 에 버전 값을 덮어쓴다 (% 항목은 비율로)
function applyNetVersion(rates, v) {
  if (!v) return rates;
  const etc = v.etc ? { surcharge: v.etc.surcharge, taxableRatio: v.etc.taxable / 100, tradeFee: v.etc.tradeFee, fundRate: v.etc.fund / 100, vatRate: v.etc.vat / 100 } : {};
  return Object.assign({}, rates, etc, {
    genSide: Object.assign({}, v.gen), demandSide: Object.assign({}, v.demand),
    distribution: v.dist.high, distributionLow: v.dist.low, // 배전요금은 사용자 이용전압(배전고압) 기준
    transLossRate: v.loss.trans / 100, distLossRate: v.loss.dist / 100, totalLossRate: v.loss.total / 100,
    netVersion: v.effective
  });
}
// 오늘 날짜. 주소에 ?today=YYYY-MM-DD 를 붙이면 그 날짜로 동작 (알림·계약 만료·연차 테스트용, 저장은 실제 시트에 반영됨)
const TEST_TODAY = (() => { try { const v = new URLSearchParams(location.search).get("today") || ""; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; } catch (e) { return ""; } })();
const todayYmd = () => { if (TEST_TODAY) return TEST_TODAY; const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const verLabel = v => `${new Date(v.savedAt).toLocaleString()} (적용일: ${v.effective})`;

function renderKpxPage() {
  const host = document.getElementById("tab4"); if (!host) return;
  const versions = netVersions(), active = netVersionFor(todayYmd());
  if (kpxState.key && !versions.some(v => v.key === kpxState.key)) kpxState.key = null;
  if (!kpxState.key && versions.length) kpxState.key = (active || versions[0]).key;
  const v = versions.find(x => x.key === kpxState.key) || NET_DEFAULT;
  const e = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  host.innerHTML = `
    <div class="card"><h2>망이용 유형 참고표</h2>
      <div class="grid-wrap net-ref-wrap" style="margin-top:10px"><table class="grid net-ref"><tr><th style="width:90px">망이용 유형</th><th>전력거래계약 유형</th><th>망 이용요금</th><th>망 손실률</th></tr>
        ${NET_TYPES.map(([no, name, rows]) => rows.map((r, i) => `<tr>${i ? "" : `<td rowspan="${rows.length}" class="c">${no}</td><td rowspan="${rows.length}">${e(name)}</td>`}<td>${e(r[0])}</td><td>${e(r[1])}</td></tr>`).join("")).join("")}
      </table></div></div>
    <div class="card"><h2>KPX 요금 및 손실률 설정</h2>
      <div class="kpx-top">
        <div class="reg-field"><label for="kpxVer">버전 선택</label><select id="kpxVer">${versions.length
          ? versions.map(x => `<option value="${e(x.key)}"${x.key === kpxState.key ? " selected" : ""}>${e(verLabel(x))}${active && x.key === active.key ? " · 현재 적용" : ""}</option>`).join("")
          : `<option value="">기본값 (저장된 버전 없음)</option>`}</select></div>
        <div class="reg-field"><label for="kpxEff">적용일자</label><input type="date" id="kpxEff" value="${e(v.effective)}"></div>
      </div>
      <div class="kpx-grid">${NET_SECTIONS.map(([sec, title, c1, c2, rows]) => `
        <div class="kpx-sec"><h3 class="sub">${title}</h3>
          <table class="grid kpx-table"><tr><th style="width:130px">${c1}</th><th style="width:110px">${c2}</th><th>메모</th></tr>
            ${rows.map(([k, label]) => `<tr><td>${e(label)}</td>
              <td><input type="number" step="any" class="kpx-val" data-sec="${sec}" data-k="${e(k)}" value="${e((v[sec] || NET_DEFAULT[sec])[k])}"></td>
              <td><input class="kpx-memo" data-memo="${sec}.${e(k)}" value="${e((v.memo || {})[sec + "." + k])}" placeholder="메모를 입력하세요"></td></tr>`).join("")}
          </table></div>`).join("")}
      </div>
      <div class="row" style="margin-top:12px"><button class="btn accent" id="kpxSave">새 버전으로 저장</button><span id="kpxStatus" class="status warn" style="background:none"></span></div>
    </div>`;
  document.getElementById("kpxVer").onchange = ev => { kpxState.key = ev.target.value || null; renderKpxPage(); };
  document.getElementById("kpxSave").onclick = saveNetVersion;
}

async function saveNetVersion() {
  const st = document.getElementById("kpxStatus");
  const effective = document.getElementById("kpxEff").value;
  if (!effective) { st.textContent = "적용일자를 입력하세요."; st.className = "status bad"; return; }
  const v = { effective, savedAt: new Date().toISOString(), gen: {}, demand: {}, dist: {}, loss: {}, etc: {}, memo: {} };
  let bad = false;
  document.querySelectorAll("#tab4 .kpx-val").forEach(el => { const n = Number(el.value); if (el.value === "" || isNaN(n)) bad = true; v[el.dataset.sec][el.dataset.k] = n; });
  if (bad) { st.textContent = "요금·손실률을 모두 숫자로 입력하세요."; st.className = "status bad"; return; }
  document.querySelectorAll("#tab4 .kpx-memo").forEach(el => { if (el.value.trim()) v.memo[el.dataset.memo] = el.value.trim(); });
  const key = "netrate:" + Date.now();
  const where = await Store.set(key, v);
  kpxState.key = key;
  renderKpxPage();
  const st2 = document.getElementById("kpxStatus");
  st2.textContent = where === "remote" ? "저장 완료 (구글시트)" : "이 브라우저에만 저장됨 (GAS 연결 확인 필요)";
  st2.className = "status " + (where === "remote" ? "ok" : "warn");
}
