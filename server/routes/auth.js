"use strict";

const express = require("express");
const db = require("../db");
const { verifyPassword } = require("../auth");
const { requireLogin } = require("../middleware/requireRole");

const router = express.Router();

// POST /api/login
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: "Account is inactive. Ask an admin to activate it." });
  }
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role
  };

  // role-based redirect target
const redirect = { admin: "/admin/dashboard.html",
                   teacher: "/teacher/dashboard.html",
                   student: "/student/dashboard.html",
                   parent: "/parent/dashboard.html" }[user.role] || "/";
                   
  res.json({ ok: true, user: req.session.user, redirect });
});

// POST /api/logout
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// GET /api/me
router.get("/me", requireLogin, (req, res) => {
  res.json({ user: req.session.user });
});

module.exports = router;