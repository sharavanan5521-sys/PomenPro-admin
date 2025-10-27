// reports.js — robust tech loader + reports + navbar auth wiring
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getDatabase, ref, get, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

// ---------- App/SDK ----------
// firebase.js should have initialized the default app already.
// Use default instances to avoid passing a null app.
const app = getApps().length ? getApp() : undefined;
const auth = getAuth();          // use default
const db   = getDatabase();      // use default

// ---------- Navbar mount + auth bindings ----------
(async function mountNavbar(){
  try{
    const wrap = document.getElementById("navbarMount");
    const html = await (await fetch("assets/navbar.html", { cache: "no-store" })).text();
    wrap.innerHTML = html.replaceAll("AURA", "PomenPro");
    wireNavbarAuth();
  }catch(e){
    console.warn("Navbar failed to load:", e);
  }
})();

// Support both your possible ID sets without touching the navbar file
function getWhoAmIEl(){
  return document.getElementById("whoami") || document.getElementById("userName");
}
function getSignOutBtn(){
  return document.getElementById("btnSignOut") || document.getElementById("signOutBtn");
}

function setWhoAmI(text){
  const el = getWhoAmIEl();
  if (el) el.textContent = text || "";
}

function wireSignOut(){
  const btn = getSignOutBtn();
  if (btn && !btn.__wired){
    btn.addEventListener("click", async () => {
      try { await signOut(auth); } catch(_) {}
      window.location.href = "index.html";
    });
    btn.__wired = true;
  }
}

async function fetchAdminName(uid){
  // Try RTDB lower-case path
  try{
    const s1 = await get(ref(db, `users/${uid}`));
    if (s1.exists()){
      const v = s1.val();
      if (v?.name) return v.name;
      if (v?.email) return v.email.split("@")[0];
    }
  }catch{}

  // Fallback: RTDB upper-case path
  try{
    const s2 = await get(ref(db, `Users/${uid}`));
    if (s2.exists()){
      const v = s2.val();
      if (v?.name) return v.name;
      if (v?.email) return v.email.split("@")[0];
    }
  }catch{}

  // Last resort: auth profile
  const u = auth.currentUser;
  if (u?.displayName) return u.displayName;
  if (u?.email) return u.email.split("@")[0];
  return "Admin";
}

function wireNavbarAuth(){
  wireSignOut();

  onAuthStateChanged(auth, async (user) => {
    if (!user){
      window.location.href = "index.html";
      return;
    }
    const name = await fetchAdminName(user.uid);
    setWhoAmI(name);

    // In case navbar was still rendering, try once more shortly after.
    setTimeout(() => setWhoAmI(name), 150);
  });
}

// ---------- Helpers ----------
const techSelect   = document.getElementById("techSelect");
const dateFrom     = document.getElementById("dateFrom");
const dateTo       = document.getElementById("dateTo");
const statusSelect = document.getElementById("statusSelect");
const btnGenerate  = document.getElementById("btnGenerate");
const btnClear     = document.getElementById("btnClear");
const btnCSV       = document.getElementById("btnCSV");
const btnPrint     = document.getElementById("btnPrint");

const kpiTotal      = document.getElementById("kpiTotal");
const kpiCompleted  = document.getElementById("kpiCompleted");
const kpiPending    = document.getElementById("kpiPending");
const kpiAvgTime    = document.getElementById("kpiAvgTime");
const kpiEfficiency = document.getElementById("kpiEfficiency");

const snapName     = document.getElementById("snapName");
const snapJobs     = document.getElementById("snapJobs");
const snapAvg      = document.getElementById("snapAvg");
const snapRating   = document.getElementById("snapRating");
const snapTraining = document.getElementById("snapTraining");

const tbody       = document.querySelector("#reportTable tbody");
const chartCanvas = document.getElementById("statusChart");

let statusChart;

