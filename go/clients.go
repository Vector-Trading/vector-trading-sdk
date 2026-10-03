package vectortrading

import (
	"context"
	"encoding/json"
	"iter"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// RestClient sends account-key requests. Close releases idle resources.
type RestClient struct{ transport *transport }

// NewRestClient performs no network work and requires an absolute /api/rest base.
func NewRestClient(baseURL, accountKey string, options ClientOptions) (*RestClient, error) {
	t, err := newTransport(baseURL, accountKey, options)
	if err != nil {
		return nil, err
	}
	return &RestClient{transport: t}, nil
}
func (c *RestClient) Close() { c.transport.close() }

// SignalsClient sends strategy-key signals separately from the REST account key.
type SignalsClient struct{ transport *transport }

// NewSignalsClient uses a server origin or explicit path prefix, not /api/rest.
func NewSignalsClient(baseURL, strategyKey string, options ClientOptions) (*SignalsClient, error) {
	if ok, _ := regexp.MatchString(`^[a-f0-9]{32}$`, strategyKey); !ok {
		return nil, sdkError("validation", "Invalid strategy credential")
	}
	t, err := newTransport(baseURL, strategyKey, options)
	if err != nil {
		return nil, err
	}
	return &SignalsClient{transport: t}, nil
}
func (c *SignalsClient) Close() { c.transport.close() }

// Send returns nil only for 204 enqueue acceptance. It never refreshes metadata.
func (c *SignalsClient) Send(ctx context.Context, payload any) error {
	data, err := SerializeSignal(payload)
	if err != nil {
		return err
	}
	_, err = c.transport.request(ctx, "POST", "/webhooks/signals/v1/"+c.transport.key, nil, data, true)
	return err
}

// PageOptions supplies optional limit and an opaque continuation cursor.
type PageOptions struct {
	Limit  *int32
	Cursor *string
}

// GrantsOptions preserves all public access filters and sorting.
type GrantsOptions struct {
	PageOptions
	UserID        *string
	GrantType     *TradingBundleAccessGrantType
	SourceID      *string
	StartsAfter   *time.Time
	StartsBefore  *time.Time
	EndsAfter     *time.Time
	EndsBefore    *time.Time
	CreatedAfter  *time.Time
	CreatedBefore *time.Time
	Sort          *string
	Dir           *string
}

func pageValues(o PageOptions) map[string]any {
	v := map[string]any{}
	if o.Limit != nil {
		v["limit"] = float64(*o.Limit)
	}
	if o.Cursor != nil {
		v["cursor"] = *o.Cursor
	}
	return v
}
func grantValues(o GrantsOptions) map[string]any {
	v := pageValues(o.PageOptions)
	for name, p := range map[string]*string{"userId": o.UserID, "sourceId": o.SourceID, "sort": o.Sort, "dir": o.Dir} {
		if p != nil {
			v[name] = *p
		}
	}
	if o.GrantType != nil {
		v["grantType"] = string(*o.GrantType)
	}
	for name, p := range map[string]*time.Time{"startsAfter": o.StartsAfter, "startsBefore": o.StartsBefore, "endsAfter": o.EndsAfter, "endsBefore": o.EndsBefore, "createdAfter": o.CreatedAfter, "createdBefore": o.CreatedBefore} {
		if p != nil {
			v[name] = p.Format(time.RFC3339Nano)
		}
	}
	return v
}
func (c *RestClient) call(ctx context.Context, name string, values map[string]any, body any, out any) error {
	method, path, op := operationFor(name)
	query := url.Values{}
	for _, p := range op.Parameters {
		value, ok := values[p.Name]
		if !ok {
			if p.Required {
				return sdkError("validation", "Required request parameter is missing")
			}
			continue
		}
		s := p.Schema
		if p.Name == "cursor" {
			s.Pattern = ""
			s.MinLength = Ptr(1)
		}
		if validate(s, value) != nil {
			return sdkError("validation", "Request parameter does not match public contract")
		}
		switch p.In {
		case "path":
			path = strings.ReplaceAll(path, "{"+p.Name+"}", url.PathEscape(value.(string)))
		case "query":
			if number, ok := value.(float64); ok {
				query.Set(p.Name, strconv.FormatFloat(number, 'f', -1, 64))
			} else {
				query.Set(p.Name, value.(string))
			}
		}
	}
	var data []byte
	if body != nil {
		if err := validUnion(body); err != nil {
			return err
		}
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			return sdkError("validation", "Request body is not valid finite JSON")
		}
		if len(data) > 16*1024 {
			return sdkError("validation", "Request body exceeds 16 KiB")
		}
		if err = validModel("CreateGrantRequest", data); err != nil {
			return err
		}
	}
	response, err := c.transport.request(ctx, method, path, query, data, false)
	if err != nil {
		return err
	}
	if err = validateResponse(name, response); err != nil {
		return err
	}
	if json.Unmarshal(response, out) != nil {
		return sdkError("protocol", "Cannot decode response model")
	}
	return nil
}

