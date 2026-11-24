import { useEffect, useState } from "react";
import { observeSession } from "../services/authService.js";
import { SessionContext } from "./sessionContext.js";

export default function SessionProvider({ children }) {
  const [session, setSession] = useState({ user: null, loading: true, error: null });

  useEffect(() => observeSession(
    (user) => setSession({ user, loading: false, error: null }),
    (error) => setSession({ user: null, loading: false, error }),
    () => setSession({ user: null, loading: true, error: null }),
  ), []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
