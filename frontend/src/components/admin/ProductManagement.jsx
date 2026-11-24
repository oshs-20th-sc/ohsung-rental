import { useCallback, useEffect, useMemo, useState } from "react";
import { getInventoryReady, listAdminProducts, saveProduct, setProductEnabled } from "../../services/productService.js";
import { serviceError } from "../../services/rentalDates.js";
import { useCursorPage } from "../../hooks/useCursorPage.js";
import AdminNotice from "./AdminNotice.jsx";
import CursorControls from "./CursorControls.jsx";
import ProductForm from "./ProductForm.jsx";
import StatusBadge from "./StatusBadge.jsx";

const searchOptions = [["name", "물품명"], ["displayNo", "물품 번호"]];

export default function ProductManagement() {
  const [draftCategory, setDraftCategory] = useState("");
  const [draftField, setDraftField] = useState("name");
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState({ category: "", searchField: "name", search: "" });
  const [inventoryReady, setInventoryReady] = useState(null);
  const [inventoryError, setInventoryError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [categoryHints, setCategoryHints] = useState([]);

  const loadInventoryState = useCallback(async () => {
    try {
      const ready = await getInventoryReady();
      setInventoryReady(ready);
      setInventoryError("");
    } catch (error) {
      setInventoryError(serviceError(error, "물품 등록 상태를 확인하지 못했습니다."));
    }
  }, []);

  useEffect(() => { loadInventoryState(); }, [loadInventoryState]);

  const load = useCallback((cursor) => listAdminProducts({ ...filters, cursor }), [filters]);
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const { items, error, loading, page, hasNext, next, previous, reload, reset } = useCursorPage(load, key);

  useEffect(() => {
    setCategoryHints((current) => [...new Set([...current, ...items.map((product) => product.category).filter(Boolean)])].slice(0, 20));
  }, [items]);

  const applyFilters = (event) => {
    event.preventDefault();
    setFilters({ category: draftCategory.trim(), searchField: draftField, search: draftSearch.trim() });
    setEditing(null);
    setFormOpen(false);
    setActionError("");
  };

  const save = async (fields) => {
    setBusyId(editing?.id ?? "new");
    setActionError("");
    setNotice("");
    try {
      await saveProduct(fields, editing?.id ?? null, editing);
      setNotice(editing ? "물품 정보를 저장했습니다." : "물품을 등록했습니다.");
      setFormOpen(false);
      setEditing(null);
      if (inventoryReady === false) await loadInventoryState();
      await reset();
    } catch (error) {
      throw new Error(serviceError(error, "저장하지 못했습니다. 입력값, 번호 중복, 관리자 권한을 확인해 주세요."));
    } finally {
      setBusyId(null);
    }
  };

  const changeEnabled = async (product) => {
    if (busyId) return;
    const isEnabled = product.isEnabled !== false;
    const nextEnabled = !isEnabled;
    const prompt = nextEnabled
      ? `${product.category} ${product.displayNo}번 물품을 다시 대여 가능하게 할까요?`
      : `${product.category} ${product.displayNo}번 물품을 사용 중지할까요? 기존 대여 건은 반납할 수 있습니다.`;
    if (!window.confirm(prompt)) return;

    setBusyId(product.id);
    setActionError("");
    setNotice("");
    try {
      await setProductEnabled(product.id, nextEnabled);
      setNotice(nextEnabled ? "물품을 다시 대여 가능하게 했습니다." : "물품을 사용 중지했습니다.");
      await reload();
    } catch (error) {
      setActionError(serviceError(error, "물품 상태를 변경하지 못했습니다. 목록을 새로고침해 확인해 주세요."));
    } finally {
      setBusyId(null);
    }
  };

  const dismissForm = () => {
    setEditing(null);
    setFormOpen(false);
  };

  return (
    <div className="admin-section">
      <div className="admin-section__heading">
        <div>
          <h2>물품 관리</h2>
          <p>분류 내 번호가 중복되지 않도록 등록하고, 사용을 중지해도 기존 대여 이력을 보존합니다.</p>
        </div>
        <button className="admin-button admin-button--primary" type="button" onClick={() => { setEditing(null); setFormOpen((open) => !open); }} disabled={busyId !== null || inventoryReady === null || inventoryReady === false}>
          {formOpen && !editing ? "등록 폼 닫기" : "물품 등록"}
        </button>
      </div>

      {inventoryReady === false && (
        <AdminNotice kind="info">
          번호 예약 정보를 준비하기 전까지 새 물품과 번호 변경은 잠겨 있습니다. 기존 물품명 수정과 사용 중지는 가능합니다. 운영 중 기존 재고를 안전하게 연결한 뒤 등록 기능을 열어야 합니다.
        </AdminNotice>
      )}
      {notice && <AdminNotice kind="success">{notice}</AdminNotice>}
      {inventoryError && <AdminNotice kind="error" onRetry={loadInventoryState}>{inventoryError}</AdminNotice>}
      {actionError && <AdminNotice kind="error" onRetry={() => { setActionError(""); reload(); }}>{actionError}</AdminNotice>}
      {error && <AdminNotice kind="error" onRetry={reload}>{error}</AdminNotice>}

      {formOpen && !editing && (
        <ProductForm key="new-product" busy={busyId === "new"} onCancel={dismissForm} onSave={save} />
      )}

      <form className="admin-filters" onSubmit={applyFilters}>
        <label className="admin-field">
          <span>분류 정확히 찾기</span>
          <input value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} maxLength={80} placeholder="예: 우산" list="admin-product-category-hints" />
          <datalist id="admin-product-category-hints">
            {categoryHints.map((category) => <option key={category} value={category} />)}
          </datalist>
        </label>
        <label className="admin-field">
          <span>찾을 항목</span>
          <select value={draftField} onChange={(event) => setDraftField(event.target.value)}>
            {searchOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="admin-field admin-field--search">
          <span>{searchOptions.find(([value]) => value === draftField)?.[1]} 검색</span>
          <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} maxLength={80} placeholder="검색어를 정확히 입력" />
        </label>
        <button className="admin-button admin-button--quiet" type="submit">검색 적용</button>
      </form>

      {loading ? <AdminNotice>물품 목록을 불러오는 중입니다...</AdminNotice> : !error && items.length === 0 ? <AdminNotice>{page > 1 ? "현재 페이지에는 물품이 없습니다. 이전 페이지를 확인해 주세요." : "조건에 맞는 물품이 없습니다."}</AdminNotice> : null}

      {!loading && !error && items.length > 0 && (
          <div className="admin-list" aria-live="polite">
            {items.map((product) => {
              const active = Boolean(product.activeRentalId) || product.status !== "available";
              const isEnabled = product.isEnabled !== false;
              const editingProduct = editing?.id === product.id;
              return (
                <article className="admin-product" key={product.id}>
                  <div className="admin-product__row">
                    <div className="admin-product__identity">
                      <span className="admin-product__category">{product.category}</span>
                      <h3>{product.name}</h3>
                      <p>분류 내 {product.displayNo}번</p>
                    </div>
                    <div className="admin-product__state">
                      <StatusBadge status={product.status} isEnabled={isEnabled} />
                      {product.activeRentalId && <span className="admin-product__rented-note">현재 대여 기록 연결됨</span>}
                    </div>
                    <div className="admin-actions admin-actions--wrap">
                      <button type="button" className="admin-button admin-button--quiet" disabled={Boolean(busyId) || editingProduct} onClick={() => { setFormOpen(false); setEditing(product); }}>
                        물품 정보 수정
                      </button>
                      <button type="button" className={`admin-button ${isEnabled ? "admin-button--warning" : "admin-button--primary"}`} disabled={Boolean(busyId) || editingProduct} onClick={() => changeEnabled(product)}>
                        {busyId === product.id ? "처리 중..." : isEnabled ? "사용 중지" : "다시 사용"}
                      </button>
                    </div>
                  </div>
                  {editingProduct && (
                    <ProductForm
                      key={product.id}
                      product={product}
                      locked={active}
                      numberLocked={inventoryReady !== true}
                      busy={busyId === product.id}
                      onCancel={dismissForm}
                      onSave={save}
                    />
                  )}
                </article>
              );
            })}
          </div>
      )}
      {!loading && !error && (items.length > 0 || page > 1) && (
        <CursorControls page={page} hasNext={hasNext} loading={loading} onPrevious={previous} onNext={next} />
      )}
    </div>
  );
}
