import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";
import { after, before, test } from "node:test";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc, Timestamp, writeBatch } from "firebase/firestore";
import { queryAdminRentals, queryMyRentals, queryOverdueCount } from "../src/services/rentalQueries.js";
import { queryAdminProducts } from "../src/services/productQueries.js";
import { setProductEnabled } from "../src/services/inventoryTransactions.js";
import { approveProductReturn, borrowProduct, requestProductReturn } from "../src/services/rentalTransactions.js";
import { RENTAL_PERIOD_MS } from "../src/services/rentalDates.js";

const projectId = "demo-ohsung-rental";
const now = Date.now();
const cutoff = now - RENTAL_PERIOD_MS;
const rentalIds = [];
let environment;

const studentIds = {
  "page-student": "3456789",
  "page-other": "4567890",
};
const dbFor = (uid) => {
  const studentId = studentIds[uid];
  const claims = studentId
    ? { student_id: studentId, email: `${studentId}@students.ohsung-rental.invalid` }
    : {};
  return environment.authenticatedContext(uid, claims).firestore();
};
const studentDb = () => dbFor("page-student");
const adminDb = () => environment.authenticatedContext("page-admin").firestore();
const makeRental = (userId, status, at, overrides = {}) => ({
  userId,
  borrowerName: "가상 학생",
  productId: "page-umbrella",
  productName: "가상 우산",
  displayNo: 12,
  status,
  rentedAt: Timestamp.fromMillis(at),
  returnRequestedAt: null,
  returnedAt: null,
  ...overrides,
});

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host, port: Number(port), rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  });
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, "users/page-student"), {
      name: "가상 계정",
      studentId: studentIds["page-student"],
    });
    batch.set(doc(db, "users/page-other"), {
      name: "가상 계정",
      studentId: studentIds["page-other"],
    });
    batch.set(doc(db, "users/page-admin"), { name: "가상 계정" });
    batch.set(doc(db, "roles/page-admin"), { admin: true });
    for (let n = 1; n <= 55; n++) {
      const id = `history-${String(n).padStart(2, "0")}`;
      rentalIds.push(id);
      // Identical timestamps make the document-ID tie breaker observable on all pages.
      batch.set(doc(db, "rentals", id), makeRental("page-student", "returned", now - 1234));
    }
    batch.set(doc(db, "rentals/other-rental"), makeRental("page-other", "returned", now));
    batch.set(doc(db, "rentals/page-overdue"), makeRental("page-student", "rented", cutoff));
    batch.set(doc(db, "rentals/page-ongoing"), makeRental("page-student", "rented", cutoff + 1));
    batch.set(doc(db, "rentals/page-pending"), makeRental("page-student", "return_requested", cutoff));
    batch.set(doc(db, "rentals/page-other-active"), makeRental("page-other", "rented", cutoff + 1, {
      borrowerName: "또다른 학생", productName: "가상 충전기", displayNo: 1,
    }));
    for (let n = 1; n <= 27; n++) {
      batch.set(doc(db, "products", `page-product-${n}`), {
        category: "테스트", name: "가상 기자재", displayNo: n, status: "available", activeRentalId: null,
      });
    }
    await batch.commit();
  });
});

after(async () => {
  await environment?.cleanup();
});

test("student history uses a stable cursor over 58 own records, including equal timestamps", async () => {
  const db = studentDb();
  const first = await queryMyRentals(db, "page-student");
  const second = await queryMyRentals(db, "page-student", { cursor: first.nextCursor });
  const third = await queryMyRentals(db, "page-student", { cursor: second.nextCursor });
  const observed = [...first.items, ...second.items, ...third.items].map((item) => item.id);
  assert.deepEqual(observed, [...rentalIds.reverse(), "page-ongoing", "page-pending", "page-overdue"]);
  assert.equal(third.nextCursor, null);
  const back = await queryMyRentals(db, "page-student", { cursor: first.nextCursor });
  assert.deepEqual(back.items.map((item) => item.id), second.items.map((item) => item.id));
  await assertFails(queryMyRentals(db, "page-other", { cursor: first.nextCursor }));
});

