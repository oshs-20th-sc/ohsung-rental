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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { user, loading: loadingSession, error: sessionError } = useSession();
  const loginId = identifier.trim();
  const isEmailLogin = loginId.includes("@");
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
      await (isEmailLogin ? signInAdmin(loginId, password) : signInStudent(loginId, password));
    } catch (loginError) {
      setError(loginError.code === "auth/too-many-requests"
        ? "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
        : serviceError(loginError, "ID 또는 비밀번호를 확인해 주세요."));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!isEmailLogin || busy) return;

    setError("");
    setNotice("");
    setResetting(true);
    try {
      await requestPasswordReset(loginId);
      setNotice("등록된 이메일이라면 비밀번호 재설정 링크가 도착합니다. 받은편지함이나 스팸함을 확인해 주세요.");
    } catch (resetError) {
      setError(resetError.code === "auth/invalid-email"
        ? "관리자 이메일 주소를 확인해 주세요."
        : serviceError(resetError, "비밀번호 재설정 링크를 요청하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="login-page simple">
      <section className="login-card">
        <header className="login-card__head">
          <h1>로그인</h1>
        </header>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="identifier">ID</label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                setNotice("");
                setError("");
              }}
              placeholder="ID를 입력하세요"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
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

          {isEmailLogin && !isDemo ? (
            <button type="button" className="login-card__help" onClick={handlePasswordReset} disabled={busy}>
              {resetting ? "요청 중..." : "비밀번호 재설정"}
            </button>
          ) : (
            <p className="login-card__foot">비밀번호를 잊었다면 학생회에 문의해 주세요.</p>
          )}
          {notice && <p className="login-card__help-text" role="status">{notice}</p>}
        </form>

        {(isDemo || isEmulator) && (
          <footer className="login-card__foot">
            테스트 학생 ID {demoStudentId}<br />
            테스트 관리자 {demoAdminEmail}<br />
            테스트 비밀번호 {demoPassword}
          </footer>
        )}
      </section>
    </div>
  );
}

export default Login;
