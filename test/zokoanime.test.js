import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPlayerConfig,
  parseHlsMasterPlaylist
} from "../src/zokoanime.js";

function encodePlayerConfig(config) {
  const plain = Buffer.from(JSON.stringify(config), "utf8");
  const key = Buffer.from("otaku-embed-v1", "utf8");
  const encrypted = Buffer.alloc(plain.length);

  for (let i = 0; i < plain.length; i += 1) {
    encrypted[i] = plain[i] ^ key[i % key.length];
  }

  return encrypted.toString("base64");
}

test("extracts the player JSON from window.__P", () => {
  const encoded = encodePlayerConfig({
    src: "https://hls.dramahot.top/master.m3u8",
    default_audio: "Japanese",
    subtitles: [{ lang: "en", label: "English", src: "https://media.test/en.vtt" }]
  });
  const html = '<script>window.__P="' + encoded + '"</script>';

  const result = extractPlayerConfig(html);

  assert.equal(result.src, "https://hls.dramahot.top/master.m3u8");
  assert.equal(result.default_audio, "Japanese");
  assert.equal(result.subtitles.length, 1);
});

test("rejects missing player configuration", () => {
  assert.throws(
    () => extractPlayerConfig("<html><body>no config</body></html>"),
    /window\.__P/
  );
});

test("parses HLS variant, audio and subtitle renditions", () => {
  const playlist = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="audio/ja.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="subs/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"',
    "video/720p.m3u8"
  ].join("\n");

  const result = parseHlsMasterPlaylist(
    playlist,
    "https://hls.dramahot.top/master.m3u8"
  );

  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].resolution, "1280x720");
  assert.equal(result.audioTracks[0].language, "ja");
  assert.equal(
    result.audioTracks[0].url,
    "https://hls.dramahot.top/audio/ja.m3u8"
  );
  assert.equal(result.subtitleTracks[0].language, "en");
  assert.equal(result.audioStatus, "separate-renditions-found");
});
