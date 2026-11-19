(function () {
  if (!/[?&]probe=1/.test(location.search)) return;
  let said = 'none';
  try {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    if (g) {
      const i = g.getExtension('WEBGL_debug_renderer_info');
      said = String(g.getParameter(i ? i.UNMASKED_RENDERER_WEBGL : g.RENDERER));
      const lose = g.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) {
    said = 'error ' + e;
  }
  console.log('SPIKE webgl=' + said);
  setTimeout(() => console.log('SPIKE ext=' + (document.documentElement.dataset.spikeExt || '0')), 2000);
})();
