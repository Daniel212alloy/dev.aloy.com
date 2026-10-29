// Backend kecil untuk DaNiel S. - tanpa dependensi, cukup Node.js 18+
// Jalankan: ADMIN_TOKEN=rahasia ALLOWED_ORIGIN=https://username.github.io node server.js
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const ORIGIN = process.env.ALLOWED_ORIGIN || '*';          // isi dengan domain frontend
const ADMIN = process.env.ADMIN_TOKEN || '';                 // kosong = fitur admin nonaktif
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';         // 1 jika di belakang nginx/Cloudflare
const SALT = process.env.IP_SALT || 'ganti-salt-ini';

let db = { views: 0, likes: 0, likers: {}, seen: {}, guestbook: [], inquiries: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
let dirty = false;
const save = () => { dirty = true; };
setInterval(() => {                                          // tulis ke disk maks. 1x / 2 detik, atomik
  if (!dirty) return; dirty = false;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => { if (!err) fs.rename(tmp, DB_FILE, () => {}); });
}, 2000).unref();
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });

const hash = ip => crypto.createHash('sha256').update(SALT + ip).digest('hex').slice(0, 24);
const clientIp = req => (TRUST_PROXY && (req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim())) || req.socket.remoteAddress || '';
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

const buckets = new Map();                                   // rate limit sederhana per IP + aksi
function limited(key, max, windowMs) {
  const now = Date.now(), b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 3600e3) buckets.delete(k); }, 600e3).unref();

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGIN, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 10e3) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const isAdmin = req => ADMIN && (req.headers.authorization || '') === 'Bearer ' + ADMIN;
const publicGb = () => db.guestbook.slice(-100).reverse().map(({ id, name, message, at }) => ({ id, name, message, at }));

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://x'), p = url.pathname.replace(/\/+$/, '') || '/';
  const ip = hash(clientIp(req));
  try {
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/api/stats')
      return send(res, 200, { views: db.views, likes: db.likes, liked: !!db.likers[ip] });

    if (req.method === 'POST' && p === '/api/view') {        // 1 kunjungan per pengunjung per 6 jam, bot diabaikan
      if (/bot|crawl|spider|slurp|curl|wget|preview|monitor|uptime/i.test(req.headers['user-agent'] || '')) return send(res, 200, { views: db.views });
      if (!db.seen[ip] || Date.now() - db.seen[ip] > 6 * 3600e3) { db.views++; db.seen[ip] = Date.now(); save(); }
      return send(res, 200, { views: db.views });
    }
    if (req.method === 'POST' && p === '/api/like') {        // 1 like per pengunjung
      if (!db.likers[ip]) { db.likers[ip] = 1; db.likes++; save(); }
      return send(res, 200, { likes: db.likes, liked: true });
    }
    if (p === '/api/guestbook') {
      if (req.method === 'GET') return send(res, 200, { items: publicGb() });
      if (req.method === 'POST') {
        if (limited('gb' + ip, 3, 3600e3)) return send(res, 429, { error: 'rate' });
        const b = await readJson(req);
        if (b.website) return send(res, 200, { ok: true });  // honeypot: bot mengisi, tampak sukses tapi dibuang
        const name = clean(b.name, 40), message = clean(b.message, 500);
        if (name.length < 2 || message.length < 3) return send(res, 400, { error: 'invalid' });
        const item = { id: crypto.randomBytes(6).toString('hex'), name, message, at: new Date().toISOString() };
        db.guestbook.push(item); save();
        return send(res, 201, { ok: true, item });
      }
    }
    if (req.method === 'POST' && p === '/api/contact') {     // inquiry masuk, hanya admin yang bisa baca
      if (limited('ct' + ip, 3, 3600e3)) return send(res, 429, { error: 'rate' });
      const b = await readJson(req);
      if (b.website) return send(res, 200, { ok: true });
      const name = clean(b.name, 60), contact = clean(b.contact, 80), topic = clean(b.topic, 40), message = clean(b.message, 1500);
      if (name.length < 2 || contact.length < 5 || message.length < 10) return send(res, 400, { error: 'invalid' });
      db.inquiries.push({ id: crypto.randomBytes(6).toString('hex'), name, contact, topic, message, at: new Date().toISOString() }); save();
      return send(res, 201, { ok: true });
    }
    if (p.startsWith('/api/admin')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET' && p === '/api/admin/inquiries') return send(res, 200, { items: db.inquiries.slice().reverse() });
      const m = p.match(/^\/api\/admin\/guestbook\/([a-f0-9]+)$/);
      if (req.method === 'DELETE' && m) { db.guestbook = db.guestbook.filter(x => x.id !== m[1]); save(); return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 400, { error: 'bad request' }); }
});
server.listen(PORT, () => console.log('API siap di port ' + PORT));
