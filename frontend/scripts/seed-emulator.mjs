import process from "node:process";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { demoAccounts, demoPassword, demoProducts, demoRentals } from "../src/services/demoData.js";
import { migrateInventory } from "./migrate-inventory.mjs";

const projectId = "demo-ohsung-rental";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.METADATA_SERVER_DETECTION = "none";

async function createOrReadAccount(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    return auth.createUser({ email, password: demoPassword });
  }
}

const adminApp = initializeApp({ projectId }, "seed-ohsung-rental-emulator");
const db = getFirestore(adminApp);
const auth = getAuth(adminApp);
const accounts = new Map();

try {
  for (const [email, demoAccount] of Object.entries(demoAccounts)) {
    const account = await createOrReadAccount(auth, email);
    const { uid } = account;
    const { name, isAdmin, studentId } = demoAccount;
    accounts.set(demoAccount.id, { uid, name });

    if (studentId) {
      await auth.setCustomUserClaims(uid, { student_id: studentId });
      await db.doc(`users/${uid}`).set({ name, studentId });
    } else {
      await db.doc(`users/${uid}`).set({ name });
      if (isAdmin) await db.doc(`roles/${uid}`).set({ admin: true });
    }
  }

  const marker = await db.doc("inventorySettings/v1").get();
  if (marker.exists && marker.get("ready") === true) {
    await migrateInventory(db);
    console.log("Emulator 재고가 이미 준비되어 있어 기존 물품과 번호 자료를 확인했습니다.");
  } else {
    for (const { id, ...product } of demoProducts) {
      const reference = db.doc(`products/${id}`);
      const snapshot = await reference.get();
      if (!snapshot.exists) {
        await reference.set({ ...product, isEnabled: true });
      } else if (!Object.hasOwn(snapshot.data(), "isEnabled")) {
        await reference.update({ isEnabled: true });
      }
    }

    for (const { id, userId, rentedAt, ...rental } of demoRentals) {
      const reference = db.doc(`rentals/${id}`);
      if (!(await reference.get()).exists) {
        await reference.set({
          ...rental,
          userId: accounts.get(userId).uid,
          borrowerName: accounts.get(userId).name,
          rentedAt: new Date(rentedAt),
        });
      }
    }

    const result = await migrateInventory(db, { apply: true });
    console.log(`Emulator에 가상 재고를 준비했습니다. 물품 ${result.totalProducts}개 · 번호 예약 ${result.totalReservations + result.newReservations.length}개`);
  }
} finally {
  await deleteApp(adminApp);
}
