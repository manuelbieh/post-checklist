package main

import (
	"encoding/json"
	"testing"
)

func TestManifestStartsOnTheListItWasLinkedWith(t *testing.T) {
	h := newStaticTestHandler(t)

	rec := request(t, h, "GET", "/manifest.webmanifest?list=brave-otter-harbor", "")

	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/manifest+json" {
		t.Errorf("Content-Type = %q", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("Cache-Control = %q", got)
	}
	var manifest map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &manifest); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if manifest["start_url"] != "/#brave-otter-harbor" {
		t.Errorf("start_url = %v, want /#brave-otter-harbor", manifest["start_url"])
	}
	if manifest["name"] != "Post Check" {
		t.Errorf("name = %v, want the rest of the manifest unchanged", manifest["name"])
	}
}

func TestManifestWithoutAValidListIsTheStaticFile(t *testing.T) {
	h := newStaticTestHandler(t)

	for _, target := range []string{
		"/manifest.webmanifest",
		"/manifest.webmanifest?list=",
		"/manifest.webmanifest?list=Not%20Valid!",
	} {
		rec := request(t, h, "GET", target, "")
		if rec.Code != 200 || rec.Body.String() != `{"name":"Post Check"}` {
			t.Errorf("GET %s = %d %q, want the static manifest", target, rec.Code, rec.Body)
		}
	}
}
