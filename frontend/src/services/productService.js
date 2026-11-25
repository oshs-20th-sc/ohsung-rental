import { collection, doc, getDocFromServer, getDocsFromServer } from "firebase/firestore";
import { isDemo } from "../firebase/client.js";
import { db } from "../firebase/firestoreClient.js";
import { demoAdmin, demoMember, demoProducts } from "./demoData.js";
import { memoryPage } from "./firestorePages.js";
import { createProduct, productNumberKey, setProductEnabled as setEnabledTransaction, updateProduct, validateProductInput } from "./inventoryTransactions.js";
import { compareProductCursor, productCursor, productSearchValue, queryAdminProducts, watchProductDocuments } from "./productQueries.js";

const readProduct = (product, id) => ({ ...product, id, isEnabled: product.isEnabled !== false });

export async function listProducts() {
  if (isDemo) {
    demoMember();
    return demoProducts.map((product) => readProduct(product, product.id));
  }

  const snapshot = await getDocsFromServer(collection(db, "products"));
  return snapshot.docs.map((product) => readProduct(product.data(), product.id));
}

export function watchProducts(onItems, onError) {
  if (isDemo) {
    let active = true;
    listProducts().then((items) => {
      if (active) onItems(items);
    }).catch((error) => {
      if (active) onError(error);
    });
    return () => { active = false; };
  }

  return watchProductDocuments(db, (documents) => {
    onItems(documents?.map((product) => readProduct(product.data(), product.id)) ?? null);
  }, onError);
}

export async function listAdminProducts({ cursor = null, category = "", searchField = "name", search = "" } = {}) {
  const normalizedCategory = category.trim();
  if (!isDemo) {
    const page = await queryAdminProducts(db, { cursor, category: normalizedCategory, searchField, search });
    return { ...page, items: page.items.map((item) => readProduct(item.data(), item.id)) };
  }

  demoAdmin();
  const value = productSearchValue(searchField, search);
  const numberSearch = value !== "" && searchField === "displayNo";
  const items = demoProducts.filter((item) =>
    (!normalizedCategory || item.category === normalizedCategory) && (value === "" || item[searchField] === value),
  );
  const page = memoryPage(items, cursor, compareProductCursor, (item) =>
    productCursor(item, item.id, normalizedCategory, numberSearch),
  );
  return { ...page, items: page.items.map((item) => readProduct(item, item.id)) };
}

export async function getInventoryReady() {
  if (isDemo) {
    demoAdmin();
    return true;
  }
  const settings = await getDocFromServer(doc(db, "inventorySettings", "v1"));
  return settings.data()?.ready === true;
}

export async function saveProduct(fields, id = null, expected = null) {
  if (!isDemo) return id ? updateProduct(db, id, fields, expected) : createProduct(db, fields);

  demoAdmin();
  const data = validateProductInput(fields);
  const current = id ? demoProducts.find((item) => item.id === id) : null;
  if (id && !current) throw new Error("물품을 찾지 못했습니다.");
  if (current && expected && ["category", "name", "displayNo", "isEnabled"].some((field) =>
    readProduct(current, id)[field] !== expected[field],
  )) {
    throw new Error("다른 관리자가 물품 정보를 수정했습니다. 목록을 다시 조회해 주세요.");
  }
  if (current && (current.status !== "available" || current.activeRentalId !== null) &&
      ["category", "name", "displayNo"].some((field) => current[field] !== data[field])) {
    throw new Error("진행 중인 대여가 끝나면 이름·카테고리·번호를 수정할 수 있습니다.");
  }
  const key = productNumberKey(data.category, data.displayNo);
  if (demoProducts.some((item) => item.id !== id && productNumberKey(item.category, item.displayNo) === key)) {
    throw new Error("같은 카테고리에 이미 등록된 물품 번호입니다.");
  }
  if (current) {
    Object.assign(current, data);
    return id;
  }

  const productId = crypto.randomUUID();
  demoProducts.push({ id: productId, ...data, status: "available", activeRentalId: null });
  return productId;
}

export async function setProductEnabled(id, isEnabled) {
  if (!isDemo) return setEnabledTransaction(db, id, isEnabled);

  demoAdmin();
  const product = demoProducts.find((item) => item.id === id);
  if (!product) throw new Error("물품을 찾지 못했습니다.");
  if (typeof isEnabled !== "boolean") throw new Error("물품의 사용 여부를 선택해 주세요.");
  product.isEnabled = isEnabled;
}
