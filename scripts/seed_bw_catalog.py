#!/usr/bin/env python3
"""
seed_bw_catalog.py — Seed bw_activity_catalog from a Brightway2/ecoinvent CSV export.

Usage:
    python scripts/seed_bw_catalog.py --file scripts/ecoinvent_activity_catalog.csv

    # Re-seed a specific version (delete existing rows first):
    python scripts/seed_bw_catalog.py \\
        --file scripts/ecoinvent_activity_catalog.csv \\
        --clear

    # Override database URL:
    python scripts/seed_bw_catalog.py \\
        --file scripts/ecoinvent_activity_catalog.csv \\
        --db postgresql://user:pass@host:5432/dbname

The CSV must have these columns (order does not matter):
    code, activity_name, reference_product, location, unit, category,
    ecoinvent_version, system_model

DATABASE_URL env var is used when --db is not supplied.
If DATABASE_URL uses the postgresql+asyncpg:// scheme (as FastAPI uses),
the +asyncpg driver suffix is stripped automatically before connecting.
"""

import argparse
import csv
import os
import sys
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BATCH_SIZE = 1000

NULLABLE_COLUMNS = {
    "code",
    "reference_product",
    "location",
    "unit",
    "category",
}

REQUIRED_CSV_COLUMNS = {
    "code",
    "activity_name",
    "reference_product",
    "location",
    "unit",
    "category",
    "ecoinvent_version",
    "system_model",
}

INSERT_SQL = """
    INSERT INTO bw_activity_catalog
        (ecoinvent_version, system_model, code, activity_name,
         reference_product, location, unit, category)
    VALUES
        (%(ecoinvent_version)s, %(system_model)s, %(code)s, %(activity_name)s,
         %(reference_product)s, %(location)s, %(unit)s, %(category)s)
    ON CONFLICT (ecoinvent_version, system_model, code) DO NOTHING
"""

