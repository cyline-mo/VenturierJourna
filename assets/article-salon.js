(() => {
  'use strict';

  const match = location.pathname.match(/\/articles\/([^/]+)\.html$/);
  if (!match) return;
  const articleSlug = decodeURIComponent(match[1]);
  const endpoint = `/api/articles/${encodeURIComponent(articleSlug)}/comments`;

  let salon = document.querySelector('#salon');
  if (!salon) {
    salon = document.createElement('section');
    salon.className = 'salon';
    salon.id = 'salon';
    salon.setAttribute('aria-labelledby', 'salonTitle');
    salon.innerHTML = '<div class="salon__inner"><div class="salon__eyebrow">Article salon · 文章沙龙</div><h2 id="salonTitle">回应与讨论</h2><p class="salon__intro">游客可以使用昵称直接参加讨论；会员登录后将使用会员名称。</p><div id="salonMount"></div></div>';
    document.querySelector('main')?.insertAdjacentElement('afterend', salon);
  }

  const mount = salon.querySelector('#salonMount');
  if (!mount) return;
  mount.innerHTML = `
    <form class="salon__composer" id="salonForm">
      <p class="salon__identity" id="salonIdentity" hidden></p>
      <div class="salon__guest-fields" id="salonGuestFields">
        <label class="salon__field" for="salonName"><span class="salon__eyebrow">游客昵称</span><input id="salonName" name="displayName" minlength="2" maxlength="30" autocomplete="nickname" placeholder="写下你的称呼" required></label>
        <span class="salon__guest-note">无需注册或登录</span>
      </div>
      <label class="salon__field" for="salonContent"><span class="salon__eyebrow">你的回应</span><textarea id="salonContent" name="content" minlength="2" maxlength="800" required placeholder="写下你的判断、补充或异议……"></textarea></label>
      <label class="salon__trap" aria-hidden="true">Website<input id="salonWebsite" name="website" tabindex="-1" autocomplete="off"></label>
      <div class="salon__actions"><span class="salon__count" id="salonCount">0 / 800</span><button class="salon__submit" type="submit">发表回应</button></div>
    </form>
    <p class="salon__status" id="salonStatus" aria-live="polite">正在载入沙龙……</p>
    <div class="salon__list" id="salonList"></div>`;

  const form = salon.querySelector('#salonForm');
  const identity = salon.querySelector('#salonIdentity');
  const guestFields = salon.querySelector('#salonGuestFields');
  const nameInput = salon.querySelector('#salonName');
  const textarea = salon.querySelector('#salonContent');
  const website = salon.querySelector('#salonWebsite');
  const counter = salon.querySelector('#salonCount');
  const status = salon.querySelector('#salonStatus');
  const list = salon.querySelector('#salonList');
  const submit = form.querySelector('button[type="submit"]');
  let authenticated = false;

  const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });

  function commentElement(comment) {
    const article = document.createElement('article');
    article.className = 'salon__comment';
    const meta = document.createElement('div');
    const author = document.createElement('div');
    author.className = 'salon__author';
    author.textContent = comment.displayName || '游客';
    const badge = document.createElement('span');
    badge.className = 'salon__badge';
    badge.textContent = comment.authorKind === 'member' ? '会员' : '游客';
    author.append(badge);
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
    const displayName = nameInput.value.trim();
    if (!authenticated && (displayName.length < 2 || displayName.length > 30)) {
      status.textContent = '请填写 2—30 个字符的游客昵称。';
      nameInput.focus();
      return;
    }
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
        body: JSON.stringify({ content, displayName, website: website.value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '暂时无法发表评论。');
      const empty = list.querySelector('.salon__empty');
      if (empty) empty.remove();
      list.append(commentElement(data.comment));
      textarea.value = '';
      counter.textContent = '0 / 800';
      status.textContent = '回应已发表，将在每日 GitHub 备份中存档。';
    } catch (error) {
      status.textContent = error.message || '暂时无法发表评论。';
    } finally {
      submit.disabled = false;
    }
  });

  fetch(endpoint, { credentials: 'same-origin' })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '暂时无法载入评论。');
      renderComments(data.comments || []);
      status.textContent = `${(data.comments || []).length} 条回应 · 每日备份至 GitHub`;
    })
    .catch(error => {
      renderComments([]);
      status.textContent = error.message || '暂时无法载入评论。';
    });

  fetch('/api/auth/session', { credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : { authenticated: false })
    .then(session => {
      authenticated = Boolean(session.authenticated && ['member', 'admin'].includes(session.user?.role));
      guestFields.hidden = authenticated;
      nameInput.required = !authenticated;
      identity.hidden = !authenticated;
      if (authenticated) identity.textContent = `以 ${session.user.displayName} 的会员身份参加沙龙。`;
    })
    .catch(() => {
      authenticated = false;
      guestFields.hidden = false;
      nameInput.required = true;
    });
})();
