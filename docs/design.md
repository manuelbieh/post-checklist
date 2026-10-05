# Post Check — design

A single-purpose web app that tracks whether restaurant and bar visits have been
posted to Instagram and TikTok. It looks and behaves like a four-column
spreadsheet: `No`, `Venue`, `Instagram`, `TikTok`.

## Goals

- Snappy UI: every interaction is applied locally first; the network is never on
  the critical path.
- Works offline, syncs when online, and reconciles edits made on several
  devices while some of them were offline.
- No login. A list is identified by a word ID such as `brave-otter-harbor`.
  Anyone who knows the ID can open and edit the list.
- Minimal server: one Go binary (standard library plus a pure-Go SQLite
  driver) that serves the API and the embedded frontend.
- CSV export (backup) and import.
- Mobile first, installable on the iOS home screen, decent desktop experience.

## Architecture

```
web/     React + TypeScript (Vite). Builds into server/dist.
server/  Go. net/http + modernc.org/sqlite. Embeds server/dist.
```

In development, Vite serves the frontend and proxies `/api` to the Go server.
In production, the Go binary serves everything from one port.

## Data model

A list is a set of rows. Every editable field carries its own timestamp:

| Field       | Type   | Notes                                             |
| ----------- | ------ | ------------------------------------------------- |
| `id`        | string | Random, generated on the device (16 chars base62) |
| `pos`       | string | Creation timestamp; rows are sorted by it         |
| `name`      | string | Venue name, max 200 characters                    |
| `ig`, `tt`  | bool   | Posted to Instagram / TikTok                      |
| `deleted`   | bool   | Tombstone, so deletions sync                      |
| `*Ts`       | string | Timestamp of the last change to that field        |

`No` is not stored. It is the row's position in the list (oldest first).

### Timestamps

Timestamps come from a hybrid logical clock (HLC) and are fixed-width strings
that sort lexicographically:

```
001790000000000:00000:k3j9x2ab
└─ wall ms (15) ┘ └ctr┘ └ node ┘
```

`node` is random per page load, so two devices (or tabs) never produce the same
timestamp. Every device advances its clock past every timestamp it receives,
so an edit made after seeing a remote change always wins over that change. An
empty string means "never set" and loses against everything.

### Merge rule

Per field, the value with the greater timestamp wins (last writer wins per
field). The rule is commutative, associative and idempotent, so devices can
exchange changes in any order, any number of times, and converge.

Consequences:

- Device A renames a venue while offline, device B ticks TikTok on the same
  row: both changes survive.
- Both devices change the same field: the later change wins.
- A deleted row stays deleted even if another device edits its name later;
  undo sets `deleted` back with a newer timestamp.

## Sync protocol

```
POST /api/lists/{listId}/sync
{ "since": 41, "epoch": "...", "rows": [Row, ...] }   max 1000 rows per request

200 { "epoch": "...", "seq": 42, "rows": [Row, ...] }
```

The server keeps a change counter (`seq`) per list. In one transaction it
merges the uploaded rows with the rule above, stamps every row that actually
changed with the next `seq`, and returns all rows with `seq > since`. The
client merges those rows, stores `seq` as its new cursor and marks the rows it
uploaded as acknowledged. Rows edited while the request was in flight stay
pending and go out with the next sync.

The server picks a random `epoch` every time it starts, and a cursor is only
valid together with the epoch it came from. After a restart the database may
be a restored backup that lacks changes a device already saw or uploaded, and
the counter may even have grown past that device's cursor again. So when the
epochs differ, the server treats `since` as 0 and sends every row, and the
client marks all its rows as pending and uploads them again. Merging makes
both directions idempotent; a restart costs each device one full sync.

```
GET /api/lists/{listId}   200 { "id": "...", "venues": 12 } | 404
GET /api/health           200 ok
```

`GET /api/lists/{listId}` is used before switching to an existing ID, so a
typo doesn't silently open an empty list. A list is created on its first sync.

The client syncs about a second after local edits, when the device comes back
online, when the app returns to the foreground, and every 15 seconds while it
is visible. Failed syncs back off exponentially (up to 60 s).

## Client storage

`localStorage`, one JSON document per list (`postcheck:data:{listId}`) holding
the rows, the sync cursor with its server epoch and, per row, the highest
timestamp the server has acknowledged. A row is pending when one of its field timestamps is newer than
that. Writes are read-merge-write with the same merge rule, so two open tabs
never overwrite each other; the `storage` event updates the other tab live.
Cursor and epoch are only taken over as a pair, never mixed across epochs.

