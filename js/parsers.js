/* ============ 업로드 파서 + 부하구분 (브라우저/Node 공용, DOM 비의존) ============ */
(function (root) {
  const P = {};

  /* ---------- 부하구분 ----------
   * 월별 시간대 요금표(한전 계시별 요금제, 24시간 × 12개월). L=경부하 M=중간부하 H=최대부하
   * 일요일·공휴일 = 전 시간 경부하, 토요일 = 최대부하 시간은 중간부하로 낮춤 (엑셀 "참고 1" 로직과 동일)
   */
  P.TARIFF = ["LLLLLLLLMHHHMMMMHHHMMMLL","LLLLLLLLMHHHMMMMHHHMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL",
    "LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL",
    "LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMMMHMHHHHHMMMMLL","LLLLLLLLMHHHMMMMHHHMMMLL","LLLLLLLLMHHHMMMMHHHMMMLL"];
  const NAME = { L: "경부하", M: "중간부하", H: "최대부하" };

  // 관공서 공휴일(대체공휴일 포함). 해마다 갱신 필요 → 화면에서 수정/추가할 수 있게 한다.
  P.HOLIDAYS = {
    2026: ["01-01","02-16","02-17","02-18","03-01","03-02","05-05","05-24","05-25","06-03","06-06","08-15","08-17",
           "09-24","09-25","09-26","10-03","10-05","10-09","12-25"]
  };

  P.dayType = function (dateStr, holidays) { // dateStr: YYYY-MM-DD → "공"|"토"|"평"
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const hol = (holidays || P.HOLIDAYS[y] || []).indexOf(dateStr.slice(5)) >= 0;
    if (dow === 0 || hol) return "공";
    return dow === 6 ? "토" : "평";
  };

  P.loadClasses = function (dateStr, holidays) { // 24개 (0시~23시 = 해당 시각에 시작하는 1시간)
    const mon = Number(dateStr.slice(5, 7)) - 1;
    const t = P.dayType(dateStr, holidays);
    const out = [];
    for (let h = 0; h < 24; h++) {
      let c = P.TARIFF[mon][h];
      if (t === "공") c = "L"; else if (t === "토" && c === "H") c = "M";
      out.push(NAME[c]);
    }
    return out;
  };

  /* ---------- 고객 15분 사용량 (.xls 확장자지만 실제로는 HTML 표) ----------
   * 행: 날짜 + 96칸(00:15 … 24:00, 각 칸은 직전 15분 kWh) + 합계. 1시간 = 연속 4칸 합.
   * 반환: { usage: {YYYY-MM-DD: [24]}, dates:[...], warnings:[] }
   */
  P.parseAmiHtml = function (text) {
    const body = text.slice(Math.max(0, text.indexOf("</colgroup>")));
    const cells = (body.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [])
      .map(c => c.replace(/<[^>]+>|&nbsp;/gi, " ").replace(/\s+/g, " ").trim());
    const usage = {}, warnings = [];
    for (let i = 0; i < cells.length; i++) {
      const m = /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/.exec(cells[i]);
      if (!m) continue;
      const date = `${m[1]}-${m[2]}-${m[3]}`;
      const raw = cells.slice(i + 1, i + 97);
      if (raw.length < 96) { warnings.push(`${date}: 15분 데이터가 96칸이 아닙니다.`); continue; }
      const slots = raw.map(v => (v === "" ? NaN : parseFloat(String(v).replace(/,/g, ""))));
      // 빈 칸(미수신)이 낀 시간은 null 로 두고 경고 — 0으로 간주하면 공급량이 조용히 줄어든다.
      const hours = [], gapHours = [];
      for (let h = 0; h < 24; h++) {
        const q = slots.slice(4*h, 4*h + 4);
        if (q.some(isNaN)) { hours.push(null); gapHours.push(h); } else hours.push(q[0] + q[1] + q[2] + q[3]);
      }
      if (gapHours.length) warnings.push(`${date}: 미수신 구간 있음 (${gapHours.length}시간: ${gapHours.map(h => h + "시").join(", ")})`);
      if (!gapHours.length) {
        const sum = parseFloat(String(cells[i + 97]).replace(/,/g, ""));
        const calc = slots.reduce((a, b) => a + b, 0);
        if (!isNaN(sum) && Math.abs(sum - calc) > 0.5) warnings.push(`${date}: 합계 불일치 (파일 ${sum} / 계산 ${calc.toFixed(2)})`);
      }
      usage[date] = hours;
      i += 97;
    }
    const dates = Object.keys(usage).sort();
    if (!dates.length) warnings.push("날짜 행을 찾지 못했습니다. 한전 파워플래너 15분 사용량 파일이 맞는지 확인하세요.");
    return { usage, dates, warnings };
  };

  /* 정산월(YYYYMM)의 모든 날짜 중 사용량이 없는 날짜 */
  P.missingDates = function (month, dateList) {
    const y = Number(month.slice(0, 4)), m = Number(month.slice(4, 6));
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const have = new Set(dateList), out = [];
    for (let d = 1; d <= n; d++) { const s = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; if (!have.has(s)) out.push(s); }
    return out;
  };

  /* ---------- KPX 직접전력거래량 (sheet_to_json 행 배열) ----------
   * 반환: { groups: { 신청번호: { month, plants:{발전기명:{id,gen:{date:[24] kWh}}}, usageMwh:{date:[24]} , consumeAppNos:Set } } }
   * 발전량(MWh) → kWh ×1000. 시간 0~23.
   */
  const toNum = v => { const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
  const dateKey = v => { const d = String(v).replace(/[^0-9]/g, ""); return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`; };

  P.parseKpxRows = function (rows) {
    const groups = {}; const warnings = [];
    rows.forEach(r => {
      const app = String(r["신청번호"] || "").trim();
      const plant = String(r["발전기명"] || "").trim();
      if (!app || !plant) return;
      const date = dateKey(r["거래일자"]); const h = Math.round(toNum(r["시간"]));
      if (h < 0 || h > 23) { warnings.push(`시간 값 이상: ${date} ${r["시간"]}`); return; }
      const g = groups[app] || (groups[app] = { app, month: date.slice(0,4) + date.slice(5,7), plants: {}, kpxUsage: {}, kpxSupply: {}, consumeAppNos: new Set(), supplyAppNos: new Set() });
      const pl = g.plants[plant] || (g.plants[plant] = { id: r["발전기ID"], supplyAppNo: r["공급계약신청번호"], gen: {}, kpxSupply: {} });
      (pl.gen[date] || (pl.gen[date] = new Array(24).fill(0)))[h] += toNum(r["발전량(MWh)"]) * 1000;
      (pl.kpxSupply[date] || (pl.kpxSupply[date] = new Array(24).fill(0)))[h] += toNum(r["재생E공급량(MWh)"]) * 1000;
      if (r["소비계약신청번호"]) g.consumeAppNos.add(String(r["소비계약신청번호"]));
      if (r["공급계약신청번호"]) g.supplyAppNos.add(String(r["공급계약신청번호"]));
      // 전기사용량은 발전소마다 같은 값이 반복되므로 (날짜,시간) 당 한 번만 기록
      const u = g.kpxUsage[date] || (g.kpxUsage[date] = new Array(24).fill(null));
      if (u[h] === null) u[h] = toNum(r["전기사용량(MWh)"]) * 1000;
    });
    return { groups, warnings };
  };

  /* ---------- 엔진 입력 만들기 ----------
   * group: parseKpxRows 의 그룹, ami: parseAmiHtml 결과(없으면 사용량=발전량 합 간주 = 엑셀 가정산 방식)
   */
  P.buildDays = function (group, ami, holidays) {
    const dates = new Set();
    Object.values(group.plants).forEach(p => Object.keys(p.gen).forEach(d => dates.add(d)));
    return Array.from(dates).sort().map(date => {
      const gen = {}, supply = {};
      Object.keys(group.plants).forEach(p => {
        gen[p] = group.plants[p].gen[date] || new Array(24).fill(0);
        supply[p] = group.plants[p].kpxSupply[date] || new Array(24).fill(0); // KPX 재생E공급량 (오차정산용)
      });
      const u = ami && ami.usage[date] ? ami.usage[date] : null;
      const gaps = u ? u.map((v, h) => v === null ? h : -1).filter(h => h >= 0) : (ami ? "all" : []);
      return { date, load: P.loadClasses(date, holidays), usage: u, gaps, gen, supply, kpxUsage: group.kpxUsage[date] || null };
    });
  };

  if (typeof module !== "undefined" && module.exports) module.exports = P; else root.Parsers = P;
})(typeof window !== "undefined" ? window : globalThis);
