// Every server-side widget. A new widget: add its module here and a front-end
// module with the same id in web/js/widgets/index.js.
import weather from './weather.js';
import server from './server.js';
import commute from './commute.js';
import photos from './photos.js';
import calendar from './calendar.js';
import todo from './todo.js';
import home from './home.js';

export default [weather, server, commute, photos, calendar, todo, home];
