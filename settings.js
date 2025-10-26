// settings.js
// Admin profile + system info, read-only.
// Requires js/firebase.js to have initialized Firebase (v10 modular).

import { getApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getDatabase, ref, child, get } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

// ---- Build info (edit when you ship) ----
const BUILD_VERSION = "v1.0.0";
const BUILD_CHANNEL = "Production"; // Development | Staging | Production

// ---- Navbar injection ----
(async function injectNavbar(){
  try{
    const slot = document.getElementById("navbar-slot");
    const res = await fetch("assets/navbar.html", { cache: "no-store" });
    const html = await res.text();
    slot.innerHTML = html;

    // Mark Settings as active
    const links = slot.querySelectorAll("a.nav-link");
    for(const a of links){
      const href = a.getAttribute("href") || "";
      if(href.toLowerCase().includes("settings")) a.classList.add("active");
      else a.classList.remove("active");
    }
  }catch(e){ console.warn("Navbar load failed:", e); }
})();

// ---- Static fields ----
setText("buildVersion", BUILD_VERSION);
setText("buildChannel", BUILD_CHANNEL);
try{
  const d = new Date(document.lastModified);
  setText("lastUpdated", new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"}).format(d));
}catch{}

// ---- Env info from Firebase ----
try{
  const app = getApp();
  const opts = app.options || {};
  const hostingFromLocation = (opts.authDomain ? opts.authDomain.replace("firebaseapp.com","web.app") : "—");
  setText("projId", opts.projectId || "—");
  setText("dbUrl", opts.databaseURL || "—");
  setText("authDomain", opts.authDomain || "—");
  setText("bucket", opts.storageBucket || "—");
  setText("hosting", hostingFromLocation);

  // Device
  setText("ua", navigator.userAgent || "—");
  setText("browserInfo", getBrowserShort());
  setText("screenInfo", `${window.screen.width}×${window.screen.height} @ ${window.devicePixelRatio || 1}x`);
}catch(e){ console.warn("App options missing:", e); }

// ---- Auth + Profile render ----
const auth = getAuth();
onAuthStateChanged(auth, async (user) => {
  setText("currentUser", user?.email || "Not signed in");

  if(!user){
    renderAvatar(null);
    setText("displayName", "Not signed in");
    setText("email", "—");
    setText("uid", "—");
    setText("provider", "—");
    setText("created", "—");
    setText("lastSignIn", "—");
    setText("lastActive", "—");
    setText("roleTag", "Role: —");
    setText("statusTag", "Status: —");
    disableButton("copyUid");
    disableButton("copyEmail");
    disableButton("btnSignOut");
    return;
  }

  // Auth basics
  renderAvatar(user);
  setText("displayName", user.displayName || maskEmailName(user.email) || "Admin");
  setText("email", user.email || "—");
  setText("uid", user.uid);
  const provider = user.providerData?.[0]?.providerId || "password";
  setText("provider", provider);

  setText("created", fmtDate(user.metadata?.creationTime));
  setText("lastSignIn", fmtDate(user.metadata?.lastSignInTime));

  // Default lastActive = lastSignIn; RTDB may override with /users/{uid}/lastSeen
  setText("lastActive", relTime(user.metadata?.lastSignInTime));

  // RTDB: /users/{uid}
  try{
    const db = getDatabase();
    const snap = await get(child(ref(db), `users/${user.uid}`));
    if(snap.exists()){
      const u = snap.val() || {};
      setText("roleTag", `Role: ${u.role || "admin"}`);
      setText("statusTag", `Status: ${u.status || "active"}`);
      setText("phone", u.phone || "—");
      if(u.lastSeen){
        setText("lastActive", relTime(u.lastSeen));
      }
    }else{
      // No user node; show sane defaults
      setText("roleTag", "Role: admin");
      setText("statusTag", "Status: active");
      setText("phone", "—");
    }
  }catch(e){
    console.warn("Failed to read /users/{uid}:", e);
    // Graceful fallbacks already set
    setText("roleTag", "Role: admin");
    setText("statusTag", "Status: active");
    if(!document.getElementById("phone").textContent.trim()) setText("phone", "—");
  }
});

// ---- Buttons ----
document.getElementById("copyUid")?.addEventListener("click", async ()=>{
  const uid = document.getElementById("uid")?.textContent?.trim();
  if(uid && uid !== "—"){
    await navigator.clipboard.writeText(uid);
    toast("UID copied");
  }
});
document.getElementById("copyEmail")?.addEventListener("click", async ()=>{
  const email = document.getElementById("email")?.textContent?.trim();
  if(email && email !== "—"){
    await navigator.clipboard.writeText(email);
    toast("Email copied");
  }
});
document.getElementById("btnSignOut")?.addEventListener("click", async ()=>{
  try{
    await signOut(getAuth());
    toast("Signed out");
    setTimeout(()=>location.href="login.html", 500);
  }catch(e){
    toast("Sign out failed");
  }
});
document.getElementById("btnCheckUpdates")?.addEventListener("click", ()=>{
  const el = document.getElementById("buildVersion");
  el.animate([{ transform:"scale(1.0)" }, { transform:"scale(1.06)" }, { transform:"scale(1.0)" }], { duration: 260, easing: "ease-out" });
  toast(`You are on ${BUILD_VERSION} (${BUILD_CHANNEL}).`);
});

// ---- Helpers ----
function setText(id, val){
  const el = document.getElementById(id);
  if(el) el.textContent = val ?? "—";
}
function disableButton(id){
  const el = document.getElementById(id);
  if(el){ el.disabled = true; el.style.opacity = .6; el.style.cursor = "not-allowed"; }
}
function fmtDate(d){
  if(!d) return "—";
  const dt = (d instanceof Date) ? d : new Date(d);
  if(isNaN(dt.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit"}).format(dt);
}
function relTime(d){
  const ts = (d instanceof Date) ? d.getTime() : (typeof d === "number" ? d : Date.parse(d));
  if(!ts) return "—";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if(Math.abs(sec) < 60) return rtf.format(-sec, "second");
  const min = Math.round(sec / 60);
  if(Math.abs(min) < 60) return rtf.format(-min, "minute");
  const hrs = Math.round(min / 60);
  if(Math.abs(hrs) < 24) return rtf.format(-hrs, "hour");
  const days = Math.round(hrs / 24);
  if(Math.abs(days) < 30) return rtf.format(-days, "day");
  const months = Math.round(days / 30);
  if(Math.abs(months) < 12) return rtf.format(-months, "month");
  const years = Math.round(months / 12);
  return rtf.format(-years, "year");
}
function maskEmailName(email){
  if(!email) return "";
  const [name] = email.split("@");
  return name?.charAt(0)?.toUpperCase() + name?.slice(1) || "";
}
function renderAvatar(user){
  const el = document.getElementById("avatar");
  if(!el) return;
  el.innerHTML = "";
  if(user?.photoURL){
    const img = document.createElement("img");
    img.src = user.photoURL;
    img.alt = "Avatar";
    el.appendChild(img);
    return;
  }
  const seed = (user?.displayName || user?.email || "A").trim();
  el.textContent = seed.slice(0,1).toUpperCase();
}
function toast(msg){
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position:"fixed", bottom:"20px", right:"20px", zIndex:9999,
    background:"rgba(17,24,39,.95)", color:"#e5e7eb",
    padding:"10px 14px", borderRadius:"12px",
    border:"1px solid rgba(255,255,255,.12)", boxShadow:"0 10px 20px rgba(0,0,0,.45)"
  });
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2200);
}
function getBrowserShort(){
  const ua = navigator.userAgent || "";
  // Very rough, just for display
  if(ua.includes("Edg/")) return "Edge";
  if(ua.includes("Chrome/")) return "Chrome";
  if(ua.includes("Firefox/")) return "Firefox";
  if(ua.includes("Safari/")) return "Safari";
  return "Browser";
}
