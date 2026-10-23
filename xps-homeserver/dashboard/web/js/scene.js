// Time of day decides the scene: background video, greeting and the evening
// warm filter. "spaet" is the late evening and the small hours with the
// dashboard still on; "nacht", the dimmed clock alone, comes only from the
// control center (features/display.js), which follows the schedule. Videos
// come from /media (see dashboard/scripts/fetch-backgrounds.sh); without them,
// or with videos switched off in the control center, the scene's CSS
// gradient shows instead.

const CLIPS = { morgen: ['morgen'], tag: ['tag', 'tal'], abend: ['abend'], spaet: ['nacht'], nacht: [] };
export const GREETINGS = { morgen: 'Guten Morgen', tag: 'Hallo', abend: 'Guten Abend', spaet: 'Gute Nacht', nacht: 'Gute Nacht' };

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// now: minutes since midnight; sun: { sunrise: "07:46", sunset: "18:24" }
export function sceneAt(now, sun = { sunrise: '07:00', sunset: '19:00' }) {
  const rise = minutes(sun.sunrise);
  const set = minutes(sun.sunset);
  if (now >= 22 * 60 + 30 || now < Math.min(rise - 60, 6 * 60)) return 'spaet';
  if (now < rise + 180) return 'morgen';
  if (now < set - 90) return 'tag';
  return 'abend';
}

export function createScenes(stage) {
  const videos = [stage.querySelector('#v1'), stage.querySelector('#v2')];
  let front = 0;
  let scene = null;
  let clip = 0;
  let videosOn = true;

  const stopVideos = () =>
    videos.forEach((video) => {
      video.pause();
      video.classList.remove('on');
    });

  function play(name) {
    if (!videosOn || !name) return;
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
        if (!current.classList.contains('on')) current.pause();
      }, 2000);
    };
    // A missing video only means no video: the gradient behind it stays.
    next.onerror = () => next.classList.remove('on');
    next.play().then(show, () => {});
  }

  // Scenes with several clips switch every two loops (23 s).
  setInterval(() => {
    if (!scene || CLIPS[scene].length < 2 || !videosOn) return;
    clip = (clip + 1) % CLIPS[scene].length;
    play(CLIPS[scene][clip]);
  }, 23_000);

  return {
    get scene() {
      return scene;
    },
    set(name) {
      if (name === scene) return;
      scene = name;
      clip = 0;
      stage.dataset.scene = name;
      if (!CLIPS[name]?.length) stopVideos();
      else play(CLIPS[name][0]);
    },
    // Off: no decoding at all (control center switch, or a dark kiosk screen)
    setVideos(on) {
      if (on === videosOn) return;
      videosOn = on;
      if (!on) stopVideos();
      else if (scene) play(CLIPS[scene]?.[clip] ?? CLIPS[scene]?.[0]);
    },
  };
}
