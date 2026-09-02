/** Export the master tag database to docs/TAG-LIST.csv for the panel builder. */
import { ALL_TAGS, AREAS, DEVICES } from '../server/tags.js';
import fs from 'node:fs';
const areaMap = Object.fromEntries(AREAS.map(a => [a.id, a]));
const head = ['Tag','Name','Description','Subsystem','Area','Unit','Kind','Min','Max','Precision',
  'LL','L','H','HH','Suppressed by','Device','Modbus slave','Function','Register','Data type','Scale','Scope'];
const esc = x => `"${String(x ?? '').replace(/"/g,'""')}"`;
const lines = [head.join(',')];
for (const t of ALL_TAGS) {
  const a = t.alarm || {}, m = t.modbus || {};
  const sup = a.suppressWhen ? [].concat(a.suppressWhen).map(r => `${r.tag}${r.equals !== undefined ? `=${r.equals}` : ''}`).join(' AND ') : '';
  lines.push([t.id, t.name, t.desc, areaMap[t.area]?.name, areaMap[t.area]?.no, t.unit, t.kind,
    t.min, t.max, t.precision, a.ll, a.l, a.h, a.hh, sup, t.device, m.slave,
    m.fc === 2 ? 'FC02 Discrete Input' : m.fc === 4 ? 'FC04 Input Register' : m.fc,
    m.reg, m.type, m.scale, t.scope || 'in scope'].map(esc).join(','));
}
fs.writeFileSync('docs/TAG-LIST.csv', lines.join('\n') + '\n');

const dl = ['Device ID,Description,Model,Protocol,Slave,Segment,Area,Scope,Points'];
for (const d of DEVICES) {
  dl.push([d.id, d.name, d.model, d.proto, d.slave ?? '', d.bus, areaMap[d.area]?.name ?? '', d.scope || 'in scope',
    ALL_TAGS.filter(t => t.device === d.id).length].map(esc).join(','));
}
fs.writeFileSync('docs/DEVICE-LIST.csv', dl.join('\n') + '\n');
console.log(`TAG-LIST.csv: ${ALL_TAGS.length} points · DEVICE-LIST.csv: ${DEVICES.length} devices`);
