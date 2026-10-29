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

/* ----- 로그인: 비밀번호 → (카카오 2단계) 인증번호 입력 또는 카카오 연결 → 완료 (gas/Code.gs login_/verifyOtp_/kakaoLink_) ----- */
let _pending = "";
function loginErr(msg){
  const errEl = document.getElementById("loginError");
  errEl.textContent = msg || "";
  errEl.style.display = msg ? "inline-flex" : "none";
}
let _otpTimer = null;
function startOtpTimer(sec){ // 남은 시간 표시, 다 지나면 처음으로
  clearInterval(_otpTimer);
  const end = Date.now() + sec * 1000, el = document.getElementById("otpTimer");
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`; el.classList.toggle("low", left <= 30);
    if (!left) { showLoginStep("pwStep"); loginErr("인증 시간이 지났습니다. 다시 로그인하세요."); }
  };
  tick(); _otpTimer = setInterval(tick, 1000);
}
function shakeOtp(){
  const f = document.querySelector(".otp-field"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake");
  setTimeout(() => f.classList.remove("shake"), 450);
}
function showLoginStep(step){
  if (step !== "otpStep") clearInterval(_otpTimer);
  const pw = document.getElementById("pwStep"); // 단계가 바뀌어도 카드 크기가 같게: 비밀번호 단계 높이로 맞춤
  if (pw.offsetHeight) document.querySelector(".login-card").style.setProperty("--step-h", pw.offsetHeight + "px");
  ["pwStep", "otpStep", "linkStep"].forEach(id => { const el = document.getElementById(id); el.hidden = id !== step; if (id === "pwStep") el.style.display = id === step ? "" : "none"; });
  if (step === "pwStep") { _pending = ""; document.getElementById("otpCode").value = ""; }
}
async function busyBtn(id, label, job){
  const btn = document.getElementById(id), text = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await job(); } finally { btn.disabled = false; btn.textContent = text; }
}
async function handleLogin(){
  const id = document.getElementById("loginId").value.trim();
  const pw = document.getElementById("loginPw").value;
  loginErr("");
  if(!id || !pw) return loginErr("아이디와 비밀번호를 입력하세요.");
  const result = await busyBtn("loginBtn", "확인 중...", () => login(id, pw));
  if(!result.ok) return loginErr(result.error);
  afterLoginStep(result.data, id);
}
function afterLoginStep(d, id){
  if (d && d.otp) {
    _pending = d.pending;
    showLoginStep("otpStep"); startOtpTimer(d.ttl || 180); document.getElementById("otpCode").focus();
    return;
  }
  if (d && d.link) {
    _pending = d.pending;
    document.getElementById("kakaoLinkBtn").onclick = () => { location.href = d.authUrl; };
    showLoginStep("linkStep");
    return;
  }
  completeLogin(d, id);
}
async function handleOtp(){
  const code = document.getElementById("otpCode").value.replace(/\D/g, "");
  loginErr("");
  if (code.length !== 6) { shakeOtp(); return loginErr("인증번호 6자리를 입력하세요."); }
  const r = await busyBtn("otpBtn", "확인 중...", () => authPost({ action: "verifyOtp", pending: _pending, code }));
  if (!r.ok) { loginErr(r.error); if (/다시 로그인/.test(r.error)) showLoginStep("pwStep"); else { shakeOtp(); document.getElementById("otpCode").select(); } return; }
  completeLogin(r.data);
}
async function handleResend(){
  loginErr("");
  const r = await busyBtn("otpResend", "보내는 중...", () => authPost({ action: "resendOtp", pending: _pending }));
  if (!r.ok) { loginErr(r.error); if (/다시 로그인/.test(r.error)) showLoginStep("pwStep"); return; }
  document.getElementById("otpCode").value = ""; document.getElementById("otpCode").focus(); startOtpTimer((r.data && r.data.ttl) || 180);
}
// 카카오 동의 화면에서 돌아옴 (kakao.html → index.html?code=…&state=…)
async function handleKakaoReturn(){
  const q = new URLSearchParams(location.search);
  if (!q.has("state") || !(q.has("code") || q.has("error"))) return false;
  history.replaceState(null, "", location.pathname); // 주소창의 code 지우기
  if (!q.has("code")) { loginErr("카카오 연결이 취소되었습니다. 다시 로그인하세요."); return true; }
  loginErr(""); document.getElementById("loginBtn").textContent = "카카오 연결 중...";
  document.getElementById("loginBtn").disabled = true;
  const r = await authPost({ action: "kakaoLink", code: q.get("code"), state: q.get("state") });
  document.getElementById("loginBtn").textContent = "로그인"; document.getElementById("loginBtn").disabled = false;
  if (!r.ok) { loginErr(r.error); return true; }
  completeLogin(r.data);
  return true;
}
function completeLogin(data, id){
  showLoginStep("pwStep");
  sessionStorage.setItem(AUTH_KEY, "1");
  // Code.gs 재배포 전(토큰을 주지 않는 예전 서버)에는 예전처럼 전체 권한으로 들어간다. 재배포하면 서버 권한이 적용된다.
  const legacy = !(data && data.token);
  sessionStorage.setItem(TOKEN_KEY, legacy ? "legacy" : data.token);
  sessionStorage.setItem(ROLE_KEY, legacy ? "관리자 (서버 재배포 전)" : (data.role || "조회"));
  sessionStorage.setItem(PERMS_KEY, JSON.stringify(legacy ? ["admin", "rates", "contract", "settle"] : (data.perms || [])));
  sessionStorage.setItem("settlement_user", (data && data.name) || id || ""); // 헤더 사용자 표시
  if(checkAuth()) initApp();
}

function togglePasswordVisibility(){
  const input = document.getElementById("loginPw");
  const shown = input.type === "text";
  input.type = shown ? "password" : "text";
  document.getElementById("pwIconClosed").style.display = shown ? "" : "none";
  document.getElementById("pwIconOpen").style.display = shown ? "none" : "";
}
