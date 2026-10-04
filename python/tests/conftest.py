import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest


class Receiver:
    def __init__(self):
        self.requests = []
        self.responses = []
        self.handler = None
        receiver = self

        class Handler(BaseHTTPRequestHandler):
            def handle_request(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                receiver.requests.append(
                    {
                        "method": self.command,
                        "path": self.path,
                        "auth": self.headers.get("Authorization"),
                        "body": body,
                    }
                )
                try:
                    if receiver.handler:
                        receiver.handler(self)
                        return
                    status, value, headers = (
                        receiver.responses.pop(0) if receiver.responses else (204, None, {})
                    )
                    text = (
                        json.dumps(value, ensure_ascii=False).encode()
                        if not isinstance(value, bytes)
                        else value
                    )
                    self.send_response(status)
                    for key, item in headers.items():
                        self.send_header(key, item)
                    self.end_headers()
                    if status != 204:
                        self.wfile.write(text)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            do_GET = do_POST = do_DELETE = handle_request

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
        )
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


@pytest.fixture
def receiver():
    server = Receiver()
    yield server
    server.close()
