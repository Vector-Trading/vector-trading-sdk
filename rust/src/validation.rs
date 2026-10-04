use crate::{Error, Result};
use serde_json::Value;
use std::sync::OnceLock;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub(crate) fn contract() -> &'static Value {
    static CONTRACT: OnceLock<Value> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../generated/contract.json"))
            .expect("generated contract metadata")
    })
}
pub(crate) fn operation(name: &str) -> (&'static str, &'static str, &'static Value) {
    for (path, methods) in contract()["paths"].as_object().expect("generated paths") {
        for (method, op) in methods.as_object().expect("generated methods") {
            if op["operationId"] == name {
                return (method, path, op);
            }
        }
    }
    panic!("missing generated operation")
}
pub(crate) fn model(name: &str, v: &Value) -> Result<()> {
    if valid(&contract()["schemas"][name], v) {
        Ok(())
    } else {
        Err(Error::validation())
    }
}
// Rfc3339 accepts relaxed separator spelling; the server requires exact ASCII grammar.
fn server_datetime(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return false;
    }
    if [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
        .iter()
        .any(|&i| !b[i].is_ascii_digit())
        || &b[11..13] > b"23".as_slice()
        || &b[14..16] > b"59".as_slice()
        || &b[17..19] > b"59".as_slice()
    {
        return false;
    }
    let mut offset = 19;
    if b[offset] == b'.' {
        offset += 1;
        let start = offset;
        while offset < b.len() && b[offset].is_ascii_digit() {
            offset += 1;
        }
        if offset == start {
            return false;
        }
    }
    let tail = &b[offset..];
    tail == b"Z"
        || (tail.len() == 6
            && matches!(tail[0], b'+' | b'-')
            && tail[3] == b':'
            && [1, 2, 4, 5].iter().all(|&i| tail[i].is_ascii_digit())
            && &tail[1..3] <= b"23".as_slice()
            && &tail[4..6] <= b"59".as_slice())
}

pub(crate) fn valid(s: &Value, v: &Value) -> bool {
    if let Some(r) = s["$ref"].as_str() {
        return valid(
            &contract()["schemas"][r.rsplit('/').next().unwrap_or_default()],
            v,
        );
    }
    if v.is_null() {
        return s["nullable"] == true;
    }
    if let Some(xs) = s["enum"].as_array() {
        if !xs.contains(v) {
            return false;
        }
    }
    if let Some(xs) = s["oneOf"].as_array() {
        if xs.iter().filter(|s| valid(s, v)).count() != 1 {
            return false;
        }
    }
    match s["type"].as_str() {
        Some("object") => {
            let Some(o) = v.as_object() else {
                return false;
            };
            if let Some(keys) = s["required"].as_array() {
                if keys
                    .iter()
                    .any(|k| !o.contains_key(k.as_str().unwrap_or_default()))
                {
                    return false;
                }
            }
            for (k, x) in o {
                if let Some(p) = s["properties"].get(k) {
                    // Continuations are opaque, including future server cursor formats.
                    if k == "nextCursor" {
                        if !x.is_string() {
                            return false;
                        }
                    } else if !valid(p, x) {
                        return false;
                    }
                } else if s["additionalProperties"] == false {
                    return false;
                }
            }
        }
        Some("array") => {
            let Some(xs) = v.as_array() else {
                return false;
            };
            if s["maxItems"].as_u64().is_some_and(|n| xs.len() as u64 > n) {
                return false;
            }
            if let Some(items) = s.get("items") {
                if xs.iter().any(|x| !valid(items, x)) {
                    return false;
                }
            }
        }
        Some("string") => {
            let Some(x) = v.as_str() else {
                return false;
            };
            let n = x.chars().count() as u64;
            if s["minLength"].as_u64().is_some_and(|m| n < m)
                || s["maxLength"].as_u64().is_some_and(|m| n > m)
            {
                return false;
            }
            if let Some(p) = s["pattern"].as_str() {
                if !pattern(p, x) {
                    return false;
                }
            }
            if s["format"] == "date-time"
                && (!server_datetime(x) || OffsetDateTime::parse(x, &Rfc3339).is_err())
            {
                return false;
            }
        }
        Some("number" | "integer") => {
            let Some(x) = v.as_f64() else {
                return false;
            };
            if !x.is_finite() || (s["type"] == "integer" && x.fract() != 0.0) {
                return false;
            }
            if s["minimum"]
                .as_f64()
                .is_some_and(|m| x < m || (s["exclusiveMinimum"] == true && x == m))
                || s["maximum"]
                    .as_f64()
                    .is_some_and(|m| x > m || (s["exclusiveMaximum"] == true && x == m))
            {
                return false;
            }
        }
        Some("boolean") => {
            if !v.is_boolean() {
                return false;
            }
        }
        None => {}
        _ => return false,
    }
    true
}
// The pinned snapshot uses these five simple patterns. Unknown patterns fail
// closed so a contract change cannot silently weaken validation.
fn pattern(p: &str, x: &str) -> bool {
    match p {
        "^[a-f0-9]{32}$" => {
            x.len() == 32
                && x.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }
        "^(?:grant|scan):[a-f0-9]{32}$" => x
            .strip_prefix("grant:")
            .or_else(|| x.strip_prefix("scan:"))
            .is_some_and(|s| pattern("^[a-f0-9]{32}$", s)),
        "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$" => {
            !x.is_empty()
                && x.len() <= 256
                && x.as_bytes()[0].is_ascii_alphanumeric()
                && x.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        }
        "^([a-zA-Z0-9_]+)?$" => x.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'),
        "^[0-9]+$" => !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()),
        _ => false,
    }
}
