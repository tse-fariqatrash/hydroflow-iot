# Deploying Hydroflow to JS AWS Lightsail

**Target: `Ubuntu-JS-Main` (13.251.66.163), self-contained. Nothing on
`test-server` is touched — not a config file, not a container, not a reload.**

---

## The instances

| Instance | Spec | Public IP | Runs |
|---|---|---|---|
| `test-server` | 2 GB · 2 vCPU · 60 GB | 13.250.88.129 | arizonn-ems — Next.js `app:3018`, Postgres, Caddy (`ems.`, `tsh.`) |
| `Ubuntu-JS-Main` | 16 GB · 4 vCPU · 320 GB | 13.251.66.163 | QuestDB → **+ Hydroflow + its own Caddy** |
| `Ubuntu-J2` | 2 GB · 2 vCPU · 60 GB | 18.138.1.196 | — |

All Singapore, Zone A.

## Why Hydroflow terminates its own TLS

The obvious move is to reuse the Caddy that already fronts `ems.` and `tsh.`
That is wrong here for two reasons, both stemming from `test-server` being the
2 GB box:

1. **Load.** Every open Hydroflow dashboard holds a WebSocket for the length of
   a shift. Routing those through `test-server` puts sustained connection load
   on the machine with the least headroom, to reach an app that is not even on
   it.
2. **Blast radius.** Proxying means editing the live EMS's `Caddyfile` and
   reloading it. Small risk, but non-zero, and repeated at every change. Its
   own Caddy means deploying Hydroflow can never affect `ems.` or `tsh.` — the
   two stacks share nothing at all.

The cost is a second Caddy container (~15 MB) and two firewall rules. On a
16 GB instance that is not a trade.

```
  test-server 13.250.88.129 (2 GB)        Ubuntu-JS-Main 13.251.66.163 (16 GB)
 ┌───────────────────────────────┐      ┌────────────────────────────────────┐
 │ caddy :80 :443                │      │ QuestDB :9000 :9009 :8812          │
 │  ├ ems. ───► app:3018         │      │                                    │
 │  └ tsh. ───► app:3018         │      │ hydroflow-caddy :80 :443           │
 │ app (Next.js) · postgres      │      │   └ hydroflow. ──► hydroflow:3000  │
 │                               │      │ hydroflow  :1883 (MQTT, firewalled)│
 │       ── UNTOUCHED ──         │      └────────────────────────────────────┘
 └───────────────────────────────┘                        ▲
                                          plant edge gateway (4G/5G) ─► MQTT
```

Port 3000 is **not published to the host at all** — Caddy reaches it over the
stack's internal Docker network, so the dashboard has no route in except
through TLS.

## Your DNS is already correct

```
hydroflow    A    13.251.66.163      ← Ubuntu-JS-Main. Correct for this design.
ems          A    13.250.88.129
tsh          A    13.250.88.129
```

(An earlier draft of this runbook told you to point `hydroflow` at
`13.250.88.129`. That was for the proxy-through-the-EMS design, which was
abandoned for the reasons above. Leave the record as it is.)

---

## Step 0 — Survey the target

```bash
ssh ubuntu@13.251.66.163

free -m                     # expect ~16000 total
df -h /                     # expect plenty of 320 GB free

# These four ports must be free. If QuestDB or anything else holds 80 or 443,
# stop and tell me — the design changes.
ss -lntp | grep -E ':80 |:443 |:3000|:1883' || echo "all four ports free"

docker ps                   # is QuestDB in Docker here, or running natively?
command -v docker || { curl -fsSL https://get.docker.com | sh; sudo usermod -aG docker $USER; newgrp docker; }
docker compose version      # need v2
```

Confirm DNS resolves to this box before going further — Caddy cannot get a
certificate otherwise:

```bash
getent hosts hydroflow.twilightsolarenergy.com.my    # → 13.251.66.163
```

---

## Step 1 — Open the firewall (before starting Caddy)

Lightsail console → **`Ubuntu-JS-Main`** → Networking → IPv4 Firewall →
Add rule, twice:

| Application | Protocol | Port | Restrict to source |
|---|---|---|---|
| HTTP | TCP | 80 | anywhere |
| HTTPS | TCP | 443 | anywhere |

**Port 80 must be open even though the site serves on 443** — Caddy uses it for
the Let's Encrypt ACME challenge. Certificate issuance silently fails without
it, and the symptom is a browser TLS error rather than anything in the logs
that says "port 80".

