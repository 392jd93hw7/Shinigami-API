import test from "node:test";
import assert from "node:assert/strict";
import { parseHlsMasterPlaylist } from "../src/zokoanime.js";

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
