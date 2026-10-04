mod support;
use serde_json::{json, Value};
use std::time::Duration;
use support::*;
use vector_trading_sdk::*;

fn equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|x| equal(v, x)))
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| equal(a, b))
        }
        _ => a == b,
    }
}

#[tokio::test]
async fn regression_scalar_body_values_are_hidden() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let count = AtomicUsize::new(0);
    let server = Server::new(move |request| {
        if count.fetch_add(1, Ordering::Relaxed) > 0 {
            return Reply::status(204);
        }
        let body = request.json();
        Reply::Normal(
            400,
            String::new(),
            serde_json::to_vec(&json!({"message": format!("private {} {}", body["version"], body["force"]), "errorCode":"E501", "requestId":"req-123"})).unwrap(),
        )
    });
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    let payload = json!({"action":"open","version":8675309.125,"timestamp":"1780000000000","marketPrice":100,"order":{"side":"buy"},"force":true});
    let error = client.send(STRATEGY, &payload).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Http);
    assert!(!format!("{error:?} {error}").contains("8675309.125"));
    assert!(!error.message.contains("true"));
    assert_eq!(error.code.as_deref(), Some("E501"));
    assert_eq!(error.request_id.as_deref(), Some("req-123"));
    assert_eq!(server.count(), 1);
    client
        .send("8ab97361321c46f2bc7300a04fd6d133", &payload)
        .await
        .unwrap();
    assert_eq!(server.count(), 2);
}

#[tokio::test]
async fn regression_header_only_request_id_is_preserved() {
    for bytes in [
        vec![],
        b"upstream failed".to_vec(),
        b"{\"error\":\"limited\"}".to_vec(),
    ] {
        let server = Server::new(move |_| {
            Reply::Normal(429, "X-Request-Id: edge-123\r\n".into(), bytes.clone())
        });
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        let error = client
            .list_bundles(PageOptions::default())
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.status, Some(429));
        assert_eq!(error.request_id.as_deref(), Some("edge-123"));
        assert_eq!(server.count(), 1);
    }
}

#[tokio::test]
async fn request_ids_prefer_valid_body_and_sanitize_current_key() {
    const OTHER: &str = "8ab97361321c46f2bc7300a04fd6d133";
    for body in [
        json!({"requestId":"body-id"}),
        json!({"requestId":null}),
        json!({"requestId":42}),
    ] {
        let expected = if body["requestId"].is_string() {
            "body-id"
        } else {
            "header-id"
        };
        let server = Server::new(move |_| {
            Reply::Normal(
                400,
                "X-Request-Id: header-id\r\n".into(),
                serde_json::to_vec(&body).unwrap(),
            )
        });
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        let error = client
            .list_bundles(PageOptions::default())
            .await
            .unwrap_err();
        let sent = server.requests.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(error.request_id.as_deref(), Some(expected));
    }
    let server = Server::new(move |request| {
        if request.target.ends_with(OTHER) {
            return Reply::status(204);
        }
        Reply::Normal(
            400,
            format!("X-Request-Id: echo{STRATEGY}suffix\r\n"),
            vec![],
        )
    });
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    let prepared = build_start_signal(1.0, SignalOptions::default()).unwrap();
    let error = client.send(STRATEGY, &prepared).await.unwrap_err();
    assert!(error.request_id.is_some());
    assert!(!format!("{error:?}").contains(STRATEGY));
    client.send(OTHER, &prepared).await.unwrap();
    assert_eq!(server.count(), 2);
}

#[tokio::test]
async fn scalar_redaction_matches_actual_serialized_number_spelling() {
    for version in [1e-7, 1.2345678901234568e-100, 9_007_199_254_740_992.0] {
        let server = Server::new(|request| {
            let body = String::from_utf8(request.body.clone()).unwrap();
            let token = body
                .split("\"version\":")
                .nth(1)
                .unwrap()
                .split([',', '}'])
                .next()
                .unwrap();
            Reply::Normal(
                400,
                String::new(),
                serde_json::to_vec(&json!({"message":format!("number {token} force false")}))
                    .unwrap(),
            )
        });
        let client = SignalsClient::new(ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        })
        .unwrap();
        let prepared = json!({"action":"open","version":version,"timestamp":"1780000000000","marketPrice":100,"order":{"side":"buy"},"force":false});
        let error = client.send(STRATEGY, &prepared).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Http);
        assert_eq!(error.message, "number [redacted] force [redacted]");
        assert_eq!(server.count(), 1);
    }
}

