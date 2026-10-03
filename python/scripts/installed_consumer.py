"""Executed only from copied files in clean, non-editable consumer environments."""

import importlib
import json
import logging
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from threading import Thread

import httpx

original_send = httpx.Client.send
httpx.Client.send = lambda *_args, **_kwargs: (_ for _ in ()).throw(
    AssertionError("Import performed I/O")
)
sdk = importlib.import_module("vector_trading")
httpx.Client.send = original_send

requests = []
account_key, strategy_key, identifier = "vt_consumer_synthetic", "a" * 32, "b" * 32


class Handler(BaseHTTPRequestHandler):
    def serve(self):
        data = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        requests.append((self.command, self.path, self.headers.get("Authorization"), data))
        self.send_response(204 if "/webhooks/" in self.path else 200)
        self.end_headers()
        if "/webhooks/" in self.path:
            return
        if "/checkout/" in self.path:
            body = {
                "checkoutId": identifier,
                "bundleId": identifier,
                "userId": identifier,
                "displayName": "Example",
            }
        elif self.command in ("POST", "DELETE"):
            body = {"grant": {"id": identifier, "grantType": "gift"}}
        elif "/grants" in self.path:
            body = {"grants": [], "limit": 50}
        elif "/bundles/" in self.path and "/users" in self.path:
            body = {"users": [], "limit": 50}
        elif "/v1/users" in self.path:
            body = {"users": [], "limit": 10, "query": "Ал"}
        else:
            body = {"bundles": [], "limit": 50}
        self.wfile.write(json.dumps(body).encode())

    do_GET = do_POST = do_DELETE = serve

    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
thread.start()
origin = "http://127.0.0.1:" + str(server.server_port)
log_stream = StringIO()
logging.basicConfig(stream=log_stream, level=logging.DEBUG)
try:
    with (
        sdk.RestClient(
            base_url=origin + "/api/rest", account_api_key=account_key, allow_local_http=True
        ) as rest,
        sdk.SignalsClient(
            base_url=origin, strategy_api_key=strategy_key, allow_local_http=True
        ) as signals,
    ):
        assert requests == []
        rest.list_bundles()
        rest.search_users(display_name="Ал")
        rest.get_checkout(identifier)
        rest.list_bundle_users(identifier)
        rest.list_bundle_grants(identifier)
        rest.create_bundle_grant(identifier, {"userId": identifier, "grantType": "gift"})
        rest.revoke_bundle_grant(identifier, identifier)
        messages = [
            sdk.build_open_signal(version=1, market_price=100, order={"side": "buy"}),
            sdk.build_update_signal(
                version=1, market_price=100, order={"side": "buy", "takeProfits": []}
            ),
        ]
        messages += [
            getattr(sdk, "build_" + action + "_signal")(version=1)
            for action in ("cancel", "close", "start", "pause", "stop", "delete")
        ]
        for message in messages:
            assert signals.send(message) is None
        signals.send(messages[0])
    assert len(requests) == 16
    assert all(item[2] == "Bearer " + account_key for item in requests[:7])
    assert all(item[2] is None and item[1].endswith(strategy_key) for item in requests[7:])
    assert requests[7][3] == requests[-1][3]
    assert json.loads(requests[8][3])["order"]["takeProfits"] == []
    assert account_key not in log_stream.getvalue() and strategy_key not in log_stream.getvalue()
    print(
        "Installed package: seven REST methods, eight signals, stable delivery, safe logging, and TP clearing passed."
    )
finally:
    server.shutdown()
    server.server_close()
    thread.join()
