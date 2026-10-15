# Settlement
# Twh 정산 시스템 구축_Update 26.07.22


## 수요기업 청구(가정산) 모듈
- `js/engine.js` 정산 계산 엔진 (시간별 매칭, 망이용요금, 수수료, 부가정산금, 기금, 부가세). 8월 삼성디스플레이 엑셀과 원 단위 일치 검증.
- `js/parsers.js` KPX 직접전력거래량 xlsx / 고객 15분 사용량 .xls(HTML) 파서, 부하구분(경/중간/최대), 누락·미수신 경고.
- `js/store.js` + `gas/Code.gs` 의 `앱데이터` 탭: 월별 요율·발전소·수요기업 계약 저장. **Code.gs 수정 후 새 버전으로 재배포 필요.**
- 검증: `node tests/engine.test.js <8월 엑셀에서 뽑은 fixture.json>` (실데이터라 저장소에는 두지 않음)
