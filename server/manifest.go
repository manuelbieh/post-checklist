package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"maps"
	"net/http"
)

const manifestFile = "manifest.webmanifest"

// manifestHandler serves the web app manifest. The app links it as
// /manifest.webmanifest?list=<id>, and the start URL then opens that list, so an app
// installed from a list starts on it. On iOS that matters: a home screen app gets its
// own, empty storage and would otherwise begin with a new list.
type manifestHandler struct {
	fields map[string]json.RawMessage
	static http.Handler
}

// newManifestHandler reads the built manifest. Without one (frontend not built yet),
// requests go to the static handler.
func newManifestHandler(files fs.FS, static http.Handler) (http.Handler, error) {
	data, err := fs.ReadFile(files, manifestFile)
	if errors.Is(err, fs.ErrNotExist) {
		return static, nil
	}
	if err != nil {
		return nil, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, fmt.Errorf("parse %s: %w", manifestFile, err)
	}
	return &manifestHandler{fields: fields, static: static}, nil
}

func (h *manifestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	listID := r.URL.Query().Get("list")
	if !ValidListID(listID) {
		h.static.ServeHTTP(w, r)
		return
	}
	fields := maps.Clone(h.fields)
	// List IDs are lowercase letters, digits and hyphens: nothing to escape.
	fields["start_url"] = json.RawMessage(`"/#` + listID + `"`)
	body, err := json.Marshal(fields)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "manifest unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/manifest+json")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(body)
}
