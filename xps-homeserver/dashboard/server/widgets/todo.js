// To-dos ("To-dos"): a list from Apple's Reminders app or a Home Assistant
// to-do entity. Ticking off and adding on the wall go back to the source.
//
//   DASH_REMINDERS_LIST   the name of a Reminders list, e.g. Einkauf. An iOS
//                         shortcut keeps it in sync (sources/reminders.js,
//                         docs/betrieb.md); takes precedence over HA.
//   DASH_HA_TODO_ENTITY   e.g. todo.einkaufsliste, with DASH_HA_URL and DASH_HA_TOKEN
import * as reminders from '../sources/reminders.js';
import { haConfigured, haRequest } from './home-assistant.js';

function entity(config) {
  const value = config.get('DASH_HA_TODO_ENTITY');
  return /^todo\.[a-z0-9_]+$/.test(value) ? value : '';
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

const remindersList = (config) => config.get('DASH_REMINDERS_LIST').trim().slice(0, 60);

// The wall and the shortcut may change the list at the same moment: one
// change after the other, so neither overwrites the other
let queue = Promise.resolve();
function changeReminders(ctx, change) {
  const run = queue.then(async () => {
    const before = await ctx.store.read(reminders.FILE, reminders.emptyState());
    const { state, result } = change(before);
    await ctx.store.write(reminders.FILE, state);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function serviceResult(response) {
  return response?.service_response ?? response;
}

export function toWidgetData(response, listEntity) {
  const items = serviceResult(response)?.[listEntity]?.items ?? [];
  return items
    .filter((item) => item.status !== 'completed')
    .slice(0, 5)
    .map((item) => ({ uid: String(item.uid ?? item.summary), summary: String(item.summary ?? ''), due: item.due ?? null }));
}

async function getItems(ctx, listEntity) {
  const response = await haRequest(ctx, '/api/services/todo/get_items?return_response', {
    method: 'POST',
    body: { entity_id: listEntity, status: ['needs_action'] },
  });
  return toWidgetData(response, listEntity);
}

export default {
  id: 'todo',
  intervalMs: 60_000,
  isConfigured: (config) => Boolean(remindersList(config)) || (haConfigured(config) && Boolean(entity(config))),

  async fetch(ctx) {
    const list = remindersList(ctx.config);
    if (list) return reminders.toWidgetData(await ctx.store.read(reminders.FILE, reminders.emptyState()), list);
    return getItems(ctx, entity(ctx.config));
  },

  actions: {
    // From the iOS shortcut: the open reminders in, the wall's changes out
    async sync(ctx) {
      if (!remindersList(ctx.config)) throw Object.assign(new Error('DASH_REMINDERS_LIST ist nicht gesetzt'), { status: 404 });
      const titles = reminders.cleanTitles(ctx.payload);
      return changeReminders(ctx, (before) => {
        const { state, reply } = reminders.applySync(before, titles, Date.now());
        return { state, result: reply };
      });
    },
    async add(ctx) {
      if (ctx.demo) return;
      const title = String(ctx.payload.item ?? '').trim();
      if (!title || title.length > 160) throw badRequest('Aufgabe muss zwischen 1 und 160 Zeichen lang sein');
      if (remindersList(ctx.config)) {
        await changeReminders(ctx, (before) => ({ state: reminders.addItem(before, title, Date.now()) }));
        return;
      }
      await haRequest(ctx, '/api/services/todo/add_item', {
        method: 'POST',
        body: { entity_id: entity(ctx.config), item: title },
      });
    },
    async complete(ctx) {
      if (ctx.demo) return;
      const uid = String(ctx.payload.uid ?? '').trim();
      if (!uid || uid.length > 180) throw badRequest('Ungültige Aufgaben-ID');
      if (remindersList(ctx.config)) {
        await changeReminders(ctx, (before) => ({ state: reminders.complete(before, uid, Date.now()) }));
        return;
      }
      await haRequest(ctx, '/api/services/todo/update_item', {
        method: 'POST',
        body: { entity_id: entity(ctx.config), item: uid, status: 'completed' },
      });
    },
  },

  demo: () => [
    { uid: 'demo-1', summary: 'Paket abholen', due: null },
    { uid: 'demo-2', summary: 'Kaffee kaufen', due: null },
    { uid: 'demo-3', summary: 'Pflanzen gießen', due: null },
  ],
};
