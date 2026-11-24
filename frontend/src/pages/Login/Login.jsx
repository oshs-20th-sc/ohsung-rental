import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../../auth/sessionContext.js";
import { isDemo, isEmulator } from "../../firebase/client.js";
import { requestPasswordReset, signInAdmin, signInStudent } from "../../services/authService.js";
import { demoAdminEmail, demoPassword, demoStudentId } from "../../services/demoData.js";
import { serviceError } from "../../services/rentalDates.js";
import "./Login.css";

function Login() {
  const location = useLocation();
  const [adminMode, setAdminMode] = useState(() =>
    ["/admin", "/usermanage"].includes(location.state?.from?.toLowerCase()),
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { user, loading: loadingSession, error: sessionError } = useSession();
  const busy = loading || loadingSession || resetting;
  const permissionMessage = sessionError?.code === "permission-denied"
    ? "서비스 이용 권한이 확인되지 않았습니다. 학생회에 문의해 주세요."
    : sessionError && serviceError(sessionError, "계정 정보를 확인하지 못했습니다.");
  const alertText = error || permissionMessage;

  if (user) return <Navigate to={location.state?.from ?? "/"} replace />;

  const handleLogin = async (event) => {
    event.preventDefault();
    if (busy) return;
    setNotice("");
    setError("");
    setLoading(true);
    try {
      await (adminMode ? signInAdmin(identifier, password) : signInStudent(identifier, password));
    } catch (loginError) {
      const message = adminMode
        ? "관리자 이메일 또는 비밀번호를 확인해 주세요."
        : "학생 ID 또는 비밀번호를 확인해 주세요.";
      setError(loginError.code === "auth/too-many-requests"
        ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
        : serviceError(loginError, message));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async (event) => {
    const input = event.currentTarget.form.elements.namedItem("identifier");
    if (!adminMode || busy || !input.reportValidity()) return;

    setError("");
    setNotice("");
    setResetting(true);
    try {
      await requestPasswordReset(identifier);
      setNotice("등록된 이메일이라면 비밀번호 재설정 링크가 도착합니다. 받은편지함이나 스팸함을 확인해 주세요.");
    } catch (resetError) {
      setError(serviceError(resetError, "비밀번호 재설정 링크를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setResetting(false);
    }
  };

  const switchMode = () => {
    setAdminMode(!adminMode);
    setIdentifier("");
    setPassword("");
    setNotice("");
    setError("");
  };

  return (
    <div className="login-page simple">
      <section className="login-card">
        <header className="login-card__head">
          <h1>{adminMode ? "관리자 로그인" : "로그인"}</h1>
          <p>{adminMode ? "등록된 관리자 이메일로 로그인하세요." : "학생 ID와 개인 비밀번호로 로그인하세요."}</p>
        </header>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="identifier">{adminMode ? "관리자 이메일" : "학생 ID"}</label>
            <input
              key={adminMode ? "admin" : "student"}
              id="identifier"
              name="identifier"
              type={adminMode ? "email" : "text"}
              inputMode={adminMode ? "email" : "numeric"}
              pattern={adminMode ? undefined : "[0-9]{7}"}
              maxLength={adminMode ? undefined : 7}
              title={adminMode ? undefined : "숫자 7자리"}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={adminMode ? "이메일을 입력하세요" : "7자리 숫자를 입력하세요"}
              autoComplete="username"
              required
              disabled={busy}
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="계정 비밀번호를 입력하세요"
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>

          {alertText && <p className="login-error" role="alert">{alertText}</p>}

          <button className="login-submit" type="submit" disabled={busy}>
            {loading ? "로그인 중..." : "로그인"}
          </button>

          {adminMode && !isDemo && (
            <button type="button" className="login-card__help" onClick={handlePasswordReset} disabled={busy}>
              {resetting ? "요청 중..." : "비밀번호 재설정"}
            </button>
          )}
          {notice && <p className="login-card__help-text" role="status">{notice}</p>}
          {!adminMode && <p className="login-card__foot">비밀번호를 잊었다면 학생회에 문의해 주세요.</p>}
          <button type="button" className="login-card__help" onClick={switchMode} disabled={busy}>
            {adminMode ? "학생 ID로 로그인" : "관리자 이메일 로그인"}
          </button>
        </form>

        {(isDemo || isEmulator) && (
          <footer className="login-card__foot">
            {adminMode ? `테스트 관리자 ${demoAdminEmail}` : `테스트 학생 ID ${demoStudentId}`}<br />
            테스트 비밀번호 {demoPassword}
          </footer>
        )}
      </section>
    </div>
  );
}

export default Login;
