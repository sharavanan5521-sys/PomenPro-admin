// performance.js - Admin Performance page logic
// Assumes js/firebase.js already initializes Firebase App via CDN v10 modular.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getDatabase, ref, child, get, onValue,
  query, orderByChild, orderByKey, equalTo,
  limitToLast, push, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

// ---------- Tunables (change thresholds to match your rubric)
const THRESH = {
  efficiency: 0.85,
  productivity: 0.80,
  proficiency: 0.80,
  rating: 4.0,
  minJobsIfFullDay: 3,
  fullDayMinutes: 420  // treat >= this as "full day"
};

// ---------- DOM
const techSelect = document.getElementById('techSelect');
const techInfo = document.getElementById('techInfo');
const tName = document.getElementById('tName');
const tEmail = document.getElementById('tEmail');
const tPhone = document.getElementById('tPhone');
const tAddress = document.getElementById('tAddress');
const tUid = document.getElementById('tUid');

const mEfficiency = document.getElementById('mEfficiency');
const mProductivity = document.getElementById('mProductivity');
const mProficiency = document.getElementById('mProficiency');
const mRating = document.getElementById('mRating');
const mJobs = document.getElementById('mJobs');
const mTime = document.getElementById('mTime');

const recText = document.getElementById('recText');
const recReasons = document.getElementById('recReasons');
const btnSendTraining = document.getElementById('btnSendTraining');
const trainStatus = document.getElementById('trainStatus');
const rawStats = document.getElementById('rawStats');

// ---------- Firebase
const app = getApp();
const auth = getAuth(app);
const db = getDatabase(app);

// ---------- State
let currentAdminUid = null;
let currentTech = null;         // { uid, name, email, phone, address }
let currentSnapshot = null;     // latest daily or fallback stats
let currentRecommendation = null;

// ---------- Helpers for navbar (since it's injected after page load)
function waitForEl(selector, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const obs = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
      obs.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeoutMs);
  });
}

async function setNavbarName(name) {
  try {
    const pill = await waitForEl('#userPill');
    const userNameEl = pill.querySelector('#userName');
    if (userNameEl) userNameEl.textContent = name || 'admin';
  } catch { /* ignore */ }
}

async function wireSignOut() {
  try {
    const btn = await waitForEl('#signOutBtn');
    btn.addEventListener('click', async () => {
      try {
        await signOut(auth);
      } finally {
        window.location.href = 'index.html';
      }
    });
  } catch { /* ignore */ }
}

// ---------- Bootstrap
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    techSelect.innerHTML = `<option disabled selected>Please sign in first</option>`;
    return;
  }
  currentAdminUid = user.uid;

  // Load admin display name for navbar
  // Try RTDB /users/{uid}/name; fallback to email prefix
  let displayName = null;
  try {
    const uSnap = await get(ref(db, `users/${currentAdminUid}`));
    const u = uSnap.exists() ? uSnap.val() : null;
    displayName = (u && (u.name || u.displayName)) || (user.email ? user.email.split('@')[0] : 'admin');
  } catch {
    displayName = (user.email ? user.email.split('@')[0] : 'admin');
  }
  setNavbarName(displayName);
  wireSignOut();

  loadTechnicians();
});

// ---------- Load technicians (users where role === "technician")
async function loadTechnicians() {
  const usersRef = ref(db, 'users');
  const snap = await get(usersRef);

  const list = [];
  if (snap.exists()) {
    snap.forEach(child => {
      const v = child.val();
      if (v && v.role === 'technician') {
        list.push({ uid: child.key, ...v });
      }
    });
  }

  if (!list.length) {
    techSelect.innerHTML = `<option disabled selected>No technicians found</option>`;
    return;
  }

  techSelect.innerHTML = `<option value="" disabled selected>Select technician…</option>`
    + list.map(t => {
      const label = [t.name || 'Unnamed', t.email || '', t.phone ? `(${t.phone})` : '']
        .filter(Boolean).join(' ');
      return `<option value="${t.uid}">${label}</option>`;
    }).join('');

  techSelect.addEventListener('change', () => {
    const uid = techSelect.value;
    const picked = list.find(x => x.uid === uid);
    currentTech = picked || { uid };
    showTechIdentity(currentTech);
    loadPerformanceFor(uid);
  });
}

// ---------- Show the technician identity card
function showTechIdentity(t) {
  techInfo.classList.remove('hidden');
  tName.textContent = t.name || '—';
  tEmail.textContent = t.email || '—';
  tPhone.textContent = t.phone || '—';
  tAddress.textContent = t.address || '—';
  tUid.textContent = t.uid;
}

// ---------- Load performance
async function loadPerformanceFor(uid) {
  // Try latest daily snapshot: /performance/{uid}/[lastKey]
  const perfBase = ref(db, `performance/${uid}`);
  const latestQ = query(perfBase, orderByKey(), limitToLast(1));
  const latestSnap = await get(latestQ);

  let daily = null;
  if (latestSnap.exists()) {
    latestSnap.forEach(ch => { daily = { key: ch.key, ...ch.val() }; });
  }

  // Fallback: technicianStats/{uid}
  const fallbackRef = ref(db, `technicianStats/${uid}`);
  const fallbackSnap = await get(fallbackRef);
  const fallback = fallbackSnap.exists() ? fallbackSnap.val() : null;

  const stats = buildStats(daily, fallback);
  currentSnapshot = stats;
  renderMetrics(stats);
  decideTraining(stats);
  rawStats.textContent = JSON.stringify({ daily, technicianStats: fallback }, null, 2);

  // Wire the button only after we know the recommendation
  btnSendTraining.onclick = () => sendTrainingIfNeeded(uid);
}

