package generated

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestTransportContract(t *testing.T) {
	data, err := os.ReadFile(os.Getenv("SDK_PROBE_ROOT") + "/conformance/signals/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		ID      string          `json:"id"`
		Payload json.RawMessage `json:"payload"`
		Schema  bool            `json:"schemaAccepted"`
		Parser  bool            `json:"parserAccepted"`
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, f := range fixtures {
		if !f.Schema || !f.Parser {
			continue
		}
		var model SignalPayload
		if err = json.Unmarshal(f.Payload, &model); err != nil {
			t.Fatalf("%s: %v", f.ID, err)
		}
		encoded, err := json.Marshal(model)
		if err != nil {
			t.Fatal(err)
		}
		var a, b interface{}
		json.Unmarshal(f.Payload, &a)
		json.Unmarshal(encoded, &b)
		aa, _ := json.Marshal(a)
		bb, _ := json.Marshal(b)
		if string(aa) != string(bb) {
			t.Fatalf("%s: %s vs %s", f.ID, aa, bb)
		}
		count++
	}
	for _, kind := range []string{"owner_grant", "referral_reward", "gift", "paid_external"} {
		payload := map[string]interface{}{"userId": strings.Repeat("a", 32), "grantType": kind, "endsAt": "2026-07-19T12:00:00.000Z"}
		if kind == "paid_external" {
			payload["sourceId"] = "invoice:1"
		}
		data, _ := json.Marshal(payload)
		var m CreateGrantRequest
		if err = json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		data, err = json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		var result map[string]interface{}
		json.Unmarshal(data, &result)
		parsed, err := time.Parse(time.RFC3339, result["endsAt"].(string))
		if err != nil || !parsed.Equal(time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)) {
			t.Fatal("date mismatch")
		}
		if result["userId"] != payload["userId"] || result["grantType"] != kind {
			t.Fatal("grant mismatch")
		}
	}
	var bad SignalPayload
	if json.Unmarshal([]byte(`{"action":"update","version":1.5,"timestamp":"1720000000000","marketPrice":100,"order":{"side":"buy","takeProfits":null}}`), &bad) == nil {
		t.Fatal("null accepted")
	}
	var grant CreateGrantRequest
	if json.Unmarshal([]byte(`{"userId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","grantType":"paid_external"}`), &grant) == nil {
		t.Fatal("sourceId omission accepted")
	}
	model := NewPauseSignalPayload("pause", "1720000000000", math.Inf(1))
	if _, err = json.Marshal(model); err == nil {
		t.Fatal("non-finite accepted")
	}
	config := NewConfiguration()
	config.Servers = ServerConfigurations{{URL: "http://127.0.0.1:9999/api/rest"}}
	calls := 0
	config.HTTPClient = &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "http://127.0.0.1:9999/api/rest/v1/bundles?limit=17" || r.Header.Get("Authorization") != "Bearer synthetic-token" {
			t.Fatal("request mismatch")
		}
		calls++
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"bundles":[],"limit":17,"futureField":true}`))}, nil
	})}
	_, _, err = NewAPIClient(config).DefaultAPI.ListBundles(context.WithValue(context.Background(), ContextAccessToken, "synthetic-token")).Limit(17).Execute()
	if err != nil || calls != 1 {
		t.Fatalf("request failed: %v", err)
	}
	t.Logf("%d signal fixtures, four grant variants, dates, null/non-finite rejection and Bearer request passed", count)
}
