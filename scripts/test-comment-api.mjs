import worker from '../src/worker.js';

const saved = [];
const db = {
  prepare(sql) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async first() {
        if (sql.includes('auth_rate_limits')) return null;
        return null;
      },
      async run() {
        if (sql.includes('INSERT INTO guest_article_comments')) {
          saved.push({
            id: values[0],
            article_slug: values[1],
            display_name: values[2],
            body: values[3],
            created_at: values[4],
            author_kind: 'guest'
          });
        }
        return { meta: { changes: 1 } };
      },
      async all() {
        if (sql.includes('guest_article_comments')) return { results: saved };
        return { results: [] };
      }
    };
  },
  async batch(statements) {
    return Promise.all(statements.map(statement => statement.run()));
  }
};

const env = {
  DB: db,
  PASSWORD_PEPPER: 'test-only-pepper-value-at-least-32-characters',
  ASSETS: { fetch: request => new Response(request.url) }
};
const endpoint = 'https://venturierjournal.com/api/articles/will-the-border-close-after-september-15/comments';

const post = await worker.fetch(new Request(endpoint, {
  method: 'POST',
  headers: {
    Origin: 'https://venturierjournal.com',
    'Content-Type': 'application/json',
    'CF-Connecting-IP': '203.0.113.12'
  },
  body: JSON.stringify({ displayName: '路过的读者', content: '这是一条游客测试回应。' })
}), env);
if (post.status !== 201) throw new Error('Guest post failed: HTTP ' + post.status);
const posted = await post.json();
if (posted.comment.authorKind !== 'guest' || posted.comment.displayName !== '路过的读者') {
  throw new Error('Guest identity was not returned correctly');
}

const get = await worker.fetch(new Request(endpoint), env);
const listed = await get.json();
if (get.status !== 200 || listed.comments.length !== 1 || listed.comments[0].content !== '这是一条游客测试回应。') {
  throw new Error('Guest comment listing failed');
}

const invalid = await worker.fetch(new Request(endpoint, {
  method: 'POST',
  headers: {
    Origin: 'https://venturierjournal.com',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ displayName: 'A', content: '昵称太短。' })
}), env);
if (invalid.status !== 400) throw new Error('Invalid guest nickname should be rejected');

console.log('Guest comment API tests passed.');
