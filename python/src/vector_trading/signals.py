import json
import time
from enum import Enum
from typing import Any, cast

from pydantic import BaseModel

from ._generated.models.cancel_signal_payload import CancelSignalPayload
from ._generated.models.close_signal_payload import CloseSignalPayload
from ._generated.models.delete_signal_payload import DeleteSignalPayload
from ._generated.models.open_signal_payload import OpenSignalPayload
from ._generated.models.open_signal_payload_order import OpenSignalPayloadOrder
from ._generated.models.pause_signal_payload import PauseSignalPayload
from ._generated.models.start_signal_payload import StartSignalPayload
from ._generated.models.stop_signal_payload import StopSignalPayload
from ._generated.models.update_signal_payload import UpdateSignalPayload
from ._generated.models.update_signal_payload_order import UpdateSignalPayloadOrder
from .errors import SdkError
from .validation import validate_model

type StrategySignalPayload = (
    OpenSignalPayload
    | UpdateSignalPayload
    | CancelSignalPayload
    | CloseSignalPayload
    | StartSignalPayload
    | PauseSignalPayload
    | StopSignalPayload
    | DeleteSignalPayload
)


def _wire(payload: StrategySignalPayload | dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload, BaseModel):
        return cast(dict[str, Any], cast(Any, payload).to_dict())
    if not isinstance(payload, dict):
        raise SdkError("validation", "Signal must be a model or object")
    return payload


def serialize_signal(payload: StrategySignalPayload | dict[str, Any]) -> str:
    value = _wire(payload)
    validate_model("SignalPayload", value)
    significant = value["timestamp"].lstrip("0") or "0"
    if len(significant) > 16 or int(significant) > 9007199254740991:
        raise SdkError("validation", "timestamp must represent a safe integer")
    if value["action"] in ("open", "update"):
        order = value["order"]
        buy = order["side"] == "buy"
        price, trigger = order.get("price"), order.get("triggerPrice")
        base = (
            price if price is not None else trigger if trigger is not None else value["marketPrice"]
        )
        valid = True
        if price is not None:
            limit = trigger if trigger is not None else value["marketPrice"]
            valid &= price <= limit if buy else price >= limit
        if trigger is not None:
            valid &= trigger >= value["marketPrice"] if buy else trigger <= value["marketPrice"]
        if "stop" in order:
            valid &= order["stop"] < base if buy else order["stop"] > base
        targets = order.get("takeProfits", [])
        valid &= all(
            target["price"] > base if buy else target["price"] < base for target in targets
        )
        valid &= sum(target["percent"] for target in targets) <= 100 + 1e-8
        if not valid:
            raise SdkError("validation", "Invalid price or protection relationships")
    text = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(text.encode()) > 16 * 1024:
        raise SdkError("validation", "Signal body exceeds 16 KiB")
    return text


def build_signal(payload: dict[str, Any]) -> StrategySignalPayload:
    if not isinstance(payload, dict):
        raise SdkError("validation", "Signal must be an object")
    value = {**payload}
    if "timestamp" not in value:
        value["timestamp"] = str(time.time_ns() // 1_000_000)
    value = json.loads(serialize_signal(value))
    models: dict[str, Any] = {
        "open": OpenSignalPayload,
        "update": UpdateSignalPayload,
        "cancel": CancelSignalPayload,
        "close": CloseSignalPayload,
        "start": StartSignalPayload,
        "pause": PauseSignalPayload,
        "stop": StopSignalPayload,
        "delete": DeleteSignalPayload,
    }
    return cast(StrategySignalPayload, models[value["action"]].from_dict(value))


def _build[S: BaseModel](action: str, version: float, fields: dict[str, Any], model: type[S]) -> S:
    wire = {"action": action, "version": version}
    # Constructors use Python names while prepared JSON retains exact wire names.
    aliases = {"market_price": "marketPrice"}
    wire.update({aliases.get(key, key): value for key, value in fields.items()})
    for name, value in list(wire.items()):
        if isinstance(value, BaseModel):
            wire[name] = cast(Any, value).to_dict()
    return cast(S, build_signal(wire))


class _Unset(Enum):
    VALUE = "unset"


_UNSET = _Unset.VALUE


def _optional(**fields: Any) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if value is not _UNSET}


def build_open_signal(
    *,
    version: float,
    market_price: float,
    order: OpenSignalPayloadOrder | dict[str, Any],
    timestamp: str | _Unset = _UNSET,
    hashtag: str | _Unset = _UNSET,
    force: bool | _Unset = _UNSET,
) -> OpenSignalPayload:
    return _build(
        "open",
        version,
        {
            "market_price": market_price,
            "order": order,
            **_optional(timestamp=timestamp, hashtag=hashtag, force=force),
        },
        OpenSignalPayload,
    )


def build_update_signal(
    *,
    version: float,
    market_price: float,
    order: UpdateSignalPayloadOrder | dict[str, Any],
    timestamp: str | _Unset = _UNSET,
    hashtag: str | _Unset = _UNSET,
) -> UpdateSignalPayload:
    return _build(
        "update",
        version,
        {
            "market_price": market_price,
            "order": order,
            **_optional(timestamp=timestamp, hashtag=hashtag),
        },
        UpdateSignalPayload,
    )


def build_cancel_signal(
    *,
    version: float,
    timestamp: str | _Unset = _UNSET,
    hashtag: str | _Unset = _UNSET,
    market_price: float | _Unset = _UNSET,
) -> CancelSignalPayload:
    return _build(
        "cancel",
        version,
        _optional(timestamp=timestamp, hashtag=hashtag, market_price=market_price),
        CancelSignalPayload,
    )


def build_close_signal(
    *,
    version: float,
    timestamp: str | _Unset = _UNSET,
    hashtag: str | _Unset = _UNSET,
    market_price: float | _Unset = _UNSET,
) -> CloseSignalPayload:
    return _build(
        "close",
        version,
        _optional(timestamp=timestamp, hashtag=hashtag, market_price=market_price),
        CloseSignalPayload,
    )


def build_start_signal(
    *, version: float, timestamp: str | _Unset = _UNSET, hashtag: str | _Unset = _UNSET
) -> StartSignalPayload:
    return _build(
        "start", version, _optional(timestamp=timestamp, hashtag=hashtag), StartSignalPayload
    )


def build_pause_signal(
    *, version: float, timestamp: str | _Unset = _UNSET, hashtag: str | _Unset = _UNSET
) -> PauseSignalPayload:
    return _build(
        "pause", version, _optional(timestamp=timestamp, hashtag=hashtag), PauseSignalPayload
    )


def build_stop_signal(
    *, version: float, timestamp: str | _Unset = _UNSET, hashtag: str | _Unset = _UNSET
) -> StopSignalPayload:
    return _build(
        "stop", version, _optional(timestamp=timestamp, hashtag=hashtag), StopSignalPayload
    )


def build_delete_signal(
    *, version: float, timestamp: str | _Unset = _UNSET, hashtag: str | _Unset = _UNSET
) -> DeleteSignalPayload:
    return _build(
        "delete", version, _optional(timestamp=timestamp, hashtag=hashtag), DeleteSignalPayload
    )
