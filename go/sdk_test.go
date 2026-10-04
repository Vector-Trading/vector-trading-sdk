package vectortrading

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const accountKey = "vt_synthetic_account_secret"
const strategyKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const bundleID = "2be97361321c46f2bc7300a04fd6d133"
const grantID = "5ee97361321c46f2bc7300a04fd6d466"
const userID = "3ce97361321c46f2bc7300a04fd6d244"
const checkoutID = "6fe97361321c46f2bc7300a04fd6d577"

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func equalJSON(t *testing.T, a, b []byte) {
	t.Helper()
	av, ae := decodeValue(a)
	bv, be := decodeValue(b)
	if ae != nil || be != nil || !reflect.DeepEqual(normalizeDates(av), normalizeDates(bv)) {
		t.Fatal("JSON differs from accepted fixture")
	}
}
func errorKind(t *testing.T, err error, kind string) *Error {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Kind != kind {
		t.Fatalf("expected %s, got %v", kind, err)
	}
	return e
}
func withBaseURL(base string, options ClientOptions) ClientOptions {
	options.BaseURL = base
	return options
}

func clients(t *testing.T, h http.HandlerFunc, timeout time.Duration) (*RestClient, *SignalsClient, *httptest.Server) {
	t.Helper()
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	opts := ClientOptions{HTTPClient: s.Client(), AllowHTTPForLocalhost: true, Timeout: timeout}
	r, err := NewRestClient(accountKey, withBaseURL(s.URL+"/api/rest", opts))
	if err != nil {
		t.Fatal(err)
	}
	sig, err := NewSignalsClient(withBaseURL(s.URL, opts))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	t.Cleanup(sig.Close)
	return r, sig, s
}
func readBody(t *testing.T, r *http.Request) []byte {
	t.Helper()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Error(err)
	}
	return b
}

type restFixture struct {
	ID        string `json:"id"`
	Operation string `json:"operationId"`
	Status    int    `json:"expectedStatus"`
	Request   struct {
		Method string         `json:"method"`
		Path   string         `json:"path"`
		Query  map[string]any `json:"query"`
		Body   any            `json:"body"`
	} `json:"request"`
	Response json.RawMessage `json:"response"`
}

