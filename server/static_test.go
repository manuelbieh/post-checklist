package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

var testJS = strings.Repeat("console.log('post check');\n", 100)

func newStaticTestHandler(t *testing.T) http.Handler {
	t.Helper()
	h, err := newHandler(openTestStore(t), fstest.MapFS{
		"index.html":             {Data: []byte("<!doctype html><title>Post Check</title>")},
		"assets/index-abc123.js": {Data: []byte(testJS)},
		"sw.js":                  {Data: []byte("self.addEventListener('fetch', () => {});")},
		"manifest.webmanifest":   {Data: []byte(`{"name":"Post Check"}`)},
		".gitkeep":               {Data: []byte{}},
	})
	if err != nil {
		t.Fatalf("newHandler: %v", err)
	}
	return h
}

func TestStaticFiles(t *testing.T) {
	h := newStaticTestHandler(t)
	const html = "text/html; charset=utf-8"
	const js = "text/javascript; charset=utf-8"
	const immutable = "public, max-age=31536000, immutable"

	cases := []struct {
		path         string
		status       int
		body         string
		contentType  string
		cacheControl string
	}{
		{"/", 200, "<title>Post Check</title>", html, "no-cache"},
		{"/index.html", 200, "<title>Post Check</title>", html, "no-cache"},
		{"/some/client/route", 200, "<title>Post Check</title>", html, "no-cache"},
		{"/assets/index-abc123.js", 200, "console.log", js, immutable},
		{"/sw.js", 200, "addEventListener", js, "no-cache"},
		{"/manifest.webmanifest", 200, "Post Check", "application/manifest+json", "no-cache"},
		{"/assets/missing.js", 404, "", "", ""},
		{"/missing.png", 404, "", "", ""},
		{"/.gitkeep", 404, "", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			rec := request(t, h, "GET", tc.path, "")

			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d", rec.Code, tc.status)
			}
			if tc.status != 200 {
				return
			}
			if !strings.Contains(rec.Body.String(), tc.body) {
				t.Errorf("body %q does not contain %q", rec.Body, tc.body)
			}
			if got := rec.Header().Get("Content-Type"); got != tc.contentType {
				t.Errorf("Content-Type = %q, want %q", got, tc.contentType)
			}
			if got := rec.Header().Get("Cache-Control"); got != tc.cacheControl {
				t.Errorf("Cache-Control = %q, want %q", got, tc.cacheControl)
			}
		})
	}
}

func TestStaticFilesAreGzippedWhenAccepted(t *testing.T) {
	rec := request(t, newStaticTestHandler(t), "GET", "/assets/index-abc123.js", "", "Accept-Encoding", "gzip, deflate, br")

	if enc := rec.Header().Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", enc)
	}
	if vary := rec.Header().Get("Vary"); !strings.Contains(vary, "Accept-Encoding") {
		t.Errorf("Vary = %q, want Accept-Encoding", vary)
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip: %v", err)
	}
	body, _ := io.ReadAll(zr)
	if string(body) != testJS {
		t.Errorf("decompressed body differs from the original file")
	}
}

func TestStaticFilesRevalidateWithETag(t *testing.T) {
	h := newStaticTestHandler(t)
	first := request(t, h, "GET", "/", "")
	etag := first.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag header")
	}

	second := request(t, h, "GET", "/", "", "If-None-Match", etag)

	if second.Code != http.StatusNotModified {
		t.Errorf("status = %d, want 304", second.Code)
	}
}

func TestHTMLResponsesCarrySecurityHeaders(t *testing.T) {
	rec := request(t, newStaticTestHandler(t), "GET", "/", "")

	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("Content-Security-Policy = %q, want default-src 'self'", csp)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
}

func TestMissingFrontendBuildExplainsItself(t *testing.T) {
	h, err := newHandler(openTestStore(t), fstest.MapFS{".gitkeep": {Data: []byte{}}})
	if err != nil {
		t.Fatalf("newHandler: %v", err)
	}

	rec := request(t, h, "GET", "/", "")

	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "make build") {
		t.Errorf("status = %d body = %q, want 503 mentioning make build", rec.Code, rec.Body)
	}
}
