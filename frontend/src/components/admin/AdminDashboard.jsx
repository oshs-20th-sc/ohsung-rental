import { useEffect, useState } from "react";
import { getAdminSummary, getAdminTime } from "../../services/adminService.js";
import { listAdminProducts } from "../../services/productService.js";
import { serviceError } from "../../services/rentalDates.js";
import AdminNotice from "./AdminNotice.jsx";

const globalMetrics = [
  ["total", "등록 물품", "모든 분류의 등록 재고"],
  ["available", "대여 가능", "현재 대여할 수 있는 물품"],
  ["rented", "대여 중", "현재 사용 중인 물품"],
  ["pending", "승인 대기", "관리자 확인이 필요한 반납"],
  ["overdue", "연체", "기준 시각을 넘긴 대여"],
];

const categoryMetrics = [
  ["total", "등록 물품"],
  ["available", "대여 가능"],
  ["rented", "대여 중"],
  ["pending", "승인 대기"],
];

const formatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function MetricCard({ label, value, detail, tone }) {
  return (
    <article className={`admin-metric admin-metric--${tone}`}>
      <span>{label}</span>
      <strong>{Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—"}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function AdminDashboard() {
  const [categoryDraft, setCategoryDraft] = useState("");
  const [category, setCategory] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [categoryHints, setCategoryHints] = useState([]);

  useEffect(() => {
    let active = true;
    listAdminProducts({}).then(({ items = [] }) => {
      if (active) setCategoryHints([...new Set(items.map((product) => product.category).filter(Boolean))].slice(0, 20));
    }).catch(() => {
      // The summary remains useful if category suggestions cannot be loaded.
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const now = await getAdminTime();
        const current = await getAdminSummary({ category, now });
        if (!current || !Number.isFinite(current.total) || !Number.isFinite(current.available) ||
            !Number.isFinite(current.rented) || !Number.isFinite(current.pending) ||
            (!category && !Number.isFinite(current.overdue))) {
          throw new Error("집계 값을 확인할 수 없습니다.");
        }
        if (active) setSummary(current);
      } catch (loadError) {
        if (active) {
          setSummary(null);
          setError(serviceError(loadError, "운영 현황을 불러오지 못했습니다. 다시 시도해 주세요."));
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [category, revision]);

  const applyCategory = (event) => {
    event.preventDefault();
    setCategory(categoryDraft.trim());
  };

  const refreshedAt = summary?.asOf ? formatter.format(summary.asOf) : "";
  return (
    <div className="admin-section">
      <div className="admin-section__heading">
        <div>
          <h2>운영 요약</h2>
          <p>Firestore에 저장된 실제 재고와 기준 시각으로 집계합니다.</p>
        </div>
        <button type="button" className="admin-button admin-button--quiet" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
          {loading ? "갱신 중..." : "새로고침"}
        </button>
      </div>

      <form className="admin-filters admin-filters--summary" onSubmit={applyCategory}>
        <label className="admin-field admin-field--search">
          <span>분류 재고 확인</span>
          <input value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} maxLength={80} placeholder="분류를 정확히 입력" list="admin-summary-category-hints" />
          <datalist id="admin-summary-category-hints">
            {categoryHints.map((categoryName) => <option key={categoryName} value={categoryName} />)}
          </datalist>
        </label>
        <button className="admin-button admin-button--primary" type="submit">분류 적용</button>
        {category && <button type="button" className="admin-button admin-button--quiet" onClick={() => { setCategoryDraft(""); setCategory(""); }}>전체로 돌아가기</button>}
      </form>
      <p className="admin-summary-note">분류 제안은 물품 첫 페이지에서 가져옵니다. 다른 분류는 물품 관리 탭에서 확인한 뒤 정확한 이름으로 조회할 수 있습니다.</p>

      {error && <AdminNotice kind="error" onRetry={() => setRevision((value) => value + 1)}>{error}</AdminNotice>}
      {loading ? <AdminNotice>운영 현황을 집계하는 중입니다...</AdminNotice> : null}
      {!loading && !error && summary && (
        <>
          <section className="admin-summary-group" aria-labelledby="admin-summary-heading">
            <div className="admin-summary-group__heading">
              <h3 id="admin-summary-heading">{category ? `${category} 분류` : "전체 재고"}</h3>
              {refreshedAt && <span>기준 시각 · {refreshedAt}</span>}
            </div>
            <div className={`admin-metrics${category ? " admin-metrics--category" : ""}`}>
              {(category ? categoryMetrics : globalMetrics).map(([field, label, detail], index) => (
                <MetricCard
                  key={field}
                  label={label}
                  value={summary[field]}
                  detail={category ? "선택한 분류의 실제 재고" : detail}
                  tone={["blue", "green", "violet", "amber", "red"][index]}
                />
              ))}
            </div>
          </section>
          {category && (
            <p className="admin-summary-note">
              연체 수는 개인 대여 기록을 별도로 조회해야 하므로 분류별 집계에 표시하지 않습니다. 전체 요약에서 실제 연체 건수를 확인할 수 있습니다.
            </p>
          )}
        </>
      )}
    </div>
  );
}
