"use strict";

const express = require("express");
const multer = require("multer");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("teacher", "admin"));

/* ---------------- list & filter ---------------- */

// GET /api/questions?subject_id=&class_level=&q=
router.get("/", (req, res) => {
  const { subject_id, class_level, q } = req.query;
  let sql = `
    SELECT q.*,
           s.name AS subject_name, s.code AS subject_code,
           u.full_name AS created_by_name
    FROM questions q
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN users    u ON u.id = q.created_by
    WHERE 1=1
  `;
  const params = [];
  if (subject_id)  { sql += " AND q.subject_id = ?";  params.push(Number(subject_id)); }
  if (class_level) { sql += " AND q.class_level = ?"; params.push(class_level); }
  if (q)           { sql += " AND q.question LIKE ?"; params.push(`%${q}%`); }
  sql += " ORDER BY q.created_at DESC, q.id DESC";
  const rows = db.prepare(sql).all(...params);
  res.json({ questions: rows });
});

/* ---------------- CSV import ---------------- */

// Simple in-memory file upload — for a school app this is fine
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.csv$/i.test(file.originalname) || /text\/csv/i.test(file.mimetype);
    cb(null, ok);
  }
});

// Parse CSV text -> array of row arrays (handles quoted fields, commas in quotes, CRLF)
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(x => x.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  row.push(field);
  if (row.some(x => x.trim() !== "")) rows.push(row);
  return rows;
}

function findSubject(str) {
  if (!str || !str.trim()) return null;
  const s = str.trim().toLowerCase();
  return db.prepare(`
    SELECT id, name, code FROM subjects
    WHERE LOWER(name) = ? OR LOWER(IFNULL(code,'')) = ?
    LIMIT 1
  `).get(s, s) || null;
}

// POST /api/questions/import  (multipart form-data, field name "file")
// IMPORTANT: this must come BEFORE the "/:id" routes.
router.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded (field name must be 'file')" });

  const text = req.file.buffer.toString("utf8");
  const rows = parseCSV(text);
  if (rows.length < 2) return res.status(400).json({ error: "CSV has no data rows" });

  const header = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const idx = {};
  ["question","option_a","option_b","option_c","option_d","option_e",
   "correct_answer","marks","subject","explanation"].forEach(name => {
    idx[name] = header.indexOf(name);
  });

  if (idx.question < 0 || idx.correct_answer < 0) {
    return res.status(400).json({
      error: "CSV header must include at least 'question' and 'correct_answer' columns"
    });
  }

  const errors = [];
  const valid = [];
  const classLevel = ["primary","secondary","both"].includes(req.body.class_level)
    ? req.body.class_level : "secondary";
  const fallbackSubjectId = req.body.subject_id ? Number(req.body.subject_id) : null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (key) => idx[key] >= 0 && row[idx[key]] != null ? row[idx[key]].trim() : "";
    const lineNo = r + 1;

    const question = get("question");
    if (!question) { errors.push(`Line ${lineNo}: question is empty`); continue; }

    const opts = {
      A: get("option_a"), B: get("option_b"), C: get("option_c"),
      D: get("option_d"), E: get("option_e")
    };
    const filled = Object.entries(opts).filter(([,v]) => v && v.trim()).map(([k]) => k);
    if (filled.length < 2) { errors.push(`Line ${lineNo}: at least 2 options are required`); continue; }

    const letter = String(get("correct_answer")).toUpperCase().replace(/[^A-E]/g, "").charAt(0);
    if (!letter || !opts[letter] || !opts[letter].trim()) {
      errors.push(`Line ${lineNo}: correct_answer must point to a filled option (A–E)`);
      continue;
    }

    const marks = get("marks") === "" ? 1 : Number(get("marks"));
    if (isNaN(marks) || marks <= 0) { errors.push(`Line ${lineNo}: marks must be a positive number`); continue; }

    let subjectId = fallbackSubjectId;
    const subjStr = get("subject");
    if (subjStr) {
      const found = findSubject(subjStr);
      if (found) subjectId = found.id;
      else if (!fallbackSubjectId) {
        errors.push(`Line ${lineNo}: subject "${subjStr}" not found (create it first, or provide a fallback)`);
        continue;
      }
    }

    valid.push({
      subject_id: subjectId,
      class_level: classLevel,
      question,
      option_a: opts.A || null,
      option_b: opts.B || null,
      option_c: opts.C || null,
      option_d: opts.D || null,
      option_e: opts.E || null,
      correct_answer: letter,
      marks,
      explanation: get("explanation") || null
    });
  }

  if (!valid.length) {
    return res.status(400).json({ error: "No valid rows", errors });
  }

  const uid = req.session.user.id;
  let inserted = 0;
  try {
    db.exec("BEGIN");
    const ins = db.prepare(`
      INSERT INTO questions
        (subject_id, class_level, question, option_a, option_b, option_c, option_d, option_e,
         correct_answer, marks, explanation, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const q of valid) {
      ins.run(
        q.subject_id, q.class_level, q.question,
        q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
        q.correct_answer, q.marks, q.explanation, uid
      );
      inserted++;
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    return res.status(500).json({ error: e.message });
  }

  res.json({ ok: true, inserted, skipped: errors.length, errors });
});

/* ---------------- get by id ---------------- */

// GET /api/questions/:id
router.get("/:id", (req, res) => {
  const row = db.prepare(`
    SELECT q.*, s.name AS subject_name, u.full_name AS created_by_name
    FROM questions q
    LEFT JOIN subjects s ON s.id = q.subject_id
    LEFT JOIN users    u ON u.id = q.created_by
    WHERE q.id = ?
  `).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "Question not found" });
  res.json({ question: row });
});

/* ---------------- validation ---------------- */

function validatePayload(body) {
  const { question, option_a, option_b, option_c, option_d, option_e, correct_answer } = body;

  if (!question || !question.trim()) return "Question text is required";

  const opts = { A: option_a, B: option_b, C: option_c, D: option_d, E: option_e };
  const filled = Object.entries(opts).filter(([, v]) => v && String(v).trim() !== "").map(([k]) => k);
  if (filled.length < 2) return "At least two options are required";

  const letter = String(correct_answer || "").toUpperCase().replace(/[^A-E]/g, "").charAt(0);
  if (!letter || !opts[letter] || !String(opts[letter]).trim()) {
    return "Correct answer must point to one of the filled options (A–E)";
  }

  const marks = body.marks == null || body.marks === "" ? 1 : Number(body.marks);
  if (isNaN(marks) || marks <= 0) return "Marks must be a positive number";

  return null;
}

/* ---------------- create ---------------- */

// POST /api/questions
router.post("/", (req, res) => {
  const err = validatePayload(req.body || {});
  if (err) return res.status(400).json({ error: err });

  const {
    subject_id, class_level, question, option_a, option_b, option_c, option_d, option_e,
    correct_answer, marks, explanation
  } = req.body;

  const level = ["primary", "secondary", "both"].includes(class_level) ? class_level : "secondary";
  const letter = String(correct_answer).toUpperCase().replace(/[^A-E]/g, "").charAt(0);

  const r = db.prepare(`
    INSERT INTO questions
      (subject_id, class_level, question, option_a, option_b, option_c, option_d, option_e,
       correct_answer, marks, explanation, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    subject_id || null, level, question.trim(),
    option_a || null, option_b || null, option_c || null, option_d || null, option_e || null,
    letter,
    marks == null || marks === "" ? 1 : Number(marks),
    explanation || null,
    req.session.user.id
  );
  res.json({ ok: true, id: r.lastInsertRowid });
});

