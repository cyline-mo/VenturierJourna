const SESSION_COOKIE = '__Host-vj_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
// Cloudflare Workers caps PBKDF2 at 100,000 iterations. A server-only pepper
// is therefore mandatory and must remain stable after member accounts exist.
const PASSWORD_ITERATIONS = 100000;
const encoder = new TextEncoder();
const ARTICLE_READ_DEDUP_SECONDS = 30 * 60;
const ARTICLES = Object.freeze({
  'the-new-farm-to-industry-transfer': '新时代的以农补工：从以农补工到以民补工',
  'fourth-fiscal-mobilization': '第四次财政总动员：当未来已经被提前使用',
  'july-2026-financial-data': '2026年7月金融数据：社融没有塌，私人信用需求正在退潮',
  'money-in-the-bank-consumption-defense': '2026年7月消费数据分析',
  'hidden-hunger-in-a-depression': '萧条中的隐性饥饿',
  'modern-sang-hongyang-question': '现代桑弘羊之问',
  'will-the-border-close-after-september-15': '9月15日以后，国门会不会关闭'
});
const PUBLIC_PORTFOLIO = Object.freeze({
  snapshotAt: '2026-08-19',
  currency: 'XOF',
  project: {
    id: 'west-africa-paper-recycling',
    title: '西非纸制品项目',
    region: '西非',
    state: '运营中',
    participation: '暂未开放',
    employees: 17,
    verifiedProductionTonnes: 30.35,
    verifiedBlocks: 341,
    shipmentBatches: 3,
    estimatedShipmentTonnes: 67.6
  },
  totals: {
    revenue: 13516101,
    cost: 8037126,
    profit: 5478975,
    margin: 0.4054
  },
  quarters: [
    { period: '2026 Q1', revenue: 4448327, cost: 2408409, profit: 2039918, margin: 0.4586, estimatedShipmentTonnes: 22.3 },
    { period: '2026 Q2', revenue: 5071040, cost: 2997798, profit: 2073242, margin: 0.4088, estimatedShipmentTonnes: 25.4 },
    { period: '2026 Q3 · 截至 08.19', revenue: 3996734, cost: 2630919, profit: 1365815, margin: 0.3417, estimatedShipmentTonnes: 20.0 }
  ],
  notes: [
    '销售收入采用统一内部汇率口径折算为 XOF；发货量按统一销售估值口径估算。',
    '第一季度成本资料不完整；第三季度成本截至 8 月 15 日，销售收入截至 8 月 19 日。',
    '本页为脱敏账册快照和经营估算，不构成投资建议。'
  ]
});
let analyticsSchemaReady = null;
let commentsSchemaReady = null;

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
      if (url.pathname === '/api/analytics/article-view' && request.method === 'POST') {
        requireSameOrigin(request);
        return await recordArticleView(request, env);
      }
      if (url.pathname === '/api/admin/analytics/articles' && request.method === 'GET') {
        return await getArticleAnalytics(request, env);
      }
      const commentsRoute = url.pathname.match(/^\/api\/articles\/([a-z0-9-]+)\/comments$/);
      if (commentsRoute && request.method === 'GET') {
        return await listArticleComments(commentsRoute[1], env);
      }
      if (commentsRoute && request.method === 'POST') {
        requireSameOrigin(request);
        return await createArticleComment(commentsRoute[1], request, env);
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
      if (url.pathname === '/api/member/portfolio/public' && request.method === 'GET') {
        return await getPublicPortfolio(request, env);
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

async function recordArticleView(request, env) {
  const body = await readJson(request);
  const articleSlug = String(body.articleSlug || '').trim();
  if (!Object.hasOwn(ARTICLES, articleSlug)) {
    throw new HttpError(400, '文章编号无效。');
  }

  await ensureAnalyticsSchema(env.DB);
  const pepper = requirePasswordPepper(env);
  const now = unixTime();
  const viewBucket = Math.floor(now / ARTICLE_READ_DEDUP_SECONDS);
  const ipAddress = String(request.headers.get('CF-Connecting-IP') || 'unknown');
  const userAgent = String(request.headers.get('User-Agent') || 'unknown').slice(0, 300);
  const visitorHash = await sha256Hex(`article-analytics-v1\u0000${pepper}\u0000${ipAddress}\u0000${userAgent}`);
  const country = normalizeCountry(request.cf?.country);
  const referrerHost = getReferrerHost(request.headers.get('Referer'));

  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO article_views (
      article_slug, visitor_hash, view_bucket, viewed_at, country, referrer_host
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(articleSlug, visitorHash, viewBucket, now, country, referrerHost).run();

  return json({ ok: true, recorded: Number(result.meta?.changes || 0) > 0 }, 202);
}

async function getArticleAnalytics(request, env) {
  await requireAdminSession(request, env);
  await ensureAnalyticsSchema(env.DB);
  const since = unixTime() - 24 * 60 * 60;
  const result = await env.DB.prepare(`
    SELECT
      article_slug,
      COUNT(*) AS total_reads,
      COUNT(DISTINCT visitor_hash) AS unique_readers,
      SUM(CASE WHEN viewed_at >= ?1 THEN 1 ELSE 0 END) AS reads_24h,
      MAX(viewed_at) AS last_read_at
    FROM article_views
    GROUP BY article_slug
    ORDER BY total_reads DESC, article_slug ASC
  `).bind(since).all();
  const rowsBySlug = new Map((result.results || []).map(row => [row.article_slug, row]));
  const articles = Object.entries(ARTICLES).map(([articleSlug, title]) => {
    const row = rowsBySlug.get(articleSlug) || {};
    return {
      articleSlug,
      title,
      totalReads: Number(row.total_reads || 0),
      uniqueReaders: Number(row.unique_readers || 0),
      reads24h: Number(row.reads_24h || 0),
      lastReadAt: row.last_read_at ? Number(row.last_read_at) : null
    };
  }).sort((left, right) => right.totalReads - left.totalReads);

  return json({ ok: true, generatedAt: unixTime(), articles });
}

async function listArticleComments(articleSlug, env) {
  if (!Object.hasOwn(ARTICLES, articleSlug)) throw new HttpError(404, '文章不存在。');
  await ensureCommentsSchema(env.DB);
  const result = await env.DB.prepare(`
    SELECT id, body, created_at, display_name, author_kind FROM (
      SELECT c.id, c.body, c.created_at, u.display_name, 'member' AS author_kind
      FROM article_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.article_slug = ?1 AND c.status = 'visible' AND u.status = 'active'
      UNION ALL
      SELECT g.id, g.body, g.created_at, g.display_name, 'guest' AS author_kind
      FROM guest_article_comments g
      WHERE g.article_slug = ?1 AND g.status = 'visible'
    )
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).bind(articleSlug).all();
  const comments = (result.results || []).reverse().map(row => ({
    id: row.id,
    displayName: row.display_name,
    authorKind: row.author_kind,
    content: row.body,
    createdAt: Number(row.created_at)
  }));
  return json({ ok: true, articleSlug, comments });
}

async function createArticleComment(articleSlug, request, env) {
  if (!Object.hasOwn(ARTICLES, articleSlug)) throw new HttpError(404, '文章不存在。');
  const body = await readJson(request);
  const content = String(body.content || '').replace(/\r\n/g, '\n').trim();
  if (content.length < 2) throw new HttpError(400, '评论至少需要 2 个字符。');
  if (content.length > 800) throw new HttpError(400, '评论不能超过 800 个字符。');

  await ensureCommentsSchema(env.DB);
  const user = await optionalMemberSession(request, env);
  const id = crypto.randomUUID();
  const createdAt = unixTime();
  let displayName;
  let authorKind;

  if (user) {
    if (!(await consumeRateLimit(env.DB, `comment:${user.id}`, 5, 60))) {
      throw new HttpError(429, '发言太频繁，请一分钟后再试。');
    }
    displayName = user.display_name;
    authorKind = 'member';
    await env.DB.prepare(`
      INSERT INTO article_comments (id, article_slug, user_id, body, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'visible', ?5, ?5)
    `).bind(id, articleSlug, user.id, content, createdAt).run();
  } else {
    displayName = String(body.displayName || '').replace(/\s+/g, ' ').trim();
    if (displayName.length < 2 || displayName.length > 30) {
      throw new HttpError(400, '游客昵称需要填写 2—30 个字符。');
    }
    if (String(body.website || '').trim()) {
      return json({ ok: true, comment: { id, displayName, authorKind: 'guest', content, createdAt } }, 201);
    }
    const pepper = requirePasswordPepper(env);
    const ipAddress = String(request.headers.get('CF-Connecting-IP') || 'unknown');
    const visitorHash = await sha256Hex(`guest-comment-v1\u0000${pepper}\u0000${ipAddress}`);
    if (!(await consumeRateLimit(env.DB, `guest-comment:${visitorHash}`, 5, 10 * 60))) {
      throw new HttpError(429, '游客发言较频繁，请十分钟后再试。');
    }
    authorKind = 'guest';
    await env.DB.prepare(`
      INSERT INTO guest_article_comments (id, article_slug, display_name, body, status, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, 'visible', ?5, ?5)
    `).bind(id, articleSlug, displayName, content, createdAt).run();
  }

  return json({
    ok: true,
    comment: { id, displayName, authorKind, content, createdAt }
  }, 201);
}

async function optionalMemberSession(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.display_name, u.role, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
  `).bind(tokenHash, unixTime()).first();
  if (!user || user.status !== 'active' || !['member', 'admin'].includes(user.role)) return null;
  return user;
}

async function requireAdminSession(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) throw new HttpError(401, '请先登录管理员账号。');
  const tokenHash = await sha256Hex(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.role, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
  `).bind(tokenHash, unixTime()).first();
  if (!user || user.status !== 'active') throw new HttpError(401, '管理员登录已失效。');
  if (user.role !== 'admin') throw new HttpError(403, '当前账号没有管理员权限。');
  return user;
}

async function requireMemberSession(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE];
  if (!token) throw new HttpError(401, '请先登录会员账号。');
  const tokenHash = await sha256Hex(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.display_name, u.role, u.status
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2
  `).bind(tokenHash, unixTime()).first();
  if (!user || user.status !== 'active') throw new HttpError(401, '会员登录已失效。');
  if (!['member', 'admin'].includes(user.role)) throw new HttpError(403, '当前账号没有会员权限。');
  return user;
}

async function getPublicPortfolio(request, env) {
  await requireMemberSession(request, env);
  return json({ ok: true, portfolio: PUBLIC_PORTFOLIO });
}

async function ensureAnalyticsSchema(db) {
  if (!analyticsSchemaReady) {
    analyticsSchemaReady = db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS article_views (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          article_slug TEXT NOT NULL,
          visitor_hash TEXT NOT NULL,
          view_bucket INTEGER NOT NULL,
          viewed_at INTEGER NOT NULL,
          country TEXT NOT NULL DEFAULT 'XX',
          referrer_host TEXT,
          UNIQUE(article_slug, visitor_hash, view_bucket)
        ) STRICT
      `),
      db.prepare('CREATE INDEX IF NOT EXISTS article_views_slug_time_idx ON article_views(article_slug, viewed_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS article_views_time_idx ON article_views(viewed_at)')
    ]).catch(error => {
      analyticsSchemaReady = null;
      throw error;
    });
  }
  return analyticsSchemaReady;
}

async function ensureCommentsSchema(db) {
  if (!commentsSchemaReady) {
    commentsSchemaReady = db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS article_comments (
          id TEXT PRIMARY KEY,
          article_slug TEXT NOT NULL,
          user_id TEXT NOT NULL,
          body TEXT NOT NULL CHECK (length(body) BETWEEN 2 AND 800),
          status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) STRICT
      `),
      db.prepare('CREATE INDEX IF NOT EXISTS article_comments_slug_time_idx ON article_comments(article_slug, created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS article_comments_user_idx ON article_comments(user_id)'),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS guest_article_comments (
          id TEXT PRIMARY KEY,
          article_slug TEXT NOT NULL,
          display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 30),
          body TEXT NOT NULL CHECK (length(body) BETWEEN 2 AND 800),
          status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        ) STRICT
      `),
      db.prepare('CREATE INDEX IF NOT EXISTS guest_article_comments_slug_time_idx ON guest_article_comments(article_slug, created_at)')
    ]).catch(error => {
      commentsSchemaReady = null;
      throw error;
    });
  }
  return commentsSchemaReady;
}

function normalizeCountry(value) {
  const country = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : 'XX';
}

function getReferrerHost(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname.slice(0, 253) || null;
  } catch {
    return null;
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
  const pepper = requirePasswordPepper(env);

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
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS, pepper);
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
  const pepper = requirePasswordPepper(env);

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
    await derivePasswordHash(password, '00000000000000000000000000000000', PASSWORD_ITERATIONS, pepper);
    throw new HttpError(401, '邮箱或密码不正确。');
  }

  const candidateHash = await derivePasswordHash(
    password,
    user.password_salt,
    user.password_iterations,
    pepper
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

function requirePasswordPepper(env) {
  const pepper = String(env.PASSWORD_PEPPER || '');
  if (pepper.length < 32) {
    throw new HttpError(503, '会员服务正在完成安全配置，请稍后再试。');
  }
  return pepper;
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
