package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

const (
	maxSyncBodyBytes = 4 << 20
	maxRowsPerSync   = 1000
	// Responses smaller than this are not worth compressing.
	gzipMinBytes = 1024
)

// newHandler wires the JSON API and the static frontend into one handler.
func newHandler(store *Store, files fs.FS) (http.Handler, error) {
	static, err := newStaticHandler(files)
	if err != nil {
		return nil, err
	}
	manifest, err := newManifestHandler(files, static)
	if err != nil {
		return nil, err
	}
	a := &api{store: store}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/lists/{id}/sync", a.sync)
	mux.HandleFunc("GET /api/lists/{id}", a.getList)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "ok\n")
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	mux.Handle("GET /"+manifestFile, manifest)
	mux.Handle("/", static)
	return mux, nil
}

type api struct {
	store *Store
}

type syncRequest struct {
	Since int64 `json:"since"`
	// Epoch is the server start the client's cursor came from (see Store.Epoch).
	Epoch string `json:"epoch"`
	Rows  []Row  `json:"rows"`
}

type syncResponse struct {
	Epoch string `json:"epoch"`
	SyncResult
}

func (a *api) sync(w http.ResponseWriter, r *http.Request) {
	listID := r.PathValue("id")
	if !ValidListID(listID) {
		writeError(w, http.StatusBadRequest, "invalid list id")
		return
	}
	var req syncRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxSyncBodyBytes)).Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Since < 0 {
		writeError(w, http.StatusBadRequest, "since must not be negative")
		return
	}
	if len(req.Rows) > maxRowsPerSync {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("at most %d rows per request", maxRowsPerSync))
		return
	}
	for i, row := range req.Rows {
		if err := row.Validate(); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("row %d: %v", i, err))
			return
		}
	}

	since := req.Since
	if req.Epoch != a.store.Epoch() {
		// The cursor is from an earlier server start: send everything. The client
		// then uploads all its rows again, which repairs a restored backup.
		since = 0
	}
	res, err := a.store.Sync(r.Context(), listID, since, req.Rows)
	if err != nil {
		slog.Error("sync failed", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, r, http.StatusOK, syncResponse{Epoch: a.store.Epoch(), SyncResult: res})
}

type listInfo struct {
	ID     string `json:"id"`
	Venues int    `json:"venues"`
}

func (a *api) getList(w http.ResponseWriter, r *http.Request) {
	listID := r.PathValue("id")
	if !ValidListID(listID) {
		writeError(w, http.StatusBadRequest, "invalid list id")
		return
	}
	venues, found, err := a.store.ListInfo(r.Context(), listID)
	if err != nil {
		slog.Error("list info failed", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, "list not found")
		return
	}
	writeJSON(w, r, http.StatusOK, listInfo{ID: listID, Venues: venues})
}

func writeJSON(w http.ResponseWriter, r *http.Request, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		slog.Error("encode response", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	header := w.Header()
	if len(body) >= gzipMinBytes {
		header.Add("Vary", "Accept-Encoding")
		if acceptsGzip(r) {
			body = gzipBytes(body, gzip.DefaultCompression)
			header.Set("Content-Encoding", "gzip")
		}
	}
	writeBody(w, status, body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	body, _ := json.Marshal(struct {
		Error string `json:"error"`
	}{message})
	writeBody(w, status, body)
}

func writeBody(w http.ResponseWriter, status int, body []byte) {
	header := w.Header()
	header.Set("Content-Type", "application/json")
	header.Set("Cache-Control", "no-store")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	w.Write(body)
}

// acceptsGzip reports whether the request's Accept-Encoding allows gzip.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		coding, params, _ := strings.Cut(part, ";")
		if !strings.EqualFold(strings.TrimSpace(coding), "gzip") {
			continue
		}
		q, found := strings.CutPrefix(strings.TrimSpace(params), "q=")
		if !found {
			return true
		}
		weight, err := strconv.ParseFloat(q, 64)
		return err == nil && weight > 0
	}
	return false
}

func gzipBytes(data []byte, level int) []byte {
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, level)
	zw.Write(data)
	zw.Close()
	return buf.Bytes()
}
