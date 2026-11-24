const statusLabels = {
  rented: "대여 중",
  return_requested: "승인 대기",
  available: "대여 가능",
  returned: "반납 완료",
  overdue: "연체",
};

export default function StatusBadge({ status, isEnabled = true }) {
  const label = !isEnabled ? "사용 중지" : statusLabels[status] ?? "상태 확인 필요";
  const tone = !isEnabled ? "disabled" : status === "return_requested" ? "pending"
    : status === "overdue" ? "overdue" : status === "available" ? "available" : "rented";
  return <span className={`admin-status admin-status--${tone}`}>{label}</span>;
}
