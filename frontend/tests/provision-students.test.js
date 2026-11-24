import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { studentAuthEmail } from "../src/services/studentIdentity.js";
import { provisionStudent } from "../scripts/provision-students.mjs";

const projectId = "demo-ohsung-rental";
const authHost = "127.0.0.1:9099";
const firestoreHost = "127.0.0.1:8080";
const cli = fileURLToPath(new URL("../scripts/provision-students.mjs", import.meta.url));
let app;
let auth;
let db;
let directory;

before(async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, authHost, "Run this suite with npm test.");
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, firestoreHost, "Run this suite with npm test.");
  process.env.METADATA_SERVER_DETECTION = "none";
  directory = await mkdtemp(join(tmpdir(), "ohsung-student-provisioning-"));
  app = initializeApp({ projectId });
  auth = getAuth(app);
  db = getFirestore(app);
});

after(async () => {
  if (app) await deleteApp(app);
  if (directory) await rm(directory, { recursive: true, force: true });
});

function legacyHashedUid(studentId) {
  const digest = createHash("sha256").update(`${projectId}\0${studentId}`).digest("hex");
  return `student-${digest}`;
}

function paths(label) {
  return {
    roster: join(directory, `${label}.students.json`),
    credentials: join(directory, `${label}.credentials.json`),
  };
}

async function runWithCredentials(rows, credentialFile, ...flags) {
  const { roster } = paths(`roster-${randomBytes(8).toString("hex")}`);
  await writeFile(roster, JSON.stringify(rows));
  const args = [cli, roster, ...flags];
  if (flags.includes("--apply") && !flags.includes("--credentials-out")) {
    args.push("--credentials-out", credentialFile);
  }
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 15000 });
  if (result.error) throw result.error;
  for (const row of rows) {
    for (const privateValue of [row.studentId, row.name]) {
      assert(!result.stdout.includes(privateValue));
      assert(!result.stderr.includes(privateValue));
    }
  }
  return result;
}

async function run(rows, ...flags) {
  const output = paths(`default-${randomBytes(8).toString("hex")}`);
  return runWithCredentials(rows, output.credentials, ...flags);
}

async function signIn(email, password) {
  return fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
}

const applyLocally = ["--emulator", "--apply"];

test("the default validates a roster without creating an account or password file", async () => {
  const student = { studentId: "2610701", name: "검사 학생" };
  const { credentials } = paths("dry-run");
  const result = await runWithCredentials([student], credentials);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1건을 검사했습니다/);
  await assert.rejects(auth.getUserByEmail(studentAuthEmail(student.studentId)), { code: "auth/user-not-found" });
  await assert.rejects(stat(credentials), { code: "ENOENT" });
});

test("direct provisioning rejects an invalid student ID before reading or writing profiles", async () => {
  await assert.rejects(
    provisionStudent(auth, db, projectId, { studentId: "12345/other", name: "잘못된 ID" }),
    /학생 ID를 숫자 7자리로 입력해 주세요/,
  );
  assert.equal((await db.doc("users/12345").get()).exists, false);
});

test("registration creates an ID-linked profile and usable password, then safely skips on retry", async () => {
  const student = { studentId: "2610702", name: "등록 학생", grade: 2 };
  const { credentials } = paths("registration");
  const first = await runWithCredentials([student], credentials, ...applyLocally);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /1번 항목: 발급 완료/);
  assert.match(first.stdout, /발급 1건/);

  const fileStat = await stat(credentials);
  assert.equal(fileStat.mode & 0o777, 0o600);
  const journalText = await readFile(credentials, "utf8");
  const journal = JSON.parse(journalText);
  const password = journal.students[0].password;
  assert.match(password, /^Aa1![A-Za-z0-9_-]{43}$/);
  const account = await auth.getUserByEmail(studentAuthEmail(student.studentId));
  assert.equal(account.uid, student.studentId);
  assert.equal(account.disabled, false);
  assert.deepEqual(account.customClaims, { student_id: student.studentId });
  assert.deepEqual((await db.doc(`users/${account.uid}`).get()).data(), student);
  assert.equal((await db.doc(`roles/${account.uid}`).get()).exists, false);

  const validLogin = await signIn(studentAuthEmail(student.studentId), password);
  assert.equal(validLogin.ok, true);
  const wrongPassword = await signIn(studentAuthEmail(student.studentId), "Incorrect-Password-123!");
  assert.equal(wrongPassword.ok, false);
  const missingAccount = await signIn(studentAuthEmail("2610799"), password);
  assert.equal(missingAccount.ok, false);

  const second = await runWithCredentials([student], credentials, ...applyLocally);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /1번 항목: 이미 발급됨/);
  assert.match(second.stdout, /이미 발급됨 1건/);
  assert.equal(await readFile(credentials, "utf8"), journalText);
  assert.equal((await auth.getUserByEmail(studentAuthEmail(student.studentId))).uid, account.uid);
});

