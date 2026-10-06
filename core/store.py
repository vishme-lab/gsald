"""Persistent score store with full history.

Every uploaded sheet is kept forever as an immutable "version" (db.json holds
the parsed rows; data/uploads/ holds the original file). The leaderboard is
derived by replaying the versions in order:

  * mode "replace": the file is the complete, latest standing for that
    category - it overwrites the category (people missing from it drop to 0).
  * mode "add": the file holds new points that are added on top.

Versions are grouped by their "as of" date into sync points. After each sync
point every active employee is ranked, which gives each person a score and
rank trendline, and the organisation an overall trend.
"""
import hashlib
import itertools
import json
import os
import re
import secrets
import shutil
import threading
import time
from array import array
from collections import deque
from datetime import datetime
from pathlib import Path

from .categories import CATEGORIES, CATEGORY_BY_KEY, CATEGORY_KEYS
from .excel_io import round2

SCHEMA = 1
TOP_N = 10
FEED_SIZE = 14


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def derive_name(email):
    """Best-effort display name for an email that has no mapping yet."""
    local = email.split("@", 1)[0]
    parts = [p for p in re.split(r"[._\-+\s]+", re.sub(r"\d+", " ", local)) if p]
    return " ".join(p.capitalize() for p in parts) or local


def mask_email(email):
    local, _, domain = email.partition("@")
    keep = local[:2] if len(local) > 3 else local[:1]
    return f"{keep}•••@{domain}"


def _public_row(p):
    return {"id": p["id"], "rank": p["rank"] or None, "name": p["name"], "score": p["score"],
            "delta": p["delta"], "new": p["new"], "breakdown": p["breakdown"]}


class View:
    """Everything derived from the raw db, rebuilt after each change. Treated as read-only."""
    __slots__ = ("people", "by_id", "names", "points", "summary", "cat_stats", "rev")


