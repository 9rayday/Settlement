/* ============ 초과발전량 REC 관리 (#page-rate-rec) ============
 * 초과발전량(MWh) × REC 가중치 → REC 환산(소수 6자리 절사). REC가 정수 1개 찼을 때만 그 REC에 속한 초과발전량을 정산.
 *   REC 매매금액 = 계약가(원/MWh) × 정산대상 초과전력량(MWh) − Σ(정산대상 초과전력량 × 시간별 SMP × 1000)
 *   REC 단가(원/REC) = 매매금액 / REC 수량, 용역 수수료 = 정산 MWh 합 × 수수료(원/kWh) × 1000
 * 정수로 차지 않은 REC(소수 부분)는 다음 정산으로 이월한다 (이월분이 다음 정산의 맨 앞에 들어감).
 * 계산은 정수(백만분의 1 MWh/REC, 1/100 원) 단위로 해서 엑셀 부동소수점 오차 없이 정확하게 맞춘다.
 *
 * 저장 (앱데이터):
 *   recx:YYYYMM:신청번호 = { 발전기명: [[일, 시(0~23), 초과전력량(μMWh)], ...] }   초과전력량 > 0 인 시간만
 *   smp:YYYYMM          = { 일: [24시간 SMP 원/kWh] }
 *   recw                = { 발전소(공백 제거): { weight, price } }   가중치 · 계약가(원/MWh, 빈칸이면 발전소 계약단가 × 1000 → 기본값)
 *   reccfg              = { contract: 기본 계약가 원/MWh, fee: 용역 수수료 원/kWh }
 *   recset:신청번호:FROM-TO = 확정한 정산 (발전소별 결과 + 이월 REC)
 */
const REC = (() => {
  const norm = s => String(s == null ? "" : s).replace(/\s/g, "");
  const halfUp = (num, den) => num >= 0 ? Math.floor((num + den / 2) / den) : -Math.floor((-num + den / 2) / den); // ROUND(num/den, 0)

  /* pieces: 시간순 [{ ym, d, h, smpC(원/kWh × 100), exU(초과 μMWh) | recU(이월 REC μREC) }]
   * weight: 가중치, contract: 원/MWh (정수) */
  function settle(pieces, weight, contract) {
    const w4 = Math.round(weight * 10000);
    if (!(w4 > 0)) throw new Error("가중치가 없습니다.");
    const segs = []; let g = 0; // 누적 REC (μREC)
    pieces.forEach((p, idx) => {
      const f = p.recU != null ? p.recU : Math.floor(p.exU * w4 / 10000); // REC 환산 = ROUNDDOWN(초과 × 가중치, 6)
      let rem = f;
      if (rem === 0) segs.push({ idx, no: Math.floor(g / 1e6) + 1, rec: 0, mwhU: 0, smpAmt: 0 });
      while (rem > 0) {
        const no = Math.floor(g / 1e6) + 1, room = no * 1e6 - g, take = Math.min(rem, room);
        const mwhU = Math.floor(take * 10000 / w4);                 // 해당 실제 전력량 = ROUNDDOWN(REC / 가중치, 6)
        const smpAmt = halfUp(mwhU * p.smpC, 100000);              // 정산 SMP = ROUND(MWh × SMP × 1000, 0)
        segs.push({ idx, no, rec: take, mwhU, smpAmt });
        g += take; rem -= take;
      }
      p.f = f; p.cum = g;
    });
    const recQty = Math.floor(g / 1e6);
    const done = segs.filter(s => s.no <= recQty);
    const eligibleU = done.reduce((t, s) => t + s.mwhU, 0), smpSum = done.reduce((t, s) => t + s.smpAmt, 0);
    const amount = recQty ? halfUp(eligibleU * contract - smpSum * 1e6, 1e6) : 0; // = ROUND(REC 단가 × 수량, 0)
    // 이월: 아직 정수로 차지 않은 REC 조각
    const carryMap = {};
    segs.filter(s => s.no > recQty && s.rec > 0).forEach(s => { carryMap[s.idx] = (carryMap[s.idx] || 0) + s.rec; });
    const carry = Object.keys(carryMap).map(Number).sort((a, b) => a - b).map(i => { const p = pieces[i]; return { ym: p.ym, d: p.d, h: p.h, smpC: p.smpC, recU: carryMap[i] }; });
    const eligible = eligibleU / 1e6;
    return {
      recQty, eligibleU, eligible, smpSum, amount, totalRecU: g, carryRecU: g - recQty * 1e6, carry, segs, pieces,
      smpPerRec: recQty ? smpSum / recQty : 0,                          // REC의 SMP 단가 (원/REC)
      recPrice: recQty ? (eligible * contract - smpSum) / recQty : 0,   // REC 단가 (원/REC)
      smpPerMwh: eligible ? smpSum / eligible : 0,                      // 초과전력 단가 (원/MWh)
      recPerMwh: eligible ? contract - smpSum / eligible : 0            // 초과전력의 REC 단가 (원/MWh)
    };
  }
  return { norm, settle, halfUp };
})();

