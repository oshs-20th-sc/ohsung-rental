import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { studentAuthEmail } from "../src/services/studentIdentity.js";
import { importNewUsers, provisionStudents } from "../scripts/provision-students.mjs";

const projectId = "demo-ohsung-rental";
const authHost = "127.0.0.1:9099";
let app;
let auth;
let db;

before(async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, authHost, "Run this suite with npm test.");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080", "Run this suite with npm test.");
  process.env.METADATA_SERVER_DETECTION = "none";
  app = initializeApp({ projectId });
  auth = getAuth(app);
  db = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
});

function student(studentId, name = `학생 ${studentId}`) {
  return {
    studentId,
    name,
    password: `Fictional-${studentId}-Initial!`,
    provisioningId: randomBytes(32).toString("base64url"),
  };
}

function uidFor(studentId) {
  return `student-${randomBytes(32).toString("hex")}-${studentId}`;
}

async function signIn(email, password) {
  return fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
}

function recordingImporter(baseAuth) {
  const batches = [];
  return {
    batches,
    importUsers: async (users, options) => {
      batches.push({ users, options });
      return baseAuth.importUsers(users, options);
    },
  };
}

test("imports 1,001 accounts in chunks of at most 1,000 with claims and BulkWriter profiles", async () => {
  const students = Array.from({ length: 1001 }, (_, index) => student(String(8000000 + index)));
  const { importUsers, batches } = recordingImporter(auth);
  const results = await provisionStudents(auth, db, projectId, students, {
    emulator: true,
    keepDisabled: true,
    importUsers,
  });

  assert.equal(results.length, students.length);
  assert.ok(results.every((result) => result.status === "fulfilled" && result.value === true));
  assert.deepEqual(batches.map(({ users }) => users.length), [1000, 1]);
  assert.ok(batches.every(({ users }) => users.every((record) => record.disabled === true)));
  for (const entry of [students[0], students[999], students[1000]]) {
    const uid = recordFor(batches, studentAuthEmail(entry.studentId)).uid;
    assert.equal(uid, entry.studentId);
    const imported = await auth.getUser(uid);
    assert.equal(imported.disabled, true);
    assert.deepEqual(imported.customClaims, { student_id: entry.studentId });
    assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), {
      studentId: entry.studentId,
      name: entry.name,
    });
    const login = await signIn(studentAuthEmail(entry.studentId), entry.password);
    assert.equal((await login.json()).error.message, "USER_DISABLED");
  }
});

test("pre-existing UID and alias collisions keep their credentials and do not block unrelated rows", async () => {
  const uidCollision = student("8100001", "기존 UID 학생");
  const aliasCollision = student("8100002", "기존 별칭 학생");
  const newStudent = student("8100003", "신규 학생");
  const oldUidPassword = "Fictional-UID-Original-123!";
  const oldAliasPassword = "Fictional-Alias-Original-123!";
  const occupiedUid = uidCollision.studentId;
  const uidOwner = await auth.createUser({
    uid: occupiedUid,
    email: studentAuthEmail(uidCollision.studentId),
    password: oldUidPassword,
    disabled: true,
  });
  const aliasOwner = await auth.createUser({
    uid: uidFor(aliasCollision.studentId),
    email: studentAuthEmail(aliasCollision.studentId),
    password: oldAliasPassword,
    disabled: true,
  });
  const { importUsers, batches } = recordingImporter(auth);
  const results = await provisionStudents(auth, db, projectId, [uidCollision, aliasCollision, newStudent], {
    emulator: true,
    importUsers,
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  assert.deepEqual(results[2], { status: "fulfilled", value: true });
  assert.equal(batches.flatMap(({ users }) => users).some((record) => record.uid === occupiedUid), false);
  assert.equal(batches.flatMap(({ users }) => users).some((record) => record.email === studentAuthEmail(aliasCollision.studentId)), false);
  const unchangedUid = await auth.getUser(occupiedUid);
  const unchangedAlias = await auth.getUser(aliasOwner.uid);
  assert.equal(unchangedUid.disabled, true);
  assert.equal(unchangedAlias.disabled, true);
  assert.equal(unchangedUid.passwordHash, uidOwner.passwordHash);
  assert.equal(unchangedAlias.passwordHash, aliasOwner.passwordHash);
  assert.equal((await db.doc(`users/${occupiedUid}`).get()).exists, false);
  assert.equal((await db.doc(`users/${aliasCollision.studentId}`).get()).exists, false);
  assert.equal((await db.doc(`users/${newStudent.studentId}`).get()).exists, true);
});

test("a lost import response resumes with the same provisioning ID without importing the existing account again", async () => {
  const entry = student("8200001", "재시도 학생");
  let importCalls = 0;
  let loseFirstResponse = true;
  const importUsers = async (users, options) => {
    importCalls++;
    const result = await auth.importUsers(users, options);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      throw new Error("simulated connection loss after import");
    }
    return result;
  };

  const first = await provisionStudents(auth, db, projectId, [entry], {
    emulator: true,
    keepDisabled: true,
    importUsers,
  });
  assert.equal(first.length, 1);
  assert.equal((await auth.getUser(entry.studentId)).customClaims.student_id, entry.studentId);

  const retry = await provisionStudents(auth, db, projectId, [entry], {
    emulator: true,
    keepDisabled: true,
    importUsers,
  });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].status, "fulfilled");
  assert.equal(importCalls, 1);
  assert.equal((await auth.getUser(entry.studentId)).disabled, true);
  assert.deepEqual((await db.doc(`users/${entry.studentId}`).get()).data(), {
    studentId: entry.studentId,
    name: entry.name,
  });
  assert.equal((await signIn(studentAuthEmail(entry.studentId), entry.password)).ok, false);
});