DELETE_SQL = """
    DELETE FROM bw_activity_catalog
    WHERE ecoinvent_version = %s
      AND system_model = %s
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def normalise_db_url(url: str) -> str:
    """Strip +asyncpg (or any +driver) suffix from the scheme so psycopg2 accepts it."""
    if "://" not in url:
        return url
    scheme, rest = url.split("://", 1)
    # e.g. 'postgresql+asyncpg' → 'postgresql'
    base_scheme = scheme.split("+")[0]
    return f"{base_scheme}://{rest}"


def clean(value: str, column: str) -> str | None:
    """Strip whitespace; return None for empty strings in nullable columns."""
    stripped = value.strip()
    if not stripped and column in NULLABLE_COLUMNS:
        return None
    return stripped


def load_rows(csv_path: Path) -> tuple[list[dict], str, str]:
    """
    Read and validate the CSV.

    Returns:
        rows            — list of dicts ready for executemany
        ecoinvent_version — first non-empty version found (used for progress output)
        system_model      — first non-empty system model found
    Raises SystemExit if the file is missing required columns.
    """
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)

        if reader.fieldnames is None:
            print("ERROR: CSV file is empty or has no header row.", file=sys.stderr)
            sys.exit(1)

        actual_columns = {c.strip() for c in reader.fieldnames}
        missing = REQUIRED_CSV_COLUMNS - actual_columns
        if missing:
            print(
                f"ERROR: CSV is missing required columns: {', '.join(sorted(missing))}",
                file=sys.stderr,
            )
            sys.exit(1)

        rows: list[dict] = []
        ecoinvent_version = ""
        system_model = ""

        for raw in reader:
            row = {col: clean(raw[col], col) for col in REQUIRED_CSV_COLUMNS}

            if not row["activity_name"]:
                # Skip rows with no activity name (blank lines, etc.)
                continue

            rows.append(row)

            if not ecoinvent_version and row["ecoinvent_version"]:
                ecoinvent_version = row["ecoinvent_version"]
            if not system_model and row["system_model"]:
                system_model = row["system_model"]

    return rows, ecoinvent_version, system_model


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed bw_activity_catalog from a Brightway2/ecoinvent CSV export."
    )
    parser.add_argument(
        "--file",
        required=True,
        metavar="PATH",
        help="Path to the CSV file (e.g. scripts/ecoinvent_activity_catalog.csv)",
    )
    parser.add_argument(
        "--db",
        metavar="URL",
        default=None,
        help=(
            "Database URL (postgresql://...). "
            "Defaults to DATABASE_URL env var. "
            "+asyncpg suffix is stripped automatically."
        ),
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help=(
            "Delete all existing rows for the same (ecoinvent_version, system_model) "
            "before inserting. Use this to re-seed a specific version cleanly."
        ),
    )
    args = parser.parse_args()

    # ── Resolve CSV path ────────────────────────────────────────────────────
    csv_path = Path(args.file)
    if not csv_path.exists():
        print(f"ERROR: CSV file not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    # ── Resolve DB URL ───────────────────────────────────────────────────────
    raw_url = args.db or os.environ.get("DATABASE_URL", "")
    if not raw_url:
        print(
            "ERROR: No database URL supplied. "
            "Pass --db or set the DATABASE_URL environment variable.",
            file=sys.stderr,
        )
        sys.exit(1)
    db_url = normalise_db_url(raw_url)

    # ── Load and validate CSV ────────────────────────────────────────────────
    print(f"Reading {csv_path} …")
    rows, ecoinvent_version, system_model = load_rows(csv_path)
    total = len(rows)
    print(f"  {total} data rows loaded  (version={ecoinvent_version!r}, system_model={system_model!r})")

    if total == 0:
        print("Nothing to insert.")
        sys.exit(0)

    # ── Connect ──────────────────────────────────────────────────────────────
    try:
        conn = psycopg2.connect(db_url)
    except psycopg2.OperationalError as exc:
        print(f"ERROR: Could not connect to database:\n  {exc}", file=sys.stderr)
        sys.exit(1)

    inserted = 0
    try:
        with conn:
            with conn.cursor() as cur:

                # ── Optional clear ───────────────────────────────────────────
                if args.clear:
                    if not ecoinvent_version or not system_model:
                        print(
                            "ERROR: --clear requires ecoinvent_version and system_model "
                            "to be present in the CSV.",
                            file=sys.stderr,
                        )
                        sys.exit(1)
                    print(
                        f"  --clear: deleting existing rows for "
                        f"version={ecoinvent_version!r}, system_model={system_model!r} …"
                    )
                    cur.execute(DELETE_SQL, (ecoinvent_version, system_model))
                    deleted = cur.rowcount
                    print(f"  Deleted {deleted} existing rows.")

                # ── Batch insert ─────────────────────────────────────────────
                print("Inserting …")
                for batch_start in range(0, total, BATCH_SIZE):
                    batch = rows[batch_start : batch_start + BATCH_SIZE]
                    psycopg2.extras.execute_batch(cur, INSERT_SQL, batch)
                    # track progress by position instead.
                    batch_end = min(batch_start + BATCH_SIZE, total)
                    print(f"  … {batch_end}/{total} rows processed")

                # Determine actual inserted count via a post-insert count query.
                # We re-query rather than summing rowcount because ON CONFLICT DO NOTHING
                # makes rowcount unreliable across drivers.
                cur.execute(
                    "SELECT COUNT(*) FROM bw_activity_catalog "
                    "WHERE ecoinvent_version = %s AND system_model = %s",
                    (ecoinvent_version, system_model),
                )
                row_in_db = cur.fetchone()[0]

    finally:
        conn.close()

    skipped = total - row_in_db if not args.clear else 0
    final_inserted = row_in_db if args.clear else row_in_db

    print(
        f"\nSeeded {final_inserted} rows, skipped {skipped} duplicates "
        f"from ecoinvent v{ecoinvent_version} ({system_model})"
    )


if __name__ == "__main__":
    main()
