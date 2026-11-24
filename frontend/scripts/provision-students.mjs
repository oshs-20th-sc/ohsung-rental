import { createHash, randomBytes, scrypt } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, open, readFile, unlink } from "node:fs/promises";
import process from "node:process";
import { basename, dirname, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { applicationDefault, deleteApp, initializeApp, SDK_VERSION } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { isValidStudentId, studentAuthEmail } from "../src/services/studentIdentity.js";

const demoProject = "demo-ohsung-rental";
const journalVersions = { random: 1, shared: 2 };
const maxJournalBytes = 2_000_000;
const authImportLimit = 1_000;
const authLookupSize = 50;
const authWriteConcurrency = 20;
const hashConcurrency = 8;
const hash = {
  algorithm: "STANDARD_SCRYPT",
  memoryCost: 32_768,
  blockSize: 8,
  parallelization: 3,
  derivedKeyLength: 32,
};
const deriveKey = promisify(scrypt);

class RegistrationError extends Error {}

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
        "initial-password": { type: "string" },
      },
    });
  } catch {
    throw new RegistrationError("명령 옵션을 확인해 주세요. README의 학생 등록 방법을 참고하세요.");
  }

  const { values, positionals } = args;
  if (positionals.length !== 1 || !positionals[0]) {
    throw new RegistrationError("학생 목록 JSON 파일 하나를 지정하세요.");
  }
  const initialPassword = values["initial-password"];
  if (initialPassword !== undefined && (initialPassword.length < 6 || initialPassword.length > 4096)) {
    throw new RegistrationError("--initial-password는 6~4096자여야 합니다.");
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
  return { ...values, file: positionals[0], initialPassword };
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

function makeJournal(projectId, roster, version, initialPassword) {
  return {
    version,
    projectId,
    students: roster.map((student) => ({
      ...student,
      password: initialPassword ?? `Aa1!${randomBytes(32).toString("base64url")}`,
      provisioningId: randomBytes(32).toString("base64url"),
    })),
  };
}

function sameRoster(journal, projectId, roster, version, initialPassword) {
  if (!journal || journal.version !== version || journal.projectId !== projectId ||
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
      actual.grade === expected.grade && typeof actual.password === "string" &&
      (initialPassword === undefined
        ? /^Aa1![A-Za-z0-9_-]{43}$/.test(actual.password)
        : actual.password === initialPassword) &&
      typeof actual.provisioningId === "string" && /^[A-Za-z0-9_-]{43}$/.test(actual.provisioningId);
  });
}

async function readPrivateJournal(file, projectId, roster, version, initialPassword) {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch {
    throw new RegistrationError("기존 비밀번호 파일을 확인할 수 없습니다. 같은 파일을 그대로 사용해 재시도하세요.");
  }
  if (!metadata.isFile() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0 || (metadata.mode & 0o400) === 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid()) || metadata.size > maxJournalBytes) {
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
  if (!sameRoster(journal, projectId, roster, version, initialPassword)) {
    throw new RegistrationError("기존 비밀번호 파일과 프로젝트, 학생 목록 또는 초기 비밀번호 옵션이 일치하지 않습니다.");
  }
  return journal;
}

