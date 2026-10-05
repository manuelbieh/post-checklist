package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

const syncPath = "/api/lists/" + testListID + "/sync"

const rowJSON = `{"id":"rowA000000000000","pos":"` + t1 + `","name":"Café Einstein","nameTs":"` + t1 +
	`","ig":true,"igTs":"` + t1 + `","tt":false,"ttTs":"","deleted":false,"deletedTs":""}`

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	h, err := newHandler(openTestStore(t), fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html><title>Post Check</title>")},
	})
	if err != nil {
		t.Fatalf("newHandler: %v", err)
	}
	return h
}

// request sends a request through the handler; header is a list of name/value pairs.
func request(t *testing.T, h http.Handler, method, target, body string, header ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for i := 0; i+1 < len(header); i += 2 {
		req.Header.Set(header[i], header[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// assertJSON compares a response body with the expected JSON document, ignoring formatting.
func assertJSON(t *testing.T, got []byte, want string) {
	t.Helper()
	var gotValue, wantValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, got)
	}
	if err := json.Unmarshal([]byte(want), &wantValue); err != nil {
		t.Fatalf("bad expectation: %v", err)
	}
	if !reflect.DeepEqual(gotValue, wantValue) {
		t.Errorf("body = %s\nwant   %s", got, want)
	}
}

func TestSyncEndpointMergesAndReturnsRows(t *testing.T) {
	h := newTestHandler(t)

	rec := request(t, h, "POST", syncPath, `{"since":0,"rows":[`+rowJSON+`]}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	if epoch, _ := body["epoch"].(string); epoch == "" {
		t.Errorf("response has no epoch: %s", rec.Body)
	}
	delete(body, "epoch")
	rest, _ := json.Marshal(body)
	assertJSON(t, rest, `{"seq":1,"rows":[`+rowJSON+`]}`)
}

type syncResponseBody struct {
	Epoch string
	Seq   int64
	Rows  []Row
}

func postSync(t *testing.T, h http.Handler, body string) syncResponseBody {
	t.Helper()
	rec := request(t, h, "POST", syncPath, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body)
	}
	var res syncResponseBody
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
	return res
}

func TestSyncEndpointSendsEverythingToACursorFromAnEarlierServerStart(t *testing.T) {
	h := newTestHandler(t)
	first := postSync(t, h, `{"since":0,"rows":[`+rowJSON+`]}`)

	sameStart := postSync(t, h, fmt.Sprintf(`{"since":%d,"epoch":%q,"rows":[]}`, first.Seq, first.Epoch))
	earlierStart := postSync(t, h, fmt.Sprintf(`{"since":%d,"epoch":"earlier","rows":[]}`, first.Seq))

	if len(sameStart.Rows) != 0 {
		t.Errorf("same epoch: got %d rows, want only newer ones (none)", len(sameStart.Rows))
	}
	if len(earlierStart.Rows) != 1 || earlierStart.Epoch != first.Epoch {
		t.Errorf("earlier epoch: got %d rows with epoch %q, want all rows and epoch %q",
			len(earlierStart.Rows), earlierStart.Epoch, first.Epoch)
	}
}

func TestSyncEndpointRejectsBadRequests(t *testing.T) {
	var tooMany strings.Builder
	tooMany.WriteString(`{"since":0,"rows":[`)
	for i := range 1001 {
		if i > 0 {
			tooMany.WriteString(",")
		}
		fmt.Fprintf(&tooMany, `{"id":"row%013d","pos":"%s"}`, i, t1)
	}
	tooMany.WriteString(`]}`)

	cases := []struct {
		name   string
		path   string
		body   string
		status int
	}{
		{"invalid list id", "/api/lists/Not_Valid/sync", `{"since":0,"rows":[]}`, 400},
		{"malformed json", syncPath, `{"since":`, 400},
		{"negative cursor", syncPath, `{"since":-1,"rows":[]}`, 400},
		{"invalid row", syncPath, `{"since":0,"rows":[{"id":"x","pos":"now"}]}`, 400},
		{"too many rows", syncPath, tooMany.String(), 400},
		{"oversized body", syncPath, `{"since":0,"rows":[],"pad":"` + strings.Repeat("x", 5<<20) + `"}`, 413},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := request(t, newTestHandler(t), "POST", tc.path, tc.body)

			if rec.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.status, rec.Body)
			}
			var body struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error == "" {
				t.Errorf("want a JSON error message, got %q", rec.Body)
			}
		})
	}
}

func TestSyncEndpointGzipsLargeResponses(t *testing.T) {
	h := newTestHandler(t)
	rows := make([]string, 50)
	for i := range rows {
		rows[i] = fmt.Sprintf(`{"id":"row%013d","pos":"%s","name":"Venue %d","nameTs":"%s"}`, i, t1, i, t1)
	}
	request(t, h, "POST", syncPath, `{"since":0,"rows":[`+strings.Join(rows, ",")+`]}`)

	rec := request(t, h, "POST", syncPath, `{"since":0,"rows":[]}`, "Accept-Encoding", "gzip")

	if enc := rec.Header().Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", enc)
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip: %v", err)
	}
	body, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	var res struct {
		Rows []json.RawMessage `json:"rows"`
	}
	if err := json.Unmarshal(body, &res); err != nil || len(res.Rows) != 50 {
		t.Errorf("decoded %d rows (err %v), want 50", len(res.Rows), err)
	}
}

func TestGetListEndpoint(t *testing.T) {
	h := newTestHandler(t)
	listPath := "/api/lists/" + testListID

	if rec := request(t, h, "GET", listPath, ""); rec.Code != http.StatusNotFound {
		t.Errorf("unknown list: status = %d, want 404", rec.Code)
	}

	request(t, h, "POST", syncPath, `{"since":0,"rows":[`+rowJSON+`]}`)
	rec := request(t, h, "GET", listPath, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("known list: status = %d, want 200", rec.Code)
	}
	assertJSON(t, rec.Body.Bytes(), `{"id":"`+testListID+`","venues":1}`)

	if rec := request(t, h, "GET", "/api/lists/Not_Valid", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid id: status = %d, want 400", rec.Code)
	}
}

func TestUnknownAPIPathIsJSONNotFound(t *testing.T) {
	rec := request(t, newTestHandler(t), "GET", "/api/nope", "")

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json (not the app shell)", ct)
	}
}

func TestHealthEndpoint(t *testing.T) {
	rec := request(t, newTestHandler(t), "GET", "/api/health", "")

	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "ok" {
		t.Errorf("status = %d body = %q, want 200 ok", rec.Code, rec.Body)
	}
}
