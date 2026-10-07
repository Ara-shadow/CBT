"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------- helpers ---------- */

// A "school day" is any date in the term range. We treat every date as open unless the
// teacher explicitly records it as closed via attendance_terms.days_school_closed.
// Simpler approach: teachers enter the term start/end date on the Settings page, and we
// just count weekdays Mon–Fri in that range as "opened". For now we simply sum the
// daily records.

function refreshTermSummary(studentId, sessionId, term) {
  // Count present / absent from daily rows
  const present = db.prepare(`
    SELECT COUNT(*) c FROM attendance_daily
    WHERE student_id=? AND session_id=? AND term=? AND status='P'
  `).get(studentId, sessionId, term).c;

  const absent = db.prepare(`
    SELECT COUNT(*) c FROM attendance_daily
    WHERE student_id=? AND session_id=? AND term=? AND status='A'
  `).get(studentId, sessionId, term).c;

  const opened = present + absent;

  // Read existing summary (to preserve days_school_closed if set)
  const existing = db.prepare(`
    SELECT * FROM attendance_terms WHERE student_id=? AND session_id=? AND term=?
  `).get(studentId, sessionId, term);

  const closed = existing ? existing.days_school_closed : 0;

  if (existing) {
    db.prepare(`
      UPDATE attendance_terms
      SET days_school_opened=?, days_school_closed=?, days_present=?, updated_at=datetime('now')
      WHERE id=?
    `).run(opened, closed, present, existing.id);
  } else if (opened > 0) {
    db.prepare(`
      INSERT INTO attendance_terms
        (student_id, session_id, term, days_school_opened, days_school_closed, days_present)
      VALUES (?,?,?,?,?,?)
    `).run(studentId, sessionId, term, opened, closed, present);
  }
}

/* ---------- GET /api/attendance/days?class_id=&session_id=&term= ----------
   Returns a list of dates already marked for this class, plus the student grid
   for one specific date if provided.
*/

router.get("/days", (req, res) => {
  const { class_id, session_id, term } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term)) {
    return res.status(400).json({ error: "class_id, session_id and term are required" });
  }
  const rows = db.prepare(`
    SELECT DISTINCT date
    FROM attendance_daily
    WHERE session_id=? AND term=?
      AND student_id IN (SELECT id FROM students WHERE class_id=?)
    ORDER BY date DESC
  `).all(Number(session_id), term, Number(class_id));
  res.json({ dates: rows.map(r => r.date) });
});

/* ---------- GET /api/attendance/day?class_id=&session_id=&term=&date= ----------
   Returns every active student in the class, with their current status for that date
   (or null if not marked yet).
*/

router.get("/day", (req, res) => {
  const { class_id, session_id, term, date } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !date) {
    return res.status(400).json({ error: "class_id, session_id, term and date are required" });
  }
  const students = db.prepare(`
    SELECT id, admission_no, full_name
    FROM students WHERE class_id=? AND status='active' ORDER BY full_name
  `).all(Number(class_id));

  const records = db.prepare(`
    SELECT student_id, status FROM attendance_daily
    WHERE session_id=? AND term=? AND date=?
      AND student_id IN (SELECT id FROM students WHERE class_id=?)
  `).all(Number(session_id), term, date, Number(class_id));

  const byStudent = new Map(records.map(r => [r.student_id, r.status]));

  const rows = students.map(s => ({
    student_id: s.id,
    admission_no: s.admission_no,
    full_name: s.full_name,
    status: byStudent.get(s.id) || null
  }));

  res.json({ date, students: rows });
});

/* ---------- POST /api/attendance/day ----------
   Body: { class_id, session_id, term, date, rows: [{student_id, status: 'P'|'A'|null}, ...] }
   null means "delete this student's record for the day".
*/

router.post("/day", (req, res) => {
  const { class_id, session_id, term, date, rows } = req.body || {};
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !date || !Array.isArray(rows)) {
    return res.status(400).json({ error: "class_id, session_id, term, date and rows[] are required" });
  }
  const uid = req.session.user.id;

  try {
    db.exec("BEGIN");

    const del = db.prepare(`
      DELETE FROM attendance_daily
      WHERE student_id=? AND session_id=? AND term=? AND date=?
    `);
    const ins = db.prepare(`
      INSERT INTO attendance_daily
        (student_id, session_id, term, date, status, marked_by, marked_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
    `);

    for (const r of rows) {
      if (!r.student_id) continue;
      del.run(Number(r.student_id), Number(session_id), term, date);
      if (r.status === "P" || r.status === "A") {
        ins.run(Number(r.student_id), Number(session_id), term, date, r.status, uid);
      }
      // refresh the summary for this student
      refreshTermSummary(Number(r.student_id), Number(session_id), term);
    }

    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------- POST /api/attendance/day/mark-all ----------
   Marks the entire class as P or A in one call. Convenience for the common case.
   Body: { class_id, session_id, term, date, status: 'P'|'A' }
*/

router.post("/day/mark-all", (req, res) => {
  const { class_id, session_id, term, date, status } = req.body || {};
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !date || !["P","A"].includes(status)) {
    return res.status(400).json({ error: "class_id, session_id, term, date and status (P|A) are required" });
  }
  const uid = req.session.user.id;
  const students = db.prepare(`
    SELECT id FROM students WHERE class_id=? AND status='active'
  `).all(Number(class_id));

  try {
    db.exec("BEGIN");
    const del = db.prepare(`
      DELETE FROM attendance_daily
      WHERE student_id=? AND session_id=? AND term=? AND date=?
    `);
    const ins = db.prepare(`
      INSERT INTO attendance_daily
        (student_id, session_id, term, date, status, marked_by, marked_at)
      VALUES (?,?,?,?,?,?,datetime('now'))
    `);
    for (const s of students) {
      del.run(s.id, Number(session_id), term, date);
      ins.run(s.id, Number(session_id), term, date, status, uid);
      refreshTermSummary(s.id, Number(session_id), term);
    }
    db.exec("COMMIT");
    res.json({ ok: true, count: students.length });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;