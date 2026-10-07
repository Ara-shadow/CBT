"use strict";

const crypto = require("node:crypto");
const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function defaultExpiryDays() {
  const s = db.prepare("SELECT report_link_days FROM school_settings LIMIT 1").get();
  return (s && s.report_link_days) || 30;
}

function expiryFromNow(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

router.post("/", (req, res) => {
  const { student_id, session_id, term, type, days } = req.body || {};
  if (!student_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "student_id, session_id, term, type are required" });
  }
  const days_num = Number(days) || defaultExpiryDays();
  const token = makeToken();
  const expires_at = expiryFromNow(days_num);
  const r = db.prepare(`
    INSERT INTO report_tokens
      (token, student_id, session_id, term, type, created_by, expires_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(token, Number(student_id), Number(session_id), term, type, req.session.user.id, expires_at);
  res.json({ ok: true, id: r.lastInsertRowid, token, expires_at });
});

router.post("/bulk", (req, res) => {
  const { class_id, session_id, term, type, days } = req.body || {};
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "class_id, session_id, term, type are required" });
  }
  const days_num = Number(days) || defaultExpiryDays();

  const students = db.prepare(`
    SELECT id, admission_no, full_name FROM students
    WHERE class_id = ? AND status = 'active' ORDER BY full_name
  `).all(Number(class_id));

  if (!students.length) return res.json({ ok: true, generated: [] });

  const expires_at = expiryFromNow(days_num);
  const ins = db.prepare(`
    INSERT INTO report_tokens
      (token, student_id, session_id, term, type, created_by, expires_at)
    VALUES (?,?,?,?,?,?,?)
  `);

  const generated = [];
  try {
    db.exec("BEGIN");
    for (const s of students) {
      const token = makeToken();
      ins.run(token, s.id, Number(session_id), term, type, req.session.user.id, expires_at);
      generated.push({ student_id: s.id, admission_no: s.admission_no, full_name: s.full_name, token, expires_at });
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true, generated });
});

router.get("/", (req, res) => {
  const rows = db.prepare(`
    SELECT rt.*,
           s.full_name AS student_name, s.admission_no,
           c.name AS class_name, c.arm AS class_arm,
           ses.name AS session_name
    FROM report_tokens rt
    JOIN students s ON s.id = rt.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN academic_sessions ses ON ses.id = rt.session_id
    ORDER BY rt.created_at DESC, rt.id DESC
  `).all();
  res.json({ tokens: rows });
});

router.post("/:id/revoke", (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare("SELECT * FROM report_tokens WHERE id=?").get(id);
  if (!r) return res.status(404).json({ error: "Link not found" });
  db.prepare("UPDATE report_tokens SET revoked = 1 WHERE id=?").run(id);
  res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM report_tokens WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;