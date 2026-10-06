"""Cyber Security Employee Dashboard - web server.

    python app.py            # serves on http://127.0.0.1:8000 (prints the admin URL)

Settings are read from the .env file next to this script; real environment
variables override it. All are optional:
    HOST, PORT            bind address (default 127.0.0.1:8000; use HOST=0.0.0.0 to serve the network)
    DATA_DIR              where db.json, archived uploads and the admin key live (default ./data)
    ADMIN_PATH_PREFIX     first part of the admin URL path (default "ops")
    ADMIN_SECRET          secret part of the admin URL (generated into data/admin-secret.key if unset)
    PUBLIC_URL            base URL to print in the startup banner, e.g. https://cyber.example.com
    DASHBOARD_TAGLINE     eyebrow text above the title
    ORG_NAME              organisation name shown in the top bar
    ADMIN_PASSWORD        optional second factor: the console also asks for this password
    MAX_UPLOAD_MB         upload size limit (default 25)
    TRUST_PROXY           set to 1 only behind a reverse proxy (uses its X-Forwarded-* headers)
"""
import hmac
import logging
import mimetypes
import os
import re
import socket
import sys
import threading
import time
from collections import deque
from datetime import date
from pathlib import Path

from flask import Blueprint, Flask, Response, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from core.categories import CATEGORIES, CATEGORY_BY_KEY
from core.env import load_env, resolve_dir
from core.excel_io import UserError, build_workbook, parse_mapping_file, parse_score_file
from core.secret import admin_path, load_or_create_secret
from core.store import Store

BASE = Path(__file__).resolve().parent
load_env(BASE / ".env")
mimetypes.add_type("font/woff2", ".woff2")  # not in the Windows registry everywhere


def _int_setting(name, default, lo, hi):
    value = os.environ.get(name, str(default)).strip()
    if not value.isdigit() or not lo <= int(value) <= hi:
        raise SystemExit(f"{name} must be a whole number from {lo} to {hi} (got {value!r}). Check the .env file.")
    return int(value)


def _flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


DATA_DIR = resolve_dir(os.environ.get("DATA_DIR") or "data", BASE)
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = _int_setting("PORT", 8000, 1, 65535)
MAX_UPLOAD_MB = _int_setting("MAX_UPLOAD_MB", 25, 1, 500)
TRUST_PROXY = _flag("TRUST_PROXY")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if ADMIN_PASSWORD and len(ADMIN_PASSWORD) < 12:
    raise SystemExit("ADMIN_PASSWORD must be at least 12 characters (or left empty). Check the .env file.")
LOCKOUT_ATTEMPTS, LOCKOUT_SECONDS = 10, 15 * 60
EVENT = {
    "title": "Cyber Security Employee Dashboard",
    "tagline": os.environ.get("DASHBOARD_TAGLINE", f"Cyber Security Awareness Month · {date.today():%b %Y}"),
    "org": os.environ.get("ORG_NAME", ""),
}

store = Store(DATA_DIR)
ADMIN_SECRET = load_or_create_secret(DATA_DIR)
ADMIN_PREFIX = admin_path(ADMIN_SECRET)
STATIC_DIR = BASE / "static"
ADMIN_UI_DIR = BASE / "admin_ui"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
app.json.sort_keys = False
if TRUST_PROXY:
    # Trust exactly one proxy hop: client IP and scheme come from the values the
    # proxy itself appended, never from ones a client could forge.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
log = logging.getLogger("dashboard")

