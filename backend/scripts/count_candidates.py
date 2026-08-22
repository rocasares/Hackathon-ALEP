import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.bank_csv import parse_bank_csv
from app.candidates import generate_candidate_groups
from app.models import Invoice

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")

with open(os.path.join(DATA_DIR, "invoices_ground_truth.json"), encoding="utf-8") as f:
    invoices = [Invoice(**d) for d in json.load(f)]

with open(os.path.join(DATA_DIR, "sample_bank_statement.csv"), "rb") as f:
    movements = parse_bank_csv(f.read())

groups = generate_candidate_groups(invoices, movements)
print(f"Total groups: {len(groups)}")
by_kind = {"1:1": 0, "N:1": 0, "1:N": 0}
for inv_list, mov_list in groups:
    if len(inv_list) == 1 and len(mov_list) == 1:
        by_kind["1:1"] += 1
    elif len(mov_list) == 1:
        by_kind["N:1"] += 1
    else:
        by_kind["1:N"] += 1
print(by_kind)
