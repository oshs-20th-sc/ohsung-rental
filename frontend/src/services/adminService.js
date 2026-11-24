import { doc, getDocFromServer, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { auth, db, isDemo } from "../firebase/client.js";
import { demoAccounts, demoAdmin, demoProducts, demoRentals } from "./demoData.js";
import { memoryPage } from "./firestorePages.js";
import { countProducts } from "./productQueries.js";
import { getInventoryReady } from "./productService.js";
import { RENTAL_PERIOD_MS, rentalStatus } from "./rentalDates.js";
import { compareRentalCursor, queryAdminRentals, queryOverdueCount, rentalMatchesActiveStatus, rentalSearchValue } from "./rentalQueries.js";
import { fromRentalDoc, requestReturn } from "./rentalService.js";
import { approveProductReturn } from "./rentalTransactions.js";

const dateParts = new Intl.DateTimeFormat("en", { year: "numeric", month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });
function toDateParts(time) {
  const parts = dateParts.formatToParts(time);
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return [read("year"), read("month"), read("day")];
}

const clockRequests = new Map();
export async function getAdminTime() {
  if (isDemo) {
    demoAdmin();
    return Date.now();
  }
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("다시 로그인해 주세요.");
  if (!clockRequests.has(uid)) {
    const reference = doc(db, "adminClocks", uid);
    const request = (async () => {
      await runTransaction(db, async (transaction) => {
        transaction.set(reference, { now: serverTimestamp() });
      });
      const clock = await getDocFromServer(reference);
      return clock.get("now").toMillis();
    })().finally(() => clockRequests.delete(uid));
    clockRequests.set(uid, request);
  }
  return clockRequests.get(uid);
}

let cacheOwner;
const legacyNames = new Map();
function readLegacyName(uid) {
  const operator = auth.currentUser?.uid;
  if (cacheOwner !== operator) {
    cacheOwner = operator;
    legacyNames.clear();
  }
  if (!legacyNames.has(uid)) {
    if (legacyNames.size >= 100) legacyNames.delete(legacyNames.keys().next().value);
    // Only old records lack the verified name snapshot.
    const request = getDocFromServer(doc(db, "users", uid)).then((profile) => profile.data()?.name)
      .catch((error) => {
        if (legacyNames.get(uid) === request) legacyNames.delete(uid);
        throw error;
      });
    legacyNames.set(uid, request);
  }
  return legacyNames.get(uid);
}

export async function listAdminRentals({
  cursor = null, status = "all", searchField = "borrowerName", search = "", now,
} = {}) {
  const asOf = now ?? await getAdminTime();
  let page;
  if (isDemo) {
    demoAdmin();
    const value = rentalSearchValue(searchField, search);
    const members = new Map(Object.values(demoAccounts).map((member) => [member.id, member.name]));
    const matching = demoRentals.map((item) => ({ ...item, borrowerName: item.borrowerName ?? members.get(item.userId) }))
      .filter((item) => rentalMatchesActiveStatus(item, status, asOf) && (value === "" || item[searchField] === value));
    page = memoryPage(matching, cursor, compareRentalCursor, (item) => [item.rentedAt, item.id]);
  } else {
    const result = await queryAdminRentals(db, { cursor, status, searchField, search, now: asOf });
    page = { ...result, items: result.items.map(fromRentalDoc) };
  }
  const items = await Promise.all(page.items.map(async (rental) => ({
    id: rental.id,
    product_id: rental.productId,
    product_name: rental.productName,
    display_no: rental.displayNo,
    name: rental.borrowerName || (!isDemo && await readLegacyName(rental.userId)) || "등록 해제된 계정",
    status: rentalStatus(rental, asOf),
    date: toDateParts(rental.rentedAt),
    deadline: toDateParts(rental.rentedAt + RENTAL_PERIOD_MS),
  })));
  return { ...page, items };
}

export async function getAdminSummary({ category = "", now } = {}) {
  const asOf = now ?? await getAdminTime();
  const selectedCategory = category.trim();
  if (isDemo) {
    demoAdmin();
    const products = demoProducts.filter((product) => !selectedCategory || product.category === selectedCategory);
    return {
      total: products.length,
      available: products.filter((p) => p.status === "available" && p.isEnabled !== false).length,
      rented: products.filter((p) => p.status === "rented").length,
      pending: products.filter((p) => p.status === "return_requested").length,
      overdue: selectedCategory ? null : demoRentals.filter((rental) => rentalMatchesActiveStatus(rental, "overdue", asOf)).length,
      asOf,
    };
  }

  const filters = selectedCategory ? [where("category", "==", selectedCategory)] : [];
  const availableFilter = [...filters, where("status", "==", "available")];
  const ready = await getInventoryReady();
  const availableCount = ready
    ? countProducts(db, [...availableFilter, where("isEnabled", "==", true)])
    : Promise.all([
      countProducts(db, availableFilter),
      countProducts(db, [...availableFilter, where("isEnabled", "==", false)]),
    ]).then(([statusCount, disabled]) => {
      if (disabled > statusCount) throw new Error("집계 중 재고가 변경되었습니다. 다시 조회해 주세요.");
      return statusCount - disabled;
    });
  const [total, available, rented, pending, overdue] = await Promise.all([
    countProducts(db, filters),
    availableCount,
    countProducts(db, [...filters, where("status", "==", "rented")]),
    countProducts(db, [...filters, where("status", "==", "return_requested")]),
    selectedCategory ? null : queryOverdueCount(db, asOf),
  ]);
  return { total, available, rented, pending, overdue, asOf };
}

export async function markReturnPending(rentalId) {
  if (isDemo) demoAdmin();
  return requestReturn(rentalId);
}

export async function approveReturn(rentalId) {
  if (!isDemo) return approveProductReturn(db, rentalId);

  demoAdmin();
  const rental = demoRentals.find((item) => item.id === rentalId);
  if (rental?.status !== "return_requested") throw new Error("승인 대기 중인 대여를 선택해 주세요.");
  const product = demoProducts.find((item) => item.activeRentalId === rentalId);
  Object.assign(rental, { status: "returned", returnedAt: Date.now() });
  Object.assign(product, { status: "available", activeRentalId: null });
}
