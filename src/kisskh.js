import { aesCbcEncrypt, aesCbcDecrypt } from "./aes.js";

const SITE = "https://kisskh.co";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// kkey fingerprint constants (from kisskh common.js). ponytail: hardcoded; re-extract if kisskh bumps appVer/subGuid.
const APP_VER = "2.8.10";
const SUB_GUID = "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp";
const PLATFORM_VER = 4830201;
const KK_KEY = Uint8Array.from([0x4f,0x6b,0xda,0xa3,0x9e,0x2f,0x8c,0xb0,0x7f,0x5e,0x72,0x2d,0x9e,0xde,0xf3,0x14]);
const KK_IV = Uint8Array.from([0x01,0x50,0x4a,0xf3,0x56,0xe6,0x19,0xcf,0x2e,0x42,0xbb,0xa6,0x8c,0x3f,0x70,0xf9]);

// subtitle payload AES key/iv (ascii, from kisskh scripts.js a1()).
const SRT_KEY = new TextEncoder().encode("8056483646328763");
const SRT_IV = new TextEncoder().encode("6852612370185273");

const SUB_HOSTS = ["sub.cdnvideo11.shop", "auto.cdnvideo11.shop"];

function javaHash(s) {
  // kisskh computes this as an untruncated JS number (no |0); truncating
  // mismatches most episode fingerprints and kisskh 403s them.
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function makeKkey(episodeId, dramaSlug = "marry-my-husband") {
  // Current fingerprint (decoded from common.js cryptoService.key, byte-match
  // validated live): ''|hash|epId|''|salt|''|''|''|dramaPageUrl|lowercaseUa|''|codeName|appName|platform|00|''
  // The drama page URL is part of the client fingerprint (document.URL).
  const dramaUrl = `${SITE}/drama-detail/${dramaSlug}`.slice(0, 48);
  const ua = UA.toLowerCase();
  const parts = ["", episodeId, null, "mg3c3b04ba", null, null, null, dramaUrl, ua.slice(0, 48), null, "Mozilla", "Netscape", "Win32", "00", ""];
  const hash = javaHash(parts.join("|"));
  parts.splice(1, 0, hash);
  const s = parts.join("|");
  const buf = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) buf[i] = s.charCodeAt(i) & 0xff;
  return toHex(aesCbcEncrypt(KK_KEY, KK_IV, buf));
}

function b64decode(s) {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decryptCue(cue) {
  try {
    const plain = aesCbcDecrypt(SRT_KEY, SRT_IV, b64decode(cue));
    return new TextDecoder().decode(plain);
  } catch {
    return cue;
  }
}

function decryptSrt(text) {
  const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
  return (
    blocks
      .map((block) => {
        const lines = block.split("\n").filter(Boolean);
        if (lines.length < 3) return block;
        return [lines[0], lines[1], ...lines.slice(2).map(decryptCue)].join("\n");
      })
      .join("\n\n") + "\n"
  );
}

export async function fetchSrt(src) {
  if (!SUB_HOSTS.includes(new URL(src).hostname)) throw new Error("subtitle host not allowed");
  const r = await fetch(src, { headers: { "user-agent": UA, referer: `${SITE}/` } });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return decryptSrt(await r.text());
}
