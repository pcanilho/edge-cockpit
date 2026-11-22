// Screenshots open full size, and the download links follow the newest release
// even if it came out after the site was last built.
(() => {
  const box = document.querySelector('.lightbox');
  if (box && box.showModal) {
    // Shows a copy of the clicked screenshot (the same file at full size), so no URL is read back from the page.
    document.querySelectorAll('.shot, .bezel a').forEach(a => a.addEventListener('click', e => {
      const thumb = a.querySelector('img');
      if (!thumb) return;
      e.preventDefault();
      const big = thumb.cloneNode(false);
      for (const at of ['loading', 'width', 'height']) big.removeAttribute(at);
      box.querySelector('img').replaceWith(big);
      box.showModal();
    }));
    box.addEventListener('click', () => box.close());
  }

  // Try it live: the hero's screenshot becomes the console itself (demo/, the released version),
  // scaled to fit, with keys for a few recorded scenes. It loads only when asked.
  const fig = document.querySelector('.device'), start = fig?.querySelector('[data-demo-start]');
  if (fig && start) start.addEventListener('click', () => {
    const bezel = fig.querySelector('.bezel'), scenes = fig.querySelector('.scenes'), cap = fig.querySelector('figcaption');
    const live = document.createElement('div');
    live.className = 'live';
    const frame = document.createElement('iframe');
    frame.title = 'Edge Cockpit live demo';
    frame.src = 'demo/index.html?demo=ship';
    live.append(frame);
    bezel.replaceChildren(live);
    const fit = () => { frame.style.transform = `scale(${live.clientWidth / 2560})`; };
    new ResizeObserver(fit).observe(live);
    fit();
    fig.classList.add('is-live');
    start.hidden = true;
    scenes.hidden = false;
    if (cap?.dataset.captionLive) cap.textContent = cap.dataset.captionLive;
    scenes.querySelectorAll('[data-scene]').forEach(b => b.addEventListener('click', () => {
      scenes.querySelectorAll('[data-scene]').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      frame.src = `demo/index.html?${b.dataset.scene}`;
    }));
  });

  const built = document.documentElement.dataset.version || '';
  fetch('https://api.github.com/repos/pcanilho/edge-cockpit/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => (r.ok ? r.json() : null))
    .then(rel => {
      if (!rel || !rel.tag_name || rel.tag_name === built) return;
      const asset = re => (rel.assets || []).find(a => re.test(a.name));
      const setup = asset(/-setup\.exe$/i), portable = asset(/-portable\.exe$/i), sums = asset(/^SHA256SUMS/i);
      const set = (key, fn) => document.querySelectorAll(`[data-rel="${key}"]`).forEach(fn);
      if (setup) set('setup', a => { a.href = setup.browser_download_url; });
      if (portable) set('portable', a => { a.href = portable.browser_download_url; });
      if (sums) set('sums', a => { a.href = sums.browser_download_url; });
      set('notes', a => { a.href = rel.html_url; });
      set('version', s => { s.textContent = rel.tag_name; });
      const d = new Date(rel.published_at);
      if (!isNaN(d)) set('date', s => { s.textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); });
    })
    .catch(() => {});
})();
