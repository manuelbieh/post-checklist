package main

import "testing"

func TestListenURL(t *testing.T) {
	cases := map[string]string{
		":8787":          "http://localhost:8787",
		"0.0.0.0:8787":   "http://localhost:8787",
		"127.0.0.1:8799": "http://127.0.0.1:8799",
		"[::1]:8787":     "http://[::1]:8787",
	}
	for addr, want := range cases {
		if got := listenURL(addr); got != want {
			t.Errorf("listenURL(%q) = %q, want %q", addr, got, want)
		}
	}
}
