// js/firebase.js
// Firebase Web v10 (CDN modular) — single initializer + hardened global

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBbVwWYZBWNR-BZn_d891GvdkjhXyqF_T0",
  authDomain: "pomenprotms.firebaseapp.com",
  databaseURL: "https://pomenprotms-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pomenprotms",
  storageBucket: "pomenprotms.appspot.com",
  messagingSenderId: "165417188011",
  appId: "1:165417188011:web:3835d85d6e9f16d23255ee"
};

// Initialize exactly once
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const rtdb = getDatabase(app);

// Persistence in a safe async wrapper (avoids top-level await flakiness)
(async () => {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    console.warn("[firebase] setPersistence warning:", e?.message || e);
  }
})();

// Stable hidden global for non-module consumers
if (!window.__pp) {
  Object.defineProperty(window, "__pp", {
    value: Object.freeze({ app, auth, rtdb, onAuthStateChanged }),
    writable: false,
    configurable: false,
    enumerable: false
  });
}

// Quiet in prod. If you want logs, set window.__DEV__ = true before this file loads.
if (window.__DEV__) {
  console.log("[firebase] initialized:", {
    projectId: app.options.projectId,
    db: rtdb.app.options.databaseURL
  });
}

// Re-exports for module pages
export { app, auth, rtdb, signInWithEmailAndPassword, onAuthStateChanged, signOut };
