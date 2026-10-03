pub(crate) fn deserialize_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where D: serde::Deserializer<'de>, T: serde::Deserialize<'de> {
    T::deserialize(deserializer).map(Some)
}
pub(crate) fn serialize_finite<S: serde::Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if !value.is_finite() { return Err(serde::ser::Error::custom("number must be finite")); }
    serializer.serialize_f64(*value)
}
pub(crate) fn serialize_optional_finite<S: serde::Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value { Some(v) => serialize_finite(v, serializer), None => serializer.serialize_none() }
}
pub mod account_api_key_permissions;
pub use self::account_api_key_permissions::AccountApiKeyPermissions;
pub mod api_key_permission_level;
pub use self::api_key_permission_level::ApiKeyPermissionLevel;
pub mod bundle_grants_response;
pub use self::bundle_grants_response::BundleGrantsResponse;
pub mod bundle_users_response;
pub use self::bundle_users_response::BundleUsersResponse;
pub mod bundles_response;
pub use self::bundles_response::BundlesResponse;
pub mod cancel_signal_payload;
pub use self::cancel_signal_payload::CancelSignalPayload;
pub mod checkout_details;
pub use self::checkout_details::CheckoutDetails;
pub mod checkout_details_discount;
pub use self::checkout_details_discount::CheckoutDetailsDiscount;
pub mod close_signal_payload;
pub use self::close_signal_payload::CloseSignalPayload;
pub mod create_grant_request;
pub use self::create_grant_request::CreateGrantRequest;
pub mod delete_signal_payload;
pub use self::delete_signal_payload::DeleteSignalPayload;
pub mod error_response;
pub use self::error_response::ErrorResponse;
pub mod grant_mutation_response;
pub use self::grant_mutation_response::GrantMutationResponse;
pub mod open_signal_payload;
pub use self::open_signal_payload::OpenSignalPayload;
pub mod open_signal_payload_order;
pub use self::open_signal_payload_order::OpenSignalPayloadOrder;
pub mod open_signal_payload_order_take_profits_inner;
pub use self::open_signal_payload_order_take_profits_inner::OpenSignalPayloadOrderTakeProfitsInner;
pub mod other_grant_request;
pub use self::other_grant_request::OtherGrantRequest;
pub mod owned_trading_bundle_summary;
pub use self::owned_trading_bundle_summary::OwnedTradingBundleSummary;
pub mod paid_external_grant_request;
pub use self::paid_external_grant_request::PaidExternalGrantRequest;
pub mod pause_signal_payload;
pub use self::pause_signal_payload::PauseSignalPayload;
pub mod public_user;
pub use self::public_user::PublicUser;
pub mod rate_limit_response;
pub use self::rate_limit_response::RateLimitResponse;
pub mod read_only_api_key_permission_level;
pub use self::read_only_api_key_permission_level::ReadOnlyApiKeyPermissionLevel;
pub mod signal_payload;
pub use self::signal_payload::SignalPayload;
pub mod start_signal_payload;
pub use self::start_signal_payload::StartSignalPayload;
pub mod stop_signal_payload;
pub use self::stop_signal_payload::StopSignalPayload;
pub mod trading_bundle_access_grant_summary;
pub use self::trading_bundle_access_grant_summary::TradingBundleAccessGrantSummary;
pub mod trading_bundle_access_grant_type;
pub use self::trading_bundle_access_grant_type::TradingBundleAccessGrantType;
pub mod trading_bundle_granted_user;
pub use self::trading_bundle_granted_user::TradingBundleGrantedUser;
pub mod update_signal_payload;
pub use self::update_signal_payload::UpdateSignalPayload;
pub mod update_signal_payload_order;
pub use self::update_signal_payload_order::UpdateSignalPayloadOrder;
pub mod users_search_response;
pub use self::users_search_response::UsersSearchResponse;
