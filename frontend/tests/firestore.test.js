import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import process from "node:process";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  approveProductReturn,
  borrowProduct,
  requestProductReturn,
} from "../src/services/rentalTransactions.js";

const projectId = "demo-ohsung-rental";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const [host, port] = emulatorHost.split(":");
const fixtureProduct = {
  category: "우산",
  name: "투명 우산",
  displayNo: 1,
  status: "available",
  activeRentalId: null,
};

let environment;

const studentIds = {
  "student-a": "1234567",
  "student-b": "2345678",
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port: Number(port),
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

after(async () => {
  await environment?.cleanup();
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/student-a"), { name: "학생 A", studentId: studentIds["student-a"], grade: 1 }),
      setDoc(doc(db, "users/student-b"), { name: "학생 B", studentId: studentIds["student-b"], grade: 2 }),
      setDoc(doc(db, "users/admin"), { name: "관리자" }),
      setDoc(doc(db, "roles/admin"), { admin: true }),
      setDoc(doc(db, "products/umbrella-1"), fixtureProduct),
    ]);
  });
});

function dbFor(uid) {
  const studentId = studentIds[uid];
  const claims = studentId
    ? { student_id: studentId, email: `${studentId}@students.ohsung-rental.invalid` }
    : {};
  return environment.authenticatedContext(uid, claims).firestore();
}

function rentalRecord({
  userId = "student-a",
  status = "rented",
  rentedAt = Timestamp.fromMillis(Date.now() - 60_000),
  returnRequestedAt = null,
  returnedAt = null,
} = {}) {
  return {
    userId,
    productId: "umbrella-1",
    productName: "투명 우산",
    displayNo: 1,
    status,
    rentedAt,
    returnRequestedAt,
    returnedAt,
  };
}

async function seedRented({
  rentalId = "rental-active-1",
  userId = "student-a",
  status = "rented",
  rentedAt = Timestamp.fromMillis(Date.now() - 60_000),
  returnRequestedAt = null,
} = {}) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "products/umbrella-1"), {
        ...fixtureProduct,
        status: status === "rented" ? "rented" : "return_requested",
        activeRentalId: rentalId,
      }),
      setDoc(doc(db, `rentals/${rentalId}`), rentalRecord({
        userId,
        status,
        rentedAt,
        returnRequestedAt,
      })),
    ]);
  });
  return rentalId;
}

test("two students racing for one item produce one rental", async () => {
  const first = borrowProduct(dbFor("student-a"), "student-a", "umbrella-1");
  const second = borrowProduct(dbFor("student-b"), "student-b", "umbrella-1");
  const results = await Promise.allSettled([first, second]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const products = await getDoc(doc(db, "products/umbrella-1"));
    const rentals = await getDocs(collection(db, "rentals"));
    assert.equal(products.data().status, "rented");
    assert.equal(rentals.size, 1);
    assert.equal(products.data().activeRentalId, rentals.docs[0].id);
  });
});

test("a rented item cannot be rented again", async () => {
  await seedRented();
  await assert.rejects(borrowProduct(dbFor("student-b"), "student-b", "umbrella-1"));
});

test("a student cannot request return for another student's rental", async () => {
  const rentalId = await seedRented({ userId: "student-a" });
  await assert.rejects(requestProductReturn(dbFor("student-b"), rentalId));
});

test("an unauthenticated user cannot borrow", async () => {
  const db = environment.unauthenticatedContext().firestore();
  await assert.rejects(borrowProduct(db, "student-a", "umbrella-1"));
});

test("an authenticated account without a provisioned member profile is denied", async () => {
  const db = dbFor("unlisted-user");
  const ownProfile = await assertSucceeds(getDoc(doc(db, "users/unlisted-user")));
  assert.equal(ownProfile.exists(), false);
  await assertFails(getDoc(doc(db, "products/umbrella-1")));
  await assert.rejects(borrowProduct(db, "unlisted-user", "umbrella-1"));
});

