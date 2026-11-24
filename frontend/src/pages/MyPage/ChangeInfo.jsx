import { useState } from "react";
import Header from "../../components/M_header";
import { changePassword } from "../../services/authService.js";
import { isDemo } from "../../firebase/client.js";
import { serviceError } from "../../services/rentalDates.js";
import "./ChangeInfo.css";

function ChangeInfo() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    if (busy || isDemo) return;
    if (newPassword !== confirmPassword) {
      alert("비밀번호가 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      alert("비밀번호를 변경했습니다.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error.code === "auth/weak-password"
        ? "Firebase 프로젝트의 비밀번호 정책을 확인해 주세요."
        : serviceError(error, "현재 비밀번호를 확인해 주세요.");
      alert(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="change-info-page">
      <Header />
      <form className="change-info-container" onSubmit={handlePasswordChange}>
        <h2>비밀번호 변경</h2>
        {isDemo && <p>이 기능은 Firebase 연결 또는 Emulator 모드에서 사용할 수 있습니다.</p>}
        <label htmlFor="current-password">현재 비밀번호</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          placeholder="현재 비밀번호를 입력하세요"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          disabled={busy || isDemo}
        />
        <label htmlFor="new-password">새 비밀번호</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          placeholder="새 비밀번호를 입력하세요"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          minLength={6}
          disabled={busy || isDemo}
        />
        <label htmlFor="confirm-password">새 비밀번호 확인</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          placeholder="다시 한 번 입력하세요"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          disabled={busy || isDemo}
        />
        <button type="submit" disabled={busy || isDemo}>
          {busy ? "처리 중..." : "비밀번호 변경"}
        </button>
      </form>
    </div>
  );
}

export default ChangeInfo;
