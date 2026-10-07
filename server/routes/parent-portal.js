"use strict";

const express = require("express");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("parent"));

function currentParent(userId) {
  return db.prepare("SELECT * FROM parents WHERE user_id=?").get(userId);
}

router.get("/me", (req, res) => {
  const p = currentParent(req.session.user.id);
  if (!p) return res.status(404).json({ error: "Parent record not found" });
  const children = db.prepare(`
    SELECT s.id, s.full_name, s.admission_no, s.class_id,
           c.name AS class_name, c.arm AS class_arm
    FROM parent_students ps
    JOIN students s ON s.id = ps.student_id
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE ps.parent_id = ?
    ORDER BY s.full_name
  `).all(p.id);
  res.json({ parent: p, children });
});

router.get("/reports", (req, res) => {
  const p = currentParent(req.session.user.id);
  if (!p) return res.status(404).json({ error: "Parent record not found" });
  const studentId = Number(req.query.student_id);
  const link = db.prepare("SELECT id FROM parent_students WHERE parent_id=? AND student_id=?")
                 .get(p.id, studentId);
  if (!link) return res.status(403).json({ error: "Not your child" });

  const reports = db.prepare(`
    SELECT rc.id, rc.type, rc.session_id, rc.term, rc.published_at,
           ses.name AS session_name
    FROM report_cards rc
    LEFT JOIN academic_sessions ses ON ses.id = rc.session_id
    WHERE rc.student_id = ? AND rc.published = 1
    ORDER BY rc.session_id DESC, rc.term, rc.type
  `).all(studentId);

  res.json({ reports });
});

module.exports = router;