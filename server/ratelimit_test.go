package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func TestRateLimiterAllowsABurstThenRefills(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_790_000_000, 0)}
	limiter := newRateLimiter(1, 3, clock.now)

	for i := range 3 {
		if ok, _ := limiter.allow("a"); !ok {
			t.Fatalf("request %d of the burst was refused", i+1)
		}
	}
	ok, retry := limiter.allow("a")
	if ok || retry <= 0 || retry > time.Second {
		t.Fatalf("after the burst: ok=%v retry=%v, want refused with a retry within 1s", ok, retry)
	}

	clock.advance(time.Second)
	if ok, _ := limiter.allow("a"); !ok {
		t.Error("refused after the bucket refilled one token")
	}
}

func TestRateLimiterKeepsClientsApart(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_790_000_000, 0)}
	limiter := newRateLimiter(1, 1, clock.now)

	limiter.allow("a")

	if ok, _ := limiter.allow("b"); !ok {
		t.Error("client b was refused because client a used its budget")
	}
}

func TestRateLimiterForgetsClientsWhoseBucketIsFullAgain(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_790_000_000, 0)}
	limiter := newRateLimiter(1, 10, clock.now)
	limiter.allow("a")
	limiter.allow("b")

	clock.advance(time.Hour)
	limiter.allow("c")

	if len(limiter.clients) != 1 {
		t.Errorf("tracking %d clients, want only the recent one", len(limiter.clients))
	}
}

func TestClientKey(t *testing.T) {
	cases := []struct {
		name       string
		remoteAddr string
		forwarded  []string
		trustProxy bool
		want       string
	}{
		{"IPv4", "203.0.113.7:51000", nil, false, "203.0.113.7"},
		{"IPv6 by /64 network", "[2001:db8:1:2:3:4:5:6]:443", nil, false, "2001:db8:1:2::/64"},
		{"IPv4-mapped IPv6", "[::ffff:203.0.113.7]:443", nil, false, "203.0.113.7"},
		{"forwarded header ignored without a proxy", "203.0.113.7:51000", []string{"198.51.100.1"}, false, "203.0.113.7"},
		{"behind the proxy, the address it appended", "172.18.0.2:40000", []string{"198.51.100.1, 203.0.113.9"}, true, "203.0.113.9"},
		{"behind the proxy, last of several headers", "172.18.0.2:40000", []string{"198.51.100.1", "203.0.113.9"}, true, "203.0.113.9"},
		{"behind the proxy without the header", "172.18.0.2:40000", nil, true, "172.18.0.2"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/health", nil)
			req.RemoteAddr = tc.remoteAddr
			for _, value := range tc.forwarded {
				req.Header.Add("X-Forwarded-For", value)
			}
			if got := clientKey(req, tc.trustProxy); got != tc.want {
				t.Errorf("clientKey = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestLimitAPIRefusesWithRetryAfterAndLeavesTheAppAlone(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_790_000_000, 0)}
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h := limitAPI(newRateLimiter(1, 1, clock.now), false, ok)

	if rec := request(t, h, "GET", "/api/lists/brave-otter-harbor", ""); rec.Code != http.StatusOK {
		t.Fatalf("first request: status %d", rec.Code)
	}
	rec := request(t, h, "GET", "/api/lists/brave-otter-harbor", "")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") != "1" {
		t.Errorf("second request: status %d, Retry-After %q; want 429 and 1", rec.Code, rec.Header().Get("Retry-After"))
	}
	assertJSON(t, rec.Body.Bytes(), `{"error":"too many requests"}`)

	for _, path := range []string{"/", "/assets/index.js", "/api/health"} {
		if rec := request(t, h, "GET", path, ""); rec.Code != http.StatusOK {
			t.Errorf("GET %s: status %d, want it unlimited", path, rec.Code)
		}
	}
}
