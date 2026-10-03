from typing import assert_type

from vector_trading import (
    BundlesResponse,
    RestClient,
    SdkError,
    StartSignalPayload,
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
