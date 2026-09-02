/**
 * PLANT SIMULATOR
 * -----------------------------------------------------------------------------
 * A deterministic, physically-consistent model of the Hydroflow Tanjung Manis
 * plant. It exists so the platform can be demonstrated, tuned and load-tested
 * before the field devices are commissioned — and so operators can be trained
 * against realistic behaviour.
 *
 * Everything here is replaced by real telemetry the moment the edge gateway
 * starts publishing to MQTT (see server/mqtt.js). Set SIMULATOR=off in .env.
 *
 * Modelled physics
 *   · Solar geometry for 2.137 °N 111.339 °E (UTC+8) with tropical cloud cover
 *   · Semi-diurnal tide on the Belawai River (flood ≈13:00, ebb ≈21:00)
 *   · Stochastic rainfall (Sarawak ≈3000 mm/yr) and 120 m² roof catchment
 *   · Tank mass balance across the whole treatment train
 *   · Pump start/stop logic with hysteresis and duty rotation
 *   · Filter fouling → differential-pressure rise → backwash reset
 *   · Turbidity/TSS cascade matching the design stage targets
 *   · Salinity intrusion coupled to tide height
 *   · Battery coulomb counting, cell drift, temperature and EMS dispatch
 */

import { DESIGN } from './tags.js';

const { pv, battery, tanks, site } = DESIGN;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* Deterministic PRNG so a restart replays the same weather. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Smooth 1-D value noise — used for cloud cover and demand wander. */
function noise1(rng) {
  const perm = Array.from({ length: 512 }, () => rng() * 2 - 1);
  return (x) => {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(perm[i & 511], perm[(i + 1) & 511], u);
  };
}

export class PlantModel {
  constructor(seed = 20260214) {
    this.rng = mulberry32(seed);
    this.cloudNoise = noise1(mulberry32(seed + 1));
    this.demandNoise = noise1(mulberry32(seed + 2));
    this.rainNoise = noise1(mulberry32(seed + 3));

    this.s = {
      // tank contents in m³
      sed: tanks.sedimentation * 0.62,
      inter: tanks.intermediate * 0.55,
      clean: [1.85, 1.79, 1.92, 1.71, 1.66],       // per-tank m³
      rain: tanks.rainTotal * 0.44,
      // filter fouling 0..1
      foulSand: 0.34, foulMMF: 0.21,
      lastBackwashSand: 0, lastBackwashMMF: 0,
      // pumps
      run: { 'P-3001': false, 'P-3002': false, 'P-3003': false, 'P-2001': false, 'P-4001': false, 'P-6001': false },
      dutyLead: 'P-3001',
      pumpHours: { 'P-3001': 1840, 'P-3002': 1792, 'P-3003': 210, 'P-2001': 940, 'P-4001': 1610, 'P-6001': 2455 },
      // battery
      soc: 78.4, soh: 98.6, cycles: 214,
      cellDrift: Array.from({ length: 16 }, (_, i) => (mulberry32(seed + 10 + i)() - 0.5) * 0.016),
      cellTemp: [31.2, 31.9, 32.4, 31.5],
      // water quality
      chlorine: 0.62, cleanTDS: 214,
      // discrete
      leak: { 'XS-2005': 0, 'XS-7005': 0 },
      // energy counters (kWh)
      kwh: { pvToday: 0, loadToday: 0, importToday: 0, exportToday: 0, chgToday: 0, dschToday: 0 },
      m3: { producedToday: 0, deliveredToday: 0 },
      lastDay: null,
      vibBase: 2.4, invTemp: 38,
    };
    this.out = {};
  }

  /* ── environment ─────────────────────────────────────────────────────── */

