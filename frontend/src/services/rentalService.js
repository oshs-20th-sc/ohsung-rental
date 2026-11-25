import { where } from "firebase/firestore";
import { auth, isDemo } from "../firebase/client.js";
import { db } from "../firebase/firestoreClient.js";
import { demoMember, demoProducts, demoRentals } from "./demoData.js";
import { RENTAL_PERIOD_MS, rentalStatus } from "./rentalDates.js";
import { memoryPage } from "./firestorePages.js";
import { compareRentalCursor, countRentals, queryMyRentals } from "./rentalQueries.js";
import { borrowProduct, requestProductReturn } from "./rentalTransactions.js";

const statusLabels = ["대여 중", "반납 신청", "반납 완료", "연체"];

export function readRental(rental, now) {
  const statusCode = rentalStatus(rental, now);
  return {
    rental_id: rental.id,
    product_id: rental.productId,
    product_name: rental.productName,
    display_no: rental.displayNo,
    status: statusLabels[statusCode],
    status_code: statusCode,
    rental_time: rental.rentedAt,
    return_time: rental.returnedAt,
    expected_return_time: rental.rentedAt + RENTAL_PERIOD_MS,
  };
}

export function fromRentalDoc(snapshot) {
  const rental = snapshot.data();
  return {
    ...rental,
    id: snapshot.id,
    rentedAt: rental.rentedAt.toMillis(),
    returnedAt: rental.returnedAt?.toMillis() ?? null,
  };
}

const memberId = () => {
  const uid = isDemo ? demoMember().id : auth.currentUser?.uid;
  if (!uid) throw new Error("로그인이 필요합니다.");
  return uid;
};

export async function listMyRentals({ cursor = null, activeOnly = false } = {}) {
  const uid = memberId();
  const page = isDemo
    ? memoryPage(
      demoRentals.filter((rental) => rental.userId === uid && (!activeOnly || rental.status !== "returned")),
      cursor, compareRentalCursor, (rental) => [rental.rentedAt, rental.id],
    )
    : await queryMyRentals(db, uid, { cursor, activeOnly });
  return {
    items: page.items.map((item) => readRental(isDemo ? item : fromRentalDoc(item))),
    nextCursor: page.nextCursor,
  };
}

export async function getMyRentalCounts() {
  const uid = memberId();
  const statuses = ["rented", "return_requested", "returned"];
  const counts = isDemo
    ? statuses.map((status) => demoRentals.filter((rental) => rental.userId === uid && rental.status === status).length)
    : await Promise.all(statuses.map((status) => countRentals(db, [where("userId", "==", uid), where("status", "==", status)])));
  return { active: counts[0], pending: counts[1], completed: counts[2] };
}

export async function rent(productId) {
  if (!isDemo) {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error("로그인이 필요합니다.");
    return borrowProduct(db, uid, productId);
  }

  const { id, name } = demoMember();
  const product = demoProducts.find((item) => item.id === productId);
  if (product?.status !== "available" || product.isEnabled === false) throw new Error("이미 대여되었거나 이용할 수 없는 물품입니다.");
  const rentalId = crypto.randomUUID();
  demoRentals.push({
    id: rentalId,
    userId: id,
    borrowerName: name,
    productId,
    productName: product.name,
    displayNo: product.displayNo,
    status: "rented",
    rentedAt: Date.now(),
    returnRequestedAt: null,
    returnedAt: null,
  });
  Object.assign(product, { status: "rented", activeRentalId: rentalId });
  return rentalId;
}

export async function requestReturn(rentalId) {
  if (!isDemo) return requestProductReturn(db, rentalId);

  const member = demoMember();
  const rental = demoRentals.find((item) => item.id === rentalId);
  const overdue = rental && Date.now() >= rental.rentedAt + RENTAL_PERIOD_MS;
  if (rental?.status !== "rented" || !(member.isAdmin || (!overdue && rental.userId === member.id))) {
    throw new Error("해당 대여의 반납을 신청할 수 없습니다.");
  }

  const product = demoProducts.find((item) => item.activeRentalId === rentalId);
  Object.assign(rental, { status: "return_requested", returnRequestedAt: Date.now() });
  product.status = "return_requested";
}
