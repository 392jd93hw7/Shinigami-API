# Shinigami API

A Node.js API for inspecting responses from the ZokoAnime episode stream route.

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

### Inspect the upstream ZokoAnime response

```http
GET /api/zokoanime/stream/:malId/:episode/:mode
```

Example: `GET /api/zokoanime/stream/64340/6/sub`

This calls `https://zokoanime.video/stream/mal/64340/6/sub` and returns the upstream status, final URL, content type, and raw response body inside JSON. The upstream body may be HTML; this endpoint does not assume it is JSON, and does not decode or proxy media.

## Deploying

The server listens on `0.0.0.0` and uses the `PORT` environment variable.
