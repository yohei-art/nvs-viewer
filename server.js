const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.md':'text/plain; charset=utf-8', '.json':'application/json; charset=utf-8' };

// ---------------------------------------------------------------------------
// /api/ticker — what the bottom banner scrolls.
//
// Deliberately only two kinds of source, both of which are meant to be polled:
//   * frankfurter.app — a public FX API (ECB reference rates)
//   * NHK / Yahoo news RSS — feeds published for exactly this purpose
// No index scraping. Screen-scraping Yahoo Finance worked in testing but gets
// rate-limited and risks the host being blocked, which is not worth a banner.
// Everything is cached hard and fetched at most a few times an hour.
// ---------------------------------------------------------------------------
const UA = 'Mozilla/5.0 (compatible; NVS-viewer/1.0; +https://nvs-viewer-production.up.railway.app)';
const FX_TTL   = 30 * 60 * 1000;      // ECB publishes once a day; half an hour is plenty
const NEWS_TTL =  3 * 60 * 1000;      // headlines move, so re-read the feeds often
let fxCache = { at: 0, data: null };
let newsCache = { at: 0, data: null };

function get(url, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const req = https.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, ms).then(finish);
      }
      if (res.statusCode !== 200) { res.resume(); return finish(null); }
      let d = '';
      res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); });
      res.on('end', () => finish(d));
    });
    req.on('error', () => finish(null));
    req.setTimeout(ms || 7000, () => { req.destroy(); finish(null); });
  });
}

function ymd(d) {
  return d.getUTCFullYear() + '-' +
         String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
         String(d.getUTCDate()).padStart(2, '0');
}

// USD/JPY plus the move since the previous published rate
async function fx() {
  if (fxCache.data && Date.now() - fxCache.at < FX_TTL) return fxCache.data;
  const from = ymd(new Date(Date.now() - 8 * 864e5));
  const raw = await get('https://api.frankfurter.app/' + from + '..?from=USD&to=JPY', 7000);
  let out = null;
  try {
    const j = JSON.parse(raw);
    const days = Object.keys(j.rates || {}).sort();
    if (days.length) {
      const last = j.rates[days[days.length - 1]].JPY;
      const prev = days.length > 1 ? j.rates[days[days.length - 2]].JPY : null;
      out = [{ sym: 'USD/JPY', last: last, asof: days[days.length - 1],
               chg: prev == null ? null : last - prev,
               pct: prev ? ((last - prev) / prev) * 100 : null }];
    }
  } catch (e) {}
  if (!out) {                                   // one plain fallback, still a real API
    const raw2 = await get('https://open.er-api.com/v6/latest/USD', 6000);
    try {
      const j = JSON.parse(raw2);
      if (j && j.rates && j.rates.JPY) out = [{ sym: 'USD/JPY', last: j.rates.JPY, chg: null, pct: null }];
    } catch (e) {}
  }
  if (out) fxCache = { at: Date.now(), data: out };
  return out || (fxCache.data || []);
}

function unent(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, '').trim();
}

function parseRss(xml, src, max) {
  if (!xml) return [];
  const items = xml.split(/<item[\s>]/).slice(1);
  const out = [];
  for (const it of items) {
    const t = /<title>([\s\S]*?)<\/title>/.exec(it);
    const l = /<link>([\s\S]*?)<\/link>/.exec(it);
    if (!t) continue;
    const title = unent(t[1]);
    if (!title) continue;
    out.push({ t: title, u: l ? unent(l[1]) : '', src: src });
    if (out.length >= max) break;
  }
  return out;
}

async function news() {
  if (newsCache.data && Date.now() - newsCache.at < NEWS_TTL) return newsCache.data;
  const [nhk, yj] = await Promise.all([
    get('https://www.nhk.or.jp/rss/news/cat0.xml', 7000),
    get('https://news.yahoo.co.jp/rss/topics/top-picks.xml', 7000)
  ]);
  const a = parseRss(nhk, 'NHK', 8);
  const b = parseRss(yj, 'Yahoo', 8);
  const mixed = [];                              // interleave so neither dominates
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) mixed.push(a[i]);
    if (b[i]) mixed.push(b[i]);
  }
  const out = mixed.slice(0, 14);
  if (out.length) newsCache = { at: Date.now(), data: out };
  return out.length ? out : (newsCache.data || []);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/ticker') {
    Promise.all([fx(), news()]).then(([q, n]) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ quotes: q, news: n, at: Date.now() }));
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ quotes: [], news: [], at: Date.now() }));
    });
    return;
  }

  let f = decodeURIComponent(url);
  if (f === '/' || f === '') f = '/index.html';
  const safe = path.normalize(f).replace(/^(\.\.[\/\\])+/, '');
  const p = path.join(__dirname, safe);
  fs.readFile(p, (e, data) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
});

server.listen(port, () => console.log('NVS viewer listening on ' + port));
