import json
import traceback

import pytest
from pydantic import ValidationError

import vector_trading as sdk

ID = "b" * 32
KEY = "a" * 32
PRIVATE = "synthetic_private_value"


@pytest.mark.parametrize("route", ["constructor", "assignment", "from_dict", "from_json"])
@pytest.mark.parametrize(
    "model,body",
    [
        (sdk.OtherGrantRequest, {"userId": ID, "grantType": "gift"}),
        (
            sdk.PaidExternalGrantRequest,
            {"userId": ID, "grantType": "paid_external", "sourceId": "invoice:123"},
        ),
        (sdk.CancelSignalPayload, {"action": "cancel", "version": 1, "timestamp": "1"}),
        (sdk.CloseSignalPayload, {"action": "close", "version": 1, "timestamp": "1"}),
        (sdk.StartSignalPayload, {"action": "start", "version": 1, "timestamp": "1"}),
        (sdk.PauseSignalPayload, {"action": "pause", "version": 1, "timestamp": "1"}),
        (sdk.StopSignalPayload, {"action": "stop", "version": 1, "timestamp": "1"}),
        (sdk.DeleteSignalPayload, {"action": "delete", "version": 1, "timestamp": "1"}),
        (
            sdk.OpenSignalPayload,
            {
                "action": "open",
                "version": 1,
                "timestamp": "1",
                "marketPrice": 100,
                "order": {"side": "buy"},
            },
        ),
        (
            sdk.UpdateSignalPayload,
            {
                "action": "update",
                "version": 1,
                "timestamp": "1",
                "marketPrice": 100,
                "order": {"side": "buy"},
            },
        ),
        (sdk.OpenSignalPayloadOrder, {"side": "buy"}),
        (sdk.UpdateSignalPayloadOrder, {"side": "buy"}),
        (sdk.OpenSignalPayloadOrderTakeProfitsInner, {"price": 110, "percent": 20}),
    ],
)
def test_unknown_model_fields_are_rejected(model, body, route):
    submitted = {**body, "misspelled": PRIVATE}
    with pytest.raises((ValidationError, ValueError)) as error:
        match route:
            case "constructor":
                model(**submitted)
            case "assignment":
                model(**body).misspelled = PRIVATE
            case "from_dict":
                model.from_dict(submitted)
            case "from_json":
                model.from_json(json.dumps(submitted))
    for rendered in (
        str(error.value),
        repr(error.value),
        "".join(traceback.format_exception(error.value)),
    ):
        assert PRIVATE not in rendered


@pytest.mark.parametrize("route", ["from_dict", "from_json"])
def test_unknown_fields_in_grant_union(route):
    body = {"userId": ID, "grantType": "gift", "end_at": PRIVATE}
    with pytest.raises((ValidationError, ValueError)):
        getattr(sdk.CreateGrantRequest, route)(json.dumps(body) if route == "from_json" else body)


@pytest.mark.parametrize("level", ["signal", "order", "target"])
def test_unknown_nested_signal_fields(level):
    target = {"price": 110, "percent": 20}
    order = {"side": "buy", "takeProfits": [target]}
    body = {"action": "open", "version": 1, "timestamp": "1", "marketPrice": 100, "order": order}
    {"signal": body, "order": order, "target": target}[level]["misspelled"] = PRIVATE
    with pytest.raises((ValidationError, ValueError)):
        sdk.OpenSignalPayload.from_dict(body)


@pytest.mark.parametrize(
    "name",
    [
        "OwnedTradingBundleSummary",
        "TradingBundleGrantedUser",
        "TradingBundleAccessGrantSummary",
        "CheckoutDetailsDiscount",
        "TradingBundleAccessGrantType",
    ],
)
def test_nested_response_types_are_public(name):
    assert name in sdk.__all__
    assert getattr(sdk, name) is not None


@pytest.mark.parametrize("token", ["future:v2:+/?=&", ""])
def test_opaque_cursor_response_and_next_request(receiver, token):
    receiver.responses = [
        (200, {"users": [], "limit": 1, "nextCursor": token}, {}),
        (200, {"users": [], "limit": 1}, {}),
    ]
    with sdk.RestClient(
        base_url=receiver.url + "/api/rest", account_api_key="vt_synthetic", allow_local_http=True
    ) as client:
        assert len(list(client.list_bundle_users_pages(ID, limit=1))) == 2
    from urllib.parse import parse_qs, urlsplit

    assert parse_qs(urlsplit(receiver.requests[1]["path"]).query, keep_blank_values=True) == {
        "limit": ["1"],
        "cursor": [token],
    }


@pytest.mark.parametrize("value", [True, False])
def test_boolean_body_value_is_redacted(receiver, value):
    receiver.responses = [
        (
            400,
            {"message": "echo " + json.dumps(value), "errorCode": "code", "requestId": "request"},
            {},
        )
    ]
    with sdk.SignalsClient(base_url=receiver.url, allow_local_http=True) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(
                sdk.build_open_signal(
                    version=1, market_price=100, order={"side": "buy"}, force=value
                ),
                strategy_api_key=KEY,
            )
    assert json.dumps(value) not in str(error.value)
    assert error.value.code == "code" and error.value.request_id == "request"
