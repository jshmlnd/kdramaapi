import { fetchPage, parseListPage, parseSeriesPage, SITE } from "./scraper.js";
import { fetchSrt, makeKkey } from "./kisskh.js";

const TTL = 300;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "*",
};

const STREAM_NS = "https://kdrama.stream/";

// Set to your self-hosted kisskh proxy (see proxy.js) URL, e.g. the cloudflared tunnel.
// Leave empty to disable kisskh list discovery (the /kisskh/srt endpoint still works with a src).
const KISSKH_PROXY = "https://proxy.jshmlnd.space";

// ponytail: hardcoded provider whitelist from dramavibe player; add hosts if the source player URL changes.
const PROVIDERS = ["cdn.dramav2.xyz", "cdn.drama3.click", "storage.dramavibe.cfd"];

function json(data, status = 200) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...CORS,
  };
  if (status === 200) headers["cache-control"] = `public, max-age=${TTL}`;
  return new Response(JSON.stringify(data), { status, headers });
}

async function stream(req, id) {
  if (!/^[\w.-]+$/.test(id)) return json({ error: "bad id" }, 400);
  const key = new Request(STREAM_NS + id);

  if (req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.url !== "string" || !/^https?:\/\//i.test(body.url) || !/\.m3u8(?:[?#]|$)/i.test(body.url)) {
      return json({ error: "json body {url} with an http(s) .m3u8 required" }, 400);
    }
    await caches.default.put(key, new Response(JSON.stringify({ url: body.url }), {
      headers: { "content-type": "application/json", "cache-control": "s-maxage=3600" },
    }));
    return json({ ok: true });
  }

  const hit = await caches.default.match(key);
  if (!hit) return json({ error: "not captured yet" }, 404);
  return new Response(hit.body, { headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });
}

async function streamUrl(id) {
  if (!/^[\w.-]+$/.test(id)) return null;
  const hit = await caches.default.match(new Request(STREAM_NS + id));
  if (!hit) return null;
  const body = await hit.json().catch(() => null);
  return body && typeof body.url === "string" ? body.url : null;
}

// ponytail: kisskh's Sub API rate-limits hard, so when the list is empty we
// synthesize the English src from sub.cdnvideo11's naming pattern
// (<KebabTitle>.Ep<N>_eng.srt[.txt]); ceiling: works where the CDN uses that
// pattern, other dramas still need a live kisskh list.
function synthSrtUrl(drama, epno) {
  const cap = drama.replace(/-\d{4}$/, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
  return `https://sub.cdnvideo11.shop/${cap}.Ep${epno}_eng.srt.txt`;
}

async function kisskhList(kisskhId, origin, drama, epno) {
  if (drama && !/^[a-z0-9-]+$/.test(drama)) drama = undefined;
  epno = ((epno || "").match(/\d+/) || [])[0];
  const r = await fetch(`${KISSKH_PROXY}/api/Sub/${kisskhId}${drama ? `?drama=${encodeURIComponent(drama)}` : ""}`);
  const list = r.ok ? await r.json().catch(() => []) : [];
  if (Array.isArray(list) && list.length) {
    return list.map((s) => ({
      label: s.label,
      language: s.land,
      default: !!s.default,
      url: s.src ? `${origin}/kisskh/srt?src=${encodeURIComponent(s.src)}` : null,
    }));
  }
  if (drama && epno) {
    return [{ label: "English", language: "en", default: true, url: `${origin}/kisskh/srt?src=${encodeURIComponent(synthSrtUrl(drama, epno))}` }];
  }
  return [];
}

async function subtitles(req, id) {
  const source = await streamUrl(id);
  if (!source) return json({ error: "not captured yet" }, 404);
  const videoId = new URL(source).pathname.split("/").filter(Boolean);
  if (videoId.length < 2) return json({ error: "cannot derive video id" }, 404);
  const r = await fetch(`https://storage.dramavibe.cfd/api/public/video/${videoId[0]}/subtitles`, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      referer: "https://catalog.dramavibe.cfd/",
    },
  });
  let list = [];
  try {
    if (r.ok) list = await r.json();
  } catch {}
  let subs = (Array.isArray(list) ? list : []).map((s) => ({ ...s, url: proxyUrl(id, s.url, new URL(req.url).origin) }));
  // ponytail: empty Dramavibe list falls back to kisskh by id; drop if ids ever diverge.
  if (!subs.length && /^\d+$/.test(id) && KISSKH_PROXY) {
    const sp = new URL(req.url).searchParams;
    subs = await kisskhList(id, new URL(req.url).origin, sp.get("drama") || undefined, sp.get("epno") || undefined);
  }
  return json({ subtitles: subs });
}

