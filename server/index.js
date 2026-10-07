"use strict";

const express = require("express");
const session = require("express-session");
const path = require("node:path");
require("dotenv").config();

const db = require("./db");
const reportHtml = require("./report-html");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4000;

// ---------- middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

// ---------- static files ----------
app.use(express.static(path.join(process.cwd(), "public")));

// ---------- api routes ----------
app.use("/api", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/academic", require("./routes/academic"));
app.use("/api/admin/students", require("./routes/students"));
app.use("/api/admin", require("./routes/settings"));
app.use("/api/questions", require("./routes/questions"));
app.use("/api/exams", require("./routes/exams"));
app.use("/api/attempts", require("./routes/attempts"));
app.use("/api/scores", require("./routes/scores"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/register", require("./routes/register"));
app.use("/api/broadsheet", require("./routes/broadsheet"));
app.use("/api/results", require("./routes/results"));
app.use("/api/results", require("./routes/publish"));
app.use("/api/admin/settings", require("./routes/settings"));
app.use("/api/admin/parents", require("./routes/parents"));
app.use("/api/admin/report-links", require("./routes/report-links"));
app.use("/api/admin", require("./routes/backup"));
app.use("/api/parent", require("./routes/parent-portal"));

// ---------- public read (no login needed) ----------
app.get("/api/public/settings", (req, res) => {
  const s = db.prepare("SELECT school_name, address, school_level FROM school_settings LIMIT 1").get();
  res.json({ settings: s || {} });
});

// ---------- shared read endpoints (any logged-in user) ----------
app.get("/api/subjects", (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  const subjects = db.prepare("SELECT * FROM subjects ORDER BY class_level, name").all();
  res.json({ subjects });
});

app.get("/api/teacher/classes", (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: "Not logged in" });
  const classes = db.prepare("SELECT id, name, arm, level FROM classes ORDER BY level, name, arm").all();
  res.json({ classes });
});

app.get("/api/teacher/sessions", (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: "Not logged in" });
  const sessions = db.prepare("SELECT id, name, term, is_current FROM academic_sessions ORDER BY is_current DESC, name DESC, term").all();
  res.json({ sessions });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/status", (req, res) => {
  const settings = db.prepare("SELECT * FROM school_settings LIMIT 1").get();
  const counts = {
    users:     db.prepare("SELECT COUNT(*) c FROM users").get().c,
    students:  db.prepare("SELECT COUNT(*) c FROM students").get().c,
    classes:   db.prepare("SELECT COUNT(*) c FROM classes").get().c,
    subjects:  db.prepare("SELECT COUNT(*) c FROM subjects").get().c,
    questions: db.prepare("SELECT COUNT(*) c FROM questions").get().c,
  };
  const currentSession = db.prepare("SELECT * FROM academic_sessions WHERE is_current=1 LIMIT 1").get();
  res.json({ settings, counts, currentSession });
});

// ---------- report card pages (token or login) ----------
app.get("/report", (req, res) => {
  const token = req.query.t;
  if (!token) return res.status(400).send("Missing token");
  const out = reportHtml.renderReportForToken(token);
  res.status(out.status).type("html").send(out.html);
});

app.get("/report.html", (req, res) => {
  const token = req.query.t;
  if (!token) return res.status(400).send("Missing token");
  const out = reportHtml.renderReportForToken(token);
  res.status(out.status).type("html").send(out.html);
});

// ---------- root redirects to login ----------
app.get("/", (req, res) => res.redirect("/login.html"));

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`CBT school system running at http://localhost:${PORT}`);
  console.log(`Login page: http://localhost:${PORT}/login.html`);
});