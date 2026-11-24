import {
  EmailAuthProvider,
  onIdTokenChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, isDemo } from "../firebase/client.js";
import { demoAccounts, demoPassword, demoSession, setDemoUser } from "./demoData.js";
import { isStudentAuthEmail, studentAuthEmail } from "./studentIdentity.js";

function watchMember(account, onSession, onError) {
  let profile;
  let role;
  let unsubscribeRole;
  const timer = setTimeout(() => onError({ code: "unavailable" }), 10000);

  const reportError = (error) => {
    clearTimeout(timer);
    onError(error);
  };
  const publish = () => {
    if (!profile || !role) return;
    clearTimeout(timer);
    onSession({
      id: account.uid,
      email: isStudentAuthEmail(account.email) ? null : account.email,
      studentId: profile.studentId ?? null,
      name: profile.name,
      isAdmin: role.data()?.admin === true,
    });
  };

  const unsubscribeProfile = onSnapshot(doc(db, "users", account.uid), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    profile = snapshot.data();
    if (!profile) {
      unsubscribeRole?.();
      unsubscribeRole = undefined;
      role = undefined;
      reportError(new Error("서비스에 등록된 계정이 아닙니다."));
      return;
    }

    if (!unsubscribeRole) {
      unsubscribeRole = onSnapshot(doc(db, "roles", account.uid), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        role = snapshot;
        publish();
      }, (error) => {
        unsubscribeRole = undefined;
        role = undefined;
        reportError(error);
      });
    }
    publish();
  }, reportError);

  return () => {
    clearTimeout(timer);
    unsubscribeProfile();
    unsubscribeRole?.();
  };
}

export function observeSession(onSession, onError, onPending) {
  if (isDemo) {
    demoSession.listeners.add(onSession);
    onSession(demoSession.user);
    return () => demoSession.listeners.delete(onSession);
  }

  let watchedUid;
  let unsubscribeMember;
  const unsubscribeAuth = onIdTokenChanged(auth, (account) => {
    if (account && watchedUid === account.uid) return;

    unsubscribeMember?.();
    unsubscribeMember = undefined;
    watchedUid = account?.uid;
    if (!account) {
      onSession(null);
      return;
    }

    onPending();
    unsubscribeMember = watchMember(account, onSession, (error) => {
      watchedUid = undefined;
      onError(error);
    });
  }, onError);

  return () => {
    unsubscribeMember?.();
    unsubscribeAuth();
  };
}

async function signInAccount(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isDemo) {
    await signInWithEmailAndPassword(auth, normalizedEmail, password);
    return;
  }

  const member = Object.hasOwn(demoAccounts, normalizedEmail) ? demoAccounts[normalizedEmail] : null;
  if (!member || password !== demoPassword) {
    const error = new Error("로그인 정보를 확인해 주세요.");
    error.code = "auth/invalid-credential";
    throw error;
  }
  setDemoUser({ ...member, email: member.studentId ? null : normalizedEmail });
}

export async function signInStudent(studentId, password) {
  await signInAccount(studentAuthEmail(studentId), password);
}

export async function signInAdmin(email, password) {
  if (isStudentAuthEmail(email)) throw new Error("학생 계정은 학생 ID 로그인에서 이용해 주세요.");
  await signInAccount(email, password);
}

export async function requestPasswordReset(email) {
  if (isStudentAuthEmail(email)) throw new Error("학생 비밀번호 초기화는 학생회에 문의해 주세요.");
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
}

export function logout() {
  if (isDemo) return setDemoUser(null);
  return signOut(auth);
}

export async function changePassword(currentPassword, newPassword) {
  if (isDemo) throw new Error("비밀번호 변경은 Firebase 연결 또는 Emulator 모드에서 사용할 수 있습니다.");
  const account = auth.currentUser;
  if (!account?.email) throw new Error("다시 로그인해 주세요.");
  await reauthenticateWithCredential(
    account,
    EmailAuthProvider.credential(account.email, currentPassword),
  );
  await updatePassword(account, newPassword);
}
