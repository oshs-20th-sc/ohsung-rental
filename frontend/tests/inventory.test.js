import assert from "node:assert/strict";
import process from "node:process";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  approveProductReturn,
  borrowProduct,
  requestProductReturn,
} from "../src/services/rentalTransactions.js";
import {
  createMigrationPlan,
  migrateInventory,
} from "../scripts/migrate-inventory.mjs";
import {
  createProduct,
  productNumberKey,
  updateProduct,
  validateProductInput,
} from "../src/services/inventoryTransactions.js";
import { doc, getDoc, getDocs, collection, query, setDoc, where } from "firebase/firestore";

process.env.METADATA_SERVER_DETECTION ??= "none";

const projectId = "demo-ohsung-rental";
const host = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")[0];
const port = Number((process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":")[1]);
const prefix = "inventory-test-";
let environment;
let adminApp;
let adminDb;

const studentIds = {
  "student-a": "1234567",
  "student-b": "2345678",
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  });
  adminApp = initializeApp({ projectId }, "inventory-migration-tests");
  adminDb = getFirestore(adminApp);
});

after(async () => {
  await environment?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});

function dbFor(uid) {
  const studentId = studentIds[uid];
  const claims = studentId
    ? { student_id: studentId, email: `${studentId}@students.ohsung-rental.invalid` }
    : {};
  return environment.authenticatedContext(uid, claims).firestore();
}

async function seedBase() {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users/admin-a"), { name: "가상 관리자 A" }),
      setDoc(doc(db, "users/admin-b"), { name: "가상 관리자 B" }),
      setDoc(doc(db, "users/student-a"), { name: "가상 학생", studentId: studentIds["student-a"], grade: 1 }),
      setDoc(doc(db, "users/student-b"), { name: "가상 학생 B", studentId: studentIds["student-b"], grade: 2 }),
      setDoc(doc(db, "roles/admin-a"), { admin: true }),
      setDoc(doc(db, "roles/admin-b"), { admin: true }),
      setDoc(doc(db, "inventorySettings/v1"), { ready: true }),
    ]);
  });
}

function productRow(id, data) {
  return { id, data: { ...data } };
}

const migrationProduct = (id, overrides = {}) => productRow(id, {
  category: "우산",
  name: "양심우산",
  displayNo: 12,
  status: "available",
  activeRentalId: null,
  ...overrides,
});

test("inventory migration preserves IDs and statuses and plans safe backfills", () => {
  const rows = [
    migrationProduct("numeric-legacy-id", { isEnabled: false }),
    migrationProduct("active-legacy-id", {
      displayNo: 13,
      status: "rented",
      activeRentalId: "active-rental",
    }),
  ];
  const plan = createMigrationPlan(
    rows,
    [],
    [{ id: "active-rental", data: {
      userId: "student-a",
      productId: "active-legacy-id",
      status: "rented",
      productName: "양심우산",
      displayNo: 13,
    } }],
    null,
    [{ id: "student-a", data: { name: "가상 학생" } }],
  );

  assert.deepEqual(plan.enabledBackfills, ["active-legacy-id"]);
  assert.deepEqual(plan.borrowerNameBackfills, [{ rentalId: "active-rental", name: "가상 학생" }]);
  assert.deepEqual(plan.newReservations, [
    { key: "우산|12", productId: "numeric-legacy-id" },
    { key: "우산|13", productId: "active-legacy-id" },
  ]);
  assert.equal(rows[0].data.isEnabled, false);
  assert.equal(rows[1].data.status, "rented");
  assert.deepEqual(plan.enabledBackfills, ["active-legacy-id"]);
});

test("inventory migration refuses duplicate category numbers before it plans writes", () => {
  assert.throws(() => createMigrationPlan(
    [migrationProduct("product-a"), migrationProduct("product-b")],
    [],
    [],
    null,
  ), /중복된 물품 번호/);
});

