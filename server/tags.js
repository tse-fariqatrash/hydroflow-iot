/**
 * HYDROFLOW TANJUNG MANIS — MASTER TAG DATABASE
 * -----------------------------------------------------------------------------
 * Single source of truth for every monitored point in the plant.
 * Derived from the USM "Full IoT Network Topology Diagram" (slide 24) and the
 * process / electrical design in the Feb-2025 design deck.
 *
 * Tag naming follows ISA-5.1 instrument letters with area-based loop numbers:
 *
 *   Area 1000  Solar PV System            Area 5000  Desalination / RO  (monitor-only)
 *   Area 2000  Rain Harvesting System     Area 6000  Clean Water Storage
 *   Area 3000  River Intake System        Area 7000  Distribution System
 *   Area 4000  Filtration System          Area 8000  Battery / BMS
 *
 *   LT level        FT flow          PT pressure      DPT diff. pressure
 *   AIT analyser    TT temperature   VT vibration     JT irradiance
 *   EM energy       XS discrete/leak ZS run-status    WT weight/mass
 *
 * `modbus` describes how the field device is polled by the edge gateway.
 * `sim` drives the built-in plant simulator (used until real devices are wired).
 */

export const AREAS = [
  { id: 'pv',      no: 1000, name: 'Solar PV System',        short: 'Solar PV',     icon: 'sun',    accent: 4 },
  { id: 'rain',    no: 2000, name: 'Rain Harvesting System', short: 'Rain Harvest', icon: 'rain',   accent: 3 },
  { id: 'intake',  no: 3000, name: 'River Intake System',    short: 'River Intake', icon: 'river',  accent: 1 },
  { id: 'filter',  no: 4000, name: 'Filtration System',      short: 'Filtration',   icon: 'filter', accent: 7 },
  { id: 'ro',      no: 5000, name: 'Desalination (RO) System', short: 'RO Skid',    icon: 'ro',     accent: 5 },
  { id: 'storage', no: 6000, name: 'Clean Water Storage',    short: 'Clean Storage',icon: 'tank',   accent: 6 },
  { id: 'dist',    no: 7000, name: 'Distribution System',    short: 'Distribution', icon: 'house',  accent: 2 },
  { id: 'bms',     no: 8000, name: 'Battery Management',     short: 'BMS',          icon: 'battery',accent: 8 },
];

/** Physical design constants taken from the USM design deck. */
export const DESIGN = {
  site: {
    name: 'SK Bayang Daro, Tanjung Manis',
    district: 'Bahagian Mukah, Sarawak',
    lat: 2.1370, lon: 111.3390, tzOffset: 8,
    population: 100,            // 66 students + 42 boarders + 13 teachers + 7 support (peak 100 pax)
    demandLpd: 100,             // L/person/day external use (design basis)
    designFlowM3d: 10,          // 10 m3/day design production
    operatingHours: 8,
  },
  pv: {
    kWp: 7.0, moduleW: 500, moduleCount: 14, strings: 2, modulesPerString: 7,
    vmpString: 245, vocString: 345, impString: 13.0,
    inverterKW: 8.0, tilt: 25, azimuth: 0, tempCoeffPct: -0.35,
  },
  battery: {
    nominalV: 51.2, ah: 200, kWh: 10.24, usableKWh: 9.2,
    cells: 16, chemistry: 'LiFePO4', cellNomV: 3.2, cellMinV: 2.80, cellMaxV: 3.65,
    maxChargeA: 100, maxDischargeA: 150, designCycles: 6000,
  },
  tanks: {
    sedimentation: 12.5,        // m3, 24 h settling
    intermediate: 10.0,         // m3
    cleanEach: 2.273,           // m3 (600 imp. gal)
    cleanCount: 5,
    rainTotal: 11.36,           // m3 (5 x 600 gal)
  },
  pumps: {
    'P-3001': { name: 'River Intake Pump A', kW: 2.24, hp: 3 },
    'P-3002': { name: 'River Intake Pump B', kW: 2.24, hp: 3 },
    'P-3003': { name: 'River Intake Pump C (standby)', kW: 2.24, hp: 3 },
    'P-2001': { name: 'Rainwater Transfer Pump',       kW: 0.75, hp: 1 },
    'P-4001': { name: 'Filtration Feed Pump',          kW: 1.10, hp: 1.5 },
    'P-6001': { name: 'Distribution Booster Pump',     kW: 1.50, hp: 2 },
  },
  treatment: [
    { id: 'sed',  name: 'Sedimentation Tank',   spec: '12.5 m³ · 24 h settling',   ntuOut: [40, 60],  tssOut: [20, 60] },
    { id: 'sand', name: 'Sand Filtration',      spec: '3–4 m³/h · 3 units',        ntuOut: [10, 20],  tssOut: [5, 15] },
    { id: 'int',  name: 'Intermediate Storage', spec: '10 m³',                     ntuOut: [10, 20],  tssOut: [5, 15] },
    { id: 'mmf',  name: 'Multimedia Filtration',spec: '3 m³/h · 4 units',          ntuOut: [1, 5],    tssOut: [0, 5] },
    { id: 'fin',  name: 'Final Storage Tank',   spec: '10 m³',                     ntuOut: [1, 5],    tssOut: [0, 5] },
  ],
};

