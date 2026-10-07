"use strict";

const express = require("express");
const db = require("../db");
const { hashPassword } = require("../auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();

// every route here is admin-only
router.use(requireRole("admin"));

// GET /api/admin/users
router.get("/users", (req, res) => {
  const users = db.prepare(`
    SELECT id, username, full_name, role, is_active, created_at
    FROM users ORDER BY role, username
  `).all();
  res.json({ users });
});

// POST /api/admin/users/:id/activate
router.post("/users/:id/activate", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "User not found" });
  db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(id);
  res.json({ ok: true });
});

// POST /api/admin/users/:id/deactivate
router.post("/users/:id/deactivate", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) {
    return res.status(400).json({ error: "You cannot deactivate yourself" });
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "User not found" });
  db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(id);
  res.json({ ok: true });
});

// POST /api/admin/users  (create admin/teacher)
router.post("/users", (req, res) => {
  const { username, password, full_name, role, activate } = req.body || {};
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: "username, password, full_name and role are required" });
  }
  if (!["admin", "teacher"].includes(role)) {
    return res.status(400).json({ error: "role must be admin or teacher" });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "Username already taken" });

  // admins created by other admins require activation by default
  const isActive = activate === true ? 1 : (role === "admin" ? 0 : 1);

  const r = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
                        VALUES (?, ?, ?, ?, ?)`)
    .run(username, hashPassword(password), full_name, role, isActive);
  res.json({ ok: true, id: r.lastInsertRowid, is_active: isActive });
});

module.exports = router;