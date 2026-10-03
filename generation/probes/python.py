import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
import httpx
from vector_generated import ApiClient, Configuration
from vector_generated.api.default_api import DefaultApi
from vector_generated.models.signal_payload import SignalPayload
from vector_generated.models.create_grant_request import CreateGrantRequest
from vector_generated.models.update_signal_payload_order import UpdateSignalPayloadOrder

root = Path(sys.argv[1])
fixtures = json.loads((root / "conformance/signals/cases.json").read_text())
count = 0
for fixture in fixtures:
    if fixture["schemaAccepted"] and fixture["parserAccepted"]:
        encoded = json.loads(SignalPayload.from_dict(fixture["payload"]).to_json())
        assert encoded == fixture["payload"], fixture["id"]
        count += 1
for kind in ["owner_grant", "referral_reward", "gift", "paid_external"]:
    payload = dict(userId="a" * 32, grantType=kind, endsAt="2026-07-19T12:00:00.000Z")
    if kind == "paid_external":
        payload["sourceId"] = "invoice:1"
    encoded = json.loads(CreateGrantRequest.from_dict(payload).to_json())
    assert datetime.fromisoformat(encoded.pop("endsAt")) == datetime.fromisoformat(
        payload.pop("endsAt")
    )
    assert encoded == payload
for payload in [
    dict(userId="a" * 32, grantType="paid_external"),
    dict(
        action="update",
        version=1.5,
        timestamp="1720000000000",
        marketPrice=100,
        order=dict(side="buy", takeProfits=None),
    ),
    dict(action="pause", version=float("inf"), timestamp="1720000000000"),
]:
    try:
        (CreateGrantRequest if "grantType" in payload else SignalPayload).from_dict(
            payload
        )
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid input accepted")
try:
    UpdateSignalPayloadOrder(side="buy", take_profits=None)
except ValueError:
    pass
else:
    raise AssertionError("Explicit None accepted")
assert UpdateSignalPayloadOrder(side="buy").to_dict() == dict(side="buy")
assert UpdateSignalPayloadOrder(side="buy", take_profits=[]).to_dict() == dict(
    side="buy", takeProfits=[]
)


async def request_probe():
    calls = []

    def handler(request):
        assert str(request.url) == "http://127.0.0.1:9999/api/rest/v1/bundles?limit=17"
        assert request.headers["Authorization"] == "Bearer synthetic-token"
        calls.append(request)
        return httpx.Response(200, json=dict(bundles=[], limit=17))

    async with ApiClient(
        Configuration(
            host="http://127.0.0.1:9999/api/rest", access_token="synthetic-token"
        )
    ) as client:
        client.rest_client.pool_manager = httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        )
        await DefaultApi(client).list_bundles(limit=17)
    assert len(calls) == 1


asyncio.run(request_probe())
print(
    f"Python: {count} signal fixtures, four grant variants, dates, None/null/non-finite rejection and Bearer request passed."
)

order = UpdateSignalPayloadOrder(side="buy")
order.price = 99.5
assert order.to_dict() == {"side": "buy", "price": 99.5}
