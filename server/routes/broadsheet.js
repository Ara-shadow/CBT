"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");
const results = require("../results");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------- helpers ---------- */

// All classes a user is allowed to access.
// admin -> every class; teacher -> form class + every class they teach a subject in.
function classesForUser(user) {
  if (user.role === "admin") {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.arm, c.level, NULL AS subject_name
      FROM classes c
      ORDER BY c.level, c.name, c.arm
    `).all();
    return rows.map(r => ({ ...r, role: "admin" }));
  }

  // teacher:
  const out = new Map();

  // 1) form class
  const form = db.prepare(`
    SELECT c.id, c.name, c.arm, c.level
    FROM classes c
    WHERE c.form_teacher_id = ?
  `).all(user.id);
  for (const c of form) {
    out.set(c.id, { ...c, role: "form", subject_name: null });
  }

  // 2) classes where they teach any subject
  const taught = db.prepare(`
    SELECT DISTINCT c.id, c.name, c.arm, c.level, s.name AS subject_name
    FROM class_subjects cs
    JOIN classes c  ON c.id = cs.class_id
    JOIN subjects s ON s.id = cs.subject_id
    WHERE cs.teacher_id = ?
    ORDER BY c.name, c.arm, s.name
  `).all(user.id);

  for (const c of taught) {
    if (!out.has(c.id)) {
      out.set(c.id, { ...c, role: "teacher", subject_name: c.subject_name });
    }
  }

  return Array.from(out.values());
}

function userCanAccessClass(user, classId) {
  if (user.role === "admin") return true;
  const list = classesForUser(user);
  return list.some(c => c.id === Number(classId));
}

/* ---------- GET /api/broadsheet/classes ----------
   The classes this logged-in user can view a broadsheet for.
*/
router.get("/classes", (req, res) => {
  const list = classesForUser(req.session.user);
  res.json({
    isAdmin: req.session.user.role === "admin",
    classes: list
  });
});

/* ---------- GET /api/broadsheet?class_id=&session_id=&term=&type= ---------- */
router.get("/", (req, res) => {
  const { class_id, session_id, term, type } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "class_id, session_id, term and type are required" });
  }

  // Permission check
  if (!userCanAccessClass(req.session.user, Number(class_id))) {
    return res.status(403).json({ error: "You don't have access to this class" });
  }

  const klass = db.prepare("SELECT * FROM classes WHERE id=?").get(Number(class_id));
  if (!klass) return res.status(404).json({ error: "Class not found" });
  const session = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(Number(session_id));
  if (!session) return res.status(404).json({ error: "Session not found" });

  const classResults = results.buildClassResults(klass.id, session.id, term, type);

  const subjectMap = new Map();
  for (const s of classResults.students) {
    for (const sub of s.subjects) {
      if (!subjectMap.has(sub.subject_id)) {
        subjectMap.set(sub.subject_id, {
          id: sub.subject_id,
          name: sub.subject_name,
          code: sub.subject_code || ""
        });
      }
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const rows = classResults.students.map(s => {
    const scoreBySubject = {};
    for (const sub of s.subjects) {
      scoreBySubject[sub.subject_id] = type === "midterm" ? sub.midterm_total : sub.term_total;
    }
    return {
      id: s.student.id,
      admission_no: s.student.admission_no,
      full_name: s.student.full_name,
      gender: s.student.gender,
      scores: scoreBySubject,
      sum: s.summary.sum_scores,
      average: s.summary.average,
      percentage: s.summary.percentage,
      subject_count: s.summary.subjects_count
    };
  });

  rows.sort((a, b) => b.average - a.average);
  let lastAvg = null, lastPosition = 0;
  rows.forEach((r, i) => {
    if (lastAvg === null || r.average < lastAvg) {
      lastPosition = i + 1;
      lastAvg = r.average;
    }
    r.position = lastPosition;
  });

  const subject_stats = {};
  for (const sub of subjects) {
    const vals = rows.map(r => r.scores[sub.id]).filter(v => typeof v === "number");
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      subject_stats[sub.id] = {
        average: Math.round(avg * 10) / 10,
        highest: Math.max(...vals),
        lowest: Math.min(...vals)
      };
    } else {
      subject_stats[sub.id] = { average: 0, highest: 0, lowest: 0 };
    }
  }

  const percentages = rows.map(r => r.percentage);
  const class_stats = {
    average: classResults.class_average,
    highest: classResults.class_highest,
    lowest: percentages.length ? Math.round(Math.min(...percentages) * 10) / 10 : 0,
    students: rows.length
  };

  res.json({
    class: { id: klass.id, name: klass.name, arm: klass.arm, level: klass.level },
    session: { id: session.id, name: session.name, term },
    term,
    type,
    subjects,
    students: rows,
    subject_stats,
    class_stats
  });
});

/* ---------- GET /api/broadsheet/csv ---------- */
router.get("/csv", (req, res) => {
  const { class_id, session_id, term, type } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).send("Missing parameters");
  }

  if (!userCanAccessClass(req.session.user, Number(class_id))) {
    return res.status(403).send("Forbidden");
  }

  const klass = db.prepare("SELECT * FROM classes WHERE id=?").get(Number(class_id));
  const session = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(Number(session_id));
  if (!klass || !session) return res.status(404).send("Class or session not found");

  const classResults = results.buildClassResults(klass.id, session.id, term, type);
  const subjectMap = new Map();
  for (const s of classResults.students) {
    for (const sub of s.subjects) {
      if (!subjectMap.has(sub.subject_id)) {
        subjectMap.set(sub.subject_id, { id: sub.subject_id, name: sub.subject_name });
      }
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const rows = classResults.students.map(s => {
    const scoreBySubject = {};
    for (const sub of s.subjects) {
      scoreBySubject[sub.subject_id] = type === "midterm" ? sub.midterm_total : sub.term_total;
    }
    return {
      admission_no: s.student.admission_no,
      full_name: s.student.full_name,
      gender: s.student.gender,
      scores: scoreBySubject,
      sum: s.summary.sum_scores,
      average: s.summary.average,
      percentage: s.summary.percentage
    };
  });

  rows.sort((a, b) => b.average - a.average);
  let lastAvg = null, lastPosition = 0;
  rows.forEach((r, i) => {
    if (lastAvg === null || r.average < lastAvg) { lastPosition = i + 1; lastAvg = r.average; }
    r.position = lastPosition;
  });

  const header = ["#", "Adm No", "Student", "Sex", ...subjects.map(s => s.name), "Sum", "Average", "%", "Position"];
  const lines = [header.map(csvEscape).join(",")];

  rows.forEach((r, i) => {
    const line = [
      i + 1,
      r.admission_no,
      r.full_name,
      r.gender || "",
      ...subjects.map(s => r.scores[s.id] != null ? r.scores[s.id] : ""),
      r.sum,
      r.average,
      r.percentage,
      r.position
    ];
    lines.push(line.map(csvEscape).join(","));
  });

  const stamp = new Date().toISOString().slice(0,10);
  const filename = `broadsheet-${klass.name}${klass.arm || ""}-${term}-${type}-${stamp}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + lines.join("\r\n"));
});

function csvEscape(v) {
  const s = String(v == null ? "" : v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = router;