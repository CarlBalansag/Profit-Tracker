"""Dev-only: build tax engine cross-check fixtures with Tax-Calculator (CC0).

Runs synthetic households (no real user data) through PSLmodels Tax-Calculator
and writes the federal results to test/fixtures/taxcalcOracle.json, which
test/taxEngineOracle.test.mjs compares against shared/tax.

Never runs in production. To regenerate:

    python -m venv .venv && .venv/Scripts/pip install taxcalc
    .venv/Scripts/python -I scripts/tax-oracle/generate_fixtures.py

Commit the regenerated JSON together with the engine or rule change it checks.
"""
import itertools
import json
import os

import pandas as pd
import taxcalc as tc

MARS = {'single': 1, 'mfj': 2, 'mfs': 3, 'hoh': 4}
YEARS = [2025, 2026]
BUSINESS = [-8000, 0, 433, 5000, 42000, 120000, 250000]
WAGES = [0, 35000, 95000, 190000]
KIDS = [0, 2]
AGE65 = [False, True]

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'fixtures', 'taxcalcOracle.json')


def cases():
    rid = 0
    for year, status, business, wages, kids, old in itertools.product(YEARS, MARS, BUSINESS, WAGES, KIDS, AGE65):
        if status == 'hoh' and kids == 0:
            continue  # head of household needs a qualifying person
        if status == 'single' and kids:
            continue
        rid += 1
        yield rid, dict(taxYear=year, filingStatus=status, businessProfit=business, wages=wages,
                        qualifyingChildren=kids, age65=old)


def run_year(year, rows):
    df = pd.DataFrame([{
        'RECID': rid, 'FLPDYR': year, 'MARS': MARS[c['filingStatus']],
        'XTOT': (2 if c['filingStatus'] == 'mfj' else 1) + c['qualifyingChildren'],
        'e00200': c['wages'], 'e00200p': c['wages'], 'e00200s': 0,
        'e00900': c['businessProfit'], 'e00900p': c['businessProfit'], 'e00900s': 0,
        'n24': c['qualifyingChildren'], 'nu18': c['qualifyingChildren'], 'nu06': 0,
        # EITC is out of scope for the engine; giving no EITC children does not
        # stop childless EITC, so the fixtures compare components, not iitax.
        'EIC': min(c['qualifyingChildren'], 3),
        'age_head': 70 if c['age65'] else 40, 'age_spouse': (70 if c['age65'] else 40) if c['filingStatus'] == 'mfj' else 0,
    } for rid, c in rows])
    records = tc.Records(data=df, start_year=year, gfactors=None, weights=None, adjust_ratios=None)
    calc = tc.Calculator(policy=tc.Policy(), records=records, verbose=False)
    calc.calc_all()
    out = calc.dataframe(['RECID', 'c00100', 'c04800', 'qbided', 'c05800', 'setax', 'ptax_amc'])
    return out.set_index('RECID').to_dict('index')


def main():
    all_cases = list(cases())
    fixtures = []
    for year in YEARS:
        rows = [(rid, c) for rid, c in all_cases if c['taxYear'] == year]
        results = run_year(year, rows)
        for rid, c in rows:
            r = results[rid]
            fixtures.append({'input': c, 'taxcalc': {
                'agi': round(float(r['c00100']), 2),
                'taxableIncome': round(float(r['c04800']), 2),
                'qbiDeduction': round(float(r['qbided']), 2),
                'incomeTaxBeforeCredits': round(float(r['c05800']), 2),
                'selfEmploymentTax': round(float(r['setax']), 2),
                'additionalMedicareTax': round(float(r['ptax_amc']), 2),
            }})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'generator': f'Tax-Calculator {tc.__version__} (PSLmodels, CC0)', 'cases': fixtures}, f, indent=1)
    print(f'wrote {len(fixtures)} cases to {OUT}')


if __name__ == '__main__':
    main()
