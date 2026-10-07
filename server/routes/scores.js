"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------------- helpers ---------------- */

const LIMITS = { ca1: 10, ca2: 20, project: 10, pbt: 30 };

function clampScore(v, max) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

function computeDerived(row) {
  const midterm = (row.ca1 || 0) + (row.ca2 || 0) + (row.project || 0);
  const exam = (row.cbt_score || 0) + (row.pbt_score || 0);
  const total = midterm + exam;
  return {
    midterm_total: Math.round(midterm * 100) / 100,
    exam_score:    Math.round(exam    * 100) / 100,
    term_total:    Math.round(total   * 100) / 100
  };
}

/* ---------------- GET /api/scores ----------------
   Returns the grid for a class + subject + session + term.
   Auto-creates score rows for every student if missing (so the grid is always full).
*/
router.get("/", (req, res) => {
  const { class_id, subject_id, session_id, term } = req.query;
  if (!class_id || !subject_id || !session_id || !term) {
    return res.status(400).json({ error: "class_id, subject_id, session_id and term are required" });
  }

  const students = db.prepare(`
    SELECT id, admission_no, full_name
    FROM students
    WHERE class_id = ? AND status = 'active'
    ORDER BY full_name
  `).all(Number(class_id));

  if (!students.length) return res.json({ students: [], rows: [] });

  // Fetch existing scores
  const existing = db.prepare(`
    SELECT * FROM scores
    WHERE subject_id = ? AND session_id = ? AND term = ? AND class_id = ?
  `).all(Number(subject_id), Number(session_id), term, Number(class_id));

  const byStudent = new Map(existing.map(r => [r.student_id, r]));

  const rows = students.map(s => {
    const r = byStudent.get(s.id) || {
      student_id: s.id, subject_id: Number(subject_id), class_id: Number(class_id),
      session_id: Number(session_id), term,
      ca1: 0, ca2: 0, project: 0, cbt_score: 0, pbt_score: 0
    };
    const d = computeDerived(r);
    return {
      student_id: s.id,
      admission_no: s.admission_no,
      full_name: s.full_name,
      ca1: r.ca1 || 0,
      ca2: r.ca2 || 0,
      project: r.project || 0,
      cbt_score: r.cbt_score || 0,
      pbt_score: r.pbt_score || 0,
      ...d,
      updated_at: r.updated_at || null
    };
  });

  res.json({ students, rows });
});