func restFixtures(t *testing.T) []restFixture {
	t.Helper()
	data, err := os.ReadFile("../conformance/rest/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []restFixture
	if json.Unmarshal(data, &fixtures) != nil {
		t.Fatal("fixtures")
	}
	return fixtures
}
func callFixture(ctx context.Context, c *RestClient, f restFixture) (any, error) {
	switch f.Operation {
	case "listBundles":
		return c.ListBundles(ctx, PageOptions{})
	case "searchUsers":
		return c.SearchUsers(ctx, "Al", PageOptions{})
	case "getCheckout":
		return c.GetCheckout(ctx, checkoutID)
	case "listBundleUsers":
		return c.ListBundleUsers(ctx, bundleID, PageOptions{})
	case "listBundleGrants":
		return c.ListBundleGrants(ctx, bundleID, GrantsOptions{})
	case "createBundleGrant":
		return c.CreateBundleGrant(ctx, bundleID, f.Request.Body)
	case "revokeBundleGrant":
		return c.RevokeBundleGrant(ctx, bundleID, grantID)
	}
	return nil, fmt.Errorf("unknown fixture")
}
func TestRESTFixtures(t *testing.T) {
	for _, f := range restFixtures(t) {
		t.Run(f.ID, func(t *testing.T) {
			var calls atomic.Int32
			r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
				calls.Add(1)
				if request.Method != f.Request.Method || request.URL.Path != "/api/rest"+f.Request.Path || request.Header.Get("Authorization") != "Bearer "+accountKey {
					t.Error("request path/method/key mismatch")
				}
				want := url.Values{}
				for k, v := range f.Request.Query {
					want.Set(k, fmt.Sprint(v))
				}
				if !reflect.DeepEqual(request.URL.Query(), want) {
					t.Error("query mismatch")
				}
				if f.Request.Body != nil {
					equalJSON(t, readBody(t, request), mustJSON(t, f.Request.Body))
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(f.Status)
				_, _ = w.Write(f.Response)
			}, 0)
			result, err := callFixture(context.Background(), r, f)
			if f.Status != 200 {
				errorKind(t, err, "validation")
				if calls.Load() != 0 {
					t.Error("invalid body was sent")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			equalJSON(t, mustJSON(t, result), f.Response)
			if calls.Load() != 1 {
				t.Error("unexpected retry")
			}
		})
	}
}
func TestSignalFixtures(t *testing.T) {
	data, err := os.ReadFile("../conformance/signals/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		ID      string          `json:"id"`
		Payload json.RawMessage `json:"payload"`
		Schema  bool            `json:"schemaAccepted"`
		Parser  bool            `json:"parserAccepted"`
	}
	if json.Unmarshal(data, &fixtures) != nil {
		t.Fatal("fixtures")
	}
	for _, f := range fixtures {
		t.Run(f.ID, func(t *testing.T) {
			wire, err := SerializeSignal(f.Payload)
			if !f.Schema || !f.Parser {
				errorKind(t, err, "validation")
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var input map[string]any
			_ = json.Unmarshal(f.Payload, &input)
			model, err := BuildSignal(input)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := SerializeSignal(model)
			if err != nil {
				t.Fatal(err)
			}
			equalJSON(t, wire, encoded)
			var calls atomic.Int32
			_, c, _ := clients(t, func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/webhooks/signals/v1/"+strategyKey || r.Header.Get("Authorization") != "" || r.Method != "POST" {
					t.Error("signal credential isolation")
				}
				equalJSON(t, readBody(t, r), f.Payload)
				w.WriteHeader(204)
			}, 0)
			for i := 0; i < 2; i++ {
				if err := c.Send(context.Background(), strategyKey, model); err != nil {
					t.Fatal(err)
				}
			}
			if calls.Load() != 2 {
				t.Error("unexpected retry")
			}
		})
	}
}
func TestNamedBuildersAndIntent(t *testing.T) {
	opts := SignalOptions{Timestamp: Ptr("1780000000000"), Hashtag: Ptr("example_1")}
	open, err := BuildOpenSignal(1.5, 100, OpenSignalPayloadOrder{Side: "buy"}, OpenSignalOptions{SignalOptions: opts, Force: Ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if open.Version != 1.5 || open.Force == nil || *open.Force {
		t.Fatal("force/version")
	}
	for _, targets := range [][]OpenSignalPayloadOrderTakeProfitsInner{nil, {}, {{Price: 110, Percent: 50}}} {
		order := UpdateSignalPayloadOrder{Side: "buy", TakeProfits: targets}
		s, err := BuildUpdateSignal(1, 100, order, opts)
		if err != nil {
			t.Fatal(err)
		}
		b, err := SerializeSignal(s)
		if err != nil {
			t.Fatal(err)
		}
		v, _ := decodeValue(b)
		o := v.(map[string]any)["order"].(map[string]any)
		tp, present := o["takeProfits"]
		if present != (targets != nil) {
			t.Error("target omission changed")
		}
		if targets != nil && len(tp.([]any)) != len(targets) {
			t.Error("target array changed")
		}
	}
	a, err := BuildCancelSignal(1, ExitSignalOptions{SignalOptions: opts, MarketPrice: Ptr(100.0)})
	if err != nil || a.MarketPrice == nil {
		t.Fatal("cancel")
	}
	b, err := BuildCloseSignal(1, ExitSignalOptions{SignalOptions: opts})
	if err != nil || b.MarketPrice != nil {
		t.Fatal("close")
	}
	for _, builder := range []func(float64, SignalOptions) (any, error){func(v float64, o SignalOptions) (any, error) { return BuildStartSignal(v, o) }, func(v float64, o SignalOptions) (any, error) { return BuildPauseSignal(v, o) }, func(v float64, o SignalOptions) (any, error) { return BuildStopSignal(v, o) }, func(v float64, o SignalOptions) (any, error) { return BuildDeleteSignal(v, o) }} {
		s, err := builder(1, opts)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = SerializeSignal(s); err != nil {
			t.Fatal(err)
		}
	}
	input := map[string]any{"action": "update", "version": 1.0, "marketPrice": 100.0, "order": map[string]any{"side": "buy", "takeProfits": []any{}}}
	before := time.Now().UnixMilli()
	s, err := BuildSignal(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := input["timestamp"]; exists {
		t.Error("input mutated")
	}
	stamp := s.UpdateSignalPayload.Timestamp
	parsed, _ := time.ParseDuration(stamp + "ms")
	if parsed.Milliseconds() < before {
		t.Error("timestamp")
	}
	input["order"].(map[string]any)["side"] = "sell"
	if s.UpdateSignalPayload.Order.Side != "buy" {
		t.Error("builder alias")
	}
	for _, value := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		_, err := BuildPauseSignal(value, opts)
		errorKind(t, err, "validation")
	}
	for _, stamp := range []string{"", "-1", "1.5", "9007199254740992"} {
		_, err := BuildPauseSignal(1, SignalOptions{Timestamp: Ptr(stamp)})
		errorKind(t, err, "validation")
	}
	if _, err := BuildPauseSignal(1, SignalOptions{Timestamp: Ptr(strings.Repeat("0", 5000) + "1780000000000")}); err != nil {
		t.Fatal("leading zero timestamp", err)
	}
}
func TestPagination(t *testing.T) {
	for _, name := range []string{"bundles", "users", "bundleUsers", "grants"} {
		t.Run(name, func(t *testing.T) {
			var calls atomic.Int32
			r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
				n := calls.Add(1)
				if request.URL.Query().Get("limit") != "17" {
					t.Error("limit lost")
				}
				cursor := request.URL.Query().Get("cursor")
				if n == 2 && cursor != "scan:"+grantID {
					t.Error("cursor lost")
				}
				field := "users"
				if name == "bundles" {
					field = "bundles"
				}
				if name == "grants" {
					field = "grants"
					q := request.URL.Query()
					for _, key := range []string{"userId", "grantType", "sourceId", "startsAfter", "startsBefore", "endsAfter", "endsBefore", "createdAfter", "createdBefore", "sort", "dir"} {
						if q.Get(key) == "" {
							t.Error("filter lost", key)
						}
					}
				}
				if name == "users" && request.URL.Query().Get("displayName") != "Al" {
					t.Error("search lost")
				}
				out := map[string]any{field: []any{}, "limit": 17}
				if name == "users" {
					out["query"] = "Al"
				}
				if n == 1 {
					out["nextCursor"] = "scan:" + grantID
				}
				_ = json.NewEncoder(w).Encode(out)
			}, 0)
			ctx := context.Background()
			opts := PageOptions{Limit: Ptr(int32(17))}
			count := 0
			switch name {
			case "bundles":
				for p, err := range r.BundlesPages(ctx, opts) {
					if err != nil || p == nil {
						t.Fatal(err)
					}
					count++
				}
			case "users":
				for p, err := range r.UsersPages(ctx, "Al", opts) {
					if err != nil || p == nil {
						t.Fatal(err)
					}
					count++
				}
			case "bundleUsers":
				for p, err := range r.BundleUsersPages(ctx, bundleID, opts) {
					if err != nil || p == nil {
						t.Fatal(err)
					}
					count++
				}
			case "grants":
				date := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
				g := GrantsOptions{PageOptions: opts, UserID: Ptr(userID), GrantType: Ptr(TradingBundleAccessGrantType("paid_external")), SourceID: Ptr("invoice:1"), StartsAfter: &date, StartsBefore: &date, EndsAfter: &date, EndsBefore: &date, CreatedAfter: &date, CreatedBefore: &date, Sort: Ptr("endsAt"), Dir: Ptr("asc")}
				for p, err := range r.BundleGrantsPages(ctx, bundleID, g) {
					if err != nil || p == nil {
						t.Fatal(err)
					}
					count++
				}
			}
			if count != 2 || calls.Load() != 2 {
				t.Fatal("empty continuation stopped traversal")
			}
		})
	}
	r, _, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"bundles":[],"limit":1,"nextCursor":"opaque:repeat"}`)
	}, 0)
	count := 0
	for _, err := range r.BundlesPages(context.Background(), PageOptions{}) {
		if err != nil {
			errorKind(t, err, "pagination")
			count++
			break
		}
		count++
	}
	if count != 3 {
		t.Fatal("repeat detection")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	count = 0
	for _, err := range r.BundlesPages(ctx, PageOptions{}) {
		if err != nil {
			errorKind(t, err, "cancelled")
			break
		}
		count++
		cancel()
	}
	if count != 1 {
		t.Fatal("cancellation")
	}
}
func TestErrorsNoRetriesAndRedaction(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 409, 410, 413, 429, 500, 502, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls atomic.Int32
			r, sig, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(map[string]any{"errorCode": "E501", "message": "failed " + accountKey + " " + strategyKey + " https://example.invalid/private invoice:private", "requestId": "req123"})
			}, 0)
			_, err := r.CreateBundleGrant(context.Background(), bundleID, PaidExternalGrantRequest{UserId: userID, GrantType: "paid_external", SourceId: "invoice:private"})
			e := errorKind(t, err, "http")
			if e.Status != status || e.Code != "E501" || e.RequestID != "req123" {
				t.Fatal("error metadata")
			}
			if strings.Contains(e.Error(), accountKey) || strings.Contains(e.Error(), strategyKey) || strings.Contains(e.Error(), "invoice:private") || strings.Contains(e.Error(), "example.invalid") {
				t.Fatal("private diagnostics")
			}
			message, _ := BuildPauseSignal(1, SignalOptions{})
			err = sig.Send(context.Background(), strategyKey, message)
			errorKind(t, err, "http")
			if calls.Load() != 2 {
				t.Fatal("mutation retried")
			}
		})
	}
	for _, body := range []string{"", "upstream unavailable", `{"success":false,"error":"slow down"}`, `{"message":"` + strings.Repeat("a", 1000) + `"}`} {
		t.Run(fmt.Sprint(len(body)), func(t *testing.T) {
			r, _, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(429); _, _ = io.WriteString(w, body) }, 0)
			_, err := r.ListBundles(context.Background(), PageOptions{})
			e := errorKind(t, err, "http")
			if len(e.Message) > 512 {
				t.Fatal("unbounded error")
			}
		})
	}
}
func TestDeadlinesLostResponsesAndCancellation(t *testing.T) {
	for _, mode := range []string{"timeout", "stream", "cancel", "lost"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			ready := make(chan struct{})
			release := make(chan struct{})
			var once sync.Once
			r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
				calls.Add(1)
				once.Do(func() { close(ready) })
				if mode == "lost" {
					h := w.(http.Hijacker)
					conn, _, err := h.Hijack()
					if err == nil {
						_ = conn.Close()
					}
					return
				}
				if mode == "stream" {
					w.WriteHeader(200)
					_, _ = io.WriteString(w, `{"grant":`)
					w.(http.Flusher).Flush()
				}
				select {
				case <-request.Context().Done():
				case <-release:
				}
			}, 40*time.Millisecond)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				go func() { <-ready; cancel() }()
			}
			start := time.Now()
			_, err := r.CreateBundleGrant(ctx, bundleID, OtherGrantRequest{UserId: userID, GrantType: "gift"})
			close(release)
			kind := "timeout"
			if mode == "cancel" {
				kind = "cancelled"
			}
			if mode == "lost" {
				kind = "transport"
			}
			errorKind(t, err, kind)
			if time.Since(start) > time.Second || calls.Load() != 1 {
				t.Fatal("deadline or retry")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, _, _ := clients(t, func(_ http.ResponseWriter, _ *http.Request) { t.Error("cancelled request sent") }, 0)
	_, err := r.ListBundles(ctx, PageOptions{})
	errorKind(t, err, "cancelled")
	//lint:ignore SA1012 Verify nil-context rejection at the public SDK boundary.
	_, err = r.ListBundles(nil, PageOptions{})
	errorKind(t, err, "validation")
}
func TestRedirectsResponsesAndLocalConfiguration(t *testing.T) {
	var forwarded atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) { forwarded.Add(1) }))
	defer other.Close()
	r, sig, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
		http.Redirect(w, request, other.URL, http.StatusTemporaryRedirect)
	}, 0)
	_, err := r.ListBundles(context.Background(), PageOptions{})
	errorKind(t, err, "protocol")
	p, _ := BuildPauseSignal(1, SignalOptions{})
	errorKind(t, sig.Send(context.Background(), strategyKey, p), "protocol")
	if forwarded.Load() != 0 {
		t.Fatal("redirect followed")
	}
	for _, base := range []string{"relative", "http://example.invalid", "https://user:password@example.invalid", "https://example.invalid?key=secret", "https://example.invalid#fragment", "http://127.0.0.1:1234"} {
		if _, err := NewRestClient(accountKey, ClientOptions{BaseURL: base}); err == nil {
			t.Error("unsafe URL accepted")
		}
	}
	if _, err := NewRestClient(accountKey, ClientOptions{BaseURL: "https://example.invalid/api/rest", Timeout: -1}); err == nil {
		t.Error("negative timeout")
	}
	for _, body := range []string{`null`, `{}`, `{"bundles":null,"limit":1}`, `{"bundles":[],"limit":"one"}`, `not json`} {
		t.Run(body, func(t *testing.T) {
			r, _, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, body) }, 0)
			_, err := r.ListBundles(context.Background(), PageOptions{})
			errorKind(t, err, "protocol")
		})
	}
	r.Close()
	r.Close()
	_, err = r.ListBundles(context.Background(), PageOptions{})
	errorKind(t, err, "closed")
	sig.Close()
	errorKind(t, sig.Send(context.Background(), strategyKey, p), "closed")
}
func TestResponseEvolutionDatesAndNullable(t *testing.T) {
	date := time.Date(2026, 7, 19, 12, 0, 0, 123456000, time.FixedZone("offset", 7200))
	r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
		if request.Method == "POST" {
			v, _ := decodeValue(readBody(t, request))
			stamp := v.(map[string]any)["endsAt"].(string)
			parsed, err := time.Parse(time.RFC3339Nano, stamp)
			if err != nil || !parsed.Equal(date) {
				t.Error("date changed")
			}
			_, _ = io.WriteString(w, `{"grant":{"id":"`+grantID+`","grantType":"paid_external"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"users":[{"userId":"`+userID+`","displayName":"Пользователь \"日本語\"","avatar":null,"future":true},{"userId":"`+grantID+`","displayName":"Second"}],"query":"Al","limit":2,"future":42}`)
	}, 0)
	result, err := r.SearchUsers(context.Background(), "Al", PageOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Users[0].Avatar.IsSet() || result.Users[0].Avatar.Get() != nil || result.Users[1].Avatar.IsSet() {
		t.Fatal("nullable changed")
	}
	if result.Users[0].AdditionalProperties["future"] != true {
		t.Fatal("unknown field lost")
	}
	_, err = r.CreateBundleGrant(context.Background(), bundleID, PaidExternalGrantRequest{UserId: userID, GrantType: "paid_external", SourceId: "invoice:1", EndsAt: &date})
	if err != nil {
		t.Fatal(err)
	}
}
func TestResourceCleanupNoConstructionIOAndConcurrency(t *testing.T) {
	var calls atomic.Int32
	var closes atomic.Int32
	rt := roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: &trackingBody{Reader: strings.NewReader(`{"bundles":[],"limit":1}`), closed: &closes}}, nil
	})
	original := &http.Client{Transport: rt}
	r, err := NewRestClient(accountKey, ClientOptions{BaseURL: "https://example.invalid/api/rest", HTTPClient: original})
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || original.CheckRedirect != nil {
		t.Fatal("constructor side effect")
	}
	defer r.Close()
	var group sync.WaitGroup
	for i := 0; i < 12; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := r.ListBundles(context.Background(), PageOptions{}); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	if calls.Load() != 12 || closes.Load() != 12 {
		t.Fatal("cleanup")
	}
	c, err := NewRestClient(accountKey, ClientOptions{BaseURL: "https://example.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) { return nil, fmt.Errorf("private URL %s", accountKey) })}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.ListBundles(context.Background(), PageOptions{})
	errorKind(t, err, "transport")
	if strings.Contains(fmt.Sprintf("%+v", err), accountKey) || errors.Unwrap(err) != nil {
		t.Fatal("raw cause retained")
	}
	c.Close()
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type trackingBody struct {
	io.Reader
	closed *atomic.Int32
}

func (b *trackingBody) Close() error { b.closed.Add(1); return nil }
func TestUTF8BoundsAndValidation(t *testing.T) {
	opts := SignalOptions{Timestamp: Ptr("1780000000000")}
	_, err := BuildPauseSignal(1, SignalOptions{Timestamp: Ptr(strings.Repeat("0", 16*1024))})
	errorKind(t, err, "validation")
	_, err = BuildPauseSignal(1, SignalOptions{Hashtag: Ptr("日本語")})
	errorKind(t, err, "validation")
	_, err = BuildOpenSignal(1, 100, OpenSignalPayloadOrder{Side: "buy", Price: Ptr(math.Inf(1))}, OpenSignalOptions{SignalOptions: opts})
	errorKind(t, err, "validation")
	r, _, _ := clients(t, func(_ http.ResponseWriter, _ *http.Request) { t.Error("invalid request sent") }, 0)
	_, err = r.SearchUsers(context.Background(), "a", PageOptions{})
	errorKind(t, err, "validation")
	_, err = r.ListBundles(context.Background(), PageOptions{Limit: Ptr(int32(101))})
	errorKind(t, err, "validation")
	_, err = r.GetCheckout(context.Background(), "bad/path")
	errorKind(t, err, "validation")
}

func normalizeDates(v any) any {
	switch x := v.(type) {
	case string:
		if date, err := time.Parse(time.RFC3339Nano, x); err == nil {
			return date.UTC().Format(time.RFC3339Nano)
		}
	case map[string]any:
		for key, item := range x {
			x[key] = normalizeDates(item)
		}
	case []any:
		for i, item := range x {
			x[i] = normalizeDates(item)
		}
	}
	return v
}

func TestAmbiguousUnionsAndUnexpectedSuccess(t *testing.T) {
	opts := SignalOptions{Timestamp: Ptr("1780000000000")}
	pause, _ := BuildPauseSignal(1, opts)
	start, _ := BuildStartSignal(1, opts)
	_, err := SerializeSignal(SignalPayload{PauseSignalPayload: pause, StartSignalPayload: start})
	errorKind(t, err, "validation")
	r, sig, _ := clients(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(202) }, 0)
	_, err = r.CreateBundleGrant(context.Background(), bundleID, CreateGrantRequest{OtherGrantRequest: &OtherGrantRequest{GrantType: "gift", UserId: userID}, PaidExternalGrantRequest: &PaidExternalGrantRequest{GrantType: "paid_external", UserId: userID, SourceId: "invoice:1"}})
	errorKind(t, err, "validation")
	_, err = r.ListBundles(context.Background(), PageOptions{})
	errorKind(t, err, "protocol")
	errorKind(t, sig.Send(context.Background(), strategyKey, pause), "protocol")
}
func TestBodyClosureOnFailureAndSizeLimit(t *testing.T) {
	for _, mode := range []string{"http", "oversize", "protocol"} {
		t.Run(mode, func(t *testing.T) {
			var closes atomic.Int32
			body := `{}`
			status := 200
			kind := "protocol"
			if mode == "http" {
				status = 500
				kind = "http"
			}
			if mode == "oversize" {
				body = strings.Repeat("x", 1024*1024+1)
			}
			c, err := NewRestClient(accountKey, ClientOptions{BaseURL: "https://example.invalid", HTTPClient: &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Header: make(http.Header), Body: &trackingBody{Reader: strings.NewReader(body), closed: &closes}}, nil
			})}})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Close()
			_, err = c.ListBundles(context.Background(), PageOptions{})
			errorKind(t, err, kind)
			if closes.Load() != 1 {
				t.Fatal("body not closed")
			}
		})
	}
}
func TestUnicodeQueryAndCanonicalJSONEscaping(t *testing.T) {
	name := `日本語 "Al"`
	r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Query().Get("displayName") != name {
			t.Error("Unicode/escaping query changed")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"users": []any{}, "limit": 1, "query": name})
	}, 0)
	response, err := r.SearchUsers(context.Background(), name, PageOptions{})
	if err != nil || response.Query != name {
		t.Fatal("Unicode response", err)
	}
}

func TestTLSProtocolAndPublicErrorIdentifiers(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.ProtoMajor != 1 {
			t.Error("implicit HTTP/2 retry path enabled")
		}
		w.WriteHeader(403)
		_, _ = io.WriteString(w, `{"errorCode":"E501","message":"query Al failed","requestId":"req123"}`)
	}))
	server.EnableHTTP2 = true
	server.StartTLS()
	defer server.Close()
	client, err := NewRestClient(accountKey, ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.SearchUsers(context.Background(), "Al", PageOptions{Limit: Ptr(int32(1))})
	e := errorKind(t, err, "http")
	if e.Code != "E501" || e.RequestID != "req123" || strings.Contains(e.Message, "Al") {
		t.Fatal("private query or public identifier changed")
	}
	if calls.Load() != 1 {
		t.Fatal("HTTPS retry")
	}
}
func TestCustomizedProcessDefaultTransport(t *testing.T) {
	original := http.DefaultTransport
	defer func() { http.DefaultTransport = original }()
	var calls atomic.Int32
	http.DefaultTransport = roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"bundles":[],"limit":1}`))}, nil
	})
	client, err := NewRestClient(accountKey, ClientOptions{BaseURL: "https://example.invalid"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if calls.Load() != 0 {
		t.Fatal("constructor request")
	}
	_, err = client.ListBundles(context.Background(), PageOptions{})
	if err != nil || calls.Load() != 1 {
		t.Fatal("custom process default", err)
	}
}

func TestSharedInputValidation(t *testing.T) {
	data, err := os.ReadFile("../conformance/rest/input-validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		ID         string            `json:"id"`
		Operation  string            `json:"operationId"`
		Parameters map[string]string `json:"parameters"`
		Body       any               `json:"body"`
		Accepted   bool              `json:"accepted"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, f := range cases {
		t.Run(f.ID, func(t *testing.T) {
			var response json.RawMessage
			for _, existing := range restFixtures(t) {
				if existing.Operation == f.Operation && existing.Status == 200 {
					response = existing.Response
					break
				}
			}
			var calls atomic.Int32
			r, _, _ := clients(t, func(w http.ResponseWriter, request *http.Request) {
				calls.Add(1)
				if request.URL.Path == "/api/rest/v1/bundles" {
					_, _ = w.Write([]byte(`{"bundles":[],"limit":50}`))
					return
				}
				want := url.Values{}
				for k, v := range f.Parameters {
					if k != "bundleId" {
						want.Set(k, v)
					}
				}
				if !reflect.DeepEqual(request.URL.Query(), want) {
					t.Error("input query changed")
				}
				if f.Body != nil {
					if string(readBody(t, request)) != string(mustJSON(t, f.Body)) {
						t.Error("input body changed")
					}
				}
				_, _ = w.Write(response)
			}, 0)
			var err error
			switch f.Operation {
			case "searchUsers":
				_, err = r.SearchUsers(context.Background(), f.Parameters["displayName"], PageOptions{})
			case "createBundleGrant":
				_, err = r.CreateBundleGrant(context.Background(), f.Parameters["bundleId"], f.Body)
			case "listBundleGrants":
				// Public filters use time.Time; exercise their shared raw-string validation path before normalization.
				values := map[string]any{}
				for k, v := range f.Parameters {
					values[k] = v
				}
				var out BundleGrantsResponse
				err = r.call(context.Background(), f.Operation, values, nil, &out)
			default:
				t.Fatal("unknown input operation")
			}
			if f.Accepted {
				if err != nil {
					t.Fatal(err)
				}
				if calls.Load() != 1 {
					t.Fatal("expected one request")
				}
			} else {
				errorKind(t, err, "validation")
				if calls.Load() != 0 {
					t.Fatal("invalid input reached HTTP")
				}
			}
			if _, err := r.ListBundles(context.Background(), PageOptions{}); err != nil {
				t.Fatal(err)
			}
			wantCalls := int32(1)
			if f.Accepted {
				wantCalls++
			}
			if calls.Load() != wantCalls {
				t.Fatal("independent request did not recover")
			}
		})
	}
}

func TestProductionDefaults(t *testing.T) {
	var requests []string
	opts := ClientOptions{HTTPClient: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		requests = append(requests, r.URL.Scheme+"://"+r.URL.Host+r.URL.Path)
		status := 200
		body := `{"bundles":[],"limit":50}`
		if strings.HasPrefix(r.URL.Path, "/webhooks/") {
			status = 204
			body = ""
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}}
	rest, err := NewRestClient(accountKey, opts)
	if err != nil {
		t.Fatal(err)
	}
	defer rest.Close()
	signals, err := NewSignalsClient(opts)
	if err != nil {
		t.Fatal(err)
	}
	defer signals.Close()
	if len(requests) != 0 {
		t.Fatal("Construction sent HTTP")
	}
	if _, err := rest.ListBundles(context.Background(), PageOptions{}); err != nil {
		t.Fatal(err)
	}
	payload, err := BuildStartSignal(1, SignalOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := signals.Send(context.Background(), strategyKey, payload); err != nil {
		t.Fatal(err)
	}
	expected := []string{"https://www.vector-trading.app/api/rest/v1/bundles", "https://www.vector-trading.app/webhooks/signals/v1/" + strategyKey}
	if !reflect.DeepEqual(requests, expected) {
		t.Fatalf("Unexpected endpoints: %v", requests)
	}
}