test("a leading-zero student ID is used as the exact Auth UID string", async () => {
  const student = { studentId: "0012345", name: "선행 0 학생" };
  const result = await run([student], ...applyLocally);
  assert.equal(result.status, 0, result.stderr);

  const account = await auth.getUserByEmail(studentAuthEmail(student.studentId));
  assert.equal(account.uid, "0012345");
  assert.deepEqual((await db.doc("users/0012345").get()).data(), student);
});

test("existing hashed-UID students keep their account and rental references without duplicate provisioning", async () => {
  const student = { studentId: "2610713", name: "기존 해시 학생" };
  const legacyUid = legacyHashedUid(student.studentId);
  const email = studentAuthEmail(student.studentId);
  const password = "Fictional-Legacy-123!";
  await auth.createUser({ uid: legacyUid, email, password });
  await auth.setCustomUserClaims(legacyUid, { student_id: student.studentId });
  await db.doc(`users/${legacyUid}`).create(student);
  await db.doc("rentals/legacy-student-rental").create({ userId: legacyUid });

  const result = await run([student], ...applyLocally);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /기존 해시 UID/);
  await assert.rejects(auth.getUser(student.studentId), { code: "auth/user-not-found" });
  assert.equal((await db.doc(`users/${student.studentId}`).get()).exists, false);
  assert.equal((await auth.getUser(legacyUid)).uid, legacyUid);
  assert.deepEqual((await db.doc(`users/${legacyUid}`).get()).data(), student);
  assert.deepEqual((await db.doc("rentals/legacy-student-rental").get()).data(), { userId: legacyUid });
  assert.equal((await signIn(email, password)).ok, true);
});

test("the same private journal safely resumes after Auth was enabled but profile approval failed", async () => {
  const student = {
    studentId: "2610703",
    name: "재시도 학생",
    grade: 3,
    password: `Aa1!${randomBytes(32).toString("base64url")}`,
    provisioningId: randomBytes(32).toString("base64url"),
  };
  const { credentials } = paths("partial-failure");
  await writeFile(credentials, JSON.stringify({ version: 1, projectId, students: [student] }), { mode: 0o600 });
  await chmod(credentials, 0o600);

  const failFinalProfileWrite = {
    doc: (path) => db.doc(path),
    getAll: (...refs) => db.getAll(...refs),
    bulkWriter: () => db.bulkWriter(),
    runTransaction: () => Promise.reject(new Error("injected final profile failure")),
  };
  await assert.rejects(
    provisionStudent(auth, failFinalProfileWrite, projectId, student, { emulator: true }),
    /injected final profile failure/,
  );

  const uid = student.studentId;
  const stagedAccount = await auth.getUser(uid);
  assert.equal(stagedAccount.disabled, false);
  assert.equal(stagedAccount.customClaims.student_id, student.studentId);
  assert.equal(stagedAccount.displayName, `ohsung-student-provisioning:${student.provisioningId}`);
  assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), {
    studentId: student.studentId,
    name: student.name,
    grade: student.grade,
    isActive: false,
    provisioningId: student.provisioningId,
  });

  const retry = await runWithCredentials(
    [{ studentId: student.studentId, name: student.name, grade: student.grade }],
    credentials,
    ...applyLocally,
  );
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /발급 1건/);
  assert.deepEqual((await db.doc(`users/${uid}`).get()).data(), {
    studentId: student.studentId,
    name: student.name,
    grade: student.grade,
  });
  assert.equal((await signIn(studentAuthEmail(student.studentId), student.password)).ok, true);
});

test("an alias owned by another UID is never attached to the student profile", async () => {
  const student = { studentId: "2610704", name: "충돌 학생" };
  const email = studentAuthEmail(student.studentId);
  const unrelated = await auth.createUser({ email, password: "Fictional-Collision-123!" });
  const result = await run([student], ...applyLocally);
  const uid = student.studentId;
  assert.equal(result.status, 1);
  assert.match(result.stderr, /1번 항목 등록 실패/);
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
  assert.equal((await auth.getUserByEmail(email)).uid, unrelated.uid);
});

