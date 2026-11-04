# Shinigami API

A Node.js API that extracts the player configuration from the authorized ZokoAnime episode route and inspects its HLS master playlist.

## Requirements

- Node.js 20+

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

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
3. Returns the HLS master playlist URL.
4. Returns the subtitle tracks supplied in the player configuration.
5. Fetches and inspects the HLS master playlist for video variants, separate audio renditions, and HLS subtitle renditions.

The player configuration decoder uses the format verified against the supplied player response. The API does not assume every episode has separate audio renditions: it reports the master-playlist evidence and the configured default audio language independently.

### Optional raw HTML

Append `?includeRaw=1` to include the complete upstream HTML for debugging. The normal response does not include the large encoded player payload.

## HLS manifest host allowlist

For safety, the API only fetches HLS master playlists from hosts matching `MEDIA_HOST_ALLOWLIST`.

Default:

```env
MEDIA_HOST_ALLOWLIST=dramahot.top
```

Use comma-separated domain suffixes if the authorized provider changes its media host, for example:

```env
MEDIA_HOST_ALLOWLIST=dramahot.top,example-media-host.test
```

Only HTTPS manifest URLs are fetched.

## Tests

```bash
npm test
```

## Deploying

The server listens on `0.0.0.0` and uses the `PORT` environment variable.
