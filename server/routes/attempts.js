"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("student"));

/* ---------- helpers ---------- */

// Fisher–Yates
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Get the student row linked to this logged-in user
function getStudentForUser(userId) {
  return db.prepare("SELECT * FROM students WHERE user_id = ?").get(userId);
}

// Total marks for an exam
function totalMarksForExam(examId) {
  return db.prepare(`
    SELECT IFNULL(SUM(q.marks),0) AS total
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ?
  `).get(examId).total;
}

/* ---------- list available exams for this student ---------- */

router.get("/available", (req, res) => {
  const student = getStudentForUser(req.session.user.id);
  if (!student) return res.status(400).json({ error: "No student record is linked to this account" });

  const exams = db.prepare(`
    SELECT e.id, e.title, e.duration_minutes, e.pass_mark,
           e.subject_id, e.session_id, e.term,
           s.name AS subject_name, s.code AS subject_code,
           ses.name AS session_name, ses.term AS session_term,
           (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count
    FROM exams e
    LEFT JOIN subjects s ON s.id = e.subject_id
    LEFT JOIN academic_sessions ses ON ses.id = e.session_id
    WHERE e.is_published = 1 AND e.class_id = ?
    ORDER BY e.created_at DESC
  `).all(student.class_id);

  // Annotate with attempt status for this student
  const attempts = db.prepare(`
    SELECT id, exam_id, started_at, submitted_at
    FROM attempts WHERE student_id = ?
  `).all(student.id);
  const byExam = new Map(attempts.map(a => [a.exam_id, a]));

  const withStatus = exams.map(e => {
    const a = byExam.get(e.id);
    return {
      ...e,
      attempt_id: a ? a.id : null,
      started_at: a ? a.started_at : null,
      submitted_at: a ? a.submitted_at : null,
      status: !a ? "not_started" : (a.submitted_at ? "submitted" : "in_progress")
    };
  });

  res.json({ student: { id: student.id, full_name: student.full_name, class_id: student.class_id }, exams: withStatus });
});

/* ---------- list my attempts (no scores) ---------- */

router.get("/mine", (req, res) => {
  const student = getStudentForUser(req.session.user.id);
  if (!student) return res.json({ attempts: [] });

  const rows = db.prepare(`
    SELECT a.id, a.exam_id, a.started_at, a.submitted_at,
           e.title, e.duration_minutes,
           s.name AS subject_name
    FROM attempts a
    JOIN exams e ON e.id = a.exam_id
    LEFT JOIN subjects s ON s.id = e.subject_id
    WHERE a.student_id = ?
    ORDER BY a.started_at DESC
  `).all(student.id);

  res.json({ attempts: rows });
});

/* ---------- start (or resume) an attempt ---------- */

router.post("/start/:examId", (req, res) => {
  const examId = Number(req.params.examId);
  const student = getStudentForUser(req.session.user.id);
  if (!student) return res.status(400).json({ error: "No student record linked to this account" });

  const exam = db.prepare(`
    SELECT * FROM exams WHERE id = ? AND is_published = 1
  `).get(examId);
  if (!exam) return res.status(404).json({ error: "Exam not available" });
  if (exam.class_id !== student.class_id) {
    return res.status(403).json({ error: "This exam is not for your class" });
  }

  // Find or create the attempt
  let attempt = db.prepare("SELECT * FROM attempts WHERE exam_id=? AND student_id=?").get(examId, student.id);

  if (attempt && attempt.submitted_at) {
    return res.status(409).json({ error: "You have already submitted this exam" });
  }

  if (!attempt) {
    const r = db.prepare("INSERT INTO attempts (exam_id, student_id, started_at) VALUES (?,?,datetime('now'))")
      .run(examId, student.id);
    attempt = db.prepare("SELECT * FROM attempts WHERE id=?").get(r.lastInsertRowid);
  }

  // ---------- build the question payload ----------
  const baseQs = db.prepare(`
    SELECT q.id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
           q.marks, q.correct_answer, eq.sort_order
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ?
    ORDER BY eq.sort_order, eq.id
  `).all(examId);

  if (!baseQs.length) return res.status(400).json({ error: "This exam has no questions" });

  // ---------- shuffle questions and options if requested ----------
  let orderedQs = baseQs;
  if (exam.shuffle_questions) orderedQs = shuffle(orderedQs);

  // Store the option mapping so we can score later even if options are shuffled.
  // shape: { "<question_id>": { "A": "B", "B": "D", ... } }   // displayed letter -> original letter
  const optionMap = {};

  const questionsOut = orderedQs.map(q => {
    const letters = ["A","B","C","D","E"];
    const originalOptions = letters.map(L => ({ L, text: q["option_" + L.toLowerCase()] }))
                                   .filter(o => o.text);

    let display = originalOptions;
    if (exam.shuffle_options) display = shuffle(originalOptions);

    // If not shuffled, identity map.
    const map = {};
    display.forEach((o, i) => {
      map[letters[i]] = o.L;
    });
    optionMap[q.id] = map;

    return {
      id: q.id,
      question: q.question,
      marks: q.marks,
      options: display.map((o, i) => ({ letter: letters[i], text: o.text }))
    };
  });

  // Save the map on the attempt (add a column if missing)
  const cols = db.prepare("PRAGMA table_info(attempts)").all().map(c => c.name);
  if (!cols.includes("option_map_json")) {
    db.exec("ALTER TABLE attempts ADD COLUMN option_map_json TEXT");
  }
  db.prepare("UPDATE attempts SET option_map_json=? WHERE id=?")
    .run(JSON.stringify(optionMap), attempt.id);

  // Seconds remaining from original started_at
  const startedMs = new Date(attempt.started_at.replace(" ", "T") + "Z").getTime();
  const endsMs = startedMs + exam.duration_minutes * 60 * 1000;
  const secondsLeft = Math.max(0, Math.round((endsMs - Date.now()) / 1000));

  res.json({
    attempt: {
      id: attempt.id,
      exam_id: exam.id,
      started_at: attempt.started_at,
      seconds_left: secondsLeft,
      duration_minutes: exam.duration_minutes
    },
    exam: {
      id: exam.id,
      title: exam.title,
      pass_mark: exam.pass_mark
    },
    questions: questionsOut
  });
});

