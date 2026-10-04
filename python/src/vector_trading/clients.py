import json
import re
from collections.abc import Callable, Iterator
from threading import Event
from typing import Any, Self, TypeVar, cast

import httpx
from pydantic import BaseModel

from ._generated.models.bundle_grants_response import BundleGrantsResponse
from ._generated.models.bundle_users_response import BundleUsersResponse
from ._generated.models.bundles_response import BundlesResponse
from ._generated.models.checkout_details import CheckoutDetails
from ._generated.models.create_grant_request import CreateGrantRequest
from ._generated.models.grant_mutation_response import GrantMutationResponse
from ._generated.models.users_search_response import UsersSearchResponse
from .errors import SdkError
from .signals import StrategySignalPayload, serialize_signal
from .transport import Transport
from .validation import OPERATIONS, validate, validate_body, validate_response

T = TypeVar("T")


class _Client:
    def __init__(
        self,
        base_url: str,
        secret: str | None = None,
        *,
        timeout: float = 10.0,
        allow_local_http: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._transport = Transport(
            base_url,
            secret,
            timeout=timeout,
            allow_local_http=allow_local_http,
            transport=transport,
        )

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()


class RestClient(_Client):
    def __init__(
        self,
        *,
        base_url: str = "https://www.vector-trading.app/api/rest",
        account_api_key: str,
        timeout: float = 10.0,
        allow_local_http: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if (
            not isinstance(account_api_key, str)
            or not account_api_key
            or any(char in account_api_key for char in "\r\n")
        ):
            raise SdkError("validation", "A valid credential is required")
        super().__init__(
            base_url,
            account_api_key,
            timeout=timeout,
            allow_local_http=allow_local_http,
            transport=transport,
        )

    def _call(
        self,
        operation: str,
        parameters: dict[str, Any],
        model: Any,
        cancel_event: Event | None = None,
        body: Any = None,
    ) -> Any:
        method, path, op = OPERATIONS[operation]
        query = {}
        valid = True
        try:
            for parameter in op.get("parameters", []):
                name = parameter["name"]
                value = parameters.get(name)
                if value is None:
                    if parameter.get("required"):
                        raise ValueError("Missing parameter")
                    continue
                validate(parameter["schema"], value)
                if parameter["in"] == "path":
                    path = path.replace("{" + name + "}", value)
                else:
                    query[name] = value
        except (ValueError, TypeError, OverflowError):
            valid = False
        if not valid:
            raise SdkError("validation", "Request parameters do not match the public contract")
        if isinstance(body, BaseModel):
            body = json.loads(cast(Any, body).to_json())
        validate_body(operation, body)
        status, result = self._transport.request(
            method,
            path,
            params=query,
            body=json.dumps(body, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            if body is not None
            else None,
            account_key=True,
            cancel_event=cancel_event,
        )
        if status != 200:
            raise SdkError("protocol", "Expected REST response status 200")
        validate_response(operation, result)
        try:
            return model.from_dict(result)
        except (ValueError, TypeError):
            pass
        raise SdkError("protocol", "Server response could not be decoded")

    def list_bundles(
        self,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> BundlesResponse:
        return cast(
            BundlesResponse,
            self._call(
                "listBundles", {"limit": limit, "cursor": cursor}, BundlesResponse, cancel_event
            ),
        )

    def search_users(
        self,
        *,
        display_name: str,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> UsersSearchResponse:
        return cast(
            UsersSearchResponse,
            self._call(
                "searchUsers",
                {"displayName": display_name, "limit": limit, "cursor": cursor},
                UsersSearchResponse,
                cancel_event,
            ),
        )

    def get_checkout(
        self, checkout_id: str, *, cancel_event: Event | None = None
    ) -> CheckoutDetails:
        return cast(
            CheckoutDetails,
            self._call("getCheckout", {"checkoutId": checkout_id}, CheckoutDetails, cancel_event),
        )

    def list_bundle_users(
        self,
        bundle_id: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> BundleUsersResponse:
        return cast(
            BundleUsersResponse,
            self._call(
                "listBundleUsers",
                {"bundleId": bundle_id, "limit": limit, "cursor": cursor},
                BundleUsersResponse,
                cancel_event,
            ),
        )

    def list_bundle_grants(
        self,
        bundle_id: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        user_id: str | None = None,
        grant_type: str | None = None,
        starts_after: str | None = None,
        starts_before: str | None = None,
        ends_after: str | None = None,
        ends_before: str | None = None,
        created_after: str | None = None,
        created_before: str | None = None,
        sort: str | None = None,
        dir: str | None = None,
        source_id: str | None = None,
        cancel_event: Event | None = None,
    ) -> BundleGrantsResponse:
        return cast(
            BundleGrantsResponse,
            self._call(
                "listBundleGrants",
                {
                    "bundleId": bundle_id,
                    "limit": limit,
                    "cursor": cursor,
                    "userId": user_id,
                    "grantType": grant_type,
                    "sourceId": source_id,
                    "sort": sort,
                    "dir": dir,
                    "startsAfter": starts_after,
                    "startsBefore": starts_before,
                    "endsAfter": ends_after,
                    "endsBefore": ends_before,
                    "createdAfter": created_after,
                    "createdBefore": created_before,
                },
                BundleGrantsResponse,
                cancel_event,
            ),
        )

    def create_bundle_grant(
        self,
        bundle_id: str,
        request: CreateGrantRequest | dict[str, Any],
        *,
        cancel_event: Event | None = None,
    ) -> GrantMutationResponse:
        if request is None:
            raise SdkError("validation", "A grant request is required")
        return cast(
            GrantMutationResponse,
            self._call(
                "createBundleGrant",
                {"bundleId": bundle_id},
                GrantMutationResponse,
                cancel_event,
                request,
            ),
        )

    def revoke_bundle_grant(
        self, bundle_id: str, grant_id: str, *, cancel_event: Event | None = None
    ) -> GrantMutationResponse:
        return cast(
            GrantMutationResponse,
            self._call(
                "revokeBundleGrant",
                {"bundleId": bundle_id, "grantId": grant_id},
                GrantMutationResponse,
                cancel_event,
            ),
        )

    def _pages(
        self, load: Callable[[str | None], T], cursor: str | None, cancel_event: Event | None
    ) -> Iterator[T]:
        seen = {cursor} if cursor is not None else set()
        while True:
            if cancel_event is not None and cancel_event.is_set():
                raise SdkError("cancelled", "Traversal was cancelled")
            page = load(cursor)
            yield page
            cursor = page.next_cursor  # type: ignore[attr-defined]
            if cursor is None:
                return
            if cursor in seen:
                raise SdkError("pagination", "Server repeated a pagination cursor")
            seen.add(cursor)

    def list_bundles_pages(
        self,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> Iterator[BundlesResponse]:
        return self._pages(
            lambda c: self.list_bundles(limit=limit, cursor=c, cancel_event=cancel_event),
            cursor,
            cancel_event,
        )

    def search_users_pages(
        self,
        *,
        display_name: str,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> Iterator[UsersSearchResponse]:
        return self._pages(
            lambda c: self.search_users(
                display_name=display_name, limit=limit, cursor=c, cancel_event=cancel_event
            ),
            cursor,
            cancel_event,
        )

    def list_bundle_users_pages(
        self,
        bundle_id: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
        cancel_event: Event | None = None,
    ) -> Iterator[BundleUsersResponse]:
        return self._pages(
            lambda c: self.list_bundle_users(
                bundle_id, limit=limit, cursor=c, cancel_event=cancel_event
            ),
            cursor,
            cancel_event,
        )

    def list_bundle_grants_pages(
        self,
        bundle_id: str,
        *,
        cursor: str | None = None,
        cancel_event: Event | None = None,
        **filters: Any,
    ) -> Iterator[BundleGrantsResponse]:
        return self._pages(
            lambda c: self.list_bundle_grants(
                bundle_id, cursor=c, cancel_event=cancel_event, **filters
            ),
            cursor,
            cancel_event,
        )


class SignalsClient(_Client):
    def __init__(
        self,
        *,
        base_url: str = "https://www.vector-trading.app",
        timeout: float = 10.0,
        allow_local_http: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        super().__init__(
            base_url,
            timeout=timeout,
            allow_local_http=allow_local_http,
            transport=transport,
        )

    def send(
        self,
        payload: StrategySignalPayload | dict[str, Any],
        *,
        strategy_api_key: str,
        cancel_event: Event | None = None,
    ) -> None:
        if (
            not isinstance(strategy_api_key, str)
            or re.fullmatch("[a-f0-9]{32}", strategy_api_key) is None
        ):
            raise SdkError(
                "validation", "strategy_api_key must be 32 lowercase hexadecimal characters"
            )
        status, _ = self._transport.request(
            "POST",
            "/webhooks/signals/v1/" + strategy_api_key,
            body=serialize_signal(payload),
            request_secret=strategy_api_key,
            cancel_event=cancel_event,
        )
        if status != 204:
            raise SdkError("protocol", "Expected webhook enqueue acknowledgement (204)")