#[tokio::test]
async fn signal_keys_are_request_local_in_both_response_orders() {
    use std::sync::{Arc, Condvar, Mutex};
    const OTHER: &str = "8ab97361321c46f2bc7300a04fd6d133";
    const THIRD: &str = "9ab97361321c46f2bc7300a04fd6d133";
    for first in [STRATEGY, OTHER] {
        let gate = Arc::new((Mutex::new((0, false)), Condvar::new()));
        let server_gate = gate.clone();
        let server = Server::new(move |request| {
            if request.target.ends_with(THIRD) {
                return Reply::status(204);
            }
            let (lock, wake) = &*server_gate;
            let mut state = lock.lock().unwrap();
            state.0 += 1;
            wake.notify_all();
            let (state, timed) = wake
                .wait_timeout_while(state, Duration::from_secs(3), |s| {
                    s.0 != 2 || (!request.target.ends_with(first) && !s.1)
                })
                .unwrap();
            assert!(
                !timed.timed_out(),
                "Both requests must arrive before ordered replies"
            );
            drop(state);
            let key = request.target.rsplit('/').next().unwrap();
            let label = if key == STRATEGY { "A" } else { "B" };
            Reply::Normal(400, format!("X-Request-Id: request-{label}\r\n"), serde_json::to_vec(&json!({
                "message": format!("failure {label} {} {key}", request.json()["hashtag"].as_str().unwrap()),
                "errorCode": format!("E_{label}")
            })).unwrap())
        });
        let client = SignalsClient::new(ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        })
        .unwrap();
        assert_eq!(server.count(), 0);
        let payload_a = json!({"action":"start","version":2.5,"timestamp":"1780000000000","hashtag":"private_A_body"});
        let payload_b = json!({"action":"pause","version":3.5,"timestamp":"1780000000001","hashtag":"private_B_body"});
        let clone = client.clone();
        let a = tokio::spawn(async move { clone.send(STRATEGY, &payload_a).await });
        let clone = client.clone();
        let b = tokio::spawn(async move { clone.send(OTHER, &payload_b).await });
        let (early, late, early_label, late_label) = if first == STRATEGY {
            (a, b, "A", "B")
        } else {
            (b, a, "B", "A")
        };
        let early_error = early.await.unwrap().unwrap_err();
        let (lock, wake) = &*gate;
        lock.lock().unwrap().1 = true;
        wake.notify_all();
        let late_error = late.await.unwrap().unwrap_err();
        for (error, label) in [(early_error, early_label), (late_error, late_label)] {
            assert_eq!(error.kind, ErrorKind::Http);
            assert_eq!(error.code.as_deref(), Some(format!("E_{label}").as_str()));
            assert_eq!(
                error.request_id.as_deref(),
                Some(format!("request-{label}").as_str())
            );
            assert!(!format!("{error:?} {error}").contains("private_"));
            assert!(!error.message.contains(STRATEGY));
            assert!(!error.message.contains(OTHER));
        }
        let prepared = build_start_signal(1.0, SignalOptions::default()).unwrap();
        client.send(THIRD, &prepared).await.unwrap();
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        for (key, action, stamp) in [
            (STRATEGY, "start", "1780000000000"),
            (OTHER, "pause", "1780000000001"),
        ] {
            let request = requests.iter().find(|r| r.target.ends_with(key)).unwrap();
            assert_eq!(request.target, format!("/webhooks/signals/v1/{key}"));
            assert!(!request.headers.contains_key("authorization"));
            assert_eq!(request.json()["action"], action);
            assert_eq!(request.json()["timestamp"], stamp);
            assert!(!String::from_utf8(request.body.clone())
                .unwrap()
                .contains(key));
        }
    }
}

#[tokio::test]
async fn invalid_signal_keys_fail_before_serialization_and_do_not_poison_client() {
    struct Unserializable;
    impl serde::Serialize for Unserializable {
        fn serialize<S: serde::Serializer>(&self, _: S) -> std::result::Result<S::Ok, S::Error> {
            panic!("An invalid key must be rejected before serialization")
        }
    }
    let server = Server::new(|_| Reply::status(204));
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    for key in [
        "".into(),
        "a".repeat(31),
        "a".repeat(33),
        "A".repeat(32),
        format!("{}\n", "a".repeat(32)),
        "../private".into(),
        "é".repeat(32),
        format!("{} ", "a".repeat(31)),
    ] {
        let error = client.send(&key, &Unserializable).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation);
    }
    assert_eq!(server.count(), 0);
    client
        .send(
            STRATEGY,
            &build_start_signal(1.0, SignalOptions::default()).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(server.count(), 1);
}

