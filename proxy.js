// Self-hosted kisskh subtitle-list proxy. Run on any machine whose IP isn't
// Cloudflare-flagged (your laptop, a VPS) so kisskh doesn't serve a challenge.
// The Cloudflare Worker calls this for list discovery; srt fetch+decrypt stays in the Worker.
import http from "node:http";
import https from "node:https";
import { makeKkey } from "./src/kisskh.js";

const HOST = "kisskh.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Resolve via DNS-over-HTTPS so a hijacked ISP resolver (e.g. Globe blocks kisskh) can't redirect us.
let cachedIp = null;
async function resolveIp() {
  if (cachedIp) return cachedIp;
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${HOST}&type=A`, { headers: { accept: "application/dns-json" } });
  const j = await r.json();
  cachedIp = j.Answer?.[0]?.data;
  if (!cachedIp) throw new Error("dns resolve failed");
  return cachedIp;
}

function kisskhGet(path) {
  return new Promise(async (resolve, reject) => {
    try {
      const ip = await resolveIp();
      const req = https.request(
        {
          hostname: HOST,
          servername: HOST,
          path,
          method: "GET",
          headers: { "user-agent": UA, referer: `https://${HOST}/` },
          lookup: (_h, _o, cb) => cb(null, [{ address: ip, family: 4 }]),
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on("error", reject);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const m = url.pathname.match(/^\/api\/Sub\/(\d+)\/?$/);
  if (!m) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
    return;
  }
  try {
    const drama = url.searchParams.get("drama") || undefined;
    const kkey = makeKkey(m[1], drama);
    const r = await kisskhGet(`/api/Sub/${m[1]}?kkey=${kkey}`);
    if (r.status !== 200) throw new Error(`kisskh ${r.status}`);
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(r.body);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

const port = process.env.PORT || 8788;
server.listen(port, () => console.log(`kisskh proxy listening on :${port}`));