test("an indexed import failure leaves an inactive stage and retries only the failed account", async () => {
  const entries = [student("8250001"), student("8250002")];
  const requestSizes = [];
  const importUsers = async (records, options) => {
    requestSizes.push(records.length);
    if (requestSizes.length === 1) {
      const imported = await importNewUsers(auth, [records[0]], options);
      assert.equal(imported.successCount, 1);
      return { errors: [{ index: 1, error: new Error("injected import row failure") }] };
    }
    return importNewUsers(auth, records, options);
  };
  const options = { emulator: true, importUsers };
  const [first, failed] = await provisionStudents(auth, db, projectId, entries, options);
  assert.deepEqual(first, { status: "fulfilled", value: true });
  assert.equal(failed.status, "rejected");
  assert.match(failed.reason.message, /injected import row failure/);
  const pending = entries[1];
  const uid = pending.studentId;
  assert.equal((await db.doc(`users/${uid}`).get()).get("isActive"), false);
  await assert.rejects(auth.getUser(uid), { code: "auth/user-not-found" });

  const retry = await provisionStudents(auth, db, projectId, entries, options);
  assert.deepEqual(retry, [{ status: "fulfilled", value: false }, { status: "fulfilled", value: true }]);
  assert.deepEqual(requestSizes, [2, 1]);
  assert.equal((await signIn(studentAuthEmail(pending.studentId), pending.password)).ok, true);
});

test("an account created after preflight is rejected by guarded import and remains unchanged", async () => {
  const entry = student("8300001", "중복 경합 학생");
  const existingPassword = "Fictional-Race-Original-123!";
  let originalAccount;
  const guardedImport = async (records, options) => {
    const record = records[0];
    originalAccount = await auth.createUser({
      uid: record.uid,
      email: record.email,
      password: existingPassword,
      disabled: true,
      displayName: "unrelated account",
    });
    return importNewUsers(auth, records, options);
  };

  const results = await provisionStudents(auth, db, projectId, [entry], {
    emulator: true,
    importUsers: guardedImport,
  });

  assert.ok(originalAccount);
  assert.equal(results[0].status, "rejected");
  const account = await auth.getUser(entry.studentId);
  assert.equal(account.disabled, true);
  assert.equal(account.displayName, "unrelated account");
  assert.equal(account.customClaims, undefined);
  assert.equal(account.passwordHash, originalAccount.passwordHash);
  assert.deepEqual((await db.doc(`users/${account.uid}`).get()).data(), {
    studentId: entry.studentId,
    name: entry.name,
    isActive: false,
    provisioningId: entry.provisioningId,
  });
});

test("the web fixture refuses provisioning outside its local Emulator", async () => {
  const entry = student("8400001");
  const unexpectedImport = () => assert.fail("Auth must not be called");
  await assert.rejects(
    provisionStudents(null, null, projectId, [entry], { importUsers: unexpectedImport }),
    /rental-setup/,
  );
  await assert.rejects(
    provisionStudents(auth, db, "unrelated-qa-project", [entry], {
      emulator: true,
      importUsers: unexpectedImport,
    }),
    /loopback Emulator/,
  );
  assert.equal((await db.doc(`users/${entry.studentId}`).get()).exists, false);
});

function recordFor(batches, email) {
  return batches.flatMap(({ users }) => users).find((record) => record.email === email);
}
