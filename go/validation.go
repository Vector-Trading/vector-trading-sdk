package vectortrading

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Vector-Trading/vector-trading-sdk/go/internal/generated"
)

type schema struct {
	Ref              string            `json:"$ref"`
	Type             string            `json:"type"`
	Properties       map[string]schema `json:"properties"`
	Required         []string          `json:"required"`
	Enum             []any             `json:"enum"`
	OneOf            []schema          `json:"oneOf"`
	Nullable         bool              `json:"nullable"`
	Additional       any               `json:"additionalProperties"`
	Items            *schema           `json:"items"`
	MinLength        *int              `json:"minLength"`
	MaxLength        *int              `json:"maxLength"`
	MaxItems         *int              `json:"maxItems"`
	Pattern          string            `json:"pattern"`
	Format           string            `json:"format"`
	Minimum          *float64          `json:"minimum"`
	Maximum          *float64          `json:"maximum"`
	ExclusiveMinimum bool              `json:"exclusiveMinimum"`
	ExclusiveMaximum bool              `json:"exclusiveMaximum"`
}
type parameter struct {
	Name     string `json:"name"`
	In       string `json:"in"`
	Required bool   `json:"required"`
	Schema   schema `json:"schema"`
}
type operation struct {
	ID         string      `json:"operationId"`
	Parameters []parameter `json:"parameters"`
	Responses  map[string]struct {
		Content map[string]struct {
			Schema schema `json:"schema"`
		} `json:"content"`
	} `json:"responses"`
}
type contractData struct {
	Schemas map[string]schema               `json:"schemas"`
	Paths   map[string]map[string]operation `json:"paths"`
}

var contract = func() contractData {
	var c contractData
	if err := json.Unmarshal(generated.Contract, &c); err != nil {
		panic("invalid generated SDK metadata")
	}
	return c
}()

func operationFor(name string) (string, string, operation) {
	for path, methods := range contract.Paths {
		for method, op := range methods {
			if op.ID == name {
				return strings.ToUpper(method), path, op
			}
		}
	}
	panic("missing generated SDK operation")
}
func decodeValue(data []byte) (any, error) {
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}
	return v, nil
}
func validate(s schema, v any) error {
	bad := func() error { return fmt.Errorf("value does not match public contract") }
	if s.Ref != "" {
		return validate(contract.Schemas[s.Ref[strings.LastIndex(s.Ref, "/")+1:]], v)
	}
	if v == nil {
		if s.Nullable {
			return nil
		}
		return bad()
	}
	if len(s.Enum) > 0 {
		found := false
		for _, e := range s.Enum {
			if e == v {
				found = true
			}
		}
		if !found {
			return bad()
		}
	}
	if len(s.OneOf) > 0 {
		matches := 0
		for _, b := range s.OneOf {
			if validate(b, v) == nil {
				matches++
			}
		}
		if matches != 1 {
			return bad()
		}
	}
	switch s.Type {
	case "object":
		o, ok := v.(map[string]any)
		if !ok {
			return bad()
		}
		for _, key := range s.Required {
			if _, ok := o[key]; !ok {
				return bad()
			}
		}
		for key, x := range o {
			if p, ok := s.Properties[key]; ok {
				if validate(p, x) != nil {
					return bad()
				}
			} else if b, ok := s.Additional.(bool); ok && !b {
				return bad()
			}
		}
	case "array":
		a, ok := v.([]any)
		if !ok {
			return bad()
		}
		if s.MaxItems != nil && len(a) > *s.MaxItems {
			return bad()
		}
		for _, x := range a {
			if s.Items != nil && validate(*s.Items, x) != nil {
				return bad()
			}
		}
	case "string":
		x, ok := v.(string)
		if !ok {
			return bad()
		}
		n := utf8.RuneCountInString(x)
		if s.MinLength != nil && n < *s.MinLength || s.MaxLength != nil && n > *s.MaxLength {
			return bad()
		}
		if s.Pattern != "" {
			matched, err := regexp.MatchString(s.Pattern, x)
			if err != nil || !matched {
				return bad()
			}
		}
		if s.Format == "date-time" {
			if _, err := time.Parse(time.RFC3339Nano, x); err != nil {
				return bad()
			}
		}
	case "number", "integer":
		x, ok := v.(float64)
		if !ok || math.IsNaN(x) || math.IsInf(x, 0) {
			return bad()
		}
		if s.Type == "integer" && math.Trunc(x) != x {
			return bad()
		}
		if s.Minimum != nil && (x < *s.Minimum || s.ExclusiveMinimum && x == *s.Minimum) {
			return bad()
		}
		if s.Maximum != nil && (x > *s.Maximum || s.ExclusiveMaximum && x == *s.Maximum) {
			return bad()
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return bad()
		}
	}
	return nil
}
func validModel(name string, data []byte) error {
	v, err := decodeValue(data)
	if err != nil || validate(contract.Schemas[name], v) != nil {
		return sdkError("validation", "Input does not match the public contract")
	}
	return nil
}
func validateResponse(name string, data []byte) error {
	_, _, op := operationFor(name)
	v, err := decodeValue(data)
	if err != nil || validate(op.Responses["200"].Content["application/json"].Schema, v) != nil {
		return sdkError("protocol", "Server response does not match the public contract")
	}
	return nil
}

// A generated union serializer selects its first non-nil branch; reject ambiguous
// caller values before serialization can silently discard another branch.
func validUnion(value any) error {
	switch value.(type) {
	case SignalPayload, *SignalPayload, CreateGrantRequest, *CreateGrantRequest:
		v := reflect.ValueOf(value)
		if v.Kind() == reflect.Pointer {
			if v.IsNil() {
				return sdkError("validation", "A union requires exactly one variant")
			}
			v = v.Elem()
		}
		count := 0
		for i := 0; i < v.NumField(); i++ {
			if !v.Field(i).IsNil() {
				count++
			}
		}
		if count != 1 {
			return sdkError("validation", "A union requires exactly one variant")
		}
	}
	return nil
}
