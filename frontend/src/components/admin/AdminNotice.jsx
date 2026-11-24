export default function AdminNotice({ kind = "info", children, onRetry }) {
  return (
    <div className={`admin-notice admin-notice--${kind}`} role={kind === "error" ? "alert" : "status"}>
      <p>{children}</p>
      {onRetry && <button type="button" className="admin-button admin-button--quiet" onClick={onRetry}>다시 불러오기</button>}
    </div>
  );
}
