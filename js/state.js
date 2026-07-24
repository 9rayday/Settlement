/* ============ Global state ============ */
let rawRows = [];
let rawHeaders = [];   // original column headers, in original order, exactly as uploaded
let colMap = {};
let colIdx = {};       // {field: {name, index(1-based), mult}} position of each field within rawHeaders
let plants = [];              // ordered unique plant names from data
let aggByPlant = {};          // {plant: {generation, supply, excess}} in kWh
let siteTotals = {usage:0, generation:0, supply:0, excess:0, deficit:0};
let settleMonth = "";         // YYYYMM

let masterData = {};          // {발전소명: {...}} from GAS 발전소 사업자 정보
let adjustmentsByPlant = {};  // {발전소명: {전월차액, 전월미지급액, 기타정산}} cache for current month
let cumulativeSupplyByPlant = {}; // {발전소명: 실공급량누계 kWh} from GAS logPerformance response

const BUYER = {
  bizName: "한화신한테라와트아워 (김 한 성)",
  bizNameLegal: "한화신한테라와트아워 주식회사",
  bizRegNo: "243-81-02905",
  address: "서울특별시 중구 삼일대로 363 1107호\n(장교동, 장교빌딩)",
  manager: "홍인성 프로",
  contact: "02-318-2309 / insunghong@hanwha.com",
  invoicePrefix: "300025"
};

const DEFAULT_FEE_RATE = 0.1193; // 원/kWh, 마스터에 값이 없을 때 기본값
const DEFAULT_GUARANTEE_HOURS = 3.4; // 발전보장시간(h/일), 마스터에 값이 없을 때 기본값
