"use strict";

const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

function suggestParentUsername(phone, fullName) {
  if (phone) {
    const clean = String(phone).replace(/[^0-9]/g, "");
    if (clean) return "p" + clean;
  }
  const base = String(fullName || "parent").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "parent";
  let candidate = base, n = 1;
  while (db.prepare("SELECT id FROM users WHERE username=?").get(candidate)) {
    candidate = base + n++;
  }
  return candidate;
}

router.get("/", (req, res) => {
  const parents = db.prepare(`
    SELECT p.*, u.username, u.is_active
    FROM parents p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.full_name
  `).all();

  const links = db.prepare(`
    SELECT ps.parent_id, ps.student_id,
           s.full_name AS student_name, s.admission_no,
           c.name AS class_name, c.arm AS class_arm
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    LEFT JOIN classes c ON c.id = s.class_id
  `).all();

  const byParent = new Map();
  for (const l of links) {
    if (!byParent.has(l.parent_id)) byParent.set(l.parent_id, []);
    byParent.get(l.parent_id).push(l);
  }

  const out = parents.map(p => ({ ...p, children: byParent.get(p.id) || [] }));
  res.json({ parents: out });
});

router.get("/suggest-username", (req, res) => {
  const { phone, name } = req.query;
  res.json({ username: suggestParentUsername(phone, name) });
});

router.post("/", (req, res) => {
  const { full_name, phone, email, username, password, student_ids } = req.body || {};
  if (!full_name) return res.status(400).json({ error: "full_name is required" });

  const uname = (username || suggestParentUsername(phone, full_name)).trim();
  if (db.prepare("SELECT id FROM users WHERE username=?").get(uname)) {
    return res.status(409).json({ error: `Username "${uname}" is already taken` });
  }
  const pass = password && password.length >= 4 ? password : "parent123";

  try {
    db.exec("BEGIN");
    const userId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
                               VALUES (?,?,?,?,1)`)
      .run(uname, hashPassword(pass), full_name, "parent").lastInsertRowid;
    const parentId = db.prepare(`INSERT INTO parents (user_id, full_name, phone, email)
                                 VALUES (?,?,?,?)`)
      .run(userId, full_name, phone || null, email || null).lastInsertRowid;

    if (Array.isArray(student_ids)) {
      const ins = db.prepare("INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?,?)");
      for (const sid of student_ids) ins.run(parentId, Number(sid));
    }
    db.exec("COMMIT");
    res.json({ ok: true, id: parentId, username: uname, password: pass });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare("SELECT * FROM parents WHERE id=?").get(id);
  if (!p) return res.status(404).json({ error: "Parent not found" });

  const { full_name, phone, email, student_ids } = req.body || {};

  try {
    db.exec("BEGIN");
    db.prepare("UPDATE parents SET full_name=?, phone=?, email=? WHERE id=?")
      .run(full_name ?? p.full_name, phone ?? p.phone, email ?? p.email, id);
    if (p.user_id && full_name) {
      db.prepare("UPDATE users SET full_name=? WHERE id=?").run(full_name, p.user_id);
    }
    if (Array.isArray(student_ids)) {
      db.prepare("DELETE FROM parent_students WHERE parent_id=?").run(id);
      const ins = db.prepare("INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?,?)");
      for (const sid of student_ids) ins.run(id, Number(sid));
    }
    db.exec("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare("SELECT * FROM parents WHERE id=?").get(id);
  if (!p) return res.status(404).json({ error: "Parent not found" });
  try {
    db.exec("BEGIN");
    db.prepare("DELETE FROM parents WHERE id=?").run(id);
    if (p.user_id) db.prepare("DELETE FROM users WHERE id=?").run(p.user_id);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

router.post("/:id/reset-password", (req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare("SELECT * FROM parents WHERE id=?").get(id);
  if (!p || !p.user_id) return res.status(404).json({ error: "Parent or linked user not found" });
  const { password } = req.body || {};
  const pass = password && password.length >= 4 ? password : "parent123";
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(pass), p.user_id);
  res.json({ ok: true, password: pass });
});

module.exports = router;