import gzip
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import httpx
import pytest

import vector_trading as sdk

LIMIT = 1_048_576
ACCOUNT = "vt_synthetic_bounded_read"
KEYS = {"A": "a" * 32, "B": "b" * 32, "C": "c" * 32}
MISSING = object()


class Stream(httpx.SyncByteStream):
    def __init__(self, chunks, *, before=None, close_error=False, on_close=None):
        self.chunks = chunks
        self.before = before
        self.close_error = close_error
        self.on_close = on_close
        self.reads = 0
        self.closes = 0
        self.eof = False

    def __iter__(self):
        for index, chunk in enumerate(self.chunks):
            if self.before:
                self.before(index)
            self.reads += 1
            yield chunk
        self.eof = True

    def close(self):
        self.closes += 1
        if self.on_close:
            self.on_close()
        if self.close_error:
            raise RuntimeError("synthetic_private_close_failure " + KEYS["A"])


def client(kind, receive, **options):
    transport = httpx.MockTransport(receive)
    if kind == "rest":
        return sdk.RestClient(
            base_url="https://example.com/api/rest",
            account_api_key=ACCOUNT,
            transport=transport,
            **options,
        )
    return sdk.SignalsClient(base_url="https://example.com", transport=transport, **options)


def invoke(instance, kind, label="A", **options):
    if kind == "rest":
        return instance.list_bundles(cursor=label, **options)
    return instance.send(
        sdk.build_start_signal(version=1, timestamp="123"), strategy_api_key=KEYS[label], **options
    )


def success(kind):
    return (
        httpx.Response(200, json={"bundles": [], "limit": 1})
        if kind == "rest"
        else httpx.Response(204)
    )