#[tokio::test]
async fn signal_cancellation_does_not_disable_another_strategy() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    const OTHER: &str = "8ab97361321c46f2bc7300a04fd6d133";
    let arrived = Arc::new(AtomicBool::new(false));
    let received = arrived.clone();
    let server = Server::new(move |request| {
        if request.target.ends_with(STRATEGY) {
            received.store(true, Ordering::Release);
            Reply::Delay(Duration::from_millis(100), Box::new(Reply::status(204)))
        } else {
            Reply::status(204)
        }
    });
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    let prepared = build_start_signal(1.0, SignalOptions::default()).unwrap();
    let mut future = Box::pin(client.send(STRATEGY, &prepared));
    tokio::select! {
        result = &mut future => panic!("Request unexpectedly completed: {result:?}"),
        _ = async { while !arrived.load(Ordering::Acquire) { tokio::time::sleep(Duration::from_millis(1)).await; } } => {}
    }
    drop(future);
    client.send(OTHER, &prepared).await.unwrap();
    assert_eq!(server.count(), 2);
    client.clone().close();
    assert_eq!(
        client.send(OTHER, &prepared).await.unwrap_err().kind,
        ErrorKind::Closed
    );
    assert_eq!(server.count(), 2);
}

#[tokio::test]
async fn signal_timeout_does_not_disable_another_strategy() {
    const OTHER: &str = "8ab97361321c46f2bc7300a04fd6d133";
    let server = Server::new(|request| {
        if request.target.ends_with(STRATEGY) {
            Reply::Delay(Duration::from_millis(100), Box::new(Reply::status(204)))
        } else {
            Reply::status(204)
        }
    });
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..ClientOptions {
            timeout: Duration::from_millis(30),
            ..options()
        }
    })
    .unwrap();
    let prepared = build_start_signal(1.0, SignalOptions::default()).unwrap();
    assert_eq!(
        client.send(STRATEGY, &prepared).await.unwrap_err().kind,
        ErrorKind::Timeout
    );
    client.send(OTHER, &prepared).await.unwrap();
    assert_eq!(server.count(), 2);
}
async fn invoke(client: &RestClient, case: &Value) -> Result<Value> {
    let q = &case["request"]["query"];
    let page = || serde_json::from_value(q.clone()).unwrap();
    let encode = |v| serde_json::to_value(v).unwrap();
    // Serialize concrete response types separately to preserve compile-time coverage.
    match case["operationId"].as_str().unwrap() {
        "listBundles" => Ok(encode(client.list_bundles(page()).await?)),
        "searchUsers" => Ok(serde_json::to_value(
            client
                .search_users(q["displayName"].as_str().unwrap(), page())
                .await?,
        )
        .unwrap()),
        "getCheckout" => Ok(serde_json::to_value(
            client
                .get_checkout("6fe97361321c46f2bc7300a04fd6d577")
                .await?,
        )
        .unwrap()),
        "listBundleUsers" => {
            Ok(serde_json::to_value(client.list_bundle_users(BUNDLE, page()).await?).unwrap())
        }
        "listBundleGrants" => Ok(serde_json::to_value(
            client
                .list_bundle_grants(BUNDLE, serde_json::from_value(q.clone()).unwrap())
                .await?,
        )
        .unwrap()),
        "createBundleGrant" => Ok(serde_json::to_value(
            client
                .create_bundle_grant(BUNDLE, &case["request"]["body"])
                .await?,
        )
        .unwrap()),
        "revokeBundleGrant" => {
            Ok(serde_json::to_value(client.revoke_bundle_grant(BUNDLE, GRANT).await?).unwrap())
        }
        _ => unreachable!(),
    }
}
#[tokio::test]
async fn all_rest_fixtures_and_credentials() {
    for case in rest_cases() {
        let response = case["response"].clone();
        let server = Server::new(move |_| Reply::json(&response));
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(format!("{}/api/rest", server.url)),
                ..options()
            },
        )
        .unwrap();
        assert_eq!(server.count(), 0);
        let result = invoke(&client, &case).await;
        if case["expectedStatus"] == 200 {
            let result = result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
            assert!(
                equal(&result, &case["response"]),
                "{}: {result}",
                case["id"]
            );
            let requests = server.requests.lock().unwrap();
            let r = &requests[0];
            assert_eq!(r.method, case["request"]["method"].as_str().unwrap());
            assert_eq!(
                r.target.split('?').next().unwrap(),
                format!("/api/rest{}", case["request"]["path"].as_str().unwrap())
            );
            assert_eq!(r.headers["authorization"], format!("Bearer {ACCOUNT}"));
            let expected: std::collections::BTreeMap<_, _> = case["request"]["query"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string()),
                    )
                })
                .collect();
            assert_eq!(r.query(), expected);
            if let Some(body) = case["request"].get("body") {
                assert!(equal(&r.json(), body));
            }
        } else {
            assert_eq!(result.unwrap_err().kind, ErrorKind::Validation);
            assert_eq!(server.count(), 0);
        }
    }
}
fn typed_signal(v: &Value) -> Value {
    let version = v["version"].as_f64().unwrap();
    let opts = SignalOptions {
        timestamp: v["timestamp"].as_str().map(str::to_owned),
        hashtag: v["hashtag"].as_str().map(str::to_owned),
    };
    let exit = || ExitSignalOptions {
        metadata: opts.clone(),
        market_price: v["marketPrice"].as_f64(),
    };
    match v["action"].as_str().unwrap() {
        "open" => serde_json::to_value(
            build_open_signal(
                version,
                v["marketPrice"].as_f64().unwrap(),
                serde_json::from_value(v["order"].clone()).unwrap(),
                OpenSignalOptions {
                    metadata: opts,
                    force: v["force"].as_bool(),
                },
            )
            .unwrap(),
        )
        .unwrap(),
        "update" => serde_json::to_value(
            build_update_signal(
                version,
                v["marketPrice"].as_f64().unwrap(),
                serde_json::from_value(v["order"].clone()).unwrap(),
                opts,
            )
            .unwrap(),
        )
        .unwrap(),
        "cancel" => serde_json::to_value(build_cancel_signal(version, exit()).unwrap()).unwrap(),
        "close" => serde_json::to_value(build_close_signal(version, exit()).unwrap()).unwrap(),
        "start" => serde_json::to_value(build_start_signal(version, opts).unwrap()).unwrap(),
        "pause" => serde_json::to_value(build_pause_signal(version, opts).unwrap()).unwrap(),
        "stop" => serde_json::to_value(build_stop_signal(version, opts).unwrap()).unwrap(),
        "delete" => serde_json::to_value(build_delete_signal(version, opts).unwrap()).unwrap(),
        _ => unreachable!(),
    }
}
#[tokio::test]
async fn all_signal_fixtures_typed_builders_and_http_bytes() {
    let server = Server::new(|_| Reply::status(204));
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    assert_eq!(server.count(), 0);
    let mut accepted = 0;
    for case in signal_cases() {
        let v = &case["payload"];
        let result = serialize_signal(v);
        if case["schemaAccepted"] == true && case["parserAccepted"] == true {
            assert!(result.is_ok(), "{}", case["id"]);
            let typed = typed_signal(v);
            assert!(equal(&typed, v), "{}", case["id"]);
            let union = build_signal(v.clone()).unwrap();
            assert!(equal(&serde_json::to_value(&union).unwrap(), v));
            client.send(STRATEGY, &union).await.unwrap();
            let requests = server.requests.lock().unwrap();
            let r = requests.last().unwrap();
            assert_eq!(r.method, "POST");
            assert_eq!(r.target, format!("/webhooks/signals/v1/{STRATEGY}"));
            assert!(!r.headers.contains_key("authorization"));
            assert!(equal(&r.json(), v));
            accepted += 1;
        } else {
            assert!(result.is_err(), "{}", case["id"]);
        }
    }
    assert_eq!(accepted, 17);
}
#[test]
fn prepared_metadata_finite_numbers_and_option_intent() {
    let signal = build_start_signal(2.5, SignalOptions::default()).unwrap();
    assert!(signal.timestamp.bytes().all(|b| b.is_ascii_digit()));
    assert_eq!(
        serialize_signal(&signal).unwrap(),
        serialize_signal(&signal).unwrap()
    );
    for version in [f64::NAN, f64::INFINITY, 0.0, -1.0] {
        assert!(build_start_signal(version, SignalOptions::default()).is_err());
    }
    let mut order =
        models::UpdateSignalPayloadOrder::new(models::update_signal_payload_order::Side::Buy);
    order.price = Some(f64::NAN);
    assert!(build_update_signal(1.0, 100.0, order, SignalOptions::default()).is_err());
    for timestamp in ["", "9007199254740992", "-1", "1.1"] {
        assert!(build_start_signal(
            1.0,
            SignalOptions {
                timestamp: Some(timestamp.into()),
                ..Default::default()
            }
        )
        .is_err());
    }
    for timestamp in [
        "0",
        "00000000000000000000000000000000000000000000000001",
        "9007199254740991",
    ] {
        assert!(build_start_signal(
            1.0,
            SignalOptions {
                timestamp: Some(timestamp.into()),
                ..Default::default()
            }
        )
        .is_ok());
    }
    for v in [
        json!({"action":"start","timestamp":null,"version":1}),
        json!({"action":"start","timestamp":"1","version":1,"force":true}),
    ] {
        assert!(build_signal(v).is_err());
    }
    for tp in [Value::Null, json!({}), json!("bad")] {
        assert!(build_signal(json!({"action":"update","marketPrice":100,"version":1,"order":{"side":"buy","takeProfits":tp}})).is_err());
    }
    let v = json!({"action":"update","marketPrice":100,"version":1,"order":{"side":"buy"}});
    assert!(build_signal(v.clone()).is_ok());
    assert!(v.get("timestamp").is_none());
    let order: models::UpdateSignalPayloadOrder =
        serde_json::from_value(json!({"side":"buy","takeProfits":[]})).unwrap();
    assert_eq!(order.take_profits, Some(vec![]));
    assert!(serde_json::from_value::<models::UpdateSignalPayloadOrder>(
        json!({"side":"buy","takeProfits":null})
    )
    .is_err());
    let mut v = serde_json::to_value(signal).unwrap();
    v["hashtag"] = "x".repeat(17 * 1024).into();
    assert!(serialize_signal(&v).is_err());
}
#[tokio::test]
async fn four_paginators_empty_pages_filters_and_cycles() {
    for name in [
        "listBundles",
        "searchUsers",
        "listBundleUsers",
        "listBundleGrants",
    ] {
        let case = rest_cases()
            .into_iter()
            .find(|c| c["operationId"] == name && c["expectedStatus"] == 200)
            .unwrap();
        let response = case["response"].clone();
        let page_field = if name == "listBundles" {
            "bundles"
        } else if name == "listBundleGrants" {
            "grants"
        } else {
            "users"
        };
        let server = Server::new(move |r| {
            let mut v = response.clone();
            if !r.query().contains_key("cursor") {
                v[page_field] = json!([]);
                v["nextCursor"] = "future:opaque:cursor".into();
            } else {
                v.as_object_mut().unwrap().remove("nextCursor");
            }
            Reply::json(&v)
        });
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        let opts = PageOptions {
            limit: Some(1),
            ..Default::default()
        };
        match name {
            "listBundles" => {
                let mut p = client.bundles_pages(opts).unwrap();
                assert_eq!(p.next().await.unwrap().unwrap().bundles.len(), 0);
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_none());
            }
            "searchUsers" => {
                let mut p = client.users_pages("用户 & +", opts).unwrap();
                assert!(p.next().await.unwrap().unwrap().users.is_empty());
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_none());
            }
            "listBundleUsers" => {
                let mut p = client.bundle_users_pages(BUNDLE, opts).unwrap();
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_none());
            }
            _ => {
                let mut p = client
                    .bundle_grants_pages(
                        BUNDLE,
                        GrantOptions {
                            page: opts,
                            ..Default::default()
                        },
                    )
                    .unwrap();
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_some());
                assert!(p.next().await.unwrap().is_none());
            }
        }
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        let mut second = requests[1].query();
        assert_eq!(second.remove("cursor").unwrap(), "future:opaque:cursor");
        assert_eq!(second, requests[0].query());
    }
    let server =
        Server::new(|_| Reply::json(&json!({"bundles":[],"limit":1,"nextCursor":"cycle"})));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let mut pages = client.bundles_pages(PageOptions::default()).unwrap();
    assert!(pages.next().await.unwrap().is_some());
    assert_eq!(pages.next().await.unwrap_err().kind, ErrorKind::Pagination);
    assert!(pages.next().await.unwrap().is_none());
}
#[tokio::test]
async fn response_evolution_nullability_dates_and_invalid_input() {
    let mut response = rest_cases()
        .into_iter()
        .find(|c| c["operationId"] == "searchUsers")
        .unwrap()["response"]
        .clone();
    response["extension"] = true.into();
    response["users"][0]["avatar"] = Value::Null;
    let server = Server::new(move |_| Reply::json(&response));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let result = client
        .search_users("用户", PageOptions::default())
        .await
        .unwrap();
    assert_eq!(result.users[0].avatar, Some(None));
    for name in ["", "a", &"x".repeat(31)] {
        assert!(client
            .search_users(name, PageOptions::default())
            .await
            .is_err());
    }
    assert!(client.get_checkout("../bad").await.is_err());
    assert!(client
        .list_bundle_grants(
            BUNDLE,
            GrantOptions {
                starts_after: Some("2026-02-30T00:00:00Z".into()),
                ..Default::default()
            }
        )
        .await
        .is_err());
    assert!(client
        .list_bundles(PageOptions {
            limit: Some(101),
            ..Default::default()
        })
        .await
        .is_err());
    assert_eq!(server.count(), 1);
    for response in [
        json!({"bundles":[],"limit":"bad"}),
        json!({"bundles":[],"limit":1,"nextCursor":null}),
    ] {
        let server = Server::new(move |_| Reply::json(&response));
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        assert_eq!(
            client
                .list_bundles(PageOptions::default())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::Protocol
        );
    }
}
#[tokio::test]
async fn errors_redaction_bounds_and_single_attempts() {
    for status in [400, 401, 403, 404, 409, 410, 413, 429, 500, 502, 503] {
        for bytes in [vec![], b"<html>failed</html>".to_vec(), serde_json::to_vec(&json!({"message":format!("{ACCOUNT} https://private.invalid/{STRATEGY} {}", "x".repeat(1000)),"errorCode":"E501","requestId":"req-123"})).unwrap(),serde_json::to_vec(&json!({"error":"Rate limited"})).unwrap()] {
            let server = Server::new(move |_|Reply::Normal(status,String::new(),bytes.clone()));
            let client = RestClient::new(ACCOUNT, ClientOptions { base_url: Some(server.url.clone()), ..options() }).unwrap();
            let e = client.list_bundles(PageOptions{limit:Some(1),..Default::default()}).await.unwrap_err();
            assert_eq!(e.kind,ErrorKind::Http); assert_eq!(e.status,Some(status)); assert!(e.message.chars().count() <= 512);
            let debug = format!("{e:?} {e} {client:?}"); assert!(!debug.contains(ACCOUNT)); assert!(!debug.contains(STRATEGY)); assert!(!debug.contains("private.invalid")); assert!(std::error::Error::source(&e).is_none());
            if e.code.is_some() { assert_eq!(e.code.as_deref(),Some("E501")); assert_eq!(e.request_id.as_deref(),Some("req-123")); }
            assert_eq!(server.count(),1);
        }
    }
    let case = rest_cases()
        .into_iter()
        .find(|c| {
            c["operationId"] == "createBundleGrant"
                && c["expectedStatus"] == 200
                && c["request"]["body"]["sourceId"].is_string()
        })
        .unwrap();
    let secret = case["request"]["body"]["sourceId"]
        .as_str()
        .unwrap()
        .to_owned();
    let server = Server::new(move |_| {
        Reply::Normal(
            409,
            String::new(),
            serde_json::to_vec(&json!({"message":secret})).unwrap(),
        )
    });
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let e = client
        .create_bundle_grant(BUNDLE, &case["request"]["body"])
        .await
        .unwrap_err();
    assert!(!e.message.contains("invoice"));
    let server = Server::new(|_| Reply::Lost);
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    let s = build_start_signal(1.0, SignalOptions::default()).unwrap();
    assert_eq!(
        client.send(STRATEGY, &s).await.unwrap_err().kind,
        ErrorKind::Transport
    );
    tokio::time::sleep(Duration::from_millis(15)).await;
    assert_eq!(server.count(), 1);
}
#[tokio::test]
async fn timeouts_drop_cancellation_redirects_close_and_concurrency() {
    for streaming in [false, true] {
        let server = Server::new(move |_| {
            if streaming {
                Reply::Stream(Duration::from_millis(150))
            } else {
                Reply::Delay(Duration::from_millis(150), Box::new(Reply::status(204)))
            }
        });
        let mut opts = options();
        opts.timeout = Duration::from_millis(30);
        let client = SignalsClient::new(ClientOptions {
            base_url: Some(server.url.clone()),
            ..opts
        })
        .unwrap();
        let signal = build_start_signal(1.0, SignalOptions::default()).unwrap();
        let started = std::time::Instant::now();
        assert_eq!(
            client.send(STRATEGY, &signal).await.unwrap_err().kind,
            ErrorKind::Timeout
        );
        assert!(started.elapsed() < Duration::from_millis(130));
        assert_eq!(server.count(), 1);
    }
    let server = Server::new(|_| {
        Reply::Delay(
            Duration::from_millis(150),
            Box::new(Reply::json(&json!({"bundles":[],"limit":1}))),
        )
    });
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let mut pages = client.bundles_pages(PageOptions::default()).unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(30), pages.next())
            .await
            .is_err()
    );
    assert_eq!(server.count(), 1);
    let destination = Server::new(|_| Reply::status(204));
    let location = destination.url.clone();
    let server = Server::new(move |_| {
        Reply::Normal(307, format!("Location: {location}/private\r\n"), vec![])
    });
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    assert_eq!(
        client
            .list_bundles(PageOptions::default())
            .await
            .unwrap_err()
            .status,
        Some(307)
    );
    assert_eq!(destination.count(), 0);
    client.close();
    assert_eq!(
        client
            .clone()
            .list_bundles(PageOptions::default())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Closed
    );
    let server = Server::new(|_| Reply::json(&json!({"bundles":[],"limit":1})));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let (a, b) = tokio::join!(
        client.list_bundles(PageOptions::default()),
        client.list_bundles(PageOptions::default())
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(server.count(), 2);
    for status in [201, 202, 204] {
        let server = Server::new(move |_| Reply::status(status));
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        assert_eq!(
            client
                .list_bundles(PageOptions::default())
                .await
                .unwrap_err()
                .kind,
            ErrorKind::Protocol
        );
    }
}
#[tokio::test]
async fn https_and_environment_validation() {
    for url in [
        "http://example.com",
        "http://127.0.0.1",
        "https://key@localhost",
        "https://localhost?a=1",
        "https://localhost#fragment",
        "file:///tmp",
    ] {
        assert!(RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some((url).to_owned()),
                ..ClientOptions::default()
            }
        )
        .is_err());
    }
    assert!(RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(("http://remote.invalid").to_owned()),
            ..options()
        }
    )
    .is_err());
    assert!(RestClient::new(
        "bad\nkey",
        ClientOptions {
            base_url: Some(("https://localhost").to_owned()),
            ..ClientOptions::default()
        }
    )
    .is_err());
    assert!(SignalsClient::new(ClientOptions {
        base_url: Some(("http://remote.invalid").to_owned()),
        ..options()
    })
    .is_err());
    let (server, cert) = Server::tls(|_| Reply::json(&json!({"bundles":[],"limit":1})));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..ClientOptions {
                root_certificate: Some(cert),
                ..Default::default()
            }
        },
    )
    .unwrap();
    client.list_bundles(PageOptions::default()).await.unwrap();
    assert_eq!(server.count(), 1);
}

