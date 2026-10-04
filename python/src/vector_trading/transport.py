import json
import math
import re
import time
from threading import Event
from typing import Any, Self
from urllib.parse import urlsplit

import httpx

from .errors import SdkError

_MAX_RESPONSE_BYTES = 1_048_576


class _SafeURL(httpx.URL):
    # HTTPX logs URL objects. Preserve wire components but hide private paths and queries.
    def __str__(self) -> str:
        return f"{self.scheme}://{self.host}/[redacted]"

    def __repr__(self) -> str:
        return "URL('[redacted]')"


class Transport:
    def __init__(
        self,
        base_url: str,
        secret: str | None = None,
        *,
        timeout: float = 10.0,
        allow_local_http: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        try:
            url = urlsplit(base_url)
            valid = url.scheme == "https" or (
                url.scheme == "http"
                and allow_local_http
                and url.hostname in ("localhost", "127.0.0.1", "::1")
            )
            valid &= bool(url.hostname) and not bool(
                url.username or url.password or url.query or url.fragment
            )
            _ = url.port
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise SdkError("validation", "base_url requires HTTPS or explicitly allowed local HTTP")
        if secret is not None and (
            not isinstance(secret, str) or not secret or any(char in secret for char in "\r\n")
        ):
            raise SdkError("validation", "A valid credential is required")
        if (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or timeout <= 0
        ):
            raise SdkError("validation", "timeout must be a positive finite number")
        self.base_url = base_url.rstrip("/")
        self.__secret = secret
        self.__timeout = timeout
        self.__client = httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            transport=transport or httpx.HTTPTransport(retries=0),
        )

    def close(self) -> None:
        self.__client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _clean(
        self,
        value: Any,
        body: str | None,
        request_secret: str | None,
        *,
        submitted: bool = True,
    ) -> str | None:
        if not isinstance(value, str):
            return None
        sensitive = [secret for secret in (self.__secret, request_secret) if secret is not None]
        if submitted and body:

            def leaves(obj: Any) -> list[str]:
                if isinstance(obj, dict):
                    return [leaf for item in obj.values() for leaf in leaves(item)]
                if isinstance(obj, list):
                    return [leaf for item in obj for leaf in leaves(item)]
                if isinstance(obj, bool):
                    return [json.dumps(obj)]
                return [str(obj)] if isinstance(obj, (str, int, float)) else []

            sensitive.extend(leaves(json.loads(body)))
        for secret in sorted(filter(None, sensitive), key=len, reverse=True):
            value = value.replace(secret, "[redacted]")
        return (
            re.sub(r"https?://\S+|Bearer\s+\S+|vt_[A-Za-z0-9_-]+", "[redacted]", value, flags=re.I)
            .replace("\n", " ")
            .replace("\r", " ")[:512]
        )

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: str | None = None,
        account_key: bool = False,
        request_secret: str | None = None,
        cancel_event: Event | None = None,
    ) -> tuple[int, Any]:
        if self.__client.is_closed:
            raise SdkError("closed", "Client is closed")
        if cancel_event is not None and cancel_event.is_set():
            raise SdkError("cancelled", "Request was cancelled")
        if body is not None and len(body.encode()) > 16 * 1024:
            raise SdkError("validation", "Request body exceeds 16 KiB")
        headers = {"Content-Type": "application/json"} if body is not None else {}
        if account_key:
            if self.__secret is None:
                raise SdkError("validation", "An account credential is required")
            headers["Authorization"] = "Bearer " + self.__secret
        request = self.__client.build_request(
            method,
            self.base_url + path,
            params=params,
            content=body.encode() if body is not None else None,
            headers=headers,
        )
        request.url = _SafeURL(request.url)
        started = time.monotonic()
        failure: SdkError | None = None
        selected_sdk_failure = False
        response: httpx.Response | None = None
        data = bytearray()
        try:
            response = self.__client.send(request, stream=True)
            for chunk in response.iter_bytes():
                if cancel_event is not None and cancel_event.is_set():
                    raise SdkError("cancelled", "Request was cancelled; its outcome may be unknown")
                if time.monotonic() - started >= self.__timeout:
                    raise SdkError("timeout", "Request timed out; its outcome may be unknown")
                if len(data) + len(chunk) > _MAX_RESPONSE_BYTES:
                    raise SdkError("protocol", "Response exceeds 1 MiB")
                data.extend(chunk)
            if cancel_event is not None and cancel_event.is_set():
                raise SdkError("cancelled", "Request was cancelled; its outcome may be unknown")
        except httpx.TimeoutException:
            failure = SdkError("timeout", "Request timed out; its outcome may be unknown")
        except SdkError as error:
            failure = error
            selected_sdk_failure = True
        except Exception:
            failure = SdkError("transport", "HTTP transport failed; its outcome may be unknown")
        finally:
            if response is not None:
                try:
                    response.close()
                except Exception:
                    if failure is None:
                        failure = SdkError(
                            "transport", "HTTP transport failed; its outcome may be unknown"
                        )
        if failure is not None:
            # Cleanup cannot replace a selected SDK outcome; network failures retain
            # their existing late cancellation precedence.
            if not selected_sdk_failure and cancel_event is not None and cancel_event.is_set():
                raise SdkError("cancelled", "Request was cancelled; its outcome may be unknown")
            raise failure
        if time.monotonic() - started >= self.__timeout:
            raise SdkError("timeout", "Request timed out; its outcome may be unknown")
        assert response is not None
        parsed: Any = None
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeError):
            pass
        if not 200 <= response.status_code < 300:
            details = parsed if isinstance(parsed, dict) else {}
            request_id = details.get("requestId")
            if not isinstance(request_id, str):
                request_id = response.headers.get("x-request-id")
            raise SdkError(
                "http",
                self._clean(details.get("message", details.get("error")), body, request_secret)
                or f"HTTP request failed ({response.status_code})",
                status=response.status_code,
                code=self._clean(details.get("errorCode"), body, request_secret, submitted=False),
                request_id=self._clean(
                    request_id,
                    body,
                    request_secret,
                    submitted=False,
                ),
            )
        return response.status_code, parsed
