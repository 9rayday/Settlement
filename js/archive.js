/* ============ 정산서 보관함: 발행한 정산서를 연도 > 월별로 다시 보고, 고치면 연결된 문서까지 반영 ============
 * 전기사용자: 가정산서(bill:YYYYMM:신청번호) · 오차정산서(carry:<다음달>:신청번호, sourceMonth = 정산월)
 * 발전사업자: 정산서(genpay:YYYYMM 의 발전소별 기록)
 * 문서는 발행 때 함께 저장한 계산 재료(snap)로 다시 그린다. 재료가 없는 예전 기록은 요약만 보여 준다.
 * 수정 → 반영 순서:
 *   가정산서(N월) 수정 → N월 오차정산서의 차액이 자동 계산값 그대로였으면 새 가정산 기준으로 다시 계산 → N+1월 가정산서
 *   오차정산서(N월) 수정 → N+1월 가정산서의 전월 확정 부가정산금·차액
 *   발전사업자 정산서 수정 → 그 달 발전대금 기록(정산 대시보드)
 */
const arcState = { kind: "cust", year: null, open: null, edit: null, flash: null }; // flash: 저장 후 한 번 보여 줄 안내

const arcYm = (y, i) => `${y}${String(i + 1).padStart(2, "0")}`;
const arcWon = n => n == null || isNaN(n) ? "-" : Math.round(n).toLocaleString() + " 원";

function arcYears() {
  const ys = new Set([String(new Date().getFullYear())]);
  Store.keys("bill:").concat(Store.keys("genpay:")).forEach(k => ys.add(k.split(":")[1].slice(0, 4)));
  Store.keys("carry:").forEach(k => { const r = Store.get(k, null); if (r && r.sourceMonth) ys.add(String(r.sourceMonth).slice(0, 4)); });
  return Array.from(ys).sort();
}

