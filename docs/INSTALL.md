# Installing on a new laptop

You only need to do this once per machine.

## 1. Install Node.js

Download from https://nodejs.org — choose the **LTS** version
(currently Node 22 or 20). Install with default settings.

To verify, open PowerShell and run:

    node -v
    npm -v

You should see version numbers, e.g. `v22.x.x` and `10.x.x`.

## 2. Copy the project folder

Copy the entire `cbt-school-system` folder to `C:\Users\<YourName>\`.

## 3. Install dependencies

Open PowerShell:

    cd "$HOME\cbt-school-system"
    npm install

This downloads the required packages (Express, SQLite, etc.).

**If download is slow**, switch to a faster mirror first:

    npm config set registry https://registry.npmmirror.com
    npm install

## 4. Initialise the database

    npm run seed

This creates the database with:
- One admin account (admin / admin123)
- One teacher account (teacher1 / teacher123)
- Two demo classes and a few sample students

**Delete or ignore the demo data** once you start adding real records.

## 5. Start the server

    npm start

You'll see:

    CBT school system running at http://localhost:4000
    Login page: http://localhost:4000/login.html

Open that URL in your browser.

## 6. Test the login

Log in as **admin / admin123**. You should land on the admin dashboard.

---

## Next steps

- Read `docs/DAILY-USE.md` for daily operations
- Log in as admin and:
  1. Change your admin password (create a new admin and deactivate the old)
  2. Update school settings (name, level, head title, address)
  3. Create your real classes, subjects, and students
  4. Delete the demo data (see `docs/DAILY-USE.md`)