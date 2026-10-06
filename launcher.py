"""Install everything the dashboard needs, then start it.

    python launcher.py                  # set up (first run only) and start the server
    python launcher.py --reinstall      # force a reinstall of the Python packages
    python launcher.py --setup-only     # install / verify without starting
    python launcher.py --download-wheels  # save the packages to .\\wheels for offline installs

Steps:
  1. checks Python is 3.10 or newer
  2. creates the .venv virtual environment (first run)
  3. installs the pinned packages from requirements.txt into it, only when
     requirements.txt changed since the last install. If a "wheels" folder sits
     next to this file, packages come from there instead of the internet.
  4. creates .env from .env.example with a freshly generated admin secret (first run)
  5. starts app.py with the virtual environment's Python

Uses only the Python standard library, so it runs on a bare Python install.
StartDashboard.exe runs this same file (installing Python first if needed).
"""
import hashlib
import os
import re
import secrets
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQUIREMENTS = ROOT / "requirements.txt"
STAMP = VENV / ".requirements.sha256"
WHEELS = ROOT / "wheels"
MIN_PYTHON = (3, 10)
PAUSE = os.name == "nt" and "--no-pause" not in sys.argv  # keep a double-clicked window open on errors


def say(msg):
    print(f"[setup] {msg}", flush=True)


def pause():
    if PAUSE and sys.stdin and sys.stdin.isatty():
        try:
            input("\nPress Enter to close this window...")
        except EOFError:
            pass


def fail(msg):
    print(f"\n[setup] ERROR: {msg}\n", file=sys.stderr, flush=True)
    pause()
    sys.exit(1)


def venv_python():
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(cmd, what):
    if subprocess.run([str(c) for c in cmd], cwd=ROOT).returncode:
        fail(f"{what} failed. See the messages above (check the internet or proxy connection).")


def ensure_venv():
    py = venv_python()
    if py.exists():
        if subprocess.run([str(py), "-c", "import sys"], capture_output=True).returncode == 0:
            return py
        say("The existing .venv no longer works (was Python reinstalled?). Recreating it...")
        shutil.rmtree(VENV)
    say("Creating the Python virtual environment (.venv)...")
    venv.EnvBuilder(with_pip=True).create(VENV)
    return venv_python()


def ensure_packages(py, force=False):
    digest = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    if not force and STAMP.exists() and STAMP.read_text().strip() == digest:
        return
    pip = [py, "-m", "pip", "--disable-pip-version-check", "install", "--require-virtualenv"]
    if WHEELS.is_dir():
        say(f"Installing packages offline from the '{WHEELS.name}' folder...")
        pip += ["--no-index", "--find-links", WHEELS]
    else:
        say("Installing packages (first run, or requirements.txt changed)...")
        run(pip + ["--upgrade", "pip"], "Updating pip")
    run(pip + ["-r", REQUIREMENTS], "Installing the required packages")
    run([py, "-c", "import flask, openpyxl, waitress, defusedxml"], "Checking the installed packages")
    STAMP.write_text(digest)
    say("Packages ready.")


def ensure_env_file():
    env, example = ROOT / ".env", ROOT / ".env.example"
    if env.exists() or not example.exists():
        return
    secret = secrets.token_urlsafe(36)
    text = re.sub(r"^ADMIN_SECRET=.*$", lambda _m: f"ADMIN_SECRET={secret}",
                  example.read_text(encoding="utf-8"), count=1, flags=re.M)
    env.write_text(text, encoding="utf-8")
    say("Created .env with a new random admin URL secret.")


def download_wheels(py):
    WHEELS.mkdir(exist_ok=True)
    run([py, "-m", "pip", "--disable-pip-version-check", "download", "--only-binary=:all:",
         "-d", WHEELS, "-r", REQUIREMENTS], "Downloading packages")
    say(f"Saved packages to {WHEELS}. Copy the whole folder to the offline server;")
    say("launcher.py installs from it automatically. Use the same Python version there.")


def start(py):
    say("Starting the dashboard. Keep this window open; press Ctrl+C to stop.")
    proc = subprocess.Popen([str(py), str(ROOT / "app.py")], cwd=ROOT)
    try:
        return proc.wait()
    except KeyboardInterrupt:
        try:
            return proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.terminate()
            return 0


def main():
    if sys.version_info < MIN_PYTHON:
        fail(f"Python {'.'.join(map(str, MIN_PYTHON))} or newer is required "
             f"(this is {sys.version.split()[0]}). Install it from https://www.python.org/downloads/")
    args = sys.argv[1:]
    py = ensure_venv()
    if "--download-wheels" in args:
        download_wheels(py)
        return 0
    ensure_packages(py, force="--reinstall" in args)
    ensure_env_file()
    if "--setup-only" in args:
        say("Setup complete.")
        return 0
    code = start(py)
    if code:
        say(f"The server stopped with exit code {code}.")
        pause()
    return code


if __name__ == "__main__":
    sys.exit(main())