test("the active-only student query omits returned records and other owners", async () => {
  const page = await queryMyRentals(studentDb(), "page-student", { activeOnly: true });
  assert.deepEqual(page.items.map((item) => item.id), ["page-ongoing", "page-pending", "page-overdue"]);
});

test("admin filters use the same overdue boundary and exact Firestore queries", async () => {
  const db = adminDb();
  const filters = { cursor: null, status: "all", search: "", searchField: "borrowerName", now };
  const all = await queryAdminRentals(db, filters);
  assert.equal(all.items.length, 4);
  const overdue = await queryAdminRentals(db, { ...filters, status: "overdue", search: "가상 학생" });
  assert.deepEqual(overdue.items.map((item) => item.id), ["page-overdue"]);
  assert.equal(await queryOverdueCount(db, now), 1);
  const ongoing = await queryAdminRentals(db, { ...filters, status: "rented", searchField: "displayNo", search: "12" });
  assert.deepEqual(ongoing.items.map((item) => item.id), ["page-ongoing"]);
  const byProduct = await queryAdminRentals(db, { ...filters, searchField: "productName", search: "가상 충전기" });
  assert.deepEqual(byProduct.items.map((item) => item.id), ["page-other-active"]);
  await assertFails(queryAdminRentals(studentDb(), filters));
});

test("inventory pagination is sorted numerically and supports exact filters", async () => {
  const db = adminDb();
  const filters = { category: "", searchField: "name", search: "" };
  const first = await queryAdminProducts(db, filters);
  const next = await queryAdminProducts(db, { ...filters, cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...next.items].map((item) => item.get("displayNo")), Array.from({ length: 27 }, (_, i) => i + 1));
  assert.equal(next.nextCursor, null);
  const filtered = await queryAdminProducts(db, { ...filters, category: "테스트", searchField: "displayNo", search: "27" });
  assert.deepEqual(filtered.items.map((item) => item.id), ["page-product-27"]);
});

test("only an administrator can synchronize their own clock with server time", async () => {
  const db = adminDb();
  const clock = doc(db, "adminClocks/page-admin");
  await assertFails(setDoc(clock, { now: Timestamp.fromMillis(1) }));
  await assertFails(setDoc(doc(db, "adminClocks/other"), { now: serverTimestamp() }));
  await assertFails(setDoc(doc(studentDb(), "adminClocks/page-student"), { now: serverTimestamp() }));
  await setDoc(clock, { now: serverTimestamp() });
  assert((await getDocFromServer(clock)).get("now").toMillis() > 0);
});

test("simultaneous return request and deactivation preserve both changes", async () => {
  const productId = "page-product-27";
  const student = studentDb();
  const admin = adminDb();
  const rentalId = await borrowProduct(student, "page-student", productId);
  await Promise.all([
    requestProductReturn(student, rentalId),
    setProductEnabled(admin, productId, false),
  ]);
  const product = doc(admin, "products", productId);
  assert.equal((await getDocFromServer(product)).get("status"), "return_requested");
  assert.equal((await getDocFromServer(product)).get("isEnabled"), false);
  await approveProductReturn(admin, rentalId);
  assert.equal((await getDocFromServer(product)).get("isEnabled"), false);
  assert.equal((await getDocFromServer(product)).get("status"), "available");
});

test("removing an administrator role denies further inventory and queue actions", async () => {
  const admin = adminDb();
  await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), "roles/page-admin")));
  await assertFails(setProductEnabled(admin, "page-product-1", false));
  await assertFails(queryAdminRentals(admin, { status: "all", searchField: "borrowerName", search: "", now }));
  await assertFails(getDocFromServer(doc(admin, "products/page-product-1")));
  let productStatus;
  await environment.withSecurityRulesDisabled(async (context) => {
    const product = await getDocFromServer(doc(context.firestore(), "products/page-product-1"));
    productStatus = product.get("status");
  });
  assert.equal(productStatus, "available");
});
