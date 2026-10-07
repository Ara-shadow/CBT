"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");
const results = require("../results");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------- GET /api/results/class?class_id=&session_id=&term=&type= ---------- */
router.get("/class", (req, res) => {
  const { class_id, session_id, term, type } = req.query;
  if (!class_id || !session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "class_id, session_id, term, and type (midterm|end_of_term) are required" });
  }
  try {
    const data = results.buildClassResults(Number(class_id), Number(session_id), term, type);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- GET /api/results/student/:id?session_id=&term=&type= ---------- */
router.get("/student/:id", (req, res) => {
  const { session_id, term, type } = req.query;
  if (!session_id || !["First","Second","Third"].includes(term) || !["midterm","end_of_term"].includes(type)) {
    return res.status(400).json({ error: "session_id, term, and type are required" });
  }
  const student = db.prepare("SELECT id, admission_no, full_name, class_id, gender FROM students WHERE id=?").get(Number(req.params.id));
  if (!student) return res.status(404).json({ error: "Student not found" });
  const session = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(Number(session_id));
  if (!session) return res.status(404).json({ error: "Session not found" });

  const klass = results.buildClassResults(student.class_id, session.id, term, type);
  const data = results.buildStudentResult(student, session, term, type);
  data.class_average = klass.class_average;
  data.class_highest = klass.class_highest;

  const settings = db.prepare("SELECT * FROM school_settings LIMIT 1").get() || {};
  data.school = settings;

  const card = db.prepare(`
    SELECT * FROM report_cards
    WHERE student_id=? AND session_id=? AND term=? AND type=?
  `).get(student.id, session.id, term, type);
  data.card = card || null;

  res.json(data);
});



module.exports = router;