#[tokio::test]
async fn all_grant_filters_union_variants_and_utf8_limits() {
    let response = rest_cases()
        .into_iter()
        .find(|c| c["operationId"] == "listBundleGrants")
        .unwrap()["response"]
        .clone();
    let server = Server::new(move |_| Reply::json(&response));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let opts = GrantOptions {
        page: PageOptions {
            limit: Some(7),
            cursor: Some("opaque:+/&?".into()),
        },
        user_id: Some("3ce97361321c46f2bc7300a04fd6d244".into()),
        grant_type: Some(models::TradingBundleAccessGrantType::PaidExternal),
        source_id: Some("invoice:external-1".into()),
        starts_after: Some("2026-07-19T12:00:00.000Z".into()),
        starts_before: Some("2026-07-20T12:00:00+03:00".into()),
        ends_after: Some("2026-07-19T12:00:00.000Z".into()),
        ends_before: Some("2026-07-20T12:00:00.000Z".into()),
        created_after: Some("2026-07-19T12:00:00.000Z".into()),
        created_before: Some("2026-07-20T12:00:00.000Z".into()),
        sort: Some("endsAt".into()),
        dir: Some("asc".into()),
    };
    client
        .list_bundle_grants(BUNDLE, opts.clone())
        .await
        .unwrap();
    let q = server.requests.lock().unwrap()[0].query();
    let raw = serde_json::to_value(opts).unwrap();
    for (k, v) in raw.as_object().unwrap() {
        assert_eq!(
            q[k],
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        );
    }
    assert_eq!(q.len(), 13);
    for case in rest_cases()
        .into_iter()
        .filter(|c| c["operationId"] == "createBundleGrant" && c["expectedStatus"] == 200)
    {
        let body = case["request"]["body"].clone();
        let union: models::CreateGrantRequest = serde_json::from_value(body.clone()).unwrap();
        assert!(equal(&serde_json::to_value(union).unwrap(), &body));
    }
    let mut v = json!({"action":"start","timestamp":"0","version":1});
    let fixed_size = serde_json::to_vec(&v).unwrap().len() - 1;
    v["timestamp"] = "0".repeat(16 * 1024 - fixed_size).into();
    assert_eq!(serialize_signal(&v).unwrap().len(), 16 * 1024);
    v["timestamp"] = "0".repeat(16 * 1024 - fixed_size + 1).into();
    assert!(serialize_signal(&v).is_err());
    let server = Server::new(|_| {
        Reply::Normal(
            400,
            String::new(),
            serde_json::to_vec(&json!({"message":"Echo 用户 \"\\"})).unwrap(),
        )
    });
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    let e = client
        .search_users("用户 \"\\", PageOptions::default())
        .await
        .unwrap_err();
    assert!(!e.message.contains("用户"));
    let requests = server.requests.lock().unwrap();
    assert_eq!(requests[0].query()["displayName"], "用户 \"\\");
}

