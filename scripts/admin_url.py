"""Print (or rotate) the secret admin console URL.

    python scripts/admin_url.py            # print it
    python scripts/admin_url.py --rotate   # new random ADMIN_SECRET, then restart the server

Reads PORT, HOST, PUBLIC_URL, DATA_DIR, ADMIN_PATH_PREFIX and ADMIN_SECRET from
.env / the environment, like app.py. --rotate rewrites ADMIN_SECRET in .env when
it is set there; otherwise it replaces data/admin-secret.key.
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.env import load_env, resolve_dir, set_env_value      # noqa: E402
from core.secret import admin_path, load_or_create_secret, new_secret  # noqa: E402


def main():
    env_file = ROOT / ".env"
    in_system_env = bool(os.environ.get("ADMIN_SECRET"))
    load_env(env_file)
    data_dir = resolve_dir(os.environ.get("DATA_DIR") or "data", ROOT)
    rotate = "--rotate" in sys.argv

    if rotate and in_system_env:
        sys.exit("ADMIN_SECRET is set as a system environment variable; change it there instead.")
    if rotate and os.environ.get("ADMIN_SECRET"):
        secret = new_secret()
        set_env_value(env_file, "ADMIN_SECRET", secret)
    else:
        secret = load_or_create_secret(data_dir, rotate=rotate)

    base = os.environ.get("PUBLIC_URL", "").rstrip("/") or \
        f"http://{os.environ.get('HOST', '127.0.0.1')}:{os.environ.get('PORT', '8000')}"
    print(f"{base}{admin_path(secret)}/")
    if rotate:
        print("New admin URL generated. Restart the server for it to take effect; the old URL stops working.")


if __name__ == "__main__":
    main()
