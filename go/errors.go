package vectortrading

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Error contains bounded diagnostics; it never retains requests or raw causes.
type Error struct {
	Kind      string
	Message   string
	Status    int
	Code      string
	RequestID string
}

func (e *Error) Error() string             { return e.Kind + ": " + e.Message }
func sdkError(kind, message string) *Error { return &Error{Kind: kind, Message: message} }

var urlPattern = regexp.MustCompile(`(?i)https?://[^\s"'<>]+`)
var keyPattern = regexp.MustCompile(`\b(?:vt_[A-Za-z0-9_]+|[a-f0-9]{32})\b`)

func safeText(s string, secrets []string) string {
	for _, secret := range secrets {
		if secret != "" {
			s = strings.ReplaceAll(s, secret, "[redacted]")
		}
	}
	s = urlPattern.ReplaceAllString(s, "[redacted URL]")
	s = keyPattern.ReplaceAllString(s, "[redacted]")
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, s)
	if utf8.RuneCountInString(s) > 512 {
		s = string([]rune(s)[:512])
	}
	return s
}
func privateValues(v any) []string {
	var values []string
	switch x := v.(type) {
	case string:
		if x != "" {
			values = append(values, x)
		}
	case map[string]any:
		for _, item := range x {
			values = append(values, privateValues(item)...)
		}
	case []any:
		for _, item := range x {
			values = append(values, privateValues(item)...)
		}
	}
	return values
}
func responseError(status int, body []byte, secrets, messageSecrets []string) *Error {
	e := &Error{Kind: "http", Status: status, Message: "HTTP request failed"}
	var value map[string]any
	if json.Unmarshal(body, &value) == nil {
		if message, ok := value["message"].(string); ok {
			e.Message = safeText(message, messageSecrets)
		} else if message, ok := value["error"].(string); ok {
			e.Message = safeText(message, messageSecrets)
		}
		if code, ok := value["errorCode"].(string); ok {
			e.Code = safeText(code, secrets)
		}
		if id, ok := value["requestId"].(string); ok {
			e.RequestID = safeText(id, secrets)
		}
	}
	return e
}