#[tokio::test]
async fn mutation_failures_never_retry_and_delivery_preserves_metadata() {
    let prepared = build_start_signal(1.0, SignalOptions::default()).unwrap();
    let server = Server::new(|_| Reply::status(204));
    let client = SignalsClient::new(ClientOptions {
        base_url: Some(server.url.clone()),
        ..options()
    })
    .unwrap();
    client.send(STRATEGY, &prepared).await.unwrap();
    client.send(STRATEGY, &prepared).await.unwrap();
    {
        let captured = server.requests.lock().unwrap();
        assert_eq!(captured[0].body, captured[1].body);
    }
    client.close();
    assert_eq!(
        client
            .clone()
            .send(STRATEGY, &prepared)
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Closed
    );
    for status in [429, 500, 503] {
        let server = Server::new(move |_| {
            Reply::Normal(
                status,
                String::new(),
                serde_json::to_vec(
                    &json!({"errorCode":"E501","message":"Unavailable","requestId":"req-1"}),
                )
                .unwrap(),
            )
        });
        let signals = SignalsClient::new(ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        })
        .unwrap();
        assert_eq!(
            signals.send(STRATEGY, &prepared).await.unwrap_err().status,
            Some(status)
        );
        assert_eq!(server.count(), 1);
        let rest = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(server.url.clone()),
                ..options()
            },
        )
        .unwrap();
        let grant = json!({"grantType":"gift","userId":"3ce97361321c46f2bc7300a04fd6d244"});
        assert_eq!(
            rest.create_bundle_grant(BUNDLE, &grant)
                .await
                .unwrap_err()
                .status,
            Some(status)
        );
        assert_eq!(server.count(), 2);
    }
    let server = Server::new(|_| Reply::Normal(200, String::new(), vec![b'x'; 1024 * 1024 + 1]));
    let client = RestClient::new(
        ACCOUNT,
        ClientOptions {
            base_url: Some(server.url.clone()),
            ..options()
        },
    )
    .unwrap();
    assert_eq!(
        client
            .list_bundles(PageOptions::default())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Protocol
    );
    assert_eq!(server.count(), 1);
}