// ListBundles returns one page of owned bundle summaries.
func (c *RestClient) ListBundles(ctx context.Context, o PageOptions) (*BundlesResponse, error) {
	var result BundlesResponse
	err := c.call(ctx, "listBundles", pageValues(o), nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// SearchUsers returns users matching a display name.
func (c *RestClient) SearchUsers(ctx context.Context, displayName string, o PageOptions) (*UsersSearchResponse, error) {
	v := pageValues(o)
	v["displayName"] = displayName
	var result UsersSearchResponse
	err := c.call(ctx, "searchUsers", v, nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// GetCheckout returns current checkout details.
func (c *RestClient) GetCheckout(ctx context.Context, checkoutID string) (*CheckoutDetails, error) {
	var result CheckoutDetails
	err := c.call(ctx, "getCheckout", map[string]any{"checkoutId": checkoutID}, nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// ListBundleUsers returns one page of granted bundle users.
func (c *RestClient) ListBundleUsers(ctx context.Context, bundleID string, o PageOptions) (*BundleUsersResponse, error) {
	v := pageValues(o)
	v["bundleId"] = bundleID
	var result BundleUsersResponse
	err := c.call(ctx, "listBundleUsers", v, nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// ListBundleGrants returns one page with the supplied filters.
func (c *RestClient) ListBundleGrants(ctx context.Context, bundleID string, o GrantsOptions) (*BundleGrantsResponse, error) {
	v := grantValues(o)
	v["bundleId"] = bundleID
	var result BundleGrantsResponse
	err := c.call(ctx, "listBundleGrants", v, nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// CreateBundleGrant sends one access mutation. The request can be a typed variant
// or a JSON-shaped object; paid_external requires sourceId and null endsAt fails.
func (c *RestClient) CreateBundleGrant(ctx context.Context, bundleID string, request any) (*GrantMutationResponse, error) {
	if request == nil {
		return nil, sdkError("validation", "Grant request is required")
	}
	var result GrantMutationResponse
	err := c.call(ctx, "createBundleGrant", map[string]any{"bundleId": bundleID}, request, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// RevokeBundleGrant sends one revocation; server-side cascading effects apply.
func (c *RestClient) RevokeBundleGrant(ctx context.Context, bundleID, grantID string) (*GrantMutationResponse, error) {
	var result GrantMutationResponse
	err := c.call(ctx, "revokeBundleGrant", map[string]any{"bundleId": bundleID, "grantId": grantID}, nil, &result)
	if err != nil {
		return nil, err
	}
	return &result, nil
}

func pages[T any](ctx context.Context, initial *string, fetch func(*string) (*T, error), next func(*T) *string) iter.Seq2[*T, error] {
	return func(yield func(*T, error) bool) {
		seen := map[string]bool{}
		cursor := initial
		if cursor != nil {
			seen[*cursor] = true
		}
		for {
			if ctx == nil {
				yield(nil, sdkError("validation", "A context is required"))
				return
			}
			if ctx.Err() != nil {
				yield(nil, transportFailure(ctx, ctx.Err()))
				return
			}
			page, err := fetch(cursor)
			if err != nil {
				yield(nil, err)
				return
			}
			if !yield(page, nil) {
				return
			}
			cursor = next(page)
			if cursor == nil {
				return
			}
			if seen[*cursor] {
				yield(nil, sdkError("pagination", "Server repeated a pagination cursor"))
				return
			}
			seen[*cursor] = true
		}
	}
}

// BundlesPages continues through empty pages until nextCursor is absent.
func (c *RestClient) BundlesPages(ctx context.Context, o PageOptions) iter.Seq2[*BundlesResponse, error] {
	return pages(ctx, o.Cursor, func(cursor *string) (*BundlesResponse, error) {
		p := o
		p.Cursor = cursor
		return c.ListBundles(ctx, p)
	}, func(p *BundlesResponse) *string { return p.NextCursor })
}

// UsersPages preserves the display-name filter on every page.
func (c *RestClient) UsersPages(ctx context.Context, name string, o PageOptions) iter.Seq2[*UsersSearchResponse, error] {
	return pages(ctx, o.Cursor, func(cursor *string) (*UsersSearchResponse, error) {
		p := o
		p.Cursor = cursor
		return c.SearchUsers(ctx, name, p)
	}, func(p *UsersSearchResponse) *string { return p.NextCursor })
}

// BundleUsersPages preserves bundle ID and opaque prefixed cursors.
func (c *RestClient) BundleUsersPages(ctx context.Context, id string, o PageOptions) iter.Seq2[*BundleUsersResponse, error] {
	return pages(ctx, o.Cursor, func(cursor *string) (*BundleUsersResponse, error) {
		p := o
		p.Cursor = cursor
		return c.ListBundleUsers(ctx, id, p)
	}, func(p *BundleUsersResponse) *string { return p.NextCursor })
}

// BundleGrantsPages preserves every filter and the cancellation context.
func (c *RestClient) BundleGrantsPages(ctx context.Context, id string, o GrantsOptions) iter.Seq2[*BundleGrantsResponse, error] {
	return pages(ctx, o.Cursor, func(cursor *string) (*BundleGrantsResponse, error) {
		p := o
		p.Cursor = cursor
		return c.ListBundleGrants(ctx, id, p)
	}, func(p *BundleGrantsResponse) *string { return p.NextCursor })
}
