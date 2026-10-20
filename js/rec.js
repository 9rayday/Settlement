/* ============ 초과발전량 REC 관리 (#page-rec) ============
 * 초과발전량(MWh) × REC 가중치 → REC 환산(6자리 절사). 정수 REC에 속한 초과발전량만 정산, 소수 REC는 다음 정산으로 이월.
 *   매매금액 = 계약가(원/MWh) × 정산 MWh − Σ(MWh × 시간별 SMP × 1000),  REC 단가 = 매매금액 / REC 수량
 *   계약가 = 발전사업자 계약단가 × 1000 (발전사업자가 받는 몫), REC 가중치 = 발전소 등록값
 *   용역 수수료 = 정산 MWh × (전기사용자 계약단가 − 발전사업자 계약단가) × 1000 — 매매금액과 별도로 청구
 *   (전기사용자 부담 = 매매금액 + 용역 수수료 = 전기사용자 계약단가 기준)
 * 초과발전량은 전기사용자 오차정산서를 발행할 때 계산한 시간별 값(recx:YYYYMM:신청번호)을 쓴다. 시간별 SMP는 업로드.
 * 정수(μMWh·μREC, 1/100원) 단위로 계산해 엑셀과 정확히 일치한다.
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
const recCfg = () => Object.assign({ contracts: {} }, Store.get("reccfg", {}) || {});
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
      const cEx = hdr.findIndex(x => /^초과전력량/.test(x)), cApp = hdr.indexOf("소비계약신청번호") >= 0 ? hdr.indexOf("소비계약신청번호") : hdr.findIndex(x => x === "신청번호");
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
// 전기사용자 오차정산서 발행 때 계산한 시간별 초과발전량을 저장 (billing.js saveTrueUp 에서 호출)
// byPlant: { 발전기명: [[일, 시, 초과 kWh], ...] }  → recx:YYYYMM:신청번호 (그 달·그룹 전체 교체)
async function recSaveTrueUpExcess(app, month, byPlant) {
  const data = {};
  Object.keys(byPlant).forEach(p => { const rows = byPlant[p].filter(r => r[2] > 0).map(r => [r[0], r[1], Math.round(r[2] * 1000)]); if (rows.length) data[p] = rows; });
  return Store.set(`recx:${month}:${app}`, data);
}

/* ---------- 데이터 모으기 ---------- */
function recExcessIndex() { // { plantNorm: { name, app, months: {YYYYMM: [[d,h,exU]]} } }
  const idx = {};
  Store.keys("recx:").forEach(k => { // "-"(파일, 신청번호 없음) 키가 먼저, 신청번호(오차정산서) 키가 뒤 → 같은 시간은 오차정산서 값
    const parts = k.split(":"), ym = parts[1], app = parts.slice(2).join(":"), noApp = app.charAt(0) === "-", data = Store.get(k, {}) || {};
    Object.keys(data).forEach(name => {
      const n = REC.norm(name) + (noApp ? "" : "@" + app), e = idx[n] || (idx[n] = { name, app: noApp ? "" : app, months: {} });
      if (!noApp && !e.app) e.app = app;
      const mm = e._m || (e._m = {}), byH = mm[ym] || (mm[ym] = {});
      data[name].forEach(r => { byH[r[0] + "|" + r[1]] = r; });
    });
  });
  const w = recW();
  Object.entries(idx).forEach(([n, e]) => {
    Object.keys(e._m).forEach(ym => { e.months[ym] = Object.values(e._m[ym]); }); delete e._m;
    if (w[n] && w[n].app) e.app = String(w[n].app).trim();
    else if (!e.app) { const m = recMaster(e.name); if (m) e.app = Registry.plantGroup(m); }
  });
  return idx;
}
function recMaster(name, app) {
  const all = (typeof Registry !== "undefined" && Registry.plants) ? Registry.plants() : {};
  if (app && Registry.plantKeyFor) { const k = Registry.plantKeyFor(name, app); if (all[k] && REC.norm(all[k]["발전소명"] || k) === REC.norm(name)) return all[k]; }
  const n = REC.norm(name), k = Object.keys(all).find(x => REC.norm((all[x] && all[x]["발전소명"]) || x) === n); return k ? all[k] : null;
}
const recCustomer = app => app && typeof Registry !== "undefined" ? Registry.customerByApp(app) : null;
// 기본계약가 = 저장값 → 전기사용자 계약단가 × 1000
function recBaseContract(app) {
  const c = recCustomer(app);
  return c && Number(c.unitPrice) > 0 ? { price: Math.round(Number(c.unitPrice) * 1000), from: "전기사용자 계약단가" } : { price: 0, from: "미등록" };
}
// 발전소별: 가중치 · 계약가(빈칸 = 기본계약가) · 수수료 단가(= 전기사용자 계약단가 − 발전사업자 계약단가, 원/kWh)
function recPlantCfg(name, app) {
  const w = recW()[REC.norm(name)] || {}, m = recMaster(name, app), base = recBaseContract(app);
  const regW = m && Number(m["REC가중치"]) > 0 ? Number(m["REC가중치"]) : null;
  const genUnit = m && Number(m["계약단가"]) > 0 ? Number(m["계약단가"]) : null;
  const feeRate = genUnit != null && base.price > 0 ? Math.round((base.price / 1000 - genUnit) * 10000) / 10000 : null;
  return { weight: regW || (Number(w.weight) > 0 ? Number(w.weight) : null), weightReg: !!regW, price: genUnit != null ? Math.round(genUnit * 1000) : base.price, genUnit, feeRate };
}
const recSmp = (ym, d, h) => { const s = Store.get(`smp:${ym}`, null); const v = s && s[d] ? s[d][h] : null; return v == null ? null : Math.round(Number(v) * 100); };
function recSettlements(app) { return Store.keys(`recset:${app}:`).map(k => Object.assign({ key: k }, Store.get(k, {}))).filter(s => s.from).sort((a, b) => a.to.localeCompare(b.to)); }
function recAllSettlements() { return Store.keys("recset:").map(k => Object.assign({ key: k }, Store.get(k, {}))).filter(s => s.from); }
const recCustName = app => { const c = recCustomer(app); return c ? c.name : (app || "미지정"); };

