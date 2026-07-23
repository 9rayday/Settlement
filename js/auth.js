/* ============ 로그인 게이트 ============
 * 가벼운 화면 진입 잠금이다. GAS 웹앱이 ANYONE_ANONYMOUS로 배포되어 있어서 로그인 여부와
 * 무관하게 URL을 아는 사람은 doGet/doPost를 직접 호출할 수 있다 — 진짜 보안 경계는 아니다.
 * 로그인 상태는 브라우저 sessionStorage에만 저장되므로 탭을 새로 열면 다시 로그인해야 한다.
 */
const AUTH_KEY = "settlement_auth";

function isAuthed(){
  return sessionStorage.getItem(AUTH_KEY) === "1";
}

function checkAuth(){
  const authed = isAuthed();
  document.getElementById("loginGate").style.display = authed ? "none" : "flex";
  document.getElementById("appRoot").style.display = authed ? "block" : "none";
  return authed;
}

async function handleLogin(){
  const id = document.getElementById("loginId").value.trim();
  const pw = document.getElementById("loginPw").value;
  const errEl = document.getElementById("loginError");
  errEl.style.display = "none";
  if(!id || !pw){
    errEl.textContent = "아이디와 비밀번호를 입력하세요.";
    errEl.style.display = "inline-flex";
    return;
  }
  const btn = document.getElementById("loginBtn");
  btn.disabled = true; btn.textContent = "확인 중...";
  const result = await login(id, pw);
  btn.disabled = false; btn.textContent = "로그인";
  if(!result){
    errEl.textContent = "아이디 또는 비밀번호가 올바르지 않습니다.";
    errEl.style.display = "inline-flex";
    return;
  }
  sessionStorage.setItem(AUTH_KEY, "1");
  if(checkAuth()) initApp();
}
