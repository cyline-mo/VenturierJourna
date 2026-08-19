const SESSION_COOKIE = '__Host-vj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const PASSWORD_ITERATIONS = 310000;
const encoder = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true, service: 'venturier-journal-members' });
      }
      if (url.pathname === '/api/auth/register' && request.method === 'POST') {
        requireSameOrigin(request);
        return await registerMember(request, env);
      }
      if (url.pathname === '/api/auth/member/login' && request.method === 'POST') {
        requireSameOrigin(request);
        return await loginMember(request, env);
      }
      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        return await getSession(request, env);
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        requireSameOrigin(request);
        return await logout(request, env);
      }
      return json({ ok: false, error: '接口不存在。' }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ ok: false, error: error.message }, error.status);
      }
      console.error('Unhandled API error', error);
      return json({ ok: false, error: '服务器暂时无法处理请求，请稍后再试。' }, 500);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function registerMember(request, env) {
  const body = await readJson(request);
  const displayName = String(body.displayName || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  // Hidden field: real users leave this empty; basic bots often fill it.
  if (String(body.website || '').trim()) {
    return json({ ok: true, status: 'active', message: '注册成功。' }, 201);
  }

  if (displayName.length < 2 || displayName.length > 60) {
    throw new HttpError(400, '姓名或称呼需要填写 2—60 个字符。');
  }
  if (!isValidEmail(email)) {
    throw new HttpError(400, '请输入有效的邮箱地址。');
  }
  if (password.length < 12 || password.length > 128) {
    throw new HttpError(400, '密码至少需要 12 个字符。');
  }

  const rateKey = `register:${await sha256Hex(email)}`;
  if (!(await consumeRateLimit(env.DB, rateKey, 5, 60 * 60))) {
    throw new HttpError(429, '注册次数过多，请一小时后再试。');
  }

  const existing = await env.DB.prepare('SELECT id, status FROM users WHERE email = ?1').bind(email).first();
  if (existing) {
    throw new HttpError(409, '这个邮箱已经注册。');
  }

  const now = unixTime();
  const userId = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS, env.PASSWORD_PEPPER || '');
  const sessionToken = randomToken(32);
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS;

  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, display_name, password_hash, password_salt,
          password_iterations, role, status, created_at, updated_at,
          activated_at, last_login_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'member', 'active', ?7, ?7, ?7, ?7)
      `).bind(userId, email, displayName, passwordHash, salt, PASSWORD_ITERATIONS, now),
      env.DB.prepare(`
        INSERT INTO auth_audit_log (user_id, event_type, event_at, details)
        VALUES (?1, 'member_registered', ?2, '{"status":"active","access":"immediate"}')
      `).bind(userId, now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
      env.DB.prepare(`
        INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?3)
      `).bind(tokenHash, userId, now, expiresAt)
    ]);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      throw new HttpError(409, '这个邮箱已经注册。');
    }
    throw error;
  }

  const user = { id: userId, email, display_name: displayName, role: 'member', status: 'active' };
  return json({ ok: true, status: 'active', user: publicUser(user), message: '注册成功，已为你登录会员俱乐部。' }, 201, {
    'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL_SECONDS)
  });
}

async function loginMember(request, env) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  if (!isValidEmail(email) || !password) {
    throw new HttpError(400, '请输入邮箱和密码。');
  }

  const rateKey = `login:${await sha256Hex(email)}`;
  if (!(await consumeRateLimit(env.DB, rateKey, 10, 15 * 60))) {
    throw new HttpError(429, '登录尝试过多，请 15 分钟后再试。');
  }

  const user = await env.DB.prepare(`
    SELECT id, email, display_name, password_hash, password_salt,
           password_iterations, role, status
    FROM users WHERE email = ?1
  `).bind(email).first();

  if (!user) {
    // Perform the expensive operation even when the account does not exist.
    await derivePasswordHash(password, '00000000000000000000000000000000', PASSWORD_ITERATIONS, env.PASSWORD_PEPPER || '');
    throw new HttpError(401, '邮箱或密码不正确。');
  }

  const candidateHash = await derivePasswordHash(
    password,
    user.password_salt,
    user.password_iterations,
    env.PASSWORD_PEPPER || ''
  );
  if (!constantTimeEqual(candidateHash, user.password_hash)) {
    await writeAudit(env.DB, user.id, 'member_login_failed', { reason: 'password' });
    throw new HttpError(401, '邮箱或密码不正确。');
  }
  if (user.status !== 'active' || user.role !== 'member') {
    throw new HttpError(403, '这个账号目前不能进入会员俱乐部。');
  }

  const now = unixTime();
  const sessionToken = randomToken(32);
  const tokenHash = await sha256Hex(sessionToken);
  const expiresAt = now + SESSION_TTL_SECONDS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
      VALUES (?1, ?2, ?3, ?4, ?3)
    `).bind(tokenHash, user.id, now, expiresAt),
    env.DB.prepare('UPDATE users SET last_login_at = ?1, updated_at = ?1 WHERE id = ?2').bind(now, user.id),
    env.DB.prepare(`
      INSERT INTO auth_audit_log (user_id, event_type, event_at, details)
      VALUES (?1, 'member_login_succeeded', ?2, '{}')
    `).bind(user.id, now)
  ]);

  return json({ ok: true, user: publicUser(user) }, 200, {
    'Set-Cookie': sessionCookie(sessionToken, SESSION_TTL_SECONDS)
  });
}