class Store:
    def __init__(self, data_dir):
        self.dir = Path(data_dir)
        self.file = self.dir / "db.json"
        self.uploads_dir = self.dir / "uploads"
        self.backups_dir = self.dir / "backups"
        self.audit_file = self.dir / "audit.log"
        for d in (self.dir, self.uploads_dir, self.backups_dir):
            d.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.db = self._load()
        self.view = self._build(self.db)

    # ------------------------------------------------------------ storage --

    @staticmethod
    def _empty():
        return {"schema": SCHEMA, "salt": secrets.token_hex(16), "rev": 0, "seq": 0,
                "created_at": now_iso(), "updated_at": None, "uploads": [], "mappings": []}

    def _load(self):
        if not self.file.exists():
            db = self._empty()
            self._write(db)
            return db
        with open(self.file, encoding="utf-8") as f:
            db = json.load(f)
        for k, v in self._empty().items():
            db.setdefault(k, v)
        return db

    def _write(self, db):
        tmp = self.file.with_name(self.file.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(db, f, separators=(",", ":"), ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        for attempt in range(10):  # Windows: antivirus/indexer can briefly lock the target
            try:
                os.replace(tmp, self.file)
                return
            except PermissionError:
                time.sleep(0.05 * (attempt + 1))
        os.replace(tmp, self.file)

    def _commit(self, db, action, detail, actor):
        db["rev"] += 1
        db["updated_at"] = now_iso()
        view = self._build(db)  # build first: a failure leaves the old state untouched
        self._write(db)
        self.db, self.view = db, view
        self._audit(action, detail, actor)

    def _audit(self, action, detail, actor):
        line = json.dumps({"at": now_iso(), "action": action, "detail": detail, "by": actor or ""}, ensure_ascii=False)
        with open(self.audit_file, "a", encoding="utf-8") as f:
            f.write(line + "\n")

    def audit_tail(self, n=40):
        if not self.audit_file.exists():
            return []
        with open(self.audit_file, encoding="utf-8") as f:
            lines = deque(f, maxlen=n)
        out = []
        for line in reversed(lines):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
        return out

    def _archive(self, rec_id, file_name, raw):
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file_name or "upload")[-80:]
        name = f"{rec_id}__{safe}"
        (self.uploads_dir / name).write_bytes(raw)
        return name

    # ---------------------------------------------------------- mutations --

    def add_score_upload(self, category, mode, as_of, file_name, parsed, raw, actor=None, uploaded_at=None):
        with self._lock:
            db = dict(self.db)
            db["seq"] += 1
            rec_id = f"S{db['seq']:05d}"
            rec = {
                "id": rec_id, "seq": db["seq"], "category": category, "mode": mode, "as_of": as_of,
                "file_name": file_name, "uploaded_at": uploaded_at or now_iso(), "by": actor or "",
                "sheet": parsed["sheet"], "columns": parsed["columns"],
                "rows": parsed["rows"], "people": parsed["people"], "total": parsed["total"],
                "skipped": parsed["skipped"], "duplicates": parsed["duplicates"],
                "archive": self._archive(rec_id, file_name, raw),
                "scores": parsed["scores"],
            }
            db["uploads"] = db["uploads"] + [rec]
            label = CATEGORY_BY_KEY[category]["label"]
            self._commit(db, "upload", f"{label}: {file_name} ({parsed['people']} people, {mode}, as of {as_of})", actor)
            unmapped = sum(1 for e in parsed["scores"] if e not in self.view.names)
            return {**self._upload_meta(rec), "unmapped": unmapped}

    def add_mapping_upload(self, mode, file_name, parsed, raw, actor=None):
        with self._lock:
            db = dict(self.db)
            db["seq"] += 1
            rec_id = f"M{db['seq']:05d}"
            rec = {
                "id": rec_id, "seq": db["seq"], "mode": mode, "file_name": file_name,
                "uploaded_at": now_iso(), "by": actor or "", "sheet": parsed["sheet"],
                "columns": parsed["columns"], "rows": parsed["rows"], "people": parsed["people"],
                "skipped": parsed["skipped"], "duplicates": parsed["duplicates"],
                "archive": self._archive(rec_id, file_name, raw), "names": parsed["names"],
            }
            db["mappings"] = db["mappings"] + [rec]
            self._commit(db, "mapping", f"Name mapping: {file_name} ({parsed['people']} names, {mode})", actor)
            return self._mapping_meta(rec)

    def delete_version(self, rec_id, actor=None):
        with self._lock:
            db = dict(self.db)
            for key in ("uploads", "mappings"):
                hit = next((r for r in db[key] if r["id"] == rec_id), None)
                if hit:
                    db[key] = [r for r in db[key] if r["id"] != rec_id]
                    what = CATEGORY_BY_KEY[hit["category"]]["label"] if key == "uploads" else "Name mapping"
                    self._commit(db, "delete", f"Removed {what} version {rec_id} ({hit['file_name']})", actor)
                    return True
            return False

    def purge(self, actor=None):
        with self._lock:
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup = self.backups_dir / f"db-{stamp}.json"
            shutil.copy2(self.file, backup)
            db = self._empty()
            db["rev"] = self.db["rev"]
            self._commit(db, "purge", f"All scores and mappings cleared (backup: backups/{backup.name})", actor)
            return backup.name

    # ------------------------------------------------------------ derive --

    def _build(self, db):
        salt = db["salt"]

        names = {}
        for m in sorted(db["mappings"], key=lambda m: m["seq"]):
            if m["mode"] == "replace":
                names = {}
            names.update(m["names"])

        uploads = sorted(db["uploads"], key=lambda u: (u["as_of"], u["seq"]))
        universe = set(names)
        for u in uploads:
            universe.update(u["scores"])
        emails = sorted(universe)
        idx = {e: i for i, e in enumerate(emails)}
        n = len(emails)

        totals = [0.0] * n
        member = [0] * n                      # how many categories currently hold this person
        state = {k: {} for k in CATEGORY_KEYS}
        cat_sum = dict.fromkeys(CATEGORY_KEYS, 0.0)
        points = []

        for as_of, group in itertools.groupby(uploads, key=lambda u: u["as_of"]):
            group = list(group)
            for u in group:
                k = u["category"]
                st = state[k]
                if u["mode"] == "replace":
                    for e, v in st.items():
                        i = idx[e]
                        totals[i] -= v
                        member[i] -= 1
                    st = state[k] = {}
                    cat_sum[k] = 0.0
                for e, v in u["scores"].items():
                    i = idx[e]
                    if e not in st:
                        member[i] += 1
                    st[e] = st.get(e, 0.0) + v
                    totals[i] += v
                    cat_sum[k] += v

            scores = array("d", (round2(t) for t in totals))
            active = sorted((i for i in range(n) if member[i] > 0), key=lambda i: -scores[i])
            ranks = array("i", [0]) * n
            prev, rank = None, 0
            for pos, i in enumerate(active, 1):     # competition ranking: 1, 2, 2, 4
                if scores[i] != prev:
                    rank, prev = pos, scores[i]
                ranks[i] = rank
            total = round2(sum(scores[i] for i in active))
            points.append({
                "date": as_of, "scores": scores, "ranks": ranks, "active": len(active), "total": total,
                "avg": round2(total / len(active)) if active else 0.0,
                "cats": {k: round2(v) for k, v in cat_sum.items()},
            })

        last = points[-1] if points else None
        before = points[-2] if len(points) > 1 else None
        people = []
        for i, e in enumerate(emails):
            rank = last["ranks"][i] if last else 0
            prev_rank = before["ranks"][i] if before else 0
            name = names.get(e) or derive_name(e)
            people.append({
                "i": i, "email": e, "name": name, "mapped": e in names,
                "id": hashlib.sha256((salt + e).encode()).hexdigest()[:16],
                "score": last["scores"][i] if last else 0.0, "rank": rank,
                "delta": (prev_rank - rank) if (rank and prev_rank) else None,
                "new": bool(rank and before and not prev_rank),
                "breakdown": {k: round2(state[k].get(e, 0.0)) for k in CATEGORY_KEYS},
                "hay": name.lower(),
            })
        people.sort(key=lambda p: (p["rank"] == 0, p["rank"], p["name"].lower()))

        view = View()
        view.rev = db["rev"]
        view.people = people
        view.by_id = {p["id"]: p for p in people}
        view.names = names
        view.points = points
        view.cat_stats = {
            k: {"total": round2(cat_sum[k]), "participants": len(state[k]),
                "max": round2(max(state[k].values(), default=0.0)),
                "versions": sum(1 for u in uploads if u["category"] == k)}
            for k in CATEGORY_KEYS
        }
        view.summary = self._summary(db, view, uploads)
        return view

    def _summary(self, db, view, uploads):
        ranked = [p for p in view.people if p["rank"]]
        last = view.points[-1] if view.points else None
        stamps = [u["uploaded_at"] for u in db["uploads"]] + [m["uploaded_at"] for m in db["mappings"]]
        feed = sorted(db["uploads"], key=lambda u: u["seq"], reverse=True)[:FEED_SIZE]
        return {
            "rev": db["rev"],
            "last_sync": max(stamps) if stamps else None,
            "as_of": last["date"] if last else None,
            "categories": [{**c, **view.cat_stats[c["key"]]} for c in CATEGORIES],
            "stats": {
                "enrolled": len(view.people),
                "mapped": len(view.names),
                "active": len(ranked),
                "total_points": last["total"] if last else 0.0,
                "avg_score": last["avg"] if last else 0.0,
                "top_score": ranked[0]["score"] if ranked else 0.0,
                "syncs": len(view.points),
            },
            "trend": [{"date": p["date"], "total": p["total"], "active": p["active"], "avg": p["avg"], "cats": p["cats"]}
                      for p in view.points],
            "top": [_public_row(p) for p in ranked[:TOP_N]],
            "feed": [{"category": u["category"], "people": u["people"], "total": u["total"], "mode": u["mode"],
                      "as_of": u["as_of"], "at": u["uploaded_at"]} for u in feed],
        }

    # ----------------------------------------------------------- queries --

    def summary(self):
        return self.view.summary

    def search(self, query, limit=25):
        """Name search, or an exact email lookup. Email substrings are deliberately
        not matched so the public endpoint can't be used to enumerate addresses."""
        view = self.view
        q = query.lower().strip()
        if "@" in q:
            hits = [p for p in view.people if p["email"] == q]
        else:
            tokens = q.split()
            hits = [p for p in view.people if all(t in p["hay"] for t in tokens)]
        return {"query": query, "count": len(hits),
                "results": [{**_public_row(p), "hint": mask_email(p["email"])} for p in hits[:limit]]}

    def employee(self, pid):
        view = self.view
        p = view.by_id.get(pid)
        if not p:
            return None
        history, started = [], False
        for pt in view.points:
            rank, score = pt["ranks"][p["i"]], pt["scores"][p["i"]]
            started = started or bool(rank) or score != 0
            if started:
                history.append({"date": pt["date"], "score": score, "rank": rank or None, "of": pt["active"]})
        return {**_public_row(p), "hint": mask_email(p["email"]), "history": history,
                "of": view.summary["stats"]["active"]}

    # ------------------------------------------------------------- admin --

    @staticmethod
    def _upload_meta(u):
        return {k: u[k] for k in ("id", "category", "mode", "as_of", "file_name", "uploaded_at", "by", "sheet",
                                  "columns", "rows", "people", "total", "skipped", "duplicates")}

    @staticmethod
    def _mapping_meta(m):
        return {k: m[k] for k in ("id", "mode", "file_name", "uploaded_at", "by", "sheet", "columns",
                                  "rows", "people", "skipped", "duplicates")}

    def admin_state(self):
        db, view = self.db, self.view
        cats = []
        for c in CATEGORIES:
            k = c["key"]
            versions = sorted((u for u in db["uploads"] if u["category"] == k), key=lambda u: u["seq"], reverse=True)
            cats.append({**c, **view.cat_stats[k],
                         "history": [{"date": p["date"], "total": p["cats"][k]} for p in view.points],
                         "versions": [self._upload_meta(u) for u in versions]})
        scored = [p for p in view.people if p["rank"]]
        return {
            "rev": db["rev"], "updated_at": db["updated_at"],
            "stats": {**view.summary["stats"], "unmapped": sum(1 for p in scored if not p["mapped"])},
            "categories": cats,
            "mapping": {"mapped": len(view.names),
                        "versions": [self._mapping_meta(m) for m in sorted(db["mappings"], key=lambda m: m["seq"], reverse=True)]},
            "audit": self.audit_tail(),
        }

    def export_rows(self):
        view = self.view
        header = ["Rank", "Name", "Email ID", "Total Score"] + [c["label"] for c in CATEGORIES] + ["Rank Change", "Name Mapped"]
        rows = [header]
        for p in view.people:
            rows.append([p["rank"] or "", p["name"], p["email"], p["score"]]
                        + [p["breakdown"][k] for k in CATEGORY_KEYS]
                        + [p["delta"] if p["delta"] is not None else "", "Yes" if p["mapped"] else "No"])
        trend = [["As of", "Total Points", "Active Employees", "Average Score"] + [c["label"] for c in CATEGORIES]]
        for pt in view.points:
            trend.append([pt["date"], pt["total"], pt["active"], pt["avg"]] + [pt["cats"][k] for k in CATEGORY_KEYS])
        log = [["Version", "Category", "Mode", "As of", "File", "Uploaded at", "People", "Total", "Skipped rows"]]
        for u in sorted(self.db["uploads"], key=lambda u: u["seq"]):
            log.append([u["id"], CATEGORY_BY_KEY[u["category"]]["label"], u["mode"], u["as_of"], u["file_name"],
                        u["uploaded_at"], u["people"], u["total"], u["skipped"]])
        return rows, trend, log

    def unmapped_rows(self):
        rows = [["Email ID", "Name"]]
        rows += [[p["email"], ""] for p in self.view.people if not p["mapped"]]
        return rows
