"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------------- list ---------------- */

// GET /api/exams?mine=1
router.get("/", (req, res) => {
  const user = req.session.user;
  const mine = req.query.mine === "1";

  let sql = `
    SELECT e.*,
           s.name AS subject_name, s.code AS subject_code,
           c.name AS class_name, c.arm AS class_arm,
           ses.name AS session_name, ses.term AS session_term,
           u.full_name AS created_by_name,
           (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count,
           (SELECT IFNULL(SUM(q.marks),0) FROM exam_questions eq
              JOIN questions q ON q.id = eq.question_id
              WHERE eq.exam_id = e.id) AS total_marks
    FROM exams e
    LEFT JOIN subjects s ON s.id = e.subject_id
    LEFT JOIN classes  c ON c.id = e.class_id
    LEFT JOIN academic_sessions ses ON ses.id = e.session_id
    LEFT JOIN users    u ON u.id = e.created_by
    WHERE 1=1
  `;
  const params = [];
  if (mine || user.role === "teacher") {
    sql += " AND e.created_by = ?";
    params.push(user.id);
  }
  sql += " ORDER BY e.created_at DESC, e.id DESC";
  const exams = db.prepare(sql).all(...params);
  res.json({ exams });
});

/* ---------------- detail ---------------- */

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const exam = db.prepare(`
    SELECT e.*,
           s.name AS subject_name, c.name AS class_name, c.arm AS class_arm,
           ses.name AS session_name, ses.term AS session_term
    FROM exams e
    LEFT JOIN subjects s ON s.id = e.subject_id
    LEFT JOIN classes  c ON c.id = e.class_id
    LEFT JOIN academic_sessions ses ON ses.id = e.session_id
    WHERE e.id = ?
  `).get(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const questions = db.prepare(`
    SELECT eq.sort_order, q.*,
           s.name AS subject_name
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    LEFT JOIN subjects s ON s.id = q.subject_id
    WHERE eq.exam_id = ?
    ORDER BY eq.sort_order, eq.id
  `).all(id);

  res.json({ exam, questions });
});

/* ---------------- validation ---------------- */

function validateExamBody(body, { requireQuestions }) {
  const { title, subject_id, class_id, session_id, term, duration_minutes, pass_mark } = body || {};
  if (!title || !title.trim()) return "Title is required";
  if (!subject_id) return "Subject is required";
  if (!class_id) return "Class is required";
  if (!session_id) return "Session is required";
  if (!["First", "Second", "Third"].includes(term)) return "Term must be First, Second or Third";

  const dur = Number(duration_minutes);
  if (isNaN(dur) || dur < 1) return "Duration must be at least 1 minute";
  const pass = Number(pass_mark);
  if (isNaN(pass) || pass < 1 || pass > 100) return "Pass mark must be 1–100";

  if (requireQuestions) {
    const qs = Array.isArray(body.questions) ? body.questions : [];
    if (qs.length < 1) return "Pick at least one question";
  }
  return null;
}

/* ---------------- create ---------------- */

router.post("/", (req, res) => {
  const err = validateExamBody(req.body, { requireQuestions: true });
  if (err) return res.status(400).json({ error: err });

  const {
    title, subject_id, class_id, session_id, term,
    duration_minutes, pass_mark, shuffle_questions, shuffle_options,
    questions
  } = req.body;

  const qIds = questions.map(q => Number(typeof q === "object" ? q.id : q)).filter(Boolean);
  if (!qIds.length) return res.status(400).json({ error: "No valid questions selected" });

  // verify all questions exist
  const placeholders = qIds.map(() => "?").join(",");
  const found = db.prepare(`SELECT id FROM questions WHERE id IN (${placeholders})`).all(...qIds);
  if (found.length !== qIds.length) return res.status(400).json({ error: "Some questions no longer exist" });

  try {
    db.exec("BEGIN");
    const examId = db.prepare(`
      INSERT INTO exams
        (title, subject_id, class_id, session_id, term,
         duration_minutes, pass_mark, shuffle_questions, shuffle_options,
         created_by, is_published)
      VALUES (?,?,?,?,?,?,?,?,?,?,0)
    `).run(
      title.trim(), subject_id, class_id, session_id, term,
      Number(duration_minutes), Number(pass_mark),
      shuffle_questions ? 1 : 0, shuffle_options ? 1 : 0,
      req.session.user.id
    ).lastInsertRowid;

    const ins = db.prepare("INSERT INTO exam_questions (exam_id, question_id, sort_order) VALUES (?,?,?)");
    qIds.forEach((qid, i) => ins.run(examId, qid, i));

    db.exec("COMMIT");
    res.json({ ok: true, id: examId });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- update ---------------- */

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const isAdmin = req.session.user.role === "admin";
  const isOwner = exam.created_by === req.session.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: "You can only edit your own exams" });

  const err = validateExamBody(req.body, { requireQuestions: true });
  if (err) return res.status(400).json({ error: err });

  const {
    title, subject_id, class_id, session_id, term,
    duration_minutes, pass_mark, shuffle_questions, shuffle_options,
    questions
  } = req.body;

  const qIds = questions.map(q => Number(typeof q === "object" ? q.id : q)).filter(Boolean);
  if (!qIds.length) return res.status(400).json({ error: "No valid questions selected" });

  try {
    db.exec("BEGIN");
    db.prepare(`
      UPDATE exams SET
        title=?, subject_id=?, class_id=?, session_id=?, term=?,
        duration_minutes=?, pass_mark=?, shuffle_questions=?, shuffle_options=?
      WHERE id=?
    `).run(
      title.trim(), subject_id, class_id, session_id, term,
      Number(duration_minutes), Number(pass_mark),
      shuffle_questions ? 1 : 0, shuffle_options ? 1 : 0,
      id
    );

    db.prepare("DELETE FROM exam_questions WHERE exam_id=?").run(id);
    const ins = db.prepare("INSERT INTO exam_questions (exam_id, question_id, sort_order) VALUES (?,?,?)");
    qIds.forEach((qid, i) => ins.run(id, qid, i));

    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

/* ---------------- delete ---------------- */

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const isAdmin = req.session.user.role === "admin";
  const isOwner = exam.created_by === req.session.user.id;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: "You can only delete your own exams" });

  const attempts = db.prepare("SELECT COUNT(*) c FROM attempts WHERE exam_id=?").get(id).c;
  if (attempts) {
    return res.status(409).json({
      error: `Cannot delete: ${attempts} student attempt(s) exist. Unpublish instead.`
    });
  }

  db.prepare("DELETE FROM exams WHERE id=?").run(id);
  res.json({ ok: true });
});

/* ---------------- publish / unpublish (admin only) ---------------- */

router.post("/:id/publish", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const qs = db.prepare("SELECT COUNT(*) c FROM exam_questions WHERE exam_id=?").get(id).c;
  if (!qs) return res.status(400).json({ error: "Add at least one question before publishing" });
  db.prepare("UPDATE exams SET is_published = 1 WHERE id=?").run(id);
  res.json({ ok: true });
});

router.post("/:id/unpublish", requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });
  const attempts = db.prepare("SELECT COUNT(*) c FROM attempts WHERE exam_id=?").get(id).c;
  if (attempts) return res.status(409).json({ error: "Cannot unpublish: students have already attempted this exam" });
  db.prepare("UPDATE exams SET is_published = 0 WHERE id=?").run(id);
  res.json({ ok: true });
});

module.exports = router;