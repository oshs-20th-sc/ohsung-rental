import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, open, readFile, unlink } from "node:fs/promises";
import process from "node:process";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { isValidStudentId, studentAuthEmail } from "../src/services/studentIdentity.js";

const demoProject = "demo-ohsung-rental";
const journalVersion = 1;

class RegistrationError extends Error {}
class AliasCollisionError extends RegistrationError {}

function readOptions() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        apply: { type: "boolean" },
        emulator: { type: "boolean" },
        project: { type: "string" },
        "credentials-out": { type: "string" },
      },
    });
  } catch {
    throw new RegistrationError("명령 옵션을 확인해 주세요. README의 학생 등록 방법을 참고하세요.");
  }

  const { values, positionals } = args;
  if (positionals.length !== 1 || !positionals[0]) {
    throw new RegistrationError("학생 목록 JSON 파일 하나를 지정하세요.");
  }
  if (values.emulator && values.project !== undefined) {
    throw new RegistrationError("--emulator와 --project는 함께 사용할 수 없습니다.");
  }
  if (values["credentials-out"] && !values.apply) {
    throw new RegistrationError("비밀번호 파일은 --apply 등록에서만 만들 수 있습니다.");
  }
  if (values.apply && !values["credentials-out"]) {
    throw new RegistrationError("초기 비밀번호를 안전하게 전달할 --credentials-out 파일을 지정하세요.");
  }
  if (values.apply && !values.emulator && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(values.project ?? "")) {
    throw new RegistrationError("운영 등록에는 Firebase 프로젝트 ID를 --project로 지정해야 합니다.");
  }
  if (values.apply && !values.emulator &&
      (values.project.startsWith("demo-") ||
       process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
       process.env.FIRESTORE_EMULATOR_HOST !== undefined)) {
    throw new RegistrationError("운영 등록에는 데모 프로젝트나 Emulator 환경변수를 사용할 수 없습니다.");
  }
  return { ...values, file: positionals[0] };
}

async function readRoster(file) {
  let roster;
  try {
    roster = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new RegistrationError("목록 파일을 열 수 없거나 JSON 형식이 잘못되었습니다.");
  }
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new RegistrationError("한 건 이상의 {studentId, name, grade?} 항목이 있는 JSON 배열을 입력하세요.");
  }

  const seen = new Set();
  return roster.map((row, index) => {
    const number = index + 1;
    const keys = row && typeof row === "object" && !Array.isArray(row)
      ? Object.keys(row).sort()
      : [];
    const expectedKeys = row?.grade === undefined
      ? ["name", "studentId"]
      : ["grade", "name", "studentId"];
    if (keys.length !== expectedKeys.length || keys.some((key, keyIndex) => key !== expectedKeys[keyIndex]) ||
        typeof row.name !== "string" || !isValidStudentId(row.studentId) ||
        (row.grade !== undefined && (!Number.isInteger(row.grade) || row.grade < 1 || row.grade > 3))) {
      throw new RegistrationError(`${number}번 항목의 필드는 studentId, name, 선택 항목 grade(1~3)만 사용할 수 있습니다.`);
    }

    const name = row.name.trim();
    if (!name || name.length > 80) {
      throw new RegistrationError(`${number}번 항목의 이름이 비어 있거나 너무 깁니다.`);
    }
    if (seen.has(row.studentId)) {
      throw new RegistrationError(`${number}번 항목의 학생 ID가 앞 항목과 중복됩니다.`);
    }
    seen.add(row.studentId);
    return row.grade === undefined
      ? { studentId: row.studentId, name }
      : { studentId: row.studentId, name, grade: row.grade };
  });
}

function makeJournal(projectId, roster) {
  return {
    version: journalVersion,
    projectId,
    students: roster.map((student) => ({
      ...student,
      password: `Aa1!${randomBytes(32).toString("base64url")}`,
      provisioningId: randomBytes(32).toString("base64url"),
    })),
  };
}