/* ── helpers ─────────────────────────────────────────────────────────────── */
const T = (o) => ({
  kind: 'analog', precision: 1, writable: false, retain: true, deadband: 0, ...o,
});

/**
 * Master point list. `alarm` limits use the standard four-level convention:
 *   ll = low-low (critical), l = low (warning), h = high (warning), hh = high-high (critical)
 * `null` disables that level.
 */
export const TAGS = [

  /* ══ AREA 1000 — SOLAR PV SYSTEM ════════════════════════════════════════ */
  T({ id:'JT-1001', area:'pv', name:'Plane-of-Array Irradiance', desc:'Silicon irradiance sensor on module plane, 25° tilt',
      unit:'W/m²', min:0, max:1400, precision:0, device:'DEV-IRR-01',
      modbus:{ slave:11, fc:4, reg:0, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:null, hh:null },
      sim:{ model:'irradiance' } }),

  T({ id:'TT-1002', area:'pv', name:'PV Module Temperature', desc:'Back-of-module PT1000, string 1 centre',
      unit:'°C', min:0, max:90, precision:1, device:'DEV-IRR-01',
      modbus:{ slave:11, fc:4, reg:2, type:'int16', scale:0.1 },
      alarm:{ ll:null, l:null, h:70, hh:80 },
      sim:{ model:'moduleTemp' } }),

  T({ id:'JT-1003', area:'pv', name:'String 1 DC Voltage', desc:'7 × 500 Wp in series',
      unit:'V', min:0, max:400, precision:1, device:'DEV-INV-01',
      modbus:{ slave:1, fc:4, reg:100, type:'uint16', scale:0.1 },
      alarm:{ ll:null, l:null, h:360, hh:400 },
      sim:{ model:'stringV', string:1 } }),

  T({ id:'JT-1004', area:'pv', name:'String 1 DC Current', unit:'A', min:0, max:16, precision:2, device:'DEV-INV-01',
      desc:'String 1 input current', modbus:{ slave:1, fc:4, reg:101, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:15, hh:16 }, sim:{ model:'stringI', string:1 } }),

  T({ id:'JT-1005', area:'pv', name:'String 2 DC Voltage', unit:'V', min:0, max:400, precision:1, device:'DEV-INV-01',
      desc:'7 × 500 Wp in series', modbus:{ slave:1, fc:4, reg:102, type:'uint16', scale:0.1 },
      alarm:{ ll:null, l:null, h:360, hh:400 }, sim:{ model:'stringV', string:2 } }),

  T({ id:'JT-1006', area:'pv', name:'String 2 DC Current', unit:'A', min:0, max:16, precision:2, device:'DEV-INV-01',
      desc:'String 2 input current', modbus:{ slave:1, fc:4, reg:103, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:15, hh:16 }, sim:{ model:'stringI', string:2 } }),

  T({ id:'EM-1007', area:'pv', name:'PV DC Power', desc:'Total array DC power (both strings)',
      unit:'kW', min:0, max:8, precision:2, device:'DEV-INV-01',
      modbus:{ slave:1, fc:4, reg:110, type:'uint32', scale:0.001 },
      alarm:{ ll:null, l:null, h:null, hh:null }, sim:{ model:'derived' } }),

  T({ id:'EM-1008', area:'pv', name:'Inverter AC Output Power', desc:'8 kW hybrid inverter AC output',
      unit:'kW', min:0, max:8.5, precision:2, device:'DEV-INV-01',
      modbus:{ slave:1, fc:4, reg:112, type:'uint32', scale:0.001 },
      alarm:{ ll:null, l:null, h:8.0, hh:8.4 }, sim:{ model:'derived' } }),

  T({ id:'TT-1009', area:'pv', name:'Inverter Heatsink Temperature', unit:'°C', min:0, max:100, precision:1,
      desc:'Internal NTC, derates above 60 °C', device:'DEV-INV-01',
      modbus:{ slave:1, fc:4, reg:120, type:'int16', scale:0.1 },
      alarm:{ ll:null, l:null, h:65, hh:80 }, sim:{ model:'invTemp' } }),

  T({ id:'EM-1010', area:'pv', name:'Grid Import / Export Power', desc:'Bi-directional utility meter (+ import / − export)',
      unit:'kW', min:-8, max:12, precision:2, device:'DEV-MTR-01',
      modbus:{ slave:2, fc:4, reg:0, type:'int32', scale:0.001 },
      alarm:{ ll:null, l:null, h:null, hh:null }, sim:{ model:'derived' } }),

  T({ id:'EM-1011', area:'pv', name:'Total Site Load', desc:'AC energy meter, plant + school loads',
      unit:'kW', min:0, max:12, precision:2, device:'DEV-MTR-01',
      modbus:{ slave:2, fc:4, reg:4, type:'uint32', scale:0.001 },
      alarm:{ ll:null, l:null, h:9.0, hh:11.0 }, sim:{ model:'derived' } }),

  T({ id:'EM-1012', area:'pv', name:'Grid Frequency', unit:'Hz', min:45, max:55, precision:2, device:'DEV-MTR-01',
      desc:'Utility supply frequency', modbus:{ slave:2, fc:4, reg:8, type:'uint16', scale:0.01 },
      alarm:{ ll:49.0, l:49.5, h:50.5, hh:51.0 }, sim:{ model:'freq' } }),

  T({ id:'EM-1013', area:'pv', name:'AC Bus Voltage', unit:'V', min:180, max:280, precision:1, device:'DEV-MTR-01',
      desc:'Single-phase 240 V nominal', modbus:{ slave:2, fc:4, reg:10, type:'uint16', scale:0.1 },
      alarm:{ ll:198, l:216, h:253, hh:264 }, sim:{ model:'acVolts' } }),

  /* ══ AREA 2000 — RAIN HARVESTING SYSTEM ═════════════════════════════════ */
  T({ id:'QT-2001', area:'rain', name:'Rain Gauge', desc:'Tipping-bucket, 0.2 mm resolution, 120 m² catchment',
      unit:'mm/h', min:0, max:120, precision:1, device:'DEV-RAIN-01',
      modbus:{ slave:21, fc:4, reg:0, type:'uint16', scale:0.1 },
      alarm:{ ll:null, l:null, h:60, hh:100 }, sim:{ model:'rainfall' } }),

  T({ id:'FT-2002', area:'rain', name:'Gutter Flow', desc:'Post first-flush diverter, marine-grade gutter',
      unit:'L/min', min:0, max:200, precision:1, device:'DEV-RAIN-01',
      modbus:{ slave:21, fc:4, reg:2, type:'uint16', scale:0.1 },
      alarm:{ ll:null, l:null, h:null, hh:null }, sim:{ model:'gutterFlow' } }),

  T({ id:'LT-2003', area:'rain', name:'Rainwater Tank Level', desc:'5 × 600 gal HDPE battery, 11.36 m³ total',
      unit:'%', min:0, max:100, precision:1, device:'DEV-RAIN-01',
      modbus:{ slave:21, fc:4, reg:4, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:95, hh:99 }, sim:{ model:'rainTank' } }),

  T({ id:'PT-2004', area:'rain', name:'Rain Pump Discharge Pressure', desc:'1 HP salt-resistant centrifugal',
      unit:'bar', min:0, max:6, precision:2, device:'DEV-PMP-2001',
      modbus:{ slave:22, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:0.5, l:1.0, h:4.0, hh:5.0, suppressWhen:{ tag:'ZS-2006', equals:0 } },
      sim:{ model:'pumpPressure', pump:'P-2001', nom:2.6 } }),

  T({ id:'XS-2005', area:'rain', name:'Rain Line Leak Detection', desc:'Cable-type leak sensor, tank bund',
      unit:'', kind:'digital', min:0, max:1, precision:0, device:'DEV-RAIN-01',
      modbus:{ slave:21, fc:2, reg:0, type:'bool', scale:1 },
      states:['Dry','LEAK'], alarm:{ digitalAlarmOn:1, severity:'serious' }, sim:{ model:'leak', mtbf:900000 } }),

  T({ id:'ZS-2006', area:'rain', name:'Rain Transfer Pump Run', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'P-2001 run feedback', device:'DEV-PMP-2001', modbus:{ slave:22, fc:2, reg:0, type:'bool', scale:1 },
      states:['Stopped','Running'], alarm:{}, sim:{ model:'pumpRun', pump:'P-2001' } }),

  /* ══ AREA 3000 — RIVER INTAKE SYSTEM ════════════════════════════════════ */
  T({ id:'LT-3001', area:'intake', name:'Belawai River Level', desc:'Tidal — flood ≈13:00, ebb ≈21:00; jetty 0.5–5 m',
      unit:'m', min:0, max:6, precision:2, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:0.6, l:1.0, h:4.6, hh:5.0 }, sim:{ model:'tide' } }),

  T({ id:'AIT-3002', area:'intake', name:'Raw Water Turbidity', desc:'Optical 90° nephelometric, intake screen outlet',
      unit:'NTU', min:0, max:500, precision:1, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:2, type:'uint16', scale:0.1 },
      alarm:{ ll:null, l:null, h:250, hh:400 }, sim:{ model:'rawTurbidity' } }),

  T({ id:'AIT-3003', area:'intake', name:'Raw Water pH', desc:'Glass electrode with ATC',
      unit:'pH', min:0, max:14, precision:2, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:4, type:'uint16', scale:0.01 },
      alarm:{ ll:5.5, l:6.0, h:9.0, hh:9.5 }, sim:{ model:'rawPH' } }),

  T({ id:'AIT-3004', area:'intake', name:'Raw Water TDS / EC', desc:'Salinity intrusion indicator — rises on flood tide',
      unit:'ppm', min:0, max:20000, precision:0, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:6, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:5000, hh:10000 }, sim:{ model:'rawTDS' } }),

  T({ id:'PT-3005', area:'intake', name:'Intake Suction Pressure', desc:'Strainer blockage indicator',
      unit:'bar', min:-1, max:4, precision:2, device:'DEV-PMP-3001',
      modbus:{ slave:32, fc:4, reg:0, type:'int16', scale:0.01 },
      alarm:{ ll:-0.6, l:-0.4, h:null, hh:null,
              suppressWhen:[{ tag:'ZS-3008', equals:0 }, { tag:'ZS-3009', equals:0 }] },
      sim:{ model:'suction' } }),

  T({ id:'VT-3006', area:'intake', name:'Intake Pump Vibration', desc:'MEMS accelerometer, RMS velocity — ISO 10816 zone',
      unit:'mm/s', min:0, max:20, precision:2, device:'DEV-PMP-3001',
      modbus:{ slave:32, fc:4, reg:2, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:7.1, hh:11.0,
              suppressWhen:[{ tag:'ZS-3008', equals:0 }, { tag:'ZS-3009', equals:0 }] },
      sim:{ model:'vibration', pump:'P-3001' } }),

  T({ id:'FT-3007', area:'intake', name:'Raw Water Intake Flow', desc:'Electromagnetic flow meter, GI riser',
      unit:'m³/h', min:0, max:8, precision:2, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:8, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:6.0, hh:7.5 }, sim:{ model:'rawFlow' } }),

  T({ id:'ZS-3008', area:'intake', name:'River Pump A Run', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'P-3001 run feedback', device:'DEV-PMP-3001', modbus:{ slave:32, fc:2, reg:0, type:'bool', scale:1 },
      states:['Stopped','Running'], alarm:{}, sim:{ model:'pumpRun', pump:'P-3001' } }),

  T({ id:'ZS-3009', area:'intake', name:'River Pump B Run', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'P-3002 run feedback', device:'DEV-PMP-3002', modbus:{ slave:33, fc:2, reg:0, type:'bool', scale:1 },
      states:['Stopped','Running'], alarm:{}, sim:{ model:'pumpRun', pump:'P-3002' } }),

  T({ id:'LT-3010', area:'intake', name:'Sedimentation Tank Level', desc:'12.5 m³, 24 h settling',
      unit:'%', min:0, max:100, precision:1, device:'DEV-INT-01',
      modbus:{ slave:31, fc:4, reg:10, type:'uint16', scale:0.1 },
      alarm:{ ll:8, l:15, h:95, hh:99 }, sim:{ model:'sedTank' } }),

  /* ══ AREA 4000 — FILTRATION SYSTEM ══════════════════════════════════════ */
  T({ id:'DPT-4001', area:'filter', name:'Sand Filter Differential Pressure', desc:'3 units, 3–4 m³/h — backwash trigger at 1.0 bar',
      unit:'bar', min:0, max:2.5, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:0.80, hh:1.00 }, sim:{ model:'dpSand' } }),

  T({ id:'DPT-4002', area:'filter', name:'Multimedia Filter Differential Pressure', desc:'4 units, 3 m³/h — backwash trigger at 1.2 bar',
      unit:'bar', min:0, max:2.5, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:2, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:1.00, hh:1.20 }, sim:{ model:'dpMMF' } }),

  T({ id:'FT-4003', area:'filter', name:'Filtered Water Flow', desc:'Treated water to intermediate storage',
      unit:'m³/h', min:0, max:6, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:4, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:4.5, hh:5.5 }, sim:{ model:'filtFlow' } }),

  T({ id:'PT-4004', area:'filter', name:'Filter Feed Pressure', unit:'bar', min:0, max:6, precision:2, device:'DEV-FLT-01',
      desc:'P-4001 discharge header', modbus:{ slave:41, fc:4, reg:6, type:'uint16', scale:0.01 },
      alarm:{ ll:0.8, l:1.2, h:3.8, hh:4.5, suppressWhen:{ tag:'ZS-4009', equals:0 } },
      sim:{ model:'pumpPressure', pump:'P-4001', nom:2.9 } }),

  T({ id:'AIT-4005', area:'filter', name:'Filtered Water Turbidity', desc:'Post-multimedia — design target 1–5 NTU',
      unit:'NTU', min:0, max:50, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:8, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:5.0, hh:10.0 }, sim:{ model:'filtTurbidity' } }),

  T({ id:'AIT-4006', area:'filter', name:'Residual Chlorine', desc:'Amperometric, post-dosing — MOH 0.2–5.0 mg/L',
      unit:'mg/L', min:0, max:5, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:10, type:'uint16', scale:0.01 },
      alarm:{ ll:0.15, l:0.20, h:2.00, hh:3.00 }, sim:{ model:'chlorine' } }),

  T({ id:'ZS-4009', area:'filter', name:'Filter Feed Pump Run', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'P-4001 run feedback', device:'DEV-FLT-01', modbus:{ slave:41, fc:2, reg:0, type:'bool', scale:1 },
      states:['Stopped','Running'], alarm:{}, sim:{ model:'pumpRun', pump:'P-4001' } }),

  T({ id:'FT-4008', area:'filter', name:'Polished Water Flow', desc:'Post-multimedia flow into clean water storage',
      unit:'m³/h', min:0, max:5, precision:2, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:14, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:3.6, hh:4.4 }, sim:{ model:'polishFlow' } }),

  T({ id:'LT-4007', area:'filter', name:'Intermediate Storage Level', desc:'10 m³ buffer between filter stages',
      unit:'%', min:0, max:100, precision:1, device:'DEV-FLT-01',
      modbus:{ slave:41, fc:4, reg:12, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:96, hh:99 }, sim:{ model:'intTank' } }),

  /* ══ AREA 5000 — DESALINATION / RO ══════════════════════════════════════
   * Skid supply is OUTSIDE the current contract scope (struck from Bill 3c/4
   * of the BQ). Instrumentation IS installed and wired to a junction box at
   * the skid boundary for future tie-in — so these tags exist but read as
   * offline until the skid is commissioned.                                */
  T({ id:'PT-5001', area:'ro', name:'RO Feed Pressure', unit:'bar', min:0, max:10, precision:2, device:'DEV-RO-01',
      desc:'Cartridge filter outlet', scope:'future', modbus:{ slave:51, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:1.0, l:1.5, h:6.0, hh:7.0 }, sim:{ model:'offline' } }),

  T({ id:'PT-5002', area:'ro', name:'RO High-Pressure Feed', unit:'bar', min:0, max:80, precision:1, device:'DEV-RO-01',
      desc:'HP pump discharge to membrane vessels', scope:'future', modbus:{ slave:51, fc:4, reg:2, type:'uint16', scale:0.1 },
      alarm:{ ll:35, l:45, h:65, hh:72 }, sim:{ model:'offline' } }),

  T({ id:'FT-5003', area:'ro', name:'Permeate Flow', unit:'L/h', min:0, max:2000, precision:0, device:'DEV-RO-01',
      desc:'Product water from membrane train', scope:'future', modbus:{ slave:51, fc:4, reg:4, type:'uint16', scale:1 },
      alarm:{ ll:400, l:600, h:null, hh:null }, sim:{ model:'offline' } }),

  T({ id:'AIT-5004', area:'ro', name:'RO Feed TDS', unit:'ppm', min:0, max:20000, precision:0, device:'DEV-RO-01',
      desc:'Membrane inlet salinity', scope:'future', modbus:{ slave:51, fc:4, reg:6, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:12000, hh:15000 }, sim:{ model:'offline' } }),

  T({ id:'AIT-5005', area:'ro', name:'RO Permeate TDS', unit:'ppm', min:0, max:1000, precision:0, device:'DEV-RO-01',
      desc:'Product quality — WHO potable ≤ 500 ppm', scope:'future', modbus:{ slave:51, fc:4, reg:8, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:300, hh:500 }, sim:{ model:'offline' } }),

  T({ id:'TT-5006', area:'ro', name:'RO Feed Temperature', unit:'°C', min:0, max:60, precision:1, device:'DEV-RO-01',
      desc:'Flux correction reference (25 °C basis)', scope:'future', modbus:{ slave:51, fc:4, reg:10, type:'int16', scale:0.1 },
      alarm:{ ll:10, l:15, h:38, hh:45 }, sim:{ model:'offline' } }),

  T({ id:'AIT-5007', area:'ro', name:'RO Permeate Conductivity', unit:'µS/cm', min:0, max:2000, precision:0, device:'DEV-RO-01',
      desc:'Inline toroidal conductivity cell', scope:'future', modbus:{ slave:51, fc:4, reg:12, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:600, hh:1000 }, sim:{ model:'offline' } }),

  T({ id:'FT-5008', area:'ro', name:'RO Reject / Brine Flow', unit:'L/h', min:0, max:3000, precision:0, device:'DEV-RO-01',
      desc:'Concentrate to discharge — recovery ratio input', scope:'future', modbus:{ slave:51, fc:4, reg:14, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:2400, hh:2800 }, sim:{ model:'offline' } }),

  /* ══ AREA 6000 — CLEAN WATER STORAGE ════════════════════════════════════ */
  T({ id:'LT-6001', area:'storage', name:'Clean Water Tank 1 Level', unit:'%', min:0, max:100, precision:1,
      desc:'600 gal HDPE, 2.27 m³', device:'DEV-STO-01', modbus:{ slave:61, fc:4, reg:0, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:97, hh:99 }, sim:{ model:'cleanTank', idx:0 } }),
  T({ id:'LT-6002', area:'storage', name:'Clean Water Tank 2 Level', unit:'%', min:0, max:100, precision:1,
      desc:'600 gal HDPE, 2.27 m³', device:'DEV-STO-01', modbus:{ slave:61, fc:4, reg:2, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:97, hh:99 }, sim:{ model:'cleanTank', idx:1 } }),
  T({ id:'LT-6003', area:'storage', name:'Clean Water Tank 3 Level', unit:'%', min:0, max:100, precision:1,
      desc:'600 gal HDPE, 2.27 m³', device:'DEV-STO-01', modbus:{ slave:61, fc:4, reg:4, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:97, hh:99 }, sim:{ model:'cleanTank', idx:2 } }),
  T({ id:'LT-6004', area:'storage', name:'Clean Water Tank 4 Level', unit:'%', min:0, max:100, precision:1,
      desc:'600 gal HDPE, 2.27 m³', device:'DEV-STO-01', modbus:{ slave:61, fc:4, reg:6, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:97, hh:99 }, sim:{ model:'cleanTank', idx:3 } }),
  T({ id:'LT-6005', area:'storage', name:'Clean Water Tank 5 Level', unit:'%', min:0, max:100, precision:1,
      desc:'600 gal HDPE, 2.27 m³', device:'DEV-STO-01', modbus:{ slave:61, fc:4, reg:8, type:'uint16', scale:0.1 },
      alarm:{ ll:10, l:20, h:97, hh:99 }, sim:{ model:'cleanTank', idx:4 } }),

  T({ id:'FT-6009', area:'storage', name:'Storage Inlet Flow', desc:'Total treated water entering clean storage (river train + rainwater branch)',
      unit:'m³/h', min:0, max:6, precision:2, device:'DEV-STO-01',
      modbus:{ slave:61, fc:4, reg:16, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:4.6, hh:5.4 }, sim:{ model:'inletFlow' } }),

  T({ id:'FT-6006', area:'storage', name:'Storage Outlet Flow', unit:'m³/h', min:0, max:8, precision:2, device:'DEV-STO-01',
      desc:'Common outlet header to distribution', modbus:{ slave:61, fc:4, reg:10, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:6.0, hh:7.0 }, sim:{ model:'outletFlow' } }),

  T({ id:'AIT-6007', area:'storage', name:'Stored Water TDS', unit:'ppm', min:0, max:2000, precision:0, device:'DEV-STO-01',
      desc:'Potable quality check — MOH limit 1000 ppm', modbus:{ slave:61, fc:4, reg:12, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:600, hh:1000 }, sim:{ model:'cleanTDS' } }),

  T({ id:'PT-6008', area:'storage', name:'Storage Header Pressure', unit:'bar', min:0, max:6, precision:2, device:'DEV-STO-01',
      desc:'Gravity head + booster suction', modbus:{ slave:61, fc:4, reg:14, type:'uint16', scale:0.01 },
      alarm:{ ll:0.3, l:0.6, h:3.5, hh:4.5 }, sim:{ model:'headerPressure' } }),

  /* ══ AREA 7000 — DISTRIBUTION SYSTEM ════════════════════════════════════ */
  T({ id:'FT-7001', area:'dist', name:'Distribution Main Flow', unit:'m³/h', min:0, max:8, precision:2, device:'DEV-DIS-01',
      desc:'Main to school + 9 longhouses', modbus:{ slave:71, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:5.5, hh:6.5 }, sim:{ model:'distFlow' } }),

  T({ id:'PT-7002', area:'dist', name:'Distribution Pipe Pressure', unit:'bar', min:0, max:6, precision:2, device:'DEV-DIS-01',
      desc:'Booster discharge — 2.5 bar setpoint', modbus:{ slave:71, fc:4, reg:2, type:'uint16', scale:0.01 },
      alarm:{ ll:0.8, l:1.5, h:3.5, hh:4.2, suppressWhen:{ tag:'ZS-7006', equals:0 } },
      sim:{ model:'pumpPressure', pump:'P-6001', nom:2.5 } }),

  T({ id:'FT-7003', area:'dist', name:'School Branch Smart Meter', unit:'m³/h', min:0, max:4, precision:2, device:'DEV-DIS-02',
      desc:'SK Bayang Daro branch — 66 students, 42 boarders', modbus:{ slave:72, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:3.0, hh:3.5 }, sim:{ model:'branchFlow', share:0.55 } }),

  T({ id:'FT-7004', area:'dist', name:'Longhouse Branch Smart Meter', unit:'m³/h', min:0, max:4, precision:2, device:'DEV-DIS-03',
      desc:'9 longhouses ≈ 100 pax', modbus:{ slave:73, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:null, l:null, h:3.0, hh:3.5 }, sim:{ model:'branchFlow', share:0.45 } }),

  T({ id:'XS-7005', area:'dist', name:'Distribution Leak Detection', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'Night-flow + acoustic correlation on main', device:'DEV-DIS-01',
      modbus:{ slave:71, fc:2, reg:0, type:'bool', scale:1 },
      states:['Normal','LEAK SUSPECTED'], alarm:{ digitalAlarmOn:1, severity:'critical' },
      sim:{ model:'leak', mtbf:1400000 } }),

  T({ id:'ZS-7006', area:'dist', name:'Booster Pump Run', unit:'', kind:'digital', min:0, max:1, precision:0,
      desc:'P-6001 run feedback', device:'DEV-DIS-01', modbus:{ slave:71, fc:2, reg:1, type:'bool', scale:1 },
      states:['Stopped','Running'], alarm:{}, sim:{ model:'pumpRun', pump:'P-6001' } }),

  /* ══ AREA 8000 — BATTERY / BMS ══════════════════════════════════════════ */
  T({ id:'EM-8001', area:'bms', name:'Battery Pack Voltage', unit:'V', min:40, max:60, precision:2, device:'DEV-BMS-01',
      desc:'16S LiFePO₄, 51.2 V nominal', modbus:{ slave:81, fc:4, reg:0, type:'uint16', scale:0.01 },
      alarm:{ ll:44.8, l:48.0, h:57.6, hh:58.4 }, sim:{ model:'packV' } }),

  T({ id:'EM-8002', area:'bms', name:'Battery Current', unit:'A', min:-200, max:200, precision:2, device:'DEV-BMS-01',
      desc:'Hall sensor (+ charge / − discharge)', modbus:{ slave:81, fc:4, reg:2, type:'int16', scale:0.01 },
      alarm:{ ll:-150, l:-130, h:100, hh:110 }, sim:{ model:'packI' } }),

  T({ id:'EM-8003', area:'bms', name:'Battery Power', unit:'kW', min:-8, max:8, precision:2, device:'DEV-BMS-01',
      desc:'Derived: pack V × I', modbus:{ slave:81, fc:4, reg:4, type:'int32', scale:0.001 },
      alarm:{ ll:null, l:null, h:null, hh:null }, sim:{ model:'derived' } }),

  T({ id:'QT-8004', area:'bms', name:'State of Charge', unit:'%', min:0, max:100, precision:1, device:'DEV-BMS-01',
      desc:'Coulomb-counting with OCV re-calibration', modbus:{ slave:81, fc:4, reg:6, type:'uint16', scale:0.1 },
      alarm:{ ll:15, l:22, h:null, hh:null }, sim:{ model:'soc' } }),

  T({ id:'QT-8005', area:'bms', name:'State of Health', unit:'%', min:0, max:100, precision:1, device:'DEV-BMS-01',
      desc:'Capacity fade vs 200 Ah nameplate', modbus:{ slave:81, fc:4, reg:8, type:'uint16', scale:0.1 },
      alarm:{ ll:70, l:80, h:null, hh:null }, sim:{ model:'soh' } }),

  T({ id:'TT-8006', area:'bms', name:'Cell Temperature (max)', unit:'°C', min:0, max:80, precision:1, device:'DEV-BMS-01',
      desc:'Hottest of 4 pack NTC probes', modbus:{ slave:81, fc:4, reg:10, type:'int16', scale:0.1 },
      alarm:{ ll:5, l:10, h:45, hh:55 }, sim:{ model:'cellTempMax' } }),

  T({ id:'QT-8007', area:'bms', name:'Cell Voltage Imbalance', unit:'mV', min:0, max:300, precision:0, device:'DEV-BMS-01',
      desc:'Δ between highest and lowest of 16 cells',
      modbus:{ slave:81, fc:4, reg:12, type:'uint16', scale:1 },
      alarm:{ ll:null, l:null, h:50, hh:120 }, sim:{ model:'imbalance' } }),

  T({ id:'QT-8008', area:'bms', name:'Equivalent Full Cycles', unit:'cyc', min:0, max:8000, precision:0, device:'DEV-BMS-01',
      desc:'Throughput ÷ nameplate capacity (design life 6000)',
      modbus:{ slave:81, fc:4, reg:14, type:'uint32', scale:1 },
      alarm:{ ll:null, l:null, h:5500, hh:6000 }, sim:{ model:'cycles' } }),
];