async function createJournalExclusively(file, journal) {
  const data = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(data) > maxJournalBytes) {
    throw new RegistrationError("비밀번호 파일이 너무 큽니다. 학생 목록을 나누어 발급하세요.");
  }
  const directory = dirname(file);
  const tempFile = resolve(directory, `.${basename(file)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  let handle;
  try {
    handle = await open(tempFile, "wx", 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(data, "utf8");
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

async function loadOrCreateJournal(file, projectId, roster, initialPassword) {
  const absoluteFile = resolve(file);
  const version = initialPassword === undefined ? journalVersions.random : journalVersions.shared;
  const journal = makeJournal(projectId, roster, version, initialPassword);
  if (await createJournalExclusively(absoluteFile, journal)) return journal;
  return readPrivateJournal(absoluteFile, projectId, roster, version, initialPassword);
}

function legacyHashedUid(projectId, studentId) {
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

function chunks(items, size) {
  const groups = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
}

function marker(student) {
  return `ohsung-student-provisioning:${student.provisioningId}`;
}

async function lookupAccounts(auth, rows, { includeLegacy = false } = {}) {
  const identifiers = rows.flatMap(({ uid, email, legacyUid }) =>
    includeLegacy ? [{ uid }, { email }, { uid: legacyUid }] : [{ uid }, { email }]);
  const groups = await Promise.all(chunks(identifiers, 100).map((group) => auth.getUsers(group)));
  const byUid = new Map();
  const byEmail = new Map();
  for (const { users } of groups) {
    for (const user of users) {
      byUid.set(user.uid, user);
      const email = user.email?.toLowerCase();
      if (email === undefined) continue;
      const uids = byEmail.get(email) ?? new Set();
      uids.add(user.uid);
      byEmail.set(email, uids);
    }
  }
  return { byUid, byEmail };
}

function accountFor({ byUid, byEmail }, { uid, email }) {
  const aliases = byEmail.get(email);
  if (aliases && (aliases.size !== 1 || !aliases.has(uid))) {
    throw new RegistrationError("학생 로그인 별칭이 다른 계정에 이미 사용 중입니다.");
  }
  const account = byUid.get(uid);
  if (account && account.email?.toLowerCase() !== email) {
    throw new RegistrationError("같은 인증 이메일 또는 UID가 다른 계정에 이미 사용 중입니다.");
  }
  return account;
}

function validateStagedAccount(account, student) {
  if (account.displayName !== marker(student)) {
    throw new RegistrationError("기존 인증 계정이 이번 발급 작업에서 생성된 계정인지 확인할 수 없습니다.");
  }
  const claims = account.customClaims ?? {};
  if (Object.keys(claims).some((key) => key !== "student_id") ||
      (Object.hasOwn(claims, "student_id") && claims.student_id !== student.studentId)) {
    throw new RegistrationError("기존 인증 권한이 있어 학생 계정에 연결하지 않았습니다.");
  }
  if (!account.disabled && claims.student_id !== student.studentId) {
    throw new RegistrationError("활성화된 인증 계정의 학생 권한을 확인할 수 없습니다.");
  }
}

function validateProfile(profile, student) {
  if (profileMatches(profile, student, { staged: true, provisioningId: student.provisioningId })) {
    return "staged";
  }
  if (profileCoreMatches(profile, student) && !Object.hasOwn(profile, "provisioningId")) {
    if (profile.isActive === false) throw new RegistrationError("비활성화된 학생 프로필은 다시 활성화하지 않습니다.");
    if (!profileMatches(profile, student)) throw new RegistrationError("기존 학생 프로필에 예상하지 못한 필드가 있습니다.");
    return "complete";
  }
  throw new RegistrationError("기존 학생 프로필이 입력 정보와 다르거나 확인이 필요합니다.");
}

export function importNewUsers(auth, records, options) {
  const handler = auth.authRequestHandler;
  // The pinned SDK has no public options for the batchCreate uniqueness checks.
  if (SDK_VERSION !== "14.5.1" || typeof handler?.invokeRequestHandler !== "function") {
    throw new RegistrationError("중복 보호를 확인할 수 없는 Firebase Admin SDK 버전입니다.");
  }
  const guardedHandler = Object.create(handler);
  guardedHandler.invokeRequestHandler = (url, settings, data, params) => {
    if (settings.getEndpoint() !== "/accounts:batchCreate" || !Array.isArray(data?.users)) {
      throw new RegistrationError("인증 일괄 등록 요청에 중복 보호를 적용할 수 없습니다.");
    }
    return handler.invokeRequestHandler(url, settings, {
      ...data, allowOverwrite: false, sanityCheck: true,
    }, params);
  };
  const guardedAuth = Object.create(auth);
  guardedAuth.authRequestHandler = guardedHandler;
  return guardedAuth.importUsers(records, options);
}

async function importRecord({ uid, email, student }, emulator) {
  const record = {
    uid,
    email,
    disabled: true,
    displayName: marker(student),
    customClaims: { student_id: student.studentId },
  };
  if (emulator) return record;

  const salt = randomBytes(32);
  const passwordHash = await deriveKey(student.password, salt, hash.derivedKeyLength, {
    N: hash.memoryCost,
    r: hash.blockSize,
    p: hash.parallelization,
    maxmem: 64 * 1024 * 1024,
  });
  return { ...record, passwordHash, passwordSalt: salt };
}

async function getProfiles(db, rows) {
  const groups = await Promise.all(chunks(rows, authLookupSize).map((group) =>
    db.getAll(...group.flatMap(({ profileRef, roleRef, legacyRef }) => [profileRef, roleRef, legacyRef]))));
  return new Map(groups.flat().map((snapshot) => [snapshot.ref.path, snapshot]));
}

function rejectRow(row, reason) {
  row.result = { status: "rejected", reason };
}

async function createProfiles(db, rows) {
  const newProfiles = rows.filter((row) => !row.profile && !row.result);
  if (!newProfiles.length) return;
  const writer = db.bulkWriter();
  const writes = newProfiles.map(async (row) => {
    const { student, profileRef } = row;
    try {
      await writer.create(profileRef, {
        ...profileData(student), isActive: false, provisioningId: student.provisioningId,
      });
    } catch (error) {
      rejectRow(row, error);
    }
  });
  await Promise.all([...writes, writer.close()]);
}

async function importMissingAccounts(auth, rows, emulator, importer) {
  const candidates = rows.filter((row) => !row.result && !row.account);
  if (!candidates.length) return;

  // Hashing can be slow. Re-read identifiers after hashing, before sending each import.
  const records = [];
  for (const group of chunks(candidates, hashConcurrency)) {
    records.push(...await Promise.all(group.map((row) => importRecord(row, emulator))));
  }
  const latest = await lookupAccounts(auth, candidates, { includeLegacy: true });
  const pending = [];
  for (const [index, row] of candidates.entries()) {
    try {
      checkLegacyIdentity(latest, row);
      if (!accountFor(latest, row)) pending.push({ row, record: records[index] });
    } catch (error) {
      rejectRow(row, error);
    }
  }
  if (!pending.length) return;

  try {
    const { errors } = await importer(pending.map(({ record }) => record), emulator ? undefined : { hash });
    for (const { index, error } of errors) pending[index].row.importError = error;
  } catch (error) {
    // A lost response may leave some accounts committed. Reconcile by UID and marker.
    for (const { row } of pending) row.importError = error;
  }
}

async function prepareAccount(auth, row, account, { keepDisabled, emulator }) {
  const { student, uid } = row;
  if (!account) {
    throw row.importError ?? new RegistrationError("인증 계정 일괄 등록을 확인할 수 없습니다.");
  }
  validateStagedAccount(account, student);
  if (keepDisabled && !account.disabled) {
    throw new RegistrationError("본인 확인 대기 계정이 이미 활성화되어 있습니다. 인증 계정 상태를 확인하세요.");
  }
  if (account.customClaims?.student_id !== student.studentId) {
    // A legacy journal may have stopped after creating Auth and before adding claims.
    await auth.setCustomUserClaims(uid, { student_id: student.studentId });
  }
  const changes = {};
  // The Auth Emulator cannot verify imported production hashes.
  if (emulator && account.disabled && !account.passwordHash) changes.password = student.password;
  if (!keepDisabled && account.disabled) changes.disabled = false;
  if (Object.keys(changes).length) await auth.updateUser(uid, changes);
}

async function completeProfiles(db, rows) {
  // Keep the role and staged profile checks in the same transaction as approval.
  await Promise.all(chunks(rows, authLookupSize).map(async (group) => {
    try {
      const results = await db.runTransaction(async (transaction) => {
        const refs = group.flatMap(({ profileRef, roleRef }) => [profileRef, roleRef]);
        const snapshots = await transaction.getAll(...refs);
        return group.map(({ student, profileRef }, index) => {
          const [profile, role] = snapshots.slice(index * 2, index * 2 + 2);
          try {
            if (role.exists) throw new RegistrationError("이미 별도 권한이 지정된 계정입니다.");
            if (!profile.exists) throw new RegistrationError("발급 대기 프로필이 사라졌습니다. 확인이 필요합니다.");
            const staged = validateProfile(profile.data(), student) === "staged";
            if (staged) transaction.set(profileRef, profileData(student));
            return { status: "fulfilled", value: staged };
          } catch (reason) {
            return { status: "rejected", reason };
          }
        });
      });
      group.forEach((row, index) => { row.result = results[index]; });
    } catch (error) {
      for (const row of group) rejectRow(row, error);
    }
  }));
}

async function clearMarkers(auth, rows) {
  try {
    const { byUid } = await lookupAccounts(auth, rows);
    for (const group of chunks(rows, authWriteConcurrency)) {
      await Promise.allSettled(group.filter(({ uid, student }) => byUid.get(uid)?.displayName === marker(student))
        .map(({ uid }) => auth.updateUser(uid, { displayName: null })));
    }
  } catch {
    // A completed profile and Auth account are usable if optional marker cleanup fails.
  }
}

function checkLegacyIdentity(accounts, { legacyUid, legacyRef }, profiles) {
  if (accounts.byUid.has(legacyUid) || profiles?.get(legacyRef.path)?.exists) {
    throw new RegistrationError("이 학생은 기존 해시 UID로 등록된 기록이 있습니다. 기존 UID와 대여 이력을 유지하고, 별도 확인 없이 새 계정을 만들지 마세요.");
  }
}

async function provisionBatch(auth, db, rows, options) {
  const [accounts, profiles] = await Promise.all([
    lookupAccounts(auth, rows, { includeLegacy: true }), getProfiles(db, rows),
  ]);
  for (const row of rows) {
    const { student, profileRef, roleRef } = row;
    try {
      if (profiles.get(roleRef.path).exists) throw new RegistrationError("이미 별도 권한이 지정된 계정입니다.");
      checkLegacyIdentity(accounts, row, profiles);
      row.profile = profiles.get(profileRef.path).data();
      row.account = accountFor(accounts, row);
      if (row.profile && validateProfile(row.profile, student) === "complete") {
        if (row.account?.customClaims?.student_id !== student.studentId) {
          throw new RegistrationError("기존 학생 프로필과 인증 계정의 연결을 확인할 수 없습니다.");
        }
        row.result = { status: "fulfilled", value: false };
      } else if (row.account) {
        validateStagedAccount(row.account, student);
        if (!row.profile) throw new RegistrationError("발급 대기 프로필이 사라졌습니다. 확인이 필요합니다.");
      }
    } catch (error) {
      rejectRow(row, error);
    }
  }

  await createProfiles(db, rows);
  await importMissingAccounts(auth, rows, options.emulator, options.importUsers);
  const staged = rows.filter((row) => !row.result);
  if (!staged.length) return;

  const current = await lookupAccounts(auth, staged);
  for (const group of chunks(staged, authWriteConcurrency)) {
    await Promise.all(group.map(async (row) => {
      try {
        await prepareAccount(auth, row, accountFor(current, row), options);
      } catch (error) {
        rejectRow(row, error);
      }
    }));
  }

  const ready = staged.filter((row) => !row.result);
  await completeProfiles(db, ready);
  await clearMarkers(auth, ready.filter(({ result }) => result.status === "fulfilled"));
}

export async function provisionStudents(auth, db, projectId, students, {
  keepDisabled = false,
  emulator = false,
  importUsers = (records, options) => importNewUsers(auth, records, options),
} = {}) {
  if (emulator && (projectId !== demoProject ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099")) {
    throw new RegistrationError("Emulator 발급은 로컬 데모 프로젝트에서만 사용할 수 있습니다.");
  }
  const seen = new Set();
  const rows = students.map((student) => {
    const row = { student };
    if (!isValidStudentId(student?.studentId)) {
      rejectRow(row, new RegistrationError("학생 ID를 숫자 7자리로 입력해 주세요."));
      return row;
    }
    if (seen.has(student.studentId)) {
      rejectRow(row, new RegistrationError("학생 ID가 앞 항목과 중복됩니다."));
      return row;
    }
    seen.add(student.studentId);
    const uid = student.studentId;
    const legacyUid = legacyHashedUid(projectId, uid);
    return { ...row, uid, legacyUid, email: studentAuthEmail(student.studentId),
      profileRef: db.doc(`users/${uid}`), roleRef: db.doc(`roles/${uid}`),
      legacyRef: db.doc(`users/${legacyUid}`) };
  });

  const pending = rows.filter((row) => !row.result);
  for (const batch of chunks(pending, authImportLimit)) {
    try {
      await provisionBatch(auth, db, batch, { keepDisabled, emulator, importUsers });
    } catch (error) {
      for (const row of batch.filter((row) => !row.result)) rejectRow(row, error);
    }
  }
  return rows.map(({ result }) => result);
}

export async function provisionStudent(auth, db, projectId, student, options) {
  const [result] = await provisionStudents(auth, db, projectId, [student], options);
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

async function main() {
  const options = readOptions();
  const roster = await readRoster(options.file);
  if (!options.apply) {
    console.log(`${roster.length}건을 검사했습니다. 등록하려면 --apply를 사용하세요.`);
    return;
  }

  const projectId = options.emulator ? demoProject : options.project;
  const { initialPassword } = options;
  const keepDisabled = !options.emulator && initialPassword !== undefined;
  const journal = await loadOrCreateJournal(options["credentials-out"], projectId, roster, initialPassword);
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
    const results = await provisionStudents(auth, db, projectId, journal.students, {
      keepDisabled, emulator: options.emulator,
    });
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        failed++;
        const message = result.reason instanceof RegistrationError
          ? result.reason.message
          : "Firebase 연결과 실행 권한을 확인한 뒤 같은 비밀번호 파일로 재시도해 주세요.";
        console.error(`${index + 1}번 항목 등록 실패. ${message}`);
      } else if (result.value) {
        created++;
        console.log(`${index + 1}번 항목: ${keepDisabled ? "발급 완료 (본인 확인 대기)" : "발급 완료"}`);
      } else {
        skipped++;
        console.log(`${index + 1}번 항목: 이미 발급됨`);
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
