"use strict";

const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const db = require("../db");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireRole("admin"));

// Where the DB lives
function dbPath() {
  return path.resolve(process.cwd(), process.env.DB_PATH || "./data/cbt.db");
}

/* ---------- GET /api/admin/backup ----------
   Streams the current database file to the admin's browser.
   Before streaming, we make a checkpoint so WAL data is flushed into the .db.
*/
router.get("/backup", (req, res) => {
  try {
    // Force a WAL checkpoint so the .db file is complete
    db.exec("PRAGMA wal_checkpoint(FULL);");
  } catch (e) {
    // Older SQLite may not support this; ignore
  }

  const file = dbPath();
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Database file not found" });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const filename = `cbt-backup-${stamp}.db`;

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  fs.createReadStream(file).pipe(res);
});

/* ---------- POST /api/admin/restore ----------
   Accepts multipart with a "file" field. Validates that it's a SQLite file
   with our expected tables, then overwrites the current DB.
   The server should be restarted afterwards for a clean state.
*/
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }   // 100 MB
});

router.post("/restore", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });

  const buf = req.file.buffer;
  if (buf.length < 100) return res.status(400).json({ error: "File is too small to be a database" });

  // SQLite files start with the ASCII text "SQLite format 3\0"
  const header = buf.subarray(0, 16).toString("utf8");
  if (!header.startsWith("SQLite format 3")) {
    return res.status(400).json({ error: "Uploaded file is not a valid SQLite database" });
  }

  // Sanity check: does it contain the "users" table? We can scan the raw bytes
  // for the string "CREATE TABLE users" or just look for "users" in the schema area.
  // Simpler: search the first 1 MB for the word "users" as a substring.
  const sample = buf.subarray(0, Math.min(buf.length, 1024 * 1024)).toString("latin1");
  if (!/users/.test(sample)) {
    return res.status(400).json({ error: "This does not look like a CBT database (no 'users' table found)" });
  }

  const file = dbPath();
  const dir  = path.dirname(file);
  const base = path.basename(file);

  try {
    // 1) Save a safety copy of the current DB, in case the new one is bad.
    if (fs.existsSync(file)) {
      const safety = path.join(dir, base + ".before-restore-" + Date.now());
      fs.copyFileSync(file, safety);

      // Also snapshot the WAL and SHM if present, so nothing is lost
      for (const ext of ["-wal", "-shm"]) {
        const p = file + ext;
        if (fs.existsSync(p)) fs.copyFileSync(p, safety + ext);
      }
    }

    // 2) Close all DB access by truncating our in-memory handle.
    //    node:sqlite has no .close() that's safe to call here while other
    //    requests may be in flight, but the OS will let us overwrite the file
    //    on Windows only if no read handle is open. To be safe, write the new
    //    bytes to a temp file and rename over the old one.
    const tmp = path.join(dir, base + ".restore-tmp-" + Date.now());
    fs.writeFileSync(tmp, buf);

    // 3) Delete the WAL and SHM so SQLite doesn't try to apply them to the new DB.
    for (const ext of ["-wal", "-shm"]) {
      const p = file + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // 4) Rename the temp file over the real DB.
    fs.renameSync(tmp, file);
  } catch (e) {
    return res.status(500).json({
      error: "Could not write the database file. Try stopping the server, replacing the file manually, then restarting. Details: " + e.message
    });
  }

  res.json({
    ok: true,
    message: "Backup restored. Please stop the server (Ctrl + C) and run `npm start` again so the change takes effect."
  });
});

module.exports = router;