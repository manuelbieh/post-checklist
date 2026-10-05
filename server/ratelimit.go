package main

import (
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"
)

// rateLimiter is a token bucket per client: bursts of up to `burst` requests,
// refilled at `rate` per second. It caps how fast anyone can guess list IDs,
// which work as passwords, and how fast one client can write.
type rateLimiter struct {
	mu        sync.Mutex
	clients   map[string]*bucket
	rate      float64
	burst     float64
	now       func() time.Time
	lastSweep time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter(rate float64, burst int, now func() time.Time) *rateLimiter {
	return &rateLimiter{clients: map[string]*bucket{}, rate: rate, burst: float64(burst), now: now}
}

// allow takes a token from the client's bucket. Without one left, it reports how
// long until the next token.
func (l *rateLimiter) allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.sweep(now)

	b := l.clients[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.clients[key] = b
	}
	b.tokens = min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	return false, time.Duration((1 - b.tokens) / l.rate * float64(time.Second))
}

// sweep forgets clients whose bucket has filled up again, so memory only holds
// recent clients.
func (l *rateLimiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < time.Minute {
		return
	}
	l.lastSweep = now
	refill := time.Duration(l.burst / l.rate * float64(time.Second))
	for key, b := range l.clients {
		if now.Sub(b.last) > refill {
			delete(l.clients, key)
		}
	}
}

// clientKey identifies a client for rate limiting: its IP address, or its /64
// network for IPv6, since one subscriber usually gets a whole /64. Behind a
// reverse proxy (trustProxy), that is the last X-Forwarded-For address: the one
// the proxy itself appended.
func clientKey(r *http.Request, trustProxy bool) string {
	addr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		addr = host
	}
	if trustProxy {
		if forwarded := r.Header.Values("X-Forwarded-For"); len(forwarded) > 0 {
			hops := strings.Split(forwarded[len(forwarded)-1], ",")
			addr = strings.TrimSpace(hops[len(hops)-1])
		}
	}
	ip, err := netip.ParseAddr(addr)
	if err != nil {
		return addr
	}
	ip = ip.Unmap()
	if ip.Is6() {
		network, _ := ip.Prefix(64)
		return network.String()
	}
	return ip.String()
}

// limitAPI rate-limits API requests. The app's files and the health check are
// not limited.
func limitAPI(limiter *rateLimiter, trustProxy bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" {
			if ok, retry := limiter.allow(clientKey(r, trustProxy)); !ok {
				w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retry.Seconds()))))
				writeError(w, http.StatusTooManyRequests, "too many requests")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
