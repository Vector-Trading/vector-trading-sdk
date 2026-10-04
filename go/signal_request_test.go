package vectortrading

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSignalRequestKeysAndConcurrency(t *testing.T) {
	const otherKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	const followupKey = "cccccccccccccccccccccccccccccccc"
	for _, order := range [][]string{{strategyKey, otherKey}, {otherKey, strategyKey}} {
		t.Run(order[0][:1]+"-first", func(t *testing.T) {
			payload, err := BuildOpenSignal(1.25, 100, OpenSignalPayloadOrder{Side: "buy"}, OpenSignalOptions{SignalOptions: SignalOptions{Timestamp: Ptr("1780000000000")}, Force: Ptr(false)})
			if err != nil {
				t.Fatal(err)
			}
			before, err := SerializeSignal(payload)
			if err != nil {
				t.Fatal(err)
			}
			received := make(chan string, 2)
			release := map[string]chan struct{}{strategyKey: make(chan struct{}), otherKey: make(chan struct{})}
			completed := make(chan struct {
				key string
				err error
			}, 2)
			var calls atomic.Int32
			_, sig, _ := clients(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				key := strings.TrimPrefix(r.URL.Path, "/webhooks/signals/v1/")
				if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" || r.Method != "POST" {
					t.Error("credential isolation")
				}
				equalJSON(t, readBody(t, r), before)
				if key == followupKey {
					w.WriteHeader(204)
					return
				}
				gate, ok := release[key]
				if !ok {
					t.Error("wrong signal path")
					w.WriteHeader(404)
					return
				}
				received <- key
				select {
				case <-gate:
				case <-r.Context().Done():
					return
				}
				w.Header().Set("x-request-id", "header_"+key)
				w.WriteHeader(400)
				_ = json.NewEncoder(w).Encode(map[string]any{"message": "failed " + key + " https://example.invalid/webhooks/" + key, "errorCode": "code_" + key[:1] + ":" + key, "requestId": "req_" + key})
			}, 0)
			defer func() {
				for _, gate := range release {
					select {
					case <-gate:
					default:
						close(gate)
					}
				}
			}()
			if calls.Load() != 0 {
				t.Fatal("construction performed I/O")
			}
			for _, key := range []string{strategyKey, otherKey} {
				go func() {
					completed <- struct {
						key string
						err error
					}{key, sig.Send(context.Background(), key, payload)}
				}()
			}
			seen := map[string]bool{}
			for range 2 {
				select {
				case key := <-received:
					seen[key] = true
				case <-time.After(2 * time.Second):
					t.Fatal("both requests did not arrive")
				}
			}
			if !seen[strategyKey] || !seen[otherKey] {
				t.Fatal("keys mixed across requests")
			}
			for _, key := range order {
				close(release[key])
				select {
				case result := <-completed:
					if result.key != key {
						t.Fatal("reply ordering was not controlled")
					}
					e := errorKind(t, result.err, "http")
					if e.Code != "code_"+key[:1]+":[redacted]" {
						t.Fatal("wrong request error context")
					}
					for _, diagnostic := range []string{e.Error(), e.Code, e.RequestID, fmt.Sprintf("%+v", e)} {
						if strings.Contains(diagnostic, strategyKey) || strings.Contains(diagnostic, otherKey) || strings.Contains(diagnostic, "example.invalid") {
							t.Fatal("private request diagnostics")
						}
					}
				case <-time.After(2 * time.Second):
					t.Fatal("released reply did not complete")
				}
			}
			if err := sig.Send(context.Background(), followupKey, payload); err != nil {
				t.Fatal(err)
			}
			after, _ := SerializeSignal(payload)
			if string(before) != string(after) || calls.Load() != 3 {
				t.Fatal("payload changed or a request was retried")
			}
		})
	}
}

func TestSignalInvalidKeysAndFollowup(t *testing.T) {
	var calls atomic.Int32
	_, sig, _ := clients(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/webhooks/signals/v1/"+strategyKey || r.Header.Get("Authorization") != "" {
			t.Error("wrong followup credentials")
		}
		w.WriteHeader(204)
	}, 0)
	payload, _ := BuildPauseSignal(1, SignalOptions{})
	for _, key := range []string{"", strategyKey[:31], strategyKey + "a", strings.ToUpper(strategyKey), " " + strategyKey[1:], strategyKey + "\n", strategyKey[:31] + "\r", "../" + strategyKey, strings.Repeat("ａ", 32), strings.Repeat("g", 32)} {
		before := calls.Load()
		// Invalid keys are rejected before even attempting to serialize this non-JSON value.
		e := errorKind(t, sig.Send(context.Background(), key, make(chan int)), "validation")
		if e.Message != "Invalid strategy credential" || calls.Load() != before || key != "" && strings.Contains(e.Error(), key) {
			t.Fatal("invalid credential was used or disclosed")
		}
		if err := sig.Send(context.Background(), strategyKey, payload); err != nil {
			t.Fatal(err)
		}
		if calls.Load() != before+1 {
			t.Fatal("followup did not work")
		}
	}
}

func TestSignalTimeoutCancellationAndFollowup(t *testing.T) {
	for _, mode := range []string{"timeout", "cancel", "lost"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			ready := make(chan struct{})
			release := make(chan struct{})
			_, sig, _ := clients(t, func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) > 1 {
					if r.URL.Path != "/webhooks/signals/v1/"+strings.Repeat("b", 32) {
						t.Error("followup key was lost")
					}
					w.WriteHeader(204)
					return
				}
				close(ready)
				if mode == "lost" {
					conn, _, err := w.(http.Hijacker).Hijack()
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}, 40*time.Millisecond)
			defer close(release)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				go func() { <-ready; cancel() }()
			}
			payload, _ := BuildPauseSignal(1, SignalOptions{})
			kind := "timeout"
			if mode == "cancel" {
				kind = "cancelled"
			}
			if mode == "lost" {
				kind = "transport"
			}
			errorKind(t, sig.Send(ctx, strategyKey, payload), kind)
			if err := sig.Send(context.Background(), strings.Repeat("b", 32), payload); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 2 {
				t.Fatal("failure poisoned client or retried")
			}
		})
	}
}
