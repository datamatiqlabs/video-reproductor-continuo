const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use((req, res, next) => {
  // Allow CORS from local frontends
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

function toAbsolute(candidate, base) {
  try {
    return new URL(candidate, base).href;
  } catch (e) {
    return null;
  }
}

function extractMp4FromHtml(html, pageUrl) {
  if (!html) return null;

  // 1) meta tags
  const metaOg = html.match(/<meta[^>]+(?:property|name)=["'](?:og:video|og:video:url|og:video:secure_url|video_src)["'][^>]*content=["']([^"']+)["']/i);
  if (metaOg && metaOg[1]) {
    const abs = toAbsolute(metaOg[1], pageUrl);
    if (abs && /\.mp4($|\?)/i.test(abs)) return abs;
    if (abs && /\.m3u8/i.test(abs) === false) return abs;
  }

  // 2) JSON-LD
  const ldMatches = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig));
  for (const m of ldMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of candidates) {
        if (p && p.contentUrl && /\.mp4($|\?)/i.test(p.contentUrl)) return toAbsolute(p.contentUrl, pageUrl);
        if (p && p.url && /\.mp4($|\?)/i.test(p.url)) return toAbsolute(p.url, pageUrl);
      }
    } catch (e) {
      // ignore
    }
  }

  // 3) <video> and <source>
  const videoTag = html.match(/<video[\s\S]*?src=["']([^"']+)["']/i);
  if (videoTag && videoTag[1]) {
    const abs = toAbsolute(videoTag[1], pageUrl);
    if (abs && /\.mp4($|\?)/i.test(abs)) return abs;
  }
  const sourceTag = html.match(/<source[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (sourceTag && sourceTag[1]) {
    const abs = toAbsolute(sourceTag[1], pageUrl);
    if (abs && /\.mp4($|\?)/i.test(abs)) return abs;
  }

  // 4) jwplayer setup
  const jw = html.match(/jwplayer\([^\)]*\)\.setup\(\s*({[\s\S]*?})\s*\)/i);
  if (jw && jw[1]) {
    try {
      const cfgText = jw[1].replace(/(['"])?([a-zA-Z0-9_]+)\1\s*:/g, '"$2":');
      const cfg = JSON.parse(cfgText);
      if (cfg.file && /\.mp4($|\?)/i.test(cfg.file)) return toAbsolute(cfg.file, pageUrl);
      if (cfg.sources && Array.isArray(cfg.sources)) {
        for (const s of cfg.sources) {
          if (s.file && /\.mp4($|\?)/i.test(s.file)) return toAbsolute(s.file, pageUrl);
        }
      }
    } catch (e) {}
  }

  // 5) common player patterns
  const p = html.match(/setVideoUrlHigh\(['"]([^'"]+)['"]\)/i) || html.match(/setVideoUrlLow\(['"]([^'"]+)['"]\)/i) || html.match(/video_url\s*:\s*['"]([^'"]+)['"]/i) || html.match(/"videoUrl"\s*:\s*"([^"]+)"/i);
  if (p && p[1]) {
    const abs = toAbsolute(p[1], pageUrl);
    if (abs) return abs;
  }

  // 6) platform-specific quick matches
  const tiktok = html.match(/"playAddr"\s*:\s*"([^\"]+\.mp4[^\"]*)"/i) || html.match(/"downloadAddr"\s*:\s*"([^\"]+\.mp4[^\"]*)"/i);
  if (tiktok && tiktok[1]) return toAbsolute(tiktok[1].replace(/\\u0026/g, '&').replace(/\\/g, ''), pageUrl);

  const insta = html.match(/<meta[^>]+property=["']og:video["'][^>]*content=["']([^"']+)["']/i) || html.match(/"video_url"\s*:\s*"([^"]+)"/i);
  if (insta && insta[1]) return toAbsolute(insta[1], pageUrl);

  const twitter = html.match(/https?:\/\/video\.twimg\.com\/[^"'\s>]+\.mp4/ig) || html.match(/https?:\/\/pbs\.twimg\.com\/[^"'\s>]+\.mp4/ig);
  if (twitter && twitter.length) return toAbsolute(twitter[0], pageUrl);

  const reddit = html.match(/"fallback_url"\s*:\s*"([^"']+\.mp4[^"']*)"/i);
  if (reddit && reddit[1]) return toAbsolute(reddit[1].replace(/\\u0026/g, '&').replace(/\\/g, ''), pageUrl);

  const fb = html.match(/"sd_src_no_ratelimit"\s*:\s*"([^"]+)"/i) || html.match(/"hd_src"\s*:\s*"([^"]+)"/i) || html.match(/"sd_src"\s*:\s*"([^"]+)"/i);
  if (fb && fb[1]) return toAbsolute(fb[1].replace(/\\u0026/g, '&').replace(/\\/g, ''), pageUrl);

  // 7) generic JSON file/src/url
  const files = Array.from(html.matchAll(/["'](?:file|src|url)["']\s*:\s*["']([^"']+\.mp4[^"']*)["']/ig));
  if (files.length) {
    for (const fm of files) {
      const candidate = fm[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
      const abs = toAbsolute(candidate, pageUrl);
      if (abs) return abs;
    }
  }

  // 8) global mp4 search
  const mp4 = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
  if (mp4 && mp4[0]) return mp4[0];

  return null;
}

app.get('/extract', async (req, res) => {
  const pageUrl = req.query.url;
  if (!pageUrl) return res.status(400).json({ success: false, error: 'Missing url query parameter' });

  try {
    const response = await axios.get(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': pageUrl
      },
      timeout: 15000,
      responseType: 'text',
    });

    const html = response.data;
    const extracted = extractMp4FromHtml(html, pageUrl);

    if (extracted) {
      return res.json({ success: true, url: extracted });
    }

    return res.json({ success: false, error: 'No mp4 found', note: 'Try server-side cookies/headers or HLS processing' });
  } catch (err) {
    console.error('fetch error', err.message);
    return res.status(500).json({ success: false, error: 'Fetch failed', details: err.message });
  }
});

app.listen(PORT, () => console.log(`Extractor server listening on http://localhost:${PORT}`));
