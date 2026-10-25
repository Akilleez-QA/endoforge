#!/usr/bin/env python3
"""Check the Endoforge documentation against docs/CONVENTIONS.md.

Run from the repository root:  python3 -I tools/check-docs.py [--strict]

Checks (each failure is printed as  path:line: CODE message):
  SRC   sources/SHA256SUMS still matches the PDFs
  NOTE  reference docs and studies open with the reconstruction/written notice
  SECT  reference docs have the required sections
  LABEL every reference doc uses the evidence labels at least once
  LINK  relative markdown links and bare repo paths resolve
  ID    R/WP/C/RISK/DEC/SRC/E3 identifiers that are referenced are defined
  BAN   banned phrasing ("as originally written", "the original R0x says")

Exit status 1 on any failure; --strict also fails on warnings.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

REQUIRED_SECTIONS = ["## Purpose", "## Summary", "## Edition 3 alignment", "## Open questions", "## Sources"]
EVIDENCE_LABELS = ["Recorded", "Upstream", "Derived", "Estimated", "Proposed"]
NOTICE_RE = re.compile(r"^> (Reconstructed|Written|Redone|Study) 2026-\d\d-\d\d", re.M)
BANNED = [
    (re.compile(r"\bas originally written\b", re.I), "claims original wording"),
    (re.compile(r"the original R\d\d (says|said|states)", re.I), "quotes a lost original"),
]
# Identifier definitions: pattern -> file that must define it, and how it is defined there.
ID_DEFS = {
    "R": (DOCS / "reference", re.compile(r"^R(\d\d)-")),           # filename
    "WP": (DOCS / "execution" / "WORK-PACKAGES.md", re.compile(r"^#+\s*WP(\d\d)\b", re.M)),
    "C": (DOCS / "execution" / "campaigns", re.compile(r"^C(\d\d)-")),  # filename
    "RISK": (DOCS / "reference" / "R15-risk-register.md", re.compile(r"\bRISK-(\d\d)\b")),
    "DEC": (DOCS / "reference" / "R16-decision-register.md", re.compile(r"\bDEC-(\d\d)\b")),
    "SRC": (DOCS / "reference" / "R18-source-register.md", re.compile(r"\bSRC-(\d\d)\b")),
    "E3": (DOCS / "coverage" / "EDITION-3-ERRATA.md", re.compile(r"\bE3-(\d\d)\b")),
}
ID_REF_RE = re.compile(r"\b(WP|RISK|DEC|SRC|E3)-?(\d\d)\b|\b(R)(\d\d)\b(?!-)|(?<![\w/-])(C)(\d\d)\b(?![\w-])")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
# Only this repository's own subtrees; lab and field-ops paths are also written as `docs/...` in prose.
PATH_RE = re.compile(r"`((?:docs/(?:reference|execution|studies|coverage|templates)|sources|tools)/[^`\s]+)`")

failures: list[str] = []
warnings: list[str] = []


def fail(path: Path, line: int, code: str, msg: str) -> None:
    failures.append(f"{path.relative_to(ROOT)}:{line}: {code} {msg}")


def warn(path: Path, line: int, code: str, msg: str) -> None:
    warnings.append(f"{path.relative_to(ROOT)}:{line}: {code} {msg} (warning)")


def md_files() -> list[Path]:
    return sorted(p for p in DOCS.rglob("*.md")) + [ROOT / "README.md", ROOT / "PRIOR-WORK.md"]


def check_sources() -> None:
    sums = ROOT / "sources" / "SHA256SUMS"
    if not sums.exists():
        fail(sums, 0, "SRC", "missing")
        return
    for n, line in enumerate(sums.read_text().splitlines(), 1):
        digest, _, rel = line.partition("  ")
        p = ROOT / "sources" / rel if not rel.startswith("sources/") else ROOT / rel
        if not p.exists():
            fail(sums, n, "SRC", f"{rel} missing")
            continue
        if hashlib.sha256(p.read_bytes()).hexdigest() != digest:
            fail(sums, n, "SRC", f"{rel} hash mismatch")


def defined_ids() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for key, (where, pat) in ID_DEFS.items():
        ids: set[str] = set()
        if where.is_dir():
            for p in where.iterdir():
                m = pat.match(p.name)
                if m:
                    ids.add(m.group(1))
        elif where.exists():
            ids.update(pat.findall(where.read_text()))
        out[key] = ids
    return out


def check_doc(path: Path, defs: dict[str, set[str]]) -> None:
    text = path.read_text()
    lines = text.splitlines()
    is_ref = path.parent == DOCS / "reference"
    is_study = "studies" in path.parts and path.name == "STUDY.md"

    if is_ref or is_study:
        if not NOTICE_RE.search(text[:1500]):
            fail(path, 1, "NOTE", "missing reconstruction/written notice near the top")
    if is_ref:
        for sect in REQUIRED_SECTIONS:
            if sect not in text:
                fail(path, 1, "SECT", f"missing section '{sect}'")
        if not any(lbl in text for lbl in EVIDENCE_LABELS):
            fail(path, 1, "LABEL", "no evidence label used")

    for n, line in enumerate(lines, 1):
        for pat, why in BANNED:
            if pat.search(line):
                fail(path, n, "BAN", why)
        for m in LINK_RE.finditer(line):
            target = m.group(1)
            if target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            target = target.split("#", 1)[0]
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.exists():
                fail(path, n, "LINK", f"broken link {target}")
        for m in PATH_RE.finditer(line):
            rel = m.group(1).rstrip("/")
            if "<" in rel or "*" in rel or "…" in rel or rel.endswith(("-", "_")):
                continue
            if not (ROOT / rel).exists():
                warn(path, n, "LINK", f"path `{rel}` does not exist")
        for m in ID_REF_RE.finditer(line):
            key = m.group(1) or m.group(3) or m.group(5)
            num = m.group(2) or m.group(4) or m.group(6)
            if key == "R" and num not in defs["R"]:
                # R1–R9 in white-paper numbering appear as R1..R9 (single digit) so two-digit only
                fail(path, n, "ID", f"R{num} is not a reference document")
            elif key in ("WP", "C", "RISK", "DEC", "SRC", "E3") and num not in defs[key]:
                # WP/C may legitimately be placeholders "WP??"; only concrete numbers are checked
                (warn if key in ("WP", "C") else fail)(path, n, "ID", f"{key}-{num} referenced but not defined")


def main() -> int:
    strict = "--strict" in sys.argv
    check_sources()
    defs = defined_ids()
    for p in md_files():
        if p.exists():
            check_doc(p, defs)
    for w in warnings:
        print(w)
    for f in failures:
        print(f)
    print(f"\n{len(failures)} failure(s), {len(warnings)} warning(s) over {len(md_files())} files")
    return 1 if failures or (strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