  /** Clear-sky plane-of-array irradiance, W/m². */
  solar(date) {
    const doy = Math.floor((date - new Date(Date.UTC(date.getUTCFullYear(), 0, 0))) / 86400000);
    const hLocal = (date.getUTCHours() + site.tzOffset + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600) % 24;
    const decl = 23.45 * Math.sin((2 * Math.PI * (284 + doy)) / 365) * (Math.PI / 180);
    const lat = site.lat * (Math.PI / 180);
    const ha = (hLocal - 12) * 15 * (Math.PI / 180);
    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    if (sinAlt <= 0.01) return { ghi: 0, poa: 0, alt: 0 };
    const am = 1 / (sinAlt + 0.50572 * Math.pow(6.07995 + Math.asin(sinAlt) * 57.2958, -1.6364));
    const dni = 1361 * 0.7 ** (am ** 0.678);
    const tiltR = pv.tilt * (Math.PI / 180);
    const cosInc = Math.max(0, sinAlt * Math.cos(tiltR) + Math.cos(Math.asin(sinAlt)) * Math.sin(tiltR) * Math.cos(ha));
    const poa = dni * cosInc + 1361 * sinAlt * 0.12 * ((1 + Math.cos(tiltR)) / 2);
    return { ghi: 1361 * sinAlt * 0.82, poa: Math.max(0, poa), alt: Math.asin(sinAlt) * 57.2958 };
  }

  /** Cloud transmission 0.18 … 1.0 — tropical convective pattern, wetter after noon. */
  cloud(t) {
    const h = t / 3600000;
    const n = this.cloudNoise(h * 0.62) * 0.5 + this.cloudNoise(h * 2.9) * 0.28 + this.cloudNoise(h * 9.1) * 0.12;
    const hLocal = (new Date(t).getUTCHours() + site.tzOffset) % 24;
    const afternoonBias = hLocal > 13 && hLocal < 18 ? -0.22 : 0;
    return clamp(0.80 + n * 0.55 + afternoonBias, 0.14, 1.0);
  }

  /** Belawai River level, m above chart datum. Flood peak ≈13:00, ebb low ≈21:00. */
  tide(t) {
    const hLocal = (new Date(t).getUTCHours() + site.tzOffset + new Date(t).getUTCMinutes() / 60) % 24;
    const M2 = Math.cos(((hLocal - 13) / 12.42) * 2 * Math.PI);          // principal lunar semi-diurnal
    const S2 = 0.24 * Math.cos(((hLocal - 13) / 12.0) * 2 * Math.PI);    // solar semi-diurnal
    const spring = 0.18 * Math.sin((t / 86400000) * 2 * Math.PI / 14.77); // spring/neap
    return clamp(2.75 + (M2 + S2) * (1.55 + spring), 0.35, 5.4);
  }

  /** Rainfall intensity mm/h — bursty, Sarawak ~3000 mm/yr. */
  rainfall(t) {
    const h = t / 3600000;
    const n = this.rainNoise(h * 0.33) * 0.6 + this.rainNoise(h * 1.7) * 0.4;
    const threshold = 0.40;
    if (n < threshold) return 0;
    const intensity = ((n - threshold) / (1 - threshold)) ** 1.7 * 78;
    return intensity < 0.15 ? 0 : intensity;
  }

  /** School + community water demand, m³/h. Peaks 06:00–08:00 and 17:00–20:00. */
  demand(t) {
    const d = new Date(t);
    const hLocal = (d.getUTCHours() + site.tzOffset + d.getUTCMinutes() / 60) % 24;
    const dow = (d.getUTCDay() + (d.getUTCHours() + site.tzOffset >= 24 ? 1 : 0)) % 7;
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1.0;     // boarders remain, day students absent
    const profile =
      1.05 * Math.exp(-(((hLocal - 6.8) / 1.15) ** 2)) +
      0.55 * Math.exp(-(((hLocal - 11.4) / 1.30) ** 2)) +
      0.95 * Math.exp(-(((hLocal - 18.3) / 1.60) ** 2)) +
      0.10;
    const base = (site.population * site.demandLpd) / 1000 / 8.4;   // m³/h at unity profile
    const wander = 1 + this.demandNoise(t / 3600000 * 4.2) * 0.16;
    return Math.max(0, base * profile * weekend * wander);
  }

