"use strict";

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config();

const DB_PATH = path.resolve(process.cwd(), process.env.DB_PATH || "./data/cbt.db");

// Make sure the data folder exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Helpful pragmas
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','teacher','student','parent')),
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS school_settings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  school_name  TEXT NOT NULL DEFAULT 'Demo School',
  school_level TEXT NOT NULL DEFAULT 'secondary'
                CHECK (school_level IN ('primary','secondary','both')),
  head_title   TEXT,
  address      TEXT,
  logo_path    TEXT,
  report_link_days INTEGER NOT NULL DEFAULT 30,
  updated_by   INTEGER REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS academic_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  term       TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  is_current INTEGER NOT NULL DEFAULT 0,
  UNIQUE(name, term)
);

CREATE TABLE IF NOT EXISTS classes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  arm             TEXT,
  level           TEXT NOT NULL CHECK (level IN ('primary','secondary')),
  form_teacher_id INTEGER REFERENCES users(id),
  UNIQUE(name, arm)
);

CREATE TABLE IF NOT EXISTS subjects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE,
  class_level TEXT NOT NULL DEFAULT 'both'
               CHECK (class_level IN ('primary','secondary','both'))
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES users(id),
  UNIQUE(class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS students (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admission_no  TEXT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  gender        TEXT CHECK (gender IN ('M','F')),
  date_of_birth TEXT,
  guardian_name TEXT,
  guardian_phone TEXT,
  class_id      INTEGER REFERENCES classes(id),
  user_id       INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','graduated','withdrawn')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id     INTEGER REFERENCES subjects(id),
  class_level    TEXT CHECK (class_level IN ('primary','secondary','both')),
  question       TEXT NOT NULL,
  option_a       TEXT,
  option_b       TEXT,
  option_c       TEXT,
  option_d       TEXT,
  option_e       TEXT,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A','B','C','D','E')),
  marks          INTEGER NOT NULL DEFAULT 1,
  explanation    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exams (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT NOT NULL,
  subject_id         INTEGER REFERENCES subjects(id),
  class_id           INTEGER REFERENCES classes(id),
  session_id         INTEGER REFERENCES academic_sessions(id),
  term               TEXT CHECK (term IN ('First','Second','Third')),
  duration_minutes   INTEGER NOT NULL DEFAULT 30,
  pass_mark          INTEGER NOT NULL DEFAULT 50,
  shuffle_questions  INTEGER NOT NULL DEFAULT 0,
  shuffle_options    INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES users(id),
  is_published       INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id     INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id      INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  raw_score    REAL,
  total_marks  REAL,
  scaled_score REAL
);

CREATE TABLE IF NOT EXISTS attempt_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  chosen      TEXT,
  is_correct  INTEGER
);

CREATE TABLE IF NOT EXISTS scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id     INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id       INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_id     INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term           TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  ca1            REAL DEFAULT 0,
  ca2            REAL DEFAULT 0,
  project        REAL DEFAULT 0,
  cbt_score      REAL DEFAULT 0,
  pbt_score      REAL DEFAULT 0,
  entered_by     INTEGER REFERENCES users(id),
  overridden_by  INTEGER REFERENCES users(id),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, subject_id, session_id, term)
);

CREATE TABLE IF NOT EXISTS attendance_terms (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id           INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id           INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term                 TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  days_school_opened   INTEGER NOT NULL DEFAULT 0,
  days_school_closed   INTEGER NOT NULL DEFAULT 0,
  days_present         INTEGER NOT NULL DEFAULT 0,
  entered_by           INTEGER REFERENCES users(id),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, session_id, term)
);

CREATE TABLE IF NOT EXISTS attendance_daily (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term       TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('P','A')),
  marked_by  INTEGER REFERENCES users(id),
  marked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, session_id, term, date)
);

CREATE TABLE IF NOT EXISTS report_cards (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id      INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term            TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  type            TEXT NOT NULL CHECK (type IN ('midterm','end_of_term')),
  average         REAL,
  class_average   REAL,
  class_highest   REAL,
  percentage      REAL,
  teacher_comment TEXT,
  head_comment    TEXT,
  head_label_used TEXT,
  published       INTEGER NOT NULL DEFAULT 0,
  published_at    TEXT,
  published_by    INTEGER REFERENCES users(id),
  generated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, session_id, term, type)
);

CREATE TABLE IF NOT EXISTS grading_scales (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  min_score  REAL NOT NULL,
  max_score  REAL NOT NULL,
  grade      TEXT NOT NULL,
  remark     TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  phone      TEXT UNIQUE,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_students (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  UNIQUE(parent_id, student_id)
);

CREATE TABLE IF NOT EXISTS report_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT UNIQUE NOT NULL,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id      INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  term            TEXT NOT NULL CHECK (term IN ('First','Second','Third')),
  type            TEXT NOT NULL CHECK (type IN ('midterm','end_of_term')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT,
  revoked         INTEGER NOT NULL DEFAULT 0,
  view_count      INTEGER NOT NULL DEFAULT 0,
  last_viewed_at  TEXT
);
`);

/* ---------- migrations ---------- */
(() => {
  try {
    const cols = db.prepare("PRAGMA table_info(school_settings)").all().map(c => c.name);
    if (!cols.includes("report_link_days")) {
      db.exec("ALTER TABLE school_settings ADD COLUMN report_link_days INTEGER NOT NULL DEFAULT 30");
      console.log("Migration: added report_link_days to school_settings");
    }
  } catch (e) {
    console.warn("Migration warning:", e.message);
  }
})();

module.exports = db;