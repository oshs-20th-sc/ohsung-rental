import { collection, doc, runTransaction } from "firebase/firestore";

const inventorySettingsId = "v1";
const invalidCategoryCharacter = /[|/]/u;
const controlCharacter = /\p{Cc}/u;

function normalizeCategory(value) {
  if (typeof value !== "string") {
    throw new Error("카테고리를 입력해 주세요.");
  }

  const category = value.trim();
  if (
    category.length === 0 ||
    category.length > 80 ||
    invalidCategoryCharacter.test(category) ||
    controlCharacter.test(category)
  ) {
    throw new Error("카테고리는 1~80자이며 앞뒤 공백, |, /, 제어 문자를 포함할 수 없습니다.");
  }

  return category;
}

function normalizeName(value) {
  if (typeof value !== "string") {
    throw new Error("물품명을 입력해 주세요.");
  }

  const name = value.trim();
  if (name.length === 0 || name.length > 80 || controlCharacter.test(name)) {
    throw new Error("물품명은 1~80자의 표시 가능한 문자로 입력해 주세요.");
  }

  return name;
}

function normalizeDisplayNo(value) {
  if (!Number.isInteger(value) || value < 1 || value > 9999) {
    throw new Error("물품 번호는 1~9999 사이의 정수여야 합니다.");
  }

  return value;
}

export function productNumberKey(category, displayNo) {
  const normalizedCategory = normalizeCategory(category);
  const normalizedDisplayNo = normalizeDisplayNo(displayNo);
  return `${normalizedCategory}|${normalizedDisplayNo}`;
}

export function validateProductInput(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error("물품 정보를 입력해 주세요.");
  }

  const keys = Object.keys(fields).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "category" ||
    keys[1] !== "displayNo" ||
    keys[2] !== "isEnabled" ||
    keys[3] !== "name"
  ) {
    throw new Error("물품 정보의 항목이 올바르지 않습니다.");
  }
  if (typeof fields.isEnabled !== "boolean") {
    throw new Error("물품 사용 여부를 선택해 주세요.");
  }

  return {
    category: normalizeCategory(fields.category),
    name: normalizeName(fields.name),
    displayNo: normalizeDisplayNo(fields.displayNo),
    isEnabled: fields.isEnabled,
  };
}

function isInventoryReady(snapshot) {
  if (!snapshot.exists()) return false;
  const settings = snapshot.data();
  const keys = Object.keys(settings);
  return keys.length === 1 && keys[0] === "ready" && settings.ready === true;
}

function isEmptyReservation(snapshot) {
  return !snapshot.exists();
}

function reservationReference(db, category, displayNo) {
  return doc(db, "productNumbers", productNumberKey(category, displayNo));
}

export async function createProduct(db, fields) {
  const product = validateProductInput(fields);
  const productReference = doc(collection(db, "products"));
  const settingsReference = doc(db, "inventorySettings", inventorySettingsId);
  const reservation = reservationReference(db, product.category, product.displayNo);

  await runTransaction(db, async (transaction) => {
    const [settingsSnapshot, productSnapshot, reservationSnapshot] = await Promise.all([
      transaction.get(settingsReference),
      transaction.get(productReference),
      transaction.get(reservation),
    ]);

    if (!isInventoryReady(settingsSnapshot)) {
      throw new Error("물품 번호 자료를 준비 중입니다. 관리자에게 문의해 주세요.");
    }
    if (productSnapshot.exists()) {
      throw new Error("물품 ID가 이미 존재합니다. 다시 시도해 주세요.");
    }
    if (!isEmptyReservation(reservationSnapshot)) {
      throw new Error("같은 카테고리에 이미 사용 중인 물품 번호입니다.");
    }

    transaction.set(productReference, {
      ...product,
      status: "available",
      activeRentalId: null,
    });
    transaction.set(reservation, { productId: productReference.id });
  });

  return productReference.id;
}

export async function updateProduct(db, productId, fields, expected = null) {
  const product = validateProductInput(fields);
  if (typeof productId !== "string" || productId.length === 0) {
    throw new Error("수정할 물품을 찾을 수 없습니다.");
  }

  const productReference = doc(db, "products", productId);
  const settingsReference = doc(db, "inventorySettings", inventorySettingsId);

  await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(productReference);
    if (!currentSnapshot.exists()) {
      throw new Error("수정할 물품을 찾을 수 없습니다.");
    }

    const current = currentSnapshot.data();
    if (expected) {
      if (
        current.category !== expected.category ||
        current.name !== expected.name ||
        current.displayNo !== expected.displayNo ||
        (current.isEnabled !== false) !== (expected.isEnabled !== false)
      ) {
        throw new Error("물품 정보가 다른 관리자에 의해 변경되었습니다. 새로고침 후 다시 수정해 주세요.");
      }
    }

    const numberChanged =
      current.category !== product.category || current.displayNo !== product.displayNo;

    if (!numberChanged) {
      transaction.update(productReference, product);
      return;
    }

    if (current.status !== "available" || current.activeRentalId !== null) {
      throw new Error("대여 중이거나 반납 처리 중인 물품은 카테고리와 번호를 바꿀 수 없습니다.");
    }

    const oldReservation = reservationReference(db, current.category, current.displayNo);
    const newReservation = reservationReference(db, product.category, product.displayNo);
    const [settingsSnapshot, oldReservationSnapshot, newReservationSnapshot] = await Promise.all([
      transaction.get(settingsReference),
      transaction.get(oldReservation),
      transaction.get(newReservation),
    ]);

    if (!isInventoryReady(settingsSnapshot)) {
      throw new Error("물품 번호 자료를 준비 중입니다. 관리자에게 문의해 주세요.");
    }
    if (
      !oldReservationSnapshot.exists() ||
      oldReservationSnapshot.data().productId !== productId
    ) {
      throw new Error("현재 물품 번호 자료가 없습니다. 관리자에게 확인해 주세요.");
    }
    if (!isEmptyReservation(newReservationSnapshot)) {
      throw new Error("같은 카테고리에 이미 사용 중인 물품 번호입니다.");
    }

    transaction.delete(oldReservation);
    transaction.set(newReservation, { productId });
    transaction.update(productReference, product);
  });

  return productId;
}

export async function setProductEnabled(db, productId, isEnabled) {
  if (typeof productId !== "string" || productId.length === 0) {
    throw new Error("수정할 물품을 찾을 수 없습니다.");
  }
  if (typeof isEnabled !== "boolean") {
    throw new Error("물품 사용 여부를 선택해 주세요.");
  }

  const productReference = doc(db, "products", productId);
  await runTransaction(db, async (transaction) => {
    const productSnapshot = await transaction.get(productReference);
    if (!productSnapshot.exists()) {
      throw new Error("수정할 물품을 찾을 수 없습니다.");
    }

    transaction.update(productReference, { isEnabled });
  });

  return productId;
}
