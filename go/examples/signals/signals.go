// Package signalexample prepares signals offline and sends explicitly.
package signalexample

import (
	"context"
	"net/http"

	vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
)

// PrepareClear preserves the explicit intent to clear all targets.
func PrepareClear(strategyVersion float64) (*vectortrading.UpdateSignalPayload, error) {
	return vectortrading.BuildUpdateSignal(strategyVersion, 100, vectortrading.UpdateSignalPayloadOrder{Side: "buy", TakeProfits: []vectortrading.OpenSignalPayloadOrderTakeProfitsInner{}}, vectortrading.SignalOptions{})
}

// SendPrepared sends existing metadata without creating a new timestamp.
func SendPrepared(ctx context.Context, baseURL, strategyKey string, message *vectortrading.UpdateSignalPayload, allowLocalHTTP bool) error {
	client, err := vectortrading.NewSignalsClient(baseURL, strategyKey, vectortrading.ClientOptions{HTTPClient: &http.Client{}, AllowHTTPForLocalhost: allowLocalHTTP})
	if err != nil {
		return err
	}
	defer client.Close()
	return client.Send(ctx, message)
}