const toDate = v => typeof v === "number" ? new Date(v) : (v ? new Date(v) : null);
const fmt    = d => d ? new Date(d).toLocaleString() : "—";
const fmtDur = ms => {
  if (!ms || ms < 0) return "—";
  const h = Math.floor(ms/3600000);
  const m = Math.round((ms%3600000)/60000);
  return (h?`${h}h `:"") + `${m}m`;
};
const clampDate = (d, end=false) => {
  if(!d) return null;
  const t = new Date(d);
  if(end){ t.setHours(23,59,59,999); } else { t.setHours(0,0,0,0); }
  return t.getTime();
};
function csvEscape(s){ return (s.includes(",")||s.includes('"')||s.includes("\n")) ? `"${s.replace(/"/g,'""')}"` : s; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function disableUI(flag){
  [techSelect, dateFrom, dateTo, statusSelect, btnGenerate, btnClear, btnCSV, btnPrint].forEach(el=> el.disabled = !!flag);
}

// ---------- Technician loader ----------
async function loadFromUsersNode(nodeName){
  try{
    const q = query(ref(db, nodeName), orderByChild("role"), equalTo("technician"));
    const snap = await get(q);
    if (snap.exists()) return snap.val();
  }catch(e){}

  try{
    const snap = await get(ref(db, nodeName));
    if (!snap.exists()) return {};
    const raw = snap.val();
    const out = {};
    Object.entries(raw).forEach(([uid, u])=>{
      const role = (u && typeof u.role === "string") ? u.role.toLowerCase() : "";
      if (role === "technician") out[uid] = u;
    });
    return out;
  }catch(e){
    console.warn(`Failed reading ${nodeName}:`, e);
    return {};
  }
}

async function loadTechnicians(){
  techSelect.disabled = true;
  try{
    const [lower, upper, roleMapSnap] = await Promise.all([
      loadFromUsersNode("users"),
      loadFromUsersNode("Users"),
      get(ref(db, "userRoles")).catch(()=>null)
    ]);

    const roleTechs = new Set();
    if (roleMapSnap && roleMapSnap.exists()){
      const roles = roleMapSnap.val();
      Object.entries(roles).forEach(([uid, role])=>{
        if (typeof role === "string" && role.toLowerCase() === "technician") roleTechs.add(uid);
      });
    }

    const merged = new Map();
    function take(uid, u){
      if (!u) u = {};
      const name = u.name || u.email || uid;
      const email = u.email || "";
      merged.set(uid, { uid, name, email });
    }
    Object.entries(lower||{}).forEach(([uid,u])=> take(uid,u));
    Object.entries(upper||{}).forEach(([uid,u])=> take(uid,u));
    roleTechs.forEach(uid=>{
      if (!merged.has(uid)) take(uid, null);
    });

    const missing = Array.from(merged.values()).filter(t => !t.name || t.name === t.uid);
    if (missing.length){
      await Promise.all(missing.map(async t=>{
        const s1 = await get(ref(db, `users/${t.uid}`)).catch(()=>null);
        const s2 = (!s1 || !s1.exists()) ? await get(ref(db, `Users/${t.uid}`)).catch(()=>null) : null;
        const v = (s1 && s1.exists()) ? s1.val() : (s2 && s2.exists() ? s2.val() : null);
        if (v){
          t.name = v.name || v.email || t.uid;
          t.email = v.email || t.email || "";
        }
      }));
    }

    const currentAll = techSelect.querySelector('option[value="__all__"]');
    techSelect.innerHTML = "";
    techSelect.appendChild(currentAll || (()=>{ const op=document.createElement("option"); op.value="__all__"; op.textContent="All technicians"; return op;})());

    const list = Array.from(merged.values())
      .map(t => ({...t, display: t.name || t.email || t.uid}))
      .sort((a,b)=> a.display.localeCompare(b.display));

    list.forEach(t=>{
      const op = document.createElement("option");
      op.value = t.uid;
      op.textContent = t.display;
      techSelect.appendChild(op);
    });

    if (list.length === 0){
      console.warn("No technicians found. Check `users`, `Users`, or `userRoles`.");
    }

  }catch(e){
    console.error("Failed to load technicians", e);
  }finally{
    techSelect.disabled = false;
  }
}

// ---------- Reporting core ----------
async function generateReport(){
  disableUI(true);

  const techId = techSelect.value;
  const fromMs = clampDate(dateFrom.value);
  const toMs   = clampDate(dateTo.value, true);
  const statusFilterVal = statusSelect.value;

  try{
    const jobsSnap = await get(ref(db, "Jobs"));
    const allJobs = jobsSnap.exists() ? jobsSnap.val() : {};

    const rows = [];
    for(const [jobId, job] of Object.entries(allJobs)){
      const assignedTo = job?.assignedTo || job?.technicianId || job?.techId || "";
      const createdAt  = job?.createdAt || job?.created_at || job?.created || null;
      const startedAt  = job?.startedAt || job?.startTime || null;
      const completedAt= job?.completedAt || job?.endTime || null;
      const status     = (job?.status || "created").toLowerCase();

      if (techId !== "__all__" && assignedTo !== techId) continue;
      if (statusFilterVal !== "__any__" && status !== statusFilterVal) continue;

      const createdMs = toDate(createdAt)?.getTime() ?? null;
      if (fromMs && createdMs && createdMs < fromMs) continue;
      if (toMs && createdMs && createdMs > toMs) continue;

      const duration = (completedAt && startedAt) ? (toDate(completedAt) - toDate(startedAt)) :
                      (completedAt && createdAt) ? (toDate(completedAt) - toDate(createdAt)) : null;

      rows.push({
        jobId,
        title: job?.title || job?.jobTitle || "—",
        technician: assignedTo,
        status,
        createdAt, startedAt, completedAt, duration
      });
    }

    rows.sort((a,b)=> (toDate(b.createdAt)?.getTime()||0) - (toDate(a.createdAt)?.getTime()||0));

    const total = rows.length;
    const completed = rows.filter(r=> r.status === "completed" || r.status === "resolved").length;
    const pending = total - completed;
    const avgMs = (() => {
      const comp = rows.filter(r=>typeof r.duration === "number");
      if (!comp.length) return null;
      return Math.round(comp.reduce((s,r)=>s+r.duration,0)/comp.length);
    })();
    const eff = total ? Math.round((completed/total)*100) : null;

    kpiTotal.textContent = String(total);
    kpiCompleted.textContent = String(completed);
    kpiPending.textContent = String(pending);
    kpiAvgTime.textContent = avgMs ? fmtDur(avgMs) : "—";
    kpiEfficiency.textContent = eff != null ? `${eff}%` : "—";

    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    rows.forEach(r=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${r.jobId}</td>
        <td>${escapeHtml(r.title)}</td>
        <td>${r.technician || "—"}</td>
        <td style="text-transform:capitalize">${r.status}</td>
        <td>${fmt(r.createdAt)}</td>
        <td>${fmt(r.startedAt)}</td>
        <td>${fmt(r.completedAt)}</td>
        <td>${fmtDur(r.duration)}</td>
      `;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    const countsByStatus = rows.reduce((m,r)=> (m[r.status]=(m[r.status]||0)+1, m), {});
    drawStatusChart(countsByStatus);

    await renderTechSnapshot(techId, rows, avgMs);

  }catch(e){
    console.error("Report generation failed:", e);
    alert("Failed to generate report. Check console for details and your data structure.");
  }finally{
    disableUI(false);
  }
}

async function renderTechSnapshot(techId, rowsForTech, avgMs){
  if (techId === "__all__"){
    snapName.textContent   = "All technicians";
    snapJobs.textContent   = rowsForTech.length;
    snapAvg.textContent    = avgMs ? fmtDur(avgMs) : "—";
    snapRating.textContent = "—";
    snapTraining.textContent = "—";
    return;
  }
  let techName = techId;
  try{
    const u = await get(ref(db, `users/${techId}`));
    if (u.exists()) techName = u.val()?.name || u.val()?.email || techId;
    else {
      const U = await get(ref(db, `Users/${techId}`));
      if (U.exists()) techName = U.val()?.name || U.val()?.email || techId;
    }
  }catch{}

  const ownRows = rowsForTech.filter(r => r.technician === techId);
  const avgOwn  = (() => {
    const comp = ownRows.filter(r=>typeof r.duration === "number");
    if (!comp.length) return null;
    return Math.round(comp.reduce((s,r)=>s+r.duration,0)/comp.length);
  })();

  let rating = "—";
  let training = "—";
  try{
    const s = await get(ref(db, `technicianStats/${techId}`));
    if (s.exists()){
      const v = s.val();
      rating   = v?.rating != null ? Number(v.rating).toFixed(1) : "—";
      training = Array.isArray(v?.suggestedTrainings) && v.suggestedTrainings.length
        ? v.suggestedTrainings.join(", ")
        : (v?.topTraining || "—");
    }
  }catch{}

  snapName.textContent   = techName;
  snapJobs.textContent   = ownRows.length;
  snapAvg.textContent    = avgOwn ? fmtDur(avgOwn) : "—";
  snapRating.textContent = rating;
  snapTraining.textContent = training;
}

function drawStatusChart(map){
  const labels = Object.keys(map);
  const data   = Object.values(map);
  if (statusChart){ statusChart.destroy(); }
  statusChart = new Chart(chartCanvas, {
    type: "doughnut",
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: {
        legend: { position: "bottom", labels: { color: getComputedStyle(document.documentElement).getPropertyValue("--text") } },
        tooltip: { enabled: true }
      },
      layout: { padding: 6 }
    }
  });
}

// ---------- Export CSV / Clear / Print ----------
function exportCSV(){
  const rows = [];
  const heads = Array.from(document.querySelectorAll("#reportTable thead th")).map(th=>th.textContent.trim());
  rows.push(heads.join(","));
  Array.from(document.querySelectorAll("#reportTable tbody tr")).forEach(tr=>{
    const cols = Array.from(tr.children).map(td => csvEscape(td.textContent.trim()));
    rows.push(cols.join(","));
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pomenpro_report_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

btnGenerate.addEventListener("click", generateReport);
btnClear.addEventListener("click", ()=>{
  techSelect.value = "__all__";
  dateFrom.value = "";
  dateTo.value = "";
  statusSelect.value = "__any__";
  tbody.innerHTML = "";
  kpiTotal.textContent = "0";
  kpiCompleted.textContent = "0";
  kpiPending.textContent = "0";
  kpiAvgTime.textContent = "—";
  kpiEfficiency.textContent = "—";
  snapName.textContent = "—";
  snapJobs.textContent = "0";
  snapAvg.textContent = "—";
  snapRating.textContent = "—";
  snapTraining.textContent = "—";
  if (statusChart) statusChart.destroy();
});
btnCSV.addEventListener("click", exportCSV);
btnPrint.addEventListener("click", ()=> window.print());

// ---------- Boot ----------
(async function boot(){
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last  = new Date(now.getFullYear(), now.getMonth()+1, 0);
  dateFrom.value = first.toISOString().slice(0,10);
  dateTo.value   = last.toISOString().slice(0,10);

  await loadTechnicians();
  await generateReport();
})();