test("inventory migration refuses invalid product fields and IDs", () => {
  assert.throws(() => createMigrationPlan(
    [migrationProduct("bad/id")], [], [], null,
  ), /문서 ID/);
  assert.throws(() => createMigrationPlan(
    [migrationProduct("bad-number", { displayNo: 0 })], [], [], null,
  ), /새 보안 규칙/);
  assert.throws(() => createMigrationPlan(
    [migrationProduct("bad-category", { category: "우산|hidden" })], [], [], null,
  ), /새 보안 규칙/);
});

test("inventory migration refuses stale number indexes or active rental references", () => {
  assert.throws(() => createMigrationPlan(
    [migrationProduct("product-a")],
    [{ id: "우산|12", data: { productId: "another-product" } }],
    [],
    null,
  ), /예약 문서가 물품과 일치하지 않습니다/);
  assert.throws(() => createMigrationPlan(
    [migrationProduct("active-product", { status: "rented", activeRentalId: "missing-rental" })],
    [],
    [],
    null,
  ), /대여 기록의 연결 또는 상태가 일치하지 않습니다/);
});

test("inventory marker is accepted only when all indexes and compatibility fields are complete", () => {
  const product = migrationProduct("ready-product", { isEnabled: true });
  const reservation = { id: "우산|12", data: { productId: "ready-product" } };
  const complete = createMigrationPlan([product], [reservation], [], { id: "v1", data: { ready: true } });
  assert.equal(complete.alreadyReady, true);
  assert.deepEqual(complete.newReservations, []);

  assert.throws(() => createMigrationPlan(
    [product], [], [], { id: "v1", data: { ready: true } },
  ), /불일치/);
  assert.throws(() => createMigrationPlan(
    [migrationProduct("legacy-ready")], [{ ...reservation }], [], { id: "v1", data: { ready: true } },
  ), /일치하지 않습니다/);
});

test("legacy active rentals without a member profile remain usable without a name index", () => {
  const plan = createMigrationPlan(
    [migrationProduct("active-product", { status: "return_requested", activeRentalId: "pending-rental" })],
    [],
    [{ id: "pending-rental", data: {
      userId: "removed-student",
      productId: "active-product",
      status: "return_requested",
    } }],
    null,
    [],
  );

  assert.deepEqual(plan.borrowerNameBackfills, []);
  assert.deepEqual(plan.newReservations, [{ key: "우산|12", productId: "active-product" }]);
});

