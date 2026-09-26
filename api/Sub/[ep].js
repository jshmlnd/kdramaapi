// Self-hosted kisskh proxy (see proxy.js). Needed because kisskh.co 403s
// direct requests from Vercel/Cloudflare IPs.
const HOST = process.env.KISSKH_PROXY || "https://proxy.jshmlnd.space";
// Worker decrypts kisskh's AES-encoded SRTs (src files are gibberish raw).
const SRT_BASE = process.env.KISSKH_SRT_WORKER || "https://kdramaapi.joshuaklein-malonda.workers.dev";

export default async function handler(req, res) {
  res.setHeader("access-control-allow-origin", "*");
  const ep = req.query.ep;
  if (!ep || !/^\d+$/.test(ep)) {
    return res.status(400).json({ error: "missing ep" });
  }
  try {
    const drama = req.query.drama;
    const epno = (req.query.epno || "").replace(/[^0-9]/g, "");
    // ponytail: kisskh's Sub API is rate-limit hostile; with drama+epno we skip
    // it and synthesize the English src from sub.cdnvideo11's naming pattern —
    // ceiling: works where the CDN uses that pattern, other tracks need live kisskh.
    if (drama && epno) {
      const cap = drama.replace(/-\d{4}$/, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-");
      const synth = `https://sub.cdnvideo11.shop/${cap}.Ep${epno}_eng.srt.txt`;
      return res.status(200).json([{ label: "English", land: "en", default: true, src: `${SRT_BASE}/kisskh/srt?src=${encodeURIComponent(synth)}` }]);
    }
    const r = await fetch(`${HOST}/api/Sub/${ep}${drama ? `?drama=${encodeURIComponent(drama)}` : ""}`, {
      headers: { "user-agent": "kdramaapi-sublists" },
    });
    if (!r.ok) return res.status(502).json({ error: `kisskh ${r.status}` });
    const list = await r.json();
    return res
      .status(200)
      .json(list.map((s) => ({ ...s, src: `${SRT_BASE}/kisskh/srt?src=${encodeURIComponent(s.src)}` })));
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
