(() => {
  const match = location.pathname.match(/\/articles\/([^/]+)\.html$/);
  if (!match) return;

  const articleSlug = decodeURIComponent(match[1]);
  let visibleSeconds = 0;
  let sent = false;

  function recordRead() {
    if (sent) return;
    sent = true;
    clearInterval(timer);
    const payload = JSON.stringify({ articleSlug });

    if (navigator.sendBeacon) {
      const body = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/analytics/article-view', body)) return;
    }

    fetch('/api/analytics/article-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      credentials: 'same-origin',
      keepalive: true
    }).catch(() => {
      // Analytics must never interrupt public reading.
    });
  }

  const timer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    visibleSeconds += 1;
    if (visibleSeconds >= 6) recordRead();
  }, 1000);
})();
