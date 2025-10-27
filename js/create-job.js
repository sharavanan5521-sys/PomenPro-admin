import { auth, onAuthStateChanged } from "./firebase.js";
import {
  getDatabase, ref, get, query, orderByChild, equalTo,
  push, set, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-database.js";

const db = getDatabase();
const form = document.getElementById("jobForm");
const msgBox = document.getElementById("msgBox");
const btnSubmit = document.getElementById("btnSubmit");
const btnBack = document.getElementById("btnBack");
const selAssignedTo = document.getElementById("assignedTo");
const selDuration = document.getElementById("estimatedDuration");

// protect page
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  await populateTechnicians();
});

// back
btnBack.addEventListener("click", () => window.location.href = "dashboard.html");

// load technicians into the select
async function populateTechnicians() {
  const techQ = query(ref(db, "users"), orderByChild("role"), equalTo("technician"));
  const snap = await get(techQ);
  if (!snap.exists()) return;

  const options = [];
  snap.forEach(child => {
    const uid = child.key;
    const u = child.val() || {};
    options.push({ uid, name: u.name || u.email || uid });
  });

  for (const t of options) {
    const opt = document.createElement("option");
    opt.value = t.uid;
    opt.textContent = `${t.name} (${t.uid.slice(0, 6)}…)`;
    selAssignedTo.appendChild(opt);
  }
}

// tiny guesser for “auto” duration
function suggestDurationByService(type) {
  const t = (type || "").toLowerCase().trim();
  const map = {
    "oil change": 30,
    "tire rotation": 45,
    "brake inspection": 60,
    "diagnostic": 60,
    "full service": 120,
    "battery replacement": 30,
    "engine check": 90
  };
  return map[t] || 60;
}

// handle form submission
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msgBox.style.display = "none"; // hide any old messages
  btnSubmit.disabled = true;

  try {
    const assignedUid = await resolveAssignee();
    if (!assignedUid) throw new Error("No technician available to assign.");

    const vehicleNo = document.getElementById("vehicleNo").value.trim();
    const serviceType = document.getElementById("serviceType").value.trim();
    const notes = document.getElementById("notes").value.trim();

    const durRaw = selDuration?.value || "";
    const estimatedDurationMinutes =
      durRaw === "auto"
        ? suggestDurationByService(serviceType)
        : durRaw
        ? Number(durRaw)
        : null;

    const payload = {
      vehicleNo,
      serviceType,
      assignedTo: assignedUid,
      notes,
      status: "pending",
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid,
      displayId: "JOB-" + Date.now(),
      estimatedDurationMinutes,
      estimatedSource: durRaw === "auto" ? "auto" : durRaw ? "manual" : null,
    };

    await set(push(ref(db, "Jobs")), payload);

    ok("✅ Job created successfully.");
    form.reset();
    selAssignedTo.value = "auto";
    selDuration.value = "";
  } catch (err) {
    fail(err);
  } finally {
    btnSubmit.disabled = false;
  }
});

// pick the assignee: manual if chosen, else auto by lowest workload
async function resolveAssignee() {
  const chosen = selAssignedTo.value;
  if (chosen && chosen !== "auto") return chosen;

  const techQ = query(ref(db, "users"), orderByChild("role"), equalTo("technician"));
  const techSnap = await get(techQ);
  if (!techSnap.exists()) return null;

  const techList = [];
  techSnap.forEach(c => techList.push(c.key));

  const jobsSnap = await get(ref(db, "Jobs"));
  const counts = Object.create(null);
  for (const uid of techList) counts[uid] = 0;

  if (jobsSnap.exists()) {
    jobsSnap.forEach(c => {
      const j = c.val() || {};
      const s = String(j.status || "").toLowerCase();
      if (s === "pending" || s === "open" || s === "in progress" || s === "in_progress") {
        if (j.assignedTo && counts[j.assignedTo] != null) {
          counts[j.assignedTo] += 1;
        }
      }
    });
  }

  let best = null, bestCount = Infinity;
  const shuffled = techList.sort(() => Math.random() - 0.5);
  for (const uid of shuffled) {
    const c = counts[uid] ?? 0;
    if (c < bestCount) { best = uid; bestCount = c; }
  }
  return best;
}

// ui helpers
function ok(text) {
  msgBox.textContent = text;
  msgBox.style.display = "block";
  msgBox.style.color = "#10b981"; // green
  msgBox.classList.remove("hidden");
}

function fail(err) {
  console.error(err);
  msgBox.textContent = `❌ Failed to create job: ${err?.code || err?.message || err}`;
  msgBox.style.display = "block";
  msgBox.style.color = "#ef4444"; // red
  msgBox.classList.remove("hidden");
}
