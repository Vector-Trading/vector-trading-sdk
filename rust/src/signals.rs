use crate::{models::*, validation, Error, Result};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// `None` fixes the current millisecond once; `Some("")` is invalid.
#[derive(Clone, Default, Debug)]
pub struct SignalOptions {
    pub timestamp: Option<String>,
    pub hashtag: Option<String>,
}
#[derive(Clone, Default, Debug)]
pub struct OpenSignalOptions {
    pub metadata: SignalOptions,
    pub force: Option<bool>,
}
#[derive(Clone, Default, Debug)]
pub struct ExitSignalOptions {
    pub metadata: SignalOptions,
    pub market_price: Option<f64>,
}

/// Validate a prepared signal without changing its timestamp or retrying it.
pub fn serialize_signal<T: Serialize + ?Sized>(payload: &T) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(payload).map_err(|_| Error::validation())?;
    if bytes.len() > 16 * 1024 {
        return Err(Error::validation());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| Error::validation())?;
    validation::model("SignalPayload", &value)?;
    let timestamp = value["timestamp"].as_str().ok_or_else(Error::validation)?;
    let trimmed = timestamp.trim_start_matches('0');
    let n = if trimmed.is_empty() {
        0
    } else {
        trimmed.parse::<u64>().map_err(|_| Error::validation())?
    };
    if n > 9_007_199_254_740_991 {
        return Err(Error::validation());
    }
    if let Some(order) = value.get("order") {
        let buy = order["side"] == "buy";
        let market = value["marketPrice"]
            .as_f64()
            .ok_or_else(Error::validation)?;
        let price = order["price"].as_f64();
        let trigger = order["triggerPrice"].as_f64();
        let base = price.or(trigger).unwrap_or(market);
        let in_direction = |a: f64, b: f64| if buy { a > b } else { a < b };
        if price.is_some_and(|p| in_direction(p, trigger.unwrap_or(market)))
            || trigger.is_some_and(|t| in_direction(market, t))
            || order["stop"]
                .as_f64()
                .is_some_and(|s| !in_direction(base, s))
        {
            return Err(Error::validation());
        }
        let mut total = 0.0;
        if let Some(targets) = order["takeProfits"].as_array() {
            for tp in targets {
                let p = tp["price"].as_f64().ok_or_else(Error::validation)?;
                total += tp["percent"].as_f64().ok_or_else(Error::validation)?;
                if !in_direction(p, base) {
                    return Err(Error::validation());
                }
            }
        }
        if total > 100.0 + 1e-8 {
            return Err(Error::validation());
        }
    }
    Ok(bytes)
}

/// Consume an outgoing object and fill only an absent timestamp.
pub fn build_signal(mut payload: Value) -> Result<SignalPayload> {
    fix_timestamp(&mut payload)?;
    decode_prepared(payload)
}
fn fix_timestamp(payload: &mut Value) -> Result<()> {
    let o = payload.as_object_mut().ok_or_else(Error::validation)?;
    if !o.contains_key("timestamp") {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| Error::validation())?
            .as_millis();
        o.insert("timestamp".into(), Value::String(n.to_string()));
    }
    Ok(())
}
fn decode_prepared<T: DeserializeOwned>(v: Value) -> Result<T> {
    let bytes = serialize_signal(&v)?;
    serde_json::from_slice(&bytes).map_err(|_| Error::validation())
}
fn fields(action: &str, version: f64, options: SignalOptions) -> Result<Value> {
    let mut v = json!({"action": action, "version": version});
    if let Some(s) = options.timestamp {
        v["timestamp"] = s.into();
    }
    if let Some(s) = options.hashtag {
        v["hashtag"] = s.into();
    }
    fix_timestamp(&mut v)?;
    Ok(v)
}
pub fn build_open_signal(
    version: f64,
    market_price: f64,
    order: OpenSignalPayloadOrder,
    options: OpenSignalOptions,
) -> Result<OpenSignalPayload> {
    let mut v = fields("open", version, options.metadata)?;
    v["marketPrice"] = json!(market_price);
    v["order"] = serde_json::to_value(order).map_err(|_| Error::validation())?;
    if let Some(force) = options.force {
        v["force"] = force.into();
    }
    decode_prepared(v)
}
pub fn build_update_signal(
    version: f64,
    market_price: f64,
    order: UpdateSignalPayloadOrder,
    options: SignalOptions,
) -> Result<UpdateSignalPayload> {
    let mut v = fields("update", version, options)?;
    v["marketPrice"] = json!(market_price);
    v["order"] = serde_json::to_value(order).map_err(|_| Error::validation())?;
    decode_prepared(v)
}
fn exit<T: DeserializeOwned>(action: &str, version: f64, options: ExitSignalOptions) -> Result<T> {
    let mut v = fields(action, version, options.metadata)?;
    if let Some(p) = options.market_price {
        v["marketPrice"] = json!(p);
    }
    decode_prepared(v)
}
pub fn build_cancel_signal(
    version: f64,
    options: ExitSignalOptions,
) -> Result<CancelSignalPayload> {
    exit("cancel", version, options)
}
pub fn build_close_signal(version: f64, options: ExitSignalOptions) -> Result<CloseSignalPayload> {
    exit("close", version, options)
}
pub fn build_start_signal(version: f64, options: SignalOptions) -> Result<StartSignalPayload> {
    decode_prepared(fields("start", version, options)?)
}
pub fn build_pause_signal(version: f64, options: SignalOptions) -> Result<PauseSignalPayload> {
    decode_prepared(fields("pause", version, options)?)
}
pub fn build_stop_signal(version: f64, options: SignalOptions) -> Result<StopSignalPayload> {
    decode_prepared(fields("stop", version, options)?)
}
pub fn build_delete_signal(version: f64, options: SignalOptions) -> Result<DeleteSignalPayload> {
    decode_prepared(fields("delete", version, options)?)
}
