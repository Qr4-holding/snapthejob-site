# SnapTheJob / CleanUpSnap site

One codebase, several brands ("skins"). The `SKIN` setting picks `skins/<id>/skin.json` (default `snapthejob`).

- `server.js` – Node/Express: pages, waiting list, follow alerts, private stats, owner-only `/admin`.
- `jobs-admin.js` – job videos (upload, convert, thumbnails) at `/admin/jobs`.
- `quotes.js` – photo quote requests ("Snap your rubbish") for skins with a `quote` section; admin at `/admin/quotes`. Photos are re-encoded (location data removed), kept outside the public folder and deleted after `quote.photoDays`.
- `public/` – shared pages and scripts. Pages use `{{TOKENS}}` filled from the skin.
- `skins/<id>/skin.json` – name, colours, categories, wording, quote questions. `skins/<id>/public/` – that brand's own files (logo icons, CSS, privacy page) which win over the shared ones.
- Runs on the Hostinger VPS with Docker (see `deploy/`: one project per brand). Passwords live only in the server's environment settings, never in this repo.

Add a brand: copy a skin folder, change `skin.json`, add a compose file with `SKIN=<id>` and its own domain.

## Get the app (install to home screen)
Every skin gets `/app` automatically: a one-tap Install button on Android and computers, step-by-step Add to Home Screen on iPhone, a QR code on computers, and a small "Get the app" bar for phone visitors (from their 3rd page, dismissible for 30 days). Installs and home-screen opens show in admin stats.
Per skin: `skin.json` → optional `"app": { "name", "shortName", "benefits": [...] }`; icons in `skins/<id>/public/assets/` made with
`node tools/make-icons.js <skin-id> [#colour] [logo.png]` (makes icon-192/512, a maskable icon for Android and apple-touch-icon).

## Adding a brand (skin)
1. Copy `skins/cleanupsnap` to `skins/<id>`; edit `skin.json` (name, theme, fonts, categories, quote wording, app) and `public/assets/skin.css`.
2. Make icons with `tools/make-icons.js`.
3. New Docker project from `deploy/` with `SKIN=<id>` and its own domain labels.
`skins/ekp11` is the EKP 11 Waste Management version (preview only, not deployed).

## Carrier / trade area (`"trades": true` in the skin)
`/trade` sign in or create account (cookie on their phone, 180 days). `/trade/jobs`: Post a job (before, optional during, after photos from camera or gallery) and My jobs.
Photos are re-encoded (hidden data such as location dropped) and rendered by `video/engine.py` (python3 + Pillow in the container) into the social and site videos with the skin's `video` brand block. New jobs wait for approval in `/admin/jobs` (Approve = live + follower alert; Reject = delete). A signed-in carrier's home page shows "Post a job" in place of the customer button.

## Founders page (`"founders": true` in the skin; cleanuppic only)
`/founders` (noindex until approved): the founder-places sales page, built from `founders/page.html` (approved mock: `founders/mock.html`).
- Page: the hub's own shell (hub fonts, site.css/skin.css, header, footer, quote flow, video player). Videos: `founders/assets/real-job-fence-ekp11.mp4` (hero) and `what-your-phone-does.mp4`, served at `/founders/media/`; posters in `public/founders/`. "Latest clear-ups" are the four newest jobs from the hub's job list, or from `FOUNDERS_FEED_URL` (e.g. `https://cleanuppic.co.uk/assets/jobs.js`) on a preview with its own empty database.
- Form → `POST /api/founders`: UK postcode, business name, UK mobile, carrier registration. Must be CBDU + 6 numbers, found on the Environment Agency register (`ea.js`), upper tier, not expired. Saved to the `founders` table with a place per postcode district (10 per district; after that a waiting-list number). An email goes to `hello@cleanuppic.co.uk` (`FOUNDERS_EMAIL` to change) through `mail.js`.
- Admin: `/admin/founders` lists applications by area with the count per area.
- Tests: `DATABASE_URL=postgres://… node test/founders.js` (the register is faked so tiers, expiry, unknown numbers and a register outage can all be tested).
