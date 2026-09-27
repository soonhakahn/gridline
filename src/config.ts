// Central tuning constants for GRIDLINE.
// All speeds in m/s internally, displayed as km/h.

export const SIM_DT = 1 / 60;
export const MAX_SIM_STEPS = 4;

// ---- Vehicle ----
export const CAR_MASS = 800; // kg
export const CAR_LENGTH = 5.6;
export const CAR_WIDTH = 2.0;
export const CAR_HALF_W = 1.0;

// Engine: peak force per gear tuned so top speeds land correctly.
export const ENGINE_FORCE = 13000; // N at full throttle, 1st gear reference
export const GEAR_RATIOS = [3.4, 2.6, 2.05, 1.66, 1.38, 1.16, 1.0, 0.88];
export const FINAL_DRIVE = 3.1;
export const WHEEL_RADIUS = 0.33;
export const RPM_IDLE = 4000;
export const RPM_MAX = 15000;
export const RPM_SHIFT = 14200;

// Aero: two modes. CM = corner (grip), SM = straight (low drag).
export const AERO = {
  CM: { drag: 1.02, grip: 1.0, downforce: 1.0 },
  SM: { drag: 0.68, grip: 0.84, downforce: 0.72 },
} as const;
export const FRONTAL_AREA = 1.55; // m^2
export const AIR_DENSITY = 1.225;
export const ROLL_RESIST = 0.012;

// Battery 0..100
export const BATTERY_MAX = 100;
export const DEPLOY_RATE = 14; // per second at full deployment
export const DEPLOY_GAIN = 520; // N per unit of deploy rate (tuned: ~half of >160km/h accel)
export const DEPLOY_MIN_SPEED = 44.4; // 160 km/h
export const DEPLOY_TAPER_START = 80.5; // 290 km/h
export const DEPLOY_TAPER_END = 93.0; // 335 km/h (OT extends full deployment here)
export const HARVEST_RATE = 26; // per second under full braking
export const BOOST_DRAIN = 30; // per second
export const BOOST_DRAIN_OT = 17; // per second while Overtake armed
export const BOOST_GAIN = 2200; // extra N while boosting (before taper)

// Tyres: grip multiplier + wear per lap (fraction of grip lost per lap)
export const TYRES = {
  soft: { grip: 1.04, wearPerLap: 0.022, label: 'SOFT' },
  medium: { grip: 1.0, wearPerLap: 0.012, label: 'MEDIUM' },
  hard: { grip: 0.965, wearPerLap: 0.006, label: 'HARD' },
} as const;
export type TyreCompound = keyof typeof TYRES;

// Grip / cornering: speed-dependent (mechanical base + downforce)
export const LAT_BASE = 24; // m/s^2 mechanical grip
export const LAT_REF = 60; // m/s downforce reference speed
export const LAT_DF = 18; // downforce coefficient
export const SLIDE_SCRUB = 9; // m/s^2 scrubbed when over the grip limit

// Collisions
export const CAR_RADIUS = 2.6; // collision circle radius (world XZ)
export const WALL_SCRUB = 3.2; // speed scrub factor on wall contact

// ---- Race ----
export const QUICK_RACE_LAPS = 5;
export const GRID_SIZE = 8;
export const OT_GAP_ARM = 1.0; // seconds at DET board to arm Overtake
export const DEFEND_GAP = 0.6; // seconds for AI defensive line
export const FALSE_START_PENALTY = 5; // seconds

// ---- Track ----
export const TRACK_HALF_WIDTH = 6.0; // 12 m wide
export const SAMPLE_DS = 2.0; // meters between centerline samples

// 8 fictional teams: base color, accent color, number, name.
export interface Livery {
  name: string;
  number: number;
  base: number;
  accent: number;
}
export const LIVERIES: Livery[] = [
  { name: 'Crimson Apex', number: 7, base: 0xc8102e, accent: 0xffffff },
  { name: 'Azure Drift', number: 12, base: 0x0055ff, accent: 0x00e5ff },
  { name: 'Volt Racing', number: 23, base: 0xb8e600, accent: 0x141414 },
  { name: 'Solaris', number: 34, base: 0xff8c00, accent: 0x1a1a1a },
  { name: 'Jade Motorsport', number: 45, base: 0x00a86b, accent: 0xffffff },
  { name: 'Onyx GP', number: 56, base: 0x181818, accent: 0xff2d78 },
  { name: 'Glacier Racing', number: 68, base: 0xdceeff, accent: 0x0066cc },
  { name: 'Magma Works', number: 91, base: 0x5a1a8a, accent: 0xffcc00 },
];

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { pace: number; mistakePerRace: [number, number]; label: string }> = {
  easy: { pace: 0.93, mistakePerRace: [3, 5], label: 'Easy' },
  normal: { pace: 0.965, mistakePerRace: [1, 3], label: 'Normal' },
  hard: { pace: 0.99, mistakePerRace: [0, 2], label: 'Hard' },
};

export type GraphicsQuality = 'low' | 'high';