Do **not** add the MQTT rule yet — that comes in step 6, when the gateway
actually exists.

---

## Step 2 — Code onto the instance

From your laptop (PowerShell is fine; `scp` ships with Windows 10/11):

```powershell
scp hydroflow-iot.tar.gz ubuntu@13.251.66.163:~/
```

Then on the instance:

```bash
ssh ubuntu@13.251.66.163
tar xzf hydroflow-iot.tar.gz && cd hydroflow-iot
```

---

## Step 3 — Configure

```bash
cp .env.example .env

sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env

DASH_PW=$(openssl rand -base64 15 | tr -d '/+=' | cut -c1-16)
sed -i "s|^DEFAULT_PASSWORD=.*|DEFAULT_PASSWORD=${DASH_PW}|" .env

MQTT_PW=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
sed -i "s|^MQTT_USERNAME=.*|MQTT_USERNAME=hydroflow-gateway|" .env
sed -i "s|^MQTT_PASSWORD=.*|MQTT_PASSWORD=${MQTT_PW}|" .env

chmod 600 .env
echo "Dashboard password : ${DASH_PW}"
echo "MQTT password      : ${MQTT_PW}"
```

**Record both passwords now** — printed once. The dashboard password applies to
all six accounts (`admin`, `engineer`, `operator`, `technician`, `manager`,
`community`) on first run; change them per user afterwards.

No `BIND_IP` in this design — port 3000 is never published to the host, so
there is nothing to bind.

---

## Step 4 — Build and start

```bash
docker compose build          # ~2–3 min. Safe here: 16 GB, not the 2 GB box.
docker compose up -d
docker compose logs -f
```

First boot seeds 14 days of history — **45–60 seconds** during which the
container is up but not yet answering:

```
[seed] wrote 304,138 samples and 215 alarm records — compacting rollups…
[seed] done
[restore] day-to-date: 36.2 kWh PV, 5.82 m³ delivered since local midnight
```

Then Caddy will request the certificate. Watch for it:

```bash
docker compose logs caddy | grep -iE "certificate|obtain|error"
```

Checkpoints:

```bash
docker compose ps
#   hydroflow        Up (healthy)
#   hydroflow-caddy  Up   0.0.0.0:80->80, 0.0.0.0:443->443

# app reachable inside the stack, but NOT from outside
docker compose exec caddy wget -qO- http://hydroflow:3000/api/health
curl -m3 http://13.251.66.163:3000/api/health && echo "EXPOSED — investigate" || echo "3000 correctly unpublished"

# QuestDB undisturbed
curl -s "http://localhost:9000/exec?query=SELECT%201" | head -c 60; echo
```

---

## Step 5 — Verify

```
https://hydroflow.twilightsolarenergy.com.my
```

- Valid certificate, login page loads
- Sign in as `engineer` with the password from step 3
- The **Live** pill top-right turns green — that is the WebSocket through Caddy,
  the most likely thing to be misconfigured
- **Plant Overview** values move; **Process Mimic** animates
- **Devices & Network** shows 89 points, all `Simulated` (correct until the
  gateway is commissioned)

And confirm the EMS is exactly as it was — it should be, since nothing on that
box was touched:

```
https://ems.twilightsolarenergy.com.my
https://tsh.twilightsolarenergy.com.my
```

---

## Step 6 — MQTT, only when the gateway exists

Lightsail console → **`Ubuntu-JS-Main`** → Networking → IPv4 Firewall:

| Application | Protocol | Port | Restrict to source IP |
|---|---|---|---|
| Custom | TCP | 1883 | **the gateway's public IP /32** |

**Never `0.0.0.0/0`.** An open MQTT broker is found by scanners within hours,
and anyone who reaches it can inject false telemetry into the historian — worse
than an outage, because it looks like data.

If the gateway has no static IP, do not widen the rule. Either run MQTT over
TLS on 8883 with a client certificate, or have the gateway dial out over
WireGuard and bind 1883 to the tunnel.

Test the whole path:

```bash
docker compose exec hydroflow node tests/mqtt-ingest.mjs
# expect: PASS — device claimed its points; other tags stay simulated
```

Then hand `docs/DEVICE-INTEGRATION.md` to whoever configures the gateway.

---

## Step 7 — Backups