/* ---------- 정산 계산 ---------- */
function recCompute(app, from, to) {
  const idx = recExcessIndex(), warn = [];
  const prev = recSettlements(app).filter(s => s.to < from).pop();
  if (prev && ymAdd(prev.to, 1) !== from) warn.push(`직전 정산(${ymLab(prev.from)}~${ymLab(prev.to)}) 이후 ${ymLab(ymAdd(prev.to, 1))}부터 빠진 달이 있습니다.`);
  if (recSettlements(app).some(s => !(s.to < from || s.from > to))) warn.push("확정한 정산 기간과 겹칩니다. 확정하면 덮어씁니다.");
  if (!recBaseContract(app).price) warn.push("전기사용자 계약단가 없음 — 수수료 0원");
  const rows = [], missingSmp = [], noGenUnit = [];
  Object.values(idx).filter(e => (e.app || "") === app).sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
    const pc = recPlantCfg(e.name, app), carryIn = prev && prev.plants && prev.plants[REC.norm(e.name)] ? (prev.plants[REC.norm(e.name)].carry || []) : [];
    const pieces = carryIn.map(c => ({ ym: c.ym, d: c.d, h: c.h, smpC: c.smpC, recU: c.recU, carried: true }));
    Object.keys(e.months).filter(ym => ym >= from && ym <= to).sort().forEach(ym => {
      e.months[ym].slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).forEach(([d, h, exU]) => {
        const smpC = recSmp(ym, d, h);
        if (smpC == null) missingSmp.push(`${ymLab(ym)}.${String(d).padStart(2, "0")} ${h}시`);
        pieces.push({ ym, d, h, exU, smpC: smpC || 0 });
      });
    });
    if (!pieces.length) return;
    if (!pc.weight) { rows.push({ name: e.name, err: "REC 가중치 미등록", pc }); return; }
    const r = REC.settle(pieces, pc.weight, pc.price);
    r.fee = pc.feeRate != null ? REC.halfUp(r.eligibleU * Math.round(pc.feeRate * 10000), 1e7) : 0; // 정산 MWh × 수수료 단가(원/kWh) × 1000
    if (pc.feeRate == null && r.recQty) noGenUnit.push(e.name);
    rows.push(Object.assign({ name: e.name, pc, carryIn: carryIn.reduce((t, c) => t + c.recU, 0) }, r));
  });
  if (noGenUnit.length) warn.push(`발전사업자 계약단가 없음 ${noGenUnit.length}곳 — 전기사용자 단가로 계산, 수수료 0원`);
  if (missingSmp.length) warn.push(`SMP 없는 시간 ${missingSmp.length}개 (${[...new Set(missingSmp)].slice(0, 3).join(", ")}…) — 0원으로 계산됨`);
  const ok = rows.filter(r => !r.err);
  return { app, from, to, rows, warn, prev, base: recBaseContract(app),
    totals: { recQty: ok.reduce((t, r) => t + r.recQty, 0), amount: ok.reduce((t, r) => t + r.amount, 0), eligibleU: ok.reduce((t, r) => t + r.eligibleU, 0), carryRecU: ok.reduce((t, r) => t + r.carryRecU, 0) },
    fee: ok.reduce((t, r) => t + r.fee, 0), missingSmp: missingSmp.length };
}

