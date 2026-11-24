import "./App.css";
import "./styles/global.css";
import Router from "./shared/Router";
import SessionProvider from "./auth/SessionProvider.jsx";
import { isConfigured, isDemo, isEmulator } from "./firebase/client.js";

function App() {
  if (!isConfigured) {
    return (
      <main className="home-loading">
        <h1>Firebase 설정이 필요합니다</h1>
        <p>배포 환경의 VITE_FIREBASE_* 설정을 확인해 주세요.</p>
      </main>
    );
  }

  return (
    <SessionProvider>
      {(isDemo || isEmulator) && (
        <div className="preview-notice" role="status">
          {isDemo ? "데모 모드 · 가상 데이터 · 새로고침 시 초기화" : "로컬 Firebase Emulator · 가상 데이터"}
        </div>
      )}
      <Router />
    </SessionProvider>
  );
}

export default App;
