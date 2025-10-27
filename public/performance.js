// performance.js - Admin Performance page logic (sessions-aware; slide formulas; no rawStats)
// Assumes js/firebase.js already initializes Firebase App via CDN v10 modular.

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getDatabase, ref, get,
  query, orderByKey, limitToLast, push, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

// ---------- Tunables (match your rubric)
const THRESH = {
  efficiency: 0.85,      // billed / actual
  productivity: 0.80,    // actual / available
  proficiency: 0.80,     // billed / available
  rating: 4.0,
  minJobsIfFullDay: 3,
  fullDayMinutes: 420
};

// If you do NOT want to assume billed = session duration when missing, set to false
const ASSUME_BILLED_FROM_DURATION = true;

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

// ---------- Firebase
const app = getApp();
const auth = getAuth(app);
const db = getDatabase(app);

// ---------- State
let currentAdminUid = null;
let currentTech = null;         // { uid, name, email, phone, address }
let currentSnapshot = null;     // normalized stats
let currentRecommendation = null;

// ---------- Helpers
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
    setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout waiting for ${selector}`)); }, timeoutMs);
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
      try { await signOut(auth); } finally { window.location.href = 'index.html'; }
    });
  } catch { /* ignore */ }
}

// number coercions
const toNum = v => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const toInt = v => {
  const n = toNum(v);
  return n == null ? null : Math.round(n);
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const msToMin = ms => Math.round(ms / 60000);

// Get local midnight range for "today" (adjust if you want server day)
function todayRangeMs() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end };
}

// Aggregate jobSessions for a technician within [startMs, endMs)
async function sessionAggregatesFor(techUid, startMs, endMs) {
  // Structure seen: /jobSessions/{jobId}/{sessionId} -> { durationMs, startTime, endTime, technicianId }
  // RTDB cannot query two levels deep by child, so we read /jobSessions once and filter.
  const root = await get(ref(db, 'jobSessions'));
  if (!root.exists()) return null;

  let totalDurationMs = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;
  const jobIds = new Set();

  root.forEach(jobNode => {
    jobNode.forEach(sessNode => {
      const s = sessNode.val();
      if (!s) return;
      if (String(s.technicianId) !== String(techUid)) return;

      const st = toNum(s.startTime);
      const et = toNum(s.endTime);
      const dur = toNum(s.durationMs);

      // Filter to the day window if we have timestamps
      if (st != null && et != null) {
        if (st >= startMs && st < endMs) {
          earliest = Math.min(earliest, st);
          latest = Math.max(latest, et);
          if (dur != null) totalDurationMs += Math.max(0, dur);
          jobIds.add(jobNode.key);
        }
      } else if (dur != null) {
        // No timestamps? Fine, treat as part of today if nothing else is available
        totalDurationMs += Math.max(0, dur);
        jobIds.add(jobNode.key);
      }
    });
  });

  if (latest < earliest) {
    earliest = Number.NaN;
    latest = Number.NaN;
  }

  const actualMinutes = msToMin(totalDurationMs);
  const inferredAvailable =
    Number.isFinite(earliest) && Number.isFinite(latest) && latest > earliest
      ? clamp(msToMin(latest - earliest), 1, THRESH.fullDayMinutes * 2) // cap silly spans
      : null;

  // If you don't store sold/billed hours elsewhere, assume billed = actual
  const billedMinutes = ASSUME_BILLED_FROM_DURATION ? actualMinutes : null;

  return {
    actualMinutes,
    billedMinutes,
    availableMinutesInferred: inferredAvailable,
    jobsCompletedViaSessions: jobIds.size
  };
}

// ---------- Bootstrap
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    techSelect.innerHTML = `<option disabled selected>Please sign in first</option>`;
    return;
  }
  currentAdminUid = user.uid;

  try {
    const uSnap = await get(ref(db, `users/${currentAdminUid}`));
    const u = uSnap.exists() ? uSnap.val() : null;
    const displayName = (u && (u.name || u.displayName)) || (user.email ? user.email.split('@')[0] : 'admin');
    setNavbarName(displayName);
  } catch {
    setNavbarName(user.email ? user.email.split('@')[0] : 'admin');
  }
  wireSignOut();
  loadTechnicians();
});

// ---------- Load technicians (users where role ~ "technician")
async function loadTechnicians() {
  const usersRef = ref(db, 'users');
  const snap = await get(usersRef);

  const list = [];
  if (snap.exists()) {
    snap.forEach(child => {
      const v = child.val();
      const role = String(v?.role || '').toLowerCase().trim();
      if (role === 'technician' || role === 'tech') list.push({ uid: child.key, ...v });
    });
  }

  if (!list.length) {
    techSelect.innerHTML = `<option disabled selected>No technicians found</option>`;
    return;
  }

  techSelect.innerHTML = `<option value="" disabled selected>Select technician…</option>` +
    list.map(t => {
      const label = [t.name || 'Unnamed', t.email || '', t.phone ? `(${t.phone})` : ''].filter(Boolean).join(' ');
      return `<option value="${t.uid}">${label}</option>`;
    }).join('');

  const freshSelect = techSelect.cloneNode(true);
  techSelect.parentNode.replaceChild(freshSelect, techSelect);
  freshSelect.addEventListener('change', () => {
    const uid = freshSelect.value;
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
  // 1) Latest daily snapshot: /performance/{uid}/[lastKey]
  const perfBase = ref(db, `performance/${uid}`);
  const latestQ = query(perfBase, orderByKey(), limitToLast(1));
  const latestSnap = await get(latestQ);

  let daily = null;
  if (latestSnap.exists()) {
    latestSnap.forEach(ch => { daily = { key: ch.key, ...ch.val() }; });
  }

  // 2) Fallback rollups: technicianStats/{uid}
  const fallbackRef = ref(db, `technicianStats/${uid}`);
  const fallbackSnap = await get(fallbackRef);
  const fallback = fallbackSnap.exists() ? fallbackSnap.val() : null;

  // 3) Sessions for today window
  const { start, end } = todayRangeMs();
  const sessAgg = await sessionAggregatesFor(uid, start, end);

  const stats = buildStats(daily, fallback, sessAgg);
  currentSnapshot = stats;
  renderMetrics(stats);
  decideTraining(stats);

  btnSendTraining.onclick = () => sendTrainingIfNeeded(uid);
}

// ---------- Normalize stats with sessions
function buildStats(daily, fallback, sessAgg) {
  const d = daily || {};
  const f = fallback || {};
  const s = sessAgg || {};

  // direct values (prefer daily/fallback; sessions fill gaps)
  const availableMinutes = pickInt(d.availableMinutes, f.availableMinutes, s.availableMinutesInferred, THRESH.fullDayMinutes);
  const actualMinutes    = pickInt(d.actualMinutes,    f.actualMinutes,    s.actualMinutes,            null);
  const billedMinutes    = pickInt(d.billedMinutes,    f.billedMinutes,    s.billedMinutes,            null);
  const jobsCompletedDay = pickInt(d.jobsCompleted,    null,               s.jobsCompletedViaSessions, null);
  const jobsCompletedTot = pickInt(f.jobsCompleted,    null,               null,                       null);

  let efficiency   = toNum(d.efficiency);
  let productivity = toNum(d.productivity);
  let proficiency  = toNum(d.proficiency);
  let avgRating    = toNum(d.avgRating ?? f.avgRating);

  // === Slide-defined formulas ===
  // Productivity = Actual / Available
  if (productivity == null && isPos(actualMinutes) && isPos(availableMinutes)) {
    productivity = clamp(actualMinutes / availableMinutes, 0, 1);
  }

  // Efficiency = Billed / Actual
  if (efficiency == null && isPos(billedMinutes) && isPos(actualMinutes)) {
    efficiency = clamp(billedMinutes / actualMinutes, 0, 1);
  }

  // Proficiency = Billed / Available
  if (proficiency == null && isPos(billedMinutes) && isPos(availableMinutes)) {
    proficiency = clamp(billedMinutes / availableMinutes, 0, 1);
  }

  return {
    availableMinutes,
    actualMinutes,
    billedMinutes,
    efficiency,
    productivity,
    proficiency,
    avgRating,
    jobsCompleted: jobsCompletedDay,
    jobsCompletedTotal: jobsCompletedTot,
    updatedAt: d.updatedAt ?? f.updatedAt ?? null
  };
}

function pickInt(...vals) {
  for (const v of vals) {
    const n = toInt(v);
    if (n != null && Number.isFinite(n)) return n;
  }
  return null;
}
function isPos(v){ return typeof v === 'number' && v > 0; }

// ---------- Render metric cards
function renderMetrics(s) {
  setValue(mEfficiency, ratio(s.efficiency));
  setValue(mProductivity, ratio(s.productivity));
  setValue(mProficiency, ratio(s.proficiency));
  setValue(mRating, s.avgRating != null ? s.avgRating.toFixed(1) : '—');

  const jobsForDisplay = s.jobsCompleted ?? s.jobsCompletedTotal ?? null;
  setValue(mJobs, jobsForDisplay != null ? jobsForDisplay : '—');

  const timeStr = [
    s.actualMinutes != null ? `${s.actualMinutes}m` : '—',
    s.availableMinutes != null ? `${s.availableMinutes}m` : '—',
    s.billedMinutes != null ? `${s.billedMinutes}m` : '—'
  ].join(' / ');
  setValue(mTime, timeStr);

  stateColor(mEfficiency, goodWarnBad(s.efficiency, THRESH.efficiency));
  stateColor(mProductivity, goodWarnBad(s.productivity, THRESH.productivity));
  stateColor(mProficiency, goodWarnBad(s.proficiency, THRESH.proficiency));
  stateColor(mRating, s.avgRating == null ? null :
    s.avgRating >= THRESH.rating ? 'good' : s.avgRating >= THRESH.rating - 0.2 ? 'warn' : 'bad');
}

function ratio(v){ return v != null ? (Math.round(v*1000)/1000).toFixed(3) : '—'; }
function setValue(el, text){ el.textContent = text; }
function stateColor(el, state){ if (!state){ el.removeAttribute('data-state'); return; } el.setAttribute('data-state', state); }
function goodWarnBad(v, min){ if (v == null) return null; if (v >= min) return 'good'; if (v >= min - 0.05) return 'warn'; return 'bad'; }

// ---------- Training recommendation
function decideTraining(s) {
  const reasons = [];
  if (num(s.efficiency) < THRESH.efficiency) reasons.push(`Efficiency low (${ratio(s.efficiency)})`);
  if (num(s.productivity) < THRESH.productivity) reasons.push(`Productivity low (${ratio(s.productivity)})`);
  if (num(s.proficiency) < THRESH.proficiency) reasons.push(`Proficiency low (${ratio(s.proficiency)})`);
  if (num(s.avgRating) < THRESH.rating) reasons.push(`Avg rating below ${THRESH.rating} (${s.avgRating ?? '—'})`);

  const jobsForLogic = s.jobsCompleted ?? s.jobsCompletedTotal ?? 0;
  const avail = num(s.availableMinutes);
  if (Number.isFinite(avail) && avail >= THRESH.fullDayMinutes && jobsForLogic < THRESH.minJobsIfFullDay) {
    reasons.push(`Few jobs for a full day (${jobsForLogic})`);
  }

  if (!reasons.length) {
    currentRecommendation = { needed: false, module: null, reasons: [] };
    recText.textContent = "No training needed based on latest snapshot.";
    recReasons.innerHTML = "";
    btnSendTraining.disabled = true;
    trainStatus.textContent = "";
    return;
  }

  const module = chooseModule(s);
  currentRecommendation = { needed: true, module, reasons };
  recText.textContent = `Recommended module: "${module}"`;
  recReasons.innerHTML = reasons.map(r => `<li>${r}</li>`).join('');
  btnSendTraining.disabled = false;
  trainStatus.textContent = "";
}

function num(v){ return typeof v === 'number' ? v : toNum(v); }

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
  const newRef = push(path);
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
