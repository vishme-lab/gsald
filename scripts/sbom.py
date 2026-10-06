"""Generate the software bill of materials and third-party notices.

    .venv\\Scripts\\python scripts\\sbom.py

Reads the packages installed in the running environment (use the project's
.venv), keeps only the runtime dependency tree reachable from requirements.txt,
and writes:
    security/sbom.cdx.json          CycloneDX 1.5 SBOM
    security/THIRD_PARTY_NOTICES.md license summary plus the full license texts
The bundled web fonts in static/fonts are listed file by file with SHA-256 hashes.
Standard library only.
"""
import datetime
import hashlib
import importlib.metadata as md
import json
import re
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "security"
APP = {"name": "cyber-security-employee-dashboard", "version": "1.0.0"}

# SPDX ids for packages whose metadata only carries a free-text license name
# (each checked against the license file shipped in the package).
SPDX = {
    "blinker": "MIT", "click": "BSD-3-Clause", "defusedxml": "PSF-2.0", "et-xmlfile": "MIT",
    "flask": "BSD-3-Clause", "itsdangerous": "BSD-3-Clause", "jinja2": "BSD-3-Clause",
    "markupsafe": "BSD-3-Clause", "openpyxl": "MIT", "waitress": "ZPL-2.1", "werkzeug": "BSD-3-Clause",
}
# Web fonts bundled in static/fonts (self-hosted copies of the Google Fonts releases).
FONT_DIR = ROOT / "static" / "fonts"
FONTS = {"orbitron": ("Orbitron", "OFL-Orbitron.txt", "https://github.com/theleagueof/orbitron"),
         "rajdhani": ("Rajdhani", "OFL-Rajdhani.txt", "https://github.com/itfoundry/rajdhani"),
         "jetbrainsmono": ("JetBrains Mono", "OFL-JetBrainsMono.txt", "https://github.com/JetBrains/JetBrainsMono")}


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_names(lines):
    for line in lines:
        line = line.split("#", 1)[0].strip()
        if line and "extra ==" not in line:
            yield norm(re.split(r"[\s;<>=!~\[(]", line, maxsplit=1)[0])


def closure():
    top = list(requirement_names((ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()))
    dists, edges, todo = {}, {}, list(top)
    while todo:
        name = todo.pop()
        if name in dists:
            continue
        try:
            dist = md.distribution(name)
        except md.PackageNotFoundError:
            sys.exit(f"{name} is not installed - run this with the project's .venv Python.")
        dists[name] = dist
        deps = [d for d in requirement_names(dist.requires or []) if _applies(dist, d)]
        edges[name] = deps
        todo.extend(deps)
    return top, dists, edges


def _applies(dist, dep):
    """Drop dependencies whose environment marker excludes this platform."""
    for req in dist.requires or []:
        if norm(re.split(r"[\s;<>=!~\[(]", req, maxsplit=1)[0]) == dep:
            if ";" not in req:
                return True
            try:
                return md.distribution(dep) is not None
            except md.PackageNotFoundError:
                return False
    return True


def license_of(name, dist):
    meta = dist.metadata
    return meta.get("License-Expression") or SPDX.get(name) or meta.get("License") or "UNKNOWN"


def license_texts(dist):
    texts = []
    for f in dist.files or []:
        if re.search(r"(LICEN[CS]E|COPYING|NOTICE)[^/\\]*$", str(f), re.I) and "_vendor" not in str(f):
            try:
                texts.append((Path(str(f)).name, f.read_text(encoding="utf-8")))
            except (OSError, UnicodeDecodeError):
                pass
    return texts


def homepage(dist):
    meta = dist.metadata
    for url in meta.get_all("Project-URL") or []:
        label, _, link = url.partition(",")
        if label.strip().lower() in ("source", "source code", "homepage", "home", "repository"):
            return link.strip()
    return meta.get("Home-page") or f"https://pypi.org/project/{dist.metadata['Name']}/"


def main():
    top, dists, edges = closure()
    OUT.mkdir(exist_ok=True)
    ref = lambda n: f"pkg:pypi/{n}@{dists[n].version}"
    components = []
    for name in sorted(dists):
        d = dists[name]
        components.append({
            "type": "library", "bom-ref": ref(name), "name": d.metadata["Name"], "version": d.version,
            "purl": ref(name), "scope": "required",
            "licenses": [{"license": {"id": license_of(name, d)}}],
            "externalReferences": [{"type": "website", "url": homepage(d)}],
        })
    font_refs = []
    for f in sorted(FONT_DIR.glob("*.woff2")):
        family, _, url = FONTS[f.name.split("-", 1)[0]]
        font_refs.append(f"file:static/fonts/{f.name}")
        components.append({
            "type": "file", "bom-ref": font_refs[-1], "group": family, "name": f"static/fonts/{f.name}",
            "scope": "required", "description": f"{family} web font (WOFF2), bundled",
            "hashes": [{"alg": "SHA-256", "content": hashlib.sha256(f.read_bytes()).hexdigest()}],
            "licenses": [{"license": {"id": "OFL-1.1"}}], "externalReferences": [{"type": "website", "url": url}],
        })
    bom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "serialNumber": f"urn:uuid:{uuid.uuid4()}", "version": 1,
        "metadata": {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "tools": {"components": [{"type": "application", "name": "scripts/sbom.py"}]},
            "component": {"type": "application", "bom-ref": "app", **APP},
            "properties": [{"name": "python", "value": sys.version.split()[0]}],
        },
        "components": components,
        "dependencies": [{"ref": "app", "dependsOn": [ref(n) for n in top] + font_refs}]
                        + [{"ref": ref(n), "dependsOn": sorted(ref(d) for d in edges[n])} for n in sorted(dists)],
    }
    (OUT / "sbom.cdx.json").write_text(json.dumps(bom, indent=2) + "\n", encoding="utf-8")

    lines = ["# Third-party notices", "",
             f"Runtime dependencies of {APP['name']} {APP['version']}, generated by `scripts/sbom.py` "
             f"on {datetime.date.today().isoformat()}. All licenses are permissive (no copyleft).", "",
             "| Component | Version | License | Kind |", "|---|---|---|---|"]
    for name in sorted(dists):
        d = dists[name]
        kind = "direct" if name in top else "transitive"
        lines.append(f"| {d.metadata['Name']} | {d.version} | {license_of(name, d)} | {kind} |")
    for family, _, _ in FONTS.values():
        lines.append(f"| {family} (web font, bundled in static/fonts) | - | OFL-1.1 | bundled |")
    lines += ["", "The fonts are redistributed unmodified under the SIL Open Font License 1.1; "
              "their license texts are in static/fonts/OFL-*.txt and repeated below.", ""]
    for name in sorted(dists):
        d = dists[name]
        for fname, text in license_texts(d):
            lines += [f"## {d.metadata['Name']} {d.version} - {fname}", "", "```", text.strip(), "```", ""]
    for family, ofl, _ in FONTS.values():
        lines += [f"## {family} (font) - {ofl}", "", "```", (FONT_DIR / ofl).read_text(encoding="utf-8").strip(), "```", ""]
    (OUT / "THIRD_PARTY_NOTICES.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote security/sbom.cdx.json ({len(components)} components) and security/THIRD_PARTY_NOTICES.md")


if __name__ == "__main__":
    main()
