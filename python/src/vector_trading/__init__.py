"""Public synchronous Vector Trading SDK. Internal paths are not a supported API."""

from pkgutil import extend_path

# Hatch editable installs keep forced derived files beside the installed package.
__path__ = extend_path(__path__, __name__)

from ._generated.models.bundle_grants_response import BundleGrantsResponse
from ._generated.models.bundle_users_response import BundleUsersResponse
from ._generated.models.bundles_response import BundlesResponse
from ._generated.models.cancel_signal_payload import CancelSignalPayload
from ._generated.models.checkout_details import CheckoutDetails
from ._generated.models.close_signal_payload import CloseSignalPayload
from ._generated.models.create_grant_request import CreateGrantRequest
from ._generated.models.delete_signal_payload import DeleteSignalPayload
from ._generated.models.grant_mutation_response import GrantMutationResponse
from ._generated.models.open_signal_payload import OpenSignalPayload
from ._generated.models.open_signal_payload_order import OpenSignalPayloadOrder
from ._generated.models.open_signal_payload_order_take_profits_inner import (
    OpenSignalPayloadOrderTakeProfitsInner,
)
from ._generated.models.other_grant_request import OtherGrantRequest
from ._generated.models.paid_external_grant_request import PaidExternalGrantRequest
from ._generated.models.pause_signal_payload import PauseSignalPayload
from ._generated.models.public_user import PublicUser
from ._generated.models.start_signal_payload import StartSignalPayload
from ._generated.models.stop_signal_payload import StopSignalPayload
from ._generated.models.update_signal_payload import UpdateSignalPayload
from ._generated.models.update_signal_payload_order import UpdateSignalPayloadOrder
from ._generated.models.users_search_response import UsersSearchResponse
from .clients import RestClient, SignalsClient
from .errors import ErrorKind, SdkError
from .signals import (
    StrategySignalPayload,
    build_cancel_signal,
    build_close_signal,
    build_delete_signal,
    build_open_signal,
    build_pause_signal,
    build_signal,
    build_start_signal,
    build_stop_signal,
    build_update_signal,
    serialize_signal,
)

__all__ = [
    "BundleGrantsResponse",
    "BundlesResponse",
    "BundleUsersResponse",
    "CancelSignalPayload",
    "CheckoutDetails",
    "CloseSignalPayload",
    "CreateGrantRequest",
    "DeleteSignalPayload",
    "GrantMutationResponse",
    "OpenSignalPayload",
    "OpenSignalPayloadOrder",
    "OpenSignalPayloadOrderTakeProfitsInner",
    "OtherGrantRequest",
    "PaidExternalGrantRequest",
    "PauseSignalPayload",
    "PublicUser",
    "StartSignalPayload",
    "StopSignalPayload",
    "UpdateSignalPayload",
    "UpdateSignalPayloadOrder",
    "UsersSearchResponse",
    "RestClient",
    "SignalsClient",
    "ErrorKind",
    "SdkError",
    "StrategySignalPayload",
    "build_cancel_signal",
    "build_close_signal",
    "build_delete_signal",
    "build_open_signal",
    "build_pause_signal",
    "build_signal",
    "build_start_signal",
    "build_stop_signal",
    "build_update_signal",
    "serialize_signal",
]
