"use strict";

const db = require("./db");
const results = require("./results");

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function getCard(studentId, sessionId, term, type) {
  return db.prepare(`
    SELECT * FROM report_cards
    WHERE student_id=? AND session_id=? AND term=? AND type=?
  `).get(studentId, sessionId, term, type);
}

function renderReportForToken(token) {
  const t = db.prepare(`
    SELECT rt.*, s.full_name AS student_name, s.admission_no, s.class_id
    FROM report_tokens rt
    JOIN students s ON s.id = rt.student_id
    WHERE rt.token = ?
  `).get(token);

  if (!t) return { status: 404, html: "<p>This link is not valid.</p>" };
  if (t.revoked) return { status: 410, html: "<p>This link has been revoked by the school.</p>" };
  if (t.expires_at) {
    const exp = new Date(t.expires_at.replace(" ", "T") + "Z").getTime();
    if (Date.now() > exp) return { status: 410, html: "<p>This link has expired. Please contact the school for a new one.</p>" };
  }

  db.prepare("UPDATE report_tokens SET view_count = view_count + 1, last_viewed_at = datetime('now') WHERE id=?")
    .run(t.id);

  const student = db.prepare("SELECT id, admission_no, full_name, class_id, gender FROM students WHERE id=?")
    .get(t.student_id);
  const session = db.prepare("SELECT * FROM academic_sessions WHERE id=?").get(t.session_id);

  const data = results.buildStudentResult(student, session, t.term, t.type);
  const klass = results.buildClassResults(student.class_id, session.id, t.term, t.type);
  data.class_average = klass.class_average;
  data.class_highest = klass.class_highest;

  const settings = db.prepare("SELECT * FROM school_settings LIMIT 1").get() || {};
  const card = getCard(student.id, session.id, t.term, t.type);

  return { status: 200, html: renderHtml(data, settings, t.expires_at, card) };
}

function renderHtml(d, settings, expiresAt, card) {
  const rows = d.subjects.map(s => d.type === "midterm"
    ? `<tr><td>${escapeHtml(s.subject_name)}</td>
        <td>${s.ca1}</td><td>${s.ca2}</td><td>${s.project}</td>
        <td><strong>${s.midterm_total}</strong></td>
        <td>${escapeHtml(s.grade)}</td><td>${escapeHtml(s.remark)}</td></tr>`
    : `<tr><td>${escapeHtml(s.subject_name)}</td>
        <td>${s.midterm_total}</td><td>${s.cbt_score}</td><td>${s.pbt_score}</td>
        <td>${s.exam_score}</td><td><strong>${s.term_total}</strong></td>
        <td>${escapeHtml(s.grade)}</td><td>${escapeHtml(s.remark)}</td></tr>`
  ).join("");

  const header = d.type === "midterm"
    ? `<tr><th>Subject</th><th>CA1</th><th>CA2</th><th>Proj</th><th>Midterm /40</th><th>Grade</th><th>Remark</th></tr>`
    : `<tr><th>Subject</th><th>Midterm /40</th><th>CBT /30</th><th>PBT /30</th><th>Exam /60</th><th>Total /100</th><th>Grade</th><th>Remark</th></tr>`;

  const typeLabel = d.type === "midterm" ? "Midterm report" : "End-of-term report";
  const att = d.attendance;

  const settingsHead = card && card.head_label_used ? card.head_label_used
    : (settings.head_title && settings.head_title.trim()
        ? settings.head_title
        : (settings.school_level === "primary" ? "Head Teacher" : "Principal"));

  const teacherComment = card && card.teacher_comment ? card.teacher_comment : "";
  const headComment = card && card.head_comment ? card.head_comment : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(typeLabel)} — ${escapeHtml(d.student.full_name)}</title>
