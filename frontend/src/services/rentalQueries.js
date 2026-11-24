import { collection, documentId, getCountFromServer, orderBy, query, Timestamp, where } from "firebase/firestore";
import { compareText, displayNumber, firestorePage } from "./firestorePages.js";
import { RENTAL_PERIOD_MS } from "./rentalDates.js";

const activeStatuses = ["rented", "return_requested"];
const newestFirst = [orderBy("rentedAt", "desc"), orderBy(documentId(), "desc")];

export function compareRentalCursor(a, b) {
  return b[0] - a[0] || compareText(b[1], a[1]);
}

export function rentalMatchesActiveStatus(rental, status, now) {
  if (status === "all") return activeStatuses.includes(rental.status);
  if (status === "return_requested") return rental.status === status;
  return rental.status === "rented" &&
    ((rental.rentedAt + RENTAL_PERIOD_MS <= now) === (status === "overdue"));
}

function activeConstraints(status, now) {
  if (status === "all") return [where("status", "in", activeStatuses)];
  if (status === "return_requested") return [where("status", "==", status)];
  return [
    where("status", "==", "rented"),
    where("rentedAt", status === "overdue" ? "<=" : ">", Timestamp.fromMillis(now - RENTAL_PERIOD_MS)),
  ];
}

export function rentalSearchValue(searchField, search) {
  if (!["borrowerName", "productName", "displayNo"].includes(searchField)) {
    throw new Error("검색 항목을 다시 선택해 주세요.");
  }
  const value = search.trim();
  return value && searchField === "displayNo" ? displayNumber(value) : value;
}

async function readPage(db, constraints, cursor) {
  const page = await firestorePage(collection(db, "rentals"), [...constraints, ...newestFirst], cursor);
  const last = page.items.at(-1);
  return {
    items: page.items,
    nextCursor: page.hasNext ? [last.get("rentedAt"), last.id] : null,
  };
}

export function queryMyRentals(db, uid, { cursor = null, activeOnly = false } = {}) {
  const filters = [where("userId", "==", uid)];
  if (activeOnly) filters.push(where("status", "in", activeStatuses));
  return readPage(db, filters, cursor);
}

export function queryAdminRentals(db, { cursor = null, status, searchField, search, now }) {
  const constraints = activeConstraints(status, now);
  const value = rentalSearchValue(searchField, search);
  if (value !== "") constraints.push(where(searchField, "==", value));
  return readPage(db, constraints, cursor);
}

export async function countRentals(db, filters) {
  const stats = await getCountFromServer(query(collection(db, "rentals"), ...filters));
  return stats.data().count;
}

export function queryOverdueCount(db, now) {
  return countRentals(db, activeConstraints("overdue", now));
}
