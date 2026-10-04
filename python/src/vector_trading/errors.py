from typing import Literal

ErrorKind = Literal[
    "validation", "http", "transport", "timeout", "cancelled", "protocol", "pagination", "closed"
]


class SdkError(Exception):
    """Bounded safe diagnostics; never retains an HTTP request or underlying cause."""

    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        *,
        status: int | None = None,
        code: str | None = None,
        request_id: str | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.code = code
        self.request_id = request_id