function sameRoster(journal, projectId, roster) {
  if (!journal || journal.version !== journalVersion || journal.projectId !== projectId ||
      !Array.isArray(journal.students) || journal.students.length !== roster.length) return false;
  return roster.every((expected, index) => {
    const actual = journal.students[index];
    const actualKeys = actual && typeof actual === "object" ? Object.keys(actual).sort() : [];
    const expectedKeys = expected.grade === undefined
      ? ["name", "password", "provisioningId", "studentId"]
      : ["grade", "name", "password", "provisioningId", "studentId"];
    return actual && actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, keyIndex) => key === expectedKeys[keyIndex]) &&
      actual.studentId === expected.studentId && actual.name === expected.name &&
      actual.grade === expected.grade && /^Aa1![A-Za-z0-9_-]{43}$/.test(actual.password) &&
      /^[A-Za-z0-9_-]{43}$/.test(actual.provisioningId);
  });
}

async function readPrivateJournal(file, projectId, roster) {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch {
    throw new RegistrationError("기존 비밀번호 파일을 확인할 수 없습니다. 같은 파일을 그대로 사용해 재시도하세요.");
  }
  if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid()) || metadata.size > 2_000_000) {
    throw new RegistrationError("비밀번호 파일은 현재 사용자 소유의 읽기 가능한 개인 파일이어야 합니다.");
  }

  let journal;
  try {
    const fileHandle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      journal = JSON.parse(await fileHandle.readFile("utf8"));
    } finally {
      await fileHandle.close();
    }
  } catch {
    throw new RegistrationError("비밀번호 파일을 읽을 수 없습니다. 같은 파일을 그대로 사용해 재시도하세요.");
  }
  if (!sameRoster(journal, projectId, roster)) {
    throw new RegistrationError("기존 비밀번호 파일의 프로젝트 또는 학생 목록이 다릅니다. 새 파일을 지정하세요.");
  }
  return journal;
}

