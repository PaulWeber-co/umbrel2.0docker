// Every front-end widget module, by the id its server widget uses.
// A tile whose id has no module here shows a "kommt bald" placeholder.
import * as wetter from './wetter.js';
import * as server from './server.js';
import * as weg from './weg.js';
import * as fotos from './fotos.js';
import * as kal from './kal.js';
import * as todo from './todo.js';
import * as home from './home.js';

export default { wetter, server, weg, fotos, kal, todo, home };
