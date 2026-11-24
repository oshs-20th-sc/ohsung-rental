import { RENTAL_PERIOD_MS } from "./rentalDates.js";
import { studentAuthEmail } from "./studentIdentity.js";

// A preview session exists only in this page's memory.
export const demoStudentId = "2610710";
export const demoAdminEmail = "admin@example.test";
const demoStudentEmail = studentAuthEmail(demoStudentId);
export const demoAccounts = {
  [demoStudentEmail]: { id: "demo-student", studentId: demoStudentId, name: "가상 학생", isAdmin: false },
  [demoAdminEmail]: { id: "demo-admin", name: "가상 관리자", isAdmin: true },
};

export const demoPassword = "demo-only-123";
export const demoProducts = [
  { id: "umbrella-01", category: "우산", name: "가상 우산", displayNo: 1, status: "available", activeRentalId: null },
  { id: "umbrella-02", category: "우산", name: "가상 우산", displayNo: 2, status: "rented", activeRentalId: "demo-overdue" },
  { id: "charger-01", category: "충전기", name: "가상 충전기", displayNo: 1, status: "available", activeRentalId: null },
];

export const demoRentals = [{
  id: "demo-overdue",
  userId: demoAccounts[demoStudentEmail].id,
  productId: "umbrella-02",
  productName: "가상 우산",
  displayNo: 2,
  status: "rented",
  rentedAt: Date.now() - RENTAL_PERIOD_MS - 60 * 60 * 1000,
  returnRequestedAt: null,
  returnedAt: null,
}];

export function demoAdmin() {
  const user = demoMember();
  if (!user.isAdmin) throw new Error("관리자 권한이 필요합니다.");
  return user;
}

export const demoSession = { user: null, listeners: new Set() };

export function setDemoUser(user) {
  demoSession.user = user;
  for (const listener of demoSession.listeners) listener(user);
}

export function demoMember() {
  if (!demoSession.user) throw new Error("로그인이 필요합니다.");
  return demoSession.user;
}

if (import.meta.env?.MODE === "demo") {
  for (let number = 1; number <= 22; number++) {
    const id = `demo-cable-${number}`;
    const activeRentalId = number <= 21 ? `demo-cable-rental-${number}` : null;
    demoProducts.push({
      id, category: "케이블", name: "가상 케이블", displayNo: number,
      status: activeRentalId ? "rented" : "available", activeRentalId, isEnabled: true,
    });
    if (activeRentalId) {
      demoRentals.push({
        id: activeRentalId, userId: "demo-secondary", borrowerName: "가상 시연 학생",
        productId: id, productName: "가상 케이블", displayNo: number, status: "rented",
        rentedAt: Date.now() - number * 60000, returnRequestedAt: null, returnedAt: null,
      });
    }
  }
  for (let number = 1; number <= 45; number++) {
    const rentedAt = Date.now() - (number + 5) * 86400000;
    demoRentals.push({
      id: `demo-history-${number}`, userId: "demo-student", borrowerName: "가상 학생",
      productId: "umbrella-01", productName: "가상 우산", displayNo: 1, status: "returned",
      rentedAt, returnRequestedAt: rentedAt + 3600000, returnedAt: rentedAt + 7200000,
    });
  }
}
