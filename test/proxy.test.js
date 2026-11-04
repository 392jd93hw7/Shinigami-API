import test from "node:test";
import assert from "node:assert/strict";

process.env.MEDIA_HOST_ALLOWLIST = "dramahot.top";
process.env.PROXY_SIGNING_SECRET = "test-secret-that-is-at-least-32-bytes-long";

const {
  createProxyUrl,
  isAllowedMediaUrl,
  rewriteHlsPlaylist,
  verifyProxyToken
} = await import("../src/proxy.js");

test("only allows HTTPS media URLs on configured host suffixes", () => {
  assert.equal(
    isAllowedMediaUrl("https://hls.dramahot.top/master.m3u8"),
    true
  );
  assert.equal(
    isAllowedMediaUrl("https://dramahot.top/video/segment.ts"),
    true
  );
  assert.equal(
    isAllowedMediaUrl("https://notdramahot.top/master.m3u8"),
    false
  );
  assert.equal(
    isAllowedMediaUrl("http://hls.dramahot.top/master.m3u8"),
    false
  );
});

test("creates signed proxy URLs and verifies their destination", () => {
  const proxyUrl = createProxyUrl(
    "https://hls.dramahot.top/master.m3u8",
    "https://api.example.test"
  );
  const token = new URL(proxyUrl).pathname.split("/").pop();

  assert.match(proxyUrl, /^https:\/\/api\.example\.test\/api\/proxy\//);
  assert.equal(
    verifyProxyToken(token),
    "https://hls.dramahot.top/master.m3u8"
  );
  assert.throws(
    () => verifyProxyToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A")),
    /signature/
  );
});

test("rewrites HLS variant and audio URI references to signed proxy URLs", () => {
  const master = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",URI="aud/ja/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,AUDIO="aud"',
    "video/720p/index.m3u8"
  ].join("\n");

  const rewritten = rewriteHlsPlaylist(
    master,
    "https://hls.dramahot.top/path/master.m3u8",
    "https://api.example.test"
  );

  const tokens = [...rewritten.matchAll(/\/api\/proxy\/([^"\n]+)/g)]
    .map((match) => match[1]);

  assert.equal(tokens.length, 2);
  assert.deepEqual(
    tokens.map((token) => verifyProxyToken(token)),
    [
      "https://hls.dramahot.top/path/aud/ja/index.m3u8",
      "https://hls.dramahot.top/path/video/720p/index.m3u8"
    ]
  );
});

test("refuses to rewrite a playlist reference to a non-allowlisted host", () => {
  const playlist = [
    "#EXTM3U",
    "#EXTINF:4.0,",
    "https://untrusted.example/segment.ts"
  ].join("\n");

  assert.throws(
    () => rewriteHlsPlaylist(
      playlist,
      "https://hls.dramahot.top/master.m3u8",
      "https://api.example.test"
    ),
    /MEDIA_HOST_ALLOWLIST/
  );
});
