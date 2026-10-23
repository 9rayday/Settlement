/* ============ 정산 계산 엔진 (순수 함수, 브라우저/Node 공용) ============
 * 직접PPA 수요기업 청구서(가정산) 계산. 엑셀 "청구서(가정산)" 로직과 동일하게 맞춰져 있다.
 * 단위: 전력량 kWh, 금액 원. 엑셀의 ROUND(half away from zero)/TRUNC/ROUNDDOWN 동작을 그대로 재현한다.
 *
 * 월별로 바뀌는 값(KPX 통지)은 모두 rates 객체로 받는다 → DEFAULT_RATES 를 복사해 월마다 저장/덮어쓴다.
 */
(function (root) {
  const E = {};

  /* ---------- Excel 호환 반올림 ---------- */
  E.round = (x, d = 0) => { const f = Math.pow(10, d); const v = Math.abs(x) * f; const r = Math.floor(v + 0.5 + 1e-9); return Math.sign(x) * r / f; };
  E.trunc = (x, d = 0) => { const f = Math.pow(10, d); return Math.trunc(x * f + (x >= 0 ? 1e-9 : -1e-9)) / f; };
  E.floorTo = (x, d) => { const f = Math.pow(10, d); return Math.floor(x * f + 1e-9) / f; }; // ROUNDDOWN(양수), d 음수 가능

  /* ---------- 월별 요율 (KPX 통지서) ---------- */
  // 발전측 송전요금(원/kWh): 발전소 지역별. 수요측: 수요지 지역별.
  E.DEFAULT_RATES = {
    month: "",                       // 적용 정산월 YYYYMM
    tradeFee: 0.1193,                // 거래수수료 원/kWh
    surcharge: 9.98,                 // 예상 부가정산금 단가 원/kWh (KPX 통지)
    taxableRatio: 0.7176,            // 확정 부가정산금 중 과세 비율 (비과세 = 1 - 과세)
    fundRate: 0.027,                 // 전력산업기반기금
    vatRate: 0.1,
    transLossRate: 0.0157,           // 송전손실률 (망이용요금·부족전력량 산정)
    totalLossRate: 0.0352,           // 종합손실률 (송전 발전사 → 배전 사용자)
    distLossRate: 0.0198,            // 배전손실률 (같은 접속점 배전 발전사 → 배전 사용자)
    genSide: { "비수도권": 1.92, "수도권북": 1.25, "수도권남": 1.20, "제주": 1.90 },
    demandSide: { "수도권": 2.44, "비수도권": 1.42, "제주": 6.95 },
    distribution: 3.05               // 배전연결 발전소 추가 요금 원/kWh
  };

  /* ---------- 1) 시간별 매칭 ----------
   * U=사용량, G=Σ발전량, L=송전손실률
   * 공급량 S = U > G×(1−L) ? G : U/(1−L)  (소수 3자리 반올림, G=0 → 0)
   * 초과 E = G − S, 발전소별 배분 S_p = ROUND(S×g_p/G,3), E_p = ROUND(E×g_p/G,3)
   * 부족(단순) = U − S (음수 허용), 부족(손실) = S × L
   * usage 가 null/undefined 이면 "가정산 간주": U = G → S = G, E = 0
   * fullBuy(월간균등 정산): 발전량 전량 구매 → S = G, E = 0 (사용량과 비교하지 않음, E-PPA 와 같은 규칙)
   */
  E.matchHour = function (usage, gen, loss, fullBuy) {
    if (loss == null) loss = E.DEFAULT_RATES.transLossRate;
    const plants = Object.keys(gen);
    const G = plants.reduce((s, p) => s + (gen[p] || 0), 0);
    const U = (usage === null || usage === undefined) ? G : usage;
    const S = G > 0 ? E.round(fullBuy || U > G * (1 - loss) ? G : U / (1 - loss), 3) : 0;
    const X = G - S;
    const out = { supply: {}, excess: {}, supplyTotal: S, excessTotal: X, deficitSimple: U - S, deficitLoss: S * loss, usage: U, genTotal: G };
    plants.forEach(p => {
      const g = gen[p] || 0;
      out.supply[p] = G > 0 ? E.round(S * g / G, 3) : 0;
      out.excess[p] = G > 0 ? E.round(X * g / G, 3) : 0;
    });
    return out;
  };

  /* days: [{date, load:[24 × '경부하'|'중간부하'|'최대부하'], usage:[24]|null, gen:{plant:[24]}}]
   * 반환: { supplyByPlant, genByPlant, excessByPlant, byLoad:{구분:{usage,supply,deficitSimple,deficitLoss}}, totals }
   * totals.supply = 발전소별 공급량 합 (청구 기준), totals.supplyHourly = 시간별 S 합 (부하별 표 기준)
   * opts.fullBuy: 월간균등 정산 (발전량 전량 구매, 초과발전 0)
   */
  E.matchMonth = function (days, rates, onHour, opts) {
    const fullBuy = !!(opts && opts.fullBuy);
    const loss = (rates && rates.transLossRate != null) ? rates.transLossRate : E.DEFAULT_RATES.transLossRate;
    const supplyByPlant = {}, genByPlant = {}, excessByPlant = {};
    const byLoad = {};
    const tot = { usage: 0, gen: 0, supply: 0, supplyHourly: 0, excess: 0, deficitSimple: 0, deficitLoss: 0 };
    const byHour = Array.from({ length: 24 }, () => ({ usage: 0, supply: 0, excess: 0, deficitSimple: 0, deficitLoss: 0 })); // 시간대별 월 합계 (청구서 그래프)
    days.forEach(d => {
      for (let h = 0; h < 24; h++) {
        const gen = {};
        Object.keys(d.gen).forEach(p => { gen[p] = d.gen[p][h] || 0; });
        const m = E.matchHour(d.usage ? d.usage[h] : null, gen, loss, fullBuy);
        if (onHour) onHour(d, h, m);
        const lc = d.load[h];
        const b = byLoad[lc] || (byLoad[lc] = { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 });
        b.usage += m.usage; b.supply += m.supplyTotal; b.deficitSimple += m.deficitSimple; b.deficitLoss += m.deficitLoss;
        const bh = byHour[h]; bh.usage += m.usage; bh.supply += m.supplyTotal; bh.excess += m.excessTotal; bh.deficitSimple += m.deficitSimple; bh.deficitLoss += m.deficitLoss;
        Object.keys(gen).forEach(p => {
          supplyByPlant[p] = (supplyByPlant[p] || 0) + m.supply[p];
          excessByPlant[p] = (excessByPlant[p] || 0) + m.excess[p];
          genByPlant[p] = (genByPlant[p] || 0) + gen[p];
        });
        tot.usage += m.usage; tot.gen += m.genTotal; tot.supplyHourly += m.supplyTotal;
        tot.deficitSimple += m.deficitSimple; tot.deficitLoss += m.deficitLoss;
      }
    });
    const r3 = o => Object.keys(o).forEach(p => { o[p] = E.round(o[p], 3); });
    r3(supplyByPlant); r3(excessByPlant); r3(genByPlant);
    tot.supply = E.round(Object.values(supplyByPlant).reduce((s, v) => s + v, 0), 3);
    tot.excess = E.round(Object.values(excessByPlant).reduce((s, v) => s + v, 0), 3);
    return { supplyByPlant, genByPlant, excessByPlant, byLoad, byHour, totals: tot };
  };

  /* 월간균등정산: 발전기별 K = ROUND(월발전량합 / 월시간수, 6) MWh, 마지막 시간이 잔차 흡수 (합 = 월발전량)
   * days[].gen 을 균등값으로 바꾼다 (kWh). 실측 발전량은 days[].actGen 에 남는다.
   * 매칭은 matchMonth(..., { fullBuy: true }) — 전량 구매라 초과발전이 생기지 않는다.
   */
  E.equalizeGen = function (days) {
    const hours = days.length * 24;
    if (!hours) return days;
    const plants = Object.keys(days[0].gen);
    plants.forEach(p => {
      const totalMwh = E.round(days.reduce((t, d) => t + (d.gen[p] || []).reduce((a, b) => a + (b || 0), 0), 0) / 1000, 6);
      const base = E.round(totalMwh / hours, 6);
      const last = E.round(totalMwh - base * (hours - 1), 6);
      days.forEach((d, i) => { d.gen[p] = new Array(24).fill(base * 1000); if (i === days.length - 1) d.gen[p][23] = last * 1000; });
    });
    return days;
  };

  /* ---------- 1-b) KPX 재생E공급량 기준 매칭 (가정산·오차정산 공통, 화면에서 사용) ----------
   * KPX 파일의 재생E공급량(발전소·시간별)을 그대로 공급량으로 쓰고, 초과발전량 = 발전량 − 공급량.
   * (1) matchMonth 의 min(사용량, 발전량) 방식은 8월 엑셀 검증(tests/engine.test.js)용으로 남겨둔다.
   * days: [{date, load, usage:[24]|null, gen:{plant:[24]}, supply:{plant:[24]}}]  반환 형태는 matchMonth 와 같다.
   * 사용량이 없는 시간은 사용량 = 공급량(부족 0)으로 본다.
   */
  E.matchMonthKpx = function (days, rates) {
    const loss = (rates && rates.transLossRate != null) ? rates.transLossRate : E.DEFAULT_RATES.transLossRate;
    const supplyByPlant = {}, genByPlant = {}, excessByPlant = {};
    const byLoad = {};
    const tot = { usage: 0, gen: 0, supply: 0, excess: 0, deficitSimple: 0, deficitLoss: 0 };
    days.forEach(d => {
      for (let h = 0; h < 24; h++) {
        let st = 0, gt = 0;
        Object.keys(d.gen).forEach(p => {
          const g = d.gen[p][h] || 0, s = ((d.supply || {})[p] || [])[h] || 0;
          supplyByPlant[p] = (supplyByPlant[p] || 0) + s;
          genByPlant[p] = (genByPlant[p] || 0) + g;
          excessByPlant[p] = (excessByPlant[p] || 0) + (g - s);
          st += s; gt += g;
        });
        const u = (d.usage && d.usage[h] != null) ? d.usage[h] : st;
        const deficit = Math.max(0, u - st);
        const b = byLoad[d.load[h]] || (byLoad[d.load[h]] = { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 });
        b.usage += u; b.supply += st; b.deficitSimple += deficit; b.deficitLoss += st * loss;
        tot.usage += u; tot.gen += gt; tot.supply += st; tot.excess += gt - st; tot.deficitSimple += deficit; tot.deficitLoss += st * loss;
      }
    });
    return { supplyByPlant, genByPlant, excessByPlant, byLoad, totals: tot };
  };

  /* ---------- 1-c) 오차정산 비교 ----------
   * 가정산 청구(prov)와 확정 재계산(conf)의 전력량요금·망이용요금·거래수수료 차이 (확정 − 가정산). 모두 과세 항목.
   * prov: { supplyTotal, energy, netTotal, fee, netByPlant?:{plant: fee} }  conf: E.invoice 결과
   */
  E.trueUpDiff = function (prov, conf) {
    const d = { supply: conf.supplyTotal - prov.supplyTotal, energy: conf.energy - prov.energy, net: conf.netTotal - prov.netTotal, fee: conf.fee - prov.fee };
    d.taxable = d.energy + d.net + d.fee;
    d.netByPlant = {};
    Object.keys(conf.netByPlant).forEach(p => {
      const before = prov.netByPlant && prov.netByPlant[p] != null ? prov.netByPlant[p] : null;
      d.netByPlant[p] = { prov: before, conf: conf.netByPlant[p].fee, diff: before == null ? null : conf.netByPlant[p].fee - before };
    });
    return d;
  };

  /* ---------- 2) 망이용요금 (발전소별) ----------
   * KPX 망이용 유형 (js/kpxrates.js NET_TYPES). 배전요금 여부는 전기사용자(수요망)가 정한다 — 발전소가 배전망이어도 사용자가 송전이면 배전요금 없음.
   *  1·5·6 사용자 송전:                 TRUNC(s×발전측) + TRUNC(s×(1−송전손실률)×수요측)
   *  2·7·8 사용자 배전고압 (송전 발전사, 또는 배전 발전사·다른 변전소): 위 + TRUNC(s×(1−종합손실률)×배전고압)
   *  3·4   배전 발전사 – 배전 사용자 같은 접속점: TRUNC(s×(1−배전손실률)×배전고압)
   * s = ROUND(월 공급량). demand: 수요지 지역 문자열 또는 { region, grid: "송전망"|"배전망", node: 접속점 }
   */
  E.networkFee = function (supplyKwh, plantInfo, demand, rates) {
    const s = E.round(supplyKwh);
    const dem = typeof demand === "string" ? { region: demand } : (demand || {});
    const pct = x => +(x * 100).toFixed(4) + "%";
    const userDist = /배전/.test(dem.grid || ""), plantDist = !!plantInfo.distConnected;
    const dist = rates.distribution, distLoss = rates.distLossRate != null ? rates.distLossRate : E.DEFAULT_RATES.distLossRate;
    if (userDist && plantDist && plantInfo.node && dem.node && String(plantInfo.node).trim() === String(dem.node).trim()) {
      return { supplyRounded: s, fee: E.trunc(s * (1 - distLoss) * dist), type: plantInfo.distLow ? 4 : 3,
        basis: `${s.toLocaleString()} kWh × (1 − ${pct(distLoss)}) × ${dist} 원/kWh` };
    }
    const g = rates.genSide[plantInfo.region];
    if (g == null) throw new Error("발전소 지역(요금구분)이 올바르지 않습니다: " + plantInfo.region);
    const dm = rates.demandSide[dem.region];
    if (dm == null) throw new Error("수요지 지역이 올바르지 않습니다: " + dem.region);
    let fee = E.trunc(s * g) + E.trunc(s * (1 - rates.transLossRate) * dm);
    let basis = `${s.toLocaleString()} kWh × [ ${g} + (1 − ${pct(rates.transLossRate)}) × ${dm} ]`;
    if (userDist) {
      fee += E.trunc(s * (1 - rates.totalLossRate) * dist);
      basis = `${s.toLocaleString()} kWh × [ ${g} + (1 − ${pct(rates.transLossRate)}) × ${dm} + (1 − ${pct(rates.totalLossRate)}) × ${dist} ]`;
    }
    const type = userDist ? (plantDist ? (plantInfo.distLow ? 8 : 7) : 2) : (plantDist ? (plantInfo.distLow ? 6 : 5) : 1);
    return { supplyRounded: s, fee, type, basis };
  };

  /* ---------- 3) 청구서 (가정산) ----------
   * ctx: {
   *   unitPrice,                    // 계약 전력량 단가 원/kWh
   *   demandRegion, demandGrid, demandNode, // 수요지 지역 · 수요망(송전망/배전망) · 접속점
   *   plants: {plant: {region, distConnected}},
   *   confirmedSurcharge: {taxable, exempt},   // 전월 확정 부가정산금 (과세/비과세)
   *   prevDiff: {taxable, exempt}               // 전월 오차정산 차액
   * }
   */
  E.invoice = function (match, ctx, rates) {
    const supplyTotal = match.totals.supply;
    // 계약이 여러 건이면 공급량을 계약 비율(share)로 나눠 계약별 단가 적용: priceSplits [{id, share, unitPrice}]
    const splits = ctx.priceSplits && ctx.priceSplits.length ? ctx.priceSplits : [{ id: "", share: 1, unitPrice: ctx.unitPrice }];
    const energyParts = splits.map(sp => ({ id: sp.id, share: sp.share, unitPrice: sp.unitPrice, kwh: supplyTotal * sp.share, amount: E.round(supplyTotal * sp.share * sp.unitPrice) }));
    const energy = energyParts.reduce((sum, x) => sum + x.amount, 0);
    const net = {}; let netTotal = 0;
    Object.keys(match.supplyByPlant).forEach(p => {
      const info = ctx.plants[p];
      if (!info) throw new Error("발전소 등록 정보가 없습니다: " + p);
      let r = E.networkFee(match.supplyByPlant[p], info, { region: ctx.demandRegion, grid: ctx.demandGrid, node: ctx.demandNode }, rates);
      // 오차정산: 한전 청구서의 확정 망이용요금을 직접 넣은 발전소는 그 금액 사용 (calcFee = 시스템 계산값)
      const o = ctx.netOverride && ctx.netOverride[p];
      if (o != null && o !== "" && !isNaN(o)) r = Object.assign({}, r, { fee: Math.round(Number(o)), calcFee: r.fee, confirmed: true });
      net[p] = r; netTotal += r.fee;
    });
    const fee = E.round(supplyTotal * rates.tradeFee);
    const cs = ctx.confirmedSurcharge || { taxable: 0, exempt: 0 };
    const pd = ctx.prevDiff || { taxable: 0, exempt: 0 };
    const expectedSurcharge = E.round(supplyTotal * rates.surcharge);
    // 초과발전량 REC 대금 (과세): ctx.recItems [{ key, label, amount, qty }] — 발생월 2달 뒤 가정산에 반영
    const recItems = (ctx.recItems || []).map(x => Object.assign({}, x, { amount: Math.round(Number(x.amount) || 0), fee: Math.round(Number(x.fee) || 0) }));
    const recTotal = recItems.reduce((t, x) => t + x.amount, 0), recFee = recItems.reduce((t, x) => t + x.fee, 0); // REC 매매금액 · 용역 수수료 (별도)

    const supplyBefore = energy + netTotal + fee + recTotal + recFee + cs.taxable;
    const supplyAfter = supplyBefore + pd.taxable;
    const vat = {
      energy: E.round(energy * rates.vatRate), network: E.round(netTotal * rates.vatRate),
      fee: E.round(fee * rates.vatRate), rec: E.round(recTotal * rates.vatRate), recFee: E.round(recFee * rates.vatRate), surcharge: E.round(cs.taxable * rates.vatRate), prevDiff: E.round(pd.taxable * rates.vatRate)
    };
    const vatTotal = vat.energy + vat.network + vat.fee + vat.rec + vat.recFee + vat.surcharge + vat.prevDiff;
    const taxInvoice = supplyAfter + vatTotal;
    const fund = E.floorTo((energy + netTotal + fee + expectedSurcharge) * rates.fundRate, -1);
    const penalty = (ctx.penalty && ctx.penalty.amount) || 0; // 계약 위약금 (청구서 차감 방식) — 비과세 차감
    const billTotal = cs.exempt + fund + pd.exempt - penalty;
    return {
      supplyTotal, energy, energyParts, netByPlant: net, netTotal, fee, recItems, recTotal, recFee, expectedSurcharge, fund,
      confirmedSurcharge: cs, prevDiff: pd, supplyBefore, supplyAfter, vat, vatTotal, taxInvoice,
      penalty, penaltyLabel: (ctx.penalty && ctx.penalty.label) || "", exemptSubtotal: billTotal, grandTotal: taxInvoice + billTotal,
      loss: { deficitSimple: match.totals.deficitSimple, deficitLoss: match.totals.deficitLoss }
    };
  };

  /* ---------- 4) 확정 부가정산금 분할 (다음 달 청구에 반영) ---------- */
  E.splitSurcharge = function (totalAmount, rates) {
    const taxable = E.round(totalAmount * rates.taxableRatio);
    return { taxable, exempt: totalAmount - taxable };
  };

  /* ---------- 5) 발전사업자 정산서 ----------
   * 지급금액 = (공급량×매입단가) − 거래수수료, 각각 VAT 10% 별도, 전월차액/기타정산 가감
   */
  E.generatorSettlement = function (supplyKwh, unitPrice, rates, adj) {
    adj = adj || { prevDiff: 0, other: 0 };
    const energy = E.round(supplyKwh * unitPrice);
    const vat1 = E.round(energy * rates.vatRate);
    const fee = E.round(supplyKwh * rates.tradeFee);
    const vat2 = E.round(fee * rates.vatRate);
    return { energy, vat1, sub1: energy + vat1, fee, vat2, sub2: fee + vat2,
             payment: energy + vat1 - (fee + vat2) - (adj.prevDiff || 0) - (adj.other || 0) };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = E; else root.Engine = E;
})(typeof window !== "undefined" ? window : globalThis);
