import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../../auth/sessionContext.js";
import useRentalHistory from "../../auth/useRentalHistory.js";
import { logout } from "../../services/authService.js";
import { RENTAL_STATUS, serviceError } from "../../services/rentalDates.js";
import Header from "../../components/M_header";
import HistoryPages from "../../components/HistoryPages.jsx";
import "./MyPage.css";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});
const formatDate = (time) => time == null ? "-" : dateFormatter.format(time);

function MyPage() {
  const { user } = useSession();
  const history = useRentalHistory({ withCounts: true });
  const { rentals, loading, error, counts, countError, refresh } = history;
  const navigate = useNavigate();
  const [latestRental, setLatestRental] = useState(null);

  useEffect(() => {
    if (history.page === 1 && !loading && !error) setLatestRental(rentals[0] ?? null);
  }, [history.page, loading, error, rentals]);

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/Login", { replace: true });
    } catch (error) {
      alert(serviceError(error, "로그아웃하지 못했습니다."));
    }
  };

  const heroStats = [
    { label: "대여 중", value: counts?.active ?? "—", tone: "emerald" },
    { label: "반납 신청", value: counts?.pending ?? "—", tone: "amber" },
    { label: "반납 완료", value: counts?.completed ?? "—", tone: "violet" },
  ];

  const renderDeadline = (expected) => {
    if (!expected) {
      return "기한 정보 없음";
    }
    const now = new Date();
    const target = new Date(expected);
    let diff = target - now;
    if (diff > 0) {
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      diff -= days * (1000 * 60 * 60 * 24);
      const hours = Math.floor(diff / (1000 * 60 * 60));
      diff -= hours * (1000 * 60 * 60);
      const minutes = Math.floor(diff / (1000 * 60));
      return `${days}일 ${hours}시간 ${minutes}분 남음`;
    }
    if (Math.abs(diff) < 1000 * 60) {
      return "지금까지";
    }
    return "연체중";
  };

  const renderStatusBadge = (status, statusCode) => {
    const tones = ["active", "pending", "completed", "overdue"];
    return <span className={`mypage-badge mypage-badge--${tones[statusCode]}`}>{status}</span>;
  };

  return (
    <div className="mypage-page">
      <Header />
      <main className="mypage-main">
        <section className="mypage-hero">
          <div className="mypage-hero__copy">
            <span className="mypage-hero__eyebrow">내 페이지</span>
            <h1>내 페이지</h1>
            <p>
              대여 현황과 계정 관리를 한눈에 확인하고 필요한 작업을 바로 진행해
              보세요.
            </p>
          </div>
          <div className="mypage-hero__meta">
            {heroStats.map((stat) => (
              <div
                key={stat.label}
                className={`mypage-hero__meta-card mypage-hero__meta-card--${stat.tone}`}
              >
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
            <div className="mypage-hero__meta-card mypage-hero__meta-card--identity">
              <span>회원 정보</span>
              <strong>{user.name}</strong>
              <p>{user.studentId ?? user.email}</p>
              <p>최근 대여 · {latestRental ? formatDate(latestRental.rental_time) : "기록 없음"}</p>

            </div>
          </div>
          {countError && <p role="alert">{countError}{" "}<button type="button" className="history-retry" onClick={refresh}>다시 조회</button></p>}
        </section>

        <section className="mypage-panels">
          <div className="mypage-panel">
            <div className="mypage-panel__head">
              <h2>계정 관리</h2>
              <p>계정과 관련된 작업을 여기에서 빠르게 처리할 수 있어요.</p>
            </div>
            <div className="mypage-actions__buttons">
              <button
                type="button"
                className="mypage-button"
                onClick={() => navigate("/info")}
              >
                비밀번호 변경
              </button>
              {user.isAdmin && (
                <button
                  type="button"
                  className="mypage-button mypage-button--alt"
                  onClick={() => navigate("/admin")}
                >
                  관리자 콘솔
                </button>
              )}
              <button
                type="button"
                className="mypage-button mypage-button--ghost"
                onClick={handleLogout}
              >
                로그아웃
              </button>
            </div>
          </div>

          <div className="mypage-panel mypage-panel--secondary">
            <div className="mypage-panel__head">
              <h2>대여·반납 기록</h2>
            </div>

            {loading ? (
              <div className="mypage-empty" role="status">대여 기록을 불러오는 중입니다...</div>
            ) : error ? (
              <div className="mypage-empty" role="alert">
                {error}{" "}<button type="button" className="history-retry" onClick={refresh}>다시 조회</button>
              </div>
            ) : rentals.length === 0 ? (
              <div className="mypage-empty">
                {history.page === 1 ? "아직 대여한 물품이 없어요." : "이 페이지에 대여 기록이 없어요."}
              </div>
            ) : (
              <div className="mypage-history__table">
                <table role="table" aria-label="대여·반납 기록">
                  <thead>
                    <tr>
                      <th>물품명</th>
                      <th>대여일</th>
                      <th>반납일</th>
                      <th>상태</th>
                      <th>반납 예정</th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {rentals.map((item) => (
                      <tr role="row" key={item.rental_id}>
                        <td role="cell" data-label="물품명">{item.product_name}</td>
                        <td role="cell" data-label="대여일">{formatDate(item.rental_time)}</td>
                        <td role="cell" data-label="반납일">
                          {formatDate(item.return_time)}
                        </td>
                        <td role="cell" data-label="상태">
                          {renderStatusBadge(item.status, item.status_code)}
                        </td>
                        <td role="cell" data-label="반납 예정">
                          {item.status_code === RENTAL_STATUS.RETURNED ? "-" : renderDeadline(item.expected_return_time)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <HistoryPages history={history} />
          </div>
        </section>
      </main>
    </div>
  );
}

export default MyPage;