/* ---------- submit ---------- */

router.post("/:attemptId/submit", (req, res) => {
  const attemptId = Number(req.params.attemptId);
  const student = getStudentForUser(req.session.user.id);
  if (!student) return res.status(400).json({ error: "No student record linked" });

  const attempt = db.prepare("SELECT * FROM attempts WHERE id=? AND student_id=?").get(attemptId, student.id);
  if (!attempt) return res.status(404).json({ error: "Attempt not found" });
  if (attempt.submitted_at) return res.status(409).json({ error: "Already submitted" });

  const exam = db.prepare("SELECT * FROM exams WHERE id=?").get(attempt.exam_id);
  if (!exam) return res.status(404).json({ error: "Exam not found" });

  const answers = req.body && req.body.answers ? req.body.answers : {};
  // shape: { "<question_id>": "<display_letter>", ... }

  // Fetch all exam questions with correct answers
  const baseQs = db.prepare(`
    SELECT q.id, q.marks, q.correct_answer
    FROM exam_questions eq
    JOIN questions q ON q.id = eq.question_id
    WHERE eq.exam_id = ?
  `).all(exam.id);

  const optionMap = attempt.option_map_json ? JSON.parse(attempt.option_map_json) : {};

  let rawScore = 0, totalMarks = 0, correctCount = 0;

  // Clear any previous (in case of a resubmit race)
  db.prepare("DELETE FROM attempt_answers WHERE attempt_id=?").run(attemptId);

  const ins = db.prepare(`
    INSERT INTO attempt_answers (attempt_id, question_id, chosen, is_correct)
    VALUES (?,?,?,?)
  `);

  for (const q of baseQs) {
    totalMarks += q.marks;
    const chosenDisplay = answers[q.id] || answers[String(q.id)] || null;
    // translate displayed letter back to original letter
    const original = chosenDisplay && optionMap[q.id] ? optionMap[q.id][chosenDisplay] : chosenDisplay;
    const isCorrect = original && original === q.correct_answer ? 1 : 0;
    if (isCorrect) { rawScore += q.marks; correctCount++; }
    ins.run(attemptId, q.id, original || null, isCorrect);
  }

  const scaled = totalMarks ? Math.round((rawScore / totalMarks) * 30) : 0;

  db.prepare(`
    UPDATE attempts
    SET submitted_at = datetime('now'),
        raw_score = ?,
        total_marks = ?,
        scaled_score = ?
    WHERE id = ?
  `).run(rawScore, totalMarks, scaled, attemptId);

  // Return only a thank-you payload — never the score
  res.json({ ok: true, submitted_at: new Date().toISOString() });
});

/* ---------- GET /api/attempts/my-results ----------
   List published report cards for the logged-in student.
*/
router.get("/my-results", (req, res) => {
  const student = getStudentForUser(req.session.user.id);
  if (!student) return res.json({ reports: [] });
  const reports = db.prepare(`
    SELECT rc.id, rc.type, rc.session_id, rc.term, rc.published_at,
           ses.name AS session_name
    FROM report_cards rc
    LEFT JOIN academic_sessions ses ON ses.id = rc.session_id
    WHERE rc.student_id = ? AND rc.published = 1
    ORDER BY rc.session_id DESC, rc.term, rc.type
  `).all(student.id);
  res.json({ reports });
});

module.exports = router;