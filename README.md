# Post Check

Tracks which restaurant and bar visits are already posted on Instagram and TikTok.
One list, four columns: number, venue, Instagram, TikTok. A tap sets an X; a long press
removes it.

- Works offline. Changes sync when the device is back online, and edits made on several
  devices at once are merged field by field.
- No login. A list has an ID like `brave-otter-harbor`; open the same ID on another device
  to use the same list. Anyone who knows the ID can see and edit the list. The address
  always ends in `#<list-id>`, so it doubles as a share link, and bookmarks keep the list.
- CSV export (it syncs first, and still saves the file if the sync fails) and CSV import.
- Installs on the iPhone home screen. The UI is German on German devices, English
  everywhere else.

## Run it

Requirements: Go 1.27+, Node.js 24+.

```sh
make install   # npm install + go mod download
make start     # builds, then serves app and API on http://localhost:8787
```

`make start` runs the same single binary as production: the frontend is embedded in it,
and the data goes to `data/post-checklist.db`.

## Develop

```sh
make dev       # Vite on http://localhost:5173 (hot reload) + Go API on :8787
```

Vite proxies `/api` to the Go server, which uses `data/dev.db`. The service worker is only
registered in production builds, so use `make start` to try offline behavior.

## Test

```sh
make test      # unit tests: Vitest (web) and go test (server)
make e2e       # builds, then runs Playwright against the binary
```

The end-to-end tests run in desktop Chrome, Android Chrome and iPhone WebKit. They need
Google Chrome installed, and once `cd web && npx playwright install webkit`.

## Try it on an iPhone

The service worker, the share sheet and the clipboard only work over HTTPS, so a LAN URL
like `http://192.168.x.x:8787` is not enough. The simplest way is Tailscale, with the
Tailscale app on the phone:

```sh
make start
tailscale serve --bg --https=8787 8787   # https://<this-mac>.<tailnet>.ts.net:8787, tailnet only
tailscale serve --https=8787 off         # stop sharing
```

The separate HTTPS port leaves other `tailscale serve` setups on port 443 alone. Open the
URL in Safari, then Share → Add to Home Screen. iOS gives home screen apps their own
storage, separate from Safari's; the app still opens the same list, because the list ID
travels in its start address.

## Configuration

| Flag           | Environment   | Default                  |
| -------------- | ------------- | ------------------------ |
| `-addr`        | `ADDR`        | `:8787`                  |
| `-db`          | `DB_PATH`     | `data/post-checklist.db` |
| `-trust-proxy` | `TRUST_PROXY` | `false`                  |
| `-rate-limit`  | `RATE_LIMIT`  | `true`                   |

The rate limit allows each client bursts of 60 API requests, then one per second, which
slows down anyone guessing list IDs; normal use stays far below it. Behind a reverse proxy
that sets `X-Forwarded-For`, turn on `-trust-proxy` so clients are told apart by their own
address rather than the proxy's.

The database runs in WAL mode. To back it up while the server runs, use
`sqlite3 data/post-checklist.db ".backup backup.db"` rather than copying the file.

The server logs API requests by route pattern only: list IDs work like passwords and
never appear in the log.

## Deploy

Production: https://checklist.tüdelü.com (`checklist.xn--tdel-0rad.com`), on the server
`manuelbieh.online`.

```sh
make deploy                 # HOST=other.host for another server
```

`make deploy` builds the frontend and a Linux binary, installs it as
`/opt/post-checklist/post-checklist` with the systemd unit from
`deploy/post-checklist.service`, restarts it and waits until it answers. The service runs
as its own `post-checklist` user, listens on `172.18.0.1:8787` (the Docker bridge: the
Caddy container reaches it, the internet doesn't) and keeps its database in
`/var/lib/post-checklist/`. Logs: `journalctl -u post-checklist`.

HTTPS comes from the Caddy container `ship-caddy`, which also serves the other sites on
the server. Its configuration, `/opt/ship/Caddyfile`, is maintained by hand; the block for
this app is in `deploy/Caddyfile`. To change it, save a dated copy
(`Caddyfile.bak-YYYYMMDD-HHMMSS`), overwrite the file's content (it is bind-mounted as a
single file, so replacing the file itself would go unnoticed by the container), then:

```sh
sudo docker exec ship-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo docker exec ship-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

`/opt/ship/provision.sh` writes a fresh Caddyfile; after running it, add this block (and
the curb block) again.

Keep the Cloudflare record "DNS only". Caddy gets and renews the certificate through the
HTTP challenge on the server, and the rate limit needs to see the real client addresses;
behind Cloudflare's proxy it would only see Cloudflare's.

Backups: every device keeps a full copy of its lists and uploads everything again after
a server restart (see docs/design.md), so a lost or restored database refills itself. For
a file copy, stop the service and copy `/var/lib/post-checklist/`, or export CSV in the app.

## CSV

Export writes UTF-8 with a byte order mark (so Excel shows umlauts correctly),
comma-separated, with the header `No,Venue,Instagram,TikTok` and `y`/`n` values.

Import is lenient, so edited or older files work too:

- comma, semicolon or tab separated; UTF-8 or Windows-1252 (German Excel)
- English or German headers (`Venue`, `Restaurant`, `Location`, `Insta`, …), or no header
- a mark counts as set for `y`, `yes`, `x`, `1`, `true`, `ja`, `✓`

An import into an empty list adds the rows directly; otherwise the app asks whether to add
them or replace the list.

## Layout

```
docs/design.md   design, data model and sync protocol
design/          app icon sources (generated with Codex; the alternative is kept too)
server/          Go: API, SQLite store, static file server with the embedded frontend
web/src/         React app; web/src/lib holds the logic (sync, merge, CSV), with unit tests
web/plugins/     Vite plugin that generates the service worker
web/e2e/         Playwright tests
```

How the sync works (hybrid logical clock timestamps, per-field last-writer-wins, a
server-side change counter) is described in [docs/design.md](docs/design.md).
