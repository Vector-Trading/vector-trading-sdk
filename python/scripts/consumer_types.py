from typing import assert_type

from vector_trading import (
    BundlesResponse,
    CheckoutDetailsDiscount,
    OwnedTradingBundleSummary,
    RestClient,
    SdkError,
    SignalsClient,
    StartSignalPayload,
    TradingBundleAccessGrantSummary,
    TradingBundleAccessGrantType,
    TradingBundleGrantedUser,
    build_pause_signal,
    build_start_signal,
)


def typed_consumer(client: RestClient) -> None:
    assert_type(client.list_bundles(), BundlesResponse)
    assert_type(client.list_bundles().limit, int)
    assert_type(build_start_signal(version=1), StartSignalPayload)
    assert_type(SdkError("http", "rejected").status, int | None)
    build_start_signal()  # type: ignore[call-arg]
    build_pause_signal(version=1, force=True)  # type: ignore[call-arg]
    client.list_bundles(limit="10")  # type: ignore[arg-type]


def typed_nested_responses(
    bundle: OwnedTradingBundleSummary,
    user: TradingBundleGrantedUser,
    grant: TradingBundleAccessGrantSummary,
    discount: CheckoutDetailsDiscount,
) -> None:
    assert_type(bundle.name, str)
    assert_type(user.grant_type, TradingBundleAccessGrantType | None)
    assert_type(grant.grant_type, TradingBundleAccessGrantType)
    assert_type(discount, CheckoutDetailsDiscount)


def typed_signals(client: SignalsClient) -> None:
    message = build_start_signal(version=1)
    assert_type(client.send(message, strategy_api_key="a" * 32), None)
    client.send(message)  # type: ignore[call-arg]
    client.send(message, strategy_api_key=1)  # type: ignore[arg-type]


with (
    RestClient(account_api_key="vt_synthetic") as production_rest,
    SignalsClient() as production_signals,
):
    pass
