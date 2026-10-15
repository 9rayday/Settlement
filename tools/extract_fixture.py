"""8월(가정산) 정산 엑셀에서 시간별 발전량/부하구분/기대값을 뽑아 tests/engine.test.js 용 fixture.json 을 만든다.
사용: python3 tools/extract_fixture.py "<정산엑셀.xlsx>" fixture.json
실데이터가 들어 있으므로 fixture.json 은 .gitignore 대상이다(커밋 금지). 필요: pip install openpyxl
"""
import sys, json, openpyxl

src, dst = sys.argv[1], sys.argv[2]
wv = openpyxl.load_workbook(src, data_only=True)
ws = wv['직접전력거래 세부 사항(가정산)']
days, r = [], 44
while ws.cell(r, 2).value == '부하시간' and ws.cell(r, 1).value is not None:
    row = lambda rr: [ws.cell(rr, c).value for c in range(4, 28)]
    gen, rr = {}, r + 3
    while ws.cell(rr, 2).value == '발전량':
        gen[ws.cell(rr, 3).value] = [float(x or 0) for x in row(rr)]; rr += 1
    days.append(dict(date=ws.cell(r, 1).value.strftime('%Y-%m-%d'), load=row(r),
                     usage=[float(x or 0) for x in row(r + 1)], gen=gen))
    r += 40  # 하루 블록 = 40행
cs = wv['청구서(가정산)']
exp = {k: cs[k].value for k in ['G16','G18','G30','G43','G44','G32','G40','G41','G46','G47','I10','R9']}
exp['plants'] = {cs.cell(rr, 6).value: [cs.cell(rr, 7).value, cs.cell(rr, 8).value] for rr in range(19, 30)}
json.dump(dict(days=days, expected=exp), open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print(f'{len(days)}일, 발전소 {len(days[0]["gen"])}개 → {dst}')