async function getSession(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) return json({ ok: true, authenticated: false });

  const tokenHash = await sha256Hex(token);
  const now = unixTime();
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.status, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
  `).bind(tokenHash, now).first();

  if (!user || user.status !== 'active') {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
    return json({ ok: true, authenticated: false }, 200, {
      'Set-Cookie': sessionCookie('', 0)
    });
  }

  await env.DB.prepare('UPDATE sessions SET last_seen_at = ?1 WHERE token_hash = ?2').bind(now, tokenHash).run();
  return json({ ok: true, authenticated: true, user: publicUser(user) });
}

async function logout(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

async function consumeRateLimit(db, key, limit, windowSeconds) {
  const now = unixTime();
  const row = await db.prepare(`
    SELECT window_started_at, attempts FROM auth_rate_limits WHERE rate_key = ?1
  `).bind(key).first();

  if (!row || now - row.window_started_at >= windowSeconds) {
    await db.prepare(`
      INSERT INTO auth_rate_limits (rate_key, window_started_at, attempts)
      VALUES (?1, ?2, 1)
      ON CONFLICT(rate_key) DO UPDATE SET window_started_at = excluded.window_started_at, attempts = 1
    `).bind(key, now).run();
    return true;
  }
  if (row.attempts >= limit) return false;
  await db.prepare('UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?1').bind(key).run();
  return true;
}

async function readJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new HttpError(415, '请求格式不正确。');
  }
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 20000) throw new HttpError(413, '请求内容过大。');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, '请求内容不是有效的 JSON。');
  }
}

function requireSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return;
  if (origin !== new URL(request.url).origin) {
    throw new HttpError(403, '请求来源未通过验证。');
  }
}

async function derivePasswordHash(password, saltHex, iterations, pepper) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${password}\u0000${pepper}`),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: hexToBytes(saltHex),
    iterations
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    status: user.status
  };
}

function parseCookies(header) {
  return Object.fromEntries(header.split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part.trim(), ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function randomToken(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return bytesToBase64Url(bytes);
}

function randomHex(size) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(size)));
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{1,2}/g).map(byte => Number.parseInt(byte, 16)));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function unixTime() {
  return Math.floor(Date.now() / 1000);
}

async function writeAudit(db, userId, eventType, details = {}) {
  await db.prepare(`
    INSERT INTO auth_audit_log (user_id, event_type, event_at, details)
    VALUES (?1, ?2, ?3, ?4)
  `).bind(userId, eventType, unixTime(), JSON.stringify(details)).run();
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}
