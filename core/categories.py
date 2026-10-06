"""The six scored activity streams.

Order here is the display order everywhere: admin boxes, breakdown rows,
radar axes, stacked bars and exports. Each category keeps its color on every
view so people can recognise it at a glance.
"""

CATEGORIES = [
    {"key": "online_games",        "label": "Online Games",        "code": "GAMES", "color": "#22e6ff"},
    {"key": "case_study",          "label": "Case Study",          "code": "CASE",  "color": "#a77bff"},
    {"key": "annual_awareness",    "label": "Annual Awareness",    "code": "AWARE", "color": "#4dff9a"},
    {"key": "exceptions",          "label": "Exceptions",          "code": "EXCPT", "color": "#ffc23d"},
    {"key": "suspicious_activity", "label": "Suspicious Activity", "code": "SUSP",  "color": "#ff5c7a"},
    {"key": "phishing_mail",       "label": "Phishing Mail",       "code": "PHISH", "color": "#ff3df0"},
]

CATEGORY_KEYS = [c["key"] for c in CATEGORIES]
CATEGORY_BY_KEY = {c["key"]: c for c in CATEGORIES}
