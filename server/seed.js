"use strict";

const crypto = require("node:crypto");
const db = require("./db");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const RESET = process.argv.includes("--reset");
if (RESET) {
  console.log("Resetting database tables...");
  const tables = [
    "report_cards","attendance_terms","scores","attempt_answers","attempts",
    "exam_questions","exams","questions","students","class_subjects","subjects",
    "classes","academic_sessions","grading_scales","school_settings","users"
  ];
  for (const t of tables) db.exec(`DELETE FROM ${t};`);
  db.exec("DELETE FROM sqlite_sequence;");
}

console.log("Seeding...");

// ---------- school settings ----------
if (db.prepare("SELECT COUNT(*) c FROM school_settings").get().c === 0) {
  db.prepare(`INSERT INTO school_settings (school_name, school_level, head_title, address)
              VALUES (?,?,?,?)`).run(
    "Bright Future College","secondary","Principal","12 Learning Way, Lagos, Nigeria");
}

// ---------- users ----------
let adminId;
if (db.prepare("SELECT COUNT(*) c FROM users").get().c === 0) {
  adminId = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
                        VALUES (?,?,?,?,1)`).run(
    "admin", hashPassword("admin123"), "System Administrator", "admin").lastInsertRowid;

  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
              VALUES (?,?,?,?,1)`).run(
    "teacher1", hashPassword("teacher123"), "Mrs. Ada Bello", "teacher");

  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active)
              VALUES (?,?,?,?,0)`).run(
    "admin2", hashPassword("admin123"), "Mr. Chidi Okeke", "admin");
} else {
  adminId = db.prepare("SELECT id FROM users WHERE role='admin' AND is_active=1 LIMIT 1").get().id;
}

// ---------- session ----------
let sessionId;
const s = db.prepare("SELECT id FROM academic_sessions WHERE name=? AND term=?").get("2025/2026","First");
if (s) sessionId = s.id;
else sessionId = db.prepare(`INSERT INTO academic_sessions (name,term,is_current) VALUES (?,?,1)`)
  .run("2025/2026","First").lastInsertRowid;

// ---------- classes ----------
function ensureClass(name, arm, level) {
  const x = db.prepare("SELECT id FROM classes WHERE name=? AND arm=?").get(name, arm);
  return x ? x.id : db.prepare("INSERT INTO classes (name,arm,level) VALUES (?,?,?)")
    .run(name, arm, level).lastInsertRowid;
}
const jss1a = ensureClass("JSS1","A","secondary");
const jss2a = ensureClass("JSS2","A","secondary");

// ---------- subjects ----------
function ensureSubject(name, code, level="secondary") {
  const x = db.prepare("SELECT id FROM subjects WHERE code=?").get(code);
  return x ? x.id : db.prepare("INSERT INTO subjects (name,code,class_level) VALUES (?,?,?)")
    .run(name, code, level).lastInsertRowid;
}
const math = ensureSubject("Mathematics","MTH");
const eng  = ensureSubject("English Language","ENG");
const bio  = ensureSubject("Basic Science","BSC");
const sst  = ensureSubject("Social Studies","SST");

// ---------- grading scale ----------
if (db.prepare("SELECT COUNT(*) c FROM grading_scales").get().c === 0) {
  const ins = db.prepare(`INSERT INTO grading_scales (min_score,max_score,grade,remark) VALUES (?,?,?,?)`);
  for (const s of [[70,100,"A","Excellent"],[60,69,"B","Very Good"],[50,59,"C","Good"],
                   [45,49,"D","Fair"],[40,44,"E","Pass"],[0,39,"F","Fail"]]) ins.run(...s);
}

// ---------- students + their user accounts ----------
function ensureStudentUser(username, password, fullName) {
  const existing = db.prepare("SELECT id FROM users WHERE username=?").get(username);
  if (existing) return existing.id;
  return db.prepare(`INSERT INTO users (username,password_hash,full_name,role,is_active)
                     VALUES (?,?,?,?,1)`).run(username, hashPassword(password), fullName, "student")
    .lastInsertRowid;
}

function ensureStudent(admission_no, full_name, gender, class_id, username) {
  const existing = db.prepare("SELECT id FROM students WHERE admission_no=?").get(admission_no);
  if (existing) return existing.id;
  const userId = ensureStudentUser(username, "student123", full_name);
  return db.prepare(`INSERT INTO students (admission_no,full_name,gender,class_id,user_id)
                     VALUES (?,?,?,?,?)`).run(admission_no, full_name, gender, class_id, userId)
    .lastInsertRowid;
}

ensureStudent("BFC/2025/001","Ada Okafor","F",jss2a,"ada");
ensureStudent("BFC/2025/002","Bola Adeyemi","M",jss2a,"bola");
ensureStudent("BFC/2025/003","Chika Nwosu","F",jss2a,"chika");
ensureStudent("BFC/2025/004","Dayo Balogun","M",jss1a,"dayo");
ensureStudent("BFC/2025/005","Efe Oghene","F",jss1a,"efe");

// ---------- sample questions ----------
if (db.prepare("SELECT COUNT(*) c FROM questions").get().c === 0) {
  const ins = db.prepare(`INSERT INTO questions
    (subject_id,class_level,question,option_a,option_b,option_c,option_d,correct_answer,marks,explanation,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run(math,"secondary","What is 15% of 200?","20","25","30","35","C",1,"15/100 x 200 = 30.",adminId);
  ins.run(math,"secondary","Solve for x: 3x + 5 = 20","3","4","5","6","C",1,"3x = 15, so x = 5.",adminId);
  ins.run(eng,"secondary",'Choose the word opposite in meaning to "scarce".',
          "rare","plentiful","costly","limited","B",1,"Scarce means in short supply.",adminId);
  ins.run(bio,"secondary","Which part of the cell controls its activities?",
          "Cell wall","Cytoplasm","Nucleus","Vacuole","C",1,"The nucleus directs cell activity.",adminId);
  ins.run(sst,"secondary","Which of these is a renewable source of energy?",
          "Coal","Natural gas","Solar","Petroleum","C",1,"Solar energy is replenished naturally.",adminId);
}

console.log("Seed complete.");
console.log("Admin    -> admin     / admin123");
console.log("Teacher  -> teacher1  / teacher123");
console.log("Students -> ada, bola, chika, dayo, efe  / student123");
console.log("admin2 exists but is inactive (activate from admin dashboard).");