<link rel="stylesheet" href="/css/app.css">
<style>
  .report{max-width:880px;margin:24px auto;padding:28px 32px;background:var(--surface);border:1px solid var(--line);border-radius:12px}
  .head{text-align:center;border-bottom:2px solid var(--primary);padding-bottom:14px;margin-bottom:16px}
  .head h1{margin:0;font-size:1.6rem;color:var(--primary);letter-spacing:.02em}
  .head .meta{color:var(--muted);margin-top:4px}
  .head .title{font-weight:700;margin-top:8px;font-size:1rem}
  .idline{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px;font-size:.95rem}
  table.rep{width:100%;border-collapse:collapse;margin:8px 0 16px}
  table.rep th,table.rep td{border:1px solid var(--line);padding:6px 8px;font-size:.92rem}
  table.rep th{background:var(--bg)}
  .stats{display:flex;gap:26px;flex-wrap:wrap;margin:12px 0;font-size:.95rem}
  .stats strong{color:var(--ink)}
  .att{border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:12px 0;font-size:.92rem}
  .att h4{margin:0 0 6px;font-size:.9rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .comments{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
  .comment-box{border:1px solid var(--line);border-radius:8px;padding:12px;min-height:110px}
  .comment-box h4{margin:0 0 8px;font-size:.9rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .comment-box .body{white-space:pre-wrap;min-height:52px}
  .sig{margin-top:12px;border-top:1px solid var(--line);padding-top:8px;color:var(--muted);font-size:.85rem}
  .foot{color:var(--muted);font-size:.85rem;margin-top:20px;border-top:1px solid var(--line);padding-top:12px}
  @media print { .report{border:0;max-width:100%;padding:0} .noprint{display:none} }
  @media(max-width:700px){ .comments{grid-template-columns:1fr} }
</style></head>
<body>
<div class="report">
  <div class="head">
    <h1>${escapeHtml(settings.school_name || "School")}</h1>
    <div class="meta">${escapeHtml(settings.address || "")}</div>
    <div class="title">${escapeHtml(typeLabel)} — ${escapeHtml(d.session.name)} ${escapeHtml(d.session.term)} Term</div>
  </div>
  <div class="idline">
    <div><strong>Student:</strong> ${escapeHtml(d.student.full_name)}</div>
    <div><strong>Admission No:</strong> ${escapeHtml(d.student.admission_no)}</div>
    ${d.student.gender ? `<div><strong>Gender:</strong> ${escapeHtml(d.student.gender)}</div>` : ""}
  </div>
  <table class="rep">
    <thead>${header}</thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="stats">
    <div>Percentage: <strong>${d.summary.percentage}%</strong></div>
    <div>Class average: <strong>${d.class_average}%</strong></div>
    <div>Class highest: <strong>${d.class_highest}%</strong></div>
  </div>

  <div class="att">
    <h4>Attendance</h4>
    School opened: <strong>${att.days_school_opened}</strong> &nbsp;·&nbsp;
    School closed: <strong>${att.days_school_closed}</strong> &nbsp;·&nbsp;
    Present: <strong>${att.days_present}</strong> &nbsp;·&nbsp;
    Absent: <strong>${att.days_absent}</strong>
  </div>

  <div class="comments">
    <div class="comment-box">
      <h4>Teacher's comment</h4>
      <div class="body">${teacherComment ? escapeHtml(teacherComment) : `<em class="muted">Not yet entered.</em>`}</div>
      <div class="sig">Signature / Date: ____________________</div>
    </div>
    <div class="comment-box">
      <h4>${escapeHtml(settingsHead)}'s comment</h4>
      <div class="body">${headComment ? escapeHtml(headComment) : `<em class="muted">Not yet entered.</em>`}</div>
      <div class="sig">Signature / Date: ____________________</div>
    </div>
  </div>

  <div class="foot">
    ${expiresAt ? `This link is unique to this report and will expire on ${escapeHtml(expiresAt)}. ` : ""}
    If you did not request this report, or did not receive it from ${escapeHtml(settings.school_name || "the school")} directly, please contact the school.
  </div>
  <div class="noprint" style="margin-top:16px">
    <button class="btn primary" onclick="window.print()">Print</button>
  </div>
</div>
</body></html>`;
}

module.exports = { renderReportForToken };