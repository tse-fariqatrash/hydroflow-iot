# Hydroflow Tanjung Manis — IoT Monitoring & Energy Management System

Operator interface for the integrated solar PV, river water treatment, rainwater
harvesting and distribution plant at **SK Bayang Daro, Tanjung Manis, Bahagian
Mukah, Sarawak**.

Delivered by **Twilight Solar Energy Sdn Bhd** (JS Holding Berhad).
Design basis: **USM School of Electrical & Electronic Engineering** — *Projek Pam
Air Hydroflow Tanjung Manis*, February 2025 (Ir. Dr. Muhammad Hafeez).

---

## What it does

| Page | Answers |
|---|---|
| **Plant Overview** | Is the community getting water, and is the plant paying for it with sunlight or with the grid? |
| **Process Mimic** | Animated P&ID of the whole plant with live values on every vessel |
| **Water Treatment** | Turbidity cascade against the design targets, MOH quality compliance, filter fouling, tide/salinity window |
| **Energy Management** | Live dispatch, autonomy, PV string balance, 14-day energy ledger |
| **Battery / BMS** | 16-cell balance, thermal map, SOC/SOH, cycle life |
| **Trends & Historian** | Any 6 points, any window from 1 h to 14 d |
| **Alarms & Events** | ISA-18.2 alarm journal, acknowledgement workflow, alarm-load diagnostics |
| **Reports** | Printable daily operations sheet with signature blocks |
| **Devices & Network** | RS-485 segments, device health, which points are live vs simulated |
| **Tag Database** | All 88 points with limits and Modbus addressing; CSV export |

**88 monitored points across 8 subsystem areas** — implementing the sensor list
from the USM "Full IoT Network Topology Diagram" (which estimated 42–55 sensors;
this build adds 16 individual cell voltages and 4 pack thermistors for the BMS
deep-dive, plus discrete pump run-status points needed for alarm suppression).

---

## Quick start (local)

```bash
npm install
cp .env.example .env          # then edit JWT_SECRET and DEFAULT_PASSWORD
npm start
```

Open <http://localhost:3000>. First boot generates 14 days of plant history
(~300 000 samples, about 45 s) so every trend, report and alarm view has real
data immediately.

Sign in with any of the six USM access tiers — `admin`, `engineer`, `operator`,
`technician`, `manager`, `community` — using the password in `DEFAULT_PASSWORD`.

---

## Deploying

**On JS AWS Lightsail**, follow **`deploy/DEPLOY-LIGHTSAIL.md`**. Hydroflow runs
on `Ubuntu-JS-Main` (16 GB, alongside QuestDB) as a self-contained stack with
its own Caddy terminating TLS for `hydroflow.twilightsolarenergy.com.my`.
Nothing on the instance running `arizonn-ems` is touched — the two stacks share
nothing. It is deliberately not co-located with the EMS: that box has 2 GB, and
both a node-gyp build and a shift-long WebSocket load are more than it should
carry.

The rest of this section covers a **standalone Linux box** with no Docker.

Tested on Amazon Linux 2023 / Ubuntu 22.04, `t3.small` or larger
(2 vCPU / 2 GB is comfortable; the historian is I/O-light but SQLite likes gp3).

```bash
# 1 — Node 20+
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -   # or deb.nodesource.com
sudo dnf install -y nodejs                                        # or: sudo apt install -y nodejs

# 2 — Application
sudo useradd --system --home /opt/hydroflow --shell /usr/sbin/nologin hydroflow
sudo mkdir -p /opt/hydroflow && sudo chown hydroflow: /opt/hydroflow
sudo -u hydroflow tar xzf hydroflow-iot.tar.gz -C /opt/hydroflow
cd /opt/hydroflow && sudo -u hydroflow npm ci --omit=dev

# 3 — Configuration  ← do not skip
sudo -u hydroflow cp .env.example .env
sudo -u hydroflow sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sudo -u hydroflow nano .env            # set DEFAULT_PASSWORD, MQTT_USERNAME, MQTT_PASSWORD
sudo chmod 600 .env

# 4 — Service
sudo cp deploy/hydroflow.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hydroflow
sudo journalctl -u hydroflow -f

# 5 — TLS front end
sudo cp deploy/nginx.conf /etc/nginx/sites-available/hydroflow
sudo ln -s /etc/nginx/sites-available/hydroflow /etc/nginx/sites-enabled/
sudo certbot --nginx -d hydroflow.example.my
sudo nginx -t && sudo systemctl reload nginx
```

### Security group

| Port | Source | Why |
|---|---|---|
| 443 | `0.0.0.0/0` | dashboard |
| 80 | `0.0.0.0/0` | ACME challenge + redirect only |
| 1883 | **the plant gateway's public IP /32 only** | MQTT ingest |
| 22 | your admin CIDR | SSH |

Never open 1883 to the world. The gateway has a static address on the Celcom/Maxis
APN; if it does not, terminate MQTT over TLS on 8883 behind the same nginx and
restrict by client certificate instead.

### Backups

`deploy/backup.sh` takes a consistent `sqlite3 .backup` snapshot (never `cp` a
live WAL database) and pushes it to S3. Add it to cron and give the instance role
`s3:PutObject` on the bucket.

### Moving to the dedicated server later

Stop the service, copy `/opt/hydroflow` verbatim (including `data/`), start it on
the new host, repoint DNS, and update the gateway's MQTT broker address. There is
no external database and no cloud dependency — that is deliberate, because the
plant must keep historising when the 4G link drops.