/** 16 individual LiFePO₄ cell voltages — displayed on the BMS page, not the tag grid. */
export const CELL_TAGS = Array.from({ length: 16 }, (_, i) => T({
  id: `QT-81${String(i + 1).padStart(2, '0')}`, area: 'bms', hidden: true,
  name: `Cell ${i + 1} Voltage`, desc: `LiFePO₄ cell ${i + 1} of 16`,
  unit: 'V', min: 2.5, max: 3.8, precision: 3, device: 'DEV-BMS-01',
  modbus: { slave: 81, fc: 4, reg: 100 + i * 2, type: 'uint16', scale: 0.001 },
  alarm: { ll: 2.80, l: 3.00, h: 3.55, hh: 3.65 },
  sim: { model: 'cellV', idx: i },
}));

/** 4 pack temperature probes — BMS thermal map. */
export const TEMP_TAGS = Array.from({ length: 4 }, (_, i) => T({
  id: `TT-81${String(i + 1).padStart(2, '0')}`, area: 'bms', hidden: true,
  name: `Pack Temp Probe ${i + 1}`, desc: `NTC probe ${i + 1} of 4`,
  unit: '°C', min: 0, max: 80, precision: 1, device: 'DEV-BMS-01',
  modbus: { slave: 81, fc: 4, reg: 140 + i * 2, type: 'int16', scale: 0.1 },
  alarm: { ll: 5, l: 10, h: 45, hh: 55 },
  sim: { model: 'cellTemp', idx: i },
}));

