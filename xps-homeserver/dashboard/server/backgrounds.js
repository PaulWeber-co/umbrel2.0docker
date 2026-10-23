// The background clips on disk, by scene. fetch-backgrounds.sh names each
// <scene>-<Mixkit id>.mp4 (with a <scene>-<id>.jpg poster), so the pool is
// simply what is in DASH_MEDIA_DIR: a new line in backgrounds.txt and one
// more run of the script, and the wall has one more clip to choose from.
// Which of them play on a given day decides the front end (web/js/scene.js).
import { readdir } from 'node:fs/promises';

export const SCENES = ['morgen', 'tag', 'abend', 'spaet'];
const CLIP = /^(morgen|tag|abend|spaet)-([a-z0-9]+)\.mp4$/;

// { morgen: ['morgen-35078', …], tag: […], abend: […], spaet: […] }
export async function listBackgrounds(dir) {
  const pool = Object.fromEntries(SCENES.map((scene) => [scene, []]));
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return pool; // no media folder: the gradients show
  }
  for (const file of files.sort()) {
    const match = CLIP.exec(file);
    if (match) pool[match[1]].push(file.slice(0, -'.mp4'.length));
  }
  return pool;
}
