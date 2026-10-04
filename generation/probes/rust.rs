use serde_json::{json, Value};
use std::{
    env, fs,
    io::{Read, Write},
    net::TcpListener,
    thread,
};
use vector_generated::{
    apis::{configuration::Configuration, default_api},
    models,
};

fn normalize_numbers(value: Value) -> Value {
    match value {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.into_iter().map(normalize_numbers).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| (k, normalize_numbers(v)))
                .collect(),
        ),
        other => other,
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let root = env::args().nth(1).unwrap();
    let fixtures: Vec<Value> = serde_json::from_str(
        &fs::read_to_string(root + "/conformance/signals/cases.json").unwrap(),
    )
    .unwrap();
    let mut count = 0;
    for f in fixtures {
        if f["schemaAccepted"] != true || f["parserAccepted"] != true {
            continue;
        };
        let model: models::SignalPayload = serde_json::from_value(f["payload"].clone()).unwrap();
        assert_eq!(
            normalize_numbers(serde_json::to_value(model).unwrap()),
            normalize_numbers(f["payload"].clone()),
            "{}",
            f["id"]
        );
        count += 1;
    }
    for kind in ["owner_grant", "referral_reward", "gift", "paid_external"] {
        let mut payload =
            json!({"userId":"a".repeat(32),"grantType":kind,"endsAt":"2026-07-19T12:00:00.000Z"});
        if kind == "paid_external" {
            payload["sourceId"] = json!("invoice:1");
        };
        let model: models::CreateGrantRequest = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(serde_json::to_value(model).unwrap(), payload);
    }
    assert!(serde_json::from_value::<models::SignalPayload>(json!({"action":"update","version":1.5,"timestamp":"1720000000000","marketPrice":100,"order":{"side":"buy","takeProfits":null}})).is_err());
    assert!(serde_json::from_value::<models::CreateGrantRequest>(
        json!({"userId":"a".repeat(32),"grantType":"paid_external"})
    )
    .is_err());
    let mut pause = models::PauseSignalPayload::new(
        models::pause_signal_payload::Action::Pause,
        "1720000000000".into(),
        1.5,
    );
    pause.version = f64::INFINITY;
    assert!(serde_json::to_value(pause).is_err());
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0; 4096];
        let n = stream.read(&mut buf).unwrap();
        let request = String::from_utf8_lossy(&buf[..n]);
        assert!(request.starts_with("GET /api/rest/v1/bundles?limit=17 "));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer synthetic-token"));
        let body = r#"{"bundles":[],"limit":17,"futureField":true}"#;
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let config = Configuration {
        base_path: format!("http://{address}/api/rest"),
        bearer_access_token: Some("synthetic-token".into()),
        ..Configuration::new()
    };
    let result = default_api::list_bundles(&config, Some(17), None)
        .await
        .unwrap();
    assert_eq!(result.limit, 17);
    server.join().unwrap();
    println!("Rust: {count} signal fixtures, four grant variants, dates, null/non-finite rejection and Bearer request passed.");
}
