import json
import logging
import math
import re
import time
import traceback
from datetime import datetime
from pathlib import Path
from threading import Event, Timer
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from pydantic import ValidationError

import vector_trading as sdk

ROOT = Path(__file__).resolve().parents[2]
REST = json.loads((ROOT / "conformance/rest/cases.json").read_text())
SIGNALS = json.loads((ROOT / "conformance/signals/cases.json").read_text())
ID = "b" * 32
KEY = "a" * 32
ACCOUNT = "vt_synthetic_test_account_only"
ALIASES = {
    "displayName": "display_name",
    "grantType": "grant_type",
    "sourceId": "source_id",
    "userId": "user_id",
    "startsAfter": "starts_after",
    "startsBefore": "starts_before",
    "endsAfter": "ends_after",
    "endsBefore": "ends_before",
    "createdAfter": "created_after",
    "createdBefore": "created_before",
}


def rest(receiver, **options):
    return sdk.RestClient(
        base_url=receiver.url + "/api/rest",
        account_api_key=ACCOUNT,
        allow_local_http=True,
        **options,
    )


def signals(receiver, **options):
    return sdk.SignalsClient(
        base_url=receiver.url, strategy_api_key=KEY, allow_local_http=True, **options
    )


def call_fixture(client, case, body_model=False):
    req = case["request"]
    query = {ALIASES.get(k, k): v for k, v in req["query"].items()}
    match case["operationId"]:
        case "listBundles":
            return client.list_bundles(**query)
        case "searchUsers":
            return client.search_users(**query)
        case "getCheckout":
            return client.get_checkout(req["path"].split("/")[-1])
        case "listBundleUsers":
            return client.list_bundle_users(req["path"].split("/")[3], **query)
        case "listBundleGrants":
            return client.list_bundle_grants(req["path"].split("/")[3], **query)
        case "createBundleGrant":
            body = sdk.CreateGrantRequest.from_dict(req["body"]) if body_model else req["body"]
            return client.create_bundle_grant(req["path"].split("/")[3], body)
        case "revokeBundleGrant":
            return client.revoke_bundle_grant(req["path"].split("/")[3], req["path"].split("/")[-1])


@pytest.mark.parametrize("case", REST, ids=lambda c: c["id"])
def test_rest_fixtures(receiver, case):
    receiver.responses.append((200, case.get("response"), {}))
    with rest(receiver) as client:
        if case["expectedStatus"] != 200:
            with pytest.raises(sdk.SdkError) as error:
                call_fixture(client, case)
            assert error.value.kind == "validation" and error.value.__context__ is None
            assert receiver.requests == []
            return
        model = call_fixture(client, case)

        def normalized(value):
            if isinstance(value, dict):
                return {key: normalized(item) for key, item in value.items()}
            if isinstance(value, list):
                return [normalized(item) for item in value]
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT.+", value):
                return datetime.fromisoformat(value)
            return value

        assert normalized(json.loads(model.to_json())) == normalized(case["response"])
    sent = receiver.requests[0]
    req = case["request"]
    assert urlsplit(sent["path"]).path == "/api/rest" + req["path"]
    assert parse_qs(urlsplit(sent["path"]).query) == {k: [str(v)] for k, v in req["query"].items()}
    assert sent["method"] == req["method"]
    assert sent["auth"] == "Bearer " + ACCOUNT
    if "body" in req:
        assert json.loads(sent["body"]) == req["body"]
    else:
        assert sent["body"] == b""


@pytest.mark.parametrize("case", SIGNALS, ids=lambda c: c["id"])
def test_signal_fixtures(receiver, case):
    with signals(receiver) as client:
        if not (case["schemaAccepted"] and case["parserAccepted"]):
            with pytest.raises(sdk.SdkError):
                sdk.serialize_signal(case["payload"])
            assert receiver.requests == []
            return
        message = sdk.build_signal(case["payload"])
        assert json.loads(sdk.serialize_signal(message)) == case["payload"]
        assert client.send(message) is None
        sent = receiver.requests[0]
        assert sent["path"] == "/webhooks/signals/v1/" + KEY
        assert sent["auth"] is None
        assert json.loads(sent["body"]) == case["payload"]


