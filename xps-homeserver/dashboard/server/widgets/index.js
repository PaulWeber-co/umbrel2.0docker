// Every server-side widget. A new widget: add its module here and a front-end
// module with the same id in web/js/widgets/index.js.
import commute from './commute.js';
import home from './home.js';
import music from './music.js';
import photos from './photos.js';
import weather from './weather.js';

export default [weather, commute, photos, home, music];