  /** Electrical load of the school (excluding plant pumps), kW. */
  schoolLoad(t) {
    const d = new Date(t);
    const hLocal = (d.getUTCHours() + site.tzOffset + d.getUTCMinutes() / 60) % 24;
    const night = 0.42;                                       // fridge, router, security lights
    const day = hLocal > 7 && hLocal < 16 ? 1.45 : 0;         // classrooms, fans
    const evening = hLocal >= 18 && hLocal < 22.5 ? 1.15 : 0; // dormitory
    const wander = 1 + this.demandNoise(t / 3600000 * 7.7 + 40) * 0.22;
    return Math.max(0.15, (night + day + evening) * wander);
  }

  /* ── main step ───────────────────────────────────────────────────────── */

  /**
   * Advance the model.
   * @param {number} t   epoch ms of this sample
   * @param {number} dtS seconds since the previous sample
   */
  step(t, dtS) {
    const s = this.s;
    const dtH = dtS / 3600;
    const date = new Date(t);
    const dayKey = Math.floor((t + site.tzOffset * 3600000) / 86400000);
    if (s.lastDay !== dayKey) {                 // midnight rollover of daily counters
      s.lastDay = dayKey;
      s.kwh = { pvToday: 0, loadToday: 0, importToday: 0, exportToday: 0, chgToday: 0, dschToday: 0 };
      s.m3 = { producedToday: 0, deliveredToday: 0 };
    }

    /* — solar & PV — */
    const sun = this.solar(date);
    const cc = this.cloud(t);
    const poa = sun.poa * cc;
    const ambient = 25.5 + 5.6 * Math.sin((((date.getUTCHours() + site.tzOffset) - 8) / 24) * 2 * Math.PI) + this.demandNoise(t / 3600000 * 1.3) * 1.2;
    const tMod = ambient + (poa / 800) * 28;    // NOCT-style rise
    const tempDerate = 1 + pv.tempCoeffPct / 100 * (tMod - 25);
    const dcIdeal = pv.kWp * (poa / 1000) * tempDerate * 0.96;   // 4 % soiling/mismatch
    const pvDC = clamp(dcIdeal, 0, pv.kWp * 1.05);

    /* — water demand & storage — */
    const demand = this.demand(t);
    const cleanTotal = s.clean.reduce((a, b) => a + b, 0);
    const cleanPct = (cleanTotal / (tanks.cleanEach * tanks.cleanCount)) * 100;

    /* — pump control logic (hysteresis + duty rotation) — */
    const rain = this.rainfall(t);
    const tideLvl = this.tide(t);
    const rainPct = (s.rain / tanks.rainTotal) * 100;
    const sedPct = (s.sed / tanks.sedimentation) * 100;
    const interPct = (s.inter / tanks.intermediate) * 100;

    // Intake pumps: run when sedimentation tank low AND river level allows suction AND salinity acceptable
    const salinity = this.salinity(tideLvl, t);
    const intakeAllowed = tideLvl > 0.9 && salinity < 9000;
    if (!s.run['P-3001'] && !s.run['P-3002']) {
      if (sedPct < 55 && intakeAllowed) {
        s.dutyLead = s.pumpHours['P-3001'] <= s.pumpHours['P-3002'] ? 'P-3001' : 'P-3002';
        s.run[s.dutyLead] = true;
      }
    } else if (sedPct > 92 || !intakeAllowed) {
      s.run['P-3001'] = false; s.run['P-3002'] = false;
    }

    // Rain transfer pump: rain tank -> polishing -> clean storage
    s.run['P-2001'] = rainPct > 12 && (s.topUp !== false);

    // Filtration feed pump: sedimentation -> sand filter -> intermediate storage
    s.run['P-4001'] = sedPct > 15 && interPct < 88;

    // Distribution booster: the clean-water tanks sit on the elevated RC slab, so
    // low draw-off is served by gravity head alone. The booster only cuts in for
    // the morning and evening peaks — this is what keeps the pumping energy
    // within the PV budget.
    s.run['P-6001'] = demand > 0.25 && cleanPct > 8;

    for (const p of Object.keys(s.run)) if (s.run[p]) s.pumpHours[p] += dtH;

    /* — mass balance — */
    const rate = 1 / Math.max(dtH, 1e-9);            // convert a volume to an equivalent hourly rate
    const rawFlow = (s.run['P-3001'] ? 3.05 : 0) + (s.run['P-3002'] ? 3.05 : 0);
    const rainCatch = (rain / 1000) * 120 * 0.85;    // m³/h harvested from the 120 m² roof

    // Stage 1 — sedimentation -> sand filtration -> intermediate storage (P-4001).
    // Throughput falls as the media fouls; limited by what is actually in the tank
    // and by the head-room left downstream.
    const sandCap = 3.6 * (1 - 0.55 * s.foulSand);
    const filtFlow = s.run['P-4001']
      ? Math.max(0, Math.min(sandCap, s.sed * rate + rawFlow, (tanks.intermediate * 0.96 - s.inter) * rate))
      : 0;

    // Clean-storage top-up demand, with hysteresis so the plant cycles 88 % -> 96 %
    // instead of chattering against a full tank.
    if (s.topUp === undefined) s.topUp = true;
    if (s.topUp && cleanPct > 94) s.topUp = false;
    if (!s.topUp && cleanPct < 88) s.topUp = true;
    const cleanRoom = s.topUp ? tanks.cleanEach * tanks.cleanCount * 0.95 - cleanTotal : 0;

    // Rainwater has priority over river water — better raw quality, lower pumping cost.
    const rainToPlant = (s.run['P-2001'] && cleanRoom > 0.02)
      ? Math.max(0, Math.min(1.4, s.rain * rate, cleanRoom * rate))
      : 0;

    // Stage 2 — intermediate -> multimedia filtration -> clean storage (gravity + booster).
    const mmfCap = 3.0 * (1 - 0.55 * s.foulMMF);
    const polishFlow = (s.inter > 0.15 && cleanRoom > 0.02)
      ? Math.max(0, Math.min(mmfCap, s.inter * rate, Math.max(0, cleanRoom * rate - rainToPlant)))
      : 0;

    const toClean = polishFlow + rainToPlant;
    // Gravity feed continues below the booster cut-in, limited by static head.
    const gravityCap = 0.42 * Math.sqrt(Math.max(0.02, cleanPct / 100));
    const outCap = s.run['P-6001'] ? 6.0 : gravityCap;
    const outFlow = cleanPct > 2 ? Math.min(demand, outCap, cleanTotal * rate) : 0;

    s.sed = clamp(s.sed + (rawFlow - filtFlow) * dtH, 0, tanks.sedimentation);
    s.rain = clamp(s.rain + (rainCatch - rainToPlant) * dtH, 0, tanks.rainTotal);
    s.inter = clamp(s.inter + (filtFlow - polishFlow) * dtH, 0, tanks.intermediate);
    // distribute inflow across the 5 interconnected tanks, draw from the fullest
    const perTank = (toClean * dtH) / tanks.cleanCount;
    for (let i = 0; i < 5; i++) s.clean[i] = clamp(s.clean[i] + perTank, 0, tanks.cleanEach);
    let toDraw = outFlow * dtH;
    for (let g = 0; g < 5 && toDraw > 1e-9; g++) {
      const idx = s.clean.indexOf(Math.max(...s.clean));
      const take = Math.min(toDraw, s.clean[idx] * 0.5 + 1e-6);
      s.clean[idx] = clamp(s.clean[idx] - take, 0, tanks.cleanEach); toDraw -= take;
    }
    s.m3.producedToday += toClean * dtH;
    s.m3.deliveredToday += outFlow * dtH;

    /* — filter fouling & automatic backwash — */
    s.foulSand = clamp(s.foulSand + (filtFlow * dtH) * 0.0062 * (1 + this.rawTurb(tideLvl, rain, t) / 260), 0, 1);
    s.foulMMF = clamp(s.foulMMF + (polishFlow * dtH) * 0.0041, 0, 1);
    const dpSand = 0.12 + s.foulSand * 1.15 + (filtFlow / 3.6) * 0.10;
    const dpMMF = 0.10 + s.foulMMF * 1.30 + (polishFlow / 3.0) * 0.08;
    if (dpSand > 1.02) { s.foulSand = 0.05; s.lastBackwashSand = t; }
    if (dpMMF > 1.22) { s.foulMMF = 0.04; s.lastBackwashMMF = t; }

    /* — water quality cascade — */
    const rawNTU = this.rawTurb(tideLvl, rain, t);
    const sedNTU = clamp(rawNTU * 0.30 + 6, 12, 90);
    const sandNTU = clamp(sedNTU * 0.33 * (1 + s.foulSand * 0.5), 4, 40);
    const mmfNTU = clamp(sandNTU * 0.20 * (1 + s.foulMMF * 0.9), 0.4, 18);
    s.chlorine = clamp(s.chlorine + (0.75 - s.chlorine) * 0.05 * dtS / 60 + (this.rng() - 0.5) * 0.004, 0.05, 4);
    const targetTDS = 190 + salinity * 0.021 + (rainToPlant > 0 ? -35 : 0);
    s.cleanTDS += (targetTDS - s.cleanTDS) * clamp(dtS / 5400, 0, 1);

    /* — EMS dispatch & battery — */
    const pumpKW =
      (s.run['P-3001'] ? 2.24 : 0) + (s.run['P-3002'] ? 2.24 : 0) +
      (s.run['P-2001'] ? 0.75 : 0) + (s.run['P-4001'] ? 1.10 : 0) + (s.run['P-6001'] ? 1.50 : 0);
    const load = this.schoolLoad(t) + pumpKW * 1.06;    // 6 % motor/derating losses
    const pvAC = pvDC * 0.965;                          // inverter efficiency
    let net = pvAC - load;                              // + surplus, − deficit
    let battKW = 0, gridKW = 0;

    const socFloor = 25, socCeil = 96;
    if (net > 0) {
      const room = Math.max(0, (socCeil - s.soc) / 100) * battery.kWh;
      battKW = Math.min(net, battery.maxChargeA * battery.nominalV / 1000, room / Math.max(dtH, 1 / 3600) );
      battKW = Math.max(0, Math.min(battKW, 5.0));
      gridKW = -(net - battKW);                          // export surplus
    } else {
      const avail = Math.max(0, (s.soc - socFloor) / 100) * battery.kWh;
      const dischargeCap = Math.min(battery.maxDischargeA * battery.nominalV / 1000, 5.0, avail / Math.max(dtH, 1 / 3600));
      battKW = -Math.min(-net, dischargeCap);            // negative = discharging
      gridKW = Math.max(0, -net + battKW);               // whatever the battery could not cover
    }
    const rte = battKW > 0 ? 0.97 : 1 / 0.97;            // round-trip split
    s.soc = clamp(s.soc + (battKW * rte * dtH / battery.kWh) * 100, 3, 100);
    if (battKW < 0) s.cycles += (-battKW * dtH) / battery.kWh;
    s.soh = clamp(100 - s.cycles / battery.designCycles * 20 - 0.4, 60, 100);

    s.kwh.pvToday += pvAC * dtH;
    s.kwh.loadToday += load * dtH;
    if (gridKW > 0) s.kwh.importToday += gridKW * dtH; else s.kwh.exportToday += -gridKW * dtH;
    if (battKW > 0) s.kwh.chgToday += battKW * dtH; else s.kwh.dschToday += -battKW * dtH;

    // pack electrical
    const socV = lerp(3.05, 3.38, clamp(s.soc / 100, 0, 1)) + (s.soc > 92 ? (s.soc - 92) * 0.012 : 0);
    const packI = (battKW * 1000) / (socV * 16);
    const sag = packI * 0.0009;                          // internal resistance
    const cellV = socV + sag;
    const packV = cellV * 16;
    for (let i = 0; i < 4; i++) {
      const target = ambient + 4.0 + Math.abs(packI) * 0.052 + i * 0.55;
      s.cellTemp[i] += (target - s.cellTemp[i]) * clamp(dtS / 900, 0, 1);
    }
    // slow drift of cell balance, reset by the BMS balancer when charging near full
    if (battKW > 0 && s.soc > 96) {                     // passive balancer only bleeds near full charge
      s.cellDrift = s.cellDrift.map((d) => d * (1 - clamp(dtS / 14400, 0, 0.25)));
    } else {
      s.cellDrift = s.cellDrift.map((d) => clamp(d + (this.rng() - 0.5) * 2.2e-4 * dtS / 60, -0.060, 0.060));
    }

    /* — discrete / leak simulation — */
    for (const [id, mtbf] of [['XS-2005', 900000], ['XS-7005', 1400000]]) {
      if (s.leak[id]) { if (this.rng() < dtS / 5400) s.leak[id] = 0; }
      else if (this.rng() < dtS / mtbf) s.leak[id] = 1;
    }

    /* — mechanical — */
    const runningIntake = s.run['P-3001'] || s.run['P-3002'];
    const vibTarget = runningIntake ? 2.6 + (s.pumpHours['P-3001'] / 9000) * 3.4 + (this.rng() - 0.5) * 0.5 : 0.08;
    s.vibBase += (vibTarget - s.vibBase) * clamp(dtS / 45, 0, 1);
    s.invTemp += ((ambient + 6 + (pvAC / pv.inverterKW) * 26) - s.invTemp) * clamp(dtS / 300, 0, 1);

    /* ── emit tag values ─────────────────────────────────────────────── */
    const suction = runningIntake ? clamp(-0.18 - (5.4 - tideLvl) * 0.052 - s.foulSand * 0.06, -0.9, 0) : 0.0;
    const o = {
      // PV
      'JT-1001': poa,
      'TT-1002': tMod,
      'JT-1003': pvDC > 0.02 ? pv.vmpString * (0.93 + 0.07 * clamp(poa / 900, 0, 1)) * (1 - 0.0035 * (tMod - 25)) : pv.vocString * 0.02,
      'JT-1005': pvDC > 0.02 ? pv.vmpString * (0.93 + 0.07 * clamp(poa / 900, 0, 1)) * (1 - 0.0035 * (tMod - 25)) * 0.995 : pv.vocString * 0.02,
      'EM-1007': pvDC,
      'EM-1008': pvAC,
      'TT-1009': s.invTemp,
      'EM-1010': gridKW,
      'EM-1011': load,
      'EM-1012': 50 + this.demandNoise(t / 60000) * 0.06,
      'EM-1013': 240 - gridKW * 0.85 + this.demandNoise(t / 30000 + 9) * 1.8,
      // Rain
      'QT-2001': rain,
      'FT-2002': (rainCatch * 1000) / 60,
      'LT-2003': (s.rain / tanks.rainTotal) * 100,
      'PT-2004': s.run['P-2001'] ? 2.6 + (this.rng() - 0.5) * 0.14 : 0.04,
      'XS-2005': s.leak['XS-2005'],
      'ZS-2006': s.run['P-2001'] ? 1 : 0,
      // Intake
      'LT-3001': tideLvl,
      'AIT-3002': rawNTU,
      'AIT-3003': 6.6 + Math.sin(t / 7.2e6) * 0.35 + (rain > 5 ? -0.28 : 0) + this.demandNoise(t / 1e6 + 3) * 0.12,
      'AIT-3004': salinity,
      'PT-3005': suction,
      'VT-3006': s.vibBase,
      'FT-3007': rawFlow,
      'ZS-3008': s.run['P-3001'] ? 1 : 0,
      'ZS-3009': s.run['P-3002'] ? 1 : 0,
      'LT-3010': (s.sed / tanks.sedimentation) * 100,
      // Filtration
      'DPT-4001': dpSand,
      'DPT-4002': dpMMF,
      'FT-4003': filtFlow,
      'FT-4008': polishFlow,
      'ZS-4009': s.run['P-4001'] ? 1 : 0,
      'PT-4004': s.run['P-4001'] ? 2.9 - s.foulSand * 0.35 + (this.rng() - 0.5) * 0.08 : 0.05,
      'AIT-4005': mmfNTU,
      'AIT-4006': s.chlorine,
      'LT-4007': (s.inter / tanks.intermediate) * 100,
      // Storage
      'FT-6006': outFlow,
      'FT-6009': toClean,
      'AIT-6007': s.cleanTDS,
      'PT-6008': 0.35 + (cleanPct / 100) * 0.42 + (s.run['P-6001'] ? 0.15 : 0),
      // Distribution
      'FT-7001': outFlow,
      'PT-7002': s.run['P-6001'] ? 2.5 - outFlow * 0.09 + (this.rng() - 0.5) * 0.06 : 0.42,
      'FT-7003': outFlow * 0.55,
      'FT-7004': outFlow * 0.45,
      'XS-7005': s.leak['XS-7005'],
      'ZS-7006': s.run['P-6001'] ? 1 : 0,
      // BMS
      'EM-8001': packV,
      'EM-8002': packI,
      'EM-8003': battKW,
      'QT-8004': s.soc,
      'QT-8005': s.soh,
      'TT-8006': Math.max(...s.cellTemp),
      'QT-8007': (Math.max(...s.cellDrift) - Math.min(...s.cellDrift)) * 1000,
      'QT-8008': s.cycles,
    };
    // String currents derived from DC power split
    o['JT-1004'] = o['JT-1003'] > 5 ? (pvDC * 1000 / 2) / o['JT-1003'] : 0;
    o['JT-1006'] = o['JT-1005'] > 5 ? (pvDC * 1000 / 2) / o['JT-1005'] * 0.985 : 0;
    // Clean water tanks
    for (let i = 0; i < 5; i++) o[`LT-600${i + 1}`] = (s.clean[i] / tanks.cleanEach) * 100;
    // Individual cells & probes
    for (let i = 0; i < 16; i++) o[`QT-81${String(i + 1).padStart(2, '0')}`] = cellV + s.cellDrift[i];
    for (let i = 0; i < 4; i++) o[`TT-81${String(i + 1).padStart(2, '0')}`] = s.cellTemp[i];

    this.out = o;
    this.context = {
      pvAC, load, battKW, gridKW, pumpKW, schoolKW: this.schoolLoad(t),
      demand, cleanPct, rainPct, sedPct, interPct, cloud: cc, ambient, topUp: s.topUp,
      kwh: { ...s.kwh }, m3: { ...s.m3 }, run: { ...s.run },
      pumpHours: { ...s.pumpHours }, foulSand: s.foulSand, foulMMF: s.foulMMF,
      lastBackwashSand: s.lastBackwashSand, lastBackwashMMF: s.lastBackwashMMF,
      stages: { rawNTU, sedNTU, sandNTU, mmfNTU },
      flows: { rawFlow, filtFlow, polishFlow, toClean, outFlow, rainCatch, rainToPlant },
      tide: tideLvl, rain, poa, soc: s.soc, sun,
    };
    return o;
  }

  /** Salinity intrusion — rises sharply on the flood tide. */
  salinity(tideLvl, t) {
    const base = 380;
    const intrusion = Math.max(0, (tideLvl - 2.2) / 3.0) ** 1.9 * 11500;
    return clamp(base + intrusion * (1 + this.demandNoise(t / 3.6e6 + 17) * 0.18), 120, 19000);
  }

  /** Raw river turbidity — tide stirring + rain runoff from oil-palm catchment. */
  rawTurb(tideLvl, rain, t) {
    const tidalStir = 60 + Math.abs(tideLvl - 2.75) * 34;
    const runoff = rain * 6.2;
    return clamp(tidalStir + runoff + this.demandNoise(t / 1.8e6 + 55) * 26, 25, 480);
  }
}
