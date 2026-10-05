package main

import (
	"strings"
	"testing"
)

func TestValidListID(t *testing.T) {
	valid := []string{"brave-otter-harbor", "abc", "a1-b2-c3", strings.Repeat("a", 64)}
	for _, id := range valid {
		if !ValidListID(id) {
			t.Errorf("ValidListID(%q) = false, want true", id)
		}
	}

	invalid := []string{
		"", "ab", "Brave-Otter", "brave_otter", "-brave", "brave-", "brave--otter",
		"brave otter", "../etc", strings.Repeat("a", 65),
	}
	for _, id := range invalid {
		if ValidListID(id) {
			t.Errorf("ValidListID(%q) = true, want false", id)
		}
	}
}

func TestRowValidate(t *testing.T) {
	valid := Row{ID: "rowA000000000000", Pos: t1, Name: "Café Einstein", NameTS: t1, IGTS: t2}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid row: %v", err)
	}

	cases := []struct {
		name   string
		mutate func(*Row)
	}{
		{"missing id", func(r *Row) { r.ID = "" }},
		{"id with path characters", func(r *Row) { r.ID = "row/../000000000" }},
		{"missing pos", func(r *Row) { r.Pos = "" }},
		{"malformed pos", func(r *Row) { r.Pos = "1790000000001" }},
		{"malformed field timestamp", func(r *Row) { r.TTTS = "yesterday" }},
		{"timestamp with uppercase node", func(r *Row) { r.DeletedTS = "001790000000001:00000:AAAAAAAA" }},
		{"name too long", func(r *Row) { r.Name = strings.Repeat("x", 1001) }},
		{"name with invalid utf-8", func(r *Row) { r.Name = "caf\xe9" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			row := valid
			tc.mutate(&row)
			if err := row.Validate(); err == nil {
				t.Errorf("Validate() = nil, want error")
			}
		})
	}
}
