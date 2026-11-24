import "./content.css";
import { useSession } from "../auth/sessionContext.js";
import useRentalHistory from "../auth/useRentalHistory.js";
import HistoryPages from "./HistoryPages.jsx";
import { RENTAL_STATUS } from "../services/rentalDates.js";

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const toDate = (value) => {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatFullDate = (value) => {
  const parsed = toDate(value);
  return parsed ? fullDateFormatter.format(parsed) : "-";
};

const formatCountdown = (targetDate) => {
  if (!targetDate) {
    return "정보 없음";
  }
  const now = new Date();
  let diff = targetDate.getTime() - now.getTime();
  if (diff > 0) {
    const dayMs = 1000 * 60 * 60 * 24;
    const hourMs = 1000 * 60 * 60;
    const minuteMs = 1000 * 60;

    const days = Math.floor(diff / dayMs);
    diff -= days * dayMs;
    const hours = Math.floor(diff / hourMs);
    diff -= hours * hourMs;
    const minutes = Math.floor(diff / minuteMs);

    if (days > 0) {
      return `${days}일 ${hours}시간 ${minutes}분 남음`;
    }
    if (hours > 0) {
      return `${hours}시간 ${minutes}분 남음`;
    }
    return `${minutes}분 남음`;
  }
  if (Math.abs(diff) < 1000 * 60) {
    return "지금까지";
  }
  return "연체중";
};

const getStatusTone = (statusCode) => {
  if (statusCode === 0) {
    return "active";
  }
  if (statusCode === 1) {
    return "pending";
  }
  return "default";
};

const Content = () => {
  const { user } = useSession();
  const history = useRentalHistory({ activeOnly: true });
  const { rentals, loading: rentalsLoading, error: rentalsError, refresh } = history;
  const todayText = formatFullDate(new Date());
  const userName = user.name;
  const sortedActiveRentals = rentals
    .filter((item) => item.status_code !== RENTAL_STATUS.RETURNED)
    .sort((a, b) => Number(b.status_code === RENTAL_STATUS.OVERDUE) - Number(a.status_code === RENTAL_STATUS.OVERDUE));

  const journeySteps = [
    {
      title: "대여 선택",
      detail: "원하는 물품을 고르고 주의사항을 확인한 뒤 대여합니다.",
    },
    {
      title: "책임 있게 사용",
      detail: "정해진 기간 동안 깨끗하게 사용하고 손상에 주의하세요.",
    },
    {
      title: "반납",
      detail: "반납 신청 후 안내에 따라 지정 장소에 물품을 반환하세요.",
    },
  ];

  const noteBody =
    "대여일로부터 2일 이내 반납이 원칙입니다. 파손이나 분실이 발생하면 학생회를 통해 배상 절차가 진행될 수 있어요.";

  return (
    <div className="home-content">
      <section className="home-hero">
        <div className="home-hero__copy">
          <h1>필요한 순간, 작은 도움을 건네는 곳</h1>
          <p>필요할때 있는 당신의 물품 대여 서비스.</p>
          <div className="home-hero__meta">
            <div className="home-hero__meta-card">
              <span>오늘</span>
              <strong>{todayText}</strong>
            </div>
            {userName && (
              <div className="home-hero__meta-card">
                <span>이름</span>
                <strong>{userName}</strong>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="home-rentals">
        <div className="home-rentals__head">
          <h2>나의 대여 현황</h2>
          <p>현재 대여 중인 물품과 반납 일정을 확인하세요.</p>
        </div>
        {rentalsLoading ? (
          <div className="home-rentals__placeholder">대여 정보를 불러오는 중...</div>
        ) : rentalsError ? (
          <div className="home-rentals__placeholder" role="alert">
            {rentalsError}{" "}<button type="button" className="history-retry" onClick={refresh}>다시 조회</button>
          </div>
        ) : sortedActiveRentals.length === 0 ? (
          <div className="home-rentals__placeholder">
            현재 대여 중인 물품이 없어요.
          </div>
        ) : (
          <ul className="home-rentals__list">
            {sortedActiveRentals.map((item) => {
              const plannedReturn = toDate(item.expected_return_time);
              const isOverdue = item.status_code === RENTAL_STATUS.OVERDUE;
              const countdown = item.status_code === RENTAL_STATUS.PENDING
                ? "승인 대기 중"
                : formatCountdown(plannedReturn);
              const tone = isOverdue
                ? "overdue"
                : getStatusTone(item.status_code);
              const statusLabel = item.status ?? "상태 정보 없음";

              return (
                <li
                  key={item.rental_id}
                  className={`home-rentals__item${
                    isOverdue ? " home-rentals__item--overdue" : ""
                  }`}
                >
                  <div className="home-rentals__item-head">
                    <h3>{item.product_name}</h3>
                    <span className={`home-rentals__status home-rentals__status--${tone}`}>
                      {isOverdue ? "연체" : statusLabel}
                    </span>
                  </div>
                  <dl className="home-rentals__meta">
                    <div>
                      <dt>대여일</dt>
                      <dd>{formatFullDate(item.rental_time)}</dd>
                    </div>
                    <div>
                      <dt>남은 시간</dt>
                      <dd>{countdown}</dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
        <HistoryPages history={history} />
      </section>

      <section className="home-timeline">
        <div className="home-timeline__head">
          <h2>이용 가이드</h2>
        </div>
        <ol className="home-timeline__list">
          {journeySteps.map((step) => (
            <li key={step.title} className="home-timeline__item">
              <div className="home-timeline__node" aria-hidden="true">
                <span>•</span>
                <div className="home-timeline__spark" />
              </div>
              <div className="home-timeline__content">
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="home-note">
        <div className="home-note__card">
          <div className="home-note__halo" aria-hidden="true" />
          <h3>대여 시 꼭 기억하세요</h3>
          <p>{noteBody}</p>
        </div>
      </section>
    </div>
  );
};

export default Content;
