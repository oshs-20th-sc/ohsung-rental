export const RENTAL_PERIOD_MS = 2 * 24 * 60 * 60 * 1000;

export const RENTAL_STATUS = {
  RENTED: 0,
  PENDING: 1,
  RETURNED: 2,
  OVERDUE: 3,
};

export function rentalStatus(rental, now = Date.now()) {
  if (rental.status === "return_requested") return RENTAL_STATUS.PENDING;
  if (rental.status === "returned") return RENTAL_STATUS.RETURNED;
  return now >= rental.rentedAt + RENTAL_PERIOD_MS
    ? RENTAL_STATUS.OVERDUE
    : RENTAL_STATUS.RENTED;
}

export function serviceError(error, fallback) {
  switch (error?.code) {
    case "unauthenticated":
    case "auth/user-token-expired":
    case "auth/invalid-user-token":
      return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
    case "permission-denied":
      return "이 작업의 권한을 확인해 주세요. 반납 기한을 넘겼거나 대여 상태가 바뀐 경우에는 목록을 다시 조회해 주세요.";
    case "failed-precondition":
      return "요청의 전제 조건을 충족하지 못했습니다. 문제가 계속되면 관리자에게 문의해 주세요.";
    case "unavailable":
    case "deadline-exceeded":
    case "auth/network-request-failed":
      return "서버에 연결하지 못했습니다. 연결을 확인한 뒤 먼저 목록에서 처리 결과를 확인해 주세요.";
    case "aborted":
      return "다른 요청이 동시에 처리되었습니다. 목록에서 물품 상태를 확인해 주세요.";
    default:
      return error?.code ? fallback : error?.message || fallback;
  }
}
