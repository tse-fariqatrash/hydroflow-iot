# Device Integration Guide
### Hydroflow Tanjung Manis — Edge IoT Gateway → Monitoring & EMS Server

This is the document the panel builder and the commissioning engineer need. It
specifies exactly what the gateway must publish for each subsystem to switch from
simulated to live data.

---

## 1. Architecture

```
  Field instruments ──RS-485 / Modbus RTU──▶ Remote I/O + PLC
                                                   │ Modbus TCP
                                                   ▼
                                          Edge IoT Gateway
                                                   │ MQTT / TLS  over 4G/5G
                                                   ▼
                                    Hydroflow server (this application)
                                                   │
                                    ┌──────────────┼──────────────┐
                                 Historian    Alarm engine     Web UI
```

The gateway is the only device that talks to this server. It polls Modbus,
buffers locally when the cellular link drops, and back-fills on reconnect.

---

## 2. MQTT

**Broker:** this server, port `1883` (or `8883` behind TLS termination).
**Credentials:** `MQTT_USERNAME` / `MQTT_PASSWORD` from the server `.env`.
**Client ID:** use the device ID, e.g. `GW-EDGE-01`.

### Topics

| Topic | Direction | Retain | Purpose |
|---|---|---|---|
| `hydroflow/tanjungmanis/<deviceId>/telemetry` | gateway → server | no | measured values |
| `hydroflow/tanjungmanis/<deviceId>/status` | gateway → server | **yes** | `online` / `offline` (set as LWT) |
| `hydroflow/tanjungmanis/<deviceId>/cmd` | server → gateway | no | operator commands |

Set the Last Will and Testament to `offline` on the `status` topic so the
Devices page shows a dropped gateway within one keep-alive period.

### Telemetry payload

```json
{
  "ts": 1787040000000,
  "tags": {
    "LT-6001": 78.4,
    "AIT-4005": 2.13,
    "ZS-3008": 1,
    "EM-1008": 2.084
  }
}
```

- `ts` — epoch milliseconds, UTC. **Optional**; the server stamps arrival time if
  absent. Include it if the gateway buffers, or the back-fill will be flattened
  to the reconnect instant.
- `tags` — a map of tag ID to value. Send whatever you have; partial payloads are
  fine. Unknown tag IDs are ignored (and logged), so a typo fails quietly rather
  than corrupting the historian.
- Booleans are accepted for discrete points and coerced to `1` / `0`.
- Values must already be in **engineering units** — apply the Modbus scale factor
  at the gateway, not here.

### Publishing rate

Publish on **change-of-value with a 60-second heartbeat**. Suggested deadbands:

| Point type | Deadband | Heartbeat |
|---|---|---|
| Power, flow | 1 % of span | 60 s |
| Level, temperature | 0.5 % of span | 60 s |
| Water quality (pH, NTU, TDS) | 1 % of span | 60 s |
| Discrete (run status, leak) | on every change | 300 s |

The server pushes to browsers every 3 s and historises every 60 s regardless, so
publishing faster than ~1 Hz buys nothing and costs cellular data.

### Commands

```json
{ "action": "start", "value": "P-3002", "by": "operator", "ts": 1787040000000 }
```

Issued by `POST /api/command` from users holding the `operate` permission. Every
command is written to the event log with the actor before it is published.
**Closed-loop control remains in the PLC** — the gateway should treat these as
requests to set a PLC coil, never as direct actuator drive.

---

## 3. Handover: simulated → live

There is no cut-over event. The moment a device publishes a tag, that tag is
claimed and the simulator stops writing it. Commission one subsystem at a time:

1. Wire and address the RTU on its RS-485 segment.
2. Configure the gateway's poll list for that device's registers.
3. Publish. Watch **Devices & Network** — the device flips from `Simulated` to
   `Online` and its point count appears under "Live from hardware".
4. Verify each point on **Tag Database** against a hand reading.
5. Repeat for the next subsystem.

A tag reverts to simulated if its device stops publishing for **90 seconds** —
that is the failure indication, not a fallback to trust. When every subsystem is
live, set `SIMULATOR=off` in `.env` and restart; from then on a silent device
shows as stale rather than being papered over.

---

## 4. Modbus register map

All analogue points are **FC04 (Input Registers)**; all discrete points are
**FC02 (Discrete Inputs)**. Serial parameters: **19 200 baud, 8N1**, RS-485
half-duplex, 120 Ω termination at both ends of each segment.

Multiply the raw register by the scale factor to obtain engineering units.
`int16` values are two's complement. `uint32` / `int32` occupy two consecutive
registers, **high word first** (big-endian, the Modbus convention).

The authoritative, always-current map is `server/tags.js` and the **CSV export**
button on the Tag Database page. `docs/TAG-LIST.csv` in this package is a
snapshot of it.

### Segment allocation

| Segment | Slaves | Devices |
|---|---|---|
| RS-485 #1 | 1, 2, 11, 81 | Inverter, energy meter, weather station, BMS |
| RS-485 #2 | 21, 22, 31, 32, 33 | Rain harvest RTU + pump, river intake RTU + pumps A/B |
| RS-485 #3 | 41, 51 | Filtration panel, RO junction box *(future)* |
| RS-485 #4 | 61, 71, 72, 73 | Clean storage RTU, distribution RTU, two smart water meters |

Keep the BMS and inverter on the same segment as the energy meter: they are the
fastest-changing points and share a poll group.

---

