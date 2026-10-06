"""The admin console lives under an unguessable URL: /<ADMIN_PATH_PREFIX>/<ADMIN_SECRET>/

Both parts come from the .env file (or real environment variables):
  ADMIN_PATH_PREFIX  readable first part of the path (default "ops")
  ADMIN_SECRET       the long random part, 24-128 URL-safe characters. If unset,
                     one is generated on first start and kept in data/admin-secret.key.
"""
import os
import re
import secrets
from pathlib import Path

VALID = re.compile(r"[A-Za-z0-9_-]{24,128}")
PREFIX_VALID = re.compile(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*")
RESERVED = {"api", "static"}
DEFAULT_PREFIX = "ops"
KEY_FILE = "admin-secret.key"


def new_secret():
    return secrets.token_urlsafe(36)  # 48 characters


def load_or_create_secret(data_dir, rotate=False):
    env = os.environ.get("ADMIN_SECRET", "").strip()
    if env and not rotate:
        if not VALID.fullmatch(env):
            raise SystemExit("ADMIN_SECRET must be 24-128 characters of A-Z, a-z, 0-9, '_' or '-'. Check the .env file.")
        return env
    path = Path(data_dir) / KEY_FILE
    if not rotate and path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if VALID.fullmatch(value):
            return value
    value = new_secret()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return value


def admin_prefix():
    raw = os.environ.get("ADMIN_PATH_PREFIX", DEFAULT_PREFIX).strip().strip("/") or DEFAULT_PREFIX
    if len(raw) > 100 or not PREFIX_VALID.fullmatch(raw) or raw.split("/")[0].lower() in RESERVED:
        raise SystemExit("ADMIN_PATH_PREFIX may use letters, digits, '-', '_' and '/', and must not start "
                         "with 'api' or 'static'. Check the .env file.")
    return raw


def admin_path(secret):
    return f"/{admin_prefix()}/{secret}"
