// technicians.js — final fixed version (uses rtdb from your firebase.js)

import { rtdb as db, app } from "./js/firebase.js";
import {
  ref, query, orderByChild, equalTo, get, push, set, update, remove
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js"; // ← added signOut

(() => {
  // DOM references
  const tbody = document.getElementById("tbodyTech");
  const searchBox = document.getElementById("searchBox");
  const countBadge = document.getElementById("countBadge");
  const btnAdd = document.getElementById("btnAdd");

  const modalEl = document.getElementById("techModal");
  const toastEl = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");

  const form = document.getElementById("techForm");
  const fldId = document.getElementById("techId");
  const fldName = document.getElementById("name");
  const fldEmail = document.getElementById("email");
  const fldPhone = document.getElementById("phone");
  const fldRole = document.getElementById("role");
  const fldAddress = document.getElementById("address");
  const modalTitle = document.getElementById("modalTitle");

  if (!tbody || !searchBox || !countBadge || !form) {
    console.error("technicians.js: required DOM elements missing.");
    return;
  }

  const modal = modalEl ? new bootstrap.Modal(modalEl) : null;
  const toast = toastEl && toastMsg ? new bootstrap.Toast(toastEl, { delay: 2600 }) : null;

  // --- NAVBAR LOAD + SIGNOUT + USERNAME INJECTION ---
  let pendingUserName = null; // holds name until navbar HTML mounts

  fetch("assets/navbar.html").then(r=>r.text()).then(html=>{
    document.getElementById("navbar-mount").innerHTML = html;

    // mark current page active
    const link = document.querySelector('a.nav-link[href*="technician"]') || document.querySelector('a.nav-link[href*="technicians"]');
    if (link) link.classList.add("active");

    // Sign Out: match your actual ID + some fallbacks
    const signoutBtn =
      document.querySelector("#signOutBtn") ||
      document.querySelector("#btnSignOut") ||
      document.querySelector("[data-signout]") ||
      document.querySelector('[data-action="signout"]') ||
      document.querySelector('a[href="#signout"]');

    if (signoutBtn) {
      signoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await signOut(getAuth());
          notify("Signed out.");
          window.location.href = "index.html";
        } catch (err) {
          notify("Sign out failed: " + (err?.message || err));
          console.error(err);
        }
      });
    }

    // if we already know the name (auth fired first), drop it in now
    if (pendingUserName) applyUserNameToNavbar(pendingUserName);

  }).catch(()=>{});

  // Diagnostics banner
  const banner = document.createElement("div");
  banner.className = "alert alert-warning d-none mt-3";
  banner.id = "diag";
  (document.querySelector(".card .card-body") || document.querySelector("main") || document.body).prepend(banner);
  const cfg = app?.options || {};
  function diag(msg){ banner.textContent = String(msg); banner.classList.remove("d-none"); }
  function clearDiag(){ banner.classList.add("d-none"); }

  // Auth gate
  const auth = getAuth();
  onAuthStateChanged(auth, async user => {
    if (!user) {
      diag(`Not signed in. Rules require auth != null. Project: ${cfg.projectId || "?"} · DB: ${cfg.databaseURL || "?"}`);
      countBadge.textContent = "0 technicians";
      tbody.innerHTML = "";
      return;
    }
    clearDiag();

    // get a friendly name and push it into the navbar
    const displayName = await getNiceDisplayName(user);
    if (!applyUserNameToNavbar(displayName)) {
      // navbar might not be mounted yet; cache it
      pendingUserName = displayName;
    }

    await loadTechnicians();
  });

  let techList = [];

  async function loadTechnicians(){
    try{
      const arr = await readByRole("users", "technician");
      const arrCap = await readByRole("Users", "technician");
      const combined = [...arr, ...arrCap];

      // Deduplicate by id, prefer newer createdAt
      const dedupe = new Map();
      combined.forEach(item => {
        const ex = dedupe.get(item.id);
        if (!ex || (item.createdAt||0) > (ex.createdAt||0)) dedupe.set(item.id, item);
      });
      const finalList = Array.from(dedupe.values());

      if (finalList.length === 0) {
        const stats = await roleStats();
        diag(`No technicians found. Totals — /users: ${stats.totalUsers}, /Users: ${stats.totalUsersCap}. Roles: ${JSON.stringify(stats.byRole)}`);
      } else clearDiag();

      techList = finalList.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      renderRows();
    }catch(err){
      diag("Read failed: " + (err?.message || err));
      console.error(err);
    }
  }

  async function readByRole(path, roleValue){
    // Try server-side filter (requires index); fall back to client filter.
    let out = [];
    try{
      const qUsers = query(ref(db, path), orderByChild("role"), equalTo(roleValue));
      const snap = await get(qUsers);
      if (snap && snap.exists()) snap.forEach(ch => out.push(normalize(ch.key, ch.val(), path)));
    }catch(e){
      console.warn(`[${path}] role query failed; fallback to full read`, e);
    }
    if (out.length) return out;

    const all = await get(ref(db, path));
    if (!all.exists()) return [];
    const tmp = [];
    all.forEach(ch => {
      const v = ch.val() || {};
      if ((v.role || "").toLowerCase() === roleValue) tmp.push(normalize(ch.key, v, path));
    });
    return tmp;
  }

  async function roleStats(){
    const stats = { totalUsers: 0, totalUsersCap: 0, byRole: {} };
    const s1 = await get(ref(db, "users"));
    if (s1.exists()){
      s1.forEach(ch=>{
        stats.totalUsers++;
        const r = ((ch.val()||{}).role || "").toLowerCase() || "(none)";
        stats.byRole[r] = (stats.byRole[r]||0) + 1;
      });
    }
    const s2 = await get(ref(db, "Users"));
    if (s2.exists()){
      s2.forEach(ch=>{
        stats.totalUsersCap++;
        const r = ((ch.val()||{}).role || "").toLowerCase() || "(none)";
        stats.byRole[r] = (stats.byRole[r]||0) + 1;
      });
    }
    return stats;
  }

  function normalize(id, v, path){
    return {
      id,
      path,
      name: v?.name || "",
      email: v?.email || "",
      phone: v?.phone || "",
      address: v?.address || "",
      role: v?.role || "technician",
      createdAt: v?.createdAt || null
    };
  }

  // Render
  function renderRows(filterText = "") {
    const q = (filterText || searchBox.value || "").trim().toLowerCase();
    const rows = q ? techList.filter(t =>
      (t.name+t.email+t.phone+t.address).toLowerCase().includes(q)) : techList;

    countBadge.textContent = `${rows.length} technician${rows.length === 1 ? "" : "s"}`;
    tbody.innerHTML = rows.map(t => rowHtml(t)).join("");

    rows.forEach(t => {
      document.getElementById(`edit-${t.id}`)?.addEventListener("click", () => openEdit(t.id, t.path));
      document.getElementById(`del-${t.id}`)?.addEventListener("click", () => delTech(t.id, t.path));
    });

    if (!searchBox.dataset.wired) {
      searchBox.dataset.wired = "1";
      searchBox.addEventListener("input", () => renderRows());
    }
  }

  function rowHtml(t){
    const date = t.createdAt ? new Date(Number(t.createdAt)).toLocaleString() : "—";
    return `
      <tr>
        <td>
          <div class="fw-semibold">${escapeHtml(t.name || "Unnamed")}</div>
          <div class="small text-muted">${t.role || "technician"}</div>
        </td>
        <td>${escapeHtml(t.email || "—")}</td>
        <td>${escapeHtml(t.phone || "—")}</td>
        <td>${escapeHtml(t.address || "—")}</td>
        <td class="text-nowrap">${date}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-light me-2" id="edit-${t.id}">
            <i class="bi bi-pencil-square"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" id="del-${t.id}">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  }

  // Add
  btnAdd?.addEventListener("click", () => {
    form.reset();
    fldId.value = "";
    if (fldRole) fldRole.value = "technician";
    if (modalTitle) modalTitle.textContent = "Add Technician";
    modal?.show();
  });

  // Edit
  async function openEdit(id, pathHint){
    const path = pathHint || (await resolvePath(id));
    const snap = await get(ref(db, `${path}/${id}`));
    if (!snap.exists()) return notify("Record not found.");
    const v = snap.val();
    fldId.value = id;
    fldName.value = v.name || "";
    fldEmail.value = v.email || "";
    fldPhone.value = v.phone || "";
    if (fldRole) fldRole.value = v.role || "technician";
    fldAddress.value = v.address || "";
    if (modalTitle) modalTitle.textContent = "Edit Technician";
    modal?.show();
  }

  // Save (create or update)
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      name: fldName.value.trim(),
      email: fldEmail.value.trim(),
      phone: fldPhone.value.trim(),
      role: (fldRole?.value || "technician").trim(),
      address: fldAddress.value.trim(),
    };

    if (!payload.name)  return notify("Name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return notify("Email invalid.");
    if (!/^\+?[0-9\- ]{7,20}$/.test(payload.phone))     return notify("Phone invalid.");

    const id = fldId.value;

    try{
      if (id) {
        const path = await resolvePath(id);
        await update(ref(db, `${path}/${id}`), payload);
        notify("Technician updated.");
      } else {
        const now = Date.now();
        const newRef = push(ref(db, "users"));      // create under /users
        await set(newRef, { ...payload, createdAt: now });
        notify("Technician added.");
      }
      modal?.hide();
      await loadTechnicians();
    }catch(err){
      notify("Save failed: " + (err?.message || err));
      console.error(err);
    }
  });

  // Delete
  async function delTech(id, pathHint){
    if (!confirm("Delete this technician? This cannot be undone.")) return;
    try{
      const path = pathHint || (await resolvePath(id));
      await remove(ref(db, `${path}/${id}`));
      notify("Technician deleted.");
      await loadTechnicians();
    }catch(err){
      notify("Delete failed: " + (err?.message || err));
      console.error(err);
    }
  }

  // Utilities
  function notify(msg){
    if (toast && toastMsg) { toastMsg.textContent = msg; toast.show(); }
    else { console.log("NOTIFY:", msg); alert(msg); }
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  async function resolvePath(id){
    const a = await get(ref(db, `users/${id}`));
    if (a.exists()) return "users";
    const b = await get(ref(db, `Users/${id}`));
    if (b.exists()) return "Users";
    return "users";
  }

  // ---------- NAVBAR NAME HELPERS ----------
  async function getNiceDisplayName(user){
    // 1) Firebase Auth displayName
    if (user.displayName && user.displayName.trim()) return user.displayName.trim();

    // 2) RTDB profiles by UID under /users or /Users
    for (const p of ["users", "Users"]) {
      try{
        const snap = await get(ref(db, `${p}/${user.uid}`));
        if (snap.exists()) {
          const v = snap.val() || {};
          if (v.name && String(v.name).trim()) return String(v.name).trim();
        }
      }catch(_) {}
    }

    // 3) Email prefix fallback
    const em = user.email || "";
    const name = em.includes("@") ? em.split("@")[0] : "admin";
    return name || "admin";
  }

  function applyUserNameToNavbar(name){
    // Prefer your exact span id
    let nameSpan = document.querySelector("#userName");
    const pill = document.querySelector("#userPill") || document.querySelector(".user-pill");

    if (!nameSpan && pill) {
      // try to find a non-dot span inside pill
      nameSpan = pill.querySelector("span#userName") ||
                 [...pill.querySelectorAll("span")].find(s => !s.classList.contains("dot") && !s.classList.contains("status-dot"));
      if (!nameSpan) {
        // create one if missing
        nameSpan = document.createElement("span");
        nameSpan.id = "userName";
        pill.appendChild(nameSpan);
      }
    }

    if (!nameSpan) return false;

    nameSpan.textContent = name;
    nameSpan.setAttribute("title", name);
    nameSpan.setAttribute("aria-label", name);
    return true;
  }
  // -------- end helpers --------

})();
