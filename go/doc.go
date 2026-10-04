// Package vectortrading provides account-key REST integrations and offline
// strategy-signal construction. Webhook acceptance does not confirm a trade.
package vectortrading

// Version is the SDK version, independent of strategy and API versions.
const Version = "0.1.0"

// Ptr represents an explicitly supplied optional value.
func Ptr[T any](value T) *T { return &value }