async function recConfirm() {
  const R = recState.result; if (!R) return;
  if (R.rows.some(r => r.err)) { alert("REC 가중치가 없는 발전소가 있습니다."); return; }
  if (R.missingSmp && !confirm(`SMP 없는 시간 ${R.missingSmp}개가 0원으로 계산됐습니다. 확정할까요?`)) return;
  for (const s of recSettlements(R.app).filter(s => !(s.to < R.from || s.from > R.to))) await Store.set(s.key, {});
  const plants = {};
  R.rows.forEach(r => { plants[REC.norm(r.name)] = { name: r.name, weight: r.pc.weight, contract: r.pc.price, feeRate: r.pc.feeRate, recQty: r.recQty, eligibleU: r.eligibleU, smpSum: r.smpSum, amount: r.amount, fee: r.fee, recPrice: r.recPrice, recPerMwh: r.recPerMwh, carryRecU: r.carryRecU, carryInU: r.carryIn, carry: r.carry }; });
  const where = await Store.set(`recset:${R.app || "-"}:${R.from}-${R.to}`, { app: R.app, from: R.from, to: R.to, plants, totals: R.totals, fee: R.fee, contract: R.base.price, savedAt: new Date().toISOString() });
  if (where !== "denied") { recState.msg = `${recCustName(R.app)} ${ymLab(R.from)}~${ymLab(R.to)} 확정`; renderRecPage(); }
}

function recExportExcel() {
  const R = recState.result; if (!R) return;
  const wb = XLSX.utils.book_new();
  const fin = [["구분", "가중치", "계약가(원/MWh)", "매매단가(원/REC)", "매매수량(REC)", "매매금액(원)", "매매단가(원/MWh)", "매매수량(MWh)", "매매금액(원)", "수수료 단가(원/kWh)", "용역 수수료(원)", "이월 REC"]];
  R.rows.forEach(r => fin.push(r.err ? [r.name, "", "", r.err] : [r.name, r.pc.weight, r.pc.price, r.recPrice, r.recQty, r.amount, r.recPerMwh, r.eligible, r.amount, r.pc.feeRate, r.fee, r.carryRecU / 1e6]));
  fin.push(["합계", "", "", "", R.totals.recQty, R.totals.amount, "", R.totals.eligibleU / 1e6, R.totals.amount, "", R.fee, R.totals.carryRecU / 1e6]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fin), "최종 정산");
  R.rows.filter(r => !r.err).forEach(r => {
    const aoa = [["발전소명", r.name], ["가중치", r.pc.weight], ["REC 수량", r.recQty], ["REC의 SMP 단가", r.smpPerRec], ["REC 단가", r.recPrice], ["초과전력량(정산)", r.eligible], ["초과전력 단가", r.smpPerMwh], ["초과전력의 REC 단가", r.recPerMwh], ["계약가", r.pc.price], [],
      ["거래일자", "시간", "초과전력량(MWh)", "REC 환산", "누적 REC", "REC 번호", "해당 REC", "해당 실제 전력량(MWh)", "정산 SMP(원)", "SMP(원/kWh)", "비고"]];
    r.segs.forEach(s => { const p = r.pieces[s.idx];
      aoa.push([`${p.ym.slice(0, 4)}-${p.ym.slice(4)}-${String(p.d).padStart(2, "0")}`, p.h, p.exU != null ? p.exU / 1e6 : "", p.f / 1e6, p.cum / 1e6, s.no, s.rec / 1e6, s.mwhU / 1e6, s.smpAmt, p.smpC / 100, (p.carried ? "이월분 " : "") + (s.no > r.recQty ? "이월" : "")]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), r.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ""));
  });
  XLSX.writeFile(wb, `초과발전량_REC_정산_${recCustName(R.app)}_${R.from}-${R.to}.xlsx`);
}

