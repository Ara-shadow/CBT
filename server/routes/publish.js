"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");
const results = require("../results");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------- helpers ---------- */

function headTitle(settings) {
  if (!settings) return "Principal";
  if (settings.head_title && settings.head_title.trim()) return settings.head_title.trim();
  return settings.school_level === "primary" ? "Head Teacher" : "Principal";
}

/* ---------- GET comments + publish status for a class ---------- */
router.get("/comments", (req, res) => {
  const { class_id, session_id, term, type } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "class_id, session_id, term, and type are required" });
  }
  const rows = db.prepare(`
    SELECT rc.student_id, rc.teacher_comment, rc.head_comment, rc.head_label_used,
           rc.published, rc.published_at, rc.average, rc.class_average, rc.class_highest, rc.percentage
    FROM report_cards rc
    WHERE rc.session_id = ? AND rc.term = ? AND rc.type = ?
      AND rc.student_id IN (SELECT id FROM students WHERE class_id = ?)
  `).all(Number(session_id), term, type, Number(class_id));
  res.json({ cards: rows });
});

/* ---------- POST /api/results/publish ----------
   Body: { class_id, session_id, term, type, cards: [{student_id, teacher_comment, head_comment}, ...] }
   Freezes report_cards for each student. Admin only.
*/
router.post("/publish", requireRole("admin"), (req, res) => {
  const { class_id, session_id, term, type, cards } = req.body || {};
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type) || !Array.isArray(cards)) {
    return res.status(400).json({ error: "class_id, session_id, term, type and cards[] are required" });
  }

  const settings = db.prepare("SELECT * FROM school_settings LIMIT 1").get() || {};
  const label = headTitle(settings);
  const adminId = req.session.user.id;

  try {
    db.exec("BEGIN");

    // Compute class stats once
    const klass = results.buildClassResults(Number(class_id), Number(session_id), term, type);

    const upsert = db.prepare(`
      INSERT INTO report_cards
        (student_id, session_id, term, type, average, class_average, class_highest, percentage,
         teacher_comment, head_comment, head_label_used, published, published_at, published_by, generated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'),?,datetime('now'))
      ON CONFLICT(student_id, session_id, term, type) DO UPDATE SET
        average = excluded.average,
        class_average = excluded.class_average,
        class_highest = excluded.class_highest,
        percentage = excluded.percentage,
        teacher_comment = excluded.teacher_comment,
        head_comment = excluded.head_comment,
        head_label_used = excluded.head_label_used,
        published = 1,
        published_at = datetime('now'),
        published_by = excluded.published_by
    `);

    let published = 0;
    for (const c of cards) {
      const stu = klass.students.find(s => s.student.id === Number(c.student_id));
      if (!stu) continue;
      upsert.run(
        Number(c.student_id), Number(session_id), term, type,
        stu.summary.average,
        klass.class_average, klass.class_highest, stu.summary.percentage,
        c.teacher_comment || null, c.head_comment || null, label,
        adminId
      );
      published++;
    }

    db.exec("COMMIT");
    res.json({ ok: true, published, head_label_used: label });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------- POST /api/results/unpublish ---------- */
router.post("/unpublish", requireRole("admin"), (req, res) => {
  const { class_id, session_id, term, type } = req.body || {};
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "class_id, session_id, term, type are required" });
  }
  const r = db.prepare(`
    UPDATE report_cards SET published = 0
    WHERE session_id = ? AND term = ? AND type = ?
      AND student_id IN (SELECT id FROM students WHERE class_id = ?)
  `).run(Number(session_id), term, type, Number(class_id));
  res.json({ ok: true, unpublished: r.changes });
});

module.exports = router;