#[tokio::test]
async fn shared_input_validation() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../conformance/rest/input-validation.json")).unwrap();
    for case in cases {
        let operation = case["operationId"].as_str().unwrap();
        let response = rest_cases()
            .into_iter()
            .find(|c| c["operationId"] == operation && c["expectedStatus"] == 200)
            .unwrap()["response"]
            .clone();
        let server = Server::new(move |r| {
            if r.target == "/api/rest/v1/bundles" {
                Reply::json(&json!({"bundles": [], "limit": 50}))
            } else {
                Reply::json(&response)
            }
        });
        let client = RestClient::new(
            ACCOUNT,
            ClientOptions {
                base_url: Some(format!("{}/api/rest", server.url)),
                ..options()
            },
        )
        .unwrap();
        let parameters = &case["parameters"];
        let result = match operation {
            "searchUsers" => client
                .search_users(
                    parameters["displayName"].as_str().unwrap(),
                    PageOptions::default(),
                )
                .await
                .map(|_| ()),
            "createBundleGrant" => client
                .create_bundle_grant(parameters["bundleId"].as_str().unwrap(), &case["body"])
                .await
                .map(|_| ()),
            "listBundleGrants" => {
                let mut query = parameters.clone();
                query.as_object_mut().unwrap().remove("bundleId");
                client
                    .list_bundle_grants(
                        parameters["bundleId"].as_str().unwrap(),
                        serde_json::from_value(query).unwrap(),
                    )
                    .await
                    .map(|_| ())
            }
            _ => unreachable!(),
        };
        let accepted = case["accepted"].as_bool().unwrap();
        if accepted {
            result.unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
            assert_eq!(server.count(), 1, "{}", case["id"]);
            {
                let requests = server.requests.lock().unwrap();
                let expected: std::collections::BTreeMap<_, _> = parameters
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(k, _)| k.as_str() != "bundleId")
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
                    .collect();
                assert_eq!(requests[0].query(), expected, "{}", case["id"]);
                if let Some(body) = case.get("body") {
                    assert_eq!(requests[0].json(), *body);
                }
            }
        } else {
            assert_eq!(
                result.unwrap_err().kind,
                ErrorKind::Validation,
                "{}",
                case["id"]
            );
            assert_eq!(server.count(), 0, "{}", case["id"]);
        }
        client.list_bundles(PageOptions::default()).await.unwrap();
        assert_eq!(server.count(), if accepted { 2 } else { 1 });
    }
}
