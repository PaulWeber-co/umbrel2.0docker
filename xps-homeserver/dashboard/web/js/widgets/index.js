// Every front-end widget module, by the id its server widget uses.
// A tile whose id has no module here shows a "kommt bald" placeholder.
import * as backup from './backup.js';
import * as dienste from './dienste.js';
import * as fotos from './fotos.js';
import * as home from './home.js';
import * as kal from './kal.js';
import * as server from './server.js';
import * as todo from './todo.js';
import * as weg from './weg.js';
import * as wetter from './wetter.js';
import * as wiki from './wiki.js';

export default { wetter, weg, backup, fotos, kal, dienste, todo, server, home, wiki };
