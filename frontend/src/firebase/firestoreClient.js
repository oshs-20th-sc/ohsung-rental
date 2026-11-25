import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { app, isEmulator } from "./client.js";

export const db = app ? getFirestore(app) : null;

if (isEmulator) connectFirestoreEmulator(db, "127.0.0.1", 8080);
