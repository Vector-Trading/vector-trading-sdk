package vectortrading

import "github.com/Vector-Trading/vector-trading-sdk/go/internal/generated"

// AccountApiKeyPermissions is a public transport model from the accepted contract.
type AccountApiKeyPermissions = generated.AccountApiKeyPermissions

// ApiKeyPermissionLevel is a public transport model from the accepted contract.
type ApiKeyPermissionLevel = generated.ApiKeyPermissionLevel

// BundleGrantsResponse is a public transport model from the accepted contract.
type BundleGrantsResponse = generated.BundleGrantsResponse

// BundleUsersResponse is a public transport model from the accepted contract.
type BundleUsersResponse = generated.BundleUsersResponse

// BundlesResponse is a public transport model from the accepted contract.
type BundlesResponse = generated.BundlesResponse

// CancelSignalPayload is a public transport model from the accepted contract.
type CancelSignalPayload = generated.CancelSignalPayload

// CheckoutDetails is a public transport model from the accepted contract.
type CheckoutDetails = generated.CheckoutDetails

// CheckoutDetailsDiscount is a public transport model from the accepted contract.
type CheckoutDetailsDiscount = generated.CheckoutDetailsDiscount

// CloseSignalPayload is a public transport model from the accepted contract.
type CloseSignalPayload = generated.CloseSignalPayload

// CreateGrantRequest is a public transport model from the accepted contract.
type CreateGrantRequest = generated.CreateGrantRequest

// DeleteSignalPayload is a public transport model from the accepted contract.
type DeleteSignalPayload = generated.DeleteSignalPayload

// ErrorResponse is a public transport model from the accepted contract.
type ErrorResponse = generated.ErrorResponse

// GrantMutationResponse is a public transport model from the accepted contract.
type GrantMutationResponse = generated.GrantMutationResponse

// OpenSignalPayload is a public transport model from the accepted contract.
type OpenSignalPayload = generated.OpenSignalPayload

// OpenSignalPayloadOrder is a public transport model from the accepted contract.
type OpenSignalPayloadOrder = generated.OpenSignalPayloadOrder

// OpenSignalPayloadOrderTakeProfitsInner is a public transport model from the accepted contract.
type OpenSignalPayloadOrderTakeProfitsInner = generated.OpenSignalPayloadOrderTakeProfitsInner

// OtherGrantRequest is a public transport model from the accepted contract.
type OtherGrantRequest = generated.OtherGrantRequest

// OwnedTradingBundleSummary is a public transport model from the accepted contract.
type OwnedTradingBundleSummary = generated.OwnedTradingBundleSummary

// PaidExternalGrantRequest is a public transport model from the accepted contract.
type PaidExternalGrantRequest = generated.PaidExternalGrantRequest

// PauseSignalPayload is a public transport model from the accepted contract.
type PauseSignalPayload = generated.PauseSignalPayload

// PublicUser is a public transport model from the accepted contract.
type PublicUser = generated.PublicUser

// RateLimitResponse is a public transport model from the accepted contract.
type RateLimitResponse = generated.RateLimitResponse

// ReadOnlyApiKeyPermissionLevel is a public transport model from the accepted contract.
type ReadOnlyApiKeyPermissionLevel = generated.ReadOnlyApiKeyPermissionLevel

// SignalPayload is a public transport model from the accepted contract.
type SignalPayload = generated.SignalPayload

// StartSignalPayload is a public transport model from the accepted contract.
type StartSignalPayload = generated.StartSignalPayload

// StopSignalPayload is a public transport model from the accepted contract.
type StopSignalPayload = generated.StopSignalPayload

// TradingBundleAccessGrantSummary is a public transport model from the accepted contract.
type TradingBundleAccessGrantSummary = generated.TradingBundleAccessGrantSummary

// TradingBundleAccessGrantType is a public transport model from the accepted contract.
type TradingBundleAccessGrantType = generated.TradingBundleAccessGrantType

// TradingBundleGrantedUser is a public transport model from the accepted contract.
type TradingBundleGrantedUser = generated.TradingBundleGrantedUser

// UpdateSignalPayload is a public transport model from the accepted contract.
type UpdateSignalPayload = generated.UpdateSignalPayload

// UpdateSignalPayloadOrder is a public transport model from the accepted contract.
type UpdateSignalPayloadOrder = generated.UpdateSignalPayloadOrder

// UsersSearchResponse is a public transport model from the accepted contract.
type UsersSearchResponse = generated.UsersSearchResponse

// NullableString preserves omitted, null, and present response values.
type NullableString = generated.NullableString

// Public grant types retain server transport values; trial is response-only.
const (
	GrantTypeTrial          = generated.TRADINGBUNDLEACCESSGRANTTYPE_TRIAL
	GrantTypeOwnerGrant     = generated.TRADINGBUNDLEACCESSGRANTTYPE_OWNER_GRANT
	GrantTypePaidExternal   = generated.TRADINGBUNDLEACCESSGRANTTYPE_PAID_EXTERNAL
	GrantTypeReferralReward = generated.TRADINGBUNDLEACCESSGRANTTYPE_REFERRAL_REWARD
	GrantTypeGift           = generated.TRADINGBUNDLEACCESSGRANTTYPE_GIFT
)
