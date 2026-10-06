"""Minimal .env loader (no extra dependency).

Reads KEY=VALUE lines from the project's .env file into os.environ.
Variables already set in the real environment take precedence over the file,
and empty values are ignored so the built-in defaults apply.
"""
import os
import re
from pathlib import Path


def load_env(path):
    path = Path(path)
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, sep, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = value.split(" #", 1)[0].rstrip()  # allow trailing comments on unquoted values
        if value:
            os.environ.setdefault(key, value)


def set_env_value(path, key, value):
    """Set KEY=value in the .env file, replacing the active line for KEY or appending one."""
    path = Path(path)
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.is_file() else []
    active = re.compile(rf"^\s*(export\s+)?{re.escape(key)}\s*=")
    for i, line in enumerate(lines):
        if active.match(line):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def resolve_dir(value, base):
    """A directory setting, relative paths taken from the project folder."""
    p = Path(value)
    return (p if p.is_absolute() else Path(base) / p).resolve()
