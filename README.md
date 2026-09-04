# 🩸 Slasher Archive

[![Build and Publish Docker Image](https://github.com/siahmurph/slasher-archive/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/siahmurph/slasher-archive/actions/workflows/docker-publish.yml)

A horror film discovery engine for people who run their own media stack. Search
TMDb, see at a glance what you already own in **Emby** and what is already queued
in **Radarr**, and push new films straight into Radarr in one click.

---

## Features

- **Discovery filters** — text search, release-date range, minimum runtime,
  minimum vote count, original language, and tri-state genre chips (click once
  to include, again to exclude, again to clear; **Apply** commits them).
  The vote-count floor is what keeps obscure never-distributed titles out —
  they carry real release dates and runtimes, so no other filter catches them.
- **Library awareness** — connect Emby and Radarr and every card is labelled
  *In Library* or *Requested*. Filter to hide what you already have.
- **One-click Radarr import** — pick a root folder and quality profile once,
  then add films from the detail view with a search triggered automatically.
- **Hide films** you never want to see again, with a toggle to reveal and
  unhide them.
- **Filters persist** across reloads; sidebar state, hidden films and theme are
  remembered per browser.
- **Light and dark themes** — follows your OS by default, with an Auto /
  Light / Dark toggle in the header.

---

## Configuration and secrets

All credentials are held **server-side** in `config.json` inside the config
directory. They are used by the server's own proxy routes and are **never sent
to the browser** — `GET /api/config` returns only whether each key is set.

`config.json` stores these keys in plaintext. Two consequences worth knowing:

- Keep the host config directory off any share that is backed up somewhere less
  trusted than the host itself.
- `config/` is gitignored. Do not commit it.

The app has no authentication of its own, and anyone who can reach it can use
its Radarr and Emby proxy routes. Keep it on a trusted network, or put it
behind your reverse proxy's auth.

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8080` | HTTP listen port |
| `CONFIG_DIR` | `./config` (`/config` in the image) | Where `config.json` is written |
| `UPSTREAM_TIMEOUT_MS` | `15000` | Timeout for Radarr / Emby / TMDb calls |

---

## Running locally

```bash
git clone https://github.com/siahmurph/slasher-archive.git
cd slasher-archive
npm ci --omit=dev
npm start
```

Open <http://localhost:8080> and add your TMDb API key in **Settings**.

---

## Running with Docker

```bash
docker compose up -d
```

The bundled `docker-compose.yml` pulls the published image. To build from
source instead, replace the `image:` line with `build: .`.

### Stack

```yaml
services:
  slasher-archive:
    image: ghcr.io/siahmurph/slasher-archive:2.0.0
    container_name: slasher-archive
    restart: unless-stopped
    ports:
      - "8383:8080"
    environment:
      - PORT=8080
      - CONFIG_DIR=/config
    volumes:
      # Required. Without it your settings are lost on every container recreate.
      - /opt/appdata/slasher-archive:/config
```

Then open `http://<host>:8383`.

Images are published for `linux/amd64` and `linux/arm64`.

### Image tags

| Tag | Points at |
| :--- | :--- |
| `2.0.0` | That exact release |
| `2.0`, `2` | Newest release in that line |
| `sha-a1b2c3d` | One specific `main` commit |
| `latest` | Whatever `main` built most recently |

`latest` follows `main`, not releases — so an unreviewed commit is one
`docker compose pull` away from your stack. Pin to a version in anything you
actually run.

Releases are cut by pushing a tag:

```bash
git tag -a v2.1.0 -m "v2.1.0" && git push origin v2.1.0
```

> [!IMPORTANT]
> **Upgrading from v1.x — three breaking changes:**
>
> 1. The config path inside the container moved from `/app/config` to
>    `/config`, so it can no longer be served as a static asset. Change your
>    volume's container side to `:/config`. The host side is unchanged, so your
>    existing `config.json` carries over.
> 2. The container now listens on **8080**, not 80, because it runs as a
>    non-root user. Change your port mapping to `8383:8080` and set `PORT=8080`.
> 3. Because v1 served the config directory as static files, your TMDb, Radarr
>    and Emby keys were reachable at `/config/config.json` by anyone who could
>    load the page. **Rotate all three keys after upgrading.**

### Config directory permissions

The container runs as uid **1000** (`node`), not root. A bind mount keeps the
host's ownership, so a `root`-owned directory leaves settings unsaveable with
`EACCES: permission denied`. Once, on the Docker host:

```bash
chown -R 1000:1000 /opt/appdata/slasher-archive
```

Existing files are preserved. The server checks this at startup and prints the
exact command if the directory is not writable; `GET /healthz` reports it as
`configWritable`.

---

## Connecting the services

**TMDb** — create a free account and copy the v3 API key from
*Settings → API*. Required; nothing works without it.

**Radarr** — *Settings → General → Security → API Key*. Paste it with your
server URL, click **Connect to Radarr**, then choose a root folder and quality
profile and **Save Settings**.

**Emby** — *Dashboard → Advanced → API Keys*. Used read-only, to mark which
films you already own.

---

## API

| Route | Purpose |
| :--- | :--- |
| `GET /healthz` | Liveness plus which integrations are configured |
| `GET /api/config` | Connection status — never returns key values |
| `POST /api/config` | Save settings; a blank secret leaves the stored one intact |
| `DELETE /api/config/:key` | Clear one stored secret |
| `GET /api/tmdb/*` | Cached TMDb proxy, restricted to an endpoint allowlist |
| `ALL /api/radarr/*` | Radarr v3 proxy, target read from server config only |
| `GET /api/emby/image/:id` | Streams artwork straight from Emby for library views |
| `ALL /api/emby/*` | Emby proxy, target read from server config only |

---

## Project layout

```text
server.js          Express server: config store, TMDb/Radarr/Emby proxies
public/            Everything served to the browser
  index.html
  app.js
  styles.css
config/            Runtime config.json (gitignored, volume-mounted in Docker)
```

The split matters: only `public/` is served statically, which is what keeps
`config.json` unreachable over HTTP.

---

## License

MIT.
