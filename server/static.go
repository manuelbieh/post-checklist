package main

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
)

// staticHandler serves the built frontend from memory. Every file is read,
// hashed and, when that pays off, gzipped once at startup.
type staticHandler struct {
	files map[string]*staticFile
	index *staticFile
}

type staticFile struct {
	body         []byte
	gzipped      []byte
	contentType  string
	cacheControl string
	etag         string
}

var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json",
	".webmanifest": "application/manifest+json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".woff2":       "font/woff2",
}

var compressible = map[string]bool{
	".html": true, ".js": true, ".css": true, ".json": true, ".webmanifest": true, ".svg": true,
}

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self'; " +
	"img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; " +
	"worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

func newStaticHandler(fsys fs.FS) (*staticHandler, error) {
	h := &staticHandler{files: map[string]*staticFile{}}
	err := fs.WalkDir(fsys, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name != "." && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		body, err := fs.ReadFile(fsys, name)
		if err != nil {
			return err
		}
		h.files["/"+name] = newStaticFile(name, body)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load frontend files: %w", err)
	}
	h.index = h.files["/index.html"]
	return h, nil
}

func newStaticFile(name string, body []byte) *staticFile {
	ext := path.Ext(name)
	contentType, ok := contentTypes[ext]
	if !ok {
		contentType = mime.TypeByExtension(ext)
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	sum := sha256.Sum256(body)
	f := &staticFile{
		body:        body,
		contentType: contentType,
		// Vite puts content-hashed files into assets/; everything else must be
		// revalidated so a new deploy is picked up (index.html, sw.js, icons).
		cacheControl: "no-cache",
		etag:         `W/"` + hex.EncodeToString(sum[:8]) + `"`,
	}
	if strings.HasPrefix(name, "assets/") {
		f.cacheControl = "public, max-age=31536000, immutable"
	}
	if compressible[ext] && len(body) >= gzipMinBytes {
		if gz := gzipBytes(body, gzip.BestCompression); len(gz) < len(body) {
			f.gzipped = gz
		}
	}
	return f
}

func (h *staticHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if h.index == nil {
		http.Error(w, "The frontend is not built yet. Run `make build`, or use `make dev` during development.",
			http.StatusServiceUnavailable)
		return
	}
	f := h.files[r.URL.Path]
	if f == nil {
		if path.Ext(r.URL.Path) != "" {
			http.NotFound(w, r)
			return
		}
		// Any other path is a client-side route: serve the app shell.
		f = h.index
	}

	header := w.Header()
	header.Set("Content-Type", f.contentType)
	header.Set("Cache-Control", f.cacheControl)
	header.Set("ETag", f.etag)
	header.Set("X-Content-Type-Options", "nosniff")
	if f == h.index {
		header.Set("Content-Security-Policy", contentSecurityPolicy)
		header.Set("Referrer-Policy", "no-referrer")
	}
	if f.gzipped != nil {
		header.Add("Vary", "Accept-Encoding")
	}
	if etagMatches(r.Header.Get("If-None-Match"), f.etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	body := f.body
	if f.gzipped != nil && acceptsGzip(r) {
		body = f.gzipped
		header.Set("Content-Encoding", "gzip")
	}
	header.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(body)
	}
}

// etagMatches implements the weak comparison used for If-None-Match.
func etagMatches(ifNoneMatch, etag string) bool {
	if strings.TrimSpace(ifNoneMatch) == "*" {
		return true
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == want {
			return true
		}
	}
	return false
}
