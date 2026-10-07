"use strict";

/* ============================================================
   Sidebar layout injection with backwards compatibility.
   Pages still call:
     document.getElementById("main").insertBefore(
       renderAdminNav("/admin/dashboard.html"),
       document.getElementById("main").firstChild
     );
   The renderXNav functions now return a harmless comment node
   synchronously, so insertBefore() does not throw. The real
   sidebar layout is injected asynchronously in the background.
   ============================================================ */

const NAV_GROUPS = {
  admin: [
    { label: "Setup", items: [
      { href: "/admin/dashboard.html",      label: "Users" },
      { href: "/admin/sessions.html",       label: "Sessions" },
      { href: "/admin/classes.html",        label: "Classes" },
      { href: "/admin/subjects.html",       label: "Subjects" },
      { href: "/admin/class-subjects.html", label: "Assignments" },
    ]},
    { label: "People", items: [
      { href: "/admin/students.html",       label: "Students" },
      { href: "/admin/parents.html",        label: "Parents" },
    ]},
    { label: "Assessment", items: [
      { href: "/teacher/questions.html",    label: "Question bank" },
      { href: "/admin/exams.html",          label: "Exams" },
      { href: "/teacher/scores.html",       label: "Scores" },
      { href: "/teacher/daily.html",        label: "Daily attendance" },
      { href: "/teacher/attendance.html",   label: "Attendance summary" },
    ]},
    { label: "Reports", items: [
      { href: "/admin/results.html",        label: "Results" },
      { href: "/teacher/broadsheet.html",   label: "Broadsheet" },
      { href: "/teacher/register.html",     label: "Register" },
      { href: "/teacher/roster.html",       label: "Roster" },
      { href: "/admin/publish.html",        label: "Publish" },
      { href: "/admin/report-links.html",   label: "Report links" },
    ]},
    { label: "School", items: [
      { href: "/admin/grading.html",        label: "Grading scale" },
      { href: "/admin/settings.html",       label: "Settings" },
    ]},
  ],
  teacher: [
    { label: "Teaching", items: [
      { href: "/teacher/dashboard.html",    label: "Home" },
      { href: "/teacher/questions.html",    label: "Question bank" },
      { href: "/teacher/exams.html",        label: "Exams" },
    ]},
    { label: "Assessment", items: [
      { href: "/teacher/scores.html",       label: "Scores" },
      { href: "/teacher/daily.html",        label: "Daily attendance" },
      { href: "/teacher/attendance.html",   label: "Attendance summary" },
    ]},
    { label: "My class", items: [
      { href: "/teacher/register.html",     label: "Register" },
      { href: "/teacher/roster.html",       label: "Roster" },
      { href: "/teacher/broadsheet.html",   label: "Broadsheet" },
      { href: "/teacher/results.html",      label: "Results" },
    ]},
  ],
  student: [
    { label: "My work", items: [
      { href: "/student/dashboard.html",    label: "My exams" },
    ]},
  ],
  parent: [
    { label: "My children", items: [
      { href: "/parent/dashboard.html",     label: "Overview" },
    ]},
  ],
};

let _userCache = null;
async function _currentUser() {
  if (_userCache) return _userCache;
  try {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    if (!r.ok) return null;
    const data = await r.json();
    _userCache = data.user || null;
    return _userCache;
  } catch { return null; }
}

async function _loadSchoolName() {
  try {
    const r = await fetch("/api/public/settings", { credentials: "same-origin" });
    if (!r.ok) return "School";
    const data = await r.json();
    return (data.settings && data.settings.school_name) || "School";
  } catch { return "School"; }
}

function _buildSidebarHTML(role, active, schoolName) {
  const groups = NAV_GROUPS[role] || [];
  const initial = (schoolName || "S").charAt(0).toUpperCase();

  let groupsHtml = "";
  for (const g of groups) {
    groupsHtml += `<div class="sb-group"><div class="sb-group-label">${g.label}</div>`;
    for (const item of g.items) {
      const isActive = item.href === active;
      groupsHtml += `<a class="sb-link${isActive ? " active" : ""}" href="${item.href}">${item.label}</a>`;
    }
    groupsHtml += `</div>`;
  }

  return `
    <div class="sb-brand">
      <div class="dot">${initial}</div>
      <div class="txt">
        <strong>${schoolName}</strong>
        <span>School portal</span>
      </div>
    </div>
    ${groupsHtml}
    <div class="sb-foot">© ${new Date().getFullYear()} ${schoolName}</div>
  `;
}

let _injected = false;
async function _injectLayout(role, active) {
  if (_injected) return;
  _injected = true;

  const schoolName = await _loadSchoolName();

  const mainEl = document.querySelector("main");
  const headerEl = document.querySelector("header.top");
  if (!mainEl) return;

  const app = document.createElement("div");
  app.className = "app";

  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  sidebar.id = "sidebar";
  sidebar.innerHTML = _buildSidebarHTML(role, active, schoolName);

  const backdrop = document.createElement("div");
  backdrop.className = "sb-backdrop";
  backdrop.onclick = () => app.classList.remove("sidebar-open");

  const mainCol = document.createElement("div");
  mainCol.className = "app-main";

  const parent = mainEl.parentNode;

  if (headerEl && headerEl.parentNode === parent) {
    if (!headerEl.querySelector(".sb-toggle")) {
      const tgl = document.createElement("button");
      tgl.type = "button";
      tgl.className = "sb-toggle";
      tgl.setAttribute("aria-label", "Toggle menu");
      tgl.innerHTML = "☰";
      tgl.onclick = () => app.classList.toggle("sidebar-open");
      const wrap = headerEl.querySelector(".wrap") || headerEl;
      wrap.insertBefore(tgl, wrap.firstChild);
    }
    mainCol.appendChild(headerEl);
  }

  mainCol.appendChild(mainEl);
  app.appendChild(sidebar);
  app.appendChild(mainCol);
  app.appendChild(backdrop);

  parent.insertBefore(app, parent.firstChild);

  // Close the sidebar on mobile when a link is tapped
  sidebar.querySelectorAll(".sb-link").forEach(a => {
    a.addEventListener("click", () => app.classList.remove("sidebar-open"));
  });
}

/* ---------- public API — must return synchronously for old callers ---------- */

function _placeholder() {
  // Returns a harmless comment node so old `insertBefore` calls don't throw.
  return document.createComment("sidebar-anchor");
}

function renderAdminNav(active)   { _injectLayout("admin",   active); return _placeholder(); }
function renderTeacherNav(active) { _injectLayout("teacher", active); return _placeholder(); }
function renderStudentNav(active) { _injectLayout("student", active); return _placeholder(); }
function renderParentNav(active)  { _injectLayout("parent",  active); return _placeholder(); }

/* ---------- user header (unchanged API) ---------- */
async function loadUserHeader(sel, allowedRoles = ["admin"]) {
  const $ = (s) => document.querySelector(s);
  try {
    const user = await _currentUser();
    if (!user || !allowedRoles.includes(user.role)) { window.location.href = "/login.html"; return null; }
    const nameEl = $(sel + " #userName");
    const roleEl = $(sel + " #userRole");
    if (nameEl) nameEl.textContent = user.full_name;
    if (roleEl) roleEl.textContent = user.role;
    return user;
  } catch { window.location.href = "/login.html"; return null; }
}