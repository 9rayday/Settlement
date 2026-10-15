// 사용법: node tests/engine.test.js <fixture.json>   (8월 삼성디스플레이 엑셀에서 뽑은 시간별 데이터; 실데이터라 저장소에는 두지 않는다)
const E = require("../js/engine.js");
const fx = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const rates = Object.assign({}, E.DEFAULT_RATES, { month: "202608" });
const plants = {};
Object.keys(fx.days[0].gen).forEach(p => plants[p] = { region: "비수도권", distConnected: false });
const m = E.matchMonth(fx.days.map(d => ({ date: d.date, load: d.load, usage: d.usage, gen: d.gen })), rates);
const inv = E.invoice(m, { unitPrice: 175, demandRegion: "비수도권", plants,
  confirmedSurcharge: { taxable: 5626908, exempt: 1643938 }, prevDiff: { taxable: 181, exempt: 0 } }, rates);
const X = fx.expected;
let bad = 0;
const chk = (name, got, want) => { const ok = Math.abs(got - want) < 0.5; if (!ok) bad++; console.log((ok ? "OK  " : "FAIL"), name, got, want); };
chk("공급량", m.totals.supply, X.I10);
chk("전력량요금", inv.energy, X.G16);
chk("망이용요금", inv.netTotal, X.G18);
chk("거래수수료", inv.fee, X.G30);
chk("예상부가정산금", inv.expectedSurcharge, X.G43);
chk("기금", inv.fund, X.G44);
chk("공급가액(전월차액前)", inv.supplyBefore, X.G32);
chk("부가세계", inv.vatTotal, X.G40);
chk("세금계산서계", inv.taxInvoice, X.G41);
chk("청구서계", inv.exemptSubtotal, X.G46);
chk("당월청구계", inv.grandTotal, X.G47);
chk("부족전력량(손실률)", m.totals.deficitLoss, X.R9);
Object.keys(X.plants).forEach(p => chk("망이용 " + p, inv.netByPlant[p].fee, X.plants[p][0]));
console.log(bad ? bad + "건 불일치" : "전부 일치");
process.exit(bad ? 1 : 0);
