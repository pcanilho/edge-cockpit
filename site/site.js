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
    const first = scenes.querySelector('[aria-pressed="true"]');
    frame.src = `demo/index.html?${first.dataset.scene}`;
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
      play(frame, b);
    }));
    play(frame, first);
  });

  // A scene with data-tele plays a real recording of the game's telemetry into the demo, over and
  // over, as the app gets it from the game: { log, actions, start, frames: [[ms, [[path, value]…]]…] }.
  let run = 0;
  async function play(frame, b) {
    const me = ++run, name = b.dataset.tele;
    if (!name) return;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const loaded = new Promise(r => frame.addEventListener('load', r, { once: true }));
    let rec;
    try { rec = await (await fetch(`tele/${name}.json`)).json(); } catch { return; }
    await loaded;
    // The console reads its own recorded log first; the recording's ship boards after that.
    for (let i = 0; i < 100 && me === run && !frame.contentDocument?.body?.dataset.ready; i++) await wait(100);
    await wait(800);
    const x = frame.contentWindow?.xfd;
    if (me !== run || !x) return;
    x.feed(rec.log);
    const set = (o, path, v) => { const ks = path.split('.'), last = ks.pop(); for (const k of ks) o = o[k]; o[last] = v; };
    const send = live => x.telemetry({ link: 'live', port: 2942, actions: rec.actions, live: structuredClone(live) });
    let shown = false;
    while (me === run) {
      const live = structuredClone(rec.start), t0 = performance.now();
      send(live);
      if (!shown && b.dataset.page) { await wait(1000); if (me !== run) return; x.show(b.dataset.page); shown = true; }
      for (const [ms, changes] of rec.frames) {
        const left = t0 + ms - performance.now();
        if (left > 0) await wait(left);
        if (me !== run) return;
        for (const [path, v] of changes) set(live, path, v);
        send(live);
      }
      await wait(1500);
    }
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
