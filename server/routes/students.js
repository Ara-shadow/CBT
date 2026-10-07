"use strict";

const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

// ---------- helpers ----------
function suggestUsername(fullName) {
  const first = String(fullName || "").trim().split(/\s+/)[0] || "student";
  const base = first.toLowerCase().replace(/[^a-z0-9]/g, "");
  let candidate = base || "student";
  let n = 1;
  while (db.prepare("SELECT id FROM users WHERE username=?").get(candidate)) {
    candidate = base + n++;
  }
  return candidate;
}

// ---------- GET /api/admin/students ----------
router.get("/", (req, res) => {
  const { class_id, status, q } = req.query;
  let sql = `
    SELECT s.*, c.name AS class_name, c.arm AS class_arm, c.level AS class_level,
           u.username AS login_username, u.is_active AS login_active
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN users   u ON u.id = s.user_id
    WHERE 1=1
  `;
  const params = [];
  if (class_id) { sql += " AND s.class_id = ?"; params.push(Number(class_id)); }
  if (status)   { sql += " AND s.status = ?";   params.push(status); }
  if (q) {
    sql += " AND (s.full_name LIKE ? OR s.admission_no LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY c.name, c.arm, s.full_name";
  const students = db.prepare(sql).all(...params);
  res.json({ students });
});

// ---------- GET /api/admin/students/suggest-username?name=... ----------
router.get("/suggest-username", (req, res) => {
  const name = req.query.name || "";
  res.json({ username: suggestUsername(name) });
});

// ---------- POST /api/admin/students ----------
router.post("/", (req, res) => {
  const {
    admission_no, full_name, gender, date_of_birth,
    guardian_name, guardian_phone, guardian_email, guardian_address,
    class_id, username, password
  } = req.body || {};

  if (!admission_no || !full_name) {
    return res.status(400).json({ error: "admission_no and full_name are required" });
  }
  if (db.prepare("SELECT id FROM students WHERE admission_no=?").get(admission_no)) {
    return res.status(409).json({ error: "That admission number is already used" });
  }

  const loginUser = (username || suggestUsername(full_name)).trim();
  if (db.prepare("SELECT id FROM users WHERE username=?").get(loginUser)) {
    return res.status(409).json({ error: `Username "${loginUser}" is already taken` });
  }
  const pass = password && password.length >= 4 ? password : "student123";

  // create user + student in a transaction
  let studentId;
  let userId;
  try {
    db.exec("BEGIN");
    userId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
                         VALUES (?,?,?,?,1)`)
      .run(loginUser, hashPassword(pass), full_name, "student").lastInsertRowid;

    studentId = db.prepare(`
      INSERT INTO students
        (admission_no, full_name, gender, date_of_birth,
         guardian_name, guardian_phone, class_id, user_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      admission_no, full_name, gender || null, date_of_birth || null,
      guardian_name || null, guardian_phone || null,
      class_id || null, userId
    ).lastInsertRowid;

    // store extra fields we added to the schema
    if (guardian_email || guardian_address) {
      // add columns if they don't exist (idempotent)
      const cols = db.prepare("PRAGMA table_info(students)").all().map(c => c.name);
      if (!cols.includes("guardian_email"))   db.exec("ALTER TABLE students ADD COLUMN guardian_email TEXT");
      if (!cols.includes("guardian_address")) db.exec("ALTER TABLE students ADD COLUMN guardian_address TEXT");
      db.prepare("UPDATE students SET guardian_email=?, guardian_address=? WHERE id=?")
        .run(guardian_email || null, guardian_address || null, studentId);
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    return res.status(500).json({ error: e.message });
  }

  res.json({ ok: true, id: studentId, username: loginUser, password: pass });
});

// ---------- PUT /api/admin/students/:id ----------
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(id);
  if (!s) return res.status(404).json({ error: "Student not found" });

  const {
    admission_no, full_name, gender, date_of_birth,
    guardian_name, guardian_phone, guardian_email, guardian_address,
    class_id, status
  } = req.body || {};

  const cols = db.prepare("PRAGMA table_info(students)").all().map(c => c.name);
  const hasEmail   = cols.includes("guardian_email");
  const hasAddress = cols.includes("guardian_address");

  const sql = `
    UPDATE students SET
      admission_no=?, full_name=?, gender=?, date_of_birth=?,
      guardian_name=?, guardian_phone=?, class_id=?, status=?
      ${hasEmail   ? ", guardian_email=?"   : ""}
      ${hasAddress ? ", guardian_address=?" : ""}
    WHERE id=?
  `;
  const params = [
    admission_no ?? s.admission_no,
    full_name ?? s.full_name,
    gender ?? s.gender,
    date_of_birth ?? s.date_of_birth,
    guardian_name ?? s.guardian_name,
    guardian_phone ?? s.guardian_phone,
    class_id ?? s.class_id,
    status ?? s.status,
  ];
  if (hasEmail)   params.push(guardian_email ?? s.guardian_email);
  if (hasAddress) params.push(guardian_address ?? s.guardian_address);
  params.push(id);

  try {
    db.prepare(sql).run(...params);
    // keep the linked user's full name in sync
    if (s.user_id) {
      db.prepare("UPDATE users SET full_name=? WHERE id=?").run(full_name ?? s.full_name, s.user_id);
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

// ---------- DELETE /api/admin/students/:id ----------
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(id);
  if (!s) return res.status(404).json({ error: "Student not found" });
  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM students WHERE id=?").run(id);
    if (s.user_id) db.prepare("DELETE FROM users WHERE id=?").run(s.user_id);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

// ---------- POST /api/admin/students/:id/reset-password ----------
router.post("/:id/reset-password", (req, res) => {
  const id = Number(req.params.id);
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(id);
  if (!s || !s.user_id) return res.status(404).json({ error: "Student or linked user not found" });
  const { password } = req.body || {};
  const pass = password && password.length >= 4 ? password : "student123";
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(pass), s.user_id);
  res.json({ ok: true, password: pass });
});

module.exports = router;