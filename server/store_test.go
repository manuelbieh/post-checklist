package main

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

// Timestamps in the client's HLC format. They sort lexicographically: t1 < t2 < t3.
const (
	t1 = "001790000000001:00000:aaaaaaaa"
	t2 = "001790000000002:00000:aaaaaaaa"
	t3 = "001790000000002:00001:bbbbbbbb"
)

const testListID = "brave-otter-harbor"

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func mustSync(t *testing.T, store *Store, listID string, since int64, rows ...Row) SyncResult {
	t.Helper()
	res, err := store.Sync(context.Background(), listID, since, rows)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	return res
}

func TestSyncStoresNewRowsAndReturnsThem(t *testing.T) {
	store := openTestStore(t)
	row := Row{ID: "rowA000000000000", Pos: t1, Name: "Café Einstein", NameTS: t1, IG: true, IGTS: t1}

	res := mustSync(t, store, testListID, 0, row)

	want := SyncResult{Seq: 1, Rows: []Row{row}}
	if !reflect.DeepEqual(res, want) {
		t.Errorf("got %+v, want %+v", res, want)
	}
}

func TestSyncMergesEachFieldByTimestamp(t *testing.T) {
	store := openTestStore(t)
	mustSync(t, store, testListID, 0, Row{
		ID: "rowA000000000000", Pos: t1,
		Name: "Borchardt", NameTS: t2,
		IG: true, IGTS: t1,
		TT: false, TTTS: "",
		Deleted: true, DeletedTS: t2,
	})

	res := mustSync(t, store, testListID, 1, Row{
		ID: "rowA000000000000", Pos: t3,
		Name: "Borchard", NameTS: t1, // older than stored: loses
		IG: false, IGTS: t3, // newer: wins
		TT: true, TTTS: t2, // stored value was never set: wins
		Deleted: false, DeletedTS: t3, // newer: undoes the delete
	})

	want := SyncResult{Seq: 2, Rows: []Row{{
		ID: "rowA000000000000", Pos: t1, // position is fixed at creation
		Name: "Borchardt", NameTS: t2,
		IG: false, IGTS: t3,
		TT: true, TTTS: t2,
		Deleted: false, DeletedTS: t3,
	}}}
	if !reflect.DeepEqual(res, want) {
		t.Errorf("got %+v, want %+v", res, want)
	}
}

func TestSyncIgnoresStaleUploadsWithoutAdvancingSeq(t *testing.T) {
	store := openTestStore(t)
	row := Row{ID: "rowA000000000000", Pos: t1, Name: "Borchardt", NameTS: t2}
	mustSync(t, store, testListID, 0, row)

	stale := row
	stale.Name, stale.NameTS = "Old name", t1
	res := mustSync(t, store, testListID, 1, stale)

	if want := (SyncResult{Seq: 1, Rows: []Row{}}); !reflect.DeepEqual(res, want) {
		t.Errorf("stale upload: got %+v, want %+v", res, want)
	}
	full := mustSync(t, store, testListID, 0)
	if want := []Row{row}; !reflect.DeepEqual(full.Rows, want) {
		t.Errorf("stored rows = %+v, want %+v", full.Rows, want)
	}
}

func TestSyncReturnsOnlyRowsChangedAfterCursor(t *testing.T) {
	store := openTestStore(t)
	a := Row{ID: "rowA000000000000", Pos: t1, Name: "A", NameTS: t1}
	b := Row{ID: "rowB000000000000", Pos: t2, Name: "B", NameTS: t2}
	mustSync(t, store, testListID, 0, a)

	res := mustSync(t, store, testListID, 1, b)
	if want := (SyncResult{Seq: 2, Rows: []Row{b}}); !reflect.DeepEqual(res, want) {
		t.Errorf("since 1: got %+v, want %+v", res, want)
	}

	full := mustSync(t, store, testListID, 0)
	if want := (SyncResult{Seq: 2, Rows: []Row{a, b}}); !reflect.DeepEqual(full, want) {
		t.Errorf("since 0: got %+v, want %+v", full, want)
	}
}

func TestSyncWithCursorAheadOfServerReturnsEverything(t *testing.T) {
	// Happens when the database was restored from an older backup.
	store := openTestStore(t)
	a := Row{ID: "rowA000000000000", Pos: t1, Name: "A", NameTS: t1}
	mustSync(t, store, testListID, 0, a)

	res := mustSync(t, store, testListID, 57)

	if want := (SyncResult{Seq: 1, Rows: []Row{a}}); !reflect.DeepEqual(res, want) {
		t.Errorf("got %+v, want %+v", res, want)
	}
}

func TestSyncKeepsListsApart(t *testing.T) {
	store := openTestStore(t)
	mustSync(t, store, "list-one", 0, Row{ID: "rowA000000000000", Pos: t1, Name: "A", NameTS: t1})

	res := mustSync(t, store, "list-two", 0)

	if want := (SyncResult{Seq: 0, Rows: []Row{}}); !reflect.DeepEqual(res, want) {
		t.Errorf("got %+v, want %+v", res, want)
	}
}

func TestListInfoCountsVenuesThatAreNotDeleted(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	if _, found, err := store.ListInfo(ctx, testListID); err != nil || found {
		t.Fatalf("unknown list: found=%v err=%v, want found=false err=nil", found, err)
	}

	mustSync(t, store, testListID, 0,
		Row{ID: "rowA000000000000", Pos: t1, Name: "A", NameTS: t1},
		Row{ID: "rowB000000000000", Pos: t2, Name: "B", NameTS: t2, Deleted: true, DeletedTS: t2},
	)

	venues, found, err := store.ListInfo(ctx, testListID)
	if err != nil || !found || venues != 1 {
		t.Errorf("venues=%d found=%v err=%v, want 1 true nil", venues, found, err)
	}
}

func TestSyncWithoutRowsCreatesList(t *testing.T) {
	store := openTestStore(t)

	mustSync(t, store, testListID, 0)

	if _, found, err := store.ListInfo(context.Background(), testListID); err != nil || !found {
		t.Errorf("found=%v err=%v, want found=true", found, err)
	}
}

func TestStorePersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "test.db")
	row := Row{ID: "rowA000000000000", Pos: t1, Name: "A", NameTS: t1}

	first, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	mustSync(t, first, testListID, 0, row)
	first.Close()

	second, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer second.Close()
	res := mustSync(t, second, testListID, 0)
	if want := (SyncResult{Seq: 1, Rows: []Row{row}}); !reflect.DeepEqual(res, want) {
		t.Errorf("got %+v, want %+v", res, want)
	}
}

func TestStoreStartsANewEpochEachTimeItOpens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	first, err := OpenStore(path)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	firstEpoch := first.Epoch()
	first.Close()

	second, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer second.Close()

	if firstEpoch == "" || second.Epoch() == firstEpoch {
		t.Errorf("epochs %q and %q, want two different, non-empty ones", firstEpoch, second.Epoch())
	}
}
