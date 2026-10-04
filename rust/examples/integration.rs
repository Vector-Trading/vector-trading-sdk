//! An explicit local receiver or HTTPS deployment; never retries mutations.
use vector_trading_sdk::{models, *};

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    SignalsClient::new(ClientOptions::default())?.close();
    RestClient::new("vt_synthetic", ClientOptions::default())?.close();
    let origin = std::env::var("VECTOR_ORIGIN")?;
    let options = ClientOptions {
        allow_http_for_localhost: std::env::var("VECTOR_LOCAL_TEST").as_deref() == Ok("1"),
        ..Default::default()
    };
    let rest = RestClient::new(
        &std::env::var("VECTOR_ACCOUNT_KEY")?,
        ClientOptions {
            base_url: Some(format!("{origin}/api/rest")),
            ..options.clone()
        },
    )?;
    let signals = SignalsClient::new(ClientOptions {
        base_url: Some(origin.clone()),
        ..options
    })?;
    let strategy = std::env::var("VECTOR_STRATEGY_KEY")?;
    let other_strategy = std::env::var("VECTOR_OTHER_STRATEGY_KEY")?;
    let bundle = std::env::var("VECTOR_BUNDLE_ID")?;
    let user = std::env::var("VECTOR_USER_ID")?;
    let checkout = std::env::var("VECTOR_CHECKOUT_ID")?;
    rest.list_bundles(PageOptions::default()).await?;
    rest.search_users("Example", PageOptions::default()).await?;
    rest.get_checkout(&checkout).await?;
    rest.list_bundle_users(&bundle, PageOptions::default())
        .await?;
    rest.list_bundle_grants(&bundle, GrantOptions::default())
        .await?;
    // Run this example only against an explicitly authorized safe environment.
    let grant = models::PaidExternalGrantRequest::new(
        models::paid_external_grant_request::GrantType::PaidExternal,
        "example:invoice-1".into(),
        user,
    );
    let created = rest.create_bundle_grant(&bundle, &grant).await?;
    rest.revoke_bundle_grant(&bundle, &created.grant.id).await?;
    let open = models::OpenSignalPayloadOrder::new(models::open_signal_payload_order::Side::Buy);
    let mut update =
        models::UpdateSignalPayloadOrder::new(models::update_signal_payload_order::Side::Buy);
    update.take_profits = Some(vec![]);
    signals
        .send(
            &strategy,
            &build_open_signal(1.0, 100.0, open, OpenSignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_update_signal(1.0, 100.0, update, SignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_cancel_signal(1.0, ExitSignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_close_signal(1.0, ExitSignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_start_signal(1.0, SignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_pause_signal(1.0, SignalOptions::default())?,
        )
        .await?;
    signals
        .send(
            &strategy,
            &build_stop_signal(1.0, SignalOptions::default())?,
        )
        .await?;
    let prepared = build_delete_signal(1.0, SignalOptions::default())?;
    tokio::select! {
        result = signals.send(&other_strategy, &prepared) => result?,
        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => return Err("Waiting cancelled; remote outcome may be unknown".into()),
    }
    rest.close();
    signals.close();
    Ok(())
}
