"""Synthetic demo data: an email -> name directory plus cumulative category
scores over several sync dates. Used by scripts/make_samples.py (writes Excel
files you can upload by hand) and scripts/demo.py (seeds a throwaway store).
All addresses use the reserved example.com domain."""
import random
from datetime import date, timedelta

from .categories import CATEGORIES

FIRST = ("Aarav Priya Rahul Ananya Vikram Sneha Arjun Kavya Rohan Meera Aditya Isha Karan Neha Siddharth Pooja "
         "Nikhil Divya Amit Riya James Emma Liam Olivia Noah Sophia Lucas Mia Ethan Ava Wei Mei Hiro Yuki Omar "
         "Layla Mateo Lucia Fatima Kwame Chen Sara Daniel Elena Ivan Nadia Diego Zara Tariq Hana Farhan Anjali "
         "Rajesh Lakshmi Suresh Deepa Manoj Swati Gaurav Tanvi").split()
LAST = ("Sharma Patel Iyer Reddy Nair Gupta Singh Menon Rao Kapoor Joshi Das Bose Kulkarni Chopra Mehta Smith "
        "Johnson Garcia Kim Nguyen Chen Tanaka Silva Okafor Ali Haddad Novak Rossi Fischer Martin Lopez Khan "
        "Mensah Ivanova Banerjee Pillai Verma Desai Saxena").split()

# Per-category ceiling of the cumulative score and how likely people engage with it.
PROFILE = {
    "online_games":        (160, 0.85),
    "case_study":          (110, 0.55),
    "annual_awareness":    (100, 0.90),
    "exceptions":          (45,  0.35),
    "suspicious_activity": (70,  0.40),
    "phishing_mail":       (130, 0.75),
}


def generate(people=260, rounds=5, end=None, seed=2026):
    rng = random.Random(seed)  # nosec B311 - synthetic sample data, not security-relevant
    end = end or date.today()
    dates = [(end - timedelta(days=rounds - 1 - r)).isoformat() for r in range(rounds)]

    names, used = {}, set()
    while len(names) < people:
        first, last = rng.choice(FIRST), rng.choice(LAST)
        base = f"{first}.{last}".lower()
        email, k = f"{base}@example.com", 2
        while email in used:
            email, k = f"{base}{k}@example.com", k + 1
        used.add(email)
        names[email] = f"{first} {last}"

    emails = list(names)
    drive = {e: rng.betavariate(2.2, 2.0) for e in emails}       # how engaged each person is
    totals = {c["key"]: {} for c in CATEGORIES}
    snapshots = []
    for r in range(rounds):
        ramp = (r + 1) / rounds
        for c in CATEGORIES:
            k = c["key"]
            ceiling, reach = PROFILE[k]
            for e in emails:
                if e not in totals[k] and rng.random() > reach * drive[e] * (0.35 + 0.65 * ramp):
                    continue
                if k == "annual_awareness":                      # module completion: 50 or 100
                    totals[k][e] = 100 if (totals[k].get(e) == 50 or rng.random() < drive[e]) else 50
                    continue
                step = ceiling / rounds * (0.25 + 1.1 * drive[e] * rng.random())
                totals[k][e] = min(ceiling, round(totals[k].get(e, 0) + step))
        snapshots.append((dates[r], {k: dict(v) for k, v in totals.items()}))

    # Leave some people without a mapped name so the "unmapped" tooling has something to show.
    directory = {e: n for e, n in names.items() if rng.random() > 0.06}
    return directory, snapshots