def document(size, shape="success", *, unicode=False, bom=False):
    prefix = (b"\xef\xbb\xbf" if bom else b"") + (
        b'{"bundles":[],"limit":1,"padding":"'
        if shape == "success"
        else b'{"errorCode":"public-code","requestId":"body-id","message":"'
    )
    suffix = b'"}'
    length = size - len(prefix) - len(suffix)
    if unicode:
        fill = "😀".encode() * (length // 4) + b" " * (length % 4)
    else:
        fill = b"x" * length
    return prefix + fill + suffix


@pytest.mark.parametrize("size", [LIMIT - 1, LIMIT, LIMIT + 1])
@pytest.mark.parametrize("shape", ["success", "error", "non-json"])
@pytest.mark.parametrize("chunk_size", [None, 65536])
@pytest.mark.parametrize("length_header", [None, "1", str(LIMIT * 4)])
def test_body_limit_is_actual_bytes_before_status_parsing(size, shape, chunk_size, length_header):
    body = b"x" * size if shape == "non-json" else document(size, shape)
    chunks = (
        [body]
        if chunk_size is None
        else [body[i : i + chunk_size] for i in range(0, len(body), chunk_size)]
    )
    stream = Stream(chunks)
    requests = []

    def receive(request):
        requests.append(request)
        headers = {} if length_header is None else {"Content-Length": length_header}
        return httpx.Response(200 if shape == "success" else 400, headers=headers, stream=stream)

    with client("rest", receive) as instance:
        if size > LIMIT:
            with pytest.raises(sdk.SdkError) as error:
                invoke(instance, "rest")
            assert error.value.kind == "protocol"
            assert str(error.value) == "Response exceeds 1 MiB"
            assert (error.value.status, error.value.code, error.value.request_id) == (
                None,
                None,
                None,
            )
            assert not stream.eof
        elif shape == "success":
            assert invoke(instance, "rest").bundles == []
            assert stream.eof
        else:
            with pytest.raises(sdk.SdkError) as error:
                invoke(instance, "rest")
            assert error.value.kind == "http" and error.value.status == 400
            assert len(str(error.value)) <= 512
            if shape == "error":
                assert (error.value.code, error.value.request_id) == ("public-code", "body-id")
            assert stream.eof
    assert stream.closes == 1 and len(requests) == 1


@pytest.mark.parametrize("size", [LIMIT, LIMIT + 1])
@pytest.mark.parametrize("bom", [False, True])
def test_utf8_bom_and_split_characters_count_bytes(size, bom):
    body = document(size, unicode=True, bom=bom)
    assert len(body) == size
    # Split the first emoji between its UTF-8 bytes, then use bounded portions.
    split = body.index("😀".encode()) + 1
    stream = Stream([body[:split]] + [body[i : i + 65536] for i in range(split, len(body), 65536)])
    with client("rest", lambda _: httpx.Response(200, stream=stream)) as instance:
        if size > LIMIT:
            with pytest.raises(sdk.SdkError) as error:
                invoke(instance, "rest")
            assert error.value.kind == "protocol"
        else:
            assert invoke(instance, "rest").bundles == []
    assert stream.closes == 1


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("size", [LIMIT, LIMIT + 1])
def test_gzip_counts_decoded_body(kind, size):
    compressed = gzip.compress(document(size, "success" if kind == "rest" else "error"))
    assert len(compressed) < LIMIT
    stream = Stream([compressed])
    with client(
        kind,
        lambda _: httpx.Response(
            200 if kind == "rest" else 400,
            headers={"Content-Encoding": "gzip", "Content-Length": str(len(compressed))},
            stream=stream,
        ),
    ) as instance:
        if size > LIMIT or kind == "signals":
            with pytest.raises(sdk.SdkError) as error:
                invoke(instance, kind)
            assert error.value.kind == ("protocol" if size > LIMIT else "http")
        else:
            assert invoke(instance, kind).bundles == []
    assert stream.closes == 1


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("value", [MISSING, None, 42, False, [], {}, "", "body-id"])
@pytest.mark.parametrize("with_header", [False, True])
def test_request_id_uses_string_body_otherwise_header(kind, value, with_header):
    body = {"message": "Rejected", "errorCode": "public-code"}
    if value is not MISSING:
        body["requestId"] = value
    headers = {"x-request-id": "header-id"} if with_header else {}
    with client(kind, lambda _: httpx.Response(400, json=body, headers=headers)) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind)
    assert error.value.kind == "http"
    assert error.value.status == 400 and error.value.code == "public-code"
    assert error.value.request_id == (
        value if isinstance(value, str) else "header-id" if with_header else None
    )


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("source", ["body", "header"])
@pytest.mark.parametrize("value_kind", ["key", "url"])
def test_request_id_selection_preserves_redaction(kind, source, value_kind):
    secret = ACCOUNT if kind == "rest" else KEYS["A"]
    private = secret if value_kind == "key" else "https://example.com/webhooks/signals/v1/" + secret
    body = {
        "message": "Rejected",
        "requestId": private if source == "body" else 42,
        "errorCode": "public-code",
    }
    with client(
        kind, lambda _: httpx.Response(400, json=body, headers={"x-request-id": private})
    ) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind)
    assert error.value.request_id == "[redacted]"
    assert secret not in str(error.value) and secret not in repr(error.value)
    assert (error.value.status, error.value.code) == (400, "public-code")


