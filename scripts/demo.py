"""Run the dashboard against a throwaway ./demo-data store filled with synthetic history.

    python scripts/demo.py           # seeds on first run, then serves
    python scripts/demo.py --reseed  # wipe demo-data and seed again

Your real ./data folder and real admin URL are never used: the demo keeps its
own admin secret in demo-data/admin-secret.key.
"""
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = ROOT / "demo-data"
sys.path.insert(0, str(ROOT))

from core.secret import load_or_create_secret    # noqa: E402

if "--reseed" in sys.argv and DEMO_DIR.exists():
    shutil.rmtree(DEMO_DIR)
os.environ["DATA_DIR"] = str(DEMO_DIR)
os.environ.pop("ADMIN_SECRET", None)
os.environ["ADMIN_SECRET"] = load_or_create_secret(DEMO_DIR)  # real env vars win over .env

import app                                        # noqa: E402
from core.categories import CATEGORIES            # noqa: E402
from core.demo_data import generate               # noqa: E402
from core.excel_io import build_workbook, parse_mapping_file, parse_score_file  # noqa: E402


def seed(store):
    directory, snapshots = generate()
    xlsx = build_workbook([("Mapping", [["Email ID", "Name"]] + [[e, n] for e, n in directory.items()], [34, 28])])
    store.add_mapping_upload("merge", "name-mapping.xlsx", parse_mapping_file(xlsx), xlsx, actor="demo-seed")
    for as_of, cats in snapshots:
        for c in CATEGORIES:
            rows = [["Email ID", "Score"]] + [[e, s] for e, s in cats[c["key"]].items()]
            data = build_workbook([(c["label"], rows, [34, 10])])
            name = f"{as_of}_{c['key'].replace('_', '-')}.xlsx"
            store.add_score_upload(c["key"], "replace", as_of, name, parse_score_file(data), data,
                                   actor="demo-seed", uploaded_at=f"{as_of}T{9 + CATEGORIES.index(c):02d}:15:00")
    print(f"Seeded demo data: {len(directory)} names, {len(snapshots)} sync dates.")


if __name__ == "__main__":
    if not app.store.db["uploads"]:
        seed(app.store)
    app.main()