---

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket |
| `MQTT_PORT` | `1883` | field ingest |
| `DB_FILE` | `./data/hydroflow.db` | SQLite, WAL mode |
| `SCAN_INTERVAL_MS` | `3000` | live push rate |
| `PERSIST_INTERVAL_MS` | `60000` | how often a scan is historised |
| `RETENTION_DAYS` | `30` | raw retention; hourly rollups are kept forever |
| `SEED_DAYS` | `14` | synthetic history on an empty database |
| `JWT_SECRET` | — | **change this** |
| `DEFAULT_PASSWORD` | `hydroflow2026` | **change this**; seeds the six accounts on first run |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | blank = anonymous; set both in production |
| `SIMULATOR` | `on` | see below |

---

## Commissioning: simulator → live, subsystem by subsystem

The simulator is not a demo mode you switch off on a flag day. **Any tag that
arrives over MQTT is claimed by that device and the simulator stops writing it,
permanently.** Commission the PV inverter this week and the whole Area 1000 block
goes live while the water train stays simulated; nothing else changes.

A tag reverts to simulated only if its device stops publishing for 90 seconds.
Once every subsystem is live, set `SIMULATOR=off` and restart.

See **`docs/DEVICE-INTEGRATION.md`** for the MQTT topic scheme, payload format,
the full Modbus register map, and a worked gateway example.

---

## Design decisions worth knowing

**No build step, no CDN.** The frontend is plain ES modules and hand-written SVG
charts. Nothing is fetched from the internet at runtime, because the control-room
PC at SK Bayang Daro may not have any. `npm ci` on the server is the only build.

**SQLite, not a hosted time-series database.** The plant sits behind a dual-SIM
4G link. A single file that keeps writing during an outage and backs up with one
command beats a managed TSDB the plant cannot reach.

**Alarms are suppressed by plant state (ISA-18.2).** "Discharge pressure low" on a
stopped pump is not a fault, it is the definition of stopped. Adding suppression
cut the 14-day alarm count from 569 to 216, and everything remaining is real
process deviation. See `alarm.suppressWhen` in `server/tags.js`.

**Daily totals are integrated, not averaged.** The historian is deliberately
non-uniform (30 s near the present, 15 min far back); a plain average would weight
a sparse night the same as a dense morning peak. Gaps longer than an hour are not
bridged, so a comms outage under-reports rather than inventing energy.

**The RO skid is out of scope but instrumented.** Its eight points exist, read
`offline`, and are excluded from alarm evaluation — matching the BQ, where the
skid was struck from Bills 3c and 4 while its instrumentation stayed in Bill 6(f).

---

## User management

**Users & Access** (administrators only) creates and edits accounts, changes
roles, resets passwords and disables accounts. **My Account** lets anyone edit
their own name and email and change their own password.

Three rules are enforced server-side and covered by `npm run test:acl`:

- **The last active administrator cannot be demoted, deactivated or deleted.**
  Checked against the live count at write time, so there is no window where a
  concurrent edit leaves nobody able to manage users.
- **Changing your own password requires your current one**, so an unlocked
  laptop cannot be used to take the account over.
- **A password change, role change or deactivation ends that account's other
  sessions immediately.** Tokens carry an `iat`; the account carries a
  `pw_changed_at` cut-off, and anything issued at or before it stops being
  accepted. Without this a "reset" would leave the previous holder signed in
  for the remaining life of a 12-hour token.

Accounts are **disabled, never deleted** — the alarm and event journals refer to
them by name and must keep resolving. Usernames are immutable for the same
reason.

There is no password-reset email and no 2FA. For six named operators, an
administrator resetting a password is a smaller attack surface than a recovery
flow. `scripts/set-password.mjs` does the same job from the command line if
nobody can sign in at all.

## What this system does not do

- **It does not certify water potability.** Turbidity, pH, TDS and chlorine are
  process indicators. Bacteriological compliance needs laboratory testing.
- **It does not measure battery state of health.** SOH is modelled from
  cumulative throughput. Run a controlled capacity discharge annually and correct
  the model against it.
- **It does not control the plant.** Setpoint writes are stubbed at
  `POST /api/command`, which publishes to the device's `cmd` topic and journals
  the actor. Closed-loop control stays in the PLC, where it belongs.

---

## Project structure

```
server/
  index.js     HTTP + WebSocket + scan loop + REST API
  users.js     account management, with the lockout and session guards
  tags.js      MASTER TAG DATABASE — single source of truth for every point
  sim.js       physically-consistent plant model (solar, tide, mass balance, battery)
  db.js        SQLite historian, LTTB decimation, hourly rollups
  alarms.js    ISA-18.2 alarm engine with deadband, on-delay and state suppression
  auth.js      JWT + the six USM role tiers
  mqtt.js      embedded broker for the edge gateway
public/
  css/app.css  design system (dark-first, validated colour palette)
  js/
    charts.js  bespoke SVG charting — zero dependencies
    api.js     REST client + reconnecting live socket
    app.js     shell + router
    pages/     one module per screen
deploy/        systemd unit, nginx TLS config, S3 backup script
docs/          device integration guide + exported tag list
```

Adding a point is one entry in `server/tags.js`: the API, the tag browser, the
alarm engine, the CSV export and the Modbus documentation all follow from it.
