// jobs.js
// Auth gate, navbar load, read from /Jobs, render with filters & search

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getDatabase, ref, onValue, get, child, query, orderByChild } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

const app = getApp();
const auth = getAuth(app);
const db = getDatabase(app);

// DOM
const navbarContainer = document.getElementById("navbar-container");
const tbody = document.getElementById("jobsTbody");
const statusFilter = document.getElementById("statusFilter");
const searchInput = document.getElementById("searchInput");
const summaryText = document.getElementById("summaryText");
const lastUpdated = document.getElementById("lastUpdated");

/* =========================
   NAVBAR: load + username + signout
   ========================= */
async function loadNavbar() {
  try {
    const res = await fetch("assets/navbar.html", { cache: "no-store" });
    const html = await res.text();
    navbarContainer.innerHTML = html;

    setActiveNav("jobs.html");  // underline current tab
    populateUserName();         // fill pill or legacy text
    wireSignOut();              // make the button actually sign out
  } catch (e) {
    console.warn("Navbar load failed:", e);
  }
}

function setActiveNav(page) {
  navbarContainer.querySelectorAll(".nav-link").forEach(a => {
    const isHere = a.getAttribute("href")?.endsWith(page);
    a.classList.toggle("active", !!isHere);
  });
}

function populateUserName() {
  const user = auth.currentUser;
  const pillEl = navbarContainer.querySelector("#userName");   // pill version
  const legacyEl = navbarContainer.querySelector("#whoami");   // "Logged in as: …"

  const fallback = (user && user.email) ? user.email.split("@")[0] : "guest";
  let baseName = (user && user.displayName) ? user.displayName : fallback;

  const apply = (name) => {
    const val = String(name || "guest");
    if (pillEl) pillEl.textContent = val.toLowerCase();
    if (legacyEl) legacyEl.textContent = `Logged in as: ${val}`;
  };

  apply(baseName);

  // Try Realtime DB /users/{uid}/name if available
  if (user?.uid) {
    get(child(ref(db), `users/${user.uid}/name`))
      .then(s => { if (s.exists() && s.val()) apply(s.val()); })
      .catch(() => {});
  }
}

function wireSignOut() {
  const btn = navbarContainer.querySelector("#signOutBtn, #btnSignOut, [data-signout]");
  if (!btn) return;

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Signing out…";
    try {
      // dynamic import so we don't touch import lines at the top
      const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js");
      await signOut(auth);
      location.replace("index.html"); // or login.html
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = original;
      alert("Sign out failed.");
    }
  });
}

/* =========================
   ADMIN CHECK
   ========================= */
async function requireAdmin(user) {
  const roleSnap = await get(child(ref(db), `users/${user.uid}/role`));
  const role = roleSnap.exists() ? roleSnap.val() : null;
  if (role !== "admin") {
    window.location.href = "unauthorized.html";
    return false;
  }
  return true;
}

/* =========================
   TECHNICIANS CACHE
   ========================= */
let allJobs = [];
let technicians = {}; // uid -> {name, phone}

async function loadTechnicians() {
  const snap = await get(child(ref(db), "users"));
  if (!snap.exists()) return;
  const data = snap.val() || {};
  for (const [uid, u] of Object.entries(data)) {
    if (u && u.role === "technician") {
      technicians[uid] = {
        name: u.name || `Technician ${uid.slice(0, 6)}`,
        phone: u.phone || ""
      };
    }
  }
}

/* =========================
   JOBS STREAM
   ========================= */
function subscribeJobs() {
  const jobsRef = query(ref(db, "Jobs"), orderByChild("createdAt"));
  onValue(jobsRef, snap => {
    const raw = snap.val() || {};
    allJobs = normalizeJobs(raw);
    render();
    touchUpdated();
  }, err => console.error(err));
}

function normalizeJobs(raw) {
  // /Jobs/{pushId}: { displayId, serviceType, status, assignedTo, vehicleNo, createdAt, createdBy, notes }
  const list = [];
  for (const [id, j] of Object.entries(raw)) {
    if (!j || typeof j !== "object") continue;
    list.push({
      id,
      displayId: j.displayId || id,
      serviceType: j.serviceType || "",
      status: j.status || "pending",
      assignedTo: j.assignedTo || "",
      vehicleNo: j.vehicleNo || "",
      createdAt: j.createdAt || 0,
      createdBy: j.createdBy || "",
      notes: j.notes || ""
    });
  }
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function labelize(s) { return String(s || "—").replace(/_/g, " "); }
function statusBadgeClass(status) { return `badge-status ${status}`; }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const statusSel = statusFilter.value;

  const filtered = allJobs.filter(j => {
    if (statusSel && j.status !== statusSel) return false;
    if (!q) return true;
    const hay = [
      j.displayId, j.serviceType, j.vehicleNo, j.notes,
      j.id, j.status, technicians[j.assignedTo]?.name
    ].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });

  tbody.innerHTML = "";
  for (const j of filtered) {
    const tech = technicians[j.assignedTo];
    const assignedName = tech?.name || (j.assignedTo || "—");
    const phoneLine = tech?.phone ? `<div class="muted">${escapeHtml(tech.phone)}</div>` : "";

    const tr = document.createElement("tr");
    tr.className = "job-row";
    tr.innerHTML = `
      <td><span class="job-icon"><i class="bi bi-wrench"></i></span></td>
      <td>
        <div class="title">${escapeHtml(j.displayId)}</div>
        <div class="muted">Created by: ${escapeHtml(j.createdBy || "—")}</div>
      </td>
      <td><span class="badge ${statusBadgeClass(j.status)}">${escapeHtml(labelize(j.status))}</span></td>
      <td>${escapeHtml(assignedName)}${phoneLine}</td>
      <td class="text-capitalize">${escapeHtml(j.serviceType || "—")}</td>
      <td>${escapeHtml(j.vehicleNo || "—")}</td>
      <td>${escapeHtml(formatDate(j.createdAt))}</td>
      <td>${escapeHtml(j.notes || "—")}</td>
    `;
    tbody.appendChild(tr);
  }

  summaryText.textContent = `${filtered.length} job${filtered.length === 1 ? "" : "s"}`;
}

function touchUpdated() {
  lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

statusFilter.addEventListener("change", render);
searchInput.addEventListener("input", render);

/* =========================
   AUTH FLOW
   ========================= */
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  await loadNavbar();
  if (!(await requireAdmin(user))) return;
  await loadTechnicians();
  subscribeJobs();
});