@pytest.mark.parametrize("kind", ["rest", "signals"])
def test_limit_stops_before_eof_closes_only_response_and_allows_next_call(kind):
    stream = Stream([document(LIMIT + 1, "success" if kind == "rest" else "error"), b"unread-tail"])
    requests = []

    def receive(request):
        requests.append(request)
        return (
            httpx.Response(200 if kind == "rest" else 400, stream=stream)
            if len(requests) == 1
            else success(kind)
        )

    with client(kind, receive) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind)
        assert error.value.kind == "protocol"
        assert stream.reads == 1 and not stream.eof and stream.closes == 1
        invoke(instance, kind, "C")
    assert len(requests) == 2
    assert (
        requests[1].url.params["cursor"]
        if kind == "rest"
        else requests[1].url.path.rsplit("/", 1)[-1]
    ) == ("C" if kind == "rest" else KEYS["C"])


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("failure", ["cancelled", "timeout"])
def test_abort_precedes_oversize_and_next_call_is_available(kind, failure, monkeypatch):
    event = Event()
    clock = [0.0]
    monkeypatch.setattr("vector_trading.transport.time.monotonic", lambda: clock[0])

    def before(index):
        if index == 1:
            if failure == "cancelled":
                event.set()
            else:
                clock[0] = 2.0

    stream = Stream([b"{", b"x" * (LIMIT + 1), b"unread-tail"], before=before)
    requests = []

    def receive(request):
        requests.append(request)
        return httpx.Response(400, stream=stream) if len(requests) == 1 else success(kind)

    with client(kind, receive, timeout=1.0) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind, cancel_event=event)
        assert error.value.kind == failure
        assert stream.reads == 2 and not stream.eof and stream.closes == 1
        clock[0] = 0.0
        invoke(instance, kind, "C")
    assert len(requests) == 2


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("failure", ["protocol", "cancelled", "timeout", "none"])
def test_cleanup_exception_preserves_safe_selected_outcome(kind, failure, monkeypatch):
    event = Event()
    clock = [0.0]
    monkeypatch.setattr("vector_trading.transport.time.monotonic", lambda: clock[0])

    def before(_index):
        if failure == "cancelled":
            event.set()
        elif failure == "timeout":
            clock[0] = 2.0

    stream = Stream(
        [b"x" * (LIMIT + 1) if failure == "protocol" else b"{}"], before=before, close_error=True
    )
    requests = []

    def receive(request):
        requests.append(request)
        return httpx.Response(400, stream=stream) if len(requests) == 1 else success(kind)

    with client(kind, receive, timeout=1.0) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind, cancel_event=event)
        assert error.value.kind == ("transport" if failure == "none" else failure)
        assert "synthetic_private_close_failure" not in str(error.value)
        assert KEYS["A"] not in str(error.value)
        assert error.value.__context__ is None and error.value.__cause__ is None
        clock[0] = 0.0
        invoke(instance, kind, "C")
    assert stream.closes == 1 and len(requests) == 2


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("order", [("A", "B"), ("B", "A")])
def test_concurrent_oversize_does_not_cancel_independent_request(kind, order):
    arrived = Barrier(3)
    release = {label: Event() for label in ("A", "B")}
    streams = {}
    requests = []

    def receive(request):
        label = (
            request.url.params["cursor"]
            if kind == "rest"
            else next(label for label, key in KEYS.items() if request.url.path.endswith(key))
        )
        requests.append(label)
        if label == "C":
            return success(kind)

        def before(_index):
            arrived.wait(timeout=3)
            assert release[label].wait(timeout=3)

        stream = Stream(
            [document(LIMIT + 1) if label == "A" else b'{"bundles":[],"limit":1}'], before=before
        )
        streams[label] = stream
        if kind == "signals" and label == "B":
            stream.chunks = [b""]
        return httpx.Response(
            400 if kind == "signals" and label == "A" else 204 if kind == "signals" else 200,
            stream=stream,
        )

    def perform(instance, label):
        try:
            invoke(instance, kind, label)
            return "ok"
        except sdk.SdkError as error:
            return error.kind

    with client(kind, receive) as instance, ThreadPoolExecutor(max_workers=2) as executor:
        futures = {label: executor.submit(perform, instance, label) for label in ("A", "B")}
        outcomes = {}
        try:
            arrived.wait(timeout=3)
            for label in order:
                release[label].set()
                outcomes[label] = futures[label].result(timeout=3)
        finally:
            for ready in release.values():
                ready.set()
        invoke(instance, kind, "C")
    assert outcomes == {"A": "protocol", "B": "ok"}
    assert sorted(requests) == ["A", "B", "C"]
    assert all(stream.closes == 1 for stream in streams.values())


@pytest.mark.parametrize("kind", ["rest", "signals"])
@pytest.mark.parametrize("network_failure", [False, True])
def test_cleanup_late_cancel_preserves_protocol_and_existing_network_precedence(
    kind, network_failure
):
    event = Event()

    def before(_index):
        if network_failure:
            raise httpx.ReadTimeout("synthetic_private_network_failure")

    stream = Stream([b"x" * (LIMIT + 1)], before=before, on_close=event.set)
    requests = []

    def receive(request):
        requests.append(request)
        return httpx.Response(400, stream=stream) if len(requests) == 1 else success(kind)

    with client(kind, receive) as instance:
        with pytest.raises(sdk.SdkError) as error:
            invoke(instance, kind, cancel_event=event)
        assert error.value.kind == ("cancelled" if network_failure else "protocol")
        assert error.value.__context__ is None
        invoke(instance, kind, "C")
    assert stream.closes == 1 and len(requests) == 2
