/* ============ 정산서 PDF 구글 드라이브 자동 저장 (서버: gas/Code.gs savePdfs_) ============
 * 발행·수정할 때 PDF를 만들어 뒤에서 올린다 (화면은 기다리지 않음). 폴더: TWh 정산서 / 연도 / 전기사용자|발전사업자 / 사업자명
 * 전기사용자 가정산서·오차정산서: 화면 문서를 그대로 찍어 PDF (2쪽이면 2페이지)
 * 발전사업자 정산서: 내려받기와 같은 PDF (js/exporters/pdf.js)
 */
const Drive = (function () {
  let queue = Promise.resolve();
  const listeners = [];
  const notify = s => listeners.forEach(fn => { try { fn(s); } catch (e) { /* 무시 */ } });
  const ymLabel = m => `${m.slice(0, 4)}-${m.slice(4, 6)}`;
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

  // 몇 개씩 묶어 올린다 (요청 한 번에 너무 크지 않게)
  async function upload(files, onStep) {
    const out = [];
    for (let i = 0; i < files.length; i += 4) {
      const part = files.slice(i, i + 4);
      const body = await Promise.all(part.map(async f => ({ year: f.year, kind: f.kind, owner: f.owner, name: f.name, base64: await toB64(f.blob) })));
      const r = await gasPost("savePdfs", { files: body });
      if (!r) throw new Error("드라이브 저장 실패 (Apps Script 재배포·setupDrive 실행 필요)");
      out.push(...r);
      if (onStep) onStep(Math.min(i + 4, files.length), files.length);
    }
    return out;
  }
  function enqueue(label, job) {
    queue = queue.then(async () => {
      notify({ state: "busy", label });
      try { const r = await job(); notify({ state: "done", label, count: r.length }); }
      catch (e) { console.warn("[drive]", e); notify({ state: "fail", label, error: e.message }); }
    });
    return queue;
  }

  // 정산서 HTML → PDF (문서 한 장 = 한 페이지). 화면 배율(zoom)과 상관없이 같은 크기로 찍는다
  async function docsPdf(html) {
    const root = document.documentElement, zoom = root.style.zoom;
    const box = document.createElement("div");
    box.style.cssText = "position:fixed; left:-10000px; top:0; width:794px; background:#fff;";
    box.innerHTML = html; document.body.appendChild(box);
    try {
      root.style.zoom = "";
      await Promise.all(Array.from(box.querySelectorAll("img")).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      if (typeof fitDocs === "function") fitDocs(box);
      const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: "pt", format: "a4" });
      const docs = Array.from(box.querySelectorAll(".doc"));
      for (let i = 0; i < docs.length; i++) {
        const c = await html2canvas(docs[i], { scale: 2, backgroundColor: "#ffffff", logging: false });
        const PW = 595.28, PH = 841.89, M = 14, s = Math.min((PW - 2 * M) / c.width, (PH - 2 * M) / c.height);
        if (i) pdf.addPage();
        pdf.addImage(c.toDataURL("image/jpeg", 0.85), "JPEG", (PW - c.width * s) / 2, M, c.width * s, c.height * s);
      }
      return pdf.output("blob");
    } finally { box.remove(); root.style.zoom = zoom; }
  }

  // 전기사용자 문서: doc = "bill"(가정산서) | "trueup"(오차정산서)
  function saveCust(R, doc) {
    if (!R || R.preview) return;
    const owner = (R.customer && R.customer.name) || R.app, type = doc === "bill" ? "가정산서" : "오차정산서";
    const no = docNo(R, doc === "bill" ? "0001" : "0002");
    const snap = JSON.parse(JSON.stringify(R)); // 그새 화면이 바뀌어도 발행한 내용으로
    snap.docDate = R.docDate || todayYmd();
    return enqueue(`${ymLabel(R.month)} ${owner} ${type}`, async () => {
      const blob = await docsPdf(doc === "bill" ? invoiceHtml(snap) : trueUpHtml(snap));
      return upload([{ year: R.month.slice(0, 4), kind: "cust", owner, name: `${ymLabel(R.month)}_${type}_${owner}_${no}`, blob }]);
    });
  }
  // 발전사업자 정산서: items = [{ plant, snap? }] (snap 이 없으면 지금 발전대금 계산 결과)
  function saveGen(month, items, onStep) {
    if (!items.length) return;
    const ownerOf = p => String(((typeof masterData !== "undefined" && masterData[p]) || {})["사업자명(대표자명)"] || p).split("(")[0].trim() || p;
    return enqueue(`${ymLabel(month)} 발전사업자 정산서 ${items.length}건`, async () => {
      const done = [];
      for (let i = 0; i < items.length; i += 4) { // PDF 만들기 → 4개씩 올리기 (메모리 아끼기)
        const files = [];
        for (const { plant, snap } of items.slice(i, i + 4)) {
          const no = snap ? snap.docNo : genDocNo(plant);
          files.push({ year: month.slice(0, 4), kind: "gen", owner: ownerOf(plant), name: `${ymLabel(month)}_정산서_${plant}_${no}`, blob: await buildPdfBlobForPlant(plant, snap) });
        }
        done.push(...await upload(files));
        if (onStep) onStep(Math.min(i + 4, items.length), items.length);
      }
      return done;
    });
  }
  return { saveCust, saveGen, onStatus: fn => listeners.push(fn), idle: () => queue };
})();

// 진행 상황: 헤더 옆 작은 표시 (저장 중 / 완료 / 실패)
Drive.onStatus(s => {
  let el = document.getElementById("driveStatus");
  if (!el) { el = document.createElement("span"); el.id = "driveStatus"; el.className = "drive-status"; const h = document.querySelector(".hdr-right, header.app"); if (!h) return; h.insertBefore(el, h.firstChild); }
  clearTimeout(el._t);
  el.className = "drive-status " + s.state;
  el.textContent = s.state === "busy" ? `드라이브 저장 중 · ${s.label}` : s.state === "done" ? `드라이브 저장됨 · ${s.label}` : `드라이브 저장 실패 · ${s.label}`;
  el.title = s.error || "";
  if (s.state === "done") el._t = setTimeout(() => { el.textContent = ""; el.className = "drive-status"; }, 6000);
});