function proxyUrl(id, target, origin) {
  return `${origin}/stream/${id}/proxy?url=${encodeURIComponent(target)}`;
}

function rewriteManifest(text, base, id, origin) {
  const rewrite = (value) => proxyUrl(id, new URL(value, base).href, origin);
  return text.split("\n").map((line) => {
    if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, value) => `URI="${rewrite(value)}"`);
    return line.trim() ? rewrite(line.trim()) : line;
  }).join("\n");
}

async function manifest(req, id) {
  const target = await streamUrl(id);
  if (!target) return json({ error: "not captured yet" }, 404);
  const upstream = await fetch(target, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      referer: "https://catalog.dramavibe.cfd/",
    },
  });
  if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: CORS });
  const text = await upstream.text();
  return new Response(rewriteManifest(text, target, id, new URL(req.url).origin), {
    headers: { ...CORS, "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" },
  });
}

async function proxy(req, id) {
  const source = await streamUrl(id);
  const target = new URL(req.url).searchParams.get("url");
  if (!source || !target) return json({ error: "not captured yet or missing url" }, 404);

  let sourceUrl;
  let targetUrl;
  try {
    sourceUrl = new URL(source);
    targetUrl = new URL(target);
  } catch {
    return json({ error: "bad url" }, 400);
  }
  if (!/^https?:$/.test(targetUrl.protocol)) return json({ error: "bad url" }, 400);
  const ok = targetUrl.origin === sourceUrl.origin || PROVIDERS.includes(targetUrl.hostname);
  if (!ok) return json({ error: "target is not allowed" }, 403);

  const headers = new Headers();
  const range = req.headers.get("range");
  if (range) headers.set("range", range);
  if (ok && PROVIDERS.includes(targetUrl.hostname)) headers.set("referer", "https://catalog.dramavibe.cfd/");
  headers.set("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
  const upstream = await fetch(targetUrl, { headers });
  const responseHeaders = new Headers(CORS);
  const contentType = upstream.headers.get("content-type") || "";
  const isManifest = /mpegurl/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(targetUrl.href);
  if (isManifest) {
    responseHeaders.set("content-type", "application/vnd.apple.mpegurl");
    return new Response(rewriteManifest(await upstream.text(), targetUrl.href, id, new URL(req.url).origin), {
      status: upstream.status,
      headers: responseHeaders,
    });
  }
  responseHeaders.set("content-type", contentType || "application/octet-stream");
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) responseHeaders.set("content-range", contentRange);
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) responseHeaders.set("accept-ranges", acceptRanges);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) responseHeaders.set("content-length", contentLength);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const p = new URL(req.url).pathname;
    try {
      if (p === "/" || p === "") {
        return json({
          endpoints: {
            "/drama": "GET catalog (title, slug, year, genres, status)",
            "/drama/:slug": "GET detail (title, network, director, country, status, genres, thumbnail, episodes, cast)",
            "/stream/:id": "POST an m3u8 URL, GET the captured stream URL",
            "/stream/:id/manifest": "GET rewritten m3u8 manifest",
            "/stream/:id/subtitles": "GET subtitle track list (url points at the proxy)",
            "/stream/:id/proxy?url=...": "GET proxied HLS resource",
            "/kisskh/:episodeId/subtitles": "GET kisskh subtitle track list (via KISSKH_PROXY; ?drama=&epno= enables a CDN-pattern fallback)",
            "/kisskh/:slug/:number/subtitles": "GET synthesized English track by drama slug + episode number (bypasses kisskh Sub API)",
            "/kisskh/:episodeId/kkey": "GET kisskh kkey for client-side list fetch",
            "/kisskh/srt?src=...": "GET decrypted English kisskh SRT",
          },
        });
      }
      const manifestMatch = p.match(/^\/stream\/([\w.-]+)\/manifest\/?$/);
      if (manifestMatch && req.method === "GET") return manifest(req, manifestMatch[1]);
      const subMatch = p.match(/^\/stream\/([\w.-]+)\/subtitles\/?$/);
      if (subMatch && req.method === "GET") return subtitles(req, subMatch[1]);
      const proxyMatch = p.match(/^\/stream\/([\w.-]+)\/proxy\/?$/);
      if (proxyMatch && req.method === "GET") return proxy(req, proxyMatch[1]);
      if (p.startsWith("/stream/")) return stream(req, p.slice(8));
      if (p === "/kisskh/srt" && req.method === "GET") {
        const src = new URL(req.url).searchParams.get("src");
        if (!src) return json({ error: "missing src" }, 400);
        // ponytail: cdnvideo11 names live as both ".srt" and ".srt.txt"; retry the sibling.
        let text;
        try {
          text = await fetchSrt(src);
        } catch (e) {
          if (!/\.srt(\.txt)?(\?.*)?$/.test(src)) throw e;
          let alt;
          if (/\.srt\.txt(\?.*)?$/.test(src)) alt = src.replace(/\.srt\.txt(?=$|\?)/, ".srt");
          else alt = src.replace(/\.srt(?=$|\?)/, ".srt.txt");
          if (new URL(alt).hostname !== new URL(src).hostname) throw e;
          text = await fetchSrt(alt);
        }
        return new Response(text, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "content-disposition": "inline; filename=subtitle.srt" } });
      }
      const kisskhKey = p.match(/^\/kisskh\/(\d+)\/kkey\/?$/);
      if (kisskhKey && req.method === "GET") {
        const drama = new URL(req.url).searchParams.get("drama") || undefined;
        if (drama && !/^[a-z0-9-]+$/.test(drama)) return json({ error: "bad drama" }, 400);
        return json({ episode: kisskhKey[1], kkey: makeKkey(kisskhKey[1], drama) });
      }
      const kisskhSub = p.match(/^\/kisskh\/(\d+)\/subtitles\/?$/);
      if (kisskhSub && req.method === "GET") {
        if (!KISSKH_PROXY) return json({ error: "KISSKH_PROXY not configured" }, 503);
        const origin = new URL(req.url).origin;
        const sp = new URL(req.url).searchParams;
        const list = await kisskhList(kisskhSub[1], origin, sp.get("drama") || undefined, sp.get("epno") || undefined);
        return json({ subtitles: list });
      }
      // Synthesized list without a kisskh episode id (kisskh Sub API is
      // rate-limit hostile): /kisskh/:slug/:number/subtitles -> English track
      // from sub.cdnvideo11's <Kebab-Title>.Ep<N>_eng.srt[.txt] pattern.
      const watchSub = p.match(/^\/kisskh\/([a-z0-9-]+)\/(\d+)\/subtitles\/?$/);
      if (watchSub && req.method === "GET") {
        const origin = new URL(req.url).origin;
        const src = synthSrtUrl(watchSub[1], watchSub[2]);
        return json({
          subtitles: [{ label: "English", language: "en", default: true, url: `${origin}/kisskh/srt?src=${encodeURIComponent(src)}` }],
        });
      }
      if (p === "/drama" || p === "/drama/") {
        const html = await fetchPage(`${SITE}/drama-list/`);
        return json({ dramas: parseListPage(html) });
      }
      if (p.match(/^\/drama\/[^/]+\/?$/)) {
        const slug = p.split("/")[2];
        const html = await fetchPage(`${SITE}/series/${slug}/`);
        return json(parseSeriesPage(html));
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  },
};
