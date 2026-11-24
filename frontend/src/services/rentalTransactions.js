import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";

export async function borrowProduct(db, uid, productId) {
  const productRef = doc(db, "products", productId);
  const rentalRef = doc(collection(db, "rentals"));
  const profileRef = doc(db, "users", uid);

  await runTransaction(db, async (transaction) => {
    const product = (await transaction.get(productRef)).data();
    if (!product || product.status !== "available" || product.activeRentalId !== null || product.isEnabled === false) {
      throw new Error("이미 대여되었거나 이용할 수 없는 물품입니다.");
    }

    const profile = (await transaction.get(profileRef)).data();
    if (!profile?.name) throw new Error("서비스 이용 권한이 있는 계정으로 로그인해 주세요.");

    transaction.set(rentalRef, {
      userId: uid,
      borrowerName: profile.name,
      productId,
      productName: product.name,
      displayNo: product.displayNo,
      status: "rented",
      rentedAt: serverTimestamp(),
      returnRequestedAt: null,
      returnedAt: null,
    });
    transaction.update(productRef, { status: "rented", activeRentalId: rentalRef.id });
  });

  return rentalRef.id;
}

async function transitionReturn(db, rentalId, expectedStatus, rentalUpdate, productUpdate) {
  const rentalRef = doc(db, "rentals", rentalId);

  await runTransaction(db, async (transaction) => {
    const rental = (await transaction.get(rentalRef)).data();
    if (!rental || rental.status !== expectedStatus) {
      throw new Error("대여 상태가 바뀌었습니다. 목록을 새로고침해 주세요.");
    }

    const productRef = doc(db, "products", rental.productId);
    const product = (await transaction.get(productRef)).data();
    if (!product || product.activeRentalId !== rentalId || product.status !== expectedStatus) {
      throw new Error("물품의 대여 상태가 일치하지 않습니다. 관리자에게 문의해 주세요.");
    }

    transaction.update(rentalRef, rentalUpdate);
    transaction.update(productRef, productUpdate);
  });
}

export function requestProductReturn(db, rentalId) {
  return transitionReturn(
    db, rentalId, "rented",
    { status: "return_requested", returnRequestedAt: serverTimestamp() },
    { status: "return_requested" },
  );
}

export function approveProductReturn(db, rentalId) {
  return transitionReturn(
    db, rentalId, "return_requested",
    { status: "returned", returnedAt: serverTimestamp() },
    { status: "available", activeRentalId: null },
  );
}