/* ---------- 화면 ---------- */
function recMonthsAvailable(app) { const set = new Set(); Object.values(recExcessIndex()).forEach(e => { if ((e.app || "") === app) Object.keys(e.months).forEach(m => set.add(m)); }); return [...set].sort(); }
function recApps(idx) {
  const set = new Set(Object.values(idx).map(e => e.app || ""));
  if (typeof Registry !== "undefined" && Registry.groups) Registry.groups().forEach(a => set.add(a)); // 등록된 전기사용자도 선택 가능
  return [...set].sort((a, b) => recCustName(a).localeCompare(recCustName(b)));
}

function renderRecPage() {
  const host = document.getElementById("recPage"); if (!host || typeof Store === "undefined") return;
  const idx = recExcessIndex(), apps = recApps(idx);
  if (!apps.includes(recState.app)) recState.app = apps[0] || "";
  const app = recState.app, months = recMonthsAvailable(app), last = recSettlements(app).pop(), base = recBaseContract(app);
  if (!recState.from || (months.length && !months.includes(recState.from) && !(last && recState.from === ymAdd(last.to, 1)))) {
    recState.from = last ? ymAdd(last.to, 1) : (months[0] || ""); recState.to = months[months.length - 1] || recState.from;
  }
  const smpMonths = Store.keys("smp:").map(k => k.split(":")[1]).sort();
  const plants = Object.values(idx).filter(e => (e.app || "") === app).sort((a, b) => a.name.localeCompare(b.name));
  if (!recState.result && months.length && recState.from && recState.to) { try { recState.result = recCompute(app, recState.from, recState.to); } catch (e) { /* 계산 버튼으로 다시 */ } } // 열면 바로 계산
  const ymOpts = sel => [...new Set(months.concat(sel ? [sel] : []))].sort().map(m => `<option value="${m}"${m === sel ? " selected" : ""}>${ymLab(m)}</option>`).join("");
  host.innerHTML = `
    <div class="card">
      <div class="rec-top">
        <label>전기사용자</label><select id="recApp">${apps.map(a => `<option value="${rEscR(a)}"${a === app ? " selected" : ""}>${rEscR(recCustName(a))}${a ? " · " + rEscR(a) : ""}</option>`).join("") || "<option value=''>-</option>"}</select>
        <span class="rec-base">전기사용자 계약단가 <b>${base.price ? base.price / 1000 : "미등록"}</b> 원/kWh</span>
        <label>기간</label><select id="recFrom">${ymOpts(recState.from)}</select><span>~</span><select id="recTo">${ymOpts(recState.to)}</select>
        <button class="btn accent" id="recCalc">정산 계산</button>
      </div>
      ${recState.msg ? `<div class="notice ${/⚠/.test(recState.msg) ? "bad" : "warn"}" style="margin-top:10px;white-space:pre-line">${rEscR(recState.msg)}</div>` : ""}
      <div class="table-wrap" style="margin-top:12px"><table class="grid rec-table"><tr><th>발전소</th><th>REC 가중치</th><th>계약가 (원/MWh)</th><th>수수료 단가 (원/kWh)</th><th>초과발전량 (MWh)</th></tr>
        ${plants.length ? plants.map(e => { const pc = recPlantCfg(e.name, app), w = recW()[REC.norm(e.name)] || {}, n = rEscR(REC.norm(e.name));
          const exU = Object.keys(e.months).filter(m => !recState.from || (m >= recState.from && m <= recState.to)).reduce((t, m) => t + e.months[m].reduce((a, r) => a + r[2], 0), 0);
          return `<tr><td>${rEscR(e.name)}</td>
            <td>${pc.weightReg ? `<span class="num-t">${pc.weight}</span>` : `<input type="number" step="0.001" class="rec-w" data-n="${n}" value="${w.weight || ""}"${pc.weight ? "" : ' style="border-color:#E3A09A"'}>`}</td>
            <td class="num">${pc.genUnit == null ? '<span class="tag bad">발전사업자 계약단가 미등록</span>' : pc.price.toLocaleString()}</td>
            <td class="num">${pc.feeRate == null ? "-" : pc.feeRate}</td>
            <td class="num">${recFmt(exU)}</td></tr>`; }).join("")
          : `<tr><td colspan="5" class="empty">초과발전량 없음</td></tr>`}</table></div>
      <div class="rec-actions">${plants.some(e => !recPlantCfg(e.name, app).weightReg) ? `<button class="btn secondary" id="recSaveCfg">가중치 저장</button>` : ""}
        <a class="rec-smp" href="#rate-market">시간대별 SMP ${smpMonths.length ? smpMonths.map(ymLab).join(", ") : "없음"}</a></div>
      <div id="recResult">${recState.result && recState.result.app === app ? recResultHtml(recState.result) : ""}</div>
    </div>
    <div class="card"><h2>초과발전량 REC 현황</h2><div id="recCal">${recCalendarHtml()}</div></div>
    <div class="card"><h2>확정 이력</h2>${recHistoryHtml()}</div>`;
  if (document.getElementById("recSaveCfg")) document.getElementById("recSaveCfg").onclick = async () => {
    const w = recW();
    host.querySelectorAll(".rec-w").forEach(i => { const n = i.dataset.n; w[n] = Object.assign({}, w[n], { weight: i.value === "" ? null : Number(i.value) }); });
    if ((await Store.set("recw", w)) === "denied") return;
    recState.msg = "저장됨"; recState.result = null; renderRecPage();
  };
  document.getElementById("recApp").onchange = e => { recState.app = e.target.value; recState.from = ""; recState.result = null; recState.msg = ""; renderRecPage(); };
  document.getElementById("recFrom").onchange = e => { recState.from = e.target.value; if (recState.to < recState.from) recState.to = recState.from; recState.result = null; renderRecPage(); };
  document.getElementById("recTo").onchange = e => { recState.to = e.target.value; recState.result = null; renderRecPage(); };
  document.getElementById("recCalc").onclick = () => { try { recState.msg = ""; recState.result = recCompute(recState.app, recState.from, recState.to); } catch (e) { recState.msg = "⚠ " + e.message; } renderRecPage(); };
  const cf = document.getElementById("recConfirm"); if (cf) cf.onclick = recConfirm;
  host.querySelectorAll(".rec-open").forEach(a => a.onclick = e => { e.preventDefault();
    const r = recState.result && recState.result.rows.find(x => REC.norm(x.name) === a.dataset.n);
    const box = document.getElementById("recPlantDetail"); if (!r || !box) return;
    box.innerHTML = box.dataset.n === a.dataset.n ? "" : recPlantDetailHtml(r); box.dataset.n = box.innerHTML ? a.dataset.n : ""; });
  const ex = document.getElementById("recExcel"); if (ex) ex.onclick = recExportExcel;
  host.querySelectorAll(".rec-del").forEach(b => b.onclick = async () => { if (!confirm("확정을 취소할까요?")) return; await Store.set(b.dataset.k, {}); renderRecPage(); });
  host.querySelectorAll(".rec-year").forEach(b => b.onclick = () => { recState.year = Number(b.dataset.y); document.getElementById("recCal").innerHTML = recCalendarHtml(); bindRecYear(host); });
}
function bindRecYear(host) { host.querySelectorAll(".rec-year").forEach(b => b.onclick = () => { recState.year = Number(b.dataset.y); document.getElementById("recCal").innerHTML = recCalendarHtml(); bindRecYear(host); }); }