// ---------- Normalize stats into one shape for UI
function buildStats(daily, fallback) {
  const s = {
    availableMinutes: daily?.availableMinutes ?? null,
    actualMinutes: daily?.actualMinutes ?? null,
    billedMinutes: daily?.billedMinutes ?? null,
    efficiency: daily?.efficiency ?? null,
    productivity: daily?.productivity ?? null,
    proficiency: daily?.proficiency ?? null,
    avgRating: daily?.avgRating ?? null,
    jobsCompleted: daily?.jobsCompleted ?? null,
    updatedAt: daily?.updatedAt ?? null,
    // fallback rollups
    avgDurationMs: fallback?.avgDurationMs ?? null,
    totalDurationMs: fallback?.totalDurationMs ?? null,
    jobsCompletedTotal: fallback?.jobsCompleted ?? null
  };
  return s;
}

// ---------- Render metric cards
function renderMetrics(s) {
  setValue(mEfficiency, ratio(s.efficiency));
  setValue(mProductivity, ratio(s.productivity));
  setValue(mProficiency, ratio(s.proficiency));
  setValue(mRating, s.avgRating != null ? s.avgRating.toFixed(1) : '—');
  setValue(mJobs, s.jobsCompleted ?? s.jobsCompletedTotal ?? '—');

  const timeStr = [
    s.actualMinutes != null ? `${s.actualMinutes}m` : '—',
    s.availableMinutes != null ? `${s.availableMinutes}m` : '—',
    s.billedMinutes != null ? `${s.billedMinutes}m` : '—'
  ].join(' / ');
  setValue(mTime, timeStr);

  // Color hints
  stateColor(mEfficiency, goodWarnBad(s.efficiency, THRESH.efficiency));
  stateColor(mProductivity, goodWarnBad(s.productivity, THRESH.productivity));
  stateColor(mProficiency, goodWarnBad(s.proficiency, THRESH.proficiency));
  stateColor(mRating, s.avgRating == null ? null :
    s.avgRating >= THRESH.rating ? 'good' : s.avgRating >= THRESH.rating - 0.2 ? 'warn' : 'bad');
}

function ratio(v){
  return v != null ? (Math.round(v*1000)/1000).toFixed(3) : '—';
}
function setValue(el, text){ el.textContent = text; }
function stateColor(el, state){
  if (!state){ el.removeAttribute('data-state'); return; }
  el.setAttribute('data-state', state);
}
function goodWarnBad(v, min){
  if (v == null) return null;
  if (v >= min) return 'good';
  if (v >= min - 0.05) return 'warn';
  return 'bad';
}

// ---------- Training recommendation
function decideTraining(s) {
  const reasons = [];

  if (num(s.efficiency) < THRESH.efficiency) reasons.push(`Efficiency low (${ratio(s.efficiency)})`);
  if (num(s.productivity) < THRESH.productivity) reasons.push(`Productivity low (${ratio(s.productivity)})`);
  if (num(s.proficiency) < THRESH.proficiency) reasons.push(`Proficiency low (${ratio(s.proficiency)})`);
  if (num(s.avgRating) < THRESH.rating) reasons.push(`Avg rating below ${THRESH.rating} (${s.avgRating ?? '—'})`);
  if (num(s.availableMinutes) >= THRESH.fullDayMinutes && num(s.jobsCompleted) < THRESH.minJobsIfFullDay) {
    reasons.push(`Few jobs for a full day (${s.jobsCompleted ?? 0})`);
  }

  if (!reasons.length) {
    currentRecommendation = { needed: false, module: null, reasons: [] };
    recText.textContent = "No training needed based on latest snapshot.";
    recReasons.innerHTML = "";
    btnSendTraining.disabled = true;
    trainStatus.textContent = "";
    return;
  }

  // pick module by the weakest KPI
  const module = chooseModule(s);
  currentRecommendation = { needed: true, module, reasons };
  recText.textContent = `Recommended module: "${module}"`;
  recReasons.innerHTML = reasons.map(r => `<li>${r}</li>`).join('');
  btnSendTraining.disabled = false;
  trainStatus.textContent = "";
}

function num(v){ return typeof v === 'number' ? v : Number.NaN; }

function chooseModule(s) {
  const deltas = [
    ['Time Management & Workflow', clamp(THRESH.efficiency - (s.efficiency ?? 0), 0, 1)],
    ['Billing Accuracy & Estimation', clamp(THRESH.productivity - (s.productivity ?? 0), 0, 1)],
    ['Core Diagnostics 101', clamp(THRESH.proficiency - (s.proficiency ?? 0), 0, 1)],
    ['Customer Service Basics', clamp(THRESH.rating - (s.avgRating ?? 0), 0, 5) / 5]
  ];
  deltas.sort((a,b) => b[1]-a[1]);
  return deltas[0][0];
}
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

// ---------- Send training
async function sendTrainingIfNeeded(techUid) {
  if (!currentRecommendation?.needed) {
    trainStatus.textContent = "No training required. Button is only here to look pretty.";
    return;
  }
  if (!currentAdminUid) {
    trainStatus.textContent = "Not signed in as admin.";
    return;
  }

  const path = ref(db, `trainings/${techUid}`);
  const newRef = push(path); // autoId
  const payload = {
    assignedBy: currentAdminUid,
    createdAt: serverTimestamp(),
    module: currentRecommendation.module,
    status: "scheduled"
  };

  btnSendTraining.disabled = true;
  trainStatus.textContent = "Assigning training…";
  try {
    await set(newRef, payload);
    trainStatus.textContent = "Training scheduled.";
  } catch (e) {
    btnSendTraining.disabled = false;
    trainStatus.textContent = `Failed: ${e.message}`;
  }
}
