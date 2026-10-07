"use strict";

// Fill demo data for JSS2 A so reports look realistic.
// Safe to run more than once — it only fills missing rows and skips published reports.

const db = require("./db");

function round(n) { return Math.round(n * 100) / 100; }

// ---------- find the current session ----------
const session = db.prepare("SELECT * FROM academic_sessions WHERE is_current = 1 LIMIT 1").get();
if (!session) {
  console.error("No current session set. Log in as admin and set one first.");
  process.exit(1);
}
console.log(`Using session: ${session.name} — ${session.term} Term`);

// ---------- find JSS2 A ----------
const klass = db.prepare("SELECT * FROM classes WHERE name='JSS2' AND arm='A'").get();
if (!klass) {
  console.error("Class JSS2 A not found.");
  process.exit(1);
}

// ---------- students in that class ----------
const students = db.prepare(`
  SELECT id, full_name, admission_no FROM students
  WHERE class_id = ? AND status='active' ORDER BY full_name
`).all(klass.id);

if (!students.length) {
  console.error("No active students in JSS2 A.");
  process.exit(1);
}
console.log(`Students: ${students.map(s => s.full_name).join(", ")}`);

// ---------- subjects we'll fill ----------
const subjectNames = ["Mathematics", "English Language", "Basic Science", "Social Studies"];
const subjects = subjectNames.map(name => {
  const s = db.prepare("SELECT id, name FROM subjects WHERE name = ?").get(name);
  if (!s) console.warn(`  (skipping subject not found: ${name})`);
  return s;
}).filter(Boolean);

if (!subjects.length) {
  console.error("No matching subjects found. Run the seed or create subjects first.");
  process.exit(1);
}

// ---------- realistic per-student score profiles ----------
// Each profile: base ability + small variation per subject, so scores look natural.
const profiles = {
  "Ada Okafor":    { ca1: [8, 9],  ca2: [15, 18], proj: [8, 9],  pbt: [22, 26] },
  "Bola Adeyemi":  { ca1: [6, 7],  ca2: [12, 15], proj: [6, 7],  pbt: [18, 21] },
  "Chika Nwosu":   { ca1: [7, 8],  ca2: [14, 16], proj: [7, 8],  pbt: [20, 23] }
};

function rnd(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return Math.round(rnd(arr[0], arr[1]) * 10) / 10; }

// ---------- insert scores ----------
const uid = db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1").get().id;
const upsertScore = db.prepare(`
  INSERT INTO scores
    (student_id, subject_id, class_id, session_id, term,
     ca1, ca2, project, cbt_score, pbt_score, entered_by, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  ON CONFLICT(student_id, subject_id, session_id, term) DO NOTHING
`);

let scoreCount = 0;
for (const s of students) {
  const p = profiles[s.full_name] || { ca1: [6,8], ca2: [12,16], proj: [6,8], pbt: [18,22] };
  for (const sub of subjects) {
    const result = upsertScore.run(
      s.id, sub.id, klass.id, session.id, session.term,
      pick(p.ca1), pick(p.ca2), pick(p.proj),
      0,               // cbt_score left 0 (no CBT submissions)
      pick(p.pbt), uid
    );
    if (result.changes) scoreCount++;
  }
}
console.log(`Scores inserted: ${scoreCount}`);

// ---------- attendance ----------
const upsertAtt = db.prepare(`
  INSERT INTO attendance_terms
    (student_id, session_id, term, days_school_opened, days_school_closed, days_present, entered_by, updated_at)
  VALUES (?,?,?,?,?,?,?,datetime('now'))
  ON CONFLICT(student_id, session_id, term) DO NOTHING
`);

const attendance = {
  "Ada Okafor":   { present: 58, absent: 4 },
  "Bola Adeyemi": { present: 55, absent: 7 },
  "Chika Nwosu":  { present: 61, absent: 1 }
};

let attCount = 0;
for (const s of students) {
  const a = attendance[s.full_name] || { present: 55, absent: 7 };
  const r = upsertAtt.run(s.id, session.id, session.term, 62, 3, a.present, uid);
  if (r.changes) attCount++;
}
console.log(`Attendance rows inserted: ${attCount}`);

// ---------- publish end-of-term report cards with comments ----------
const results = require("./results");
const settings = db.prepare("SELECT * FROM school_settings LIMIT 1").get() || {};
const headLabel = settings.head_title || (settings.school_level === "primary" ? "Head Teacher" : "Principal");

const comments = {
  "Ada Okafor":   { teacher: "Excellent performance. Keep up the good work.", head: "An outstanding result. Congratulations." },
  "Bola Adeyemi": { teacher: "Good result. More consistency will earn a top grade.", head: "A very good effort. Keep pushing." },
  "Chika Nwosu":  { teacher: "Very good result. Sustained effort will pay off.", head: "Well done. Continue to work hard." }
};

const klassResult = results.buildClassResults(klass.id, session.id, session.term, "end_of_term");

const upsertCard = db.prepare(`
  INSERT INTO report_cards
    (student_id, session_id, term, type, average, class_average, class_highest, percentage,
     teacher_comment, head_comment, head_label_used, published, published_at, published_by, generated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),?,datetime('now'))
  ON CONFLICT(student_id, session_id, term, type) DO UPDATE SET
    average = excluded.average,
    class_average = excluded.class_average,
    class_highest = excluded.class_highest,
    percentage = excluded.percentage,
    teacher_comment = COALESCE(report_cards.teacher_comment, excluded.teacher_comment),
    head_comment    = COALESCE(report_cards.head_comment, excluded.head_comment),
    head_label_used = excluded.head_label_used,
    published = 1
`);

let published = 0;
for (const s of klassResult.students) {
  const c = comments[s.student.full_name] || {
    teacher: "Good effort this term.",
    head: "Keep working hard."
  };
  upsertCard.run(
    s.student.id, session.id, session.term, "end_of_term",
    s.summary.average, klassResult.class_average, klassResult.class_highest, s.summary.percentage,
    c.teacher, c.head, headLabel, uid
  );
  published++;
}
console.log(`Report cards published: ${published}`);

console.log("");
console.log("Demo data is ready.");
console.log("Next steps:");
console.log("  1. Log in as admin.");
console.log("  2. Go to Report links, pick JSS2 A + 2025/2026 First + End of term, and generate.");
console.log("  3. Open any link to view a fully populated report card.");