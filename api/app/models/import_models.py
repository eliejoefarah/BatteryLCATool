from __future__ import annotations

# =============================================================================
# import_models.py — Battery LCA Tool
# =============================================================================
# Pydantic v2 models for the xlsx batch-import pipeline.
#
# Layer                  Model(s)
# ─────────────────────────────────────────────────────────────────────────────
# Raw xlsx parsing       XlsxParameterRow, XlsxActivityRow, XlsxExchangeRow
# DB insert              ProcessInstanceCreate, ProcessExchangeCreate,
#                        ModelParameterCreate
# Import summary         BatchImportResult
# =============================================================================

from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Shared type aliases
# ---------------------------------------------------------------------------

ExchangeDirection = Literal["input", "output"]
OutputType = Literal["reference", "coproduct", "waste_output", "stock"]

# ---------------------------------------------------------------------------
# Xlsx row models — raw input parsed from each sheet
# ---------------------------------------------------------------------------


class XlsxParameterRow(BaseModel):
    """One row from the Parameters sheet.

    Columns: name, description, value, min_value, max_value,
             mode_value, distribution_type
    """

    name: str
    description: str | None = None
    value: Decimal
    min_value: Decimal | None = None
    max_value: Decimal | None = None
    mode_value: Decimal | None = None
    distribution_type: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Parameter name must not be empty.")
        return v


class XlsxActivityRow(BaseModel):
    """One row from the Activities sheet.

    Columns: name, location, unit, production_amount, stage, comment

    system_boundary is always 'foreground' for xlsx imports; it is not
    a spreadsheet column but is set on all ProcessInstance inserts.
    """

    name: str
    location: str | None = None
    unit: str | None = None
    production_amount: Decimal = Decimal("1.0")
    stage: str | None = None
    comment: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Activity name must not be empty.")
        return v

    @field_validator("production_amount", mode="before")
    @classmethod
    def production_amount_positive(cls, v: object) -> Decimal:
        d = Decimal(str(v)) if v is not None else Decimal("1.0")
        if d <= 0:
            raise ValueError(
                f"production_amount must be > 0 (got {d}). "
                "Each process must produce a positive reference quantity."
            )
        return d


class XlsxExchangeRow(BaseModel):
    """One row from the Exchanges sheet.

    Columns: activity_name, flow_name, quantity, formula, unit,
             direction, source_database, source_location, data_origin

    Validation rules
    ────────────────
    • quantity_user >= 0 — foreground quantities are always positive magnitudes;
      'direction' carries the sign convention, not the number itself.
    • formula is stored as formula_user; a row may supply either quantity or
      formula (or both — formula takes precedence during calculation).
    • amount_is_ecoinvent_signed is always False for xlsx-imported rows.
    • data_origin is the data_origin_catalog.code string (e.g. 'measured',
      'datasheet'). It is informational at parse time; the router validates it
      against the catalog before writing to the DB.
    """

    activity_name: str
    flow_name: str
    quantity: Annotated[Decimal | None, Field(alias="quantity")] = None
    formula: str | None = None        # raw formula string → stored as formula_user
    unit: str | None = None
    direction: ExchangeDirection
    source_database: str | None = None
    source_location: str | None = None
    data_origin: str | None = None    # data_origin_catalog.code; informational
    # VUB template extra columns
    comment: str | None = None        # col F: function/use, treatment, mode of transport
    details: str | None = None        # col G: range / detail notes
    cost_per_unit: Decimal | None = None  # col H: cost in €
    observations: str | None = None   # col J: supplier, recycled content, etc.
    # Explicit output_type — set by parsers when type is known (e.g. coproducts from
    # the VUB metadata section).  When None, run_import infers from position order.
    output_type: OutputType | None = None

    model_config = ConfigDict(str_strip_whitespace=True, populate_by_name=True)

    @field_validator("quantity", mode="before")
    @classmethod
    def _parse_quantity(cls, v: object) -> Decimal | None:
        if v is None or str(v).strip() == "":
            return None
        return Decimal(str(v))

    @field_validator("activity_name", "flow_name")
    @classmethod
    def name_fields_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("activity_name and flow_name must not be empty.")
        return v


# ---------------------------------------------------------------------------
# DB insert models — map directly to table columns
# ---------------------------------------------------------------------------


class ProcessInstanceCreate(BaseModel):
    """Maps to process_instance for a single DB INSERT.

    system_boundary is locked to 'foreground' for all xlsx imports.
    """

    revision_id: UUID
    name: str
    location: str | None = None
    unit: str | None = None
    production_amount: Decimal = Decimal("1.0")
    stage: str | None = None
    comment: str | None = None
    system_boundary: Literal["foreground"] = "foreground"

    model_config = ConfigDict(str_strip_whitespace=True)


class ProcessExchangeCreate(BaseModel):
    """Maps directly to process_exchange table columns for a DB INSERT.

    output_type inference (applied by the import router before construction)
    ─────────────────────────────────────────────────────────────────────────
    • direction = 'input'                       → output_type = None
    • direction = 'output', first for activity  → output_type = 'reference'
    • direction = 'output', subsequent          → output_type = 'coproduct'

    amount_is_ecoinvent_signed is always False: manufacturer xlsx data uses
    positive magnitudes; the sign convention is carried by exchange_direction.
    """

    process_id: UUID
    flow_id: UUID | None = None          # set after flow_catalog lookup/insert
    raw_name: str | None = None          # flow_name from the xlsx row
    quantity_user: Decimal | None = None
    formula_user: str | None = None
    user_unit: str | None = None
    exchange_direction: ExchangeDirection
    output_type: OutputType | None = None
    source_database: str | None = None
    source_location: str | None = None
    amount_is_ecoinvent_signed: bool = False
    sort_order: int | None = None
    # VUB template extra columns
    comment: str | None = None
    details: str | None = None
    cost_per_unit: Decimal | None = None
    observations: str | None = None

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def output_type_required_for_outputs(self) -> ProcessExchangeCreate:
        if self.exchange_direction == "output" and self.output_type is None:
            raise ValueError(
                "output_type is required when exchange_direction is 'output'. "
                "Expected one of: 'reference', 'coproduct', 'waste_output', 'stock'. "
                "The import router should set this before constructing this model."
            )
        return self


class ModelParameterCreate(BaseModel):
    """Maps to model_parameter for a DB INSERT."""

    revision_id: UUID
    name: str
    description: str | None = None
    value: Decimal
    min_value: Decimal | None = None
    max_value: Decimal | None = None
    mode_value: Decimal | None = None
    distribution_type: str | None = None
    param_type: Literal["scalar", "lookup"] = "scalar"

    model_config = ConfigDict(str_strip_whitespace=True)


# ---------------------------------------------------------------------------
# Batch import result — returned by the import router endpoint
# ---------------------------------------------------------------------------


class BatchImportResult(BaseModel):
    """Summary of a completed xlsx batch import operation."""

    activities_created: int = 0
    exchanges_created: int = 0
    parameters_created: int = 0
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

    # Set when the revision already has data and force=False was passed.
    # The caller should prompt the user and re-call with force=True to override.
    already_has_data: bool = False
    existing_activities_count: int = 0

    # UUID of the import_job row created by run_import (None when already_has_data=True).
    import_job_id: UUID | None = None

    @property
    def ok(self) -> bool:
        """True when the import completed with no errors (warnings are allowed)."""
        return len(self.errors) == 0

    def add_warning(self, msg: str) -> None:
        self.warnings.append(msg)

    def add_error(self, msg: str) -> None:
        self.errors.append(msg)
