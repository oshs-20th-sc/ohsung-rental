export default function CursorControls({ page, hasNext, loading, onPrevious, onNext }) {
  return (
    <nav className="admin-pagination" aria-label="목록 페이지 이동">
      <button type="button" className="admin-button admin-button--quiet" onClick={onPrevious} disabled={loading || page <= 1}>
        이전
      </button>
      <span aria-live="polite">{page}페이지</span>
      <button type="button" className="admin-button admin-button--quiet" onClick={onNext} disabled={loading || !hasNext}>
        다음
      </button>
    </nav>
  );
}
