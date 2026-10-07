"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

/* ---------------- SESSIONS ---------------- */

router.get("/sessions", (req, res) => {
  const rows = db.prepare("SELECT * FROM academic_sessions ORDER BY name DESC, term").all();
  res.json({ sessions: rows });
});

router.post("/sessions", (req, res) => {
  const { name, term, is_current } = req.body || {};
  if (!name || !["First", "Second", "Third"].includes(term)) {
    return res.status(400).json({ error: "name and term (First/Second/Third) are required" });
  }
  const exists = db.prepare("SELECT id FROM academic_sessions WHERE name=? AND term=?").get(name, term);
  if (exists) return res.status(409).json({ error: "That session + term already exists" });

  if (is_current) db.prepare("UPDATE academic_sessions SET is_current = 0").run();
  const r = db.prepare("INSERT INTO academic_sessions (name, term, is_current) VALUES (?,?,?)")
    .run(name, term, is_current ? 1 : 0);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.post("/sessions/:id/current", (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  db.prepare("UPDATE academic_sessions SET is_current = 0").run();
  db.prepare("UPDATE academic_sessions SET is_current = 1 WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.delete("/sessions/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare("SELECT COUNT(*) c FROM exams WHERE session_id=?").get(id).c
             + db.prepare("SELECT COUNT(*) c FROM scores WHERE session_id=?").get(id).c;
  if (used) return res.status(409).json({ error: "Cannot delete: session is in use by exams or scores" });
  db.prepare("DELETE FROM academic_sessions WHERE id = ?").run(id);
  res.json({ ok: true });
});

/* ---------------- CLASSES ---------------- */

router.get("/classes", (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.full_name AS form_teacher_name
    FROM classes c
    LEFT JOIN users u ON u.id = c.form_teacher_id
    ORDER BY c.level, c.name, c.arm
  `).all();
  res.json({ classes: rows });
});

router.post("/classes", (req, res) => {
  const { name, arm, level, form_teacher_id } = req.body || {};
  if (!name || !level) return res.status(400).json({ error: "name and level are required" });
  if (!["primary", "secondary"].includes(level)) {
    return res.status(400).json({ error: "level must be primary or secondary" });
  }
  const exists = db.prepare("SELECT id FROM classes WHERE name=? AND IFNULL(arm,'')=IFNULL(?,'')")
    .get(name, arm || null);
  if (exists) return res.status(409).json({ error: "That class + arm already exists" });
  const r = db.prepare("INSERT INTO classes (name, arm, level, form_teacher_id) VALUES (?,?,?,?)")
    .run(name, arm || null, level, form_teacher_id || null);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put("/classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const c = db.prepare("SELECT * FROM classes WHERE id=?").get(id);
  if (!c) return res.status(404).json({ error: "Class not found" });
  const { name, arm, level, form_teacher_id } = req.body || {};
  db.prepare(`UPDATE classes SET name=?, arm=?, level=?, form_teacher_id=? WHERE id=?`)
    .run(name ?? c.name, arm ?? c.arm, level ?? c.level, form_teacher_id ?? c.form_teacher_id, id);
  res.json({ ok: true });
});

router.delete("/classes/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare("SELECT COUNT(*) c FROM students WHERE class_id=?").get(id).c;
  if (used) return res.status(409).json({ error: "Cannot delete: class has students" });
  db.prepare("DELETE FROM classes WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---------------- SUBJECTS ---------------- */

router.get("/subjects", (req, res) => {
  const rows = db.prepare("SELECT * FROM subjects ORDER BY class_level, name").all();
  res.json({ subjects: rows });
});

router.post("/subjects", (req, res) => {
  const { name, code, class_level } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const level = class_level || "both";
  if (!["primary", "secondary", "both"].includes(level)) {
    return res.status(400).json({ error: "class_level must be primary, secondary or both" });
  }
  if (code) {
    const dup = db.prepare("SELECT id FROM subjects WHERE code=?").get(code);
    if (dup) return res.status(409).json({ error: "Subject code already used" });
  }
  const r = db.prepare("INSERT INTO subjects (name, code, class_level) VALUES (?,?,?)")
    .run(name, code || null, level);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.put("/subjects/:id", (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT * FROM subjects WHERE id=?").get(id);
  if (!s) return res.status(404).json({ error: "Subject not found" });
  const { name, code, class_level } = req.body || {};
  db.prepare("UPDATE subjects SET name=?, code=?, class_level=? WHERE id=?")
    .run(name ?? s.name, code ?? s.code, class_level ?? s.class_level, id);
  res.json({ ok: true });
});

router.delete("/subjects/:id", (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare("SELECT COUNT(*) c FROM questions WHERE subject_id=?").get(id).c
             + db.prepare("SELECT COUNT(*) c FROM exams WHERE subject_id=?").get(id).c;
  if (used) return res.status(409).json({ error: "Cannot delete: subject is in use by questions or exams" });
  db.prepare("DELETE FROM subjects WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---------------- CLASS–SUBJECT ASSIGNMENTS ---------------- */

router.get("/class-subjects", (req, res) => {
  const rows = db.prepare(`
    SELECT cs.id, cs.class_id, cs.subject_id, cs.teacher_id,
           c.name AS class_name, c.arm AS class_arm,
           s.name AS subject_name, s.code AS subject_code,
           u.full_name AS teacher_name
    FROM class_subjects cs
    JOIN classes c  ON c.id = cs.class_id
    JOIN subjects s ON s.id = cs.subject_id
    LEFT JOIN users u ON u.id = cs.teacher_id
    ORDER BY c.name, c.arm, s.name
  `).all();
  res.json({ assignments: rows });
});

router.post("/class-subjects", (req, res) => {
  const { class_id, subject_id, teacher_id } = req.body || {};
  if (!class_id || !subject_id) {
    return res.status(400).json({ error: "class_id and subject_id are required" });
  }
  const dup = db.prepare("SELECT id FROM class_subjects WHERE class_id=? AND subject_id=?")
    .get(class_id, subject_id);
  if (dup) return res.status(409).json({ error: "That subject is already assigned to this class" });
  const r = db.prepare("INSERT INTO class_subjects (class_id, subject_id, teacher_id) VALUES (?,?,?)")
    .run(class_id, subject_id, teacher_id || null);
  res.json({ ok: true, id: r.lastInsertRowid });
});

router.delete("/class-subjects/:id", (req, res) => {
  db.prepare("DELETE FROM class_subjects WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

/* ---------------- TEACHERS (for dropdowns) ---------------- */

router.get("/teachers", (req, res) => {
  const rows = db.prepare(`
    SELECT id, full_name, username FROM users
    WHERE role='teacher' AND is_active=1 ORDER BY full_name
  `).all();
  res.json({ teachers: rows });
});

module.exports = router;