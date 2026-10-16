import { haConfigured, haRequest, haService, homeAssistantEntities } from './home-assistant.js';

const KEY = 'DASH_HA_HOME_ENTITIES';
const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'input_boolean']);

export function toWidgetData(states) {
  return states.map((state) => ({
    entityId: String(state.entity_id),
    name: String(state.attributes?.friendly_name ?? state.entity_id),
    state: String(state.state),
    domain: String(state.entity_id).split('.')[0],
    unit: String(state.attributes?.unit_of_measurement ?? ''),
    controllable: TOGGLEABLE.has(String(state.entity_id).split('.')[0]),
  }));
}

export default {
  id: 'home',
  intervalMs: 15_000,
  isConfigured: (config) => haConfigured(config) && homeAssistantEntities(config, KEY).length > 0,

  async fetch(ctx) {
    const entities = homeAssistantEntities(ctx.config, KEY).slice(0, 4);
    const states = await Promise.all(entities.map((id) => haRequest(ctx, `/api/states/${encodeURIComponent(id)}`)));
    return toWidgetData(states);
  },

  actions: {
    async toggle(ctx) {
      if (ctx.demo) return;
      const id = String(ctx.payload.entityId ?? '');
      if (!homeAssistantEntities(ctx.config, KEY).includes(id)) throw new Error('Dieses Gerät ist nicht freigegeben');
      const domain = id.split('.')[0];
      if (!TOGGLEABLE.has(domain)) throw new Error('Dieses Gerät kann hier nicht geschaltet werden');
      const service = ctx.payload.on === true ? 'turn_on' : 'turn_off';
      await haService(ctx, domain, service, { entity_id: id });
    },
  },

  demo: () => [
    { entityId: 'light.wohnen', name: 'Wohnzimmer', state: 'on', domain: 'light', unit: '', controllable: true },
    { entityId: 'sensor.wohnzimmer_temperatur', name: 'Temperatur', state: '21,5', domain: 'sensor', unit: '°C', controllable: false },
    { entityId: 'switch.kaffee', name: 'Kaffee', state: 'off', domain: 'switch', unit: '', controllable: true },
  ],
};
