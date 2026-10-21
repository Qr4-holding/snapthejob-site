# SnapTheJob / CleanUpSnap site

One codebase, several brands ("skins"). The `SKIN` setting picks `skins/<id>/skin.json` (default `snapthejob`).

- `server.js` – Node/Express: pages, waiting list, follow alerts, private stats, owner-only `/admin`.
- `jobs-admin.js` – job videos (upload, convert, thumbnails) at `/admin/jobs`.
- `quotes.js` – photo quote requests ("Snap your rubbish") for skins with a `quote` section; admin at `/admin/quotes`. Photos are re-encoded (location data removed), kept outside the public folder and deleted after `quote.photoDays`.
- `public/` – shared pages and scripts. Pages use `{{TOKENS}}` filled from the skin.
- `skins/<id>/skin.json` – name, colours, categories, wording, quote questions. `skins/<id>/public/` – that brand's own files (logo icons, CSS, privacy page) which win over the shared ones.
- Runs on the Hostinger VPS with Docker (see `deploy/`: one project per brand). Passwords live only in the server's environment settings, never in this repo.

Add a brand: copy a skin folder, change `skin.json`, add a compose file with `SKIN=<id>` and its own domain.