def test_import_and_construction_offline(monkeypatch):
    monkeypatch.setattr(httpx.Client, "send", lambda *_args, **_kw: pytest.fail("Unexpected I/O"))
    with sdk.RestClient(base_url="https://example.com/api/rest", account_api_key=ACCOUNT):
        pass
    with sdk.SignalsClient(base_url="https://example.com", strategy_api_key=KEY):
        assert sdk.build_start_signal(version=1).timestamp.isdecimal()
    for url in [
        "http://example.com",
        "http://127.0.0.1",
        "https://user:password@example.com",
        "https://example.com?key=private",
        "invalid",
    ]:
        with pytest.raises(sdk.SdkError):
            sdk.RestClient(base_url=url, account_api_key=ACCOUNT)
    with pytest.raises(sdk.SdkError):
        sdk.SignalsClient(base_url="https://example.com", strategy_api_key=ACCOUNT)
    for timeout in [None, "slow", True, 0, -1, math.inf, math.nan]:
        with pytest.raises(sdk.SdkError):
            sdk.RestClient(base_url="https://example.com", account_api_key=ACCOUNT, timeout=timeout)


def test_named_builders_and_omission(receiver):
    built = [
        sdk.build_open_signal(
            version=1.5, market_price=100, order={"side": "buy"}, force=False, timestamp="123"
        ),
        sdk.build_update_signal(
            version=1.5,
            market_price=100,
            order=sdk.UpdateSignalPayloadOrder(side="buy", take_profits=[]),
            timestamp="123",
        ),
    ]
    for action in ["cancel", "close", "start", "pause", "stop", "delete"]:
        built.append(getattr(sdk, "build_" + action + "_signal")(version=1.5, timestamp="123"))
    with signals(receiver) as client:
        for message in built:
            client.send(message)
        client.send(built[0])
    assert len(receiver.requests) == 9
    assert receiver.requests[0]["body"] == receiver.requests[-1]["body"]
    assert "takeProfits" not in json.loads(receiver.requests[0]["body"])["order"]
    assert json.loads(receiver.requests[1]["body"])["order"]["takeProfits"] == []
    original = {"action": "update", "version": 1.5, "marketPrice": 100, "order": {"side": "buy"}}
    clone = sdk.build_signal(original)
    original["order"]["side"] = "sell"
    assert clone.order.side == "buy"
    with pytest.raises(ValidationError):
        sdk.UpdateSignalPayloadOrder(side="buy", take_profits=None)
    with pytest.raises(ValidationError) as model_error:
        sdk.PublicUser(user_id={"private": "sensitive_model_value"}, display_name="Alice")
    assert "sensitive_model_value" not in str(model_error.value)
    for kwargs in [{"timestamp": None}, {"hashtag": None}]:
        with pytest.raises(sdk.SdkError):
            sdk.build_start_signal(version=1, **kwargs)
    with pytest.raises(TypeError):
        sdk.build_pause_signal(version=1, force=True)


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), math.nan, 0, -1, True, "1", None])
def test_invalid_numbers(value):
    with pytest.raises(sdk.SdkError):
        sdk.build_open_signal(version=value, market_price=100, order={"side": "buy"})
    with pytest.raises(sdk.SdkError):
        sdk.build_open_signal(version=1, market_price=value, order={"side": "buy"})


@pytest.mark.parametrize(
    "order",
    [
        {"side": "buy", "stop": 100},
        {"side": "sell", "stop": 99},
        {"side": "sell", "price": 90},
        {"side": "sell", "triggerPrice": 110},
        {"side": "buy", "price": 110, "triggerPrice": 105},
        {
            "side": "buy",
            "takeProfits": [{"price": 110, "percent": 60}, {"price": 120, "percent": 41}],
        },
        {"side": "buy", "takeProfits": None},
        {"side": "buy", "takeProfits": "bad"},
        {"side": "buy", "price": math.nan},
    ],
)
def test_invalid_protection(order):
    with pytest.raises(sdk.SdkError):
        sdk.build_update_signal(version=1, market_price=100, order=order)
    with pytest.raises(sdk.SdkError):
        sdk.build_start_signal(version=1, timestamp="9007199254740992")


@pytest.mark.parametrize(
    "kind,field",
    [("bundles", "bundles"), ("users", "users"), ("bundle_users", "users"), ("grants", "grants")],
)
def test_pagination(receiver, kind, field):
    data = {field: [], "limit": 10}
    if kind == "users":
        data["query"] = 'Алиса " \\'
    cursor = "grant:" + ID if kind == "bundle_users" else ID
    receiver.responses = [(200, {**data, "nextCursor": cursor}, {}), (200, data, {})]
    with rest(receiver) as client:
        match kind:
            case "bundles":
                pages = client.list_bundles_pages(limit=10)
            case "users":
                pages = client.search_users_pages(display_name=data["query"], limit=10)
            case "bundle_users":
                pages = client.list_bundle_users_pages(ID, limit=10)
            case _:
                filters = {
                    name: "2026-07-19T12:00:00.000Z"
                    for name in [
                        "starts_after",
                        "starts_before",
                        "ends_after",
                        "ends_before",
                        "created_after",
                        "created_before",
                    ]
                }
                pages = client.list_bundle_grants_pages(
                    ID,
                    limit=10,
                    grant_type="paid_external",
                    user_id=ID,
                    source_id="invoice:1",
                    sort="endsAt",
                    dir="asc",
                    **filters,
                )
        assert receiver.requests == []
        assert len(list(pages)) == 2
    queries = [parse_qs(urlsplit(req["path"]).query) for req in receiver.requests]
    assert queries[0].get("cursor") is None
    assert queries[1].pop("cursor") == [cursor]
    assert queries[0] == queries[1]
    if kind == "grants":
        assert len(queries[0]) == 12
    if kind == "users":
        assert queries[0]["displayName"] == [data["query"]]