test("admins can add uniquely numbered products while students cannot write inventory", async () => {
  await seedBase();
  const adminA = dbFor("admin-a");
  const adminB = dbFor("admin-b");
  const fields = { category: "케이블", name: "HDMI", displayNo: 5, isEnabled: true };
  const results = await Promise.allSettled([
    createProduct(adminA, fields),
    createProduct(adminB, fields),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const key = productNumberKey(fields.category, fields.displayNo);
  const reservation = await getDoc(doc(adminA, "productNumbers", key));
  assert.equal(reservation.exists(), true);
  const created = await getDoc(doc(adminA, "products", reservation.data().productId));
  assert.deepEqual(created.data(), {
    ...fields,
    status: "available",
    activeRentalId: null,
  });

  await assertFails(createProduct(dbFor("student-a"), {
    category: "케이블", name: "충전 케이블", displayNo: 6, isEnabled: true,
  }));
});

test("concurrent borrowers cannot rent the same available product", async () => {
  await seedBase();
  const admin = dbFor("admin-a");
  const productId = await createProduct(admin, {
    category: "우산", name: "양심우산", displayNo: 41, isEnabled: true,
  });

  const results = await Promise.allSettled([
    borrowProduct(dbFor("student-a"), "student-a", productId),
    borrowProduct(dbFor("student-b"), "student-b", productId),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const product = await getDoc(doc(admin, "products", productId));
  assert.equal(product.data().status, "rented");
  assert.equal(typeof product.data().activeRentalId, "string");
});

test("a simultaneous deactivation and borrow has one consistent outcome", async () => {
  await seedBase();
  const admin = dbFor("admin-a");
  const productId = await createProduct(admin, {
    category: "우산", name: "양심우산", displayNo: 42, isEnabled: true,
  });

  const results = await Promise.allSettled([
    updateProduct(admin, productId, {
      category: "우산", name: "양심우산", displayNo: 42, isEnabled: false,
    }),
    borrowProduct(dbFor("student-a"), "student-a", productId),
  ]);

  assert.ok(results.some((result) => result.status === "fulfilled"));
  const product = await getDoc(doc(admin, "products", productId));
  const finalData = product.data();
  if (finalData.status === "available") {
    assert.equal(finalData.isEnabled, false);
    assert.equal(results[1].status, "rejected");
  } else {
    assert.equal(finalData.status, "rented");
    assert.equal(typeof finalData.activeRentalId, "string");
    assert.equal(results[1].status, "fulfilled");
  }
});

test("only one concurrent approval can complete a return", async () => {
  await seedBase();
  const admin = dbFor("admin-a");
  const student = dbFor("student-a");
  const productId = await createProduct(admin, {
    category: "우산", name: "양심우산", displayNo: 43, isEnabled: true,
  });
  const rentalId = await borrowProduct(student, "student-a", productId);
  await requestProductReturn(student, rentalId);

  const results = await Promise.allSettled([
    approveProductReturn(admin, rentalId),
    approveProductReturn(admin, rentalId),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await getDoc(doc(admin, "rentals", rentalId))).data().status, "returned");
  const product = await getDoc(doc(admin, "products", productId));
  assert.equal(product.data().status, "available");
  assert.equal(product.data().activeRentalId, null);
});

test("removing a member profile revokes borrowing access immediately", async () => {
  await seedBase();
  const admin = dbFor("admin-a");
  const productId = await createProduct(admin, {
    category: "우산", name: "양심우산", displayNo: 44, isEnabled: true,
  });
  await adminDb.doc("users/student-a").delete();

  await assert.rejects(borrowProduct(dbFor("student-a"), "student-a", productId));
  assert.equal((await getDoc(doc(admin, "products", productId))).data().status, "available");
  const forProduct = query(collection(admin, "rentals"), where("productId", "==", productId));
  assert.equal((await getDocs(forProduct)).size, 0);
});

test("available product metadata edits move the unique number reservation", async () => {
  await seedBase();
  const db = dbFor("admin-a");
  const productId = await createProduct(db, {
    category: "우산", name: "양심우산", displayNo: 12, isEnabled: true,
  });
  const beforeKey = productNumberKey("우산", 12);
  const afterKey = productNumberKey("비상 우산", 3);
  await updateProduct(db, productId, {
    category: "비상 우산", name: "양심우산", displayNo: 3, isEnabled: true,
  });

  assert.equal((await getDoc(doc(db, "productNumbers", beforeKey))).exists(), false);
  assert.equal((await getDoc(doc(db, "productNumbers", afterKey))).data().productId, productId);
  assert.equal((await getDoc(doc(db, "products", productId))).data().category, "비상 우산");
});

test("disabled items cannot be borrowed but remain returnable and historical snapshots stay intact", async () => {
  await seedBase();
  const admin = dbFor("admin-a");
  const student = dbFor("student-a");
  const productId = await createProduct(admin, {
    category: "우산", name: "초기 이름", displayNo: 24, isEnabled: true,
  });
  const rentalId = await borrowProduct(student, "student-a", productId);
  await assertFails(updateProduct(admin, productId, {
    category: "우산", name: "변경 이름", displayNo: 24, isEnabled: false,
  }));
  await updateProduct(admin, productId, {
    category: "우산", name: "초기 이름", displayNo: 24, isEnabled: false,
  });
  await assert.rejects(borrowProduct(dbFor("student-a"), "student-a", productId));
  await requestProductReturn(student, rentalId);
  await approveProductReturn(admin, rentalId);

  const rental = await getDoc(doc(admin, "rentals", rentalId));
  const product = await getDoc(doc(admin, "products", productId));
  assert.equal(rental.data().productName, "초기 이름");
  assert.equal(rental.data().borrowerName, "가상 학생");
  assert.equal(product.data().status, "available");
  assert.equal(product.data().activeRentalId, null);
  assert.equal(product.data().isEnabled, false);
  await assert.rejects(borrowProduct(student, "student-a", productId));
  await assertFails(updateProduct(student, productId, {
    category: "우산", name: "학생 수정", displayNo: 24, isEnabled: true,
  }));
});

test("inventory migration validates first, backfills indexes, and enables inventory last", async () => {
  await seedBase();
  const legacyId = `${prefix}legacy`;
  const activeRentalId = `${prefix}rental`;
  await adminDb.doc(`products/${legacyId}`).set({
    category: "미니 우산",
    name: "가상 레거시 우산",
    displayNo: 9,
    status: "rented",
    activeRentalId: activeRentalId,
  });
  await adminDb.doc(`rentals/${activeRentalId}`).set({
    userId: "admin-a",
    productId: legacyId,
    productName: "가상 레거시 우산",
    displayNo: 9,
    status: "rented",
    rentedAt: new Date(Date.now() - 60_000),
    returnRequestedAt: null,
    returnedAt: null,
  });
  await adminDb.doc("inventorySettings/v1").set({ ready: false });

  const preview = await migrateInventory(adminDb);
  assert.equal(preview.applied, false);
  assert.equal(preview.newReservations.some((row) => row.productId === legacyId), true);
  assert.equal((await adminDb.doc(`products/${legacyId}`).get()).get("isEnabled"), undefined);
  assert.equal((await adminDb.doc("inventorySettings/v1").get()).get("ready"), false);

  const result = await migrateInventory(adminDb, { apply: true });
  assert.equal(result.applied, true);
  assert.equal((await adminDb.doc(`products/${legacyId}`).get()).get("isEnabled"), true);
  assert.equal((await adminDb.doc(`rentals/${activeRentalId}`).get()).get("borrowerName"), "가상 관리자 A");
  assert.equal((await adminDb.doc(`productNumbers/${productNumberKey("미니 우산", 9)}`).get()).get("productId"), legacyId);
  assert.equal((await adminDb.doc("inventorySettings/v1").get()).get("ready"), true);
  const verified = await migrateInventory(adminDb, { apply: true });
  assert.equal(verified.alreadyReady, true);
  assert.equal(verified.applied, false);
});

test("invalid inventory aborts migration without marker, reservation, or product writes", async () => {
  await seedBase();
  const firstId = `${prefix}same-a`;
  const secondId = `${prefix}same-b`;
  await adminDb.doc(`products/${firstId}`).set({
    category: "중복 검증",
    name: "가상 물품 A",
    displayNo: 1,
    status: "available",
    activeRentalId: null,
  });
  await adminDb.doc(`products/${secondId}`).set({
    category: "중복 검증",
    name: "가상 물품 B",
    displayNo: 1,
    status: "available",
    activeRentalId: null,
  });
  await adminDb.doc("inventorySettings/v1").delete();

  await assert.rejects(migrateInventory(adminDb, { apply: true }), /중복된 물품 번호/);
  assert.equal((await adminDb.doc(`products/${firstId}`).get()).get("isEnabled"), undefined);
  assert.equal((await adminDb.doc(`products/${secondId}`).get()).get("isEnabled"), undefined);
  assert.equal((await adminDb.doc("productNumbers/중복 검증|1").get()).exists, false);
  assert.equal((await adminDb.doc("inventorySettings/v1").get()).exists, false);
});
