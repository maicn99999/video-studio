// Đăng nhập một người dùng (mật khẩu trong APP_PASSWORD) + cookie ký HMAC.
import crypto from 'node:crypto';

const COOKIE = 'aidebate_sess';
const MAX_AGE_S = 7 * 24 * 3600;

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function sign(secret, payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${mac}`;
}

export function verify(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class LoginLimiter {
  constructor({ max = 10, windowMs = 15 * 60_000 } = {}) { this.max = max; this.windowMs = windowMs; this.hits = new Map(); }
  check(ip) {
    const now = Date.now();
    const arr = (this.hits.get(ip) || []).filter((t) => now - t < this.windowMs);
    this.hits.set(ip, arr);
    return arr.length < this.max;
  }
  fail(ip) { (this.hits.get(ip) || this.hits.set(ip, []).get(ip)).push(Date.now()); }
  reset(ip) { this.hits.delete(ip); }
}

export function authRoutes(app, cfg) {
  const limiter = new LoginLimiter();
  app.post('/api/login', (req, res) => {
    const ip = req.ip;
    if (!limiter.check(ip)) return res.status(429).json({ error: 'Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút.' });
    if (!safeEqual(req.body?.password || '', cfg.appPassword)) {
      limiter.fail(ip);
      return res.status(401).json({ error: 'Mật khẩu không đúng.' });
    }
    limiter.reset(ip);
    const token = sign(cfg.sessionSecret, { u: 'owner', exp: Math.floor(Date.now() / 1000) + MAX_AGE_S });
    res.setHeader('Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_S}${cfg.cookieSecure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.cookieSecure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
}

export function requireLogin(cfg) {
  return (req, res, next) => {
    const user = verify(cfg.sessionSecret, parseCookies(req.headers.cookie)[COOKIE]);
    if (!user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    // Chống CSRF cho request thay đổi dữ liệu: ngoài SameSite=Strict, yêu cầu header tùy biến.
    if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'aidebate') {
      return res.status(403).json({ error: 'Thiếu header bảo vệ CSRF.' });
    }
    req.user = user;
    next();
  };
}

export function requireInternal(cfg) {
  return (req, res, next) => {
    if (!safeEqual(req.get('x-internal-token') || '', cfg.internalToken)) return res.status(401).json({ error: 'internal token sai' });
    next();
  };
}
