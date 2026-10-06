"""Write realistic sample Excel files to ./sample-data for trying the admin console.

    python scripts/make_samples.py

Produces name-mapping.xlsx plus one file per category per sync date (cumulative
scores, meant for REPLACE mode). Upload the oldest date first, setting
"Data as of" to the date in the file name, to build up a trendline.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.categories import CATEGORIES          # noqa: E402
from core.demo_data import generate             # noqa: E402
from core.excel_io import build_workbook        # noqa: E402

OUT = ROOT / "sample-data"


def main():
    OUT.mkdir(exist_ok=True)
    directory, snapshots = generate()
    (OUT / "name-mapping.xlsx").write_bytes(
        build_workbook([("Mapping", [["Email ID", "Name"]] + [[e, n] for e, n in directory.items()], [34, 28])]))
    for as_of, cats in snapshots:
        for c in CATEGORIES:
            rows = [["Email ID", "Score"]] + [[e, s] for e, s in cats[c["key"]].items()]
            name = f"{as_of}_{c['key'].replace('_', '-')}.xlsx"
            (OUT / name).write_bytes(build_workbook([(c["label"], rows, [34, 10])]))
    print(f"Wrote {1 + len(snapshots) * len(CATEGORIES)} files to {OUT}")


if __name__ == "__main__":
    main()
