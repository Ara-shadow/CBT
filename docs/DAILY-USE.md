# Running the system day to day

## Starting the server

1. Open **PowerShell**
2. Run:

    cd "$HOME\cbt-school-system"
    npm start

3. Leave that window open. The server is now running.
4. Open your browser to http://localhost:4000/login.html

**Important:** the server must be running for anyone to use the system.
As long as that PowerShell window is open, the school can log in from
their own browsers on the same machine.

## Stopping the server

1. Go to the PowerShell window that's running the server
2. Press **Ctrl + C** (once, sometimes twice)
3. Wait for the prompt to come back

**Never just close the window** — that can leave the server running
in the background and cause "port in use" errors later.

## If you see "port in use" or "EADDRINUSE"

An old server is still running. Fix it:

    Stop-Process -Name node -Force

Then `npm start` again.

## Day-to-day workflow

### Weekly
- Admin: back up the database (see `docs/BACKUP.md`)
- Teachers: enter any new CA and PBT scores

### End of every term
- Teachers: enter all scores, sync CBT
- Admin: write comments, publish reports
- Admin: generate report links, send to parents
- Admin: back up the database
- Admin: create the next session and mark it current

### Yearly
- Admin: create new classes for the incoming set
- Admin: graduate or archive students who left
- Admin: back up before any major change

## Deleting demo data

Once you're ready to go live:

1. Log in as admin
2. Go to **Students** → delete the 5 demo students (Ada, Bola, Chika, Dayo, Efe)
3. Go to **Parents** → delete any demo parents
4. Go to **Users** → deactivate `teacher1` and `admin2` if you don't want them
5. Go to **Classes** → delete JSS1A and JSS2A if you're replacing them
6. Go to **Subjects** → keep the ones you need, delete the rest
7. Go to **Question bank** → delete the demo questions

Or, if you prefer a clean slate:

    npm run reset

That wipes everything and re-seeds the demo data — useful only for testing,
not for a live school.

## Adding a new user

**Teacher:**
1. Log in as admin
2. Go to Users → + Create user
3. Role: Teacher → Save

**Student:**
1. Log in as admin (or as the class teacher)
2. Go to Students → + Add student
3. Fill in their details, pick a class, set a username and password
4. They can now log in

**Parent:**
1. Log in as admin
2. Go to Parents → + Add parent
3. Pick their child(ren) from the list
4. Share their login (or a report link — see `docs/USER-GUIDE-ADMIN.md`)

## Adding a whole class of students

The students page accepts a form one at a time. For a whole class, this
takes a while, but it works. A bulk CSV import for students is a future
enhancement.

## What to do if something breaks

1. **Students can't log in** — check the user is **Active** in Users. New
   admin accounts need another admin to activate them.
2. **Exam won't show for a student** — check (a) the exam is **Published**,
   (b) the exam's class matches the student's class.
3. **Report link doesn't work** — check the link isn't **Revoked** or
   **Expired** in the Report links page.
4. **Everything is slow** — the server process may be overloaded. Restart
   it (Ctrl + C, then `npm start`).