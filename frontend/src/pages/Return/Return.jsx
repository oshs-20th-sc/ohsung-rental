import { useMemo, useState } from "react";
import { useSession } from "../../auth/sessionContext.js";
import useRentalHistory from "../../auth/useRentalHistory.js";
import { requestReturn } from "../../services/rentalService.js";
import { serviceError } from "../../services/rentalDates.js";
import Header from "../../components/header";
import HistoryPages from "../../components/HistoryPages.jsx";
import "./Return.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
};

function Return() {
  const { user } = useSession();
  const history = useRentalHistory({ activeOnly: true, withCounts: true });
  const { rentals, loading, error, refresh, counts, countError } = history;
  const [processingId, setProcessingId] = useState(null);

  const inProgressRentals = useMemo(() => {
    const priority = (code) => {
      if (code === 3) {
        return 0; // 연체 우선 표시
      }
      if (code === 0) {
        return 1; // 대여 중
      }
      return 2; // 반납 신청 등 기타
    };
    return rentals
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status_code !== 2)
      .sort((a, b) => {
        const diff = priority(a.item.status_code) - priority(b.item.status_code);
        if (diff !== 0) {
          return diff;
        }
        return a.index - b.index;
      })
      .map(({ item }) => item);
  }, [rentals]);

  const heroStats = [
    { label: "대여 중", value: counts?.active ?? "—", tone: "emerald" },
    { label: "반납 신청", value: counts?.pending ?? "—", tone: "amber" },
    { label: "반납 완료", value: counts?.completed ?? "—", tone: "violet" },
  ];

  const handleReturn = async (rental) => {
    if (!rental || processingId) {
      return;
    }

    if (rental.status_code === 3) {
      alert("연체 상태에서는 반납 신청을 진행할 수 없습니다. 학생회에 문의해 주세요.");
      return;
    }

    if (rental.status_code !== 0) {
      return;
    }

    setProcessingId(rental.rental_id);
    try {
      await requestReturn(rental.rental_id);
      alert("반납 신청이 접수되었습니다.");
    } catch (error) {
      alert(serviceError(error, "반납 신청을 처리하지 못했어요."));
    } finally {
      refresh();
      setProcessingId(null);
    }
  };

  const renderRentalCard = (item, isActiveSection = true) => {
    const isPending = item.status_code === 1;
    const isRented = item.status_code === 0;
    const isCompleted = item.status_code === 2;
    const isOverdue = item.status_code === 3;
    const disableAction =
      !isActiveSection ||
      !isRented ||
      Boolean(processingId) ||
      isOverdue;
    const isProcessing = processingId === item.rental_id;
    const buttonText = isOverdue
      ? "연체중"
      : isPending
      ? "승인 대기중"
      : isRented
      ? "반납 신청"
      : "완료";
    const statusTone = isCompleted
      ? "completed"
      : isPending
      ? "pending"
      : isOverdue
      ? "overdue"
      : "active";

    const displayNo = item.display_no ?? item.product_id;
    const cardClasses = [
      "rental-card",
      isCompleted && "rental-card--completed",
      isOverdue && "rental-card--overdue",
    ]
      .filter(Boolean)
      .join(" ");
    const actionClasses = [
      "return-card__action",
      isOverdue && "return-card__action--blocked",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <article
        key={item.rental_id}
        className={cardClasses}
      >
        <div className="rental-card__header">
          <div>
            <h4 className="rental-card__title">{item.product_name}</h4>
            <p className="rental-card__subtitle">물품 ID · {displayNo}</p>
          </div>
          <span className={`status-badge status-badge--${statusTone}`}>
            {isOverdue ? "연체중" : item.status}
          </span>
        </div>

        <dl className="rental-card__meta">
          <div className="rental-card__meta-item">
            <dt>대여일</dt>
            <dd>{formatDateTime(item.rental_time)}</dd>
          </div>
          {item.expected_return_time && (
            <div className="rental-card__meta-item">
              <dt>반납 예정</dt>
              <dd>{formatDateTime(item.expected_return_time)}</dd>
            </div>
          )}
        </dl>

        {isActiveSection && (
          <button
            type="button"
            onClick={() => handleReturn(item)}
            disabled={disableAction}
            className={actionClasses}
            title={
              isOverdue
                ? "연체 상태에서는 온라인 반납 신청이 제한됩니다."
                : undefined
            }
          >
            {isProcessing ? "처리 중..." : buttonText}
          </button>
        )}

        {isOverdue && (
          <p className="return-card__note">
            반납 신청이 제한되었습니다.
          </p>
        )}
      </article>
    );
  };

  return (
    <div className="return-page">
      <Header />
      <main className="return-main">
        <section className="return-hero">
          <div className="return-hero__copy">
            <span className="return-hero__eyebrow">반납하기</span>
            <h1>대여 현황과 반납 진행 상태</h1>
            <p>
              대여 중인 물품과 반납 신청 현황을 확인하세요.
            </p>
          </div>

          <div className="return-hero__meta">
            {heroStats.map((stat) => (
              <div
                key={stat.label}
                className={`return-hero__meta-card return-hero__meta-card--${stat.tone}`}
              >
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
            <div className="return-hero__meta-card return-hero__meta-card--identity">
              <span>이름</span>
              <strong>{user.name}</strong>

            </div>
          </div>
        </section>

        {(error || countError) && (
          <div className="return-alert return-alert--error" role="alert">
            {error || countError}{" "}
            <button type="button" className="history-retry" onClick={refresh}>다시 조회</button>
          </div>
        )}

        {loading ? (
          <div className="return-loading">
            <span className="return-spinner" aria-hidden="true" />
            대여 정보를 불러오는 중입니다...
          </div>
        ) : (
          <section className="return-panels">
            <div className="return-panel">
              <div className="return-panel__head">
                <h2>대여 중 · 반납 진행 중</h2>
                <span className="return-chip">{counts ? counts.active + counts.pending : "—"}건</span>
              </div>
              {error ? null : inProgressRentals.length === 0 ? (
                <p className="return-empty">{history.page === 1 ? "현재 대여 중인 물품이 없습니다." : "이 페이지에 대여 기록이 없습니다."}</p>
              ) : (
                <div className="return-grid">
                  {inProgressRentals.map((item) => renderRentalCard(item, true))}
                </div>
              )}
              <HistoryPages history={history} />
              {counts?.pending > 0 && (
                <p className="return-hint">
                  반납 신청된 물품은 학생회가 순차적으로 확인합니다.
                </p>
              )}
            </div>

            <div className="return-panel return-panel--guide">
              <h3>주의사항</h3>
              <ul className="return-guide__list">
                <li>
                  대여일로부터 <strong>2일 이내</strong>에 반납을 완료해 주세요.
                </li>
                <li>
                  파손 또는 분실 시 <strong>학생회</strong>와 협의하여 배상이 필요할
                  수 있습니다.
                </li>
                <li>
                  반납에 대한 문의가 있으면 <strong>학생회</strong>로 연락해 주세요.
                </li>
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default Return;