test("student access is bound to both the provisioned ID and synthetic email claim", async () => {
  const wrongStudentId = environment.authenticatedContext("student-a", {
    student_id: "7654321",
    email: "7654321@students.ohsung-rental.invalid",
  }).firestore();
  await assertFails(getDoc(doc(wrongStudentId, "products/umbrella-1")));
  await assertFails(getDoc(doc(wrongStudentId, "users/student-a")));

  const wrongEmail = environment.authenticatedContext("student-a", {
    student_id: studentIds["student-a"],
    email: "attacker@example.invalid",
  }).firestore();
  await assertFails(getDoc(doc(wrongEmail, "products/umbrella-1")));
  await assertSucceeds(getDoc(doc(dbFor("student-a"), "products/umbrella-1")));
});

test("a student profile cannot use an admin role to bypass identity binding", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "roles/student-a"), { admin: true });
  });

  const mismatchedAdmin = environment.authenticatedContext("student-a", {
    student_id: "7654321",
    email: "7654321@students.ohsung-rental.invalid",
  }).firestore();
  await assertFails(getDoc(doc(mismatchedAdmin, "products/umbrella-1")));
  await assertFails(getDoc(doc(mismatchedAdmin, "roles/student-a")));
});

test("inactive and staged profiles do not grant membership", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await updateDoc(doc(db, "users/student-a"), { isActive: false });
  });
  const inactive = dbFor("student-a");
  await assertFails(getDoc(doc(inactive, "products/umbrella-1")));
  await assertFails(getDoc(doc(inactive, "users/student-a")));

  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/staged-student"), {
      name: "준비 중 학생",
      studentId: "3456789",
      isActive: true,
      provisioningId: "fictional-staging-token",
    });
  });
  const staged = environment.authenticatedContext("staged-student", {
    student_id: "3456789",
    email: "3456789@students.ohsung-rental.invalid",
  }).firestore();
  await assertFails(getDoc(doc(staged, "products/umbrella-1")));
});

test("student profiles must use a seven-digit ID and an optional grade from one to three", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users/bad-grade"), {
      name: "학년 오류 학생",
      studentId: "5678901",
      grade: 4,
    });
    await setDoc(doc(db, "users/bad-id"), {
      name: "학번 오류 학생",
      studentId: "567890",
      grade: 1,
    });
  });

  const badGrade = environment.authenticatedContext("bad-grade", {
    student_id: "5678901",
    email: "5678901@students.ohsung-rental.invalid",
  }).firestore();
  const badId = environment.authenticatedContext("bad-id", {
    student_id: "567890",
    email: "567890@students.ohsung-rental.invalid",
  }).firestore();
  await assertFails(getDoc(doc(badGrade, "products/umbrella-1")));
  await assertFails(getDoc(doc(badId, "products/umbrella-1")));
});

test("legacy email-only profiles are not members", async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/legacy-email-student"), {
      name: "이전 이메일 계정",
      email: "old-student@example.invalid",
    });
  });
  const legacyStudent = environment.authenticatedContext("legacy-email-student", {
    student_id: "4567890",
    email: "4567890@students.ohsung-rental.invalid",
  }).firestore();
  await assertFails(getDoc(doc(legacyStudent, "products/umbrella-1")));
});

test("a student cannot directly change product status", async () => {
  const db = dbFor("student-a");
  await assertFails(updateDoc(doc(db, "products/umbrella-1"), {
    status: "rented",
    activeRentalId: "made-up-rental",
  }));
});

test("a rental cannot be created without its paired product update", async () => {
  const db = dbFor("student-a");
  await assertFails(setDoc(doc(db, "rentals/orphan-rental"), {
    ...rentalRecord({ rentedAt: serverTimestamp() }),
  }));
});

test("a student cannot grant themselves an administrator role", async () => {
  const db = dbFor("student-a");
  await assertFails(setDoc(doc(db, "roles/student-a"), { admin: true }));
  await assertFails(updateDoc(doc(db, "users/student-a"), { admin: true }));
});

