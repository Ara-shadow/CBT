# Backup and restore

Your entire school's data lives in one file: `data\cbt.db`.

If that file is lost and you have no backup, you lose everything:
students, scores, results, exams, attendance. Backups are not optional.

## Taking a backup (recommended: weekly)

### Easiest method — from the admin page

1. Log in as admin
2. Go to **Settings** → **Backup & restore**
3. Click **Download backup**
4. A file downloads named `cbt-backup-2026-10-05-...db`
5. Save it somewhere safe

### Where to save backups

Keep at least **three copies**:

1. On the same laptop, in a folder called `Backups` (so you can restore quickly)
2. On a **USB stick** or external drive (in case the laptop dies)
3. In the **cloud** — Google Drive, Dropbox, or email it to yourself (in
   case the building is lost)

### When to back up

- **Every Friday** (routine)
- **Before** any major change — new term, publishing results, importing
  questions
- **After** any major change — so the backup reflects the current state

## Restoring from backup

1. Log in as admin
2. Go to **Settings** → **Backup & restore**
3. Click **Restore from backup…**
4. Choose the backup file
5. When prompted, type `RESTORE` to confirm
6. Wait for the success message
7. **Stop the server** (Ctrl + C in the PowerShell window)
8. **Start it again** (`npm start`)
9. Verify that data is back (check a student you know you added)

The server automatically saves a **safety copy** of your current database
before overwriting, so you can roll back if the backup was wrong. Look in
`data\` for files named `cbt.db.before-restore-...`.

## Verifying a backup is valid

Open the `.db` file in Notepad. The first line should start with:

    SQLite format 3

If it does, it's a real database. If it shows gibberish or "not found,"
the backup is broken — use a different one.

## Moving the system to a new laptop

1. On the old laptop: download a fresh backup
2. Install the system on the new laptop (see `docs/INSTALL.md`)
3. Copy the backup file to the new laptop
4. Log in as admin on the new laptop
5. Go to **Settings** → **Restore from backup…**
6. Choose the backup file
7. Restart the server

Everything moves across — users, scores, results, everything.

## Automatic backups (advanced)

If you want automatic weekly backups, you can set up a Windows Task
Scheduler job that copies `data\cbt.db` to a backup folder every Friday.
Ask your IT person, or search "Windows Task Scheduler copy file" online.