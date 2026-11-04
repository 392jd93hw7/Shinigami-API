import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { Readable } from "node:stream";

const DEFAULT_TTL_SECONDS = 60 * 60;
const MAX_REDIRECTS = 4;
let developmentSecret;

function getSigningSecret() {
  const configured = process.env.PROXY_SIGNING_SECRET;

  if (configured) {
    if (Buffer.byteLength(configured) < 32) {
      throw new Error("PROXY_SIGNING_SECRET must contain at least 32 bytes.");
    }
    return Buffer.from(configured, "utf8");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PROXY_SIGNING_SECRET must be configured in production.");
  }

  if (!developmentSecret) {
    developmentSecret = randomBytes(32);
    console.warn(
      "WARNING: using a temporary development proxy secret; proxy URLs expire when this process restarts."
    );
  }

  return developmentSecret;
}

export function isAllowedMediaUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const suffixes = (process.env.MEDIA_HOST_ALLOWLIST || "dramahot.top")
    .split(",")
    .map((suffix) => suffix.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);

  const hostname = url.hostname.toLowerCase();
  return suffixes.some((suffix) =>
    hostname === suffix || hostname.endsWith("." + suffix)
  );
}

function assertAllowedMediaUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid media URL.");
  }

  if (!isAllowedMediaUrl(url.href)) {
    throw new Error("Media URL host is not in MEDIA_HOST_ALLOWLIST.");
  }

  return url;
}

function signPayload(payload) {
  return createHmac("sha256", getSigningSecret())
    .update(payload)
    .digest("base64url");
}

export function createProxyUrl(targetUrl, publicBaseUrl, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const target = assertAllowedMediaUrl(targetUrl);
  const payload = Buffer.from(JSON.stringify({
    url: target.href,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds
  }), "utf8").toString("base64url");

  const signature = signPayload(payload);
  const base = new URL(publicBaseUrl);

  return new URL("/api/proxy/" + payload + "." + signature, base.origin).toString();
}

export function verifyProxyToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    throw new Error("Invalid proxy token.");
  }

  const payload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = signPayload(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);

  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Invalid proxy signature.");
  }

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid proxy token payload.");
  }

  if (!data || typeof data.url !== "string" ||
      !Number.isInteger(data.expiresAt) || data.expiresAt <= nowSeconds) {
    throw new Error("Proxy token has expired or is invalid.");
  }

  return assertAllowedMediaUrl(data.url).href;
}

export async function fetchAllowedMedia(url, options = {}) {
  let current = assertAllowedMediaUrl(url);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current.href, {
      ...options,
      redirect: "manual"
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});

    if (!location) {
      throw new Error("Media server returned a redirect without a Location header.");
    }

    current = assertAllowedMediaUrl(new URL(location, current).href);

    if (redirects === MAX_REDIRECTS) {
      throw new Error("Media server exceeded the redirect limit.");
    }
  }

  throw new Error("Media server redirect failed.");
}

export function rewriteHlsPlaylist(playlistText, playlistUrl, publicBaseUrl) {
  const lines = playlistText.split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith("#")) {
      return line.replace(/(URI=)(["'])(.*?)\2/g, (_match, prefix, quote, value) => {
        if (/^(data:|skd:)/i.test(value)) {
          return prefix + quote + value + quote;
        }

        const absoluteUrl = new URL(value, playlistUrl).href;
        return prefix + quote +
          createProxyUrl(absoluteUrl, publicBaseUrl) +
          quote;
      });
    }

    const absoluteUrl = new URL(trimmed, playlistUrl).href;
    return createProxyUrl(absoluteUrl, publicBaseUrl);
  }).join("\n");
}

function copySafeResponseHeaders(upstream, res) {
  const contentType = upstream.headers.get("content-type");
  if (contentType) res.setHeader("Content-Type", contentType);

  for (const header of [
    "accept-ranges",
    "content-range",
    "etag",
    "last-modified",
    "cache-control"
  ]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
}

function publicBaseUrlForRequest(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return new URL(process.env.PUBLIC_BASE_URL).origin;
  }

  return req.protocol + "://" + req.get("host");
}

export async function proxyMediaRequest(req, res) {
  let targetUrl;

  try {
    targetUrl = verifyProxyToken(req.params.token);
  } catch (error) {
    return res.status(403).json({
      success: false,
      error: "INVALID_OR_EXPIRED_PROXY_TOKEN",
      message: error.message
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  req.on("aborted", () => controller.abort());
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const requestHeaders = {
      "user-agent": "Mozilla/5.0 (compatible; ShinigamiAPI/1.0)",
      "accept": req.get("accept") || "*/*",
      "referer": "https://zokoanime.video/"
    };

    const range = req.get("range");
    const ifRange = req.get("if-range");
    if (range) requestHeaders.range = range;
    if (ifRange) requestHeaders["if-range"] = ifRange;

    const upstream = await fetchAllowedMedia(targetUrl, {
      method: req.method,
      headers: requestHeaders,
      signal: controller.signal
    });

    copySafeResponseHeaders(upstream, res);

    const upstreamType = (upstream.headers.get("content-type") || "").toLowerCase();
    const isLikelyPlaylist = targetUrl.toLowerCase().split("?")[0].endsWith(".m3u8") ||
      upstreamType.includes("mpegurl");

    if (req.method === "GET" && isLikelyPlaylist) {
      const body = await upstream.text();

      if (body.trimStart().startsWith("#EXTM3U")) {
        let rewritten;

        try {
          rewritten = rewriteHlsPlaylist(
            body,
            targetUrl,
            publicBaseUrlForRequest(req)
          );
        } catch (error) {
          return res.status(502).json({
            success: false,
            error: "PLAYLIST_REWRITE_FAILED",
            message: error.message
          });
        }

        res.status(upstream.status);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Cache-Control", "public, max-age=30");
        res.removeHeader("Content-Length");
        return res.send(rewritten);
      }

      res.status(upstream.status);
      return res.send(body);
    }

    res.status(upstream.status);

    if (req.method === "HEAD" || !upstream.body) {
      return res.end();
    }

    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: "MEDIA_STREAM_FAILED",
          message: "The upstream media stream could not be read."
        });
      } else {
        res.destroy(error);
      }
    });
    return stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      const timedOut = error?.name === "AbortError";
      return res.status(timedOut ? 504 : 502).json({
        success: false,
        error: timedOut ? "MEDIA_PROXY_TIMEOUT" : "MEDIA_PROXY_FAILED",
        message: timedOut
          ? "The upstream media request timed out."
          : "The upstream media request failed.",
        details: process.env.NODE_ENV === "development" ? error.message : undefined
      });
    }

    return res.destroy(error);
  } finally {
    clearTimeout(timeout);
  }
}
