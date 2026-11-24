import { collection, documentId, getCountFromServer, orderBy, query, where } from "firebase/firestore";
import { compareText, displayNumber, firestorePage } from "./firestorePages.js";

export function productSearchValue(field, search) {
  if (!["name", "displayNo"].includes(field)) throw new Error("검색 항목을 다시 선택해 주세요.");
  const value = search.trim();
  return value && field === "displayNo" ? displayNumber(value) : value;
}

export function productCursor(fields, id, category, numberSearch) {
  return [
    ...(category ? [] : [fields.category]),
    ...(numberSearch ? [] : [fields.displayNo]),
    id,
  ];
}

export function compareProductCursor(a, b) {
  for (let i = 0; i < a.length; i++) {
    const order = typeof a[i] === "number" ? a[i] - b[i] : compareText(a[i], b[i]);
    if (order !== 0) return order;
  }
  return 0;
}

export async function queryAdminProducts(db, { cursor = null, category, searchField, search }) {
  const value = productSearchValue(searchField, search);
  const numberSearch = value !== "" && searchField === "displayNo";
  const filters = category ? [where("category", "==", category)] : [];
  if (value !== "") filters.push(where(searchField, "==", value));
  if (!category) filters.push(orderBy("category"));
  if (!numberSearch) filters.push(orderBy("displayNo"));
  filters.push(orderBy(documentId()));

  const page = await firestorePage(collection(db, "products"), filters, cursor);
  const last = page.items.at(-1);
  return {
    items: page.items,
    nextCursor: page.hasNext ? productCursor(last.data(), last.id, category, numberSearch) : null,
  };
}

export async function countProducts(db, filters) {
  const snapshot = await getCountFromServer(query(collection(db, "products"), ...filters));
  return snapshot.data().count;
}
