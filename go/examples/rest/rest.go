// Package restexample demonstrates explicit account-key integration.
package restexample

import (
	"context"
	"net/http"

	vectortrading "github.com/Vector-Trading/vector-trading-sdk/go"
)

// Run lists bundles using a caller-supplied address and account key.
func Run(ctx context.Context, baseURL, accountKey string, allowLocalHTTP bool) error {
	client, err := vectortrading.NewRestClient(accountKey, vectortrading.ClientOptions{BaseURL: baseURL, HTTPClient: &http.Client{}, AllowHTTPForLocalhost: allowLocalHTTP})
	if err != nil {
		return err
	}
	defer client.Close()
	for _, err := range client.BundlesPages(ctx, vectortrading.PageOptions{Limit: vectortrading.Ptr(int32(25))}) {
		if err != nil {
			return err
		}
	}
	return nil
}
