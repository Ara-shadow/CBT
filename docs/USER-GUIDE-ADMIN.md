# Admin guide

You are the person who sets up the school and manages users.

## First-time setup (do this once)

Log in as admin, then in order:

1. **Settings** — set school name, address, level (primary/secondary),
   head title (Principal or Head Teacher)
2. **Sessions** — create the current academic session, e.g.
   "2025/2026 First Term", and mark it current
3. **Classes** — add each class, e.g. JSS1 A, JSS1 B, JSS2 A...
4. **Subjects** — add each subject, e.g. Mathematics, English Language...
5. **Assignments** — for each class, tick the subjects it takes and
   assign a teacher
6. **Students** — add each student: name, class, guardian details,
   login username and password
7. **Parents** — create parent logins and link them to their children
8. **Grading** — check the grading scale (A, B, C, D, E, F). Edit if
   your school uses different boundaries
9. **Users** — create accounts for all teachers

## Regular tasks

### Weekly
- Back up the database (Settings → Backup & restore)
- Monitor logins — if a teacher forgets their password, reset it

### End of term
1. Teachers enter scores and attendance
2. Teachers sync CBT scores
3. You go to **Publish**:
   - Choose class + session + term + type (End of term)
   - Write or apply preset comments
   - Click **Publish all**
4. Go to **Report links**:
   - Choose class + session + term + type
   - Click **Generate for whole class**
   - A CSV downloads with links
   - Send each parent their link

### Start of new term
1. **Sessions** — add the new term, mark it current
2. **Attendance** — teachers mark fresh for the new term
3. New students — add them, assign to classes
4. Left students — mark as graduated or withdrawn (Students page)

## Report links — the fastest way to send results to parents

1. Go to **Report links**
2. Pick class, session, term, type
3. Click **Generate for whole class**
4. A file downloads — open it in Excel
5. It has columns: admission_no, student, link
6. For each parent, copy the link and send it via WhatsApp or SMS

Parents just tap the link. No login, no password.

The link expires after 30 days (you can change this in Settings).

## User management

- **Activate / deactivate** users from the Users page
- **Reset passwords** — go to Students or Parents, click Reset password
- **Deactivate instead of delete** — keeps their records intact

## What to do if you forget your admin password

Restore a backup from before you changed it. If you have no backup,
contact whoever set up the system — the password is stored hashed and
cannot be recovered, only reset.

## Security notes

- Never share the `cbt.db` file with anyone outside the school
- Never send admin credentials over chat
- If a teacher leaves, deactivate their account immediately