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
    totalLossRate: 0.0352,           // 종합손실률 (배전 연결 시)
    genSide: { "비수도권": 1.92, "수도권북": 1.25, "수도권남": 1.20, "제주": 1.90 },
    demandSide: { "수도권": 2.44, "비수도권": 1.42, "제주": 6.95 },
    distribution: 3.05               // 배전연결 발전소 추가 요금 원/kWh
  };

  /* ---------- 1) 시간별 매칭 ----------
   * hourly: 한 시간 단위 { usage, gen: {plant: kWh} }
   * supply(h) = min(usage, Σgen) , 발전소별 배분은 발전량 비율, 초과분은 발전량 비율로 초과발전
   * usage 가 null/undefined 이면 "가정산 간주": 사용량 = 발전량 합(전량 공급) 으로 본다.
   */
  E.matchHour = function (usage, gen) {
    const plants = Object.keys(gen);
    const total = plants.reduce((s, p) => s + (gen[p] || 0), 0);
    const u = (usage === null || usage === undefined) ? total : usage;
    const supplyTotal = Math.min(u, total);
    const out = { supply: {}, excess: {}, supplyTotal, excessTotal: total - supplyTotal, deficit: Math.max(0, u - total), usage: u, genTotal: total };
    plants.forEach(p => {
      const share = total > 0 ? (gen[p] || 0) / total : 0;
      out.supply[p] = supplyTotal * share;
      out.excess[p] = (total - supplyTotal) * share;
    });
    return out;
  };

  /* days: [{date, load:[24 × '경부하'|'중간부하'|'최대부하'], usage:[24]|null, gen:{plant:[24]}}]
   * 반환: { supplyByPlant, genByPlant, excessByPlant, byLoad:{구분:{usage,supply,deficitSimple,deficitLoss}}, totals }
   */
  E.matchMonth = function (days, rates) {
    const loss = (rates && rates.transLossRate != null) ? rates.transLossRate : E.DEFAULT_RATES.transLossRate;
    const supplyByPlant = {}, genByPlant = {}, excessByPlant = {};
    const byLoad = {};
    const tot = { usage: 0, gen: 0, supply: 0, excess: 0, deficitSimple: 0, deficitLoss: 0 };
    days.forEach(d => {
      for (let h = 0; h < 24; h++) {
        const gen = {};
        Object.keys(d.gen).forEach(p => { gen[p] = d.gen[p][h] || 0; });
        const m = E.matchHour(d.usage ? d.usage[h] : null, gen);
        const lc = d.load[h];
        const b = byLoad[lc] || (byLoad[lc] = { usage: 0, supply: 0, deficitSimple: 0, deficitLoss: 0 });
        b.usage += m.usage; b.supply += m.supplyTotal; b.deficitSimple += m.deficit; b.deficitLoss += m.supplyTotal * loss;
        Object.keys(gen).forEach(p => {
          supplyByPlant[p] = (supplyByPlant[p] || 0) + m.supply[p];
          excessByPlant[p] = (excessByPlant[p] || 0) + m.excess[p];
          genByPlant[p] = (genByPlant[p] || 0) + gen[p];
        });
        tot.usage += m.usage; tot.gen += m.genTotal; tot.supply += m.supplyTotal; tot.excess += m.excessTotal;
        tot.deficitSimple += m.deficit; tot.deficitLoss += m.supplyTotal * loss;
      }
    });
    return { supplyByPlant, genByPlant, excessByPlant, byLoad, totals: tot };
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
   * TRUNC(ROUND(공급량)×발전측) + TRUNC(ROUND(공급량)×(1−송전손실률)×수요측) [+ 배전연결: TRUNC(ROUND(공급량)×(1−종합손실률)×3.05)]
   */
  E.networkFee = function (supplyKwh, plantInfo, demandRegion, rates) {
    const s = E.round(supplyKwh);
    const g = rates.genSide[plantInfo.region];
    if (g == null) throw new Error("발전소 지역(요금구분)이 올바르지 않습니다: " + plantInfo.region);
    const dm = rates.demandSide[demandRegion];
    if (dm == null) throw new Error("수요지 지역이 올바르지 않습니다: " + demandRegion);
    let fee = E.trunc(s * g) + E.trunc(s * (1 - rates.transLossRate) * dm);
    if (plantInfo.distConnected) fee += E.trunc(s * (1 - rates.totalLossRate) * rates.distribution);
    return { supplyRounded: s, fee };
  };

  /* ---------- 3) 청구서 (가정산) ----------
   * ctx: {
   *   unitPrice,                    // 계약 전력량 단가 원/kWh
   *   demandRegion,                 // 수요지 지역
   *   plants: {plant: {region, distConnected}},
   *   confirmedSurcharge: {taxable, exempt},   // 전월 확정 부가정산금 (과세/비과세)
   *   prevDiff: {taxable, exempt}               // 전월 오차정산 차액
   * }
   */
  E.invoice = function (match, ctx, rates) {
    const supplyTotal = match.totals.supply;
    const energy = E.round(supplyTotal * ctx.unitPrice);
    const net = {}; let netTotal = 0;
    Object.keys(match.supplyByPlant).forEach(p => {
      const info = ctx.plants[p];
      if (!info) throw new Error("발전소 등록 정보가 없습니다: " + p);
      const r = E.networkFee(match.supplyByPlant[p], info, ctx.demandRegion, rates);
      net[p] = r; netTotal += r.fee;
    });
    const fee = E.round(supplyTotal * rates.tradeFee);
    const cs = ctx.confirmedSurcharge || { taxable: 0, exempt: 0 };
    const pd = ctx.prevDiff || { taxable: 0, exempt: 0 };
    const expectedSurcharge = E.round(supplyTotal * rates.surcharge);

    const supplyBefore = energy + netTotal + fee + cs.taxable;
    const supplyAfter = supplyBefore + pd.taxable;
    const vat = {
      energy: E.round(energy * rates.vatRate), network: E.round(netTotal * rates.vatRate),
      fee: E.round(fee * rates.vatRate), surcharge: E.round(cs.taxable * rates.vatRate), prevDiff: E.round(pd.taxable * rates.vatRate)
    };
    const vatTotal = vat.energy + vat.network + vat.fee + vat.surcharge + vat.prevDiff;
    const taxInvoice = supplyAfter + vatTotal;
    const fund = E.floorTo((energy + netTotal + fee + expectedSurcharge) * rates.fundRate, -1);
    const billTotal = cs.exempt + fund + pd.exempt;
    return {
      supplyTotal, energy, netByPlant: net, netTotal, fee, expectedSurcharge, fund,
      confirmedSurcharge: cs, prevDiff: pd, supplyBefore, supplyAfter, vat, vatTotal, taxInvoice,
      exemptSubtotal: billTotal, grandTotal: taxInvoice + billTotal,
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
