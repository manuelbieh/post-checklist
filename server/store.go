package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Store keeps all lists in one SQLite database.
type Store struct {
	db    *sql.DB
	epoch string
}

// SyncResult is what a client receives after a sync: the list's change
// counter and every row that changed after the client's cursor.
type SyncResult struct {
	Seq  int64 `json:"seq"`
	Rows []Row `json:"rows"`
}

const schemaV1 = `
CREATE TABLE lists (
	id         TEXT PRIMARY KEY,
	seq        INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE entries (
	list_id    TEXT NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
	id         TEXT NOT NULL,
	pos        TEXT NOT NULL,
	name       TEXT NOT NULL,
	name_ts    TEXT NOT NULL,
	ig         INTEGER NOT NULL,
	ig_ts      TEXT NOT NULL,
	tt         INTEGER NOT NULL,
	tt_ts      TEXT NOT NULL,
	deleted    INTEGER NOT NULL,
	deleted_ts TEXT NOT NULL,
	seq        INTEGER NOT NULL,
	PRIMARY KEY (list_id, id)
) STRICT, WITHOUT ROWID;

CREATE INDEX entries_by_seq ON entries (list_id, seq);

PRAGMA user_version = 1;
`

// upsertEntry merges one uploaded row. Per field, the newer timestamp wins;
// pos never changes after creation. The row is only stamped with the new seq
// when at least one field actually changed.
const upsertEntry = `
INSERT INTO entries (list_id, id, pos, name, name_ts, ig, ig_ts, tt, tt_ts, deleted, deleted_ts, seq)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (list_id, id) DO UPDATE SET
	name       = iif(excluded.name_ts > entries.name_ts, excluded.name, entries.name),
	name_ts    = max(excluded.name_ts, entries.name_ts),
	ig         = iif(excluded.ig_ts > entries.ig_ts, excluded.ig, entries.ig),
	ig_ts      = max(excluded.ig_ts, entries.ig_ts),
	tt         = iif(excluded.tt_ts > entries.tt_ts, excluded.tt, entries.tt),
	tt_ts      = max(excluded.tt_ts, entries.tt_ts),
	deleted    = iif(excluded.deleted_ts > entries.deleted_ts, excluded.deleted, entries.deleted),
	deleted_ts = max(excluded.deleted_ts, entries.deleted_ts),
	seq        = excluded.seq
WHERE excluded.name_ts > entries.name_ts
	OR excluded.ig_ts > entries.ig_ts
	OR excluded.tt_ts > entries.tt_ts
	OR excluded.deleted_ts > entries.deleted_ts`

// OpenStore opens the database at path, creating the file and schema if needed.
func OpenStore(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	dsn := "file:" + path +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	// A single connection serializes all access. That is plenty for this
	// workload and rules out SQLITE_BUSY between concurrent writers.
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db, epoch: rand.Text()}, nil
}

// Epoch identifies this start of the server. A client's cursor is only valid for
// the epoch it came from: after a restart the database may be a restored backup
// that lacks changes the client already saw or uploaded.
func (s *Store) Epoch() string {
	return s.epoch
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version >= 1 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(schemaV1); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	return tx.Commit()
}

// Close closes the database.
func (s *Store) Close() error {
	return s.db.Close()
}

// Sync merges rows into the list (creating the list if needed) and returns
// every row that changed after the since cursor, including the merged ones.
func (s *Store) Sync(ctx context.Context, listID string, since int64, rows []Row) (SyncResult, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return SyncResult{}, err
	}
	defer tx.Rollback()

	now := time.Now().UnixMilli()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO lists (id, seq, created_at, updated_at) VALUES (?, 0, ?, ?) ON CONFLICT (id) DO NOTHING`,
		listID, now, now); err != nil {
		return SyncResult{}, fmt.Errorf("create list: %w", err)
	}
	var seq int64
	if err := tx.QueryRowContext(ctx, `SELECT seq FROM lists WHERE id = ?`, listID).Scan(&seq); err != nil {
		return SyncResult{}, fmt.Errorf("read list seq: %w", err)
	}

	if len(rows) > 0 {
		changed, err := upsertRows(ctx, tx, listID, seq+1, rows)
		if err != nil {
			return SyncResult{}, err
		}
		if changed {
			seq++
			if _, err := tx.ExecContext(ctx, `UPDATE lists SET seq = ?, updated_at = ? WHERE id = ?`, seq, now, listID); err != nil {
				return SyncResult{}, fmt.Errorf("advance list seq: %w", err)
			}
		}
	}

	// A cursor ahead of the server means the client synced with a database
	// that has since been restored from an older state: send everything.
	if since > seq {
		since = 0
	}
	changedRows, err := queryRows(ctx, tx,
		`SELECT id, pos, name, name_ts, ig, ig_ts, tt, tt_ts, deleted, deleted_ts
		FROM entries WHERE list_id = ? AND seq > ? ORDER BY seq, id`, listID, since)
	if err != nil {
		return SyncResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return SyncResult{}, err
	}
	return SyncResult{Seq: seq, Rows: changedRows}, nil
}

func upsertRows(ctx context.Context, tx *sql.Tx, listID string, seq int64, rows []Row) (changed bool, err error) {
	stmt, err := tx.PrepareContext(ctx, upsertEntry)
	if err != nil {
		return false, fmt.Errorf("prepare upsert: %w", err)
	}
	defer stmt.Close()
	for _, r := range rows {
		res, err := stmt.ExecContext(ctx, listID, r.ID, r.Pos, r.Name, r.NameTS, r.IG, r.IGTS, r.TT, r.TTTS, r.Deleted, r.DeletedTS, seq)
		if err != nil {
			return false, fmt.Errorf("upsert row %s: %w", r.ID, err)
		}
		if n, err := res.RowsAffected(); err != nil {
			return false, err
		} else if n > 0 {
			changed = true
		}
	}
	return changed, nil
}

func queryRows(ctx context.Context, tx *sql.Tx, query string, args ...any) ([]Row, error) {
	result, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query rows: %w", err)
	}
	defer result.Close()
	rows := []Row{}
	for result.Next() {
		var r Row
		if err := result.Scan(&r.ID, &r.Pos, &r.Name, &r.NameTS, &r.IG, &r.IGTS, &r.TT, &r.TTTS, &r.Deleted, &r.DeletedTS); err != nil {
			return nil, fmt.Errorf("scan row: %w", err)
		}
		rows = append(rows, r)
	}
	return rows, result.Err()
}

// ListInfo reports whether the list exists and how many rows it has that are
// not deleted.
func (s *Store) ListInfo(ctx context.Context, listID string) (venues int, found bool, err error) {
	err = s.db.QueryRowContext(ctx,
		`SELECT (SELECT count(*) FROM entries WHERE list_id = lists.id AND deleted = 0) FROM lists WHERE id = ?`,
		listID).Scan(&venues)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("read list: %w", err)
	}
	return venues, true, nil
}
