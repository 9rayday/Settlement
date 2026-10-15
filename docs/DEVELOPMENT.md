# 개발 가이드 (VS Code)

## 시작
```bash
git clone https://github.com/9rayday/Settlement.git
cd Settlement
code .
```
- 화면 확인: VS Code 확장 **Live Server** → `index.html` 우클릭 → *Open with Live Server*.
  `file://`로 직접 열면 fetch가 막힐 수 있으니 Live Server(또는 `python3 -m http.server`)를 쓴다.
- 배포: `main`에 push 하면 GitHub Pages가 갱신된다. (`js/config.js` 의 GAS 주소는 공개 저장소에 커밋되어 있음)
- 로그인: 구글시트 `관리자` 탭의 아이디/비밀번호.

## 구조
| 경로 | 역할 |
|---|---|
| `index.html` | 탭 1~3(기존 발전사업자 정산서), 탭 4~5(수요기업 청구) |
| `js/engine.js` | **정산 계산 엔진**. 순수 함수, 브라우저/Node 공용. 월별 요율(`rates`)은 모두 인자로 받음 |
| `js/parsers.js` | KPX xlsx / 고객 15분 `.xls`(실제 HTML) 파서, 부하구분, 공휴일 목록(`HOLIDAYS`) |
| `js/store.js` | 요율·발전소·계약 저장 (GAS `앱데이터` 탭 + localStorage 캐시) |
| `js/billing.js` | 탭 4~5 화면 |
| `js/invoice.js`, `upload.js`, `exporters/*` | 기존 발전사업자 정산서 |
| `gas/Code.gs` | Apps Script 백엔드. **수정 후 시트의 Apps Script에 붙여넣고 "새 버전"으로 재배포** |
| `tests/engine.test.js` | 엔진 검증 (8월 삼성디스플레이 엑셀과 대조) |
| `tools/extract_fixture.py` | 정산 엑셀 → 검증용 fixture.json |

## 검증 (엔진/파서를 고칠 때마다)
```bash
pip install openpyxl
python3 tools/extract_fixture.py "2026-8 삼성디스플레이 ....xlsx" fixture.json   # 실데이터: 커밋 금지
node tests/engine.test.js fixture.json    # 전부 OK 여야 함 (원 단위 일치)
```

## Apps Script 재배포 절차
1. 시트 → 확장 프로그램 → Apps Script → `Code.gs` 전체를 `gas/Code.gs` 내용으로 교체 → 저장
2. (최초 1회) `setupSheets` 실행 → 권한 승인
3. 배포 → 배포 관리 → 연필 → 버전 **새 버전** → 배포 (실행: 나 / 액세스: 모든 사용자). "새 배포"를 만들면 주소가 바뀌니 주의.
4. 사이트 탭 4에서 요율 저장 → `앱데이터` 탭에 `rates:YYYYMM` 행이 생기면 정상.

## 월간 운영 순서
1. 탭 4: 이번 달 KPX 통지값(부가정산금 단가, 과세 비율, 송배전 요금표) 저장. 신규 발전소/계약은 최초 1회 등록
2. 탭 5: KPX 직접전력거래량 + 고객 15분 사용량 업로드 → 그룹(신청번호) 선택
3. 전월 확정 부가정산금(과세/비과세)·전월 차액 입력 → 계산 → 경고 확인 → Excel/PDF
4. "청구 기록 저장" (다음 달에 전월 예상 부가정산금을 참고로 보여줌)

## 계산 규칙 요약 (engine.js)
- 시간별 공급량 = min(사용량, Σ발전량), 발전소별 배분은 발전량 비율. 사용량 없음 = 발전량 전량 공급(엑셀 가정산 방식)
- 전력량요금 = ROUND(공급량×단가) / 거래수수료 = ROUND(공급량×0.1193) / 예상 부가정산금 = ROUND(공급량×단가)
- 망이용요금(발전소별) = TRUNC(ROUND(공급량)×발전측) + TRUNC(ROUND(공급량)×(1−송전손실률)×수요측) [+ 배전연결: ×(1−종합손실률)×3.05]
- 기금 = ROUNDDOWN((전력량요금+망이용요금+수수료+예상부가정산금)×2.7%, −1), 비과세. 청구서 계 = 전월 확정 부가정산금(비과세)+기금+전월 차액(비과세)
- 부가세는 과세 항목(전력량·망이용·수수료·전월 확정 부가정산금·전월 차액(과세))에만 10%
- 부하구분: 일요일·공휴일=경부하, 토요일 최대부하→중간부하, 나머지는 월별 시간대 표

## 로드맵 (진행 예정)
1. 오차정산서: 확정 부가정산금 입력 → 과세/비과세 분할 → 익월 청구서로 자동 이월 (전월 `bill:` 기록 활용)
2. 발전사업자 정산서(발전소별, 매입단가 165원 등)를 같은 그룹 화면에서 함께 생성 (`Engine.generatorSettlement` 구현됨, 화면 미연결)
3. 계약/그룹 관리 화면 고도화 (그룹 목록, 계약 기간·해지일)
4. 공휴일 목록 화면 편집, 이월 값 자동 계산
5. 연간보장공급량 미달 패널티 (규칙 전달받은 뒤)
6. 보안: GAS 요청 토큰 검증, 주소/`config.js` 공개 범위 재검토, 비밀번호 해시
