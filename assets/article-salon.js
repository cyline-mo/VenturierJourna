(() => {
  'use strict';

  const match = location.pathname.match(/\/articles\/([^/]+)\.html$/);
  if (!match) return;
  const articleSlug = decodeURIComponent(match[1]);
  const endpoint = `/api/articles/${encodeURIComponent(articleSlug)}/comments`;

  const style = document.createElement('style');
  style.textContent = `
    .salon{border-top:1px solid var(--line);background:color-mix(in srgb,var(--paper) 94%,var(--moss) 6%)}
    .salon__inner{width:min(calc(100% - 3rem),820px);margin:auto;padding:clamp(4rem,8vw,7rem) 0}
    .salon__eyebrow{color:var(--accent);font:650 .62rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase}
    .salon h2{margin:.9rem 0 .8rem;font:400 clamp(2.5rem,6vw,4.6rem)/1 var(--display);letter-spacing:-.045em}
    .salon__intro{max-width:680px;margin:0;color:var(--muted);font-size:.9rem}
    .salon__access,.salon__composer{margin-top:2rem;padding:1.2rem;border:1px solid var(--line);background:var(--paper)}
    .salon__access a{color:var(--accent);font-weight:700;text-decoration:none}
    .salon__identity{margin:0 0 .8rem;color:var(--muted);font-size:.76rem}
    .salon textarea{display:block;width:100%;min-height:120px;resize:vertical;border:1px solid var(--line);padding:1rem;background:transparent;color:var(--ink);font:inherit;line-height:1.7}
    .salon textarea:focus{outline:2px solid color-mix(in srgb,var(--accent) 55%,transparent);outline-offset:2px}
    .salon__actions{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:.8rem}
    .salon__count{color:var(--muted);font:600 .62rem/1 var(--mono)}
    .salon__submit{border:0;border-radius:999px;padding:.78rem 1.2rem;background:var(--ink);color:var(--paper);font-weight:700;cursor:pointer}
    .salon__submit:disabled{opacity:.55;cursor:wait}
    .salon__status{min-height:1.4em;margin:1rem 0 0;color:var(--muted);font-size:.76rem}
    .salon__list{margin-top:2.2rem;border-top:1px solid var(--line)}
    .salon__comment{display:grid;grid-template-columns:145px minmax(0,1fr);gap:1.2rem;padding:1.35rem 0;border-bottom:1px solid var(--line)}
    .salon__author{font-weight:750}.salon__time{display:block;margin-top:.25rem;color:var(--muted);font:500 .58rem/1.4 var(--mono)}
    .salon__body{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--display);font-size:1.04rem;line-height:1.8}
    .salon__empty{padding:2rem 0;color:var(--muted);font-size:.85rem}
    @media(max-width:620px){.salon__inner{width:min(calc(100% - 2rem),820px)}.salon__comment{grid-template-columns:1fr;gap:.65rem}.salon__actions{align-items:flex-end}}
  `;
  document.head.append(style);

  const salon = document.createElement('section');
  salon.className = 'salon';
  salon.id = 'salon';
  salon.setAttribute('aria-labelledby', 'salonTitle');
  salon.innerHTML = `
    <div class="salon__inner">
      <div class="salon__eyebrow">Article salon · 文章沙龙</div>
      <h2 id="salonTitle">回应与讨论</h2>
      <p class="salon__intro">评论向所有读者公开。注册会员可以参与讨论；请回应观点本身，并保留彼此改变判断的空间。</p>
      <div class="salon__access" id="salonAccess" hidden>想参加讨论？<a href="../index.html#access">登录或注册会员 →</a></div>
      <form class="salon__composer" id="salonForm" hidden>
        <p class="salon__identity" id="salonIdentity"></p>
        <label for="salonContent" class="salon__eyebrow">你的回应</label>
        <textarea id="salonContent" name="content" minlength="2" maxlength="800" required placeholder="写下你的判断、补充或异议……"></textarea>
        <div class="salon__actions"><span class="salon__count" id="salonCount">0 / 800</span><button class="salon__submit" type="submit">发表回应</button></div>
      </form>
      <p class="salon__status" id="salonStatus" aria-live="polite">正在载入沙龙……</p>
      <div class="salon__list" id="salonList"></div>
    </div>`;
  document.querySelector('main')?.append(salon);

  const access = salon.querySelector('#salonAccess');
  const form = salon.querySelector('#salonForm');
  const identity = salon.querySelector('#salonIdentity');
  const textarea = salon.querySelector('#salonContent');
  const counter = salon.querySelector('#salonCount');
  const status = salon.querySelector('#salonStatus');
  const list = salon.querySelector('#salonList');
  const submit = form.querySelector('button[type="submit"]');

  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  function commentElement(comment) {
    const article = document.createElement('article');
    article.className = 'salon__comment';
    const meta = document.createElement('div');
    const author = document.createElement('div');
    author.className = 'salon__author';
    author.textContent = comment.displayName || '会员';
    const time = document.createElement('time');
    time.className = 'salon__time';
    time.dateTime = new Date(comment.createdAt * 1000).toISOString();
    time.textContent = dateFormatter.format(new Date(comment.createdAt * 1000));
    meta.append(author, time);
    const body = document.createElement('p');
    body.className = 'salon__body';
    body.textContent = comment.content;
    article.append(meta, body);
    return article;
  }

  function renderComments(comments) {
    list.replaceChildren();
    if (!comments.length) {
      const empty = document.createElement('p');
      empty.className = 'salon__empty';
      empty.textContent = '还没有回应。你可以成为第一位参加沙龙的人。';
      list.append(empty);
      return;
    }
    comments.forEach(comment => list.append(commentElement(comment)));
  }

  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length} / 800`;
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const content = textarea.value.trim();
    if (content.length < 2) {
      status.textContent = '请至少写下 2 个字符。';
      return;
    }
    submit.disabled = true;
    status.textContent = '正在发表……';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '暂时无法发表评论。');
      const empty = list.querySelector('.salon__empty');
      if (empty) empty.remove();
      list.append(commentElement(data.comment));
      textarea.value = '';
      counter.textContent = '0 / 800';
      status.textContent = '回应已发表。';
    } catch (error) {
      status.textContent = error.message || '暂时无法发表评论。';
    } finally {
      submit.disabled = false;
    }
  });

  Promise.all([
    fetch(endpoint, { credentials: 'same-origin' }),
    fetch('/api/auth/session', { credentials: 'same-origin' })
  ]).then(async ([commentsResponse, sessionResponse]) => {
    if (!commentsResponse.ok) throw new Error('暂时无法载入评论。');
    const commentsData = await commentsResponse.json();
    renderComments(commentsData.comments || []);
    status.textContent = `${(commentsData.comments || []).length} 条回应`;

    const sessionData = sessionResponse.ok ? await sessionResponse.json() : { authenticated: false };
    const canComment = sessionData.authenticated && ['member', 'admin'].includes(sessionData.user?.role);
    form.hidden = !canComment;
    access.hidden = canComment;
    if (canComment) identity.textContent = `以 ${sessionData.user.displayName} 的身份参加沙龙。`;
  }).catch(error => {
    status.textContent = error.message || '暂时无法载入评论。';
    access.hidden = false;
  });
})();
