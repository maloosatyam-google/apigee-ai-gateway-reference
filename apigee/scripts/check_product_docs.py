#!/usr/bin/env python3
"""Verify that the API product tables in the docs match the product JSON.

Motivation
----------
The product tables in docs/unified_credentials_and_products_reference.md drifted from
apigee/products/*.json in ways that were actively misleading, not merely stale:

  * The Standard table invented a second claude-haiku operation at 2000 tokens/minute,
    contradicting the Haiku demo cap (300 tokens/min) the whole token-quota demo depends on.
  * The Enterprise table omitted gemini-3.7-flash and gemini-3.8-flash entirely, so two
    entitled (and expensive) models read as unentitled.
  * The catalog table listed tier=/domain= attributes that had already been deleted, and
    that the same document's "Known Gaps" section said were deleted.

Those are the kind of errors that send someone debugging a problem that does not exist,
or believing a guardrail covers a model it does not. Docs describing entitlements are
load-bearing, so they get a test.

Usage
-----
    python3 apigee/scripts/check_product_docs.py          # verify
    python3 apigee/scripts/check_product_docs.py -v       # verify, listing every row

Exit code 0 when the docs match the products, 1 otherwise.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOC = ROOT / "docs" / "unified_credentials_and_products_reference.md"
PRODUCTS = ROOT / "apigee" / "products"

# Section heading -> product file
SECTIONS = {
    "### 2.1 Engineering & IT": "engineering_and_it.json",
    "### 2.2 Analysts & Knowledge Workers": "analysts_and_knowledge_workers.json",
    "### 2.3 Customer Support & Sales": "customer_support_and_sales.json",
}

VERBOSE = "-v" in sys.argv or "--verbose" in sys.argv
failures: list[str] = []


def clean(cell: str) -> str:
    """Strip markdown emphasis and code formatting from a table cell."""
    return cell.replace("**", "").replace("`", "").strip()


def product_rows(path: pathlib.Path) -> list[tuple[str, str, str]]:
    """(resource, model, limit) for each operationConfig, in file order."""
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for oc in data["llmOperationGroup"]["operationConfigs"]:
        quota = oc["llmTokenQuota"]
        for op in oc["llmOperations"]:
            rows.append((op["resource"], op["model"], str(quota["limit"])))
    return rows


def doc_rows(section_body: str) -> list[tuple[str, str, str]]:
    """(resource, model, limit) parsed from the first markdown table in the section."""
    rows = []
    for line in section_body.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [clean(c) for c in line.strip("|").split("|")]
        if len(cells) < 5:
            continue
        # skip the header and the |---|---| separator
        if cells[0] in ("#", "") or set(cells[1]) <= {"-", ":"}:
            continue
        if not cells[0].isdigit():
            continue
        rows.append((cells[1], cells[2], cells[3]))
    return rows


def section_text(doc: str, heading: str) -> str:
    start = doc.find(heading)
    if start == -1:
        failures.append(f"heading not found in the doc: {heading!r}")
        return ""
    nxt = doc.find("\n### ", start + len(heading))
    return doc[start : nxt if nxt != -1 else len(doc)]


def main() -> int:
    doc = DOC.read_text(encoding="utf-8")

    for heading, filename in SECTIONS.items():
        body = section_text(doc, heading)
        if not body:
            continue
        path = PRODUCTS / filename
        expected = product_rows(path)
        actual = doc_rows(body)

        print(f"--- {heading.removeprefix('### ')}  ({filename})")

        if actual != expected:
            failures.append(f"{filename}: doc table does not match the product")
            exp_set, act_set = set(expected), set(actual)
            for row in expected:
                if row not in act_set:
                    print(f"    MISSING FROM DOC : {row}")
            for row in actual:
                if row not in exp_set:
                    print(f"    NOT IN PRODUCT   : {row}")
            if exp_set == act_set and actual != expected:
                print("    same rows, different order")
        else:
            print(f"    {len(actual)} rows match")
            if VERBOSE:
                for r in actual:
                    print(f"      {r}")

        # The prose states the counts; keep those honest too.
        n_configs = len(expected)
        n_models = len({m for _, m, _ in expected})
        claim = re.search(
            r"\*\*(\d+) `operationConfigs` covering (\d+) distinct models\*\*", body
        )
        if not claim:
            failures.append(f"{filename}: could not find the operationConfigs count claim")
            print("    NO COUNT CLAIM FOUND")
        else:
            c_configs, c_models = int(claim.group(1)), int(claim.group(2))
            if (c_configs, c_models) != (n_configs, n_models):
                failures.append(f"{filename}: count claim wrong")
                print(
                    f"    COUNT CLAIM WRONG: doc says {c_configs} configs / {c_models} models, "
                    f"actual {n_configs} / {n_models}"
                )
            else:
                print(f"    count claim ok ({n_configs} configs, {n_models} models)")

    # The attribute table must not resurrect the deleted descriptive attributes.
    #
    # Scoped to table ROWS on purpose. The document legitimately names these attributes in
    # prose to explain that they were removed; a naive whole-document substring search
    # flagged that explanation as the very defect it documents. A check that fires on its
    # own rationale trains people to ignore it.
    table_lines = [ln for ln in doc.splitlines() if ln.lstrip().startswith("|")]
    for dead in ("tier=standard", "tier=enterprise", "domain=sales", "domain=loans",
                 "domain=enterprise"):
        hits = [ln for ln in table_lines if dead in ln]
        if hits:
            failures.append(f"a doc table lists the deleted attribute {dead!r}")
            print(f"--- DELETED ATTRIBUTE IN TABLE: {dead}")
            for h in hits:
                print(f"      {h.strip()[:120]}")

    # Every product's budget attribute must be documented with its real value.
    print("--- budget attributes")
    for filename in SECTIONS.values():
        data = json.loads((PRODUCTS / filename).read_text(encoding="utf-8"))
        attrs = {a["name"]: a["value"] for a in data.get("attributes", [])}
        limit = attrs.get("developer.budget.limit")
        if limit is None:
            failures.append(f"{filename}: no developer.budget.limit attribute")
            print(f"    {filename}: MISSING developer.budget.limit")
            continue
        if limit not in doc:
            failures.append(f"{filename}: budget limit {limit} not documented")
            print(f"    {filename}: limit {limit} NOT found in the doc")
        else:
            print(f"    {filename}: developer.budget.limit={limit} documented")

    print()
    if failures:
        print(f"FAIL — {len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — docs match the API products")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
