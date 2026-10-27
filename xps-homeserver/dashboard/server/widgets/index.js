// Every server-side widget. A tile widget also needs a front-end module with
// the same id in web/js/widgets/index.js; music, minifunk and ambient have no
// tile and drive the features in web/js/features/ (or the control center).
import ambient from './ambient.js';
import backup from './backup.js';
import calendar from './calendar.js';
import commute from './commute.js';
import home from './home.js';
import minifunk from './minifunk.js';
import music from './music.js';
import photos from './photos.js';
import server from './server.js';
import services from './services.js';
import todo from './todo.js';
import weather from './weather.js';
import wiki from './wiki.js';

export default [weather, commute, backup, photos, calendar, services, todo, server, home, wiki, music, minifunk, ambient];