function recResultHtml(R) {
  const won = n => Math.round(n).toLocaleString(), dec = n => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${R.warn.length ? `<div class="notice warn" style="margin-top:12px">${R.warn.map(rEscR).join("<br>")}</div>` : ""}
    <div class="table-wrap" style="margin-top:12px"><table class="grid rec-table">
      <tr><th rowspan="2">발전소</th><th rowspan="2">누적 REC</th><th colspan="3">REC 기준</th><th colspan="3">MWh 기준</th><th colspan="2">용역 수수료</th><th rowspan="2">이월 REC</th></tr>
      <tr><th>매매단가 (원/REC)</th><th>매매수량 (REC)</th><th>매매금액 (원)</th><th>매매단가 (원/MWh)</th><th>매매수량 (MWh)</th><th>매매금액 (원)</th><th>단가 (원/kWh)</th><th>금액 (원)</th></tr>
      ${R.rows.map(r => r.err ? `<tr><td>${rEscR(r.name)}</td><td colspan="10"><span class="tag bad">${r.err}</span></td></tr>`
        : `<tr><td><a href="#" class="rec-open" data-n="${rEscR(REC.norm(r.name))}">${rEscR(r.name)}</a></td><td class="num">${recFmt(r.totalRecU)}</td>
          <td class="num">${r.recQty ? dec(r.recPrice) : "-"}</td><td class="num"><b>${r.recQty}</b></td><td class="num"><b>${won(r.amount)}</b></td>
          <td class="num">${r.recQty ? dec(r.recPerMwh) : "-"}</td><td class="num">${recFmt(r.eligibleU)}</td><td class="num">${won(r.amount)}</td>
          <td class="num">${r.pc.feeRate == null ? "-" : r.pc.feeRate}</td><td class="num">${won(r.fee)}</td><td class="num rec-carry">${recFmt(r.carryRecU)}</td></tr>`).join("")}
      <tr class="total"><td colspan="3">합계</td><td class="num">${R.totals.recQty}</td><td class="num">${won(R.totals.amount)}</td><td></td><td class="num">${recFmt(R.totals.eligibleU)}</td><td class="num">${won(R.totals.amount)}</td><td></td><td class="num">${won(R.fee)}</td><td class="num">${recFmt(R.totals.carryRecU)}</td></tr>
    </table></div>
    <div id="recPlantDetail"></div>
    <div class="rec-actions"><button class="btn accent" id="recConfirm">정산 확정</button><button class="btn secondary" id="recExcel">Excel 다운</button></div>`;
}
// 발전소별 요약 (정산 엑셀의 발전소 시트 상단과 같은 항목) — 청구 기준
function recPlantDetailHtml(r) {
  const n = (v, d = 0) => Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const rows = [["발전소명", rEscR(r.name)], ["가중치", n(r.pc.weight, 3)], ["REC 수량", r.recQty], ["REC의 SMP 단가 (원/REC)", n(r.smpPerRec)], ["REC 단가 (원/REC)", n(r.recPrice)],
    ["초과전력량 (MWh)", recFmt(r.eligibleU, 3)], ["초과전력 단가 (원/MWh)", n(r.smpPerMwh)], ["초과전력의 REC 단가 (원/MWh)", n(r.recPerMwh)], ["검증 (원/MWh)", n(r.smpPerMwh + r.recPerMwh, 3)],
    ["매매금액 (원)", n(r.amount)], ["용역 수수료 (원)", `${n(r.fee)}${r.pc.feeRate != null ? ` <span class="perf-sub">${r.pc.feeRate} 원/kWh</span>` : ""}`], ["이월 REC", recFmt(r.carryRecU)]];
  return `<table class="grid rec-detail">${rows.map(([k, v]) => `<tr><th>${k}</th><td class="num">${v}</td></tr>`).join("")}</table>`;
}

// 초과발전량 REC 현황: 전기사용자 × 월 (REC 발생량 · 정산 여부), 미정산 REC
function recCalendarHtml() {
  const idx = recExcessIndex(), sets = recAllSettlements();
  const years = [...new Set(Object.values(idx).flatMap(e => Object.keys(e.months).map(m => Number(m.slice(0, 4)))).concat([Number(todayYmd().slice(0, 4))]))].sort();
  const y = recState.year && years.includes(recState.year) ? recState.year : years[years.length - 1];
  const months = Array.from({ length: 12 }, (_, i) => `${y}${String(i + 1).padStart(2, "0")}`);
  const byApp = {}; Object.values(idx).forEach(e => (byApp[e.app || ""] || (byApp[e.app || ""] = [])).push(e));
  const recOfMonth = (e, ym) => { const w = recPlantCfg(e.name, e.app).weight; if (!w) return null; const w4 = Math.round(w * 10000); return (e.months[ym] || []).reduce((t, r) => t + Math.floor(r[2] * w4 / 10000), 0); };
  const settledIn = (app, ym) => sets.find(s => (s.app || "") === app && s.from <= ym && ym <= s.to);
  const rowsHtml = Object.keys(byApp).sort((a, b) => recCustName(a).localeCompare(recCustName(b))).map(app => {
    const plants = byApp[app]; let openU = 0, missingW = false;
    const cells = months.map(ym => {
      if (!plants.some(e => e.months[ym])) return `<td class="rc-none">-</td>`;
      let rec = 0; plants.forEach(e => { const v = recOfMonth(e, ym); if (v == null) missingW = true; else rec += v; });
      const st = settledIn(app, ym); if (!st) openU += rec;
      return `<td class="${st ? "rc-done" : "rc-open"}"><b>${recFmt(rec, 3)}</b><span>${st ? "정산" : "미정산"}</span></td>`;
    }).join("");
    plants.forEach(e => Object.keys(e.months).forEach(ym => { if (!ym.startsWith(String(y)) && !settledIn(app, ym)) { const v = recOfMonth(e, ym); if (v != null) openU += v; } }));
    const lastSet = sets.filter(s => (s.app || "") === app).sort((a, b) => a.to.localeCompare(b.to)).pop();
    const carryU = lastSet ? Object.values(lastSet.plants || {}).reduce((t, p) => t + (p.carryRecU || 0), 0) : 0, open = openU + carryU;
    const yearSets = sets.filter(s => (s.app || "") === app && s.to.startsWith(String(y)));
    return `<tr><td class="rc-name">${rEscR(recCustName(app))}${missingW ? ' <span class="tag bad">가중치</span>' : ""}</td>${cells}
      <td class="rc-sum"><b class="${open >= 1e6 ? "rc-alert" : ""}">${recFmt(open, 3)}</b>${open >= 1e6 ? `<span>정산 가능 ${Math.floor(open / 1e6)}</span>` : ""}</td>
      <td class="rc-sum"><b>${yearSets.reduce((t, s) => t + (s.totals ? s.totals.recQty : 0), 0)}</b><span>${Math.round(yearSets.reduce((t, s) => t + (s.totals ? s.totals.amount : 0), 0)).toLocaleString()} 원</span></td></tr>`;
  }).join("");
  return `<div class="rec-years">${years.map(v => `<button class="btn ${v === y ? "accent" : "secondary"} rec-year" data-y="${v}">${v}</button>`).join("")}</div>
    <div class="table-wrap"><table class="grid rec-cal"><tr><th>전기사용자</th>${months.map(m => `<th>${Number(m.slice(4))}월</th>`).join("")}<th>미정산 REC</th><th>${y} 정산 REC</th></tr>
      ${rowsHtml || `<tr><td colspan="15" class="empty">없음</td></tr>`}</table></div>`;
}

function recHistoryHtml() {
  const sets = recAllSettlements().sort((a, b) => b.to.localeCompare(a.to));
  if (!sets.length) return `<div class="empty">없음</div>`;
  return `<div class="table-wrap"><table class="grid rec-table"><tr><th>전기사용자</th><th>기간</th><th>REC</th><th>매매금액</th><th>정산 MWh</th><th>용역 수수료</th><th>이월 REC</th><th>확정일</th><th></th></tr>
    ${sets.map(s => `<tr><td>${rEscR(recCustName(s.app))}</td><td>${ymLab(s.from)} ~ ${ymLab(s.to)}</td><td class="num">${s.totals.recQty}</td><td class="num">${Math.round(s.totals.amount).toLocaleString()}</td>
      <td class="num">${recFmt(s.totals.eligibleU)}</td><td class="num">${Math.round(s.fee).toLocaleString()}</td><td class="num">${recFmt(s.totals.carryRecU)}</td><td>${String(s.savedAt || "").slice(0, 10)}</td>
      <td><button class="btn secondary rec-del" data-k="${rEscR(s.key)}">취소</button></td></tr>`).join("")}</table></div>`;
}
