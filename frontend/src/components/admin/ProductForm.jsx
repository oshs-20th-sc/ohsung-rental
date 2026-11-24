import { useEffect, useState } from "react";

export default function ProductForm({ product, locked = false, numberLocked = false, busy = false, onCancel, onSave }) {
  const [category, setCategory] = useState(product?.category ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [displayNo, setDisplayNo] = useState(product?.displayNo ?? "");
  const [isEnabled, setIsEnabled] = useState(product?.isEnabled !== false);
  const [error, setError] = useState("");
  const originalEnabled = product?.isEnabled !== false;
  const isDirty = !product || category !== product.category || name !== product.name ||
    Number(displayNo) !== Number(product.displayNo) || isEnabled !== originalEnabled;

  useEffect(() => {
    setCategory(product?.category ?? "");
    setName(product?.name ?? "");
    setDisplayNo(product?.displayNo ?? "");
    setIsEnabled(product?.isEnabled !== false);
    setError("");
  }, [product]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      await onSave({ category, name, displayNo: Number(displayNo), isEnabled });
    } catch (saveError) {
      setError(saveError.message || "물품을 저장하지 못했습니다. 입력값과 중복 번호를 확인해 주세요.");
    }
  };

  return (
    <form className="product-form" onSubmit={submit}>
      <div className="product-form__heading">
        <div>
          <h3>{product ? "물품 정보 수정" : "물품 등록"}</h3>
          <p>{locked ? "대여 중인 물품의 이력 정보를 보존하기 위해 이름, 분류, 번호를 변경할 수 없습니다. 사용 가능 여부는 변경할 수 있습니다." : numberLocked ? "번호 예약 정보가 준비되기 전에는 분류와 번호를 바꿀 수 없습니다. 물품명과 신규 대여 가능 여부는 변경할 수 있습니다." : "같은 분류에서 이미 쓰는 번호는 등록할 수 없습니다."}</p>
        </div>
      </div>
      {error && <p className="admin-field-error" role="alert">{error}</p>}
      <div className="product-form__fields">
        <label className="admin-field">
          <span>분류</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} required disabled={busy || locked || numberLocked} autoComplete="off" />
        </label>
        <label className="admin-field">
          <span>물품명</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy || locked} autoComplete="off" />
        </label>
        <label className="admin-field">
          <span>분류 내 번호</span>
          <input type="number" value={displayNo} onChange={(event) => setDisplayNo(event.target.value)} min="1" max="9999" step="1" required disabled={busy || locked || numberLocked} inputMode="numeric" />
        </label>
        <label className="admin-field admin-field--checkbox">
          <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} disabled={busy} />
          <span>신규 대여 가능</span>
        </label>
      </div>
      <div className="admin-actions">
        <button type="submit" className="admin-button admin-button--primary" disabled={busy || !isDirty}>
          {busy ? "저장 중..." : "저장"}
        </button>
        {onCancel && <button type="button" className="admin-button admin-button--quiet" onClick={onCancel} disabled={busy}>취소</button>}
      </div>
    </form>
  );
}
