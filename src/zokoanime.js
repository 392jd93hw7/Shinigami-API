const PLAYER_CONFIG_KEY = Buffer.from("otaku-embed-v1", "utf8");

export function extractPlayerConfig(html) {
  const match = html.match(/window\.__P\s*=\s*(["'])([\s\S]*?)\1\s*;?/);
  if (!match) {
    throw new Error("ZokoAnime player configuration window.__P was not found.");
  }

  const encoded = match[2];
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("ZokoAnime player configuration is not valid Base64 data.");
  }

  const encrypted = Buffer.from(encoded, "base64");
  const decoded = Buffer.allocUnsafe(encrypted.length);

  for (let i = 0; i < encrypted.length; i += 1) {
    decoded[i] = encrypted[i] ^ PLAYER_CONFIG_KEY[i % PLAYER_CONFIG_KEY.length];
  }

  let config;
  try {
    config = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error("ZokoAnime player configuration could not be decoded as JSON.");
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("ZokoAnime player configuration has an unexpected format.");
  }

  return config;
}

export function inspectPlayerHtml(html, pageUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .trim() || null;

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
    hasPlayerConfig: /window\.__P\s*=/.test(html),
    scripts: scriptSources
  };
}

function parseAttributeList(input) {
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/g;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const raw = match[2].trim();
    attributes[match[1]] = raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1).replace(/\\"/g, '"')
      : raw;
  }

  return attributes;
}

export function parseHlsMasterPlaylist(text, playlistUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const variants = [];
  const audioTracks = [];
  const subtitleTracks = [];
  let pendingVariant = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributeList(line.slice("#EXT-X-MEDIA:".length));
      const track = {
        groupId: attrs["GROUP-ID"] || null,
        name: attrs.NAME || attrs.LANGUAGE || "Unknown",
        language: attrs.LANGUAGE || null,
        default: attrs.DEFAULT === "YES",
        autoselect: attrs.AUTOSELECT === "YES",
        channels: attrs.CHANNELS || null,
        url: attrs.URI ? new URL(attrs.URI, playlistUrl).toString() : null
      };

      if (attrs.TYPE === "AUDIO") audioTracks.push(track);
      if (attrs.TYPE === "SUBTITLES") subtitleTracks.push(track);
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingVariant = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
    } else if (!line.startsWith("#") && pendingVariant) {
      variants.push({
        url: new URL(line, playlistUrl).toString(),
        bandwidth: Number(pendingVariant.BANDWIDTH) || null,
        averageBandwidth: Number(pendingVariant["AVERAGE-BANDWIDTH"]) || null,
        resolution: pendingVariant.RESOLUTION || null,
        codecs: pendingVariant.CODECS || null,
        audioGroup: pendingVariant.AUDIO || null,
        subtitleGroup: pendingVariant.SUBTITLES || null
      });
      pendingVariant = null;
    }
  }

  const codecs = variants.map((variant) => variant.codecs || "").join(",").toLowerCase();
  const audioCodecDetected = /mp4a|aac|ac-3|ec-3|opus|mp3/.test(codecs);

  return {
    isMasterPlaylist: variants.length > 0 || audioTracks.length > 0 || subtitleTracks.length > 0,
    variants,
    audioTracks,
    subtitleTracks,
    audioStatus: audioTracks.length > 0
      ? "separate-renditions-found"
      : audioCodecDetected
        ? "audio-codec-advertised-in-variant"
        : "not-determined-from-master-playlist"
  };
}

function isAllowedManifestUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const suffixes = (process.env.MEDIA_HOST_ALLOWLIST || "dramahot.top")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase())
    .filter(Boolean);
  const hostname = url.hostname.toLowerCase();

  return suffixes.some((suffix) =>
    hostname === suffix || hostname.endsWith("." + suffix)
  );
}

export async function fetchAndInspectMasterPlaylist(url) {
  if (!url) return { fetched: false, reason: "missing_manifest_url" };

  if (!isAllowedManifestUrl(url)) {
    return { fetched: false, reason: "manifest_host_not_allowlisted" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; ShinigamiAPI/1.0)",
        "accept": "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
        "referer": "https://zokoanime.video/"
      }
    });

    if (!response.ok) {
      return {
        fetched: false,
        status: response.status,
        reason: "manifest_request_failed"
      };
    }

    const body = await response.text();

    if (!body.trimStart().startsWith("#EXTM3U")) {
      return {
        fetched: false,
        status: response.status,
        reason: "response_is_not_an_hls_playlist"
      };
    }

    return {
      fetched: true,
      status: response.status,
      contentType: response.headers.get("content-type") || null,
      ...parseHlsMasterPlaylist(body, response.url || url)
    };
  } catch (error) {
    return {
      fetched: false,
      reason: error?.name === "AbortError" ? "manifest_timeout" : "manifest_fetch_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
