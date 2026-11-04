import express from "express";
import cors from "cors";
import {
  extractPlayerConfig,
  inspectPlayerHtml,
  fetchAndInspectMasterPlaylist
} from "./zokoanime.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_BASE = "https://zokoanime.video";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Shinigami API",
    status: "ok",
    endpoints: {
      health: "/health",
      inspect: "/api/zokoanime/stream/:malId/:episode/:mode"
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({ success: true, status: "healthy" });
});

app.get("/api/zokoanime/stream/:malId/:episode/:mode", async (req, res) => {
  const { malId, episode, mode } = req.params;

  if (!/^[0-9]+$/.test(malId) || !/^[0-9]+$/.test(episode)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_PARAMETERS",
      message: "malId and episode must contain digits only."
    });
  }

  if (Number(malId) <= 0 || Number(episode) <= 0) {
    return res.status(400).json({
      success: false,
      error: "INVALID_PARAMETERS",
      message: "malId and episode must be positive integers."
    });
  }

  if (!["sub", "dub"].includes(mode)) {
    return res.status(400).json({
      success: false,
      error: "INVALID_MODE",
      message: "mode must be either sub or dub."
    });
  }

  const upstreamUrl = new URL(
    "/stream/mal/" + malId + "/" + episode + "/" + mode,
    UPSTREAM_BASE
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ShinigamiAPI/1.0)",
        "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "referer": UPSTREAM_BASE + "/"
      }
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "";
    const finalUrl = upstream.url || upstreamUrl.toString();
    const page = inspectPlayerHtml(body, finalUrl);

    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        error: "UPSTREAM_BAD_STATUS",
        request: { malId: Number(malId), episode: Number(episode), mode },
        upstream: {
          url: finalUrl,
          status: upstream.status,
          statusText: upstream.statusText,
          contentType
        },
        page
      });
    }

    let playerConfig;
    try {
      playerConfig = extractPlayerConfig(body);
    } catch (error) {
      return res.status(422).json({
        success: false,
        error: "PLAYER_CONFIG_EXTRACTION_FAILED",
        message: error.message,
        request: { malId: Number(malId), episode: Number(episode), mode },
        upstream: {
          url: finalUrl,
          status: upstream.status,
          statusText: upstream.statusText,
          contentType
        },
        page,
        ...(req.query.includeRaw === "1" ? { rawBody: body } : {})
      });
    }

    const masterPlaylistUrl = typeof playerConfig.src === "string"
      ? playerConfig.src
      : null;
    const manifest = await fetchAndInspectMasterPlaylist(masterPlaylistUrl);
    const subtitleTracks = Array.isArray(playerConfig.subtitles)
      ? playerConfig.subtitles.map((track, index) => ({
          id: "subtitle-" + index,
          language: track.lang || null,
          label: track.label || track.lang || "Unknown",
          default: Boolean(track.default),
          url: track.src || null
        }))
      : [];

    let audioDetected = null;
    if (manifest.fetched) {
      if (manifest.audioTracks.length > 0 ||
          manifest.audioStatus === "audio-codec-advertised-in-variant") {
        audioDetected = true;
      } else if (manifest.audioStatus !== "not-determined-from-master-playlist") {
        audioDetected = false;
      }
    }

    const result = {
      success: true,
      request: {
        malId: Number(malId),
        episode: Number(episode),
        mode
      },
      upstream: {
        url: finalUrl,
        status: upstream.status,
        statusText: upstream.statusText,
        ok: upstream.ok,
        contentType,
        isJson: contentType.includes("application/json"),
        isHtml: contentType.includes("text/html")
      },
      page,
      playback: {
        format: "hls",
        masterPlaylistUrl,
        posterUrl: playerConfig.poster || null,
        spriteVttUrl: playerConfig.sprite_vtt || null,
        manifest,
        videoVariants: manifest.variants || [],
        audio: {
          defaultLanguage: playerConfig.default_audio || null,
          tracks: manifest.audioTracks || [],
          status: manifest.fetched
            ? manifest.audioStatus
            : "not-inspected"
        },
        subtitles: {
          count: subtitleTracks.length,
          tracks: subtitleTracks,
          hlsRenditions: manifest.subtitleTracks || []
        }
      },
      playerSettings: {
        engine: playerConfig.player?.engine || null,
        defaultQuality: playerConfig.player?.default_quality || null,
        autoplay: Boolean(playerConfig.autoplay),
        muted: Boolean(playerConfig.muted),
        resume: Boolean(playerConfig.resume),
        startTime: Number(playerConfig.start_time) || 0,
        autoSkip: Boolean(playerConfig.auto_skip),
        autoNext: Boolean(playerConfig.auto_next)
      },
      diagnostics: {
        videoDetected: Boolean(masterPlaylistUrl),
        audioDetected,
        subtitleDetected: subtitleTracks.length > 0,
        subtitleCount: subtitleTracks.length,
        manifestFetched: Boolean(manifest.fetched)
      }
    };

    if (req.query.includeRaw === "1") {
      result.rawBody = body;
    }

    return res.status(200).json(result);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return res.status(timedOut ? 504 : 502).json({
      success: false,
      error: timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_REQUEST_FAILED",
      message: timedOut
        ? "ZokoAnime did not respond within 25 seconds."
        : "Could not retrieve the ZokoAnime response.",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "NOT_FOUND",
    path: req.path
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Shinigami API listening on port " + PORT);
});
