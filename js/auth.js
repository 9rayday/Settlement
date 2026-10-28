/* ============ 로그인 게이트 · 권한 ============
 * 로그인하면 GAS가 토큰(6시간, 사용할 때마다 연장)과 권한을 준다. 모든 조회·저장은 서버에서 토큰과 권한을 확인한다
 * (gas/Code.gs session_/need_). 화면의 메뉴 숨김·버튼 막기는 편의용이고 실제 차단은 서버가 한다.
 * 권한: 관리자(전체 + 계정관리) / 정산담당자(settle) / 실무담당자(contract + settle) / 조회(권한 없음)
 * 로그인 상태는 sessionStorage 에만 있어 탭을 새로 열면 다시 로그인해야 한다.
 */
const AUTH_KEY = "settlement_auth";
const TOKEN_KEY = "settlement_token";
const ROLE_KEY = "settlement_role";
const PERMS_KEY = "settlement_perms";
const PERM_LABEL = { admin: "계정 관리", rates: "요율 관리", contract: "계약 등록·수정", settle: "정산" };

function isAuthed(){
  return sessionStorage.getItem(AUTH_KEY) === "1" && !!sessionStorage.getItem(TOKEN_KEY);
}
function userRole(){ try { return sessionStorage.getItem(ROLE_KEY) || "조회"; } catch (e) { return "조회"; } }
function can(perm){ try { return JSON.parse(sessionStorage.getItem(PERMS_KEY) || "[]").includes(perm); } catch (e) { return false; } }
// 저장 버튼 등에서 호출: 권한이 없으면 알리고 false
function requirePerm(perm){
  if (can(perm)) return true;
  alert(`권한이 없습니다. (${PERM_LABEL[perm] || perm} 권한 필요 · 현재 권한: ${userRole()})\n관리자에게 권한을 요청하세요.`);
  return false;
}

function checkAuth(){
  const authed = isAuthed();
  // 자동 로그아웃 등으로 돌아온 경우 안내 문구
  const msg = sessionStorage.getItem("settlement_logout_msg");
  if(!authed && msg){
    const errEl = document.getElementById("loginError");
    errEl.textContent = msg; errEl.style.display = "inline-flex";
    sessionStorage.removeItem("settlement_logout_msg");
  }
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
  if(!result.ok){
    errEl.textContent = result.error;
    errEl.style.display = "inline-flex";
    return;
  }
  sessionStorage.setItem(AUTH_KEY, "1");
  // Code.gs 재배포 전(토큰을 주지 않는 예전 서버)에는 예전처럼 전체 권한으로 들어간다. 재배포하면 서버 권한이 적용된다.
  const legacy = !(result.data && result.data.token);
  sessionStorage.setItem(TOKEN_KEY, legacy ? "legacy" : result.data.token);
  sessionStorage.setItem(ROLE_KEY, legacy ? "관리자 (서버 재배포 전)" : (result.data.role || "조회"));
  sessionStorage.setItem(PERMS_KEY, JSON.stringify(legacy ? ["admin", "rates", "contract", "settle"] : (result.data.perms || [])));
  sessionStorage.setItem("settlement_user", (result.data && result.data.name) || id); // 헤더 사용자 표시
  if(checkAuth()) initApp();
}

function togglePasswordVisibility(){
  const input = document.getElementById("loginPw");
  const shown = input.type === "text";
  input.type = shown ? "password" : "text";
  document.getElementById("pwIconClosed").style.display = shown ? "" : "none";
  document.getElementById("pwIconOpen").style.display = shown ? "none" : "";
}
