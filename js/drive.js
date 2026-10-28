/* ============ 정산서 PDF 구글 드라이브 자동 저장 (서버: gas/Code.gs savePdfs_) ============
 * 발행·수정할 때 PDF를 만들어 뒤에서 올린다 (화면은 기다리지 않음). 폴더: TWh 정산서 / 연도 / 전기사용자|발전사업자 / 사업자명
 * 전기사용자 가정산서·오차정산서: 화면 문서를 그대로 찍어 PDF (2쪽이면 2페이지)
 * 발전사업자 정산서: 내려받기와 같은 PDF (js/exporters/pdf.js)
 */
const Drive = (function () {
  let queue = Promise.resolve();
  const listeners = [];
  const notify = s => listeners.forEach(fn => { try { fn(s); } catch (e) { /* 무시 */ } });
  const ymLabel = m => `${m.slice(0, 4)}년 ${m.slice(4, 6)}월`;
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // 몇 개씩 묶어 올린다 (요청 한 번에 너무 크지 않게)
  async function upload(files, onStep) {
    const out = [];
    for (let i = 0; i < files.length; i += 4) {
      const part = files.slice(i, i + 4);
      const body = await Promise.all(part.map(async f => ({ year: f.year, kind: f.kind, owner: f.owner, name: f.name, base64: await toB64(f.blob) })));
      const r = await gasCall("savePdfs", { files: body });
      if (!r.ok) throw new Error(/unknown action/.test(r.error) ? "Apps Script를 새 버전으로 재배포해야 합니다." : /permission|권한|DriveApp/i.test(r.error) ? "드라이브 권한이 없습니다. 편집기에서 setupDrive 를 실행해 승인하세요. (" + r.error + ")" : r.error);
      out.push(...(Array.isArray(r.data) ? r.data : []));
      if (onStep) onStep(Math.min(i + 4, files.length), files.length);
    }
    return out;
  }
  function enqueue(label, job, anchorId) {
    tag(anchorId, "busy");
    queue = queue.then(async () => {
      notify({ state: "busy", label });
      try { const r = await job(); tag(anchorId, "done"); notify({ state: "done", label, count: r.length }); }
      catch (e) { console.warn("[drive]", e); tag(anchorId, "fail", e.message); notify({ state: "fail", label, error: e.message }); }
    });
    return queue;
  }
  // 발행 완료 글자 바로 오른쪽에 "드라이브 저장" / "드라이브 저장 실패" (실패 이유는 마우스 올리면)
  function tag(anchorId, state, error) {
    const a = anchorId && document.getElementById(anchorId); if (!a) return;
    let t = a.nextElementSibling && a.nextElementSibling.classList.contains("drive-tag") ? a.nextElementSibling : null;
    if (!t) { t = document.createElement("span"); a.insertAdjacentElement("afterend", t); }
    t.className = "drive-tag " + state; t.title = error || "";
    t.textContent = state === "busy" ? "드라이브 저장 중" : state === "done" ? "드라이브 저장" : "드라이브 저장 실패";
    if (a.style.display === "none") a.style.display = "";
  }

  // 정산서 HTML → PDF (문서 한 장 = 한 페이지). 화면 배율과 상관없게 보이지 않는 별도 창(iframe)에 그려서 찍는다
  async function docsPdf(html) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed; left:-10000px; top:0; width:820px; height:1200px; border:0; visibility:hidden;";
    document.body.appendChild(frame);
    try {
      const d = frame.contentDocument, base = document.baseURI;
      const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(n => n.outerHTML).join("");
      d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}">${styles}</head><body style="margin:0;background:#fff"><div id="box" style="width:794px">${html}</div></body></html>`); d.close();
      await new Promise(r => { if (d.readyState === "complete") r(); else frame.onload = r; });
      await Promise.all(Array.from(d.querySelectorAll("img")).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      if (d.fonts && d.fonts.ready) await d.fonts.ready;
      if (typeof fitDocs === "function") fitDocs(d.getElementById("box"));
      const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: "pt", format: "a4" });
      const docs = Array.from(d.querySelectorAll(".doc"));
      for (let i = 0; i < docs.length; i++) {
        const c = await html2canvas(docs[i], { scale: 2, backgroundColor: "#ffffff", logging: false, windowWidth: 820 });
        const PW = 595.28, PH = 841.89, M = 14, s = Math.min((PW - 2 * M) / c.width, (PH - 2 * M) / c.height);
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", (PW - c.width * s) / 2, M, c.width * s, c.height * s);
      }
      return pdf.output("blob");
    } finally { frame.remove(); }
  }

  // 전기사용자 문서: doc = "bill"(가정산서) | "trueup"(오차정산서)
  function saveCust(R, doc, anchorId) {
    if (!R || R.preview) return;
    const owner = (R.customer && R.customer.name) || R.app, type = doc === "bill" ? "가정산서" : "오차정산서";
    const title = doc === "bill" ? "청구서" : "오차정산서";
    const snap = JSON.parse(JSON.stringify(R)); // 그새 화면이 바뀌어도 발행한 내용으로
    snap.docDate = R.docDate || todayYmd();
    return enqueue(`${ymLabel(R.month)} ${owner} ${type}`, async () => {
      const blob = await docsPdf(doc === "bill" ? invoiceHtml(snap) : trueUpHtml(snap));
      return upload([{ year: R.month.slice(0, 4), kind: "cust", owner, name: `${ymLabel(R.month)} 직접PPA_전력거래대금_${title}_${owner}`, blob }]);
    }, anchorId);
  }
  // 발전사업자 정산서: items = [{ plant, snap? }] (snap 이 없으면 지금 발전대금 계산 결과)
  function saveGen(month, items, anchorId) {
    if (!items.length) return;
    const ownerOf = p => String(((typeof masterData !== "undefined" && masterData[p]) || {})["사업자명(대표자명)"] || p).split("(")[0].trim() || p;
    // 한 사업자가 그 달 발전소를 여럿 가지면 파일 이름이 겹치지 않게 발전소명을 붙인다
    const monthPlants = Object.keys(((typeof Store !== "undefined" && Store.get(`genpay:${month}`, null)) || {}).plants || {}).concat(items.map(x => x.plant));
    const many = o => new Set(monthPlants.filter(p => ownerOf(p) === o)).size > 1;
    return enqueue(`${ymLabel(month)} 발전사업자 정산서 ${items.length}건`, async () => {
      const done = [];
      for (let i = 0; i < items.length; i += 4) { // PDF 만들기 → 4개씩 올리기 (메모리 아끼기)
        const files = [];
        for (const { plant, snap } of items.slice(i, i + 4)) {
          const o = ownerOf(plant);
          files.push({ year: month.slice(0, 4), kind: "gen", owner: o, name: `${ymLabel(month)} 직접PPA_전력거래대금_정산서_${o}${many(o) ? ` (${plant})` : ""}`, blob: await buildPdfBlobForPlant(plant, snap) });
        }
        done.push(...await upload(files));
      }
      return done;
    }, anchorId);
  }
  return { saveCust, saveGen, onStatus: fn => listeners.push(fn), idle: () => queue };
})();

