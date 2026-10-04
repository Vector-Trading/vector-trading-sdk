package vectortrading

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// SignalOptions supplies metadata; a nil Timestamp fixes the current millisecond.
type SignalOptions struct {
	Timestamp *string
	Hashtag   *string
}

// OpenSignalOptions includes the open-only force option.
type OpenSignalOptions struct {
	SignalOptions
	Force *bool
}

// ExitSignalOptions configures cancel/close without an order.
type ExitSignalOptions struct {
	SignalOptions
	MarketPrice *float64
}

// SerializeSignal validates a prepared message without refreshing its timestamp.
func SerializeSignal(payload any) ([]byte, error) {
	if err := validUnion(payload); err != nil {
		return nil, err
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, sdkError("validation", "Signal is not valid finite JSON")
	}
	if err = validModel("SignalPayload", data); err != nil {
		return nil, err
	}
	v, _ := decodeValue(data)
	o := v.(map[string]any)
	stamp := strings.TrimLeft(o["timestamp"].(string), "0")
	if stamp == "" {
		stamp = "0"
	}
	n, err := strconv.ParseUint(stamp, 10, 64)
	if err != nil || n > 9007199254740991 {
		return nil, sdkError("validation", "Timestamp must represent a safe integer")
	}
	if o["action"] == "open" || o["action"] == "update" {
		order := o["order"].(map[string]any)
		buy := order["side"] == "buy"
		market := o["marketPrice"].(float64)
		base := market
		price, hasPrice := order["price"].(float64)
		trigger, hasTrigger := order["triggerPrice"].(float64)
		if hasTrigger {
			base = trigger
		}
		if hasPrice {
			base = price
		}
		valid := true
		if hasPrice {
			limit := market
			if hasTrigger {
				limit = trigger
			}
			valid = valid && (buy && price <= limit || !buy && price >= limit)
		}
		if hasTrigger {
			valid = valid && (buy && trigger >= market || !buy && trigger <= market)
		}
		if stop, ok := order["stop"].(float64); ok {
			valid = valid && (buy && stop < base || !buy && stop > base)
		}
		sum := 0.0
		if targets, ok := order["takeProfits"].([]any); ok {
			for _, target := range targets {
				x := target.(map[string]any)
				p := x["price"].(float64)
				sum += x["percent"].(float64)
				valid = valid && (buy && p > base || !buy && p < base)
			}
		}
		if !valid || sum > 100+1e-8 {
			return nil, sdkError("validation", "Invalid price or protection relationships")
		}
	}
	if len(data) > 16*1024 {
		return nil, sdkError("validation", "Signal body exceeds 16 KiB")
	}
	return data, nil
}

// BuildSignal clones an outgoing object and fills only an absent timestamp.
func BuildSignal(payload map[string]any) (*SignalPayload, error) {
	if payload == nil {
		return nil, sdkError("validation", "Signal must be an object")
	}
	v := make(map[string]any, len(payload)+1)
	for k, x := range payload {
		v[k] = x
	}
	if _, ok := v["timestamp"]; !ok {
		v["timestamp"] = strconv.FormatInt(time.Now().UnixMilli(), 10)
	}
	data, err := SerializeSignal(v)
	if err != nil {
		return nil, err
	}
	var result SignalPayload
	if err = json.Unmarshal(data, &result); err != nil {
		return nil, sdkError("validation", "Cannot decode signal model")
	}
	return &result, nil
}
func signalFields(action string, version float64, opts SignalOptions) map[string]any {
	v := map[string]any{"action": action, "version": version}
	if opts.Timestamp != nil {
		v["timestamp"] = *opts.Timestamp
	}
	if opts.Hashtag != nil {
		v["hashtag"] = *opts.Hashtag
	}
	return v
}

// BuildOpenSignal fixes metadata and validates an open order. Nil TP omits it;
// a non-nil empty slice is explicitly serialized as [].
func BuildOpenSignal(version, marketPrice float64, order OpenSignalPayloadOrder, opts OpenSignalOptions) (*OpenSignalPayload, error) {
	v := signalFields("open", version, opts.SignalOptions)
	v["marketPrice"] = marketPrice
	v["order"] = order
	if opts.Force != nil {
		v["force"] = *opts.Force
	}
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.OpenSignalPayload, nil
}

// BuildUpdateSignal preserves omitted targets and explicit target clearing.
func BuildUpdateSignal(version, marketPrice float64, order UpdateSignalPayloadOrder, opts SignalOptions) (*UpdateSignalPayload, error) {
	v := signalFields("update", version, opts)
	v["marketPrice"] = marketPrice
	v["order"] = order
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.UpdateSignalPayload, nil
}

// BuildCancelSignal fixes metadata for the cancel action.
func BuildCancelSignal(version float64, opts ExitSignalOptions) (*CancelSignalPayload, error) {
	v := signalFields("cancel", version, opts.SignalOptions)
	if opts.MarketPrice != nil {
		v["marketPrice"] = *opts.MarketPrice
	}
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.CancelSignalPayload, nil
}

// BuildCloseSignal fixes metadata for the close action.
func BuildCloseSignal(version float64, opts ExitSignalOptions) (*CloseSignalPayload, error) {
	v := signalFields("close", version, opts.SignalOptions)
	if opts.MarketPrice != nil {
		v["marketPrice"] = *opts.MarketPrice
	}
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.CloseSignalPayload, nil
}

// BuildStartSignal fixes metadata for the start action.
func BuildStartSignal(version float64, opts SignalOptions) (*StartSignalPayload, error) {
	v := signalFields("start", version, opts)
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.StartSignalPayload, nil
}

// BuildPauseSignal fixes metadata for the pause action.
func BuildPauseSignal(version float64, opts SignalOptions) (*PauseSignalPayload, error) {
	v := signalFields("pause", version, opts)
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.PauseSignalPayload, nil
}

// BuildStopSignal fixes metadata for the stop action.
func BuildStopSignal(version float64, opts SignalOptions) (*StopSignalPayload, error) {
	v := signalFields("stop", version, opts)
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.StopSignalPayload, nil
}

// BuildDeleteSignal fixes metadata for the delete action.
func BuildDeleteSignal(version float64, opts SignalOptions) (*DeleteSignalPayload, error) {
	v := signalFields("delete", version, opts)
	s, err := BuildSignal(v)
	if err != nil {
		return nil, err
	}
	return s.DeleteSignalPayload, nil
}
