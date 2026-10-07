# CBT + PBT School System

A complete school management system for Nigerian schools. Runs on a laptop
or any Node.js-capable machine. No internet required once installed.

## What it does

- **CBT exams** — teachers create MCQs, build exams, students take them online
  with a timer and proctoring (logout on tab switch)
- **PBT scores** — teachers enter theory scores manually
- **Continuous assessment** — CA1 (10), CA2 (20), Project (10) = Midterm out of 40
- **Term results** — Midterm 40 + CBT 30 + PBT 30 = 100
- **Attendance** — daily marking (P/A) or term summary
- **Report cards** — printable, publishable, with teacher and principal comments
- **Parent access** — by login or by private link (no account needed)

## Quick start

    npm install
    npm run seed
    npm start

Then open http://localhost:4000/login.html

See `docs/DAILY-USE.md` for the day-to-day guide and `docs/INSTALL.md`
for first-time setup on a new machine.

## Demo logins (after seed)

| Role    | Username | Password    |
|---------|----------|-------------|
| Admin   | admin    | admin123    |
| Teacher | teacher1 | teacher123  |
| Student | ada      | student123  |
| Student | bola     | student123  |
| Student | chika    | student123  |

Change these before using in a real school.

## Documentation

- `docs/INSTALL.md` — installing on a new laptop
- `docs/DAILY-USE.md` — running the system day to day
- `docs/BACKUP.md` — backup and restore
- `docs/DEPLOY.md` — moving to a real server later
- `docs/USER-GUIDE-ADMIN.md` — admin guide
- `docs/USER-GUIDE-TEACHER.md` — teacher guide
- `docs/USER-GUIDE-STUDENT-PARENT.md` — student and parent guide

## Requirements

- Node.js 22 or newer
- Any modern browser
- ~500 MB free disk space

## License

Private use by the school.