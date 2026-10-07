"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------- GET /api/register/students?class_id= ----------
   Returns the class list with admission numbers, gender, and guardian details.
*/
router.get("/students", (req, res) => {
  const classId = Number(req.query.class_id);
  if (!classId) return res.status(400).json({ error: "class_id is required" });

  const klass = db.prepare("SELECT * FROM classes WHERE id=?").get(classId);
  if (!klass) return res.status(404).json({ error: "Class not found" });

  const students = db.prepare(`
    SELECT id, admission_no, full_name, gender, date_of_birth,
           guardian_name, guardian_phone, status
    FROM students
    WHERE class_id = ? AND status='active'
    ORDER BY full_name
  `).all(classId);

  // form teacher name (if set)
  const formTeacher = klass.form_teacher_id
    ? db.prepare("SELECT full_name FROM users WHERE id=?").get(klass.form_teacher_id)?.full_name
    : null;

  res.json({
    class: { id: klass.id, name: klass.name, arm: klass.arm, level: klass.level, form_teacher_name: formTeacher },
    students
  });
});

/* ---------- GET /api/register/context ----------
   Returns the school name / address + the current session.
   Used for the printed header.
*/
router.get("/context", (req, res) => {
  const settings = db.prepare("SELECT school_name, address, school_level, head_title FROM school_settings LIMIT 1").get() || {};
  const currentSession = db.prepare("SELECT name, term FROM academic_sessions WHERE is_current=1 LIMIT 1").get() || null;
  const sessions = db.prepare("SELECT id, name, term, is_current FROM academic_sessions ORDER BY is_current DESC, name DESC, term").all();
  res.json({ settings, currentSession, sessions });
});

module.exports = router;