export const ALL_TAGS = [...TAGS, ...CELL_TAGS, ...TEMP_TAGS];
export const TAG_MAP = Object.fromEntries(ALL_TAGS.map((t) => [t.id, t]));

/** Field devices / controllers on the RS-485 & Ethernet segments. */
export const DEVICES = [
  { id:'DEV-INV-01',  name:'Hybrid Inverter',            model:'8 kW Hybrid PV Inverter',        proto:'Modbus RTU', slave:1,  bus:'RS-485 #1', area:'pv' },
  { id:'DEV-MTR-01',  name:'Bi-directional Energy Meter',model:'Class 1 AC Meter',               proto:'Modbus RTU', slave:2,  bus:'RS-485 #1', area:'pv' },
  { id:'DEV-IRR-01',  name:'Weather / Irradiance Station',model:'Si-Sensor + PT1000',            proto:'Modbus RTU', slave:11, bus:'RS-485 #1', area:'pv' },
  { id:'DEV-BMS-01',  name:'Battery Management System',  model:'16S LiFePO₄ BMS 51.2 V / 200 Ah',proto:'Modbus RTU', slave:81, bus:'RS-485 #1', area:'bms' },
  { id:'DEV-RAIN-01', name:'Rain Harvest RTU',           model:'8AI / 4DI Remote I/O',           proto:'Modbus RTU', slave:21, bus:'RS-485 #2', area:'rain' },
  { id:'DEV-PMP-2001',name:'Rain Pump Controller',       model:'VFD + Run Feedback',             proto:'Modbus RTU', slave:22, bus:'RS-485 #2', area:'rain' },
  { id:'DEV-INT-01',  name:'River Intake RTU',           model:'12AI / 8DI Remote I/O',          proto:'Modbus RTU', slave:31, bus:'RS-485 #2', area:'intake' },
  { id:'DEV-PMP-3001',name:'River Pump A Controller',    model:'DOL Starter + Vibration Module', proto:'Modbus RTU', slave:32, bus:'RS-485 #2', area:'intake' },
  { id:'DEV-PMP-3002',name:'River Pump B Controller',    model:'DOL Starter',                    proto:'Modbus RTU', slave:33, bus:'RS-485 #2', area:'intake' },
  { id:'DEV-FLT-01',  name:'Filtration Panel RTU',       model:'12AI / 8DI / 4DO Remote I/O',    proto:'Modbus RTU', slave:41, bus:'RS-485 #3', area:'filter' },
  { id:'DEV-RO-01',   name:'RO Skid Junction Box',       model:'Wired, awaiting skid (future)',  proto:'Modbus RTU', slave:51, bus:'RS-485 #3', area:'ro', scope:'future' },
  { id:'DEV-STO-01',  name:'Clean Storage RTU',          model:'8AI / 4DI Remote I/O',           proto:'Modbus RTU', slave:61, bus:'RS-485 #4', area:'storage' },
  { id:'DEV-DIS-01',  name:'Distribution RTU',           model:'8AI / 8DI Remote I/O',           proto:'Modbus RTU', slave:71, bus:'RS-485 #4', area:'dist' },
  { id:'DEV-DIS-02',  name:'School Smart Water Meter',   model:'NB-IoT Ultrasonic Meter',        proto:'Modbus RTU', slave:72, bus:'RS-485 #4', area:'dist' },
  { id:'DEV-DIS-03',  name:'Longhouse Smart Water Meter',model:'NB-IoT Ultrasonic Meter',        proto:'Modbus RTU', slave:73, bus:'RS-485 #4', area:'dist' },
  { id:'GW-EDGE-01',  name:'Edge IoT Gateway',           model:'Industrial Edge Gateway',        proto:'MQTT / TLS', slave:null, bus:'Ethernet', area:null },
  { id:'PLC-MAIN-01', name:'Main PLC Controller',        model:'Industrial PLC (S7-1200 class)', proto:'Modbus TCP', slave:null, bus:'Ethernet', area:null },
  { id:'HMI-01',      name:'Control Room HMI',           model:'15" Touchscreen HMI',            proto:'Modbus TCP', slave:null, bus:'Ethernet', area:null },
];

export const ROLES = {
  admin:      { label:'System Administrator', rank:5, perms:['view','operate','configure','admin'], scope:'Full access (all systems)' },
  engineer:   { label:'IoT / SCADA Engineer', rank:4, perms:['view','operate','configure'],        scope:'Configure, monitor, control' },
  operator:   { label:'Plant Operator',       rank:3, perms:['view','operate'],                    scope:'Monitor & operate' },
  technician: { label:'Maintenance Technician',rank:2,perms:['view','maintain'],                   scope:'Monitor & maintenance' },
  manager:    { label:'Manager / Supervisor', rank:2, perms:['view','report'],                     scope:'View reports & dashboard' },
  community:  { label:'End User / Community', rank:1, perms:['view-limited'],                      scope:'View (limited dashboard)' },
};