const recState = { app: "", from: "", to: "", result: null, year: null, msg: "" };
const rEscR = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const recCfg = () => Object.assign({ contract: 174000, fee: 3 }, Store.get("reccfg", {}) || {});
const recW = () => Store.get("recw", {}) || {};
const ymAdd = (ym, n) => { const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4)) - 1 + n; return `${Math.floor(t / 12)}${String(t % 12 + 1).padStart(2, "0")}`; };
const ymLab = ym => `${ym.slice(0, 4)}.${ym.slice(4)}`;
const recFmt = (u, d = 6) => (u / 1e6).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/* ---------- 업로드 해석 ---------- */
function recDateKey(v) { // → "YYYYMMDD"
  if (typeof v === "number" && v > 30000 && v < 80000) { const p = XLSX.SSF.parse_date_code(v); return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`; }
  if (v instanceof Date) return `${v.getFullYear()}${String(v.getMonth() + 1).padStart(2, "0")}${String(v.getDate()).padStart(2, "0")}`;
  const s = String(v == null ? "" : v).replace(/[^0-9]/g, "");
  return s.length >= 8 ? s.slice(0, 8) : "";
}
// 워크북 → { excess: {YYYYMM: {app: {plant: [[d,h,exU]]}}}, smp: {YYYYMM: {d: [24]}} , counts }
function recParseWorkbook(wb) {
  const out = { excess: {}, smp: {}, exRows: 0, smpDays: 0 }, seen = {};
  wb.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
    for (let hi = 0; hi < Math.min(rows.length, 15); hi++) {
      const hdr = rows[hi].map(x => String(x).replace(/\s/g, ""));
      const cDate = hdr.findIndex(x => x === "거래일자"), cHour = hdr.findIndex(x => x === "시간"), cPlant = hdr.findIndex(x => x === "발전기명");
      const cEx = hdr.findIndex(x => /^초과전력량/.test(x)), cApp = hdr.findIndex(x => x === "신청번호");
      if (cDate >= 0 && cHour >= 0 && cPlant >= 0 && cEx >= 0) { // 초과전력량 (KPX 파일 · Back Data)
        if (hdr.some(x => /REC환산|누적REC/.test(x))) return; // 정산 엑셀의 발전소별 계산 시트는 Back Data 와 같은 값이라 건너뜀
        for (let r = hi + 1; r < rows.length; r++) {
          const row = rows[r], ex = parseFloat(String(row[cEx]).replace(/,/g, "")), dk = recDateKey(row[cDate]), plant = String(row[cPlant]).trim();
          if (!(ex > 0) || !dk || !plant) continue;
          const ym = dk.slice(0, 6), app = cApp >= 0 && String(row[cApp]).trim() ? String(row[cApp]).trim() : "-";
          const d = Number(dk.slice(6)), h = Math.round(Number(row[cHour])), dup = `${REC.norm(plant)}|${ym}|${d}|${h}`;
          if (seen[dup]) continue; seen[dup] = 1; // 같은 발전소·시간 중복 방지
          const byApp = (out.excess[ym] || (out.excess[ym] = {})), byPlant = (byApp[app] || (byApp[app] = {}));
          (byPlant[plant] || (byPlant[plant] = [])).push([d, h, Math.round(ex * 1e6)]);
          out.exRows++;
        }
        return;
      }
      // 시간별 SMP: 날짜 열 + 24시간 열 (0~23 / 1~24 / 1h~24h)
      const hourCols = []; hdr.forEach((x, i) => { if (/^(\d{1,2})(h|시)?$/.test(x) && hourCols.length < 24 && (hourCols.length === 0 || i === hourCols[hourCols.length - 1] + 1)) hourCols.push(i); });
      if (hourCols.length === 24 && /기간|일자|구분|날짜|거래일/.test(hdr.slice(0, hourCols[0]).join(""))) {
        const cD = hourCols[0] - 1;
        for (let r = hi + 1; r < rows.length; r++) {
          const dk = recDateKey(rows[r][cD]); if (!dk) continue;
          const vals = hourCols.map(c => parseFloat(String(rows[r][c]).replace(/,/g, "")));
          if (vals.some(v => isNaN(v))) continue;
          (out.smp[dk.slice(0, 6)] || (out.smp[dk.slice(0, 6)] = {}))[Number(dk.slice(6))] = vals;
          out.smpDays++;
        }
        return;
      }
    }
  });
  return out;
}
async function recSaveParsed(p) {
  const saved = [];
  for (const ym of Object.keys(p.excess)) for (const app of Object.keys(p.excess[ym])) {
    // 신청번호가 없으면 발전소별 키로 나눠 저장 (시트 한 칸 5만자 제한)
    const groups = app === "-" ? Object.keys(p.excess[ym][app]).map(pl => [`recx:${ym}:-${REC.norm(pl)}`, { [pl]: p.excess[ym][app][pl] }]) : [[`recx:${ym}:${app}`, p.excess[ym][app]]];
    for (const [key, data] of groups) {
      const cur = Store.get(key, {}) || {};
      Object.assign(cur, data); // 같은 발전소·월은 새 파일로 교체
      if ((await Store.set(key, cur)) === "denied") return null;
    }
    saved.push(`${ymLab(ym)} ${app === "-" ? "" : app + " "}초과 ${Object.keys(p.excess[ym][app]).length}개 발전소`);
  }
  for (const ym of Object.keys(p.smp)) {
    const key = `smp:${ym}`, cur = Store.get(key, {}) || {};
    Object.assign(cur, p.smp[ym]);
    if ((await Store.set(key, cur)) === "denied") return null;
    saved.push(`${ymLab(ym)} SMP ${Object.keys(p.smp[ym]).length}일`);
  }
  return saved;
}
async function recOnFiles(files) {
  const msgs = [];
  for (const file of files) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const p = recParseWorkbook(wb);
      if (!p.exRows && !p.smpDays) { msgs.push(`⚠ ${file.name}: 초과전력량(거래일자·시간·발전기명·초과전력량) 또는 시간별 SMP 표를 찾지 못했습니다.`); continue; }
      const saved = await recSaveParsed(p);
      if (saved) msgs.push(`${file.name}: ${saved.join(", ") || "변경 없음"}`);
    } catch (e) { msgs.push(`⚠ ${file.name}: ${e.message}`); }
  }
  recState.msg = msgs.join("\n");
  renderRecPage();
}
// 발전사업자 정산에서 올린 KPX 확정 파일(초과전력량 있음)도 자동 저장 (upload.js 에서 호출)
async function recCaptureKpxRows(rows) {
  if (!rows || !rows.length || typeof can === "function" && !can("settle")) return;
  const ws = XLSX.utils.json_to_sheet(rows), wb = { SheetNames: ["kpx"], Sheets: { kpx: ws } };
  const p = recParseWorkbook(wb); if (!p.exRows) return;
  await recSaveParsed(p);
  if (document.getElementById("recPage")) renderRecPage();
}

/* ---------- 데이터 모으기 ---------- */
function recExcessIndex() { // { plantNorm: { name, app, months: {YYYYMM: [[d,h,exU]]} } }
  const idx = {};
  Store.keys("recx:").forEach(k => {
    const parts = k.split(":"), ym = parts[1], app = parts.slice(2).join(":"), noApp = app.charAt(0) === "-", data = Store.get(k, {}) || {};
    Object.keys(data).forEach(name => {
      const n = REC.norm(name), e = idx[n] || (idx[n] = { name, app: noApp ? "" : app, months: {} });
      if (!noApp && !e.app) e.app = app;
      const mm = e._m || (e._m = {}), byH = mm[ym] || (mm[ym] = {});
      data[name].forEach(r => { byH[r[0] + "|" + r[1]] = r; }); // 같은 발전소·시간이 여러 파일에 있어도 한 번만
    });
  });
  Object.values(idx).forEach(e => { Object.keys(e._m).forEach(ym => { e.months[ym] = Object.values(e._m[ym]); }); delete e._m; });
  // 그룹(신청번호): 설정에서 지정한 값 → 파일의 신청번호 → 발전소 등록 정보
  const w = recW();
  Object.entries(idx).forEach(([n, e]) => {
    if (w[n] && w[n].app) { e.app = String(w[n].app).trim(); return; }
    if (!e.app) { const m = recMaster(e.name); if (m) e.app = String(m["KPX신청번호"] || "").trim(); }
  });
  return idx;
}
function recMaster(name) { const n = REC.norm(name), all = (typeof Registry !== "undefined" && Registry.plants) ? Registry.plants() : {}; const k = Object.keys(all).find(x => REC.norm(x) === n); return k ? all[k] : null; }
function recPlantCfg(name) {
  const w = recW()[REC.norm(name)] || {}, m = recMaster(name), cfg = recCfg();
  const price = Number(w.price) > 0 ? Number(w.price) : (m && Number(m["계약단가"]) > 0 ? Number(m["계약단가"]) * 1000 : cfg.contract);
  const priceFrom = Number(w.price) > 0 ? "직접 입력" : (m && Number(m["계약단가"]) > 0 ? "발전소 계약단가" : "기본값");
  return { weight: Number(w.weight) > 0 ? Number(w.weight) : null, price: Math.round(price), priceFrom };
}
const recSmp = (ym, d, h) => { const s = Store.get(`smp:${ym}`, null); const v = s && s[d] ? s[d][h] : null; return v == null ? null : Math.round(Number(v) * 100); };
function recSettlements(app) { return Store.keys(`recset:${app}:`).map(k => Object.assign({ key: k }, Store.get(k, {}))).filter(s => s.from).sort((a, b) => a.to.localeCompare(b.to)); }
function recAllSettlements() { return Store.keys("recset:").map(k => Object.assign({ key: k }, Store.get(k, {}))).filter(s => s.from); }
const recCustName = app => { const c = app && typeof Registry !== "undefined" ? Registry.customerByApp(app) : null; return c ? c.name : (app || "그룹 미지정"); };

/* ---------- 정산 계산 ---------- */
function recCompute(app, from, to) {
  const idx = recExcessIndex(), cfg = recCfg(), warn = [];
  const prev = recSettlements(app).filter(s => s.to < from).pop();
  if (prev && ymAdd(prev.to, 1) !== from) warn.push(`직전 정산(${ymLab(prev.from)}~${ymLab(prev.to)}) 다음 달은 ${ymLab(ymAdd(prev.to, 1))}입니다. 그 사이 달이 정산에서 빠집니다.`);
  if (recSettlements(app).some(s => !(s.to < from || s.from > to))) warn.push("이미 확정한 정산 기간과 겹칩니다. 확정하면 그 정산을 덮어씁니다.");
  const plants = Object.values(idx).filter(e => (e.app || "") === app);
  const rows = [], missingSmp = [];
  plants.sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
    const pc = recPlantCfg(e.name), carryIn = prev && prev.plants && prev.plants[REC.norm(e.name)] ? (prev.plants[REC.norm(e.name)].carry || []) : [];
    const pieces = carryIn.map(c => ({ ym: c.ym, d: c.d, h: c.h, smpC: c.smpC, recU: c.recU, carried: true }));
    Object.keys(e.months).filter(ym => ym >= from && ym <= to).sort().forEach(ym => {
      e.months[ym].slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([d, h, exU]) => {
        const smpC = recSmp(ym, d, h);
        if (smpC == null) missingSmp.push(`${ymLab(ym)}.${String(d).padStart(2, "0")} ${h}시`);
        pieces.push({ ym, d, h, exU, smpC: smpC || 0 });
      });
    });
    if (!pieces.length) return;
    if (!pc.weight) { rows.push({ name: e.name, err: "가중치 미입력", pc }); return; }
    rows.push(Object.assign({ name: e.name, pc, carryIn: carryIn.reduce((t, c) => t + c.recU, 0) }, REC.settle(pieces, pc.weight, pc.price)));
  });
  if (missingSmp.length) warn.push(`SMP가 없는 시간 ${missingSmp.length}개 (예: ${[...new Set(missingSmp)].slice(0, 3).join(", ")}) — 시간별 SMP 파일을 올리세요. 지금은 0원으로 계산됩니다.`);
  const ok = rows.filter(r => !r.err);
  const totalMwhU = ok.reduce((t, r) => t + r.eligibleU, 0);
  const fee = REC.halfUp(totalMwhU * cfg.fee * 1000, 1e6);
  return { app, from, to, rows, warn, prev, totals: { recQty: ok.reduce((t, r) => t + r.recQty, 0), amount: ok.reduce((t, r) => t + r.amount, 0), eligibleU: totalMwhU, carryRecU: ok.reduce((t, r) => t + r.carryRecU, 0) }, fee, feeRate: cfg.fee, missingSmp: missingSmp.length };
}

async function recConfirm() {
  const R = recState.result; if (!R) return;
  if (R.rows.some(r => r.err)) { alert("가중치가 없는 발전소가 있습니다. 설정에서 가중치를 입력하세요."); return; }
  if (R.missingSmp && !confirm(`SMP가 없는 시간이 ${R.missingSmp}개 있어 0원으로 계산됐습니다. 그래도 확정할까요?`)) return;
  // 겹치는 기존 정산 삭제
  for (const s of recSettlements(R.app).filter(s => !(s.to < R.from || s.from > R.to))) await Store.set(s.key, {});
  const plants = {};
  R.rows.forEach(r => { plants[REC.norm(r.name)] = { name: r.name, weight: r.pc.weight, contract: r.pc.price, recQty: r.recQty, eligibleU: r.eligibleU, smpSum: r.smpSum, amount: r.amount, recPrice: r.recPrice, recPerMwh: r.recPerMwh, carryRecU: r.carryRecU, carryInU: r.carryIn, carry: r.carry }; });
  const where = await Store.set(`recset:${R.app || "-"}:${R.from}-${R.to}`, { app: R.app, from: R.from, to: R.to, plants, totals: R.totals, fee: R.fee, feeRate: R.feeRate, savedAt: new Date().toISOString() });
  if (where !== "denied") { recState.msg = `${recCustName(R.app)} ${ymLab(R.from)}~${ymLab(R.to)} REC 정산 확정 (${where === "remote" ? "구글시트" : "이 브라우저"} 저장) — 남은 소수 REC는 다음 정산으로 이월`; renderRecPage(); }
}

function recExportExcel() {
  const R = recState.result; if (!R) return;
  const wb = XLSX.utils.book_new();
  const fin = [["구분", "가중치", "계약가(원/MWh)", "매매단가(원/REC)", "매매수량(REC)", "매매금액(원)", "매매단가(원/MWh)", "매매수량(MWh)", "매매금액(원)", "이월 REC"]];
  R.rows.forEach(r => fin.push(r.err ? [r.name, "", "", r.err] : [r.name, r.pc.weight, r.pc.price, r.recPrice, r.recQty, r.amount, r.recPerMwh, r.eligible, REC.halfUp(Math.round(r.recPerMwh * 1e6) * r.eligibleU, 1e12), r.carryRecU / 1e6]));
  fin.push(["합계", "", "", "", R.totals.recQty, R.totals.amount, "", R.totals.eligibleU / 1e6, R.totals.amount, R.totals.carryRecU / 1e6]);
  fin.push(["REC 용역 수수료", "", "", "", "", "", R.feeRate + " 원/kWh", R.totals.eligibleU / 1e6, R.fee]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fin), "최종 정산");
  R.rows.filter(r => !r.err).forEach(r => {
    const aoa = [["발전소명", r.name], ["가중치", r.pc.weight], ["REC 수량", r.recQty], ["REC의 SMP 단가", r.smpPerRec], ["REC 단가", r.recPrice], ["초과전력량(정산)", r.eligible], ["초과전력 단가", r.smpPerMwh], ["초과전력의 REC 단가", r.recPerMwh], ["검증", r.pc.price], [],
      ["거래일자", "시간", "초과전력량(MWh)", "REC 환산", "누적 REC", "REC 번호", "해당 REC", "해당 실제 전력량(MWh)", "정산 SMP(원)", "SMP(원/kWh)", "비고"]];
    r.segs.forEach(s => { const p = r.pieces[s.idx];
      aoa.push([`${p.ym.slice(0, 4)}-${p.ym.slice(4)}-${String(p.d).padStart(2, "0")}`, p.h, p.exU != null ? p.exU / 1e6 : "", p.f / 1e6, p.cum / 1e6, s.no, s.rec / 1e6, s.mwhU / 1e6, s.smpAmt, p.smpC / 100, (p.carried ? "이월분 " : "") + (s.no > r.recQty ? "미정산(이월)" : "")]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), r.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ""));
  });
  XLSX.writeFile(wb, `초과발전량_REC_정산_${recCustName(R.app)}_${R.from}-${R.to}.xlsx`);
}

/* ---------- 화면 ---------- */
function recMonthsAvailable(app) { const set = new Set(); Object.values(recExcessIndex()).forEach(e => { if ((e.app || "") === app) Object.keys(e.months).forEach(m => set.add(m)); }); return [...set].sort(); }

function renderRecPage() {
  const host = document.getElementById("recPage"); if (!host || typeof Store === "undefined") return;
  const idx = recExcessIndex(), cfg = recCfg();
  const apps = [...new Set(Object.values(idx).map(e => e.app || ""))].sort();
  if (!apps.includes(recState.app)) recState.app = apps[0] || "";
  const months = recMonthsAvailable(recState.app), last = recSettlements(recState.app).pop();
  if (!recState.from || !months.length) { recState.from = last ? ymAdd(last.to, 1) : (months[0] || ""); recState.to = months[months.length - 1] || recState.from; }
  const exMonths = [...new Set(Store.keys("recx:").map(k => k.split(":")[1]))].sort(), smpMonths = Store.keys("smp:").map(k => k.split(":")[1]).sort();
  const plantsList = Object.values(idx).sort((a, b) => (a.app || "").localeCompare(b.app || "") || a.name.localeCompare(b.name));
  const ymOpts = sel => { const all = [...new Set(months.concat(sel ? [sel] : []))].sort(); return all.map(m => `<option value="${m}"${m === sel ? " selected" : ""}>${ymLab(m)}</option>`).join(""); };
  host.innerHTML = `
    <div class="card"><h2>데이터</h2>
      <p class="hint">KPX 직접전력거래량(확정) 파일, 초과발전량 정산 엑셀(Back Data · 시간별 SMP 시트), 전력거래소 시간별 SMP 파일을 올리세요. 여러 개를 한 번에 올려도 됩니다. 초과전력량 &gt; 0 인 시간만 저장합니다.</p>
      <div class="drop-zone" id="recDrop"><div class="drop-zone-text">드래그해서 파일을 놓거나 클릭해서 선택하세요</div><input type="file" id="recFile" accept=".xlsx,.xls,.csv" multiple></div>
      ${recState.msg ? `<div class="notice ${/⚠/.test(recState.msg) ? "bad" : "warn"}" style="margin-top:10px;white-space:pre-line">${rEscR(recState.msg)}</div>` : ""}
      <div class="rec-cover"><span><b>초과발전량</b> ${exMonths.length ? exMonths.map(ymLab).join(", ") : "없음"}</span><span><b>시간별 SMP</b> ${smpMonths.length ? smpMonths.map(m => `${ymLab(m)} (${Object.keys(Store.get("smp:" + m, {}) || {}).length}일)`).join(", ") : "없음"}</span></div>
    </div>
    <div class="card"><h2>설정</h2>
      <div class="row"><label>기본 계약가 (원/MWh)</label><input type="number" id="recContract" value="${cfg.contract}" style="width:120px">
        <label>REC 용역 수수료 (원/kWh)</label><input type="number" id="recFee" step="any" value="${cfg.fee}" style="width:80px">
        <span class="hint" style="margin:0">계약가 = SMP + REC 합계 단가. 발전소 계약가가 비어 있으면 발전소 계약단가 × 1000, 그것도 없으면 기본값</span></div>
      <div class="table-wrap" style="margin-top:10px"><table class="grid rec-table"><tr><th>발전소</th><th>전기사용자</th><th>신청번호 (그룹)</th><th>REC 가중치</th><th>계약가 (원/MWh)</th><th>적용 계약가</th></tr>
        ${plantsList.length ? plantsList.map(e => { const pc = recPlantCfg(e.name), w = recW()[REC.norm(e.name)] || {};
          return `<tr><td>${rEscR(e.name)}</td><td>${rEscR(recCustName(e.app))}</td>
            <td><input class="rec-a" data-n="${rEscR(REC.norm(e.name))}" value="${rEscR(w.app || "")}" placeholder="${rEscR(e.app || "예: 26-PR00057")}"></td>
            <td><input type="number" step="0.001" class="rec-w" data-n="${rEscR(REC.norm(e.name))}" value="${w.weight || ""}" placeholder="예: 1.024"${pc.weight ? "" : ' style="border-color:#E3A09A"'}></td>
            <td><input type="number" class="rec-p" data-n="${rEscR(REC.norm(e.name))}" value="${w.price || ""}" placeholder="${pc.priceFrom === "직접 입력" ? "" : pc.price}"></td>
            <td class="num">${pc.price.toLocaleString()} <span class="perf-sub">${pc.priceFrom}</span></td></tr>`; }).join("")
          : `<tr><td colspan="6" class="hint">초과발전량 데이터를 올리면 발전소가 표시됩니다.</td></tr>`}</table></div>
      <div class="row" style="margin-top:10px"><button class="btn accent" id="recSaveCfg">설정 저장</button></div>
    </div>
    <div class="card"><h2>REC 정산</h2>
      <div class="row"><label>전기사용자</label><select id="recApp" style="min-width:280px">${apps.map(a => `<option value="${rEscR(a)}"${a === recState.app ? " selected" : ""}>${rEscR(recCustName(a))}${a ? " (" + rEscR(a) + ")" : ""}</option>`).join("") || "<option>데이터 없음</option>"}</select>
        <label>기간</label><select id="recFrom">${ymOpts(recState.from)}</select> ~ <select id="recTo">${ymOpts(recState.to)}</select>
        <button class="btn accent" id="recCalc">정산 계산</button>
        ${last ? `<span class="hint" style="margin:0">직전 확정: ${ymLab(last.from)}~${ymLab(last.to)} · 이월 ${recFmt(Object.values(last.plants || {}).reduce((t, p) => t + (p.carryRecU || 0), 0), 6)} REC</span>` : ""}</div>
      <div id="recResult">${recState.result ? recResultHtml(recState.result) : ""}</div>
    </div>
    <div class="card"><h2>전기사용자별 REC 현황</h2><div id="recCal">${recCalendarHtml()}</div></div>
    <div class="card"><h2>확정한 REC 정산</h2>${recHistoryHtml()}</div>`;
  bindDropZone("recDrop", "recFile", f => recOnFiles([f]));
  document.getElementById("recFile").onchange = e => { if (e.target.files.length) recOnFiles([...e.target.files]); e.target.value = ""; };
  document.getElementById("recSaveCfg").onclick = async () => {
    const w = recW();
    host.querySelectorAll(".rec-w").forEach(i => { const n = i.dataset.n; w[n] = Object.assign({}, w[n], { weight: i.value === "" ? null : Number(i.value) }); });
    host.querySelectorAll(".rec-p").forEach(i => { const n = i.dataset.n; w[n] = Object.assign({}, w[n], { price: i.value === "" ? null : Number(i.value) }); });
    host.querySelectorAll(".rec-a").forEach(i => { const n = i.dataset.n; w[n] = Object.assign({}, w[n], { app: i.value.trim() || null }); });
    if ((await Store.set("recw", w)) === "denied") return;
    await Store.set("reccfg", { contract: Number(document.getElementById("recContract").value) || 174000, fee: Number(document.getElementById("recFee").value) || 0 });
    recState.msg = "설정 저장 완료"; recState.result = null; renderRecPage();
  };
  document.getElementById("recApp").onchange = e => { recState.app = e.target.value; recState.from = ""; recState.result = null; renderRecPage(); };
  document.getElementById("recFrom").onchange = e => { recState.from = e.target.value; if (recState.to < recState.from) recState.to = recState.from; recState.result = null; renderRecPage(); };
  document.getElementById("recTo").onchange = e => { recState.to = e.target.value; recState.result = null; renderRecPage(); };
  document.getElementById("recCalc").onclick = () => { try { recState.result = recCompute(recState.app, recState.from, recState.to); } catch (e) { recState.msg = "⚠ " + e.message; } renderRecPage(); };
  const cf = document.getElementById("recConfirm"); if (cf) cf.onclick = recConfirm;
  const ex = document.getElementById("recExcel"); if (ex) ex.onclick = recExportExcel;
  host.querySelectorAll(".rec-del").forEach(b => b.onclick = async () => { if (!confirm("이 REC 정산 확정을 취소할까요? (이월 REC도 다시 계산됩니다)")) return; await Store.set(b.dataset.k, {}); renderRecPage(); });
  host.querySelectorAll(".rec-year").forEach(b => b.onclick = () => { recState.year = Number(b.dataset.y); document.getElementById("recCal").innerHTML = recCalendarHtml(); renderRecPage(); });
}

function recResultHtml(R) {
  const won = n => Math.round(n).toLocaleString();
  return `${R.warn.length ? `<div class="notice warn" style="margin-top:10px">${R.warn.map(rEscR).join("<br>")}</div>` : ""}
    <div class="table-wrap" style="margin-top:10px"><table class="grid rec-table">
      <tr><th rowspan="2">발전소</th><th rowspan="2">가중치</th><th rowspan="2">계약가<br>(원/MWh)</th><th rowspan="2">누적 REC<br>(이월 포함)</th><th colspan="3">REC 기준</th><th colspan="3">MWh 기준</th><th rowspan="2">이월 REC</th></tr>
      <tr><th>매매단가 (원/REC)</th><th>매매수량 (REC)</th><th>매매금액 (원)</th><th>매매단가 (원/MWh)</th><th>매매수량 (MWh)</th><th>매매금액 (원)</th></tr>
      ${R.rows.map(r => r.err ? `<tr><td>${rEscR(r.name)}</td><td colspan="10"><span class="tag bad">${r.err}</span> 설정에서 입력하세요</td></tr>`
        : `<tr><td>${rEscR(r.name)}</td><td class="num">${r.pc.weight}</td><td class="num">${r.pc.price.toLocaleString()}</td><td class="num">${recFmt(r.totalRecU)}${r.carryIn ? `<div class="perf-sub">이월 ${recFmt(r.carryIn)}</div>` : ""}</td>
          <td class="num">${r.recQty ? r.recPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}</td><td class="num"><b>${r.recQty}</b></td><td class="num"><b>${won(r.amount)}</b></td>
          <td class="num">${r.recQty ? r.recPerMwh.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-"}</td><td class="num">${recFmt(r.eligibleU)}</td><td class="num">${won(r.amount)}</td>
          <td class="num rec-carry">${recFmt(r.carryRecU)}</td></tr>`).join("")}
      <tr class="total"><td colspan="5">합계</td><td class="num">${R.totals.recQty}</td><td class="num">${won(R.totals.amount)}</td><td></td><td class="num">${recFmt(R.totals.eligibleU)}</td><td class="num">${won(R.totals.amount)}</td><td class="num">${recFmt(R.totals.carryRecU)}</td></tr>
      <tr><td colspan="8">REC 용역 수수료 (${R.feeRate} 원/kWh × 정산 MWh)</td><td class="num">${recFmt(R.totals.eligibleU)}</td><td class="num"><b>${won(R.fee)}</b></td><td></td></tr>
    </table></div>
    <div class="row" style="margin-top:10px"><button class="btn accent" id="recConfirm">정산 확정 (저장 · 이월 반영)</button><button class="btn secondary" id="recExcel">Excel 다운 (발전소별 시간대 상세)</button></div>`;
}

// 전기사용자별 연간 달력: 월마다 REC 발생량 · 정산 여부, 오른쪽에 미정산 REC
function recCalendarHtml() {
  const idx = recExcessIndex(), sets = recAllSettlements();
  const years = [...new Set(Object.values(idx).flatMap(e => Object.keys(e.months).map(m => Number(m.slice(0, 4)))).concat([Number(todayYmd().slice(0, 4))]))].sort();
  const y = recState.year && years.includes(recState.year) ? recState.year : years[years.length - 1];
  const months = Array.from({ length: 12 }, (_, i) => `${y}${String(i + 1).padStart(2, "0")}`);
  const byApp = {}; Object.values(idx).forEach(e => (byApp[e.app || ""] || (byApp[e.app || ""] = [])).push(e));
  const recOfMonth = (e, ym) => { const w = recPlantCfg(e.name).weight; if (!w) return null; const w4 = Math.round(w * 10000); return (e.months[ym] || []).reduce((t, r) => t + Math.floor(r[2] * w4 / 10000), 0); };
  const settledIn = (app, ym) => sets.find(s => (s.app || "") === app && s.from <= ym && ym <= s.to);
  const rowsHtml = Object.keys(byApp).sort().map(app => {
    const plants = byApp[app];
    let unsettledU = 0, missingW = false;
    const cells = months.map(ym => {
      const has = plants.some(e => e.months[ym]);
      if (!has) return `<td class="rc-none">-</td>`;
      let rec = 0; plants.forEach(e => { const v = recOfMonth(e, ym); if (v == null) missingW = true; else rec += v; });
      const st = settledIn(app, ym);
      if (!st) unsettledU += rec;
      return `<td class="${st ? "rc-done" : "rc-open"}"><b>${recFmt(rec, 3)}</b><span>${st ? "정산완료" : "미정산"}</span></td>`;
    }).join("");
    const lastSet = sets.filter(s => (s.app || "") === app).sort((a, b) => a.to.localeCompare(b.to)).pop();
    const carryU = lastSet ? Object.values(lastSet.plants || {}).reduce((t, p) => t + (p.carryRecU || 0), 0) : 0;
    // 다른 해의 미정산 월도 포함
    Object.values(plants).forEach(e => Object.keys(e.months).forEach(ym => { if (!ym.startsWith(String(y)) && !settledIn(app, ym)) { const v = recOfMonth(e, ym); if (v != null) unsettledU += v; } }));
    const totalOpen = unsettledU + carryU;
    const soldQty = sets.filter(s => (s.app || "") === app && s.to.startsWith(String(y))).reduce((t, s) => t + (s.totals ? s.totals.recQty : 0), 0);
    const soldAmt = sets.filter(s => (s.app || "") === app && s.to.startsWith(String(y))).reduce((t, s) => t + (s.totals ? s.totals.amount : 0), 0);
    return `<tr><td class="rc-name">${rEscR(recCustName(app))}<div class="perf-sub">${rEscR(app || "")} · ${plants.length}개 발전소${missingW ? ' · <span class="tag bad">가중치 미입력</span>' : ""}</div></td>${cells}
      <td class="rc-sum"><b class="${totalOpen >= 1e6 ? "rc-alert" : ""}">${recFmt(totalOpen, 3)}</b><div class="perf-sub">미정산 월 ${recFmt(unsettledU, 3)} + 이월 ${recFmt(carryU, 3)}${totalOpen >= 1e6 ? ` · 정산 가능 ${Math.floor(totalOpen / 1e6)} REC` : ""}</div></td>
      <td class="rc-sum">${soldQty} REC<div class="perf-sub">${Math.round(soldAmt).toLocaleString()} 원</div></td></tr>`;
  }).join("");
  return `<div class="dash-year" style="margin-bottom:10px">${years.map(v => `<button class="btn ${v === y ? "accent" : "secondary"} rec-year" data-y="${v}">${v}년</button>`).join(" ")}</div>
    <p class="hint">칸 = 그 달 REC 발생량(가중치 적용, REC) · <span class="rc-chip rc-done">정산완료</span> <span class="rc-chip rc-open">미정산</span> · 미정산 REC = 정산 안 된 달의 REC + 직전 정산에서 이월된 소수 REC (1 이상이면 정산 가능)</p>
    <div class="table-wrap"><table class="grid rec-cal"><tr><th>전기사용자</th>${months.map(m => `<th>${Number(m.slice(4))}월</th>`).join("")}<th>미정산 REC</th><th>${y}년 정산</th></tr>
      ${rowsHtml || `<tr><td colspan="15" class="hint">초과발전량 데이터가 없습니다.</td></tr>`}</table></div>`;
}

function recHistoryHtml() {
  const sets = recAllSettlements().sort((a, b) => b.to.localeCompare(a.to));
  if (!sets.length) return `<p class="hint">확정한 정산이 없습니다.</p>`;
  return `<div class="table-wrap"><table class="grid rec-table"><tr><th>전기사용자</th><th>기간</th><th>REC 수량</th><th>매매금액</th><th>정산 MWh</th><th>용역 수수료</th><th>이월 REC</th><th>확정일</th><th></th></tr>
    ${sets.map(s => `<tr><td>${rEscR(recCustName(s.app))}</td><td>${ymLab(s.from)} ~ ${ymLab(s.to)}</td><td class="num">${s.totals.recQty}</td><td class="num">${Math.round(s.totals.amount).toLocaleString()} 원</td>
      <td class="num">${recFmt(s.totals.eligibleU)}</td><td class="num">${Math.round(s.fee).toLocaleString()} 원</td><td class="num">${recFmt(s.totals.carryRecU)}</td><td>${String(s.savedAt || "").slice(0, 10)}</td>
      <td><button class="btn secondary rec-del" data-k="${rEscR(s.key)}">확정 취소</button></td></tr>`).join("")}</table></div>`;
}
