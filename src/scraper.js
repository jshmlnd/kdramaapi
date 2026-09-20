const SITE = "https://myasiantv.com.lv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchPage(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.text();
}

function match(html, re) {
  const m = html.match(re);
  return m ? (m[1] ?? m[0]).trim() : null;
}

const unescape = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;|&#8212;/g, "-");

function slugFromUrl(url) {
  return url.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean).pop() || "";
}

function parseListPage(html) {
  const re = /<li class="([^"]*filter-item[^"]*)"[^>]*data-genre\s*=\s*"([^"]*)"[^>]*>[\s\S]*?<a href="([^"]+)" title="([^"]*)"/g;
  return [...html.matchAll(re)].map((m) => {
    const href = m[3];
    const title = unescape(m[4]).trim();
    let genres = [];
    try {
      genres = JSON.parse(unescape(m[2]));
    } catch {}
    return {
      title: title.replace(/\s*\(\d{4}\)\s*$/, ""),
      year: (title.match(/\((\d{4})\)/) || [])[1] || null,
      slug: slugFromUrl(href),
      url: href.startsWith("http") ? href : SITE + href,
      genres,
      status: (m[1].match(/status_(\w+)/) || [])[1] || null,
    };
  });
}

function parseSeriesPage(html) {
  const title = match(html, /<h1>([^<]+)<\/h1>/);
  const otherName = match(html, /class="other_name"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
  const network = match(html, /<span>Original Network:<\/span>\s*<a[^>]*>([^<]+)<\/a>/);
  const director = match(html, /<span>Director:<\/span>\s*<a[^>]*>([^<]+)<\/a>/);
  const country = match(html, /<span>Country:<\/span>\s*<a[^>]*>([^<]+)<\/a>/);
  const status = match(html, /<span>Status:<\/span>\s*(?:<a[^>]*>)?([^<]+)(?:<\/a>)?/);
  const genres = [...html.matchAll(/<span>Genre:\s*<\/span>([\s\S]*?)(?=<\/div>)/g)].flatMap((g) =>
    [...g[1].matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((a) => a[1])
  );
  const thumbnail = match(html, /<div class="img">\s*<img[^>]*src="([^"]+)"/s);
  const episodes = [...html.matchAll(/<a href="([^"]*episode-\d+[^"]*)"[^>]*class="img"[\s\S]*?<h3[^>]*class="title"[^>]*>([^<]+)<\/h3>/g)].map(
    (m) => ({
      url: m[1].startsWith("http") ? m[1] : SITE + m[1],
      title: m[2].trim(),
      number: (m[1].match(/episode-(\d+)/) || [])[1] || null,
    })
  );
  const cast = [...html.matchAll(/<h3[^>]*onclick="[^"]*\/star\/[^"]*"[^>]*>([^<]+)<\/h3>/g)].map((m) => m[1]);

  return {
    title: title?.replace(/\s*English Sub.*$/i, "").trim() || null,
    otherName,
    network,
    director,
    country,
    status: status?.trim() || null,
    genres,
    thumbnail,
    // ponytail: myasiantv publishes no plot synopsis/description; wire these in if the site ever adds them.
    synopsis: null,
    description: null,
    episodes,
    cast,
  };
}

export { fetchPage, parseListPage, parseSeriesPage, SITE };
