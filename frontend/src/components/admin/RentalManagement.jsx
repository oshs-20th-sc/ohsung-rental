import { useCallback, useEffect, useMemo, useState } from "react";
import { approveReturn, getAdminTime, listAdminRentals, markReturnPending } from "../../services/adminService.js";
import { RENTAL_STATUS, serviceError } from "../../services/rentalDates.js";
import { useCursorPage } from "../../hooks/useCursorPage.js";
import AdminNotice from "./AdminNotice.jsx";
import CursorControls from "./CursorControls.jsx";
import StatusBadge from "./StatusBadge.jsx";

const filterOptions = [["all", "전체"], ["rented", "대여 중"], ["return_requested", "승인 대기"], ["overdue", "연체"]];
const searchOptions = [["borrowerName", "학생 이름"], ["productName", "물품명"], ["displayNo", "물품 번호"]];

function statusFor(item) {
  if (item.status === RENTAL_STATUS.PENDING) return "return_requested";
  if (item.status === RENTAL_STATUS.OVERDUE) return "overdue";
  return "rented";
}

function statusText(item) {
  const status = statusFor(item);
  return status === "return_requested" ? "반납 승인 대기" : status === "overdue" ? "연체" : "정상 진행";
}

export default function RentalManagement() {
  const [draftStatus, setDraftStatus] = useState("all");
  const [draftField, setDraftField] = useState("borrowerName");
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState({ status: "all", searchField: "borrowerName", search: "" });
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(null);
  const [clockLoading, setClockLoading] = useState(true);
  const [clockError, setClockError] = useState("");

  useEffect(() => {
    let active = true;
    getAdminTime().then((value) => {
      if (active) {
        setNow(value);
        setClockError("");
      }
    }).catch((error) => {
      if (active) setClockError(serviceError(error, "기준 시각을 확인하지 못했습니다."));
    }).finally(() => {
      if (active) setClockLoading(false);
    });
    return () => { active = false; };
  }, []);

  const load = useCallback((cursor) => {
    if (now === null) return Promise.resolve({ items: [], nextCursor: null });
    return listAdminRentals({ ...filters, cursor, now });
  }, [filters, now]);
  const key = useMemo(() => JSON.stringify({ ...filters, now }), [filters, now]);
  const { items, error, loading, page, hasNext, next, previous, reload, reset } = useCursorPage(load, key);

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ status: draftStatus, searchField: draftField, search: draftSearch.trim() });
    setActionError("");
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setClockLoading(true);
    setClockError("");
    setActionError("");
    try {
      const value = await getAdminTime();
      setNow(value);
      setClockError("");
      reset();
    } catch (refreshError) {
      setClockError(serviceError(refreshError, "기준 시각을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setClockLoading(false);
      setRefreshing(false);
    }
  };

  const processRental = async (item) => {
    if (busyId) return;
    const pending = item.status === RENTAL_STATUS.PENDING;
    const actionText = pending ? "이 물품의 반납을 승인" : "반납 대기로 전환";
    if (!window.confirm(`${item.name} 학생의 ${item.product_name} ${item.display_no}번을 ${actionText}할까요?`)) return;

    setBusyId(item.id);
    setActionError("");
    try {
      if (pending) await approveReturn(item.id);
      else await markReturnPending(item.id);
      if (items.length === 1 && page > 1) previous();
      else reload();
    } catch (error) {
      setActionError(serviceError(error, "반납 상태를 변경하지 못했습니다. 목록을 새로고침해 확인해 주세요."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-section">
      <div className="admin-section__heading">
        <div>
          <h2>대여 현황</h2>
          <p>상태별 대여를 조회하고 반납을 처리합니다. 검색은 입력한 값과 정확히 일치하는 항목을 찾습니다.</p>
        </div>
        <button className="admin-button admin-button--quiet" type="button" onClick={refresh} disabled={refreshing || clockLoading}>
          {refreshing || clockLoading ? "갱신 중..." : "새로고침"}
        </button>
      </div>

      <form className="admin-filters" onSubmit={applyFilters}>
        <label className="admin-field">
          <span>대여 상태</span>
          <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
            {filterOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="admin-field">
          <span>찾을 항목</span>
          <select value={draftField} onChange={(event) => setDraftField(event.target.value)}>
            {searchOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="admin-field admin-field--search">
          <span>{searchOptions.find(([value]) => value === draftField)?.[1]} 검색</span>
          <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} maxLength={80} placeholder="검색어 입력" />
        </label>
        <button className="admin-button admin-button--primary" type="submit">검색 적용</button>
      </form>

      {clockError && <AdminNotice kind="error" onRetry={refresh}>{clockError}</AdminNotice>}
      {error && <AdminNotice kind="error" onRetry={reload}>{error}</AdminNotice>}
      {actionError && <AdminNotice kind="error" onRetry={() => { setActionError(""); reload(); }}>{actionError}</AdminNotice>}
      {clockLoading && now === null ? <AdminNotice>기준 시각을 확인하는 중입니다...</AdminNotice> : null}
      {now !== null && loading ? <AdminNotice>대여 현황을 불러오는 중입니다...</AdminNotice> : null}
      {now !== null && !loading && !error && items.length === 0 ? <AdminNotice>{page > 1 ? "현재 페이지에는 대여 기록이 없습니다. 이전 페이지를 확인해 주세요." : "조건에 맞는 대여 기록이 없습니다."}</AdminNotice> : null}

      {now !== null && !loading && !error && items.length > 0 && (
          <div className="admin-list" aria-live="polite">
            {items.map((item) => {
              const pending = item.status === RENTAL_STATUS.PENDING;
              const overdue = item.status === RENTAL_STATUS.OVERDUE;
              const deadline = Array.isArray(item.deadline) ? item.deadline.join(". ") : "기한 정보 없음";
              const displayNo = item.display_no ?? item.product_id;
              return (
                <article className="admin-rental" key={item.id}>
                  <div className="admin-rental__main">
                    <div className="admin-rental__title">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.product_name} · {displayNo}번</p>
                      </div>
                      <StatusBadge status={statusFor(item)} />
                    </div>
                    <dl className="admin-rental__details">
                      <div><dt>대여일</dt><dd>{item.date?.join(". ") ?? "-"}</dd></div>
                      <div><dt>반납 예정일</dt><dd>{deadline}</dd></div>
                      <div><dt>현재 상태</dt><dd>{statusText(item)}</dd></div>
                    </dl>
                  </div>
                  <button
                    type="button"
                    className={`admin-button ${pending ? "admin-button--primary" : overdue ? "admin-button--warning" : "admin-button--quiet"}`}
                    onClick={() => processRental(item)}
                    disabled={Boolean(busyId)}
                  >
                    {busyId === item.id ? "처리 중..." : pending ? "반납 승인" : "반납 대기로 변경"}
                  </button>
                </article>
              );
            })}
          </div>
      )}
      {now !== null && !loading && !error && (items.length > 0 || page > 1) && (
        <CursorControls page={page} hasNext={hasNext} loading={loading} onPrevious={previous} onNext={next} />
      )}
    </div>
  );
}
