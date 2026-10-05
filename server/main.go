// Command post-checklist serves the Post Check web app and its sync API from a
// single binary backed by SQLite.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// dist holds the frontend build (make build-web). .gitkeep keeps the embed
// pattern valid before the first build.
//
//go:embed all:dist
var dist embed.FS

// API requests per client: bursts of 60, then one per second. Normal use (a sync
// every 15 seconds, and one shortly after edits) stays far below that.
const (
	apiRate  = 1
	apiBurst = 60
)

func main() {
	addr := flag.String("addr", envOr("ADDR", ":8787"), "HTTP listen address")
	dbPath := flag.String("db", envOr("DB_PATH", "data/post-checklist.db"), "SQLite database file")
	trustProxy := flag.Bool("trust-proxy", envBool("TRUST_PROXY", false),
		"take client addresses from X-Forwarded-For; only behind a reverse proxy that sets it")
	rateLimit := flag.Bool("rate-limit", envBool("RATE_LIMIT", true),
		"limit API requests per client; the end-to-end tests turn it off")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	slog.SetDefault(logger)

	cfg := config{addr: *addr, dbPath: *dbPath, trustProxy: *trustProxy, rateLimit: *rateLimit}
	if err := run(cfg, logger); err != nil {
		logger.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

type config struct {
	addr       string
	dbPath     string
	trustProxy bool
	rateLimit  bool
}

func run(cfg config, logger *slog.Logger) error {
	store, err := OpenStore(cfg.dbPath)
	if err != nil {
		return err
	}
	defer store.Close()

	files, err := fs.Sub(dist, "dist")
	if err != nil {
		return err
	}
	handler, err := newHandler(store, files)
	if err != nil {
		return err
	}
	if cfg.rateLimit {
		handler = limitAPI(newRateLimiter(apiRate, apiBurst, time.Now), cfg.trustProxy, handler)
	}

	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           logAPIRequests(logger, handler),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("listening", "url", listenURL(cfg.addr), "db", cfg.dbPath,
			"trustProxy", cfg.trustProxy, "rateLimit", cfg.rateLimit)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		logger.Info("shutting down")
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// logAPIRequests logs API calls by route pattern, so list IDs (which act as
// passwords) never end up in the log.
func logAPIRequests(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			logger.Info("api", "route", r.Pattern, "status", rec.status, "duration", time.Since(start).Round(time.Microsecond))
		}
	})
}

// listenURL turns a listen address into a URL to open in a browser.
func listenURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://" + addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func envBool(name string, fallback bool) bool {
	value, err := strconv.ParseBool(os.Getenv(name))
	if err != nil {
		return fallback
	}
	return value
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
