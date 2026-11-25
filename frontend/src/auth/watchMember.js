import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/firestoreClient.js";
import { isStudentAuthEmail } from "../services/studentIdentity.js";

export function watchMember(account, onSession, onError) {
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
