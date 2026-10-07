"use strict";

const express = require("express");
// ensure the report_link_days column exists on school_settings
(() => {
  try {
    const cols = db.prepare("PRAGMA table_info(school_settings)").all().map(c => c.name);
    if (!cols.includes("report_link_days")) {
      db.exec("ALTER TABLE school_settings ADD COLUMN report_link_days INTEGER NOT NULL DEFAULT 30");
    }
  } catch (e) { /* ignore */ }
})();
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

/* ---------------- SCHOOL SETTINGS ---------------- */

// GET /api/admin/settings
router.get("/settings", (req, res) => {
  const row = db.prepare("SELECT * FROM school_settings LIMIT 1").get();
  res.json({ settings: row || {} });
});

// PUT /api/admin/settings
router.put("/settings", (req, res) => {
  const { school_name, school_level, head_title, address, report_link_days } = req.body || {};
  if (!school_name) return res.status(400).json({ error: "school_name is required" });
  if (!["primary", "secondary", "both"].includes(school_level)) {
    return res.status(400).json({ error: "school_level must be primary, secondary or both" });
  }

  const existing = db.prepare("SELECT id FROM school_settings LIMIT 1").get();
  // auto-derive head_title if admin leaves it blank, based on level
  const derived = school_level === "primary" ? "Head Teacher" : "Principal";
  const head = (head_title && head_title.trim()) || derived;

  if (existing) {
    db.prepare(`UPDATE school_settings
                SET school_name=?, school_level=?, head_title=?, address=?,
                    updated_by=?, updated_at=datetime('now')
                WHERE id=?`)
      .run(school_name, school_level, head, address || null, req.session.user.id, existing.id);
  } else {
    db.prepare(`INSERT INTO school_settings
                (school_name, school_level, head_title, address, updated_by)
                VALUES (?,?,?,?,?)`)
      .run(school_name, school_level, head, address || null, req.session.user.id);
  }

  const row = db.prepare("SELECT * FROM school_settings LIMIT 1").get();
  res.json({ ok: true, settings: row });
});

/* ---------------- GRADING SCALE ---------------- */

// Validation: bands must not overlap. Gaps are allowed but flagged.
function validateNoOverlap(rows, ignoreId = null) {
  const sorted = rows
    .filter(r => r.id !== ignoreId)
    .sort((a, b) => a.min_score - b.min_score);

  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].min_score > sorted[i].max_score) {
      return `Invalid band: min (${sorted[i].min_score}) > max (${sorted[i].max_score})`;
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.min_score <= prev.max_score) {
        return `Overlap: ${prev.grade} (${prev.min_score}–${prev.max_score}) and ` +
               `${cur.grade} (${cur.min_score}–${cur.max_score})`;
      }
    }
  }
  return null;
}

// GET /api/admin/grading
router.get("/grading", (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM grading_scales
    ORDER BY min_score DESC
  `).all();
  res.json({ grades: rows });
});

// POST /api/admin/grading
router.post("/grading", (req, res) => {
  const { min_score, max_score, grade, remark } = req.body || {};
  if (min_score == null || max_score == null || !grade) {
    return res.status(400).json({ error: "min_score, max_score and grade are required" });
  }
  const min = Number(min_score), max = Number(max_score);
  if (isNaN(min) || isNaN(max) || min < 0 || max > 100 || min > max) {
    return res.status(400).json({ error: "Scores must be 0–100 and min ≤ max" });
  }

  const all = db.prepare("SELECT * FROM grading_scales").all();
  const candidate = [...all, { min_score: min, max_score: max, grade }];
  const err = validateNoOverlap(candidate);
  if (err) return res.status(400).json({ error: err });

  const r = db.prepare(`INSERT INTO grading_scales
      (min_score, max_score, grade, remark, is_active, updated_by)
      VALUES (?,?,?,?,1,?)`)
    .run(min, max, grade, remark || null, req.session.user.id);
  res.json({ ok: true, id: r.lastInsertRowid });
});

// PUT /api/admin/grading/:id
router.put("/grading/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM grading_scales WHERE id=?").get(id);
  if (!existing) return res.status(404).json({ error: "Grade band not found" });

  const { min_score, max_score, grade, remark } = req.body || {};
  const min = Number(min_score ?? existing.min_score);
  const max = Number(max_score ?? existing.max_score);
  if (isNaN(min) || isNaN(max) || min < 0 || max > 100 || min > max) {
    return res.status(400).json({ error: "Scores must be 0–100 and min ≤ max" });
  }

  const all = db.prepare("SELECT * FROM grading_scales").all();
  const candidate = [...all, { min_score: min, max_score: max, grade: grade ?? existing.grade }];
  const err = validateNoOverlap(candidate, id);
  if (err) return res.status(400).json({ error: err });

  db.prepare(`UPDATE grading_scales
              SET min_score=?, max_score=?, grade=?, remark=?,
                  updated_by=?, updated_at=datetime('now')
              WHERE id=?`)
    .run(min, max, grade ?? existing.grade, remark ?? existing.remark,
         req.session.user.id, id);
  res.json({ ok: true });
});

// DELETE /api/admin/grading/:id
router.delete("/grading/:id", (req, res) => {
  db.prepare("DELETE FROM grading_scales WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;