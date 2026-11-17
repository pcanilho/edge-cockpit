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
