const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

// ---------------------------------------------------------------------------
// /api/ticker — quotes + Japanese headlines for the scrolling banner.
// The browser can't call these sources directly (no CORS), so we relay them
// here and cache for a minute. Every source is best-effort: whatever answers
// gets shown, the rest is simply left out.
// ---------------------------------------------------------------------------
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
let cache = { at: 0, body: null };
const CACHE_MS = 60 * 1000;

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
    req.setTimeout(ms || 6000, () => { req.destroy(); finish(null); });
  });
}

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

// Yahoo Finance chart endpoint: last price + previous close in one call
async function yahoo(symbol, label) {
  const raw = await get('https://query1.finance.yahoo.com/v8/finance/chart/' +
                        encodeURIComponent(symbol) + '?range=5d&interval=1d', 6000);
  if (!raw || raw[0] !== '{') return null;
  try {
    const m = JSON.parse(raw).chart.result[0].meta;
    const last = num(m.regularMarketPrice), prev = num(m.chartPreviousClose || m.previousClose);
    if (last === null) return null;
    return { sym: label, last: last, chg: prev === null ? null : last - prev,
             pct: prev ? ((last - prev) / prev) * 100 : null };
  } catch (e) { return null; }
}

// Stooq daily CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
async function stooq(symbol, label) {
  const raw = await get('https://stooq.com/q/l/?s=' + encodeURIComponent(symbol) +
                        '&f=sd2t2ohlcv&h&e=csv', 6000);
  if (!raw || raw.indexOf('<') === 0) return null;
  const line = raw.trim().split('\n')[1];
  if (!line) return null;
  const c = line.split(',');
  const close = parseFloat(c[6]), open = parseFloat(c[3]);
  if (!isFinite(close)) return null;
  return { sym: label, last: close, chg: isFinite(open) ? close - open : null,
           pct: isFinite(open) && open ? ((close - open) / open) * 100 : null };
}

// Yahoo answers reliably for all of these; TOPIX itself has no usable index
// symbol there, so the 1306 ETF stands in for it (same direction, same %).
async function quotes() {
  const want = [
    { label: 'USD/JPY', y: 'JPY=X',    s: 'usdjpy' },
    { label: 'NKY',     y: '^N225',    s: '^nkx' },
    { label: 'TOPIX',   y: '1306.T',   s: '^tpx' },
    { label: 'EUR/JPY', y: 'EURJPY=X', s: 'eurjpy' },
    { label: 'S&P500',  y: '^GSPC',    s: '^spx' },
    { label: 'US10Y',   y: '^TNX',     s: null },
    { label: 'VIX',     y: '^VIX',     s: null }
  ];
  const out = await Promise.all(want.map(async w => {
    return (await yahoo(w.y, w.label)) || (w.s ? await stooq(w.s, w.label) : null) || null;
  }));
  const list = out.filter(Boolean);
  // last resort for the FX rate so the banner is never completely empty
  if (!list.some(q => q.sym === 'USD/JPY')) {
    const raw = await get('https://open.er-api.com/v6/latest/USD', 5000);
    try {
      const j = JSON.parse(raw);
      if (j && j.rates && j.rates.JPY) list.unshift({ sym: 'USD/JPY', last: j.rates.JPY, chg: null, pct: null });
    } catch (e) {}
  }
  return list;
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
  const [nhk, yj] = await Promise.all([
    get('https://www.nhk.or.jp/rss/news/cat0.xml', 6000),
    get('https://news.yahoo.co.jp/rss/topics/top-picks.xml', 6000)
  ]);
  const a = parseRss(nhk, 'NHK', 6);
  const b = parseRss(yj, 'Yahoo', 8);
  const mixed = [];                       // interleave so one source can't dominate
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) mixed.push(a[i]);
    if (b[i]) mixed.push(b[i]);
  }
  return mixed.slice(0, 12);
}

async function ticker() {
  const [q, n] = await Promise.all([quotes(), news()]);
  return { quotes: q, news: n, at: Date.now() };
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/api/ticker') {
    const send = body => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(body);
    };
    if (cache.body && Date.now() - cache.at < CACHE_MS) return send(cache.body);
    ticker().then(data => {
      cache = { at: Date.now(), body: JSON.stringify(data) };
      send(cache.body);
    }).catch(() => {
      send(cache.body || JSON.stringify({ quotes: [], news: [], at: Date.now() }));
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
