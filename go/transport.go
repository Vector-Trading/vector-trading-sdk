package vectortrading

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ClientOptions configures explicit transport, total deadlines and local testing.
// Custom RoundTrippers must not retry or log private request data.
type ClientOptions struct {
	// BaseURL overrides the production REST base or signal origin. Empty uses production.
	BaseURL               string
	HTTPClient            *http.Client
	Timeout               time.Duration
	AllowHTTPForLocalhost bool
}
type transport struct {
	client     *http.Client
	base       *url.URL
	accountKey string
	timeout    time.Duration
	mu         sync.RWMutex
	closed     bool
}

func newTransport(base string, accountKey *string, opts ClientOptions) (*transport, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return nil, sdkError("validation", "Invalid base URL")
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	local := host == "localhost" || ip != nil && ip.IsLoopback()
	if u.Scheme != "https" && !(u.Scheme == "http" && opts.AllowHTTPForLocalhost && local) {
		return nil, sdkError("validation", "HTTPS is required outside explicitly enabled localhost tests")
	}
	key := ""
	if accountKey != nil {
		key = *accountKey
		if key == "" || strings.ContainsAny(key, "\r\n\t ") {
			return nil, sdkError("validation", "Invalid credential")
		}
	}
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	if timeout < 0 {
		return nil, sdkError("validation", "Timeout must be positive")
	}
	client := http.Client{}
	if opts.HTTPClient != nil {
		client = *opts.HTTPClient
	}
	if client.Transport == nil {
		client.Transport = http.DefaultTransport
	}
	if native, ok := client.Transport.(*http.Transport); ok {
		native = native.Clone()
		native.DisableKeepAlives = true
		native.Protocols = new(http.Protocols)
		native.Protocols.SetHTTP1(true)
		native.ForceAttemptHTTP2 = false
		native.TLSNextProto = nil
		if native.TLSClientConfig != nil {
			native.TLSClientConfig.NextProtos = []string{"http/1.1"}
		}
		client.Transport = native
	}
	// Fresh HTTP/1 connections disable stale-connection and HTTP/2 stream retries.
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	return &transport{client: &client, base: u, accountKey: key, timeout: timeout}, nil
}
func (t *transport) close() {
	t.mu.Lock()
	t.closed = true
	t.mu.Unlock()
	t.client.CloseIdleConnections()
}
func transportFailure(ctx context.Context, err error) *Error {
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return sdkError("timeout", "Request timed out; mutation outcome may be unknown")
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		return sdkError("timeout", "Request timed out; mutation outcome may be unknown")
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return sdkError("cancelled", "Request cancelled; mutation outcome may be unknown")
	}
	return sdkError("transport", "HTTP transport failed; mutation outcome may be unknown")
}
func (t *transport) request(ctx context.Context, method, path string, query url.Values, body []byte, strategyKey string) ([]byte, error) {
	if ctx == nil {
		return nil, sdkError("validation", "A context is required")
	}
	t.mu.RLock()
	closed := t.closed
	t.mu.RUnlock()
	if closed {
		return nil, sdkError("closed", "Client is closed")
	}
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	if ctx.Err() != nil {
		return nil, transportFailure(ctx, ctx.Err())
	}
	u := *t.base
	u.Path += path
	u.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, sdkError("validation", "Invalid HTTP request")
	}
	req.GetBody = nil
	req.Close = true
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	signal := strategyKey != ""
	key := strategyKey
	if !signal {
		key = t.accountKey
		req.Header.Set("Authorization", "Bearer "+t.accountKey)
	}
	response, err := t.client.Do(req)
	if err != nil {
		return nil, transportFailure(ctx, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil {
		return nil, transportFailure(ctx, err)
	}
	if len(data) > 1024*1024 {
		return nil, sdkError("protocol", "Response exceeds 1 MiB")
	}
	secrets := []string{key, u.String()}
	if v, err := diagnosticValue(body); err == nil {
		secrets = append(secrets, privateValues(v)...)
	}
	for _, values := range query {
		secrets = append(secrets, values...)
	}
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return nil, sdkError("protocol", "Redirects are disabled")
	}
	expected := 200
	if signal {
		expected = 204
	}
	if response.StatusCode != expected {
		if response.StatusCode >= 200 && response.StatusCode < 300 {
			return nil, sdkError("protocol", "Unexpected success status")
		}
		return nil, responseError(response.StatusCode, data, []string{key, u.String()}, secrets, response.Header.Get("x-request-id"))
	}
	return data, nil
}
