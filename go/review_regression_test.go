package vectortrading

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

func TestSubmittedScalarDiagnostics(t *testing.T) {
	_, sig, _ := clients(t, func(w http.ResponseWriter, r *http.Request) {
		data := readBody(t, r)
		var body map[string]json.RawMessage
		if err := json.Unmarshal(data, &body); err != nil {
			t.Error(err)
		}
		w.WriteHeader(400)
		_ = json.NewEncoder(w).Encode(map[string]any{"message": "private version=" + string(body["version"]) + " force=" + string(body["force"]) + " price=" + string(body["marketPrice"]), "errorCode": "ordinary_1.23456789012345_false", "requestId": "ordinary_1e+20"})
	}, 0)
	payload := json.RawMessage(`{"action":"open","version":1.23456789012345,"timestamp":"1780000000000","force":false,"marketPrice":1e+20,"order":{"side":"buy"}}`)
	err := sig.Send(context.Background(), strategyKey, payload)
	e := errorKind(t, err, "http")
	for _, value := range []string{"1.23456789012345", "false", "1e+20"} {
		if strings.Contains(e.Message, value) {
			t.Errorf("submitted scalar escaped redaction: %s", value)
		}
	}
	if e.Message != "private version=[redacted] force=[redacted] price=[redacted]" {
		t.Fatal("submitted values were only partially redacted")
	}
	if e.Code != "ordinary_1.23456789012345_false" || e.RequestID != "ordinary_1e+20" {
		t.Fatal("unrelated diagnostic metadata was redacted")
	}
	payload = json.RawMessage(`{"action":"open","version":1,"timestamp":"1780000000000","force":true,"marketPrice":1234.5,"order":{"side":"buy"}}`)
	e = errorKind(t, sig.Send(context.Background(), strategyKey, payload), "http")
	if e.Message != "private version=[redacted] force=[redacted] price=[redacted]" {
		t.Fatal("a shorter scalar split another submitted value during redaction")
	}
}

func TestRequestIDHeaderFallback(t *testing.T) {
	for _, body := range []string{`{"message":"denied"}`, `{"requestId":null}`, `{"requestId":42}`, "not JSON"} {
		t.Run(body, func(t *testing.T) {
			r, _, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("x-request-id", "req-header")
				w.WriteHeader(503)
				_, _ = io.WriteString(w, body)
			}, 0)
			_, err := r.ListBundles(context.Background(), PageOptions{})
			if e := errorKind(t, err, "http"); e.RequestID != "req-header" {
				t.Fatal("header request ID was lost")
			}
		})
	}
	r, _, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("x-request-id", "req-header")
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"requestId":"req-body"}`)
	}, 0)
	_, err := r.ListBundles(context.Background(), PageOptions{})
	if e := errorKind(t, err, "http"); e.RequestID != "req-body" {
		t.Fatal("body request ID lost priority")
	}
	for _, body := range []string{"not JSON", `{"requestId":42}`, `{"requestId":"body_` + strategyKey + ` https://example.invalid/private"}`} {
		t.Run("safe/"+body, func(t *testing.T) {
			_, sig, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("x-request-id", "header_"+strategyKey+" https://example.invalid/private")
				w.WriteHeader(400)
				_, _ = io.WriteString(w, body)
			}, 0)
			payload, _ := BuildPauseSignal(1, SignalOptions{})
			e := errorKind(t, sig.Send(context.Background(), strategyKey, payload), "http")
			if e.RequestID == "" || strings.Contains(e.RequestID, strategyKey) || strings.Contains(e.RequestID, "example.invalid") {
				t.Fatal("request ID was not safely preserved")
			}
		})
	}
}

func TestOpaqueAndEmptyCursors(t *testing.T) {
	for _, cursor := range []string{"", "opaque continuation / + ="} {
		for _, name := range []string{"bundles", "users", "bundleUsers", "grants"} {
			t.Run(name+"/"+cursor, func(t *testing.T) {
				var calls atomic.Int32
				r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
					n := calls.Add(1)
					if n == 2 && (!request.URL.Query().Has("cursor") || request.URL.Query().Get("cursor") != cursor) {
						t.Error("opaque cursor was not forwarded unchanged")
					}
					field := "users"
					if name == "bundles" {
						field = "bundles"
					}
					if name == "grants" {
						field = "grants"
					}
					body := map[string]any{field: []any{}, "limit": 17}
					if name == "users" {
						body["query"] = "Al"
					}
					if n == 1 {
						body["nextCursor"] = cursor
					}
					_ = json.NewEncoder(w).Encode(body)
				}, 0)
				count := 0
				accept := func(err error) {
					if err != nil {
						t.Fatal(err)
					}
					count++
				}
				ctx := context.Background()
				switch name {
				case "bundles":
					for _, err := range r.BundlesPages(ctx, PageOptions{}) {
						accept(err)
					}
				case "users":
					for _, err := range r.UsersPages(ctx, "Al", PageOptions{}) {
						accept(err)
					}
				case "bundleUsers":
					for _, err := range r.BundleUsersPages(ctx, bundleID, PageOptions{}) {
						accept(err)
					}
				case "grants":
					for _, err := range r.BundleGrantsPages(ctx, bundleID, GrantsOptions{}) {
						accept(err)
					}
				}
				if count != 2 || calls.Load() != 2 {
					t.Fatal("cursor continuation did not finish")
				}
			})
		}
	}
}

func TestEmptyCursorInitialAndRepeat(t *testing.T) {
	for _, initial := range []*string{nil, Ptr("")} {
		var calls atomic.Int32
		r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
			n := calls.Add(1)
			if n == 1 && request.URL.Query().Has("cursor") != (initial != nil) {
				t.Error("initial cursor presence was changed")
			}
			if n > 1 && (!request.URL.Query().Has("cursor") || request.URL.Query().Get("cursor") != "") {
				t.Error("empty cursor was omitted")
			}
			_, _ = io.WriteString(w, `{"bundles":[],"limit":1,"nextCursor":""}`)
		}, 0)
		count := 0
		for _, err := range r.BundlesPages(context.Background(), PageOptions{Cursor: initial}) {
			count++
			if err != nil {
				errorKind(t, err, "pagination")
				break
			}
		}
		want := int32(2)
		if initial != nil {
			want = 1
		}
		if calls.Load() != want || count != int(want)+1 {
			t.Fatal("empty repeated cursor was not bounded")
		}
	}
}
