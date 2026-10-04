// Package signalexample prepares signals offline and sends explicitly.
package signalexample

import (
	"context"

	vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
)

// PrepareClear preserves the explicit intent to clear all targets.
func PrepareClear(strategyVersion float64) (*vectortrading.UpdateSignalPayload, error) {
	return vectortrading.BuildUpdateSignal(strategyVersion, 100, vectortrading.UpdateSignalPayloadOrder{Side: "buy", TakeProfits: []vectortrading.OpenSignalPayloadOrderTakeProfitsInner{}}, vectortrading.SignalOptions{})
}

// SendPrepared reuses a client and sends existing metadata with this request's key.
func SendPrepared(ctx context.Context, client *vectortrading.SignalsClient, strategyKey string, message *vectortrading.UpdateSignalPayload) error {
	return client.Send(ctx, strategyKey, message)
}
