from vector_trading import SignalsClient, build_open_signal, build_update_signal


def open_then_clear_targets(base_url: str, strategy_api_key: str, strategy_version: float) -> None:
    opening = build_open_signal(version=strategy_version, market_price=100, order={"side": "buy"})
    clearing = build_update_signal(
        version=strategy_version, market_price=100, order={"side": "buy", "takeProfits": []}
    )
    with SignalsClient(base_url=base_url, strategy_api_key=strategy_api_key) as client:
        client.send(opening)
        client.send(clearing)
