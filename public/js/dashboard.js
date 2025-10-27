// js/dashboard.js — real-time child listeners, instant rows after creation,
// fallback ordering using Firebase push-id timestamp, KPIs kept in sync.

import { auth, onAuthStateChanged, signOut, rtdb } from "./firebase.js";
import {
  ref, child, get, onChildAdded, onChildChanged, onChildRemoved, onValue
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

/* ---------------- navbar helpers ---------------- */
function setWhoAmI(text) {
  // supports old (#whoami) and new (#userName) navbar markup
  const el = document.getElementById("whoami") || document.getElementById("userName");
  if (el) el.textContent = text;
}
function wireSignOut() {
  // supports old (#btnSignOut) and new (#signOutBtn) IDs
  const btn = document.getElementById("btnSignOut") || document.getElementById("signOutBtn");
  if (btn && !btn.__wired) {
    btn.addEventListener("click", async () => { await signOut(auth); });
    btn.__wired = true;
  }
}

/* ---------------- DOM refs ---------------- */
const el = {
  techs: document.getElementById("kpiTechs"),
  open: document.getElementById("kpiOpen"),
  tbody: document.getElementById("jobsTableBody"),
  btnCreate: document.getElementById("btnCreateJob"),
};

/* ---------------- constants ---------------- */
const USERS_NODE = "users";
const JOBS_NODE  = "Jobs";
const NAME_FIELDS = ["name", "displayName", "fullName", "username", "email"];

/* ---------------- state ---------------- */
let usersMap = {};                  // uid -> {name, phone, role...}
const jobsByKey = new Map();        // key -> normalized job
const nameCache = new Map();        // uid -> display name

/* ---------------- auth gate ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  resolveAdminName(user.uid, user.email).then(setWhoAmI);
  wireSignOut();

  subscribeUsers();
  streamJobs();        // child listeners, instant recovery
  wireCreateButton();
});

/* ---------------- identities ---------------- */
async function resolveAdminName(uid, fallbackEmail = "") {
  try {
    const s = await get(ref(rtdb, `${USERS_NODE}/${uid}`));
    const obj = s.val() || {};
    for (const f of NAME_FIELDS) if (obj[f]) return String(obj[f]);
  } catch (_) { /* ignore */ }
  if (fallbackEmail && fallbackEmail.includes("@")) return fallbackEmail.split("@")[0];
  return uid || "Admin";
}

function subscribeUsers() {
  onValue(ref(rtdb, USERS_NODE), (snap) => {
    usersMap = snap.val() || {};
    rerender(); // update names/phones in table
  }, (err) => console.error("users subscribe failed:", err));
}

function lookupTech(uidish) {
  if (!uidish) return { name: "-", phone: "" };
  const uid = String(uidish);
  if (nameCache.has(uid)) return { name: nameCache.get(uid), phone: usersMap?.[uid]?.phone || "" };

  const u = usersMap?.[uid] || {};
  for (const f of NAME_FIELDS) {
    if (u[f]) { nameCache.set(uid, u[f]); return { name: u[f], phone: u.phone || "" }; }
  }
  get(child(ref(rtdb), `${USERS_NODE}/${uid}`)).then(s => {
    const obj = s.val() || {};
    for (const f of NAME_FIELDS) {
      if (obj[f]) { nameCache.set(uid, obj[f]); rerender(); return; }
    }
    nameCache.set(uid, uid); rerender();
  }).catch(() => { nameCache.set(uid, uid); rerender(); });

  return { name: nameCache.get(uid) || uid, phone: "" };
}

/* ---------------- jobs stream ---------------- */
/* Firebase push-id alphabet for timestamp decoding */
const PUSH_ALPH = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
const PUSH_MAP = Object.fromEntries([...PUSH_ALPH].map((c,i)=>[c,i]));
function pushIdToMs(id="") {
  // Decode first 8 chars base-64 variant -> 48-bit ms timestamp
  let ts = 0;
  for (let i=0;i<8;i++) {
    const c = id[i];
    if (c == null || !(c in PUSH_MAP)) return 0;
    ts = ts * 64 + PUSH_MAP[c];
  }
  return ts;
}

function streamJobs() {
  const jobsRef = ref(rtdb, `${JOBS_NODE}`);

  onChildAdded(jobsRef, (snap) => {
    const raw = { _key: snap.key, ...(snap.val() || {}) };
    jobsByKey.set(snap.key, normalizeJob(raw));
    rerender();
  });

  onChildChanged(jobsRef, (snap) => {
    const raw = { _key: snap.key, ...(snap.val() || {}) };
    jobsByKey.set(snap.key, normalizeJob(raw));
    rerender();
  });

  onChildRemoved(jobsRef, (snap) => {
    jobsByKey.delete(snap.key);
    rerender();
  });
}

function wireCreateButton() {
  if (el.btnCreate && !el.btnCreate.__wired) {
    el.btnCreate.addEventListener("click", () => { window.location.href = "create-job.html"; });
    el.btnCreate.__wired = true;
  }
}

/* ---------------- normalization + rendering ---------------- */
function parseTs(val) {
  if (val == null || val === "") return 0;
  if (typeof val === "number") return val > 0 ? val : 0;
  const n = Number(val);
  if (!Number.isNaN(n) && n > 0) return n;
  const t = Date.parse(String(val));
  return Number.isNaN(t) ? 0 : t;
}

function normalizeStatus(s) {
  const k = String(s || "open").toLowerCase().replace(/[_\s-]+/g, "");
  if (k.startsWith("comp") || ["done","resolved","workshop","warranty","cancelled"].includes(k)) return "completed";
  if (k.startsWith("inprog") || ["onhold","paused","assigned","queued","pending"].includes(k)) return "in-progress";
  if (["open","new","created"].includes(k)) return "open";
  return "open";
}

function normalizeJob(j) {
  const createdAt   = parseTs(j.createdAt) || pushIdToMs(j._key);  // fallback to push-id time
  const updatedAt   = parseTs(j.updatedAt);
  const completedAt = parseTs(j.completedAt);

  const assignedTo =
    j.assignedTo ?? j.technicianUid ?? j.technicianId ?? j.assignee ?? j.assigned_by;

  const vehicleNo =
    j.vehicleNo ?? j.vehicle ?? j.plateNo ?? j.plate ?? j.registration ?? j.regNo ?? "-";

  const serviceType =
    j.serviceType ?? j.service ?? j.jobType ?? j.title ?? "-";

  const idFallback = createdAt ? `JOB-${createdAt}` : j._key;

  return {
    ...j,
    createdAt,
    updatedAt,
    completedAt,
    assignedTo,
    vehicleNo,
    serviceType,
    status: normalizeStatus(j.status),
    displayId: j.displayId ?? j.jobId ?? j.id ?? j.code ?? idFallback,
    notes: j.notes ?? ""
  };
}

function statusBadge(status) {
  const s = normalizeStatus(status);
  const label = s === "in-progress" ? "Pending" : s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ");
  const cls = s === "completed" ? "ok" : s === "in-progress" ? "warn" : "meh";
  return `<span class="badge ${cls}">${label}</span>`;
}

function fmtDate(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleDateString([], { day:"2-digit", month:"short", year:"numeric" }) + ", " +
         d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
}

function trunc(s, n = 80) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function renderRows(list) {
  if (!el.tbody) return;
  if (!list.length) {
    el.tbody.innerHTML = `<tr><td colspan="7" class="muted">No jobs yet.</td></tr>`;
    return;
  }
  el.tbody.innerHTML = list.map(v => {
    const tech = lookupTech(v.assignedTo);
    const createdByName = (usersMap?.[v.createdBy]?.name) || v.createdBy || "-";
    return `
    <tr class="status-${normalizeStatus(v.status)}">
      <td>
        <div style="display:flex;align-items:center">
          <span class="icon-pill">
            <svg class="icon-wrench" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M22 19.59 19.59 22 14 16.41l2.41-2.41L22 19.59zM7 14a7 7 0 1 1 5-11.9l-2.7 2.7a3 3 0 1 0 4.24 4.24l2.7-2.7A7 7 0 0 1 7 14z"/>
            </svg>
          </span>
          <span class="id-cell">${v.displayId}</span>
        </div>
        <span class="sub">Created by: ${createdByName}</span>
      </td>
      <td>${statusBadge(v.status)}</td>
      <td class="td-person">
        ${tech.name || "-"}
        ${tech.phone ? `<span class="phone">${tech.phone}</span>` : ``}
      </td>
      <td>${v.serviceType}</td>
      <td>${v.vehicleNo}</td>
      <td>${fmtDate(v.createdAt)}</td>
      <td class="td-notes">${trunc(v.notes, 80)}</td>
    </tr>`;
  }).join("");
}

function rerender() {
  // Build a sorted array every time something changes
  const all = Array.from(jobsByKey.values());
  all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  renderRows(all.slice(0, 10));
  updateKPIs(all);
}

/* ---------------- KPIs ---------------- */
function setKPI(node, val) { if (node) node.textContent = String(val); }
function isOpenForKPI(s) { return normalizeStatus(s) !== "completed"; }

function updateKPIs(allJobs) {
  refreshTechCount().catch(e => {
    console.error("kpi techs:", e);
    setKPI(el.techs, "—");
  });
  let open = 0;
  for (const j of allJobs) if (isOpenForKPI(j.status)) open++;
  setKPI(el.open, open);
}

async function refreshTechCount() {
  const usersSnap = await get(ref(rtdb, USERS_NODE));
  let techs = 0;
  usersSnap.forEach(c => {
    const v = c.val();
    if (v && String(v.role).toLowerCase() === "technician") techs++;
  });
  setKPI(el.techs, techs);
}
