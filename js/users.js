/* ============ 권한관리 (#page-admin-users, 관리자만) ============
 * 계정 목록 · 권한 변경 · 잠금 해제 · 비밀번호 초기화 · 계정 추가/삭제. 저장은 GAS "관리자" 탭 (gas/Code.gs listUsers_/saveUser_/…).
 * 시트 "관리자" 탭의 "권한" 칸을 직접 고쳐도 된다 (다음 로그인부터 반영).
 */
const USER_ROLES = ["관리자", "정산담당자", "실무담당자"];
const usersState = { list: null, msg: "" };
const uEsc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function usersCall(action, body) {
  const r = await gasCall(action, body || {});
  if (!r.ok) { usersState.msg = "⚠ " + r.error; renderUsersPage(true); return null; }
  usersState.list = r.data; return r.data;
}

async function renderUsersPage(keep) {
  const host = document.getElementById("usersPage"); if (!host) return;
  if (!can("admin")) { host.innerHTML = `<div class="card"><div class="empty">관리자 전용</div></div>`; return; }
  if (!usersState.list && !keep) { host.innerHTML = `<div class="card"><div class="empty">불러오는 중...</div></div>`; await usersCall("listUsers"); }
  const list = usersState.list || [];
  const roleSel = (u) => `<select class="u-role" data-id="${uEsc(u.id)}"${u.master ? " disabled" : ""}>
      <option value=""${!u.role ? " selected" : ""}>조회 (권한 없음)</option>${USER_ROLES.map(r => `<option${u.role === r ? " selected" : ""}>${r}</option>`).join("")}</select>`;
  host.innerHTML = `
    <div class="card">
      <h2>계정 · 권한</h2>
      ${usersState.msg ? `<div class="notice ${usersState.msg.startsWith("⚠") ? "bad" : "warn"}">${uEsc(usersState.msg)}</div>` : ""}
      <div class="table-wrap"><table class="grid users-table">
        <tr><th>아이디</th><th>이름</th><th>권한</th><th>상태</th><th>최근 로그인</th><th></th></tr>
        ${list.map(u => `<tr>
          <td>${uEsc(u.id)}${u.master ? ' <span class="tag">마스터</span>' : ""}</td>
          <td><input class="u-name" data-id="${uEsc(u.id)}" value="${uEsc(u.name)}"></td>
          <td>${roleSel(u)}</td>
          <td>${u.locked ? '<span class="tag bad">잠김</span>' : (u.fails ? `정상 <span class="perf-sub">오류 ${u.fails}/5</span>` : "정상")}</td>
          <td>${uEsc(u.lastLogin || "-")}</td>
          <td class="u-actions"><button class="btn secondary u-save" data-id="${uEsc(u.id)}">저장</button>
            ${u.locked ? `<button class="btn accent u-unlock" data-id="${uEsc(u.id)}">잠금 해제</button>` : ""}
            <button class="btn secondary u-pw" data-id="${uEsc(u.id)}">비밀번호 초기화</button>
            ${u.master ? "" : `<button class="btn secondary u-del" data-id="${uEsc(u.id)}">삭제</button>`}</td></tr>`).join("")}
      </table></div>
    </div>
    <div class="card">
      <h2>계정 추가</h2>
      <div class="adj-grid">
        <div class="adj-item"><label class="adj-label">아이디</label><input id="nuId" placeholder="영문·숫자 3자 이상"></div>
        <div class="adj-item"><label class="adj-label">이름</label><input id="nuName"></div>
        <div class="adj-item"><label class="adj-label">권한</label><select id="nuRole"><option value="">조회 (권한 없음)</option>${USER_ROLES.map(r => `<option${r === "실무담당자" ? " selected" : ""}>${r}</option>`).join("")}</select></div>
        <div class="adj-item"><label class="adj-label">초기 비밀번호</label><input id="nuPw" type="password" placeholder="6자 이상"></div>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn accent" id="nuAdd">계정 추가</button></div>
    </div>`;
  const val = (cls, id) => { const el = host.querySelector(`.${cls}[data-id="${CSS.escape(id)}"]`); return el ? el.value : undefined; };
  host.querySelectorAll(".u-save").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (await usersCall("saveUser", { user: { id, name: val("u-name", id), role: val("u-role", id) } })) { usersState.msg = `${id} 저장 완료 (해당 사용자는 다시 로그인하면 반영)`; renderUsersPage(true); }
  });
  host.querySelectorAll(".u-unlock").forEach(b => b.onclick = async () => {
    if (await usersCall("unlockUser", { id: b.dataset.id })) { usersState.msg = `${b.dataset.id} 잠금 해제 완료`; renderUsersPage(true); }
  });
  host.querySelectorAll(".u-pw").forEach(b => b.onclick = async () => {
    const pw = prompt(`${b.dataset.id} 의 새 비밀번호 (6자 이상)`); if (!pw) return;
    if (await usersCall("saveUser", { user: { id: b.dataset.id, password: pw } })) { usersState.msg = `${b.dataset.id} 비밀번호 초기화 완료 (잠금도 해제됨)`; renderUsersPage(true); }
  });
  host.querySelectorAll(".u-del").forEach(b => b.onclick = async () => {
    if (!confirm(`${b.dataset.id} 계정을 삭제할까요?`)) return;
    if (await usersCall("deleteUser", { id: b.dataset.id })) { usersState.msg = `${b.dataset.id} 삭제 완료`; renderUsersPage(true); }
  });
  document.getElementById("nuAdd").onclick = async () => {
    const user = { id: document.getElementById("nuId").value.trim(), name: document.getElementById("nuName").value.trim(), role: document.getElementById("nuRole").value, password: document.getElementById("nuPw").value };
    if (await usersCall("saveUser", { isNew: true, user })) { usersState.msg = `${user.id} 계정 추가 완료`; renderUsersPage(true); }
  };
}
