import { useEffect, useMemo, useState } from "react";
import { listProducts } from "../services/productService.js";
import { rent } from "../services/rentalService.js";
import { serviceError } from "../services/rentalDates.js";
import "./B_content.css";

export default function BContent() {
  const [products, setProducts] = useState([]);
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listProducts().then((items) => {
      if (active) setProducts(items);
    }).catch((error) => {
      if (active) setError(serviceError(error, "재고를 불러오지 못했습니다."));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  const categories = useMemo(() => {
    const counts = new Map();
    for (const product of products) {
      if (!product.isEnabled) continue;
      const summary = counts.get(product.category) ?? { category: product.category, total: 0, available: 0 };
      summary.total += 1;
      if (product.status === "available") summary.available += 1;
      counts.set(product.category, summary);
    }
    return [...counts.values()].sort((a, b) => a.category.localeCompare(b.category, "ko"));
  }, [products]);

  const selectedCategory = categories.find((item) => item.category === selectedItem) ?? categories[0];
  const units = products
    .filter((product) => product.isEnabled && product.category === selectedCategory?.category)
    .sort((a, b) => a.displayNo - b.displayNo);
  const selectedUnit = units.find((item) => item.id === selectedId && item.status === "available");

  const handleBorrow = async () => {
    if (!selectedUnit || busy) return;
    setBusy(true);
    setError("");
    try {
      await rent(selectedUnit.id);
      setProducts((items) => items.map((item) =>
        item.id === selectedUnit.id ? { ...item, status: "rented" } : item
      ));
      alert("대여가 완료되었습니다.");
    } catch (error) {
      alert(serviceError(error, "대여 처리 중 오류가 발생했습니다."));
    } finally {
      setSelectedId(null);
      try {
        setProducts(await listProducts());
      } catch (error) {
        setError(serviceError(error, "목록을 새로고침해 재고를 확인해 주세요."));
      }
      setBusy(false);
    }
  };

  const hasCategories = categories.length > 0;

  return (
    <div className="borrow-shell">
      <section className="borrow-hero">
        <div className="borrow-hero__copy">
          <span className="borrow-hero__eyebrow">대여하기</span>
          <h1>물품 대여</h1>
          <p>원하는 물품을 선택하고 대여 신청을 해보세요.</p>
        </div>

        <div className="borrow-hero__meta">
          <div className="borrow-panel borrow-panel--guide">
            <h3>주의사항</h3>
            <ul className="borrow-guide__list">
              <li>대여 기간은 <strong>2일</strong> 입니다.</li>
              <li>사용 중 파손이나 문제 발생 시 즉시 학생회에 연락하세요.</li>
              <li>
                반납 신청은 지정된 장소에 반납 후 반납신청을 진행해주세요.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="borrow-panels">
        <div className="borrow-panel">
          <div className="borrow-panel__head">
            <h2>물품 선택</h2>
            <span className="borrow-panel__meta">
              {selectedCategory
                ? `${selectedCategory.available}/${selectedCategory.total}`
                : "0/0"}
            </span>
          </div>

          <div className="borrow-panel__body">
            {loading ? (
              <p className="borrow-empty" role="status">재고를 불러오는 중입니다...</p>
            ) : error ? (
              <div className="borrow-empty" role="alert">
                {error}{" "}
                <button type="button" className="borrow-chip" onClick={() => setRevision((current) => current + 1)}>
                  다시 조회
                </button>
              </div>
            ) : hasCategories ? (
              <div className="borrow-chip-group" role="tablist">
                {categories.map(({ category, total, available }) => {
                  const active = selectedCategory?.category === category;
                  return (
                    <button
                      key={category}
                      type="button"
                      className={`borrow-chip ${active ? "is-active" : ""}`}
                      onClick={() => {
                        setSelectedItem(category);
                        setSelectedId(null);
                      }}
                      disabled={busy}
                      aria-pressed={active}
                    >
                      <span className="borrow-chip__label">{category}</span>
                      <span className="borrow-chip__meta">
                        {available}/{total}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="borrow-empty">
                아직 대여 가능한 카테고리가 없습니다.
              </p>
            )}

            <div className="borrow-grid">
              {units.map((unit) => {
                const picked = selectedId === unit.id;
                const isBlocked = unit.status !== "available";
                const disabled = isBlocked || busy || Boolean(error);
                return (
                  <button
                    key={unit.id}
                    type="button"
                    disabled={disabled}
                    className={`borrow-slot ${
                      picked ? "is-selected" : ""
                    } ${disabled ? "is-disabled" : ""}`}
                    onClick={() => setSelectedId(unit.id)}
                    aria-pressed={picked}
                    aria-label={`${unit.displayNo}번${
                      picked ? " (선택됨)" : ""
                    }${isBlocked ? " (대여 불가)" : ""}`}
                  >
                    <span>{unit.displayNo}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <footer className="borrow-panel__footer">
            <div className="borrow-selected">
              <span>선택한 번호</span>
              <strong>{selectedUnit?.displayNo ?? "--"}</strong>
              {selectedUnit?.name && (
                <small>{selectedUnit.name}</small>
              )}
            </div>
            <button
              type="button"
              className="borrow-cta"
              onClick={handleBorrow}
              disabled={!selectedUnit || busy || Boolean(error)}
            >
              {busy ? "처리 중..." : "대여 신청"}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
