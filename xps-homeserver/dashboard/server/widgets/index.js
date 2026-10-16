// Every dashboard data source. Tiles also have a renderer in web/js/widgets;
// non-tile features such as music mode consume same-named modules in web/js/features.
import weather from './weather.js';
import server from './server.js';
import commute from './commute.js';
import photos from './photos.js';
import calendar from './calendar.js';
import todo from './todo.js';
import home from './home.js';
import music from './music.js';
import ambient from './ambient.js';

export default [weather, server, commute, photos, calendar, todo, home, music, ambient];
