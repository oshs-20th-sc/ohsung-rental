import "./HistoryPages.css";

export default function HistoryPages({ history }) {
  const { page, hasNext, loading, previous, next } = history;
  if (page === 1 && !hasNext) return null;

  return (
    <nav className="history-pages" aria-label="대여 기록 페이지">
      <button type="button" disabled={page === 1 || loading} onClick={previous}>이전</button>
      <span aria-live="polite">{page}페이지</span>
      <button type="button" disabled={!hasNext || loading} onClick={next}>다음</button>
    </nav>
  );
}
