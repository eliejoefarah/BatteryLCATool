"""Safe evaluation of exchange formulas from uploaded spreadsheets.

Formulas (e.g. ``=1.4*1.1`` or ``=mass * density + 0.175``) come from xlsx
files that manufacturers upload, so they are untrusted input. Instead of a
general-purpose interpreter, a formula is parsed with Python's ``ast`` module
and accepted only if every node is on a small allowlist:

  numbers, parameter names, + - * / ** %, unary + -, parentheses, and calls to
  the functions in ``FUNCTIONS`` (plus the constants ``pi`` and ``e``).

Anything else — attribute access, indexing, strings, lambdas, comprehensions,
keyword arguments, unknown functions such as ``open`` — is rejected before
anything runs. Every number literal is evaluated as a float, so ``10**10**10``
fails fast with an OverflowError instead of building a huge integer, and the
length/size caps bound how long one evaluation can take.

A formula is compiled once with ``compile_formula`` and then evaluated per
Monte Carlo run with ``evaluate``.
"""

from __future__ import annotations

import ast
import math
from dataclasses import dataclass
from types import CodeType

MAX_FORMULA_LENGTH = 500
MAX_NODES = 200

FUNCTIONS = {
    "abs": abs,
    "min": min,
    "max": max,
    "sqrt": math.sqrt,
    "exp": math.exp,
    "log": math.log,
    "log10": math.log10,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
}
CONSTANTS = {"pi": math.pi, "e": math.e}

_ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load, ast.Call,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.UAdd, ast.USub,
)


class FormulaError(ValueError):
    """The formula is not allowed, or could not be evaluated."""


@dataclass(frozen=True)
class CompiledFormula:
    source: str
    code: CodeType
    names: frozenset[str]   # names the formula reads (parameters, or pi/e)


class _FloatLiterals(ast.NodeTransformer):
    def visit_Constant(self, node: ast.Constant) -> ast.Constant:
        return ast.copy_location(ast.Constant(value=float(node.value)), node)


def compile_formula(text: str) -> CompiledFormula:
    """Validate *text* against the allowlist and compile it. Raises FormulaError."""
    expr = text.strip().lstrip("=").strip()
    if not expr:
        raise FormulaError("empty formula")
    if len(expr) > MAX_FORMULA_LENGTH:
        raise FormulaError(f"formula longer than {MAX_FORMULA_LENGTH} characters")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise FormulaError(f"invalid syntax: {exc.msg}") from None

    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_NODES:
        raise FormulaError(f"formula has more than {MAX_NODES} elements")

    names: set[str] = set()
    for node in nodes:
        if not isinstance(node, _ALLOWED_NODES):
            raise FormulaError(f"'{type(node).__name__}' is not allowed in a formula")
        if isinstance(node, ast.Constant) and (
            isinstance(node.value, bool) or not isinstance(node.value, (int, float))
        ):
            raise FormulaError("only numbers are allowed as literals")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
                raise FormulaError("only these functions are allowed: " + ", ".join(sorted(FUNCTIONS)))
            if node.keywords:
                raise FormulaError("keyword arguments are not allowed")
        if isinstance(node, ast.Name):
            if node.id.startswith("_"):
                raise FormulaError(f"name '{node.id}' is not allowed")
            if node.id not in FUNCTIONS:
                names.add(node.id)
    # Function names used as values (e.g. "sqrt + 1") would evaluate to the
    # function object; only allow them in call position.
    called = {n.func.id for n in nodes if isinstance(n, ast.Call)}
    for node in nodes:
        if isinstance(node, ast.Name) and node.id in FUNCTIONS and node.id not in called:
            raise FormulaError(f"'{node.id}' must be called, e.g. {node.id}(x)")

    tree = ast.fix_missing_locations(_FloatLiterals().visit(tree))
    return CompiledFormula(source=text, code=compile(tree, "<formula>", "eval"), names=frozenset(names))


def evaluate(formula: CompiledFormula, values: dict[str, float]) -> float:
    """Evaluate a compiled formula with parameter *values*. Raises FormulaError."""
    # A parameter named like a constant (e.g. 'e') wins over the constant.
    missing = formula.names - values.keys() - CONSTANTS.keys()
    if missing:
        raise FormulaError("unknown parameter(s): " + ", ".join(sorted(missing)))
    scope = {**CONSTANTS, **{n: float(values[n]) for n in formula.names if n in values}}
    try:
        result = eval(formula.code, {"__builtins__": {}, **FUNCTIONS}, scope)  # noqa: S307 — AST allowlisted above
        result = float(result)
    except (ArithmeticError, ValueError, TypeError) as exc:
        raise FormulaError(f"cannot evaluate: {exc}") from None
    if not math.isfinite(result):
        raise FormulaError("result is not a finite number")
    return result
