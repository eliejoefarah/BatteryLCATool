from __future__ import annotations

# =============================================================================
# montecarlo_service.py — Battery LCA Tool
# =============================================================================
# Pure Python Monte Carlo uncertainty service — no FastAPI imports.
# The router is responsible for HTTP concerns; this module handles:
#   1. load_parameters  — read model_parameter rows, build scipy distributions
#   2. load_exchanges   — read all process_exchange rows for a revision
#
# Known limitations
# -----------------
# 1. Independent parameter sampling — parameters are sampled independently.
#    Correlated parameters are not supported. A covariance table would be
#    needed for a future phase.
#
# 2. Foreground only — background ecoinvent activity uncertainties are not
#    propagated. Full uncertainty propagation requires bw2calc integration.
#
# 3. No inter-process formula dependencies — formula_user strings may only
#    reference model_parameter names. References to output quantities of other
#    processes will fail as undefined variables in asteval.
#
# 4. Raw sample storage deferred — only statistics and histogram bins are
#    stored, not raw sample arrays. Results are statistically reproducible
#    but not bit-identical across re-runs.
# =============================================================================

import math
import logging
from collections import defaultdict
from dataclasses import dataclass
from uuid import UUID
from typing import Any

import numpy as np
import scipy.stats
from scipy.stats import spearmanr
from asteval import Interpreter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


@dataclass
class SampledParameter:
    """One model_parameter row with its resolved scipy frozen distribution."""

    name: str
    nominal_value: float
    # None means fixed constant — sampling always returns nominal_value
    dist: Any  # scipy.stats.rv_frozen or None


def _make_dist(
    distribution_type: str | None,
    nominal: float,
    min_value: Any,
    max_value: Any,
    mode_value: Any,
) -> Any:
    """Return a scipy frozen distribution, or None for fixed parameters."""
    dt = (distribution_type or "").strip().lower()

    if dt == "uniform":
        if min_value is None or max_value is None:
            return None
        lo, hi = float(min_value), float(max_value)
        if hi <= lo:
            return None
        return scipy.stats.uniform(loc=lo, scale=hi - lo)

    if dt == "normal":
        if mode_value is None:
            return None
        return scipy.stats.norm(loc=nominal, scale=float(mode_value))

    if dt == "lognormal":
        if mode_value is None:
            return None
        return scipy.stats.lognorm(s=float(mode_value), scale=math.exp(nominal))

    if dt == "triangular":
        if min_value is None or max_value is None:
            return None
        lo, hi = float(min_value), float(max_value)
        if hi <= lo:
            return None
        # mode_value stores the triangular peak; fall back to nominal
        peak = float(mode_value) if mode_value is not None else nominal
        c = (peak - lo) / (hi - lo)
        if not (0.0 <= c <= 1.0):
            log.warning(
                "Triangular parameter has mode outside [min, max]; treating as fixed."
            )
            return None
        return scipy.stats.triang(c=c, loc=lo, scale=hi - lo)

    return None


async def load_parameters(
    revision_id: UUID, db: AsyncSession
) -> list[SampledParameter]:
    """Load model_parameter rows for a revision and resolve scipy distributions.

    Returns an empty list when the revision has no parameters — not an error.
    Parameters with missing/invalid distribution configuration are returned as
    fixed constants (dist=None).
    """
    rows = (
        await db.execute(
            text(
                "SELECT name, value, min_value, max_value, mode_value, distribution_type "
                "FROM model_parameter WHERE revision_id = :rid"
            ),
            {"rid": str(revision_id)},
        )
    ).fetchall()

    result: list[SampledParameter] = []
    for row in rows:
        name, value, min_value, max_value, mode_value, distribution_type = row
        nominal = float(value)
        dist = _make_dist(distribution_type, nominal, min_value, max_value, mode_value)
        result.append(SampledParameter(name=name, nominal_value=nominal, dist=dist))

    return result


# ---------------------------------------------------------------------------
# Exchange loading
# ---------------------------------------------------------------------------

_EXCHANGE_QUERY = text("""
    SELECT
        pe.exchange_id,
        pe.formula_user,
        pe.quantity_user,
        pe.raw_name,
        pe.user_unit,
        pe.exchange_direction
    FROM process_exchange pe
    JOIN process_instance pi ON pi.process_id = pe.process_id
    WHERE pi.revision_id = :rid
""")


@dataclass
class ExchangeRow:
    """One process_exchange row."""

    exchange_id: str
    formula_user: str | None
    quantity_user: float | None
    raw_name: str | None
    user_unit: str | None
    direction: str          # 'input' | 'output'


