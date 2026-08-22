// ============================================================
// مناقشة بروجكت AI — منطق التطبيق
// ============================================================

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const teamsRef = db.ref("teams");

const DAY_META = {
  wed: { key: "wed", label: "الأربعاء", start: "10:00" },
  thu: { key: "thu", label: "الخميس", start: "11:30" },
};
const SLOT_MINUTES = 5;

let currentData = {}; // { teamNumber: team }
let pickerDay = null; // اليوم المفتوح حاليًا في شبكة اختيار المعاد

// ---------- helpers ----------
function teamsArray(data) {
  return Object.values(data || {}).sort((a, b) => a.teamNumber - b.teamNumber);
}

function computeCapacities(data) {
  const total = Object.keys(data || {}).length;
  const capWed = Math.ceil(total / 2);
  const capThu = total - capWed;
  return { wed: capWed, thu: capThu, total };
}

function countByDay(data, day) {
  return teamsArray(data).filter((t) => t.day === day).length;
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function slotTime(day, index) {
  return {
    start: addMinutes(DAY_META[day].start, index * SLOT_MINUTES),
    end: addMinutes(DAY_META[day].start, (index + 1) * SLOT_MINUTES),
  };
}

function membersLine(members) {
  return (members || [])
    .filter((m) => m && m.name)
    .map((m) => `${m.name} (${m.id ?? "—"})`)
    .join("، ");
}

// كل معاد في اليوم: فاضي أو محجوز، مبني على slotIndex الفعلي لكل فريق
function slotsForDay(data, day) {
  const cap = computeCapacities(data)[day];
  const slots = Array.from({ length: cap }, (_, i) => ({
    index: i,
    ...slotTime(day, i),
    occupiedBy: null,
  }));
  teamsArray(data).forEach((t) => {
    if (t.day === day && Number.isInteger(t.slotIndex) && t.slotIndex < cap) {
      slots[t.slotIndex].occupiedBy = t.teamNumber;
    }
  });
  return slots;
}

// جدول العرض (لكل يوم): بس الفرق اللي ليها معاد، مرتبة بالوقت
function computeSchedule(data) {
  const schedule = { wed: [], thu: [] };
  ["wed", "thu"].forEach((day) => {
    teamsArray(data)
      .filter((t) => t.day === day && Number.isInteger(t.slotIndex))
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .forEach((t) => {
        schedule[day].push({ ...t, ...slotTime(day, t.slotIndex) });
      });
  });
  return schedule;
}

// ---------- seeding (first run only) ----------
teamsRef.once("value").then((snap) => {
  if (!snap.exists()) {
    const obj = {};
    SEED_TEAMS.forEach((t) => (obj[t.teamNumber] = t));
    teamsRef.set(obj);
  }
});

// ---------- live subscription ----------
teamsRef.on("value", (snap) => {
  currentData = snap.val() || {};
  renderAll();
});

function renderAll() {
  renderCapacityBadges();
  renderMasterTable();
  renderSchedule();
  const foundNumber = document.getElementById("found-number").textContent;
  if (foundNumber) refreshFoundPanel(Number(foundNumber));
}

// ---------- master table: every team + every student, with day & time ----------
function renderMasterTable() {
  const body = document.getElementById("table-master");
  body.innerHTML = "";

  const all = teamsArray(currentData);
  if (all.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="4">لسه مفيش فرق مسجلة</td></tr>`;
    return;
  }

  all.forEach((t) => {
    const tr = document.createElement("tr");
    const dayCell = t.day
      ? `<span class="day-pill ${t.day}">${DAY_META[t.day].label}</span>`
      : `<span class="day-pill pending">لم يتم التحديد بعد</span>`;
    const timeCell =
      t.day && Number.isInteger(t.slotIndex) ? (() => { const s = slotTime(t.day, t.slotIndex); return `${s.start} – ${s.end}`; })() : "—";

    tr.innerHTML = `
      <td><span class="team-chip">#${t.teamNumber}</span></td>
      <td>${membersLine(t.members)}</td>
      <td>${dayCell}</td>
      <td class="slot-time">${timeCell}</td>
    `;
    body.appendChild(tr);
  });
}

// ---------- capacity badges in hero ----------
function renderCapacityBadges() {
  const cap = computeCapacities(currentData);
  const wedCount = countByDay(currentData, "wed");
  const thuCount = countByDay(currentData, "thu");

  const wedEl = document.getElementById("wed-slots");
  const thuEl = document.getElementById("thu-slots");

  wedEl.textContent = cap.total === 0 ? "لا يوجد فرق بعد" : `${wedCount} من ${cap.wed} مكان محجوز`;
  thuEl.textContent = cap.total === 0 ? "لا يوجد فرق بعد" : `${thuCount} من ${cap.thu} مكان محجوز`;
}

// ---------- toggle: register new team ----------
document.getElementById("show-register-btn").addEventListener("click", (e) => {
  const wrap = document.getElementById("register-form-wrap");
  const btn = e.currentTarget;
  const opening = wrap.classList.contains("hidden");
  wrap.classList.toggle("hidden");
  btn.textContent = opening ? "إخفاء نموذج التسجيل" : "لا أملك فريق — سجّل فريق جديد";
  if (opening) wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

// ---------- register new team ----------
document.getElementById("register-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);

  const members = [1, 2, 3]
    .map((i) => ({ name: (fd.get("name" + i) || "").trim(), id: (fd.get("id" + i) || "").trim() }))
    .filter((m) => m.name);

  const resultBox = document.getElementById("register-result");

  if (members.length === 0) {
    showResult(resultBox, false, "لازم تدخل عضو واحد على الأقل.");
    return;
  }

  const submitBtn = form.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  teamsRef.once("value").then((snap) => {
    const data = snap.val() || {};
    const nums = Object.keys(data).map(Number);
    const newNumber = (nums.length ? Math.max(...nums) : 0) + 1;

    const team = {
      teamNumber: newNumber,
      members: members.map((m) => ({ name: m.name, id: isFinite(m.id) && m.id !== "" ? Number(m.id) : m.id })),
      day: null,
      slotIndex: null,
      assignedAt: null,
    };

    return teamsRef.child(newNumber).set(team).then(() => newNumber);
  }).then((newNumber) => {
    showResult(resultBox, true, `اتسجلتم! رقم فريقكم هو ${newNumber}. استخدموه تحت عشان تختاروا معادكم.`);
    form.reset();
    document.getElementById("team-number-input").value = newNumber;
  }).catch((err) => {
    showResult(resultBox, false, "حصل خطأ، حاول تاني: " + err.message);
  }).finally(() => {
    submitBtn.disabled = false;
  });
});

// ---------- lookup team ----------
document.getElementById("lookup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const num = Number(document.getElementById("team-number-input").value);
  pickerDay = null;
  refreshFoundPanel(num);
});

function refreshFoundPanel(num) {
  const team = currentData[num];
  const foundBox = document.getElementById("team-found");
  const dayResult = document.getElementById("day-result");
  const currentBox = document.getElementById("current-slot-box");
  const choiceBox = document.getElementById("day-choice");

  if (!team) {
    foundBox.classList.add("hidden");
    document.getElementById("found-number").textContent = "";
    return;
  }

  foundBox.classList.remove("hidden");
  document.getElementById("found-number").textContent = team.teamNumber;

  const list = document.getElementById("found-members");
  list.innerHTML = "";
  (team.members || []).forEach((m) => {
    const li = document.createElement("li");
    li.textContent = `${m.name} — ${m.id ?? "—"}`;
    list.appendChild(li);
  });

  const cap = computeCapacities(currentData);
  const wedCount = countByDay(currentData, "wed");
  const thuCount = countByDay(currentData, "thu");
  const wedOpen = wedCount < cap.wed;
  const thuOpen = thuCount < cap.thu;

  document.getElementById("toggle-wed-count").textContent = `متاح ${Math.max(cap.wed - wedCount, 0)} معاد`;
  document.getElementById("toggle-thu-count").textContent = `متاح ${Math.max(cap.thu - thuCount, 0)} معاد`;

  const statusEl = document.getElementById("found-status");
  statusEl.className = "";

  const hasSlot = team.day && Number.isInteger(team.slotIndex);

  if (hasSlot) {
    const s = slotTime(team.day, team.slotIndex);
    statusEl.textContent = "";
    currentBox.classList.remove("hidden");
    document.getElementById("current-slot-text").textContent =
      `معادكم الحالي: يوم ${DAY_META[team.day].label}، من ${s.start} لـ ${s.end} ✅`;
    // اخفي شبكة الاختيار لحد ما يدوس "غيّر الموعد"
    choiceBox.classList.toggle("hidden", pickerDay === null);
  } else {
    currentBox.classList.add("hidden");
    choiceBox.classList.remove("hidden");

    if (wedOpen && thuOpen) {
      statusEl.textContent = "اليومين متاحين — اختار اللي يناسبكم وبعدين اختار معاد.";
      statusEl.classList.add("status-open");
    } else if (wedOpen && !thuOpen) {
      statusEl.textContent = "يوم الخميس خلص، متاح بس يوم الأربعاء.";
      statusEl.classList.add("status-closed");
    } else if (!wedOpen && thuOpen) {
      statusEl.textContent = "يوم الأربعاء خلص، متاح بس يوم الخميس.";
      statusEl.classList.add("status-closed");
    } else {
      statusEl.textContent = "اليومين مقفولين حاليًا — كلم المسؤول.";
      statusEl.classList.add("status-closed");
    }
  }

  document.querySelector('.day-toggle[data-day="wed"]').disabled = !wedOpen;
  document.querySelector('.day-toggle[data-day="thu"]').disabled = !thuOpen;
  document.querySelectorAll(".day-toggle").forEach((b) => {
    b.classList.toggle("active", b.dataset.day === pickerDay);
  });

  if (pickerDay) {
    renderSlotGrid(pickerDay, team);
  } else {
    document.getElementById("slot-grid").innerHTML = "";
  }
}

// فتح/قفل شبكة اختيار المعاد لكل يوم
document.querySelectorAll(".day-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    pickerDay = pickerDay === btn.dataset.day ? null : btn.dataset.day;
    const num = Number(document.getElementById("found-number").textContent);
    refreshFoundPanel(num);
  });
});

document.getElementById("change-slot-btn").addEventListener("click", () => {
  const num = Number(document.getElementById("found-number").textContent);
  const team = currentData[num];
  pickerDay = (team && team.day) || "wed";
  refreshFoundPanel(num);
});

function renderSlotGrid(day, team) {
  const grid = document.getElementById("slot-grid");
  grid.innerHTML = "";
  const slots = slotsForDay(currentData, day);

  if (slots.length === 0) {
    grid.innerHTML = `<p class="hint">مفيش معادات معرّفة في اليوم ده لسه.</p>`;
    return;
  }

  slots.forEach((s) => {
    const isMine = team.day === day && team.slotIndex === s.index;
    const isTaken = s.occupiedBy !== null && !isMine;

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "slot-chip" + (isTaken ? " taken" : "") + (isMine ? " mine" : "");
    chip.textContent = `${s.start} – ${s.end}`;
    chip.disabled = isTaken;
    if (!isTaken) {
      chip.addEventListener("click", () => chooseSlot(team.teamNumber, day, s.index));
    }
    grid.appendChild(chip);
  });
}

function chooseSlot(teamNumber, day, slotIndex) {
  const dayResult = document.getElementById("day-result");
  document.querySelectorAll(".slot-chip").forEach((c) => (c.disabled = true));

  teamsRef.once("value").then((snap) => {
    const data = snap.val() || {};
    const team = data[teamNumber];

    if (!team) return { ok: false, msg: "رقم الفريق مش موجود." };

    const cap = computeCapacities(data);
    if (slotIndex < 0 || slotIndex >= cap[day]) {
      return { ok: false, msg: "المعاد ده مش متاح دلوقتي، حدّث الصفحة وحاول تاني." };
    }

    const clash = teamsArray(data).find(
      (t) => t.teamNumber !== teamNumber && t.day === day && t.slotIndex === slotIndex
    );
    if (clash) {
      return { ok: false, msg: "للأسف حد سبقكم للمعاد ده، اختاروا معاد تاني من المتاح." };
    }

    return teamsRef
      .child(teamNumber)
      .update({ day, slotIndex, assignedAt: Date.now() })
      .then(() => {
        const s = slotTime(day, slotIndex);
        return { ok: true, msg: `تم حجز معادكم يوم ${DAY_META[day].label} من ${s.start} لـ ${s.end} ✅` };
      });
  }).then((result) => {
    showResult(dayResult, result.ok, result.msg);
    if (result.ok) pickerDay = null;
    refreshFoundPanel(teamNumber);
  }).catch((err) => {
    showResult(dayResult, false, "حصل خطأ، حاول تاني: " + err.message);
    refreshFoundPanel(teamNumber);
  });
}

function showResult(box, ok, msg) {
  box.textContent = msg;
  box.classList.remove("hidden", "ok", "bad");
  box.classList.add(ok ? "ok" : "bad");
}

// ---------- schedule table (تبويبات حسب اليوم) ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".schedule-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.remove("hidden");
  });
});

function renderSchedule() {
  const schedule = computeSchedule(currentData);

  renderDayTable("table-wed", schedule.wed);
  renderDayTable("table-thu", schedule.thu);

  const unassigned = teamsArray(currentData).filter((t) => !t.day);
  const body = document.getElementById("table-unassigned");
  body.innerHTML = "";
  if (unassigned.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="2">كل الفرق اختارت معادها 🎉</td></tr>`;
  } else {
    unassigned.forEach((t) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><span class="team-chip">#${t.teamNumber}</span></td><td>${membersLine(t.members)}</td>`;
      body.appendChild(tr);
    });
  }
}

function renderDayTable(bodyId, list) {
  const body = document.getElementById(bodyId);
  body.innerHTML = "";
  if (list.length === 0) {
    body.innerHTML = `<tr class="empty-row"><td colspan="3">لسه مفيش فرق حجزت معاد اليوم ده</td></tr>`;
    return;
  }
  list.forEach((t) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="slot-time">${t.start} – ${t.end}</td>
      <td><span class="team-chip">#${t.teamNumber}</span></td>
      <td>${membersLine(t.members)}</td>
    `;
    body.appendChild(tr);
  });
}
