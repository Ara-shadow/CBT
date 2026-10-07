# Deploying to a real server (later)

When you're ready to make the system available over the internet — so
teachers and parents can log in from home — you need to deploy it.
This document is a starting point. The exact steps depend on where you
host it.

## Why deploy?

Running on one laptop means:
- Only users on that laptop can log in
- The laptop must be on for anyone to use it
- Parents can't check their ward's results from home

Deploying to a server means:
- Everyone with internet access can log in
- The server runs 24/7
- You can share report links via WhatsApp

## Prerequisites before deploying

1. **A domain name** (optional but nice) — e.g. `yourschool.com`
2. **A hosting account** — see options below
3. **HTTPS** — required for parent logins to be secure

## Hosting options (from easiest to most control)

### Option 1 — Render.com (easiest, free tier)

1. Create an account at https://render.com
2. Push the project to a GitHub repository
3. In Render, create a new **Web Service** connected to that repo
4. Set:
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: Node
   - Environment variables: `SESSION_SECRET`, `PORT`, `NODE_ENV=production`
5. Render gives you a URL like `https://yourschool.onrender.com`

**Caveat:** Render's free tier spins down after inactivity. First
request after idle takes 30+ seconds. For a real school, use a paid tier.

### Option 2 — Railway.app (similar, sometimes cheaper)

Same idea as Render. Good for small apps.

### Option 3 — DigitalOcean / Linode VPS (full control)

Rent a small VPS (~$6/month). You get a Linux server you control.
Requires:
- SSH access
- Installing Node.js on the server
- Running the app with `pm2` (a process manager that keeps it running)
- Setting up Nginx as a reverse proxy
- Getting a free HTTPS certificate from Let's Encrypt

If you don't have IT staff, this is overkill. Hire someone or use Render.

### Option 4 — School's own server (if the school has one)

If the school already has a computer that's always on and connected to
the internet, you can host it there. Same steps as DigitalOcean.

## Important production changes

Before deploying, change these in your `.env`:

    NODE_ENV=production
    SESSION_SECRET=<a long random string>
    PORT=4000

- `SESSION_SECRET` — must be a long random string. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- **Never** deploy with the default `dev-secret`. It's not safe.

## HTTPS is required

Sessions and passwords must go over HTTPS. All the hosts above give
you HTTPS automatically once you point a domain at them.

## Backups on a hosted server

The backup page still works — you download the `.db` file. Do this
weekly. On the server side, most hosts also let you schedule a cron job
that copies the file somewhere else.

## After deploying

1. Set the school name and address in Settings
2. Change all demo passwords
3. Delete demo data (students, classes, parents)
4. Test everything with a small pilot group before going live
5. Give teachers and parents their credentials

## What about offline use?

A deployed server requires internet. If your school has unreliable
internet, run the system on the laptop (as now) and only deploy once
you have reliable connectivity.