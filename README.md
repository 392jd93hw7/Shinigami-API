# Shinigami API

A Node.js API for inspecting the public ZokoAnime episode player page.

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

### Inspect a ZokoAnime player page

```http
GET /api/zokoanime/stream/:malId/:episode/:mode
```

Example:

```http
GET /api/zokoanime/stream/64340/6/sub
```

This requests the matching ZokoAnime route and returns JSON containing the upstream status, response content type, page title, player-container detection, external script URLs, and whether the page includes a `window.__P` configuration string. The configuration value is treated as opaque; its encoding is not assumed or decoded.

Append `?includeRaw=1` to include the complete upstream HTML for debugging. The default response omits the large HTML body.

This inspection endpoint does not extract media URLs or proxy media.

## Deploying

The server listens on `0.0.0.0` and uses the `PORT` environment variable.
