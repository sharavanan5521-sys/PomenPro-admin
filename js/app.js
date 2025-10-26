// js/app.js
import { auth, signInWithEmailAndPassword, onAuthStateChanged } from "./firebase.js";

const form = document.getElementById("loginForm");
const btn = document.getElementById("btnLogin");
const errBox = document.getElementById("errorBox");

// If already logged in, yeet straight to dashboard
onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "dashboard.html";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.hidden = true;
  btn.disabled = true;

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // Auth state listener above will redirect
  } catch (err) {
    // Spare me the novel. Give user a short message, log the rest.
    console.error(err);
    errBox.textContent = prettyFirebaseError(err);
    errBox.hidden = false;
    btn.disabled = false;
  }
});

function prettyFirebaseError(err) {
  const code = String(err.code || "").replace("auth/", "");
  switch (code) {
    case "invalid-email": return "That email looks broken. Fix it.";
    case "user-disabled": return "This user is disabled. Ask your supervisor to re-enable.";
    case "user-not-found":
    case "wrong-password": return "Email or password is incorrect.";
    case "too-many-requests": return "Too many attempts. Try again later.";
    default: return "Login failed. Try again.";
  }
}
