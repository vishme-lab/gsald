# Cyber Security Employee Dashboard

An animated, HUD-style leaderboard for Cyber Security Awareness Month, plus a secret-URL admin console for uploading the score spreadsheets.

* **Public leaderboard** (`/`): KPI tiles, a top-3 podium, the top 10 defenders, and a search that lets anyone find their own rank, name and score. Every row expands to show the score breakdown across the six categories (with the sum written out), plus that person's score and rank history.
* **Admin console** (`/ops/<secret>/`): one upload box for each category (Online Games, Case Study, Annual Awareness, Exceptions, Suspicious Activity, Phishing Mail) and one for the email-to-name mapping. It also has version history with delete, exports and an activity log.
* **History is never lost**: every upload is stored as a new version. The leaderboard is rebuilt by replaying the versions in date order, which produces the trendlines.

The server is pure Python (Flask + openpyxl, served by waitress). The browser side is static HTML/CSS/JS with no build step and no external JS libraries.

---

## Quick start (Windows)

Use either launcher. Both install everything that's missing, then start the server:

* **`StartDashboard.exe`** (double-click). If Python 3.10+ isn't installed, it offers to install Python 3.13 with `winget`, then runs `launcher.py`.
* **`launcher.py`** (`python launcher.py`, or double-click) if Python is already installed.

On the first run the launcher:

1. creates the `.venv` virtual environment
2. installs the pinned packages from `requirements.txt` (again only when that file changes)
3. creates `.env` from `.env.example` with a freshly generated admin secret

After that, the console window shows both URLs. Keep the window open while the dashboard is in use; press Ctrl+C to stop it.

```
  Leaderboard   : http://127.0.0.1:8000/
  Admin console : http://127.0.0.1:8000/ops/<ADMIN_SECRET from .env>/
```

Launcher options: `--setup-only` installs without starting, and `--reinstall` forces a clean package install.

**Servers without internet.** On a PC with internet and the same Python version, run `python launcher.py --download-wheels`. Copy the whole folder, including the new `wheels\` folder, to the server. The launcher there installs from it instead of from PyPI.

`StartDashboard.exe` is built from `windows\StartDashboard.cs` with the C# compiler that ships with Windows; run `windows\build_exe.bat` to rebuild it. It isn't code-signed, so Windows SmartScreen may warn on first run if the file came from the internet. Sign it with your company certificate for wide distribution.

### Try it with demo data first

```bash
.venv/Scripts/python scripts/demo.py
```

This runs against a separate `demo-data/` folder seeded with 260 synthetic employees across 5 sync dates, so the trendlines show something. Your real `data/` folder is never touched. Use `--reseed` to start the demo over.

`python scripts/make_samples.py` writes the same synthetic data as Excel files to `sample-data/`, so you can practise uploads in the real admin console.

---

## The admin URL

The console lives at `http://<host>:<PORT>/<ADMIN_PATH_PREFIX>/<ADMIN_SECRET>/`. All three parts are set in `.env`:

```ini
PORT=8000
ADMIN_PATH_PREFIX=ops
ADMIN_SECRET=<48 random characters>
```

* Change any of them and restart the server to move the console. The old URL then returns a plain 404.
* Print the current URL: `python scripts/admin_url.py`
* Get a new random secret written into `.env` (if it leaked, or someone left the team): `python scripts/admin_url.py --rotate`, then restart.
* `ADMIN_SECRET` must be 24 to 128 characters of `A-Z a-z 0-9 _ -`. `ADMIN_PATH_PREFIX` can be several segments (e.g. `secure/control`) but can't start with `api` or `static`. If you remove `ADMIN_SECRET`, one is generated into `data/admin-secret.key` instead.
* **Optional password.** Set `ADMIN_PASSWORD` (12+ characters) and the browser also asks for it, with any username. Ten wrong attempts from one address lock that address out for 15 minutes. This is recommended whenever `HOST` is not `127.0.0.1`, because a leaked URL alone is then no longer enough.

Admin pages send `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: no-store`, so the URL doesn't leak through links or search engines. The full admin URL is printed only to an interactive console; when output goes to a log file it shows `<hidden>` instead. `.env` is git-ignored because it holds the secret. Never share or commit it; `.env.example` is the safe template.

Every admin action is written to `data/audit.log` with the caller's IP. For company-wide use, also serve the app over HTTPS (see below) and consider restricting `/ops/` to admin IPs at the reverse proxy. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the full review.

---

## Uploading scores

Each category box accepts `.xlsx`, `.xlsm` or `.csv`. Legacy `.xls` files are refused with a "save as .xlsx" message (see SECURITY_REVIEW.md). The file needs:

| Column | Recognised headers (case-insensitive) |
|---|---|
| Email | `Email`, `Email ID`, `E-mail`, `Mail ID`, `Employee Email`, ... |
| Score | `Score`, `Points`, `Marks`, `Total`, `Result`, ... (otherwise the most numeric column) |

The header row can sit anywhere in the first 25 rows, and every sheet is checked. Files with no header row also work (columns are detected from their contents). Each box has a **Template** link.

**Upload modes** (chosen per box):

* **Replace** (default): the file is the complete, current score list for that category. People missing from it drop to 0 in that category. Use this when each export holds running totals.
* **Add**: the file holds new points earned since the last upload, which are added on top.

**Data as of**: the date at the top of the console. Uploads are plotted on the trendline at that date. To backfill older files, pick the older date before uploading. Uploads that share a date form one sync point.

After each upload the box reports people and points loaded, the columns it used, skipped rows (with row numbers and reasons), duplicate emails (their scores are summed), and emails that don't have a name yet.

