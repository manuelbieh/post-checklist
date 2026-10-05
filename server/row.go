package main

import (
	"errors"
	"fmt"
	"regexp"
	"unicode/utf8"
)

// Row is one venue visit. Every editable field carries the timestamp of its
// last change, and per field the newer timestamp wins (see docs/design.md).
type Row struct {
	ID        string `json:"id"`
	Pos       string `json:"pos"`
	Name      string `json:"name"`
	NameTS    string `json:"nameTs"`
	IG        bool   `json:"ig"`
	IGTS      string `json:"igTs"`
	TT        bool   `json:"tt"`
	TTTS      string `json:"ttTs"`
	Deleted   bool   `json:"deleted"`
	DeletedTS string `json:"deletedTs"`
}

const maxNameBytes = 1000

var (
	listIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	rowIDPattern  = regexp.MustCompile(`^[0-9A-Za-z_-]{8,64}$`)
	// Hybrid logical clock: wall clock ms, counter, node ID. Sorts lexicographically.
	timestampPattern = regexp.MustCompile(`^\d{15}:\d{5}:[0-9a-z]{1,16}$`)
)

// ValidListID reports whether id is an acceptable list ID such as "brave-otter-harbor".
func ValidListID(id string) bool {
	return len(id) >= 3 && len(id) <= 64 && listIDPattern.MatchString(id)
}

// Validate checks a row uploaded by a client.
func (r Row) Validate() error {
	if !rowIDPattern.MatchString(r.ID) {
		return errors.New("invalid id")
	}
	if !timestampPattern.MatchString(r.Pos) {
		return errors.New("invalid pos")
	}
	fieldTimestamps := []struct {
		field string
		ts    string
	}{
		{"nameTs", r.NameTS}, {"igTs", r.IGTS}, {"ttTs", r.TTTS}, {"deletedTs", r.DeletedTS},
	}
	for _, f := range fieldTimestamps {
		// An empty timestamp means the field was never set.
		if f.ts != "" && !timestampPattern.MatchString(f.ts) {
			return fmt.Errorf("invalid %s", f.field)
		}
	}
	if len(r.Name) > maxNameBytes {
		return fmt.Errorf("name longer than %d bytes", maxNameBytes)
	}
	if !utf8.ValidString(r.Name) {
		return errors.New("name is not valid UTF-8")
	}
	return nil
}
