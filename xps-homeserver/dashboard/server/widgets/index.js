// Every server-side widget. A tile widget also needs a front-end module with
// the same id in web/js/widgets/index.js; music and ambient have no tile and
// drive the features in web/js/features/ instead.
import ambient from './ambient.js';
import calendar from './calendar.js';
import commute from './commute.js';
import home from './home.js';
import music from './music.js';
import photos from './photos.js';
import server from './server.js';
import services from './services.js';
import todo from './todo.js';
import weather from './weather.js';

export default [weather, commute, photos, calendar, services, todo, server, home, music, ambient];