test("an unmarked Auth-only account is not adopted and receives no membership", async () => {
  const student = { studentId: "2610705", name: "미확인 계정" };
  const uid = student.studentId;
  const existing = await auth.createUser({
    uid,
    email: studentAuthEmail(student.studentId),
    password: "Fictional-Existing-123!",
    disabled: true,
  });
  await auth.setCustomUserClaims(existing.uid, { admin: true });
  const result = await run([student], ...applyLocally);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /이번 발급 작업에서 생성된 계정인지 확인할 수 없습니다/);
  const profile = await db.doc(`users/${uid}`).get();
  assert.equal(profile.exists, false);
  const unchanged = await auth.getUser(uid);
  assert.equal(unchanged.disabled, true);
  assert.deepEqual(unchanged.customClaims, { admin: true });
});

test("invalid IDs, grades, extra fields, and duplicate IDs are rejected before provisioning", async () => {
  const invalidId = await run([{ studentId: "26107022", name: "잘못된 ID" }], ...applyLocally);
  assert.equal(invalidId.status, 1);
  assert.match(invalidId.stderr, /1번 항목/);

  const invalidGrade = await run([{ studentId: "2610706", name: "잘못된 학년", grade: 4 }], ...applyLocally);
  assert.equal(invalidGrade.status, 1);
  assert.match(invalidGrade.stderr, /1번 항목/);

  const extraField = await run([{ studentId: "2610707", name: "추가 필드", email: "old@example.test" }], ...applyLocally);
  assert.equal(extraField.status, 1);
  assert.match(extraField.stderr, /1번 항목/);

  const duplicate = await run([
    { studentId: "2610708", name: "중복 ID" },
    { studentId: "2610708", name: "중복 ID 2" },
  ], ...applyLocally);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /중복/);
  await assert.rejects(auth.getUserByEmail(studentAuthEmail("2610708")), { code: "auth/user-not-found" });
});

test("disabled profiles and separately assigned administrator roles are not overwritten", async () => {
  const disabledStudent = { studentId: "2610709", name: "비활성 학생" };
  const disabledUid = disabledStudent.studentId;
  await auth.createUser({
    uid: disabledUid,
    email: studentAuthEmail(disabledStudent.studentId),
    password: "Fictional-Disabled-123!",
    disabled: true,
  });
  await auth.setCustomUserClaims(disabledUid, { student_id: disabledStudent.studentId });
  await db.doc(`users/${disabledUid}`).create({ ...disabledStudent, isActive: false });
  const disabledResult = await run([disabledStudent], ...applyLocally);
  assert.equal(disabledResult.status, 1);
  assert.match(disabledResult.stderr, /비활성화된 학생 프로필은 다시 활성화하지 않습니다/);
  assert.equal((await auth.getUser(disabledUid)).disabled, true);
  assert.deepEqual((await db.doc(`users/${disabledUid}`).get()).data(), { ...disabledStudent, isActive: false });

  const adminStudent = { studentId: "2610711", name: "권한 보존" };
  const adminUid = adminStudent.studentId;
  await db.doc(`roles/${adminUid}`).create({ admin: true });
  const adminResult = await run([adminStudent], ...applyLocally);
  assert.equal(adminResult.status, 1);
  assert.match(adminResult.stderr, /별도 권한이 지정된 계정/);
  assert.equal((await db.doc(`roles/${adminUid}`).get()).get("admin"), true);
  assert.equal((await db.doc(`users/${adminUid}`).get()).exists, false);
  await assert.rejects(auth.getUserByEmail(studentAuthEmail(adminStudent.studentId)), { code: "auth/user-not-found" });
});

test("a fresh credentials file marks pre-existing accounts as already issued", async () => {
  const student = { studentId: "2610712", name: "기존 계정" };
  const email = studentAuthEmail(student.studentId);
  const uid = student.studentId;
  const password = "Fictional-Original-123!";
  await auth.createUser({ uid, email, password });
  await auth.setCustomUserClaims(uid, { student_id: student.studentId });
  await db.doc(`users/${uid}`).create(student);

  const { credentials } = paths("fresh-existing");
  const result = await runWithCredentials([student], credentials, ...applyLocally);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1번 항목: 이미 발급됨/);
  const generated = JSON.parse(await readFile(credentials, "utf8")).students[0].password;
  assert.equal((await signIn(email, password)).ok, true);
  assert.equal((await signIn(email, generated)).ok, false);
});
