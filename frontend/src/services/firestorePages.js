import { getDocsFromServer, limit, query, startAfter } from "firebase/firestore";

export const PAGE_SIZE = 20;

export async function firestorePage(reference, constraints, cursor) {
  const after = cursor ? [startAfter(...cursor)] : [];
  const snapshot = await getDocsFromServer(
    query(reference, ...constraints, ...after, limit(PAGE_SIZE + 1)),
  );
  return {
    items: snapshot.docs.slice(0, PAGE_SIZE),
    hasNext: snapshot.size > PAGE_SIZE,
  };
}

// Match Firestore's byte ordering, including Hangul and supplementary Unicode.
const encoder = new TextEncoder();
export function compareText(left, right) {
  if (left === right) return 0;
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function memoryPage(rows, cursor, compare, getCursor) {
  const sorted = [...rows].sort((a, b) => compare(getCursor(a), getCursor(b)));
  const page = sorted.filter((row) => !cursor || compare(getCursor(row), cursor) > 0).slice(0, PAGE_SIZE + 1);
  const items = page.slice(0, PAGE_SIZE);
  return { items, nextCursor: page.length > PAGE_SIZE ? getCursor(items.at(-1)) : null };
}

export function displayNumber(value) {
  if (!/^\d+$/.test(String(value))) throw new Error("물품 번호는 1~9999 사이의 정수로 입력해 주세요.");
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 9999) {
    throw new Error("물품 번호는 1~9999 사이의 정수로 입력해 주세요.");
  }
  return number;
}
