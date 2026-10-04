import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import httpx
import pytest

import vector_trading as sdk

KEY_A, KEY_B, KEY_C = "a" * 32, "b" * 32, "c" * 32


def client(receiver, **options):
    return sdk.SignalsClient(base_url=receiver.url, allow_local_http=True, **options)


def payload():
    return sdk.build_start_signal(version=1, timestamp="123")


@pytest.mark.parametrize(
    "key",
    [
        None,
        1,
        [],
        "",
        "a" * 31,
        "a" * 33,
        "A" * 32,
        "a" * 32 + "\n",
        " " + "a" * 32,
        "a/" * 16,
        "é" * 32,
    ],
)
def test_invalid_key_precedes_payload_validation_and_has_no_io(receiver, key):
    with client(receiver) as signals:
        with pytest.raises(sdk.SdkError) as error:
            signals.send({}, strategy_api_key=key)
        assert error.value.kind == "validation"
        assert "strategy_api_key" in str(error.value)
        assert receiver.requests == []
        signals.send(payload(), strategy_api_key=KEY_C)
    assert len(receiver.requests) == 1
    assert receiver.requests[0]["path"] == "/webhooks/signals/v1/" + KEY_C


def test_key_is_required_only_on_send_and_closed_client_stays_closed(receiver):
    with client(receiver) as signals:
        assert receiver.requests == []
        with pytest.raises(TypeError):
            signals.send(payload())
    with pytest.raises(sdk.SdkError) as error:
        signals.send(payload(), strategy_api_key=KEY_C)
    assert error.value.kind == "closed" and receiver.requests == []
    with pytest.raises(TypeError):
        sdk.SignalsClient(base_url=receiver.url, strategy_api_key=KEY_A)


def test_two_keys_reuse_one_client_without_changing_the_signal(receiver, caplog):
    caplog.set_level(logging.DEBUG)
    message = payload()
    with client(receiver) as signals:
        signals.send(message, strategy_api_key=KEY_A)
        signals.send(message, strategy_api_key=KEY_B)
    assert [r["path"] for r in receiver.requests] == [
        "/webhooks/signals/v1/" + key for key in (KEY_A, KEY_B)
    ]
    assert all(r["auth"] is None for r in receiver.requests)
    assert receiver.requests[0]["body"] == receiver.requests[1]["body"]
    assert json.loads(receiver.requests[0]["body"]) == {
        "action": "start",
        "timestamp": "123",
        "version": 1,
    }
    assert KEY_A not in caplog.text and KEY_B not in caplog.text


@pytest.mark.parametrize("reply_order", [(KEY_A, KEY_B), (KEY_B, KEY_A)])
def test_concurrent_errors_redact_each_request_key(receiver, reply_order, caplog):
    caplog.set_level(logging.DEBUG)
    arrived = Barrier(3)
    release = {key: Event() for key in (KEY_A, KEY_B)}

    def reply(handler):
        key = handler.path.rsplit("/", 1)[-1]
        arrived.wait(timeout=3)
        assert release[key].wait(timeout=3)
        handler.send_response(400)
        handler.end_headers()
        handler.wfile.write(
            json.dumps(
                {
                    "message": "rejected " + key,
                    "errorCode": "code_" + key,
                    "requestId": "request_" + key,
                }
            ).encode()
        )

    def send(signals, key):
        try:
            signals.send(payload(), strategy_api_key=key)
        except sdk.SdkError as error:
            return error
        pytest.fail("Expected a local test server error")

    receiver.handler = reply
    with client(receiver) as signals, ThreadPoolExecutor(max_workers=2) as executor:
        futures = {key: executor.submit(send, signals, key) for key in (KEY_A, KEY_B)}
        try:
            arrived.wait(timeout=3)
            for key in reply_order:
                release[key].set()
                error = futures[key].result(timeout=3)
                assert error.kind == "http"
                assert str(error) == "rejected [redacted]"
                assert error.code == "code_[redacted]"
                assert error.request_id == "request_[redacted]"
                assert key not in repr(error)
        finally:
            for event in release.values():
                event.set()
        receiver.handler = None
        receiver.responses = [
            (400, {"message": "rejected " + KEY_C, "errorCode": KEY_C, "requestId": KEY_C}, {}),
            (204, None, {}),
        ]
        error = send(signals, KEY_C)
        assert str(error) == "rejected [redacted]"
        assert error.code == error.request_id == "[redacted]"
        signals.send(payload(), strategy_api_key=KEY_A)
    assert len(receiver.requests) == 4
    assert {r["path"] for r in receiver.requests[:2]} == {
        "/webhooks/signals/v1/" + KEY_A,
        "/webhooks/signals/v1/" + KEY_B,
    }
    assert all(r["auth"] is None for r in receiver.requests)
    assert all(r["body"] == receiver.requests[0]["body"] for r in receiver.requests)
    assert all(key not in caplog.text for key in (KEY_A, KEY_B, KEY_C))


def test_transport_timeout_and_cancellation_allow_next_key():
    calls = []

    def receive(request):
        calls.append(request.url.path)
        if len(calls) == 1:
            raise httpx.ReadTimeout("synthetic timeout", request=request)
        return httpx.Response(204)

    with sdk.SignalsClient(
        base_url="https://example.com", transport=httpx.MockTransport(receive)
    ) as signals:
        with pytest.raises(sdk.SdkError) as error:
            signals.send(payload(), strategy_api_key=KEY_A)
        assert error.value.kind == "timeout"
        event = Event()
        event.set()
        with pytest.raises(sdk.SdkError) as error:
            signals.send(payload(), strategy_api_key=KEY_B, cancel_event=event)
        assert error.value.kind == "cancelled"
        signals.send(payload(), strategy_api_key=KEY_C)
    assert calls == ["/webhooks/signals/v1/" + KEY_A, "/webhooks/signals/v1/" + KEY_C]


def test_production_defaults_without_construction_requests():
    requests = []

    def receive(request):
        requests.append((request.url.host, request.url.path))
        if request.url.path.startswith("/webhooks/"):
            return httpx.Response(204)
        return httpx.Response(200, json={"bundles": [], "limit": 50})

    with (
        sdk.RestClient(
            account_api_key="vt_synthetic", transport=httpx.MockTransport(receive)
        ) as rest,
        sdk.SignalsClient(transport=httpx.MockTransport(receive)) as signals,
    ):
        assert requests == []
        rest.list_bundles()
        signals.send(payload(), strategy_api_key=KEY_A)
    assert requests == [
        ("www.vector-trading.app", "/api/rest/v1/bundles"),
        ("www.vector-trading.app", "/webhooks/signals/v1/" + KEY_A),
    ]


@pytest.mark.parametrize("base_url", ["", None, "http://remote.invalid"])
def test_explicit_invalid_address_does_not_use_production(base_url):
    with pytest.raises(sdk.SdkError):
        sdk.SignalsClient(base_url=base_url)
    with pytest.raises(sdk.SdkError):
        sdk.RestClient(base_url=base_url, account_api_key="vt_synthetic")