**Instance snapshots** — Lightsail console → `Ubuntu-JS-Main` → Snapshots →
enable automatic. This now covers QuestDB and Hydroflow together.

**Database backups.** The historian is a live WAL SQLite database; `cp` gives a
corrupt copy. Use `.backup`:

```bash
mkdir -p ~/backups && crontab -e
```
```cron
15 2 * * * docker exec hydroflow sh -c 'sqlite3 /app/data/hydroflow.db ".backup /app/data/bk.db"' && docker cp hydroflow:/app/data/bk.db ~/backups/hydroflow-$(date +\%Y\%m\%d).db && docker exec hydroflow rm -f /app/data/bk.db && find ~/backups -name 'hydroflow-*.db' -mtime +14 -delete
```

02:15 UTC = 10:15 MYT. Check it does not collide with QuestDB maintenance on
this instance.

Also worth keeping: the `caddy_data` volume holds the issued certificates.
Losing it is not fatal — Caddy re-issues — but Let's Encrypt rate-limits to 5
duplicate certificates per week, so do not delete it casually.

---

## Day-to-day

```bash
cd ~/hydroflow-iot
docker compose logs -f hydroflow
docker compose restart hydroflow          # history survives
docker compose ps

# update
docker tag hydroflow-iot:latest hydroflow-iot:previous   # rollback point
tar xzf ~/hydroflow-iot.tar.gz            # or: git pull
docker compose build && docker compose up -d
```

Volumes: `hydroflow-iot_hydroflow_data` (historian),
`hydroflow-iot_caddy_data` (certificates). `docker compose down` keeps them;
`docker compose down -v` destroys them. **Never use `-v` on this instance** —
QuestDB's volumes live here too.

### Rollback

```bash
docker compose down
docker tag hydroflow-iot:previous hydroflow-iot:latest
docker compose up -d
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser TLS error, no valid cert | port 80 closed | Caddy needs **80** for the ACME challenge. Open it in the Lightsail firewall, then `docker compose restart caddy` |
| `docker compose logs caddy` shows ACME failures | DNS not resolving to this box | `getent hosts hydroflow.twilightsolarenergy.com.my` must return 13.251.66.163 |
| Caddy **502** | app not up yet or unhealthy | `docker compose ps`; the healthcheck has a 120 s `start_period` for the seed |
| Login works, **"Reconnecting"** stays | WebSocket blocked | Should not happen with the shipped Caddyfile; check nothing was added under `reverse_proxy` |
| **Port already allocated** on 80/443 | something else on this instance | `ss -lntp | grep -E ':80 |:443 '`. If QuestDB has a proxy there, switch to `deploy/docker-compose.proxied.yml` instead |
| QuestDB slow after deploy | memory pressure | Hydroflow is capped at 1 GB; confirm with `docker stats` |
| Too many certificate requests | repeated `down -v` | Let's Encrypt rate limit: 5 duplicates/week. Preserve `caddy_data` |

---

## What has and has not been tested

**Verified** — the application, end to end against a production-only dependency
install (`npm ci --omit=dev`): `better-sqlite3` compiles and loads, all 89
points report, every page renders with no console errors, static assets and SPA
deep links serve, MQTT ingest claims tags from a real publish, and the process
exits cleanly on `SIGTERM` with the database passing `PRAGMA integrity_check`
— so `docker stop` is safe. The compose files pass `docker compose config`.

**Not verified** — `docker build`, and the Caddy container. The development
environment had no container-registry access (Docker Hub and ECR Public both
refused), so neither the image nor `caddy:2-alpine` was ever pulled or run. The
Dockerfile is a standard multi-stage Node build and the Caddyfile is a
four-line reverse proxy, but step 4 is genuinely their first execution. On a
16 GB box with nothing else depending on them, a failure is cheap.

**Not verifiable outside your account** — DNS and certificate issuance.

---

## Alternatives kept in `deploy/`

| File | When |
|---|---|
| `docker-compose.proxied.yml` | single public ingress: the EMS's Caddy on test-server proxies here over the private network. Requires `hydroflow` DNS to point at 13.250.88.129 instead |
| `docker-compose.colocated.yml` | Hydroflow on the same box as the EMS Caddy, joining its Docker network. Only if test-server is upsized well beyond 2 GB |
| `bootstrap.sh` | no Docker at all — systemd + nginx, for an eventual on-site machine at the plant |
