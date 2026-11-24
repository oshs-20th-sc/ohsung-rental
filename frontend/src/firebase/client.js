import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

export const isDemo = import.meta.env.MODE === "demo";
export const isEmulator = import.meta.env.DEV && import.meta.env.MODE === "emulator";

function firebaseConfig() {
  if (isDemo) return null;
  if (isEmulator) return { apiKey: "demo-api-key", projectId: "demo-ohsung-rental" };
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };
}

const config = firebaseConfig();
const app = config && Object.values(config).every(Boolean) ? initializeApp(config) : null;
export const isConfigured = isDemo || Boolean(app);

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (isEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