## 5. Alarm suppression — read before setting limits

Five points carry `suppressWhen` rules, which the server evaluates before any
limit check:

| Point | Suppressed when |
|---|---|
| `PT-2004` Rain pump discharge pressure | `ZS-2006` = 0 (pump stopped) |
| `PT-4004` Filter feed pressure | `ZS-4009` = 0 |
| `PT-7002` Distribution pipe pressure | `ZS-7006` = 0 |
| `PT-3005` Intake suction pressure | `ZS-3008` = 0 **and** `ZS-3009` = 0 |
| `VT-3006` Intake pump vibration | `ZS-3008` = 0 **and** `ZS-3009` = 0 |

**This is why the run-status points matter.** If the gateway publishes
`PT-7002` but not `ZS-7006`, the server cannot tell a stopped booster from a
burst main, and it will raise a critical low-pressure alarm every time the pump
cycles off. Always publish the run-status discrete alongside its pressure or
vibration point.

Over a 14-day period this suppression reduced the alarm count from 569 to 216.

---

## 6. Verification checklist

Before signing off a subsystem:

- [ ] Every point in that area appears on **Tag Database** with a live value
- [ ] The device shows **Online** on **Devices & Network** with a recent "last seen"
- [ ] Values match an independent hand reading within instrument tolerance
- [ ] Run-status discretes toggle correctly (start the pump; watch **Process Mimic**)
- [ ] Engineering units are correct — a scale-factor error usually shows as a
      value 10× or 100× out, or as a limit alarm that will not clear
- [ ] Alarm limits reviewed against actual operating range (see below)
- [ ] Kill the gateway's SIM for two minutes: the point goes stale, the alarm
      does not fire spuriously, and history back-fills on reconnect

### Reviewing alarm limits

The limits shipped in `server/tags.js` come from the design study and from
Malaysian MOH drinking water standards. They are a starting point. After two
weeks of real data, open **Alarms & Events → Alarm load** and look at the "most
frequent points" list. A point dominating that list is almost always a limit set
too tight for the real operating range, not a plant that is failing.

---

## 7. Worked example — Node-RED on the gateway

```javascript
// Function node: Modbus response → Hydroflow telemetry
// Input: msg.payload = array of input registers read from slave 61 (DEV-STO-01)
const REG = msg.payload;

const tags = {
  'LT-6001': REG[0] * 0.1,      // Clean water tank 1 level, %
  'LT-6002': REG[2] * 0.1,
  'LT-6003': REG[4] * 0.1,
  'LT-6004': REG[6] * 0.1,
  'LT-6005': REG[8] * 0.1,
  'FT-6006': REG[10] * 0.01,    // Storage outlet flow, m³/h
  'AIT-6007': REG[12] * 1,      // Stored water TDS, ppm
  'PT-6008': REG[14] * 0.01,    // Storage header pressure, bar
  'FT-6009': REG[16] * 0.01,    // Storage inlet flow, m³/h
};

// Change-of-value filter with a 60 s heartbeat
const last = flow.get('last_STO') || {};
const now = Date.now();
const out = {};
for (const [k, v] of Object.entries(tags)) {
  const prev = last[k];
  if (!prev || Math.abs(v - prev.v) > Math.abs(v) * 0.01 || now - prev.t > 60000) {
    out[k] = Math.round(v * 1000) / 1000;
    last[k] = { v, t: now };
  }
}
flow.set('last_STO', last);
if (!Object.keys(out).length) return null;

msg.topic = 'hydroflow/tanjungmanis/DEV-STO-01/telemetry';
msg.payload = { ts: now, tags: out };
return msg;
```

Test from any machine that can reach the broker:

```bash
mosquitto_pub -h <server> -p 1883 -u "$MQTT_USERNAME" -P "$MQTT_PASSWORD" \
  -t 'hydroflow/tanjungmanis/DEV-STO-01/telemetry' \
  -m '{"tags":{"LT-6001":66.6,"AIT-6007":231}}'
```

Within three seconds `LT-6001` reads 66.6 on the dashboard, its source changes
from `sim` to `DEV-STO-01`, and the Devices page shows `DEV-STO-01` as Online.

---

## 8. Server API reference

All endpoints require `Authorization: Bearer <token>` from `POST /api/auth/login`.

| Method | Path | Permission | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | — | obtain a JWT |
| GET | `/api/auth/me` | view | current user and role |
| GET | `/api/meta` | view | tag database, areas, devices, design constants |
| GET | `/api/live` | view | snapshot of every point |
| GET | `/api/history?tag=A,B&from=&to=&points=` | view | decimated time series (LTTB) |
| GET | `/api/alarms?state=open\|active\|cleared\|all` | view | alarm journal |
| POST | `/api/alarms/:id/ack` | operate | acknowledge |
| POST | `/api/alarms/ack-all` | operate | acknowledge all active |
| GET | `/api/daily?days=N` | view | daily energy and water totals |
| GET | `/api/report/daily?date=YYYY-MM-DD` | view | daily report data |
| GET | `/api/devices` | view | device inventory and health |
| GET | `/api/events?limit=N` | view | audit trail |
| POST | `/api/command` | operate | publish a command to a device |
| GET | `/api/users` | admin | account list |
| GET | `/api/health` | — | liveness, historian statistics |
| WS | `/ws?token=<jwt>` | view | live push, ~3 s cadence |

WebSocket message types: `hello`, `tick`, `alarm`, `alarm-ack`, `device`,
`command`.
