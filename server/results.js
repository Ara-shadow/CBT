"use strict";

const db = require("./db");

/* ---------- grading ---------- */

function gradeFor(total) {
  // Uses the admin-editable grading_scales table.
  // Falls back to a sensible default if the table is empty.
  const rows = db.prepare("SELECT * FROM grading_scales ORDER BY min_score DESC").all();
  if (!rows.length) {
    if (total >= 70) return { grade: "A", remark: "Excellent" };
    if (total >= 60) return { grade: "B", remark: "Very Good" };
    if (total >= 50) return { grade: "C", remark: "Good" };
    if (total >= 45) return { grade: "D", remark: "Fair" };
    if (total >= 40) return { grade: "E", remark: "Pass" };
    return { grade: "F", remark: "Fail" };
  }
  const n = Number(total) || 0;
  for (const r of rows) {
    if (n >= r.min_score && n <= r.max_score) {
      return { grade: r.grade, remark: r.remark || "" };
    }
  }
  return { grade: "-", remark: "" };
}

/* ---------- core: build one student's result for a term ---------- */

function buildStudentResult(student, session, term, type) {
  // type: "midterm" or "end_of_term"
  const scores = db.prepare(`
    SELECT sc.*, sub.name AS subject_name, sub.code AS subject_code
    FROM scores sc
    JOIN subjects sub ON sub.id = sc.subject_id
    WHERE sc.student_id = ? AND sc.session_id = ? AND sc.term = ?
    ORDER BY sub.name
  `).all(student.id, session.id, term);

  const subjects = scores.map(s => {
    const ca1     = Number(s.ca1)     || 0;
    const ca2     = Number(s.ca2)     || 0;
    const project = Number(s.project) || 0;
    const midterm = Math.round((ca1 + ca2 + project) * 100) / 100;
    const cbt     = Math.min(30, Math.max(0, Number(s.cbt_score) || 0));
    const pbt     = Math.min(30, Math.max(0, Number(s.pbt_score) || 0));
    const exam    = Math.round((cbt + pbt) * 100) / 100;
    const total   = Math.round((midterm + exam) * 100) / 100;

    const forGrade = type === "midterm" ? midterm : total;
    const g = gradeFor(forGrade);

    return {
      subject_id:    s.subject_id,
      subject_name:  s.subject_name,
      subject_code:  s.subject_code,
      ca1, ca2, project,
      midterm_total: midterm,
      cbt_score:     cbt,
      pbt_score:     pbt,
      exam_score:    exam,
      term_total:    total,
      grade:  g.grade,
      remark: g.remark
    };
  });

  // Attendance
  const att = db.prepare(`
    SELECT * FROM attendance_terms
    WHERE student_id = ? AND session_id = ? AND term = ?
  `).get(student.id, session.id, term) || {
    days_school_opened: 0,
    days_school_closed: 0,
    days_present: 0
  };
  const daysAbsent = Math.max(0, (att.days_school_opened || 0) - (att.days_present || 0));

  // Aggregate — percentage depends on type
  // midterm: sum(midterm_total) / (subjects * 40) * 100
  // end_of_term: sum(term_total) / (subjects * 100) * 100
  const subjectsCount = subjects.length || 1;
  const sumScores = subjects.reduce((a, s) => a + (type === "midterm" ? s.midterm_total : s.term_total), 0);
  const maxPossible = type === "midterm" ? 40 : 100;
  const percentage = subjects.length
    ? Math.round((sumScores / (subjectsCount * maxPossible)) * 1000) / 10
    : 0;

  const average = subjects.length
    ? Math.round((sumScores / subjectsCount) * 10) / 10
    : 0;

  return {
    student: {
      id: student.id,
      admission_no: student.admission_no,
      full_name: student.full_name,
      class_id: student.class_id,
      gender: student.gender
    },
    session: { id: session.id, name: session.name, term },
    type,
    subjects,
    summary: {
      subjects_count: subjectsCount,
      sum_scores: Math.round(sumScores * 10) / 10,
      average,
      percentage,
      max_possible: maxPossible
    },
    attendance: {
      days_school_opened: att.days_school_opened || 0,
      days_school_closed: att.days_school_closed || 0,
      days_present:       att.days_present || 0,
      days_absent:        daysAbsent
    }
  };
}

/* ---------- class averages / highest ---------- */

function computeClassStats(students, session, term, type) {
  if (!students.length) return { class_average: 0, class_highest: 0 };

  const percents = students.map(s => buildStudentResult(s, session, term, type).summary.percentage);
  const avg = percents.reduce((a, b) => a + b, 0) / percents.length;
  const high = Math.max(...percents);

  return {
    class_average: Math.round(avg * 10) / 10,
    class_highest: Math.round(high * 10) / 10
  };
}

/* ---------- class-wide result sheet ---------- */

function buildClassResults(class_id, session_id, term, type) {
  const session = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(session_id);
  if (!session) throw new Error("Session not found");
  const cls = db.prepare("SELECT * FROM classes WHERE id=?").get(class_id);
  if (!cls) throw new Error("Class not found");

  const students = db.prepare(`
    SELECT id, admission_no, full_name, class_id, gender
    FROM students
    WHERE class_id = ? AND status = 'active'
    ORDER BY full_name
  `).all(class_id);

  const studentResults = students.map(s => buildStudentResult(s, session, term, type));
  const stats = computeClassStats(students, session, term, type);

  return {
    class: { id: cls.id, name: cls.name, arm: cls.arm, level: cls.level },
    session: { id: session.id, name: session.name, term },
    type,
    class_average: stats.class_average,
    class_highest: stats.class_highest,
    students: studentResults
  };
}

module.exports = {
  gradeFor,
  buildStudentResult,
  buildClassResults,
  computeClassStats
};