async function createJournalExclusively(file, journal) {
  const directory = dirname(file);
  const tempFile = resolve(directory, `.${basename(file)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  let handle;
  try {
    handle = await open(tempFile, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempFile, file);
    await chmod(file, 0o600);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw new RegistrationError("개인 비밀번호 파일을 안전하게 만들지 못했습니다.");
    }
    return false;
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempFile).catch(() => {});
  }
}

async function loadOrCreateJournal(file, projectId, roster) {
  const absoluteFile = resolve(file);
  let journal = makeJournal(projectId, roster);
  if (await createJournalExclusively(absoluteFile, journal)) return journal;
  journal = await readPrivateJournal(absoluteFile, projectId, roster);
  return journal;
}

function managedUid(projectId, studentId) {
  const digest = createHash("sha256").update(`${projectId}\0${studentId}`).digest("hex");
  return `student-${digest}`;
}

function profileData(student) {
  const { studentId, name, grade } = student;
  return grade === undefined ? { name, studentId } : { name, studentId, grade };
}

function profileMatches(profile, student, { staged = false, provisioningId } = {}) {
  if (!profile || profile.name !== student.name || profile.studentId !== student.studentId ||
      profile.grade !== student.grade) return false;
  const expectedKeys = Object.keys(profileData(student));
  if (staged) {
    expectedKeys.push("isActive", "provisioningId");
    return Object.keys(profile).length === expectedKeys.length &&
      expectedKeys.every((key) => Object.hasOwn(profile, key)) &&
      profile.isActive === false && profile.provisioningId === provisioningId;
  }
  const allowedKeys = new Set([...expectedKeys, "isActive"]);
  return Object.keys(profile).every((key) => allowedKeys.has(key)) &&
    (profile.isActive === undefined || profile.isActive === true);
}

function profileCoreMatches(profile, student) {
  return Boolean(profile) && profile.name === student.name &&
    profile.studentId === student.studentId && profile.grade === student.grade;
}

async function findAccount(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return null;
  }
}

async function findAccountByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return null;
  }
}

function validateAccountIdentity(account, { uid, email, studentId, provisioningId }, staged) {
  if (!account) return;
  if (account.uid !== uid || account.email?.toLowerCase() !== email) {
    throw new RegistrationError("같은 인증 이메일 또는 UID가 다른 계정에 이미 사용 중입니다.");
  }
  if (staged) {
    const marker = `ohsung-student-provisioning:${provisioningId}`;
    if (account.displayName !== marker) {
      throw new RegistrationError("기존 인증 계정이 이번 발급 작업에서 생성된 계정인지 확인할 수 없습니다.");
    }
    if (!account.disabled && account.customClaims?.student_id !== studentId) {
      throw new RegistrationError("활성화된 인증 계정의 학생 권한을 확인할 수 없습니다.");
    }
  }
}

function validateClaims(account, studentId) {
  const claims = account.customClaims ?? {};
  const keys = Object.keys(claims);
  if (keys.some((key) => key !== "student_id") ||
      (Object.hasOwn(claims, "student_id") && claims.student_id !== studentId)) {
    throw new RegistrationError("기존 인증 권한이 있어 학생 계정에 연결하지 않았습니다.");
  }
}

async function stageProfile(db, student, provisioningId, profileRef, roleRef) {
  return db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const roleSnapshot = await transaction.get(roleRef);
    if (roleSnapshot.exists) throw new RegistrationError("이미 별도 권한이 지정된 계정입니다.");

    if (!profileSnapshot.exists) {
      transaction.create(profileRef, {
        ...profileData(student),
        isActive: false,
        provisioningId,
      });
      return "staged";
    }

    const profile = profileSnapshot.data();
    if (profile.provisioningId === provisioningId && profileMatches(profile, student, { staged: true, provisioningId })) {
      return "staged";
    }
    if (profileCoreMatches(profile, student) && !Object.hasOwn(profile, "provisioningId")) {
      if (profile.isActive === false) throw new RegistrationError("비활성화된 학생 프로필은 다시 활성화하지 않습니다.");
      if (!profileMatches(profile, student)) throw new RegistrationError("기존 학생 프로필에 예상하지 못한 필드가 있습니다.");
      return "complete";
    }
    throw new RegistrationError("기존 학생 프로필이 입력 정보와 다르거나 확인이 필요합니다.");
  });
}

async function ensureAuthAccount(auth, student, uid, provisioningId) {
  const email = studentAuthEmail(student.studentId);
  let account = await findAccount(auth, uid);
  const byEmail = await findAccountByEmail(auth, email);
  if (byEmail && byEmail.uid !== uid) {
    throw new AliasCollisionError("학생 로그인 별칭이 다른 계정에 이미 사용 중입니다.");
  }

  const marker = `ohsung-student-provisioning:${provisioningId}`;
  if (account) {
    validateAccountIdentity(account, { uid, email, studentId: student.studentId, provisioningId }, true);
  } else {
    if (byEmail) throw new AliasCollisionError("학생 로그인 별칭이 다른 계정에 이미 사용 중입니다.");
    try {
      account = await auth.createUser({
        uid,
        email,
        password: student.password,
        disabled: true,
        displayName: marker,
      });
    } catch (error) {
      if (!new Set(["auth/uid-already-exists", "auth/email-already-exists"]).has(error.code)) throw error;
      account = await findAccount(auth, uid);
      const latestByEmail = await findAccountByEmail(auth, email);
      if (latestByEmail && latestByEmail.uid !== uid) {
        throw new AliasCollisionError("학생 로그인 별칭이 다른 계정에 이미 사용 중입니다.");
      }
      validateAccountIdentity(account, { uid, email, studentId: student.studentId, provisioningId }, true);
    }
  }

  validateAccountIdentity(account, { uid, email, studentId: student.studentId, provisioningId }, true);
  validateClaims(account, student.studentId);
  if (account.customClaims?.student_id !== student.studentId) {
    await auth.setCustomUserClaims(uid, { student_id: student.studentId });
  }
  return account;
}

async function completeProfile(db, student, profileRef, roleRef, provisioningId) {
  return db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const roleSnapshot = await transaction.get(roleRef);
    if (roleSnapshot.exists) throw new RegistrationError("이미 별도 권한이 지정된 계정입니다.");
    if (!profileSnapshot.exists) throw new RegistrationError("발급 대기 프로필이 사라졌습니다. 확인이 필요합니다.");

    const profile = profileSnapshot.data();
    if (profileMatches(profile, student)) {
      if (profile.isActive === false) throw new RegistrationError("비활성화된 학생 프로필은 다시 활성화하지 않습니다.");
      return false;
    }
    if (profile.provisioningId !== provisioningId || !profileMatches(profile, student, { staged: true, provisioningId })) {
      throw new RegistrationError("발급 대기 프로필이 이번 작업과 일치하지 않습니다.");
    }
    transaction.set(profileRef, profileData(student));
    return true;
  });
}

export async function provisionStudent(auth, db, projectId, student) {
  const uid = managedUid(projectId, student.studentId);
  const profileRef = db.doc(`users/${uid}`);
  const roleRef = db.doc(`roles/${uid}`);
  const stage = await stageProfile(db, student, student.provisioningId, profileRef, roleRef);
  if (stage === "complete") {
    const account = await findAccount(auth, uid);
    if (!account || account.email?.toLowerCase() !== studentAuthEmail(student.studentId) ||
        account.customClaims?.student_id !== student.studentId) {
      throw new RegistrationError("기존 학생 프로필과 인증 계정의 연결을 확인할 수 없습니다.");
    }
    return false;
  }

  await ensureAuthAccount(auth, student, uid, student.provisioningId);
  const latest = await findAccount(auth, uid);
  if (!latest || latest.email?.toLowerCase() !== studentAuthEmail(student.studentId) ||
      latest.customClaims?.student_id !== student.studentId) {
    throw new RegistrationError("인증 계정과 학생 ID 연결을 확인할 수 없습니다.");
  }
  if (latest.disabled) await auth.updateUser(uid, { disabled: false });
  await completeProfile(db, student, profileRef, roleRef, student.provisioningId);
  const completed = await findAccount(auth, uid);
  if (completed?.displayName === `ohsung-student-provisioning:${student.provisioningId}`) {
    await auth.updateUser(uid, { displayName: null }).catch(() => {});
  }
  return true;
}

async function removeUnclaimedStage(db, student, projectId) {
  const uid = managedUid(projectId, student.studentId);
  const profileRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    if (profileSnapshot.exists && profileSnapshot.get("provisioningId") === student.provisioningId) {
      transaction.delete(profileRef);
    }
  });
}

async function main() {
  const options = readOptions();
  const roster = await readRoster(options.file);
  if (!options.apply) {
    console.log(`${roster.length}건을 검사했습니다. 등록하려면 --apply를 사용하세요.`);
    return;
  }

  const projectId = options.emulator ? demoProject : options.project;
  const journal = await loadOrCreateJournal(options["credentials-out"], projectId, roster);
  if (options.emulator) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.METADATA_SERVER_DETECTION = "none";
  }
  const app = initializeApp(options.emulator
    ? { projectId }
    : { projectId, credential: applicationDefault() });

  try {
    const auth = getAuth(app);
    const db = getFirestore(app);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (const [index, student] of journal.students.entries()) {
      try {
        const issued = await provisionStudent(auth, db, projectId, student);
        if (issued) {
          created++;
          console.log(`${index + 1}번 항목: 발급 완료`);
        } else {
          skipped++;
          console.log(`${index + 1}번 항목: 이미 발급됨`);
        }
      } catch (error) {
        const hasOwnedStage = error instanceof AliasCollisionError;
        if (hasOwnedStage) {
          try {
            const uid = managedUid(projectId, student.studentId);
            if (!(await findAccount(auth, uid))) await removeUnclaimedStage(db, student, projectId);
          } catch {
            // The staged profile cannot grant access while inactive and marked.
          }
        }
        failed++;
        const message = error instanceof RegistrationError
          ? error.message
          : "Firebase 연결과 실행 권한을 확인한 뒤 같은 비밀번호 파일로 재시도해 주세요.";
        console.error(`${index + 1}번 항목 등록 실패. ${message}`);
      }
    }
    console.log(`발급 ${created}건 · 이미 발급됨 ${skipped}건 · 실패 ${failed}건`);
    if (failed) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof RegistrationError ? error.message : "Firebase 설정 또는 실행 권한을 확인해 주세요.");
    process.exitCode = 1;
  }
}