async def load_exchanges(revision_id: UUID, db: AsyncSession) -> list[ExchangeRow]:
    """Fetch all process_exchange rows for a revision."""
    rows = (
        await db.execute(_EXCHANGE_QUERY, {"rid": str(revision_id)})
    ).fetchall()

    return [
        ExchangeRow(
            exchange_id=str(row[0]),
            formula_user=row[1],
            quantity_user=float(row[2]) if row[2] is not None else None,
            raw_name=row[3],
            user_unit=row[4],
            direction=row[5],
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Monte Carlo loop
# ---------------------------------------------------------------------------

# Key type for flow totals: (raw_name, user_unit, direction)
_FlowKey = tuple[str | None, str | None, str]


def run_montecarlo_loop(
    parameters: list[SampledParameter],
    exchanges: list[ExchangeRow],
    n_runs: int,
) -> tuple[list[dict], int, list[str], dict[str, np.ndarray]]:
    """Run the Monte Carlo sampling loop synchronously.

    Pre-samples all distributions once as numpy arrays of shape (n_runs,),
    then iterates run-by-run, populating a fresh asteval Interpreter symbol
    table from the pre-sampled arrays and evaluating each elementary exchange
    formula.

    Returns:
        run_results       — list of {_FlowKey: float} dicts, one per successful run
        failed_runs       — count of runs skipped due to formula errors
        failed_formulas   — list of formula strings that caused failures
                            (may contain duplicates; caller deduplicates for reporting)
        samples_successful — pre-sampled arrays filtered to successful-run indices,
                             aligned with run_results for Spearman sensitivity analysis

    Raises:
        ValueError if more than 10% of runs fail, including the unique failing
        formula strings in the message.
    """
    # Pre-sample all distributions up front
    samples: dict[str, np.ndarray] = {}
    for p in parameters:
        if p.dist is not None:
            samples[p.name] = p.dist.rvs(size=n_runs)
        else:
            samples[p.name] = np.full(n_runs, p.nominal_value)

    run_results: list[dict] = []
    failed_runs = 0
    failed_formulas: list[str] = []
    success_indices: list[int] = []

    for i in range(n_runs):
        aeval = Interpreter()
        for name, arr in samples.items():
            aeval.symtable[name] = float(arr[i])

        flow_totals: defaultdict[_FlowKey, float] = defaultdict(float)
        run_failed = False

        for exc in exchanges:
            if exc.formula_user:
                formula = exc.formula_user.lstrip("=")
                qty = aeval(formula)
                if aeval.error:
                    failed_formulas.append(exc.formula_user)
                    run_failed = True
                    break
            else:
                qty = exc.quantity_user or 0.0

            flow_totals[(exc.raw_name, exc.user_unit, exc.direction)] += qty

        if run_failed:
            failed_runs += 1
        else:
            run_results.append(dict(flow_totals))
            success_indices.append(i)

    if n_runs > 0 and failed_runs / n_runs > 0.10:
        unique_failing = list(set(failed_formulas))
        raise ValueError(
            f"{failed_runs}/{n_runs} runs failed. "
            f"Problematic formulas: {unique_failing}"
        )

    samples_successful: dict[str, np.ndarray] = (
        {name: arr[success_indices] for name, arr in samples.items()}
        if success_indices else {}
    )
    return run_results, failed_runs, failed_formulas, samples_successful


# ---------------------------------------------------------------------------
# Statistics aggregation
# ---------------------------------------------------------------------------

def aggregate_statistics(
    run_results: list[dict],
    all_flow_keys: list[_FlowKey],
) -> list[dict]:
    """Compute per-flow statistics over all successful Monte Carlo runs.

    For each (raw_name, user_unit, direction) key, builds a numpy array using
    .get(key, 0.0) so runs where the flow was absent are treated as zero.
    Returns a list of flow dicts matching the results.flows JSONB schema.
    All numpy scalar types are converted to plain Python before returning.
    """
    flows: list[dict] = []

    for key in all_flow_keys:
        raw_name, user_unit, direction = key
        arr = np.array([run.get(key, 0.0) for run in run_results])

        bin_counts, bin_edges = np.histogram(arr, bins=30)

        p5, p25, p50, p75, p95 = np.percentile(arr, [5, 25, 50, 75, 95])

        mean_val = float(np.mean(arr))
        std_val = float(np.std(arr))
        p5_val, p25_val, p50_val, p75_val, p95_val = (
            float(p5), float(p25), float(p50), float(p75), float(p95)
        )
        cv_pct = (std_val / mean_val * 100.0) if mean_val != 0 else None

        flows.append({
            "flow_name": raw_name,
            "unit": user_unit,
            "direction": direction,
            "mean": mean_val,
            "std": std_val,
            "cv_pct": cv_pct,
            "p5": p5_val,
            "p25": p25_val,
            "p50": p50_val,
            "p75": p75_val,
            "p95": p95_val,
            "range_p5_p95": p95_val - p5_val,
            "histogram": {
                "bin_edges": bin_edges.tolist(),
                "counts": bin_counts.tolist(),
            },
        })

    return flows


# ---------------------------------------------------------------------------
# Sensitivity analysis
# ---------------------------------------------------------------------------

def compute_sensitivity(
    samples: dict[str, np.ndarray],
    flow_arrays: dict[_FlowKey, np.ndarray],
) -> list[dict]:
    """Compute Spearman rank correlation between parameters and flow totals.

    Skips fixed parameters (std == 0). Includes only pairs where |ρ| > 0.1.
    Returns a list of dicts matching the results.sensitivity JSONB schema,
    sorted descending by |ρ|.
    """
    sensitivity: list[dict] = []

    for param_name, param_arr in samples.items():
        if np.std(param_arr) == 0:
            continue
        for flow_key, flow_arr in flow_arrays.items():
            raw_name, _unit, direction = flow_key
            rho, pval = spearmanr(param_arr, flow_arr)
            if abs(rho) > 0.1:
                sensitivity.append({
                    "parameter_name": param_name,
                    "flow_name": raw_name,
                    "direction": direction,
                    "spearman_rho": round(float(rho), 4),
                    "p_value": round(float(pval), 6),
                })

    sensitivity.sort(key=lambda x: abs(x["spearman_rho"]), reverse=True)
    return sensitivity
