# Pine Script signal sources

Pine v6 sources build the outgoing [signal contract](../docs/contracts.md#signals-recommended-outgoing-payload). This is a JSON builder, not a REST client or trading engine. No dependencies, credentials, HTTP calls, alert conditions, or alert frequency live in the library.

## Published library

The maintainer confirmed publication of Pine v6 library version 1:

```pine
//@version=6
import Vector_Trading_PE/VectorTrading/1 as vt
```

The import is pinned to TradingView publication version 1. It is independent of the
strategy `version` passed to builders and the SDK package version. All examples
below use the `vt` alias. See [the offline imported example](examples/published-open-update.pine)
for opening an order and preparing a later TP/SL update. The imported example compiled and executed in the actual Pine Editor on 2026-10-04.
It constructs JSON without calling `alert()` or creating a webhook. Compilation
evidence and its source hash are recorded in `conformance/verification.json`.

## Embedded alternative

Copy [`examples/confirmed-cross.pine`](examples/confirmed-cross.pine) into a **new personal script** in Pine Editor and add it to a chart. It embeds the exact library implementation and needs no published import. Signals are disabled by default. The example uses confirmed realtime SMA crosses, an `if`/`else if` pair, and `alert.freq_once_per_bar_close`; it can call at most one signal alert per closing bar. These demonstration conditions are not trading advice or server trading rules.

Edit the canonical [`VectorTrading.pine`](VectorTrading.pine) and the example's [`confirmed-cross.body.pine`](examples/confirmed-cross.body.pine), then run `node pinescript/tools/build.ts --write` from the repository root. Do not edit embedded copies manually. The check without `--write` compares their complete bytes and library SHA-256; it does **not** compile Pine.

## Builder API

| Function                                                   | Required arguments               | Optional order arguments                                                   |
| ---------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `openSignal`                                               | `version`, `marketPrice`, `side` | `price`, `triggerPrice`, `stopPrice`, `takeProfits`, `amountPerc`, `force` |
| `updateSignal`                                             | `version`, `marketPrice`, `side` | `price`, `triggerPrice`, `stopPrice`, `takeProfits`                        |
| `cancelSignal`, `closeSignal`                              | `version`                        | `marketPrice`                                                              |
| `startSignal`, `pauseSignal`, `stopSignal`, `deleteSignal` | `version`                        | none                                                                       |

Every builder also accepts `timestamp`, `hashtag`, and `includeHashtag`. `version` is the positive finite **strategy version**, independent of SDK/Pine publication versions. `timestamp` defaults to the sentinel `"auto"`, selecting `timenow`; otherwise supply decimal millisecond digits representing a safe integer. Empty timestamps are invalid, and leading zeros are preserved. Non-empty hashtags are included automatically. Pine represents `na` strings as empty strings; set `includeHashtag = true` to explicitly include `""` rather than omit it.

Optional numeric `na` values omit their fields. Required prices/version and target prices/percentages reject `na`, zero, negative, and non-finite values. Optional computed `na` has the same meaning as omission: guard your own calculations if omission is unintended. Typed Pine parameters cannot represent JSON `null`.

Neither `price` nor `triggerPrice` selects market; `price` selects limit; `triggerPrice` selects trigger; both select trigger-limit. Price relationships, SL/TP protection, the ten-target maximum, and percentages follow the linked shared contract. `amountPerc` and `force` are available only on `openSignal`. `Force.omitted`, `Force.disabled`, and `Force.enabled` retain omission, explicit false, and explicit true.

### Open an order and update TP/SL

These snippets belong inside a personal script using the pinned import above.
They prepare messages offline; opening and updating are separate decisions by your script.

```pine
// With import Vector_Trading_PE/VectorTrading/1 as vt.
array<vt.TakeProfit> openingTargets = array.from(vt.TakeProfit.new(close * 1.02, 100))
string opening = vt.openSignal(1, close, "buy", stopPrice = close * 0.98, takeProfits = openingTargets)

// A later update replaces TP and moves SL; it does not open another order.
array<vt.TakeProfit> updatedTargets = array.from(vt.TakeProfit.new(close * 1.03, 100))
string update = vt.updateSignal(1, close, "buy", stopPrice = close * 0.99, takeProfits = updatedTargets)
```

### Preserve, clear, or replace take-profit targets

```pine
string preserve = vt.updateSignal(1, close, "buy", stopPrice = close * 0.99)
string clear = vt.updateSignal(1, close, "buy", takeProfits = array.new<vt.TakeProfit>())
array<vt.TakeProfit> targets = array.from(vt.TakeProfit.new(close * 1.02, 100))
string replace = vt.updateSignal(1, close, "buy", takeProfits = targets)
```

### Entry order variants

For a buy order, the following sample limit price is below the current market and
its trigger price is above it. Use your own strategy's valid prices and conditions.
Each call is an alternative message, not a sequence to send together.

```pine
string marketEntry = vt.openSignal(1, close, "buy")
string limitEntry = vt.openSignal(1, close, "buy", price = close * 0.99)
string triggerEntry = vt.openSignal(1, close, "buy", triggerPrice = close * 1.01)
string triggerLimitEntry = vt.openSignal(1, close, "buy", price = close * 0.99, triggerPrice = close * 1.01)
```

### Other signal actions

```pine
string cancelOrder = vt.cancelSignal(1, marketPrice = close)
string closePosition = vt.closeSignal(1, marketPrice = close)
string startStrategy = vt.startSignal(1)
string pauseStrategy = vt.pauseSignal(1)
string stopStrategy = vt.stopSignal(1)
string deleteStrategy = vt.deleteSignal(1)
```

### Send the selected message

Your script defines `openCondition`. Its open branch
can use a protective opening payload as follows; update TP/SL in a separate branch
when your strategy's update condition is satisfied. Do not add a second opening alert.

```pine
if openCondition
    array<vt.TakeProfit> targets = array.from(vt.TakeProfit.new(close * 1.02, 100))
    string message = vt.openSignal(strategyVersion, close, "buy", stopPrice = close * 0.98, takeProfits = targets)
    alert(message, alert.freq_once_per_bar_close)
```

Copy the intended strategy's webhook URL from Vector Trading and paste the **full
URL** into TradingView's webhook field. For programmatic TypeScript, Python, Go, or
Rust sends, use only the final path segment after `/webhooks/signals/v1/` as the
strategy API key. For example, the final segment of
`https://www.vector-trading.app/webhooks/signals/v1/<strategy-api-key>` is
`<strategy-api-key>`; the account REST key is a separate credential.

Unlike the other examples, Pine does not read environment variables; the private
`VECTOR_BTCUSDT_API_KEY` or `VECTOR_SOLUSDT_API_KEY` value belongs only in that webhook
configuration, never in the script or JSON. `VECTOR_API_KEY` is not used by Pine.

Pine floats have finite precision and float comparisons round operands. The codec uses scientific JSON numbers, avoids default/tick-size formatting, rescales small numbers before string conversion, and detects positive price differences through logarithms. The verified 17 fixtures and precision probes retain their numeric values exactly; this cannot recover precision already lost by a caller's Pine computation. `jsonString` escapes quotes, backslashes, tabs, and newlines and preserves ordinary Unicode. Other C0 controls are rejected rather than emitted as invalid JSON. Signal string fields are restricted to ASCII/digits, so their character count is their UTF-8 byte count; builders enforce 16 KiB.

## Alerts and webhook setup

1. Verify source, strategy version, chart symbol/timeframe, inputs, and selected conditions. Set **Enable signals** only for an explicitly authorized environment.
2. Create an alert with the condition **Any alert() function call**. The example's named `alertcondition` entries have static messages and are not the dynamic JSON webhook channel. Frequency is controlled by the `alert()` calls.
3. Supply the HTTPS webhook URL `https://<your-host>/webhooks/signals/v1/<strategy-key>` in TradingView's webhook field. Put the strategy key there only; never put it in code, JSON, screenshots, logs, or Git. Account REST keys do not belong in Pine. Follow TradingView's current webhook/account requirements, including two-factor authentication.
4. Test explicitly selected signals against an isolated receiver first. Historical calculations, Pine Logs, and broker-emulator results do not prove webhook delivery or exchange execution. This step's compatibility proof calls the parser only; no running webhook alert was created.
5. A webhook `204` means enqueue acceptance. It does not guarantee execution or permanent exactly-once delivery. The library adds no retry or background loop.

## Compilation, publication, and updates

Actual Pine Editor verification and source hashes are recorded in [`conformance/verification.json`](conformance/verification.json). Recompile the standalone library and embedded consumer after any source change. For the probe, copy [`conformance/probe.pine`](conformance/probe.pine) into a personal script, open **Pine Logs**, and select rejection cases individually. Export only `VTJSON|...` and `VTQUOTE|...` messages, without timestamp prefixes, into `conformance/editor-output.txt` and run the documented checks. The builder must raise an error for each rejection; the probe's `REJECTION DID NOT OCCUR` error signals a failed test.

TradingView publication was reported by the maintainer on 2026-10-04 as
`Vector_Trading_PE/VectorTrading/1`; the source-file hash and confirmation are recorded
in the verification metadata. Future publication versions require compilation of
both the exact library and an imported consumer, confirmed publication, and an
updated source mapping. GitHub source archives are reference copies, not a
TradingView publication mechanism.

Use TradingView's **Publish script** flow manually for an authorized update.
Libraries expose their source. Qualify functions, `TakeProfit`, and `Force` with the
chosen import alias. After compiling and testing selected signals against an
isolated receiver, **recreate running alerts** with the new script and inputs.
Existing imports stay pinned and running alerts retain their original context.

Rollback pins the previous published library version, restores verified consumer inputs, and recreates its alert. It does not automatically undo or reverse any executed trade.

Official references: [Libraries](https://www.tradingview.com/pine-script-docs/concepts/libraries/), [Strings](https://www.tradingview.com/pine-script-docs/concepts/strings/), [Type system](https://www.tradingview.com/pine-script-docs/language/type-system/), [Alerts](https://www.tradingview.com/pine-script-docs/concepts/alerts/), [Pine Logs](https://www.tradingview.com/pine-script-docs/writing/debugging/), [Publishing](https://www.tradingview.com/pine-script-docs/writing/publishing/), [Webhook configuration](https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/).