/* ---------------- edit (owner or admin) ---------------- */

// PUT /api/questions/:id
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM questions WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Question not found" });

  const isAdmin = req.session.user.role === "admin";
  const isOwner = existing.created_by === req.session.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: "You can only edit questions you created" });
  }

  const err = validatePayload(req.body || {});
  if (err) return res.status(400).json({ error: err });

  const {
    subject_id, class_level, question, option_a, option_b, option_c, option_d, option_e,
    correct_answer, marks, explanation
  } = req.body;

  const level = ["primary", "secondary", "both"].includes(class_level) ? class_level : existing.class_level;
  const letter = String(correct_answer).toUpperCase().replace(/[^A-E]/g, "").charAt(0);

  db.prepare(`
    UPDATE questions SET
      subject_id=?, class_level=?, question=?,
      option_a=?, option_b=?, option_c=?, option_d=?, option_e=?,
      correct_answer=?, marks=?, explanation=?
    WHERE id=?
  `).run(
    subject_id || null, level, question.trim(),
    option_a || null, option_b || null, option_c || null, option_d || null, option_e || null,
    letter,
    marks == null || marks === "" ? 1 : Number(marks),
    explanation || null,
    id
  );
  res.json({ ok: true });
});

/* ---------------- delete (owner or admin) ---------------- */

// DELETE /api/questions/:id
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM questions WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Question not found" });

  const isAdmin = req.session.user.role === "admin";
  const isOwner = existing.created_by === req.session.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: "You can only delete questions you created" });
  }

  const usedInExam = db.prepare("SELECT COUNT(*) c FROM exam_questions WHERE question_id=?").get(id).c;
  if (usedInExam) {
    return res.status(409).json({
      error: `Cannot delete: this question is used in ${usedInExam} exam(s). Remove it from those exams first.`
    });
  }

  db.prepare("DELETE FROM questions WHERE id=?").run(id);
  res.json({ ok: true });
});

module.exports = router;