// 그 연도의 문서 목록 → 행(전기사용자/발전소)별 12달
function arcRows(kind, y) {
  const rows = {};
  const row = (key, name, sub) => rows[key] || (rows[key] = { key, name, sub, m: Array.from({ length: 12 }, () => ({})) });
  if (kind === "cust") {
    Store.keys(`bill:${y}`).forEach(k => { const [, ym, app] = k.split(":"); const r = Store.get(k, null); if (!r) return;
      row(app, custName(app) || r.customerName || app, app).m[Number(ym.slice(4)) - 1].bill = r; });
    Store.keys("carry:").forEach(k => { const r = Store.get(k, null); if (!r || String(r.sourceMonth || "").slice(0, 4) !== y) return;
      const app = k.split(":").slice(2).join(":");
      row(app, custName(app) || r.customerName || app, app).m[Number(String(r.sourceMonth).slice(4)) - 1].trueup = r; });
  } else {
    Store.keys(`genpay:${y}`).forEach(k => { const ym = k.split(":")[1], g = Store.get(k, null); if (!g || !g.plants) return;
      Object.keys(g.plants).forEach(p => { const x = g.plants[p]; row(p, p, x.appNo || "").m[Number(ym.slice(4)) - 1].gen = x; }); });
  }
  return Object.values(rows).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function renderArchivePage() {
  const host = document.getElementById("archivePage"); if (!host) return;
  const years = arcYears();
  if (!arcState.year || !years.includes(arcState.year)) arcState.year = years[years.length - 1];
  const y = arcState.year, kind = arcState.kind;
  const rows = arcRows(kind, y), pk = kind === "cust" ? "arcCust" : "arcGen", pg = pageSlice(pk, rows);
  const chip = (doc, key, ym, label, title, on) => `<button type="button" class="arc-chip ${doc}${on ? " on" : ""}${arcState.open && arcState.open.doc === doc && arcState.open.key === key && arcState.open.month === ym ? " active" : ""}" data-doc="${doc}" data-key="${rEsc(key)}" data-m="${ym}" title="${rEsc(title)}">${label}</button>`;
  const cells = r => r.m.map((c, i) => {
    const ym = arcYm(y, i);
    if (kind === "cust") return `<td class="arc-cell">${c.bill ? chip("bill", r.key, ym, "가", `가정산서 · 당월 청구 계 ${arcWon(c.bill.grandTotal)}${c.bill.paidAt ? " · 수령 " + c.bill.paidAt : ""}`, true) : ""}${c.trueup ? chip("trueup", r.key, ym, "오", "오차정산서", true) : ""}${!c.bill && !c.trueup ? '<span class="arc-none">·</span>' : ""}</td>`;
    return `<td class="arc-cell">${c.gen ? chip("gen", r.key, ym, "정", `정산서 · 지급액 ${arcWon(c.gen.payment)}`, true) : '<span class="arc-none">·</span>'}</td>`;
  }).join("");
  host.innerHTML = `<div class="card"><div class="reg-head"><h2>정산서 보관함</h2>
      <div class="row"><div class="seg arc-kind">${[["cust", "전기사용자"], ["gen", "발전사업자"]].map(([k, l]) => `<button type="button" data-k="${k}"${k === kind ? ' class="active"' : ""}>${l}</button>`).join("")}</div>
        <button type="button" class="btn secondary" id="arcPrev"${years.indexOf(y) <= 0 ? " disabled" : ""}>‹</button><b class="arc-year">${y}년</b><button type="button" class="btn secondary" id="arcNext"${years.indexOf(y) >= years.length - 1 ? " disabled" : ""}>›</button></div></div>
      <div class="grid-wrap"><table class="grid arc-table"><tr><th>${kind === "cust" ? "전기사용자" : "발전소"}</th>${Array.from({ length: 12 }, (_, i) => `<th>${i + 1}월</th>`).join("")}</tr>
        ${pg.items.length ? pg.items.map(r => `<tr><td class="arc-name"><b>${rEsc(r.name)}</b>${r.sub && r.sub !== r.name ? `<div class="perf-sub">${rEsc(r.sub)}</div>` : ""}</td>${cells(r)}</tr>`).join("")
          : `<tr><td colspan="13" class="empty">${y}년에 발행한 정산서가 없습니다.</td></tr>`}</table></div>
      ${pagerHtml(pk, pg.page, pg.pages)}</div>
    <div id="arcViewer"></div>`;
  bindPager(host, renderArchivePage);
  host.querySelectorAll(".arc-kind button").forEach(b => b.onclick = () => { arcState.kind = b.dataset.k; arcState.open = null; arcState.edit = null; renderArchivePage(); });
  const go = async d => { const i = years.indexOf(y) + d; if (i < 0 || i >= years.length) return; arcState.year = years[i]; arcState.open = null; await Store.ensureYear(arcState.year); renderArchivePage(); };
  document.getElementById("arcPrev").onclick = () => go(-1);
  document.getElementById("arcNext").onclick = () => go(1);
  host.querySelectorAll(".arc-chip").forEach(b => b.onclick = () => openArchive(kind, b.dataset.key, b.dataset.m, b.dataset.doc));
  if (arcState.open) return renderArcViewer();
}

// 다른 화면(정산 대시보드 등)에서 바로 열기
function openArchive(kind, key, month, doc, scroll = true) {
  arcState.kind = kind; arcState.year = month.slice(0, 4); arcState.open = { kind, key, month, doc }; arcState.edit = null;
  if (location.hash !== "#archive") location.hash = "#archive"; else renderArchivePage();
  if (scroll) setTimeout(() => { const v = document.getElementById("arcViewer"); if (v) v.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
}

/* ---------- 문서 재료 → 화면용 R ---------- */
const arcRates = month => ratesFor(month).rates;
function arcBillR(app, month, bill) {
  if (!bill || !bill.snap || !bill.invFull) return null;
  const s = bill.snap;
  return { mode: "provisional", app, month, customer: s.customer, rates: arcRates(month), match: s.match, inv: bill.invFull, ctx: s.ctx,
    loss: s.loss != null ? s.loss : bill.loss, note: bill.note || "", dueDate: bill.dueDate || "", docDate: bill.docDate || String(bill.savedAt || "").slice(0, 10) };
}
function arcTrueUpR(app, month, rec) {
  if (!rec || !rec.snap) return null;
  const s = rec.snap, rates = arcRates(month);
  const prov = provFromBill(Store.get(`bill:${month}:${app}`, null)) || Object.assign({}, rec.provisional);
  const conf = Engine.invoice(s.match, s.ctx, rates);
  return { mode: "trueup", app, month, customer: s.customer, rates, match: s.match, prov, conf, diff: Engine.trueUpDiff(prov, conf), loss: s.loss, ctx: s.ctx,
    netOverride: rec.netConfirmed || {}, docDate: rec.docDate || String(rec.savedAt || "").slice(0, 10),
    fields: { confirmedTotal: rec.confirmedTotal, taxableRatio: rec.taxableRatio, confirmed: rec.confirmed, prevDiff: rec.prevDiff, note: rec.note || "" } };
}
function arcGenSnap(plant, month) {
  const g = Store.get(`genpay:${month}`, null), x = g && g.plants && g.plants[plant];
  if (!x) return null;
  const calc = { unitPrice: x.unitPrice, feeRate: x.feeRate, supply: x.supply, energyFee: x.energyFee, supplyValue: x.supplyValue != null ? x.supplyValue : x.energyFee, vat1: x.vat1, subtotal1: x.subtotal1,
    fee: x.fee, vat2: x.vat2 != null ? x.vat2 : (x.subtotal2 - x.fee), subtotal2: x.subtotal2, adj: x.adj || { 전월차액: 0, 전월미지급액: 0, 기타정산: 0 }, payment: x.payment, penalty: x.penalty || 0, penaltyLabel: x.penaltyLabel || "" };
  return { month, agg: { generation: x.generation, supply: x.supply, excess: x.excess }, site: g.site || null, calc, docNo: x.docNo || "", docDate: x.docDate || String(g.savedAt || "").slice(0, 10), rec: x };
}

/* ---------- 보기 · 수정 ---------- */
async function renderArcViewer() {
  const host = document.getElementById("arcViewer"); if (!host) return;
  const o = arcState.open; if (!o) { host.innerHTML = ""; return; }
  const title = `${monthLabel(o.month)} ${o.kind === "cust" ? (custName(o.key) || o.key) : o.key} ${{ bill: "가정산서", trueup: "오차정산서", gen: "정산서" }[o.doc]}`;
  const editable = typeof can !== "function" || can("settle");
  let docHtml = "", note = "", R = null, snap = null;
  if (o.doc === "bill") {
    const bill = Store.get(`bill:${o.month}:${o.key}`, null);
    R = arcState.edit && arcState.edit.R || arcBillR(o.key, o.month, bill);
    if (R) docHtml = invoiceHtml(R); else note = arcSummary(bill, [["공급량 계", "supplyTotal", "kWh"], ["전력량요금", "energy"], ["망이용요금", "netTotal"], ["거래수수료", "fee"], ["세금계산서 계", "taxInvoice"], ["당월 청구 계", "grandTotal"]]);
  } else if (o.doc === "trueup") {
    const rec = Store.get(`carry:${nextYm(o.month)}:${o.key}`, null);
    R = arcState.edit && arcState.edit.R || arcTrueUpR(o.key, o.month, rec);
    if (R) docHtml = trueUpHtml(R); else note = arcSummary(rec && Object.assign({}, rec.confirmed && { cst: rec.confirmed.taxable, cse: rec.confirmed.exempt }, rec.prevDiff && { pdt: rec.prevDiff.taxable, pde: rec.prevDiff.exempt }),
      [["확정 부가정산금 (과세)", "cst"], ["확정 부가정산금 (비과세)", "cse"], ["차액 (과세)", "pdt"], ["차액 (비과세)", "pde"]]);
  } else {
    snap = arcState.edit && arcState.edit.snap || arcGenSnap(o.key, o.month);
    if (snap && snap.site && snap.calc.feeRate != null) docHtml = await buildInvoiceHtml(o.key, snap);
    else note = arcSummary(snap && snap.rec, [["공급량", "supply", "kWh"], ["계약단가", "unitPrice", "raw"], ["전력량요금 (VAT 포함)", "subtotal1"], ["거래수수료 (VAT 포함)", "subtotal2"], ["지급액", "payment"]]);
  }
  const canEdit = editable && (R || (snap && snap.site));
  host.innerHTML = `<div class="arc-view">
    <div class="card no-print arc-bar"><div class="reg-head"><h2>${rEsc(title)}</h2>
      <div class="row">${canEdit && !arcState.edit ? `<button type="button" class="btn secondary" id="arcEdit">수정</button>` : ""}
        ${docHtml ? `<button type="button" class="btn secondary" id="arcPrint">${o.doc === "gen" ? "PDF 다운" : "인쇄 / PDF 저장"}</button>` : ""}
        <button type="button" class="btn secondary" id="arcClose">닫기</button></div></div>
      <span id="arcMsg" class="status ${arcState.flash ? arcState.flash.cls : ""}" style="background:none${arcState.flash ? "" : ";display:none"}">${arcState.flash ? rEsc(arcState.flash.text) : ""}</span>
      ${arcState.edit ? arcEditForm(o, R, snap) : ""}</div>
    ${note ? `<div class="card no-print">${note}</div>` : `<div class="arc-docs">${docHtml}</div>`}</div>`;
  fitDocs(host); arcState.flash = null;
  const btn = id => document.getElementById(id);
  btn("arcClose").onclick = () => { arcState.open = null; arcState.edit = null; renderArchivePage(); };
  if (btn("arcEdit")) btn("arcEdit").onclick = () => { arcState.edit = { R: R && JSON.parse(JSON.stringify(R)), snap: snap && JSON.parse(JSON.stringify(snap)) }; renderArcViewer(); };
  if (btn("arcPrint")) btn("arcPrint").onclick = async () => {
    if (o.doc !== "gen") return window.print();
    const blob = await buildPdfBlobForPlant(o.key, snap);
    downloadBlob(blob, `직접PPA_정산서_${o.key}_${o.month}.pdf`);
  };
  if (arcState.edit) bindArcEdit(o);
}
function arcSummary(rec, items) {
  if (!rec) return `<div class="hint">기록이 없습니다.</div>`;
  return `<div class="notice warn">예전 기록 · 요약만 표시</div>
    <table class="grid" style="max-width:520px">${items.map(([l, k, u]) => `<tr><th>${l}</th><td class="num">${rec[k] == null ? "-" : u === "kWh" ? Math.round(rec[k]).toLocaleString() + " kWh" : u === "raw" ? rec[k] : arcWon(rec[k])}</td></tr>`).join("")}</table>`;
}

// 수정 칸
function arcEditForm(o, R, snap) {
  const f = (label, id, v, type) => `<div class="adj-item"><label class="adj-label">${label}</label><input id="${id}" type="${type || "number"}" step="any" value="${v == null ? "" : rEsc(v)}"></div>`;
  let body = "";
  if (o.doc === "bill") {
    const c = R.ctx.confirmedSurcharge || {}, p = R.ctx.prevDiff || {};
    body = f("전월 확정 부가정산금 (과세)", "ae_cst", c.taxable) + f("전월 확정 부가정산금 (비과세)", "ae_cse", c.exempt) + f("전월 차액 (과세)", "ae_pdt", p.taxable) + f("전월 차액 (비과세)", "ae_pde", p.exempt)
      + f("납부기한", "ae_due", R.dueDate, "date") + f("특이사항", "ae_note", R.note, "text");
  } else if (o.doc === "trueup") {
    const t = R.fields, plants = Object.keys(R.conf.netByPlant);
    body = f("확정 부가정산금 총액", "ae_total", t.confirmedTotal) + f("과세 비율", "ae_ratio", t.taxableRatio) + f("확정 부가정산금 (과세)", "ae_cst", t.confirmed.taxable) + f("확정 부가정산금 (비과세)", "ae_cse", t.confirmed.exempt)
      + f("차액 (과세)", "ae_pdt", t.prevDiff.taxable) + f("차액 (비과세)", "ae_pde", t.prevDiff.exempt) + f("특이사항", "ae_note", t.note, "text")
      + plants.map((p, i) => `<div class="adj-item"><label class="adj-label">확정 망이용요금 · ${rEsc(p)}</label><input id="ae_nc${i}" data-plant="${rEsc(p)}" class="ae-nc" type="number" step="1" placeholder="계산값 ${R.conf.netByPlant[p].calcFee != null ? R.conf.netByPlant[p].calcFee : R.conf.netByPlant[p].fee}" value="${R.netOverride[p] == null ? "" : R.netOverride[p]}"></div>`).join("");
  } else {
    const c = snap.calc, a = c.adj || {};
    body = f("계약단가 (원/kWh)", "ae_up", c.unitPrice) + f("거래수수료 (원/kWh)", "ae_fr", c.feeRate) + f("전월 차액", "ae_a1", a.전월차액) + f("전월 미지급액", "ae_a2", a.전월미지급액) + f("기타정산", "ae_a3", a.기타정산);
  }
  return `<div class="arc-edit"><div class="adj-grid">${body}</div>
    <div class="row" style="margin-top:8px"><button type="button" class="btn accent" id="arcSave">저장하고 반영</button><button type="button" class="btn secondary" id="arcCancel">취소</button>
</div></div>`;
}

function bindArcEdit(o) {
  const v = id => { const el = document.getElementById(id); return el ? el.value : ""; }, n = id => Number(v(id)) || 0;
  const E = arcState.edit;
  const recalc = () => {
    if (o.doc === "bill") {
      E.R.ctx.confirmedSurcharge = { taxable: n("ae_cst"), exempt: n("ae_cse") }; E.R.ctx.prevDiff = { taxable: n("ae_pdt"), exempt: n("ae_pde") };
      E.R.dueDate = v("ae_due"); E.R.note = v("ae_note").trim();
      E.R.inv = Engine.invoice(E.R.match, E.R.ctx, E.R.rates);
    } else if (o.doc === "trueup") {
      const no = {}; document.querySelectorAll(".ae-nc").forEach(el => { if (el.value !== "") no[el.dataset.plant] = Math.round(Number(el.value)); });
      const netChanged = JSON.stringify(no) !== JSON.stringify(E.R.netOverride || {});
      E.R.netOverride = no; E.R.ctx = Object.assign({}, E.R.ctx, { netOverride: no });
      E.R.conf = Engine.invoice(E.R.match, E.R.ctx, E.R.rates); E.R.diff = Engine.trueUpDiff(E.R.prov, E.R.conf);
      if (netChanged) { document.getElementById("ae_pdt").value = E.R.diff.taxable; } // 망이용요금을 바꾸면 차액(과세)도 다시 (오차정산 화면과 같게)
      E.R.fields = { confirmedTotal: n("ae_total"), taxableRatio: Number(v("ae_ratio")), confirmed: { taxable: n("ae_cst"), exempt: n("ae_cse") }, prevDiff: { taxable: n("ae_pdt"), exempt: n("ae_pde") }, note: v("ae_note").trim() };
    } else {
      const c = E.snap.calc, up = v("ae_up") === "" ? null : Number(v("ae_up"));
      E.snap.calc = genCalcParts({ supply: c.supply, unitPrice: up, feeRate: Number(v("ae_fr")) || 0, adj: { 전월차액: n("ae_a1"), 전월미지급액: n("ae_a2"), 기타정산: n("ae_a3") }, penalty: c.penalty, penaltyLabel: c.penaltyLabel });
    }
    redrawDoc(o);
  };
  document.querySelectorAll(".arc-edit input").forEach(el => { el.onchange = recalc; });
  if (o.doc === "trueup") ["ae_total", "ae_ratio"].forEach(id => { document.getElementById(id).oninput = () => {
    if (v("ae_total") === "") return; const s = Engine.splitSurcharge(n("ae_total"), { taxableRatio: Number(v("ae_ratio")) || 0 });
    document.getElementById("ae_cst").value = s.taxable; document.getElementById("ae_cse").value = s.exempt; }; });
  document.getElementById("arcCancel").onclick = () => { arcState.edit = null; renderArcViewer(); };
  document.getElementById("arcSave").onclick = async () => {
    recalc();
    const msg = document.getElementById("arcMsg");
    if (o.doc === "trueup" && E.R.fields.confirmed.taxable + E.R.fields.confirmed.exempt !== E.R.fields.confirmedTotal) {
      msg.style.display = ""; msg.textContent = "확정 부가정산금 과세+비과세가 총액과 다릅니다."; msg.className = "status bad"; return; }
    msg.style.display = ""; msg.textContent = "저장 중..."; msg.className = "status warn";
    try {
      const done = o.doc === "bill" ? await arcSaveBill(o, E.R) : o.doc === "trueup" ? await arcSaveTrueUp(o, E.R) : await arcSaveGen(o, E.snap);
      arcState.edit = null; arcState.flash = { text: "저장 완료 · " + done.join(" · "), cls: "ok" };
      await renderArchivePage();
      if (typeof renderDashboard === "function") renderDashboard();
    } catch (e) { msg.textContent = "저장 실패: " + e.message; msg.className = "status bad"; }
  };
}
// 수정 중 문서만 다시 그린다 (입력칸은 그대로)
async function redrawDoc(o) {
  const box = document.querySelector("#arcViewer .arc-docs"); if (!box) return;
  const E = arcState.edit;
  box.innerHTML = o.doc === "bill" ? invoiceHtml(E.R) : o.doc === "trueup" ? trueUpHtml(E.R) : await buildInvoiceHtml(o.key, E.snap);
  fitDocs(box);
}

/* ---------- 저장 + 연결 문서 반영 ---------- */
const arcDrive = (R, doc) => { if (R && typeof Drive !== "undefined") Drive.saveCust(R, doc, "arcMsg"); }; // 고친 문서를 드라이브에도 다시 저장
const arcSet = async (key, val) => { const w = await Store.set(key, val); if (w === "denied") throw new Error("정산 권한이 없습니다."); return w; };

async function arcSaveBill(o, R) {
  const key = `bill:${o.month}:${o.key}`, old = Store.get(key, null);
  const oldProv = provFromBill(old);
  await arcSet(key, Object.assign(billRecord(R, old), { editedAt: new Date().toISOString() }));
  arcDrive(R, "bill");
  const done = [`${monthLabel(o.month)} 가정산서`];
  // 같은 달 오차정산서: 차액이 예전 가정산 기준 자동값 그대로면 새 기준으로 다시 계산
  const ck = `carry:${nextYm(o.month)}:${o.key}`, rec = Store.get(ck, null);
  if (rec && rec.snap) {
    const rates = arcRates(o.month), conf = Engine.invoice(rec.snap.match, rec.snap.ctx, rates);
    const auto = p => ({ taxable: Engine.trueUpDiff(p, conf).taxable, exempt: p.fund != null ? conf.fund - p.fund : (rec.prevDiff || {}).exempt });
    const before = auto(oldProv), after = auto(provFromBill(Store.get(key, null)));
    if (rec.prevDiff && rec.prevDiff.taxable === before.taxable && rec.prevDiff.exempt === before.exempt) {
      await arcSet(ck, Object.assign({}, rec, { prevDiff: after, editedAt: new Date().toISOString() }));
      arcDrive(arcTrueUpR(o.key, o.month, Store.get(ck, null)), "trueup");
      done.push(`${monthLabel(o.month)} 오차정산서 차액 다시 계산`);
      done.push(...await arcCascadeNextBill(o.key, nextYm(o.month)));
    } else done.push(`${monthLabel(o.month)} 오차정산서 차액은 직접 고친 값이라 그대로 둠`);
  }
  return done;
}

async function arcSaveTrueUp(o, R) {
  const key = `carry:${nextYm(o.month)}:${o.key}`, old = Store.get(key, null) || {};
  const pick = x => ({ supplyTotal: x.supplyTotal, energy: x.energy, netTotal: x.netTotal, fee: x.fee });
  const rec = Object.assign({}, old, R.fields, {
    provisional: pick(R.prov), confirmedCalc: pick(R.conf),
    diff: { supply: R.diff.supply, energy: R.diff.energy, net: R.diff.net, fee: R.diff.fee, taxable: R.diff.taxable },
    netConfirmed: R.netOverride || {}, snap: Object.assign({}, old.snap, { ctx: R.ctx }), editedAt: new Date().toISOString() });
  await arcSet(key, rec);
  arcDrive(R, "trueup");
  return [`${monthLabel(o.month)} 오차정산서`].concat(await arcCascadeNextBill(o.key, nextYm(o.month)));
}

// 다음 달 가정산서가 이미 발행돼 있으면 전월 확정 부가정산금·차액을 새 오차정산 값으로 다시 계산
async function arcCascadeNextBill(app, nm) {
  const key = `bill:${nm}:${app}`, bill = Store.get(key, null), carry = Store.get(`carry:${nm}:${app}`, null);
  if (!bill || !carry) return [];
  const R = arcBillR(app, nm, bill);
  if (!R) return [`${monthLabel(nm)} 가정산서는 예전 기록이라 자동 반영 못 함 (다시 발행 필요)`];
  R.ctx = Object.assign({}, R.ctx, { confirmedSurcharge: carry.confirmed, prevDiff: carry.prevDiff });
  R.inv = Engine.invoice(R.match, R.ctx, R.rates);
  await arcSet(key, Object.assign(billRecord(R, bill), { editedAt: new Date().toISOString() }));
  arcDrive(R, "bill");
  return [`${monthLabel(nm)} 가정산서 반영`];
}

async function arcSaveGen(o, snap) {
  const key = `genpay:${o.month}`, g = Store.get(key, null); if (!g || !g.plants[o.key]) throw new Error("발전대금 기록이 없습니다.");
  const c = snap.calc;
  g.plants[o.key] = Object.assign({}, g.plants[o.key], { unitPrice: c.unitPrice, feeRate: c.feeRate, energyFee: c.energyFee, supplyValue: c.supplyValue, vat1: c.vat1, subtotal1: c.subtotal1,
    fee: c.fee, vat2: c.vat2, subtotal2: c.subtotal2, adj: c.adj, payment: c.payment, editedAt: new Date().toISOString() });
  await arcSet(key, g);
  if (typeof Drive !== "undefined") Drive.saveGen(o.month, [{ plant: o.key, snap: arcGenSnap(o.key, o.month) }], "arcMsg");
  if (typeof settleMonth !== "undefined" && settleMonth === o.month && typeof adjustmentsByPlant !== "undefined") adjustmentsByPlant[o.key] = c.adj; // 발전사업자 정산 화면에 같은 달이 열려 있으면 조정값 유지
  return [`${monthLabel(o.month)} ${o.key} 정산서`, "정산 대시보드 지급액"];
}