/* ---------------- POST /api/scores (bulk save) ----------------
   Body: { class_id, subject_id, session_id, term, rows: [{student_id, ca1, ca2, project, pbt_score}, ...] }
*/
router.post("/", (req, res) => {
  const { class_id, subject_id, session_id, term, rows } = req.body || {};
  if (!class_id || !subject_id || !session_id || !term || !Array.isArray(rows)) {
    return res.status(400).json({ error: "class_id, subject_id, session_id, term and rows[] are required" });
  }

  const uid = req.session.user.id;
  const isAdmin = req.session.user.role === "admin";

  try {
    db.exec("BEGIN");
    const upsert = db.prepare(`
      INSERT INTO scores
        (student_id, subject_id, class_id, session_id, term,
         ca1, ca2, project, pbt_score, entered_by, overridden_by, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(student_id, subject_id, session_id, term) DO UPDATE SET
        ca1 = excluded.ca1,
        ca2 = excluded.ca2,
        project = excluded.project,
        pbt_score = excluded.pbt_score,
        entered_by = excluded.entered_by,
        overridden_by = CASE WHEN ? = 1 THEN excluded.overridden_by ELSE scores.overridden_by END,
        updated_at = datetime('now')
    `);

    for (const r of rows) {
      if (!r.student_id) continue;
      upsert.run(
        Number(r.student_id), Number(subject_id), Number(class_id), Number(session_id), term,
        clampScore(r.ca1, LIMITS.ca1),
        clampScore(r.ca2, LIMITS.ca2),
        clampScore(r.project, LIMITS.project),
        clampScore(r.pbt_score, LIMITS.pbt),
        uid,
        isAdmin ? uid : null,
        isAdmin ? 1 : 0
      );
    }
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- POST /api/scores/sync-cbt ----------------
   Pulls submitted CBT attempts for this class + subject + session + term into scores.cbt_score
   (uses scaled_score which is already scaled to 30)
*/
router.post("/sync-cbt", (req, res) => {
  const { class_id, subject_id, session_id, term } = req.body || {};
  if (!class_id || !subject_id || !session_id || !term) {
    return res.status(400).json({ error: "class_id, subject_id, session_id and term are required" });
  }

  // Find exams matching subject + class + session + term that are published
  const exams = db.prepare(`
    SELECT id FROM exams
    WHERE subject_id = ? AND class_id = ? AND session_id = ? AND term = ? AND is_published = 1
  `).all(Number(subject_id), Number(class_id), Number(session_id), term);

  if (!exams.length) return res.json({ ok: true, updated: 0, reason: "no published exams for this subject/class/term" });

  const examIds = exams.map(e => e.id);
  const ph = examIds.map(() => "?").join(",");

  // Latest submitted attempt per student across those exams
  const attempts = db.prepare(`
    SELECT student_id, scaled_score, submitted_at
    FROM attempts
    WHERE exam_id IN (${ph}) AND submitted_at IS NOT NULL
    ORDER BY submitted_at DESC
  `).all(...examIds);

  // Keep only the latest per student
  const latest = new Map();
  for (const a of attempts) if (!latest.has(a.student_id)) latest.set(a.student_id, a);

  const uid = req.session.user.id;
  let updated = 0;

  try {
    db.exec("BEGIN");
    const upsert = db.prepare(`
      INSERT INTO scores
        (student_id, subject_id, class_id, session_id, term, cbt_score, entered_by, updated_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(student_id, subject_id, session_id, term) DO UPDATE SET
        cbt_score = excluded.cbt_score,
        entered_by = excluded.entered_by,
        updated_at = datetime('now')
    `);

    for (const [studentId, a] of latest) {
      const score = Math.min(30, Math.max(0, Math.round(a.scaled_score || 0)));
      upsert.run(studentId, Number(subject_id), Number(class_id), Number(session_id), term, score, uid);
      updated++;
    }
    db.exec("COMMIT");
    res.json({ ok: true, updated });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- GET /api/scores/attendance ----------------
   Returns attendance rows for a class + session + term
*/
router.get("/attendance", (req, res) => {
  const { class_id, session_id, term } = req.query;
  if (!class_id || !session_id || !term) {
    return res.status(400).json({ error: "class_id, session_id and term are required" });
  }

  const students = db.prepare(`
    SELECT id, admission_no, full_name
    FROM students WHERE class_id = ? AND status = 'active' ORDER BY full_name
  `).all(Number(class_id));

  const existing = db.prepare(`
    SELECT * FROM attendance_terms
    WHERE session_id = ? AND term = ? AND student_id IN (
      SELECT id FROM students WHERE class_id = ?
    )
  `).all(Number(session_id), term, Number(class_id));

  const byStudent = new Map(existing.map(r => [r.student_id, r]));

  // Days opened/closed are class-wide — take them from the first existing row if present
  const sample = existing[0] || { days_school_opened: 0, days_school_closed: 0 };

  const rows = students.map(s => {
    const r = byStudent.get(s.id) || { days_school_opened: 0, days_school_closed: 0, days_present: 0 };
    return {
      student_id: s.id,
      admission_no: s.admission_no,
      full_name: s.full_name,
      days_school_opened: r.days_school_opened || 0,
      days_school_closed: r.days_school_closed || 0,
      days_present:       r.days_present       || 0,
      days_absent: Math.max(0, (r.days_school_opened || 0) - (r.days_present || 0))
    };
  });

  res.json({
    students,
    days_school_opened: sample.days_school_opened || 0,
    days_school_closed: sample.days_school_closed || 0,
    rows
  });
});

/* ---------------- POST /api/scores/attendance (bulk save) ----------------
   Body: { class_id, session_id, term, days_school_opened, days_school_closed, rows: [{student_id, days_present}, ...] }
*/
router.post("/attendance", (req, res) => {
  const { class_id, session_id, term, days_school_opened, days_school_closed, rows } = req.body || {};
  if (!class_id || !session_id || !term || !Array.isArray(rows)) {
    return res.status(400).json({ error: "class_id, session_id, term and rows[] are required" });
  }

  const opened = Math.max(0, Math.floor(Number(days_school_opened) || 0));
  const closed = Math.max(0, Math.floor(Number(days_school_closed) || 0));
  const uid = req.session.user.id;

  try {
    db.exec("BEGIN");
    const upsert = db.prepare(`
      INSERT INTO attendance_terms
        (student_id, session_id, term, days_school_opened, days_school_closed, days_present, entered_by, updated_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(student_id, session_id, term) DO UPDATE SET
        days_school_opened = excluded.days_school_opened,
        days_school_closed = excluded.days_school_closed,
        days_present       = excluded.days_present,
        entered_by = excluded.entered_by,
        updated_at = datetime('now')
    `);

    for (const r of rows) {
      if (!r.student_id) continue;
      const present = Math.min(opened, Math.max(0, Math.floor(Number(r.days_present) || 0)));
      upsert.run(Number(r.student_id), Number(session_id), term, opened, closed, present, uid);
    }
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;