CSP = ("default-src 'self'; script-src 'self'; "
       "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"  # never leak the admin URL to other sites
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    if request.is_secure:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000"
    if "/api/" in request.path:
        resp.headers["Cache-Control"] = "no-store"
    return resp


def _redact(text):
    """Keep the admin secret out of logs."""
    return text.replace(ADMIN_SECRET, "<admin-secret>")


@app.errorhandler(UserError)
def user_error(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(413)
def too_large(_e):
    return jsonify(error=f"File is larger than {MAX_UPLOAD_MB} MB."), 413


@app.errorhandler(Exception)
def any_error(e):
    if isinstance(e, HTTPException):
        if "/api/" in request.path:
            return jsonify(error=e.description or e.name), e.code
        return Response(f"{e.code} {e.name}", e.code, mimetype="text/plain")
    log.exception("Unhandled error on %s", _redact(request.path))
    return jsonify(error="Internal error - see the server log."), 500


# ------------------------------------------------------------- public site --

@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/summary")
def api_summary():
    return jsonify({**store.summary(), "event": EVENT})


@app.get("/api/search")
def api_search():
    q = re.sub(r"\s+", " ", request.args.get("q", "")).strip()[:80]
    if len(q) < 2:
        return jsonify(query=q, count=0, results=[])
    return jsonify(store.search(q))


@app.get("/api/employee/<pid>")
def api_employee(pid):
    data = store.employee(pid)
    if not data:
        return jsonify(error="Not found"), 404
    return jsonify(data)


# ----------------------------------------------------------- admin console --
# Everything below is reachable only under /ops/<secret>/ - any other path 404s.

admin = Blueprint("admin", __name__, url_prefix=ADMIN_PREFIX)


_failures = {}            # client address -> deque of failed password attempt times
_failures_lock = threading.Lock()


@admin.before_request
def admin_password_check():
    """Optional second factor on top of the secret URL (HTTP Basic, any username)."""
    if not ADMIN_PASSWORD:
        return None
    client, now = request.remote_addr or "", time.monotonic()
    with _failures_lock:
        recent = _failures.get(client, deque())
        while recent and now - recent[0] > LOCKOUT_SECONDS:
            recent.popleft()
        if not recent:
            _failures.pop(client, None)
        if len(recent) >= LOCKOUT_ATTEMPTS:
            return Response("Too many failed sign-in attempts. Try again later.", 429,
                            {"Retry-After": str(LOCKOUT_SECONDS)}, mimetype="text/plain")
    auth = request.authorization
    supplied = (auth.password or "") if auth and auth.type == "basic" else ""
    if supplied and hmac.compare_digest(supplied.encode(), ADMIN_PASSWORD.encode()):
        return None
    if supplied:
        with _failures_lock:
            _failures.setdefault(client, deque()).append(now)
        log.warning("Failed admin password attempt from %s", client)
    return Response("Admin password required.", 401,
                    {"WWW-Authenticate": 'Basic realm="Admin console", charset="UTF-8"'}, mimetype="text/plain")


@admin.after_request
def admin_headers(resp):
    resp.headers["X-Robots-Tag"] = "noindex, nofollow"
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _actor():
    # With TRUST_PROXY=1, ProxyFix has already replaced remote_addr with the real client address.
    return request.remote_addr or ""


def _as_of(value):
    value = (value or "").strip() or date.today().isoformat()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise UserError('"Data as of" must be a date like 2026-10-05.')


def _file():
    f = request.files.get("file")
    if not f or not f.filename:
        raise UserError("No file received.")
    data = f.read()
    if not data:
        raise UserError("The uploaded file is empty.")
    return f.filename, data


def _xlsx(name, sheets):
    body = build_workbook(sheets)
    return Response(body, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@admin.get("/")
def admin_home():
    return send_from_directory(ADMIN_UI_DIR, "index.html")


@admin.get("/assets/<path:filename>")
def admin_asset(filename):
    return send_from_directory(ADMIN_UI_DIR, filename)


@admin.get("/api/state")
def admin_state():
    return jsonify({**store.admin_state(), "event": EVENT, "today": date.today().isoformat()})


@admin.post("/api/upload/<category>")
def admin_upload(category):
    if category not in CATEGORY_BY_KEY:
        return jsonify(error="Unknown category"), 404
    mode = request.form.get("mode", "replace")
    if mode not in ("replace", "add"):
        raise UserError("Mode must be replace or add.")
    as_of = _as_of(request.form.get("as_of"))
    name, data = _file()
    parsed = parse_score_file(data)
    rec = store.add_score_upload(category, mode, as_of, name, parsed, data, actor=_actor())
    return jsonify(ok=True, version=rec, issues=parsed["issues"])


@admin.post("/api/mapping")
def admin_mapping():
    mode = request.form.get("mode", "merge")
    if mode not in ("merge", "replace"):
        raise UserError("Mode must be merge or replace.")
    name, data = _file()
    parsed = parse_mapping_file(data)
    rec = store.add_mapping_upload(mode, name, parsed, data, actor=_actor())
    return jsonify(ok=True, version=rec, issues=parsed["issues"])


@admin.delete("/api/version/<rec_id>")
def admin_delete_version(rec_id):
    if not store.delete_version(rec_id, actor=_actor()):
        return jsonify(error="Version not found"), 404
    return jsonify(ok=True)


@admin.post("/api/purge")
def admin_purge():
    body = request.get_json(silent=True) or {}
    if body.get("confirm") != "PURGE":
        raise UserError('Type PURGE to confirm.')
    backup = store.purge(actor=_actor())
    return jsonify(ok=True, backup=backup)


@admin.get("/api/template/<kind>")
def admin_template(kind):
    if kind == "mapping":
        rows = [["Email ID", "Name"], ["jane.doe@company.com", "Jane Doe"], ["arjun.mehta@company.com", "Arjun Mehta"]]
        return _xlsx("template-name-mapping.xlsx", [("Mapping", rows, [34, 28])])
    cat = CATEGORY_BY_KEY.get(kind)
    if not cat:
        return jsonify(error="Unknown template"), 404
    rows = [["Email ID", "Score"], ["jane.doe@company.com", 85], ["arjun.mehta@company.com", 120]]
    return _xlsx(f"template-{kind.replace('_', '-')}.xlsx", [(cat["label"], rows, [34, 12])])


@admin.get("/api/export")
def admin_export():
    board, trend, versions = store.export_rows()
    n = len(CATEGORIES)
    return _xlsx(f"cyber-leaderboard-{date.today().isoformat()}.xlsx", [
        ("Leaderboard", board, [7, 28, 34, 12] + [16] * n + [12, 12]),
        ("Trend", trend, [12, 14, 16, 14] + [16] * n),
        ("Upload log", versions, [10, 20, 10, 12, 36, 26, 10, 12, 12]),
    ])


@admin.get("/api/unmapped")
def admin_unmapped():
    return _xlsx(f"unmapped-emails-{date.today().isoformat()}.xlsx", [("Mapping", store.unmapped_rows(), [34, 28])])


app.register_blueprint(admin)


# -------------------------------------------------------------------- main --

LOOPBACK = ("127.0.0.1", "localhost", "::1")


def banner():
    public_url = os.environ.get("PUBLIC_URL", "").rstrip("/")
    base = public_url
    if not base:
        all_interfaces = HOST in ("0.0.0.0", "::")  # nosec B104 - display only, not a bind
        base = f"http://{socket.gethostname() if all_interfaces else HOST}:{PORT}"
    # Show the secret only on an interactive console; service logs get a pointer instead.
    if sys.stdout.isatty() or _flag("SHOW_ADMIN_URL"):
        admin_url = f"{base}{ADMIN_PREFIX}/"
    else:
        admin_url = f"{base}{_redact(ADMIN_PREFIX)}/  (see it with: python scripts/admin_url.py)"
    line = "=" * 74
    print(f"\n{line}\n  CYBER SECURITY EMPLOYEE DASHBOARD\n{line}")
    print(f"  Leaderboard   : {base}/")
    print(f"  Admin console : {admin_url}")
    if ADMIN_PASSWORD:
        print("  Admin password: required (ADMIN_PASSWORD in .env)")
    print(f"  Data folder   : {DATA_DIR}")
    print("  Keep the admin URL private. Rotate it with: python scripts/admin_url.py --rotate")
    if HOST not in LOOPBACK and not public_url.startswith("https://"):
        print("  WARNING: serving the network over plain HTTP - the admin URL travels unencrypted.")
        print("           Put an HTTPS reverse proxy in front and set PUBLIC_URL=https://...")
    print(f"{line}\n", flush=True)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    banner()
    try:
        from waitress import serve
    except ImportError:
        log.warning("waitress is not installed; using the Flask development server (not for production).")
        app.run(host=HOST, port=PORT)
    else:
        # Cap request bodies in the server too: waitress otherwise buffers up to 1 GB
        # per request to disk before Flask's MAX_UPLOAD_MB check ever runs.
        try:
            serve(app, host=HOST, port=PORT, threads=8, ident="",
                  max_request_body_size=(MAX_UPLOAD_MB + 1) * 1024 * 1024)
        except OSError as e:
            if e.errno in (98, 10048) or getattr(e, "winerror", None) == 10048:  # address in use
                raise SystemExit(f"Port {PORT} is already in use. Close the other program or change PORT in .env.")
            raise


if __name__ == "__main__":
    main()