test("a borrower can request a timely return with the product update", async () => {
  const rentalId = await seedRented();
  await assertSucceeds(requestProductReturn(dbFor("student-a"), rentalId));

  const db = dbFor("student-a");
  const rental = await getDoc(doc(db, `rentals/${rentalId}`));
  const product = await getDoc(doc(db, "products/umbrella-1"));
  assert.equal(rental.data().status, "return_requested");
  assert.ok(rental.data().returnRequestedAt instanceof Timestamp);
  assert.ok(rental.data().returnRequestedAt.toMillis() <= Date.now());
  assert.equal(product.data().status, "return_requested");
  assert.equal(product.data().activeRentalId, rentalId);
});

test("a student cannot approve their own return", async () => {
  const rentalId = await seedRented({ status: "return_requested" });
  await assert.rejects(approveProductReturn(dbFor("student-a"), rentalId));
});

test("a trusted admin can mark a timely rental for return", async () => {
  const rentalId = await seedRented();
  await assertSucceeds(requestProductReturn(dbFor("admin"), rentalId));

  const rental = await getDoc(doc(dbFor("admin"), `rentals/${rentalId}`));
  assert.equal(rental.data().status, "return_requested");
});

test("an admin can request an overdue return, approve it, and make the item borrowable", async () => {
  const overdueTime = Timestamp.fromMillis(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const rentalId = await seedRented({ rentedAt: overdueTime });
  await assert.rejects(requestProductReturn(dbFor("student-a"), rentalId));

  const adminDb = dbFor("admin");
  await assertSucceeds(requestProductReturn(adminDb, rentalId));
  await assertSucceeds(approveProductReturn(adminDb, rentalId));

  const returned = await getDoc(doc(adminDb, `rentals/${rentalId}`));
  const available = await getDoc(doc(adminDb, "products/umbrella-1"));
  assert.equal(returned.data().status, "returned");
  assert.ok(returned.data().returnedAt instanceof Timestamp);
  assert.equal(available.data().status, "available");
  assert.equal(available.data().activeRentalId, null);

  await assertSucceeds(borrowProduct(dbFor("student-b"), "student-b", "umbrella-1"));
});

test("students can query their own history and cannot read another student's data", async () => {
  await seedRented({ userId: "student-a" });
  const db = dbFor("student-b");

  await assertFails(getDoc(doc(db, "rentals/rental-active-1")));
  await assertFails(getDoc(doc(db, "users/student-a")));
  await assertFails(getDocs(collection(db, "rentals")));

  const ownResults = await assertSucceeds(getDocs(query(
    collection(db, "rentals"),
    where("userId", "==", "student-b"),
  )));
  assert.equal(ownResults.size, 0);
});

test("the admin can read the rental queue and return state stays paired", async () => {
  const rentalId = await seedRented();
  const adminDb = dbFor("admin");
  const allRentals = await assertSucceeds(getDocs(collection(adminDb, "rentals")));
  assert.equal(allRentals.size, 1);

  await assertSucceeds(requestProductReturn(dbFor("student-a"), rentalId));
  await assertSucceeds(approveProductReturn(adminDb, rentalId));
  const rental = await getDoc(doc(adminDb, `rentals/${rentalId}`));
  const product = await getDoc(doc(adminDb, "products/umbrella-1"));
  assert.equal(rental.data().status, "returned");
  assert.equal(product.data().status, "available");
  assert.equal(product.data().activeRentalId, null);
});

test("rental history identity and schema fields cannot be changed by a student", async () => {
  const rentalId = await seedRented();
  const db = dbFor("student-a");
  const rentalRef = doc(db, `rentals/${rentalId}`);

  await assertFails(updateDoc(rentalRef, { userId: "student-b" }));
  await assertFails(updateDoc(rentalRef, { productName: "renamed" }));
  await assertFails(updateDoc(rentalRef, { extraField: "not in the schema" }));
});

test("a failed transaction leaves no rental document or inventory change", async () => {
  await assert.rejects(borrowProduct(dbFor("student-a"), "student-a", "missing-product"));

  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const product = await getDoc(doc(db, "products/umbrella-1"));
    const rentals = await getDocs(collection(db, "rentals"));
    assert.equal(product.data().status, "available");
    assert.equal(rentals.size, 0);
  });
});

