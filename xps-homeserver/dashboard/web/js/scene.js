// Time of day decides the scene: background video, greeting, evening warm
// filter and the night view. Videos come from /media (see
// dashboard/scripts/fetch-backgrounds.sh); without them the CSS gradient of
// the scene shows instead.

const CLIPS = { morgen: ['morgen'], tag: ['tag', 'tal'], abend: ['abend'], nacht: ['nacht'] };
export const GREETINGS = { morgen: 'Guten Morgen', tag: 'Hallo', abend: 'Guten Abend', nacht: 'Gute Nacht' };

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// now: minutes since midnight; sun: { sunrise: "07:46", sunset: "18:24" }
export function sceneAt(now, sun = { sunrise: '07:00', sunset: '19:00' }) {
  const rise = minutes(sun.sunrise);
  const set = minutes(sun.sunset);
  if (now >= 22 * 60 + 30 || now < Math.min(rise - 60, 6 * 60)) return 'nacht';
  if (now < rise + 180) return 'morgen';
  if (now < set - 90) return 'tag';
  return 'abend';
}

export function createScenes(stage) {
  const videos = [stage.querySelector('#v1'), stage.querySelector('#v2')];
  let front = 0;
  let scene = null;
  let clip = 0;

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
        if (!current.classList.contains('on')) current.pause();
      }, 2000);
    };
    // A missing video only means no video: the gradient behind it stays.
    next.onerror = () => next.classList.remove('on');
    next.play().then(show, () => {});
  }

  // Scenes with several clips switch every two loops (23 s).
  setInterval(() => {
    if (!scene || CLIPS[scene].length < 2 || stage.dataset.scene === 'nacht') return;
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
      if (name === 'nacht') videos.forEach((video) => video.pause());
      else play(CLIPS[name][0]);
    },
  };
}