Made a mistake? Open **Version history** and delete the version. Everything is recalculated without it, and the original file stays archived in `data/uploads/`.

### Email-to-name mapping

The mapping box takes `Email ID` + `Name` columns, or `First Name` + `Last Name`.

* **Merge** (default) adds or updates names and keeps everyone else.
* **Replace** makes the file the complete directory.

Scored emails without a mapping still appear, with a name derived from the address (`jane.doe@...` becomes "Jane Doe"). **Unmapped emails** downloads them as a ready-to-fill mapping sheet.

### Exports

**Export leaderboard** downloads an `.xlsx` with three sheets:

* the full ranked list with each category and the rank change
* the organisation trend for every sync point
* the full upload log

---

## How scores and ranks are computed

1. Versions are replayed in order of their "as of" date, then upload order.
2. Each employee's total is the sum of their six current category scores. Negative values are allowed, for example penalties in Exceptions.
3. After each sync date, everyone with at least one record is ranked by competition ranking (1, 2, 2, 4). Employees who appear only in the name mapping are searchable but shown as "unranked".
4. The ▲/▼ marker on each row compares the latest sync with the previous one.

---

## Configuration

All settings live in the **`.env`** file in the project folder. Edit it and restart the server. Real environment variables, if set, override `.env`.

| Setting | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | Port the app listens on |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` to serve the network |
| `ADMIN_PATH_PREFIX` | `ops` | First part of the admin URL path |
| `ADMIN_SECRET` | generated | Secret part of the admin URL |
| `PUBLIC_URL` | | Base URL printed in the startup banner, e.g. `https://cyber.example.com` |
| `ORG_NAME` | | Replaces "CYBER" in the top-left brand |
| `DASHBOARD_TAGLINE` | `Cyber Security Awareness Month · <Mon YYYY>` | Text above the title |
| `ADMIN_PASSWORD` | | Optional second factor for the admin console (12+ characters) |
| `MAX_UPLOAD_MB` | `25` | Upload size limit, 1 to 500 (enforced by both waitress and Flask) |
| `DATA_DIR` | `data` | Database, archived uploads, backups and audit log (relative to the project folder) |
| `TRUST_PROXY` | | Set to `1` **only** behind a reverse proxy. Client IP and `https` are then taken from the proxy's `X-Forwarded-For` / `X-Forwarded-Proto` (one hop). |
| `SHOW_ADMIN_URL` | | Set to `1` to print the full admin URL even when output goes to a log file |

### Deploying for the whole company

1. Run it on an internal Windows server with `HOST=0.0.0.0` and allow the port in Windows Firewall.
2. Put IIS (with URL Rewrite + ARR), nginx or a load balancer in front to terminate **HTTPS**.
3. Set `TRUST_PROXY=1`, `PUBLIC_URL=https://...` and an `ADMIN_PASSWORD`.

On plain HTTP, the admin URL and password travel unencrypted, and the startup banner warns about this. Waitress is a production WSGI server, so no extra app server is needed. To keep it running after sign-out, register `StartDashboard.exe` as a scheduled task that runs at startup.

Back up the `DATA_DIR` folder; it is the whole system of record. It contains employee names and email addresses (personal data). Keep it on a drive with restricted access and apply your data-retention policy to `data/uploads/` (original files) and `data/backups/`.

---

## Project layout

```
StartDashboard.exe   Windows one-click launcher (installs Python if needed, then runs launcher.py)
launcher.py          creates .venv, installs pinned packages, creates .env, starts app.py
app.py               Flask app: public API, secret admin blueprint, security headers
.env                 settings: port, host, admin URL, branding (git-ignored, holds the secret)
.env.example         safe template the launcher copies to .env on first run
requirements.txt     pinned runtime dependencies (direct + transitive)
core/
  env.py             .env loader
  categories.py      the six categories (labels, colors, order)
  excel_io.py        .xlsx/.csv parsing with column detection; xlsx writing (formula-safe)
  store.py           JSON store, version replay, ranking, history, search, exports
  secret.py          admin URL prefix + secret
  demo_data.py       synthetic data generator
static/              public leaderboard (index.html, css/, js/, fonts/ = self-hosted OFL web fonts)
admin_ui/            admin console page, served only under the secret path
scripts/             demo.py, make_samples.py, admin_url.py, sbom.py
security/            sbom.cdx.json (CycloneDX SBOM), THIRD_PARTY_NOTICES.md
windows/             StartDashboard.cs, build_exe.bat, shield.ico
data/                created empty on first start (git-ignored)
```

### Public API

| Endpoint | Returns |
|---|---|
| `GET /api/summary` | stats, category totals, org trend, top 10 with breakdowns, recent syncs |
| `GET /api/search?q=` | up to 25 matches by name, or one exact full email address (rank, name, score, breakdown, masked email). Email substrings are not matched, so addresses can't be enumerated. |
| `GET /api/employee/<id>` | one person's breakdown plus score and rank history |

Email addresses are never returned in full by the public API. People are addressed by a salted hash ID.

### Dependencies and licenses

`requirements.txt` pins every runtime package (11 in total) to an exact, reviewed version. The web fonts (Orbitron, Rajdhani, JetBrains Mono) are bundled in `static/fonts`, so pages make no third-party requests. All licenses are permissive (MIT, BSD-3-Clause, PSF-2.0, ZPL-2.1; the fonts are OFL-1.1, with their license texts alongside), with no copyleft. After changing a version, run `.venv\Scripts\python scripts\sbom.py` to regenerate `security/sbom.cdx.json` and `security/THIRD_PARTY_NOTICES.md`.
