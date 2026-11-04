import express from "express";
import cors from "cors";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const UPSTREAM_BASE = "https://zokoanime.video";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

function inspectPlayerHtml(html, pageUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim() || null;

  const configMatch = html.match(/window\.__P\s*=\s*(["'])([\s\S]*?)\1\s*;?/);
  const scriptSources = [];
  const scriptRegex = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let scriptMatch;

  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    try {
      scriptSources.push(new URL(scriptMatch[1], pageUrl).toString());
    } catch {
      scriptSources.push(scriptMatch[1]);
    }
  }

  return {
    title,
    hasPlayerContainer: /id=["']player["']/i.test(html),
    hasPlayerConfig: Boolean(configMatch),
    playerConfig: configMatch
      ? {
          variable: "window.__P",
          valueLength: configMatch[2].length,
          representation: "opaque string; decoding format not verified"
        }
      : null,
    scripts: scriptSources
  };
}

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
    const page = inspectPlayerHtml(body, upstream.url || upstreamUrl.toString());

    const result = {
      success: true,
      request: {
        malId: Number(malId),
        episode: Number(episode),
        mode
      },
      upstream: {
        url: upstream.url,
        status: upstream.status,
        statusText: upstream.statusText,
        ok: upstream.ok,
        contentType,
        isJson: contentType.includes("application/json"),
        isHtml: contentType.includes("text/html")
      },
      page
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
