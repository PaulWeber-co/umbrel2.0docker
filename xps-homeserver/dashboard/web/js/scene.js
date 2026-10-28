// Time of day decides the scene: background video and the evening warm
// filter. "abend" is the last light around sunset; "spaet" starts half an
// hour after sunset (22:30 at the latest) and runs through the night with
// city lights; "nacht", the dimmed clock alone, comes only from the
// control center (features/display.js), which follows the schedule.
//
// Videos are aerial clips from /media, a small pool per scene (see
// dashboard/scripts/backgrounds.txt and server/backgrounds.js). Each day
// plays two of them per scene, the next two the day after, so the wall
// walks through the whole pool over the days. To keep the XPS cool only one
// video decodes at a time (two for the 1.8 s crossfade), the day's clips take
// turns once a minute, and with videos switched off in the control center the
// clip's still picture stays instead. Without any clips the scene's CSS
// gradient shows.

export const PER_DAY = 2;
const ROTATE_MS = 60_000;

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// now: minutes since midnight; sun: { sunrise: "07:46", sunset: "18:24" }
export function sceneAt(now, sun = { sunrise: '07:00', sunset: '19:00' }) {
  const rise = minutes(sun.sunrise);
  const set = minutes(sun.sunset);
  if (now >= Math.min(set + 30, 22 * 60 + 30) || now < Math.min(rise - 60, 6 * 60)) return 'spaet';
  if (now < rise + 180) return 'morgen';
  if (now < set - 90) return 'tag';
  return 'abend';
}

// The local date as a day number (days since 1 January 1970), for clipsFor
export const dayNumber = (year, month, day) => Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);

// pool: { tag: ['tag-15919', 'tag-26940', …], … } → the clips of that day
export function clipsFor(pool, scene, day) {
  const all = Array.isArray(pool?.[scene]) ? pool[scene] : [];
  if (all.length <= PER_DAY) return [...all];
  const start = (((day * PER_DAY) % all.length) + all.length) % all.length;
  return Array.from({ length: PER_DAY }, (_, i) => all[(start + i) % all.length]);
}

export function createScenes(stage) {
  const videos = [stage.querySelector('#v1'), stage.querySelector('#v2')];
  let pool = {};
  let front = 0;
  let scene = null;
  let today = null;
  let clips = [];
  let clip = 0;
  let videosOn = true;

  const release = (video) => {
    video.pause();
    video.removeAttribute('src');
    video.load(); // frees the decoder
  };

  const stopVideos = () =>
    videos.forEach((video) => {
      release(video);
      video.classList.remove('on');
    });

  // Videos off: the picture of the clip, without decoding a single frame
  function still(name) {
    videos.forEach(release);
    videos[1 - front].classList.remove('on');
    videos[front].poster = `/media/${name}.jpg`;
    videos[front].classList.add('on');
  }

  function play(name) {
    const next = videos[1 - front];
    const current = videos[front];
    next.muted = true;
    next.poster = `/media/${name}.jpg`;
    next.src = `/media/${name}.mp4`;
    const show = () => {
      next.classList.add('on');
      current.classList.remove('on');
      front = 1 - front;
      setTimeout(() => {
        if (!current.classList.contains('on')) release(current);
      }, 2000);
    };
    // A missing video only means no video: the gradient behind it stays.
    next.onerror = () => next.src && next.classList.remove('on');
    next.play().then(show, () => {});
  }

  function show(name) {
    if (!name) stopVideos();
    else if (!videosOn) still(name);
    else play(name);
  }

  setInterval(() => {
    if (clips.length < 2 || !videosOn) return;
    clip = (clip + 1) % clips.length;
    play(clips[clip]);
  }, ROTATE_MS);

  // name: the scene; day: dayNumber() of the local date
  function set(name, day = today ?? 0) {
    if (name === scene && day === today) return;
    const playing = name === scene ? clips[clip] : null;
    scene = name;
    today = day;
    stage.dataset.scene = name;
    clips = clipsFor(pool, name, day);
    // A new day in the same scene keeps a clip that is still among the chosen
    if (playing && clips.includes(playing)) {
      clip = clips.indexOf(playing);
      return;
    }
    clip = 0;
    show(clips[0]);
  }

  return {
    get scene() {
      return scene;
    },
    set,
    // The clips on disk, from /api/state
    setPool(next) {
      pool = next && typeof next === 'object' ? next : {};
      const [name, day] = [scene, today];
      scene = null;
      if (name) set(name, day);
    },
    // Off: no decoding at all (control center switch, or a dark kiosk screen)
    setVideos(on) {
      if (on === videosOn) return;
      videosOn = on;
      if (scene) show(clips[clip]);
    },
  };
}
