package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"time"

	sdk "github.com/Vector-Trading/vector-trading-sdk/go"
	restexample "github.com/Vector-Trading/vector-trading-sdk/go/examples/rest"
	signalexample "github.com/Vector-Trading/vector-trading-sdk/go/examples/signals"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}
func main() {
	const bundle = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	const user = "cccccccccccccccccccccccccccccccc"
	const strategy = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const otherStrategy = "dddddddddddddddddddddddddddddddd"
	const account = "vt_synthetic_consumer_secret"
	var calls atomic.Int32
	var signals atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		body, _ := io.ReadAll(r.Body)
		if strings.HasPrefix(r.URL.Path, "/webhooks/") {
			n := signals.Add(1)
			key := strategy
			if n == 2 {
				key = otherStrategy
			}
			if r.URL.Path != "/webhooks/signals/v1/"+key || r.Header.Get("Authorization") != "" {
				panic("credential isolation")
			}
			var v map[string]any
			check(json.Unmarshal(body, &v))
			if _, ok := v["strategyApiKey"]; ok {
				panic("strategy key entered the signal body")
			}
			if v["timestamp"] == nil {
				panic("timestamp")
			}
			if v["action"] == "update" {
				order := v["order"].(map[string]any)
				if targets, ok := order["takeProfits"].([]any); !ok || len(targets) != 0 {
					panic("targets not cleared")
				}
			}
			w.WriteHeader(204)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+account {
			panic("account header")
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/users"):
			if r.URL.Path == "/api/rest/v1/users" {
				_, _ = io.WriteString(w, `{"users":[],"query":"Al","limit":1}`)
			} else {
				_, _ = io.WriteString(w, `{"users":[],"limit":1}`)
			}
		case strings.Contains(r.URL.Path, "/checkout/"):
			_, _ = fmt.Fprintf(w, `{"bundleId":"%s","checkoutId":"%s","displayName":"Example","userId":"%s"}`, bundle, bundle, user)
		case strings.Contains(r.URL.Path, "/grants"):
			if r.Method == "GET" {
				_, _ = io.WriteString(w, `{"grants":[],"limit":1}`)
			} else {
				if r.Method == "POST" {
					var v map[string]any
					check(json.Unmarshal(body, &v))
					if v["sourceId"] != "invoice:1" || v["endsAt"] == nil {
						panic("grant fields")
					}
				}
				_, _ = fmt.Fprintf(w, `{"grant":{"id":"%s","grantType":"paid_external"}}`, bundle)
			}
		default:
			_, _ = io.WriteString(w, `{"bundles":[],"limit":1}`)
		}
	}))
	defer server.Close()
	options := sdk.ClientOptions{HTTPClient: server.Client(), AllowHTTPForLocalhost: true}
	rest, err := sdk.NewRestClient(account, sdk.ClientOptions{BaseURL: server.URL + "/api/rest", HTTPClient: options.HTTPClient, AllowHTTPForLocalhost: options.AllowHTTPForLocalhost, Timeout: options.Timeout})
	check(err)
	defer rest.Close()
	signalsClient, err := sdk.NewSignalsClient(sdk.ClientOptions{BaseURL: server.URL, HTTPClient: options.HTTPClient, AllowHTTPForLocalhost: options.AllowHTTPForLocalhost, Timeout: options.Timeout})
	check(err)
	defer signalsClient.Close()
	if calls.Load() != 0 {
		panic("construction I/O")
	}
	ctx := context.Background()
	_, err = rest.ListBundles(ctx, sdk.PageOptions{})
	check(err)
	_, err = rest.SearchUsers(ctx, "Al", sdk.PageOptions{})
	check(err)
	_, err = rest.GetCheckout(ctx, bundle)
	check(err)
	_, err = rest.ListBundleUsers(ctx, bundle, sdk.PageOptions{})
	check(err)
	_, err = rest.ListBundleGrants(ctx, bundle, sdk.GrantsOptions{})
	check(err)
	date := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	_, err = rest.CreateBundleGrant(ctx, bundle, sdk.PaidExternalGrantRequest{GrantType: "paid_external", UserId: user, SourceId: "invoice:1", EndsAt: &date})
	check(err)
	_, err = rest.RevokeBundleGrant(ctx, bundle, bundle)
	check(err)
	opts := sdk.SignalOptions{Timestamp: sdk.Ptr("1780000000000")}
	open, err := sdk.BuildOpenSignal(1.5, 100, sdk.OpenSignalPayloadOrder{Side: "buy"}, sdk.OpenSignalOptions{SignalOptions: opts, Force: sdk.Ptr(false)})
	check(err)
	check(signalsClient.Send(ctx, strategy, open))
	update, err := sdk.BuildUpdateSignal(1, 100, sdk.UpdateSignalPayloadOrder{Side: "buy", TakeProfits: []sdk.OpenSignalPayloadOrderTakeProfitsInner{}}, opts)
	check(err)
	check(signalsClient.Send(ctx, otherStrategy, update))
	cancel, err := sdk.BuildCancelSignal(1, sdk.ExitSignalOptions{SignalOptions: opts})
	check(err)
	check(signalsClient.Send(ctx, strategy, cancel))
	closeSignal, err := sdk.BuildCloseSignal(1, sdk.ExitSignalOptions{SignalOptions: opts})
	check(err)
	check(signalsClient.Send(ctx, strategy, closeSignal))
	start, err := sdk.BuildStartSignal(1, opts)
	check(err)
	check(signalsClient.Send(ctx, strategy, start))
	pause, err := sdk.BuildPauseSignal(1, opts)
	check(err)
	check(signalsClient.Send(ctx, strategy, pause))
	stop, err := sdk.BuildStopSignal(1, opts)
	check(err)
	check(signalsClient.Send(ctx, strategy, stop))
	deleteSignal, err := sdk.BuildDeleteSignal(1, opts)
	check(err)
	check(signalsClient.Send(ctx, strategy, deleteSignal))
	if calls.Load() != 15 || signals.Load() != 8 {
		panic("coverage")
	}
	check(restexample.Run(ctx, server.URL+"/api/rest", account, true))
	prepared, err := signalexample.PrepareClear(1)
	check(err)
	first, err := sdk.SerializeSignal(prepared)
	check(err)
	check(signalexample.SendPrepared(ctx, signalsClient, strategy, prepared))
	second, err := sdk.SerializeSignal(prepared)
	check(err)
	if string(first) != string(second) {
		panic("timestamp refreshed")
	}
	fmt.Println("Clean module consumer: 7 REST methods, 8 signals, two keys on one client, examples, dates, credential isolation, TP clearing and stable metadata passed")
}