The current list ID lives in `postcheck:list`. Earlier IDs used on the device
are remembered in `postcheck:lists`.

## List IDs

Generated on the device with `crypto.getRandomValues` as
`adjective-animal-noun`, so the app works offline from the first launch.
Input is normalized (lowercase, spaces to hyphens). The ID is the only secret,
with about 13.4 million combinations, so the server limits API requests per
client: a token bucket of 60 requests, refilled at one per second (IPv6 clients
by /64 network). Guessing is then far too slow to find a list, while normal use
(a sync every 15 seconds and shortly after edits) never comes close. Over the
limit, the API answers 429 with `Retry-After`, and the sync engine backs off.

The address always names the current list: `https://…/#brave-otter-harbor`.
The fragment never reaches the server, and it makes the address itself the
share link. It also carries the list into bookmarks and home screen apps: on
iOS a home screen app gets its own, empty storage (separate from Safari), so
without the ID in its start address it would begin with a new list. A device
without a list of its own adopts the list from the address; a device that has
one asks before switching.

## UI behavior

- Rows below the data are empty ruled lines, like a paper pad. Typing into
  the first empty line creates a row; Enter moves to the next line and keeps
  the keyboard open.
- Instagram and TikTok cells: a tap sets an X. Removing it requires holding
  the cell for about half a second; the X erases itself while you hold and
  comes back if you let go early. A plain tap on a checked cell shows a hint.
- A row whose venue name is cleared and has no X is removed when you leave it.
- Tapping a row number opens a row menu with "Delete row"; a toast offers undo.
- Desktop keyboard: arrow keys move between cells, Enter moves down, Space
  sets an X, Delete or Backspace removes it, Escape reverts an edit.
- UI language follows the device: German on German devices, English
  otherwise.
- Haptics: a short vibration on Android. On iPhone, Safari only plays its
  haptic tick when a finger toggles a switch control (programmatic clicks stopped
  working in iOS 26.5), so each mark cell carries a transparent label with a
  hidden switch. Taps that change nothing cancel the label's click: no tick.

## CSV

Export writes `No,Venue,Instagram,TikTok` with `y`/`n`, UTF-8 with BOM so Excel
detects the encoding. Before exporting, the app attempts a sync (max 3 s); the
file is written either way, and the toast says whether it includes the latest
server state. On iOS the file goes through the share sheet ("Save to Files"),
elsewhere it downloads.

Import accepts comma, semicolon or tab separated files, with or without a
header row. Checked values: `y`, `yes`, `x`, `1`, `true`, `ja`, `j`, `✓`.
If the list already has rows, the user chooses between adding to it and
replacing it.

## PWA

- Web app manifest with icons (including maskable), `display: standalone`.
  The page links it as `/manifest.webmanifest?list=<id>`, and the server
  answers with `start_url: "/#<id>"`, so an installed app starts on the list it
  was installed from (see List IDs). iOS 16.4+ and Chrome both read the
  manifest when the app is installed; Chrome requires an explicit `start_url`.
- iOS: `apple-touch-icon`, standalone meta tags, safe-area insets.
- Service worker generated at build time: precaches the app shell and assets,
  serves navigations from the cache, leaves `/api` alone. A new version
  activates in the background and the app offers a reload.
- The server answers every non-file, non-API path with `index.html`.

## Deployment

- One Linux binary (frontend embedded) as a systemd service with its own user,
  bound to the Docker bridge address `172.18.0.1:8787`. The existing Caddy
  container on the server terminates TLS and proxies to it; see README, Deploy.
- Behind Caddy, the server takes the client address for rate limiting from the
  last `X-Forwarded-For` entry (`-trust-proxy`), the one Caddy appended.
- The domain has no AAAA record. With one, IPv6 connections would reach the
  container through Docker's userland proxy, which hides client addresses, so
  all IPv6 clients would share one rate-limit bucket.
- Neither Caddy nor the app writes access logs: request paths contain list IDs.

## Testing

- Go: store merge semantics and API contract against a real SQLite file.
- TypeScript (Vitest): clock, merge, IDs, CSV, persistence, store, sync engine.
- End to end (Playwright: desktop Chrome, Android Chrome, iPhone WebKit): two
  browser contexts against the real server, one offline, conflicting edits,
  convergence; CSV export and import; share links; offline start.
