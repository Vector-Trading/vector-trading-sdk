import json
import math
import re
from datetime import datetime
from importlib.resources import files
from typing import Any

from .errors import SdkError

CONTRACT: dict[str, Any] = json.loads(
    files("vector_trading._generated.models").joinpath("contract.json").read_text()
)
OPERATIONS: dict[str, Any] = {
    op["operationId"]: (method.upper(), path, op)
    for path, methods in CONTRACT["paths"].items()
    for method, op in methods.items()
}


def validate(schema: dict[str, Any], value: Any) -> None:
    """Evaluate only the features used by the accepted, generated transport metadata."""
    if "$ref" in schema:
        return validate(CONTRACT["schemas"][schema["$ref"].rsplit("/", 1)[-1]], value)
    if value is None:
        if schema.get("nullable"):
            return
        raise ValueError("null is not allowed")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError("invalid enum")
    if "oneOf" in schema:
        matches = 0
        for branch in schema["oneOf"]:
            try:
                validate(branch, value)
                matches += 1
            except ValueError:
                pass
        if matches != 1:
            raise ValueError("invalid variant")
    match schema.get("type"):
        case "object":
            if not isinstance(value, dict):
                raise ValueError("expected object")
            if any(key not in value for key in schema.get("required", [])):
                raise ValueError("missing field")
            for key, item in value.items():
                if key in schema.get("properties", {}):
                    validate(schema["properties"][key], item)
                elif schema.get("additionalProperties") is False:
                    raise ValueError("unknown field")
        case "array":
            if not isinstance(value, list) or len(value) > schema.get("maxItems", math.inf):
                raise ValueError("invalid array")
            for item in value:
                validate(schema["items"], item)
        case "string":
            if not isinstance(value, str):
                raise ValueError("expected string")
            if not schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", math.inf):
                raise ValueError("invalid length")
            if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
                raise ValueError("invalid pattern")
            if schema.get("format") == "date-time":
                if not re.fullmatch(
                    r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", value, re.I
                ):
                    raise ValueError("expected ISO datetime")
                datetime.fromisoformat(value)
        case "number" | "integer":
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise ValueError("expected finite number")
            if schema["type"] == "integer" and value != int(value):
                raise ValueError("expected integer")
            for field, sign in [("minimum", -1), ("maximum", 1)]:
                if field in schema:
                    difference = (value - schema[field]) * sign
                    if difference > 0 or (
                        difference == 0 and schema.get("exclusive" + field.title())
                    ):
                        raise ValueError("outside bounds")
        case "boolean":
            if not isinstance(value, bool):
                raise ValueError("expected boolean")


def validate_model(name: str, value: Any) -> None:
    try:
        return validate(CONTRACT["schemas"][name], value)
    except (ValueError, TypeError, OverflowError):
        pass
    raise SdkError("validation", "Input does not match the public contract")


def validate_response(operation: str, value: Any) -> None:
    try:
        return validate(
            OPERATIONS[operation][2]["responses"]["200"]["content"]["application/json"]["schema"],
            value,
        )
    except (ValueError, TypeError, OverflowError):
        pass
    raise SdkError("protocol", "Server response does not match the public contract")
