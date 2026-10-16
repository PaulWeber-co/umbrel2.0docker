const MUSIC_RECTS = new Map([
  ['wetter', [1336, 80, 488, 290]],
  ['weg', [1336, 394, 232, 290]],
  ['home', [1592, 394, 232, 290]],
  ['server', [1336, 708, 488, 290]],
]);

export function init(ctx) {
  const { stage, relayout } = ctx;
  const cover = document.querySelector('#cover');
  const title = document.querySelector('#ptitle');
  const artist = document.querySelector('#partist');
  const album = document.querySelector('#palbum');
  const progress = document.querySelector('.player .prog');
  const progressBar = document.querySelector('#pbar');
  const position = document.querySelector('#ppos');
  const duration = document.querySelector('#pdur');
  let active = false;
  let shownCover = '';
  let track = null;

  const clock = (seconds) => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  };

  function updateProgress() {
    const total = Number(track?.durationSeconds);
    if (!active || !(total > 0)) {
      progress.hidden = true;
      return;
    }
    const start = Number(track.positionSeconds) || 0;
    const elapsed = Math.min(total, start + Math.max(0, Date.now() - Number(track.progressAt)) / 1000);
    progress.hidden = false;
    progressBar.style.transform = `scaleX(${elapsed / total})`;
    position.textContent = clock(elapsed);
    duration.textContent = clock(total);
  }

  ctx.setRectsProvider((layout) => {
    if (!active) return null;
    const visible = new Set(layout.tiles.map((tile) => tile.id));
    return new Map([...MUSIC_RECTS].filter(([id]) => visible.has(id)));
  });
  ctx.onEntry('music', (entry) => {
    const data = entry?.data;
    track = data;
    const nextActive = Boolean(data?.active);
    if (active !== nextActive) {
      active = nextActive;
      stage.dataset.music = active ? '1' : '0';
      relayout(true);
    }
    title.textContent = data?.title || (active ? 'AirPlay verbunden' : '');
    artist.textContent = data?.artist || '';
    album.textContent = data?.album || '';
    const nextCover = typeof data?.coverDataUrl === 'string' && data.coverDataUrl.startsWith('data:image/')
      ? data.coverDataUrl
      : '';
    if (shownCover !== nextCover) {
      shownCover = nextCover;
      if (shownCover) cover.src = shownCover;
      else cover.removeAttribute('src');
    }
    updateProgress();
  });
  setInterval(updateProgress, 1000);
}
