# Shinigami API

A Node.js API with a built-in developer website and interactive endpoint playground. It extracts the player configuration from the authorized ZokoAnime episode route, inspects its HLS master playlist, and exposes a signed HLS/media proxy.

## Requirements

- Node.js 20+

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

The development proxy creates a temporary signing secret automatically when `PROXY_SIGNING_SECRET` is not set. This makes generated proxy links valid only until the server restarts.

For production, configure a persistent secret of at least 32 bytes:

```bash
openssl rand -hex 32
```

Set the generated value as `PROXY_SIGNING_SECRET`. Also set `PUBLIC_BASE_URL` to the public HTTPS origin of this API when deploying behind a reverse proxy.

## Developer website

Open the API root (`/`) in your browser for the Shinigami API documentation website and interactive playground. The playground can call the configured API base URL, test the health and ZokoAnime extraction routes, and send GET or HEAD requests to a signed proxy URL. When deployed, the website is served by the same Express server; no separate frontend deployment is required.

## Endpoints

### Health

```http
GET /health
```

### Extract episode playback data

```http
GET /api/zokoanime/stream/:malId/:episode/:mode
```

Example:

```http
GET /api/zokoanime/stream/64340/6/sub
```

The endpoint:

1. Requests the matching ZokoAnime `/stream/mal/:malId/:episode/:mode` page.
2. Extracts and decodes its `window.__P` player configuration.
3. Returns the original HLS master playlist URL and a signed `playback.hlsProxyUrl`.
4. Returns video variants, audio renditions, and subtitle tracks with signed proxy URLs.
5. Inspects the master playlist for video variants and separate audio renditions.

### Signed HLS/media proxy

```http
GET /api/proxy/:signedToken
HEAD /api/proxy/:signedToken
```

The proxy:

- Validates a signed, expiring token before fetching a media URL.
- Allows HTTPS destinations only on hosts listed in `MEDIA_HOST_ALLOWLIST`.
- Re-validates every redirect and limits redirect depth.
- Rewrites nested HLS variant playlists, audio playlist URIs, subtitle playlist URIs, encryption-key URIs, and initialization-map URIs back through this API.
- Streams media segments and subtitle files without buffering the full file.
- Forwards byte-range requests for HLS segments.

Use `playback.hlsProxyUrl` as the HLS player source. Since the master playlist is rewritten, audio rendition selection remains available through the HLS player. Use the individual subtitle `proxyUrl` values for subtitle tracks exposed separately in the player configuration.

The proxy does not transcode or repair media. A playlist can advertise an audio rendition even if its audio segments later fail; playback must still be tested end-to-end.

### Optional raw HTML

Append `?includeRaw=1` to the extraction endpoint to include the full upstream HTML for debugging. The normal response omits the large encoded player payload.

## Media host allowlist

Default:

```env
MEDIA_HOST_ALLOWLIST=dramahot.top
```

Use comma-separated domain suffixes only for additional media hosts that you are authorized to proxy. The proxy rejects non-HTTPS URLs and rechecks redirected destinations.

## Environment

See `.env.example` for configuration.

## Tests

```bash
npm test
```

## Deploying

The server listens on `0.0.0.0` and uses the `PORT` environment variable.
