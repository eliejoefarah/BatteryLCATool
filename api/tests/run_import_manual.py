"""
Manual smoke-test for run_import.

Usage (from api/ directory, with venv activated):
  python tests/run_import_manual.py \
      --file    path/to/your_file.xlsx \
      --rev     <revision_id UUID> \
      --catalog <catalog_set_id UUID> \
      --user    <imported_by UUID>

The seeded catalog_set_id from 007_flows is:
  00000000-0000-0000-0001-000000000001

Example:
  python tests/run_import_manual.py \
      --file    tests/nmc811_lci_import.xlsx \
      --rev     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
      --catalog 00000000-0000-0000-0001-000000000001 \
      --user    xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Allow importing from api/app/
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

from app.services.import_service import run_import  # noqa: E402


async def main(
    xlsx_path: Path,
    revision_id: UUID,
    catalog_set_id: UUID,
    user_id: UUID,
    force: bool = False,
) -> None:
    database_url = os.environ["DATABASE_URL"]
    engine = create_async_engine(database_url, echo=False)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    content = xlsx_path.read_bytes()

    async with Session() as db:
        print(f"\n>>> Running import for {xlsx_path.name} (force={force}) …")
        result = await run_import(
            db=db,
            content=content,
            revision_id=revision_id,
            catalog_set_id=catalog_set_id,
            imported_by=user_id,
            filename=xlsx_path.name,
            force=force,
        )

    print("\n=== Import result ===")
    if result.already_has_data:
        print(f"  [CONFLICT] Revision already has {result.existing_activities_count} "
              f"activities. Re-run with --force to override.")
        return
    print(f"  activities_created : {result.activities_created}")
    print(f"  exchanges_created  : {result.exchanges_created}")
    print(f"  parameters_created : {result.parameters_created}")
    print(f"  warnings           : {len(result.warnings)}")
    print(f"  errors             : {len(result.errors)}")
    if result.warnings:
        for w in result.warnings:
            print(f"  [WARN] {w}")
    if result.errors:
        for e in result.errors:
            print(f"  [ERR ] {e}")

    # ── Verification queries ──────────────────────────────────────────────
    async with Session() as db:
        print("\n=== DB verification ===")

        # Process instances
        rows = (await db.execute(
            text("""
                SELECT name, unit, production_amount, system_boundary
                FROM process_instance
                WHERE revision_id = :rid
                ORDER BY name
            """),
            {"rid": str(revision_id)},
        )).fetchall()
        print(f"\nprocess_instance rows ({len(rows)}):")
        for r in rows:
            print(f"  {r[0]!r:40s}  unit={r[1]}  prod={r[2]}  boundary={r[3]}")

        # Exchange counts per process
        rows = (await db.execute(
            text("""
                SELECT pi.name, pe.exchange_direction, pe.output_type, COUNT(*) AS n
                FROM process_exchange pe
                JOIN process_instance pi ON pi.process_id = pe.process_id
                WHERE pi.revision_id = :rid
                GROUP BY pi.name, pe.exchange_direction, pe.output_type
                ORDER BY pi.name, pe.exchange_direction
            """),
            {"rid": str(revision_id)},
        )).fetchall()
        print(f"\nprocess_exchange summary:")
        for r in rows:
            print(f"  {r[0]!r:40s}  dir={r[1]:6s}  otype={str(r[2]):12s}  n={r[3]}")

        # Model parameters
        rows = (await db.execute(
            text("""
                SELECT name, value
                FROM model_parameter
                WHERE revision_id = :rid
                ORDER BY name
            """),
            {"rid": str(revision_id)},
        )).fetchall()
        if rows:
            print(f"\nmodel_parameter rows ({len(rows)}):")
            for r in rows:
                print(f"  {r[0]!r:30s}  value={r[1]}")

        # Flow catalog entries created
        rows = (await db.execute(
            text("""
                SELECT fc.canonical_name, fc.kind, fc.default_unit
                FROM flow_catalog fc
                JOIN process_exchange pe ON pe.flow_id = fc.flow_id
                JOIN process_instance pi ON pi.process_id = pe.process_id
                WHERE pi.revision_id = :rid
                ORDER BY fc.kind, fc.canonical_name
            """),
            {"rid": str(revision_id)},
        )).fetchall()
        print(f"\nflow_catalog entries referenced ({len(rows)}):")
        for r in rows:
            print(f"  [{r[1]:10s}]  {r[0]!r}  unit={r[2]}")

    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file",    required=True, type=Path)
    parser.add_argument("--rev",     required=True, type=UUID)
    parser.add_argument("--catalog", required=True, type=UUID)
    parser.add_argument("--user",    required=True, type=UUID)
    parser.add_argument("--force",   action="store_true", default=False)
    args = parser.parse_args()

    asyncio.run(main(args.file, args.rev, args.catalog, args.user, force=args.force))
