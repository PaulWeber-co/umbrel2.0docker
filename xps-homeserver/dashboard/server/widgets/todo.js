import { haConfigured, haRequest } from './home-assistant.js';

function entity(config) {
  const value = config.get('DASH_HA_TODO_ENTITY');
  return /^todo\.[a-z0-9_]+$/.test(value) ? value : '';
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
  isConfigured: (config) => haConfigured(config) && Boolean(entity(config)),

  async fetch(ctx) {
    return getItems(ctx, entity(ctx.config));
  },

  actions: {
    async add(ctx) {
      if (ctx.demo) return;
      const title = String(ctx.payload.item ?? '').trim();
      if (!title || title.length > 160) throw new Error('Aufgabe muss zwischen 1 und 160 Zeichen lang sein');
      await haRequest(ctx, '/api/services/todo/add_item', {
        method: 'POST',
        body: { entity_id: entity(ctx.config), item: title },
      });
    },
    async complete(ctx) {
      if (ctx.demo) return;
      const uid = String(ctx.payload.uid ?? '').trim();
      if (!uid || uid.length > 180) throw new Error('Ungültige Aufgaben-ID');
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
