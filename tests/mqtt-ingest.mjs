/** Proves the commissioning path: publish a tag, confirm the server claims it. */
import { connect } from 'node:net';
const enc = (s) => Buffer.from(s, 'utf8');
function mqttStr(s) { const b = enc(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); }
function remLen(n) { const o = []; do { let d = n % 128; n = (n / 128) | 0; if (n > 0) d |= 128; o.push(d); } while (n > 0); return Buffer.from(o); }

const sock = connect(1883, '127.0.0.1', () => {
  const payload = Buffer.concat([mqttStr('MQTT'), Buffer.from([4, 2, 0, 60]), mqttStr('DEV-STO-01')]);
  sock.write(Buffer.concat([Buffer.from([0x10]), remLen(payload.length), payload]));
});
sock.on('data', (d) => {
  if (d[0] === 0x20) {                                     // CONNACK
    const topic = 'hydroflow/tanjungmanis/DEV-STO-01/telemetry';
    const body = JSON.stringify({ tags: { 'LT-6001': 66.6, 'AIT-6007': 231, 'ZS-7006': 1 } });
    const p = Buffer.concat([mqttStr(topic), enc(body)]);
    sock.write(Buffer.concat([Buffer.from([0x30]), remLen(p.length), p]));
    setTimeout(async () => {
      const r = await fetch('http://localhost:3000/api/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'engineer', password: 'hydroflow2026' }) });
      const { token } = await r.json();
      const live = await (await fetch('http://localhost:3000/api/live', { headers: { authorization: `Bearer ${token}` } })).json();
      const devs = await (await fetch('http://localhost:3000/api/devices', { headers: { authorization: `Bearer ${token}` } })).json();
      const d = devs.find(x => x.id === 'DEV-STO-01');
      console.log('LT-6001  ->', JSON.stringify(live.values['LT-6001']));
      console.log('AIT-6007 ->', JSON.stringify(live.values['AIT-6007']));
      console.log('ZS-7006  ->', JSON.stringify(live.values['ZS-7006']));
      console.log('LT-6002  -> (should still be sim)', JSON.stringify(live.values['LT-6002']));
      console.log('device   ->', d.id, d.status, 'rx=' + d.rx);
      const ok = live.values['LT-6001']?.v === 66.6 && live.values['LT-6001']?.src === 'DEV-STO-01'
        && live.values['LT-6002']?.src === 'sim' && d.status === 'online';
      console.log(ok ? '\nPASS — device claimed its points; other tags stay simulated' : '\nFAIL');
      sock.destroy(); process.exit(ok ? 0 : 1);
    }, 5000);
  }
});
