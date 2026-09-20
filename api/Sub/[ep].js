import { makeKkey } from "../../src/kisskh.js";

const HOST = "https://kisskh.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export default async function handler(req, res) {
  const ep = req.query.ep;
  if (!ep || !/^\d+$/.test(ep)) {
    return res.status(400).json({ error: "missing ep" });
  }
  try {
    const kkey = makeKkey(ep);
    const r = await fetch(`${HOST}/api/Sub/${ep}?kkey=${kkey}`, {
      headers: { "user-agent": UA, referer: `${HOST}/` },
    });
    if (!r.ok) return res.status(502).json({ error: `kisskh ${r.status}` });
    res.setHeader("access-control-allow-origin", "*");
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