def test_repeated_cursor_and_cancel_pages(receiver):
    response = {"bundles": [], "limit": 10, "nextCursor": ID}
    receiver.responses = [(200, response, {}), (200, response, {})]
    with rest(receiver) as client:
        iterator = client.list_bundles_pages()
        next(iterator)
        next(iterator)
        with pytest.raises(sdk.SdkError) as error:
            next(iterator)
        assert error.value.kind == "pagination"
    event = Event()
    receiver.responses = [(200, response, {})]
    with rest(receiver) as client:
        iterator = client.list_bundles_pages(cancel_event=event)
        next(iterator)
        event.set()
        with pytest.raises(sdk.SdkError) as error:
            next(iterator)
        assert error.value.kind == "cancelled"
    assert len(receiver.requests) == 3


@pytest.mark.parametrize("status", [400, 401, 403, 404, 409, 410, 413, 429, 500, 502, 503])
def test_errors_and_no_retries(receiver, status):
    response = {
        "message": "Request rejected",
        "errorCode": "errors.vector.501",
        "requestId": "req-123",
    }
    receiver.responses = [(status, response, {}), (status, response, {})]
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.create_bundle_grant(ID, {"userId": ID, "grantType": "gift"})
        assert (error.value.status, error.value.code, error.value.request_id) == (
            status,
            "errors.vector.501",
            "req-123",
        )
    with signals(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        assert (error.value.status, error.value.code, error.value.request_id) == (
            status,
            "errors.vector.501",
            "req-123",
        )
    assert len(receiver.requests) == 2


@pytest.mark.parametrize(
    "body", [b"", b"upstream unavailable", {"success": False, "error": "limited"}]
)
def test_infrastructure_errors(receiver, body):
    receiver.responses = [(429, body, {"x-request-id": "edge-123"})]
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.list_bundles()
        assert error.value.status == 429
        assert error.value.request_id == "edge-123"
        assert "upstream unavailable" not in str(error.value)


def test_safe_errors_and_httpx_logging(receiver, caplog):
    caplog.set_level(logging.DEBUG)
    message = f"{ACCOUNT} Bearer {ACCOUNT} https://example.com/webhooks/signals/v1/{KEY} {ID} private_invoice"
    receiver.responses = [(400, {"message": message}, {}), (400, {"message": message}, {})]
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.create_bundle_grant(
                ID, {"userId": ID, "grantType": "paid_external", "sourceId": "private_invoice"}
            )
        for sensitive in [ACCOUNT, KEY, ID, "private_invoice"]:
            assert sensitive not in str(error.value)
    with signals(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        for sensitive in [ACCOUNT, KEY]:
            assert sensitive not in str(error.value)
    assert ACCOUNT not in caplog.text and KEY not in caplog.text
    calls = []

    def fail(request):
        calls.append(request)
        raise httpx.ConnectError(message, request=request)

    with sdk.SignalsClient(
        base_url="https://example.com", strategy_api_key=KEY, transport=httpx.MockTransport(fail)
    ) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        rendered = "".join(traceback.format_exception(error.value))
        assert KEY not in rendered and ACCOUNT not in rendered
        assert error.value.kind == "transport" and error.value.__context__ is None
    assert len(calls) == 1


def test_deadlines_cancellation_and_cleanup(receiver):
    def hang(handler):
        time.sleep(0.08)
        handler.send_response(204)
        handler.end_headers()

    receiver.handler = hang
    with signals(receiver, timeout=0.02) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        assert error.value.kind == "timeout"
    assert len(receiver.requests) == 1
    event = Event()
    event.set()
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.list_bundles(cancel_event=event)
        assert error.value.kind == "cancelled"
    assert len(receiver.requests) == 1
    receiver.handler = None
    closed = rest(receiver)
    closed.close()
    closed.close()
    with pytest.raises(sdk.SdkError) as error:
        closed.list_bundles()
    assert error.value.kind == "closed"


def test_stream_timeout_and_cancel(receiver):
    def drip(handler):
        handler.send_response(200)
        handler.end_headers()
        for _ in range(20):
            handler.wfile.write(b" ")
            handler.wfile.flush()
            time.sleep(0.01)

    receiver.handler = drip
    with rest(receiver, timeout=0.025) as client:
        start = time.monotonic()
        with pytest.raises(sdk.SdkError) as error:
            client.list_bundles()
        assert error.value.kind == "timeout" and time.monotonic() - start < 0.15
    event = Event()
    timer = Timer(0.025, event.set)
    timer.start()
    try:
        with rest(receiver, timeout=0.5) as client:
            with pytest.raises(sdk.SdkError) as error:
                client.list_bundles(cancel_event=event)
            assert error.value.kind == "cancelled"
    finally:
        timer.cancel()
        timer.join()


def test_redirects_and_protocol(receiver):
    receiver.responses = [
        (307, None, {"Location": "http://127.0.0.1:1/other"}),
        (307, None, {"Location": "http://127.0.0.1:1/other"}),
        (200, {}, {}),
    ]
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.list_bundles()
        assert error.value.status == 307
    with signals(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        assert error.value.status == 307
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        assert error.value.kind == "protocol"
    assert len(receiver.requests) == 3


def test_utf8_body_limit_and_unicode(receiver):
    with rest(receiver) as client:
        for value in [None, "bad", [], {"userId": ID, "grantType": "gift", "endsAt": "2026-07-19"}]:
            with pytest.raises(sdk.SdkError):
                client.create_bundle_grant(ID, value)
        with pytest.raises(sdk.SdkError):
            client.list_bundles(limit=0)
    assert receiver.requests == []
    wire = {"action": "pause", "version": 1, "timestamp": "0" * 16384}
    with pytest.raises(sdk.SdkError):
        sdk.build_signal(wire)
    wire["timestamp"] = "0" * 16000
    with signals(receiver) as client:
        client.send(sdk.build_signal(wire))
    assert len(receiver.requests[0]["body"]) <= 16384
    with pytest.raises(sdk.SdkError):
        sdk.build_signal({"action": "pause", "version": 1, "timestamp": "1", "extra": "данные"})


@pytest.mark.parametrize(
    "response", [None, {"bundles": None, "limit": 10}, {"bundles": [], "limit": "10"}, b"not JSON"]
)
def test_incompatible_responses(receiver, response):
    receiver.responses = [(200, response, {})]
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.list_bundles()
        assert error.value.kind == "protocol" and error.value.__context__ is None


def test_optional_fields_and_dates(receiver):
    receiver.responses = [
        (
            200,
            {
                "users": [{"userId": ID, "displayName": "Алиса", "avatar": None, "future": True}],
                "query": "Ал",
                "limit": 10,
                "future": "optional",
            },
            {},
        )
    ]
    with rest(receiver) as client:
        page = client.search_users(display_name="Ал")
        assert page.users[0].avatar is None
        assert page.users[0].to_dict()["avatar"] is None
    assert "avatar" not in sdk.PublicUser(user_id=ID, display_name="Alice").to_dict()
    case = next(case for case in REST if case["id"] == "create-paid-until")
    receiver.responses = [(200, case["response"], {})]
    with rest(receiver) as client:
        call_fixture(client, case, body_model=True)
    wire = json.loads(receiver.requests[-1]["body"])
    assert datetime.fromisoformat(wire["endsAt"]) == datetime.fromisoformat(
        case["request"]["body"]["endsAt"]
    )
    assert wire["sourceId"] == case["request"]["body"]["sourceId"]


def test_lost_mutation_responses_are_not_retried(receiver):
    def drop(handler):
        handler.connection.shutdown(2)
        handler.connection.close()

    receiver.handler = drop
    with rest(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.create_bundle_grant(ID, {"userId": ID, "grantType": "gift"})
        assert error.value.kind == "transport" and "unknown" in str(error.value)
    with signals(receiver) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.send(sdk.build_start_signal(version=1))
        assert error.value.kind == "transport"
    assert len(receiver.requests) == 2


def test_mutation_timeout_is_not_retried(receiver):
    def hang(handler):
        time.sleep(0.08)
        handler.send_response(200)
        handler.end_headers()

    receiver.handler = hang
    with rest(receiver, timeout=0.02) as client:
        with pytest.raises(sdk.SdkError) as error:
            client.create_bundle_grant(ID, {"userId": ID, "grantType": "gift"})
        assert error.value.kind == "timeout"
    assert len(receiver.requests) == 1
