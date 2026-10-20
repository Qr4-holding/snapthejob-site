# SnapTheJob site

Public front end and waiting list for SnapTheJob.co.uk.

- `server.js` – Node/Express: serves `public/`, saves waiting-list sign-ups to PostgreSQL, owner-only `/admin` page and CSV download.
- Runs on the Hostinger VPS with Docker (see `deploy/`). Passwords live only in the server's environment settings, never in this repo.
