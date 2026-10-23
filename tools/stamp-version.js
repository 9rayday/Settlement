// 배포 전에 실행: index.html 의 js/css 주소에 ?v=<시각> 을 붙여 브라우저가 새 파일을 바로 받게 한다.
// (GitHub Pages 는 파일을 10분간 캐시하므로, 주소가 바뀌지 않으면 예전 화면이 보일 수 있다)
// 사용: node tools/stamp-version.js
const fs = require("fs"), path = require("path");
const file = path.join(__dirname, "..", "index.html");
const d = new Date(), p = n => String(n).padStart(2, "0");
const v = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
let s = fs.readFileSync(file, "utf8"), n = 0;
s = s.replace(/((?:src|href)=")((?:js|css)\/[^"?]+)(\?v=[^"]*)?"/g, (m, a, f) => { n++; return `${a}${f}?v=${v}"`; });
fs.writeFileSync(file, s);
console.log(`index.html: ${n}개 파일에 ?v=${v}`);
