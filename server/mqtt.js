/**
 * MQTT INGEST
 * -----------------------------------------------------------------------------
 * An embedded MQTT broker (aedes) so the Edge IoT Gateway at the plant can
 * publish straight into this server with no extra infrastructure — important
 * for a site on a dual-SIM 4G/5G router where every extra hop is a failure mode.
 *
 * Topic scheme
 *   hydroflow/tanjungmanis/<deviceId>/telemetry   JSON, device -> server
 *   hydroflow/tanjungmanis/<deviceId>/status      "online" | "offline"  (retained, LWT)
 *   hydroflow/tanjungmanis/<deviceId>/cmd         JSON, server -> device
 *
 * Telemetry payload
 *   { "ts": 1771200000000, "tags": { "LT-6001": 78.4, "ZS-3008": 1 } }
 *
 * `ts` is optional; the server stamps arrival time when it is absent. Any tag
 * that arrives from a real device immediately takes precedence over the
 * simulator for that tag — so the plant can be commissioned subsystem by
 * subsystem without a flag day.
 */

import Aedes from 'aedes';
import { createServer } from 'node:net';

export function startMqtt({ port, onTelemetry, onStatus, username, password }) {
  const aedes = new Aedes({ id: 'hydroflow-broker' });

  if (username) {
    aedes.authenticate = (client, u, p, cb) => {
      const ok = u === username && p?.toString() === password;
      cb(ok ? null : Object.assign(new Error('Bad credentials'), { returnCode: 4 }), ok);
    };
  }

  aedes.on('publish', (packet, client) => {
    if (!client) return;                                   // ignore broker-internal $SYS
    const parts = packet.topic.split('/');
    if (parts[0] !== 'hydroflow') return;
    const deviceId = parts[2];
    const kind = parts[3];
    try {
      if (kind === 'telemetry') {
        const body = JSON.parse(packet.payload.toString());
        onTelemetry?.(deviceId, body.tags || {}, body.ts || Date.now());
      } else if (kind === 'status') {
        onStatus?.(deviceId, packet.payload.toString());
      }
    } catch (e) {
      console.warn(`[mqtt] bad payload on ${packet.topic}: ${e.message}`);
    }
  });

  aedes.on('client', (c) => console.log(`[mqtt] connect   ${c.id}`));
  aedes.on('clientDisconnect', (c) => { console.log(`[mqtt] disconnect ${c.id}`); onStatus?.(c.id, 'offline'); });

  const server = createServer(aedes.handle);
  server.listen(port, () => console.log(`[mqtt] broker listening on :${port}`));
  return {
    aedes, server,
    publishCommand(deviceId, payload) {
      aedes.publish({ topic: `hydroflow/tanjungmanis/${deviceId}/cmd`, payload: JSON.stringify(payload), qos: 1, retain: false });
    },
    close() { server.close(); aedes.close(); },
  };
}
