import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * SHESHA coachworks: every vehicle in the game is generated here (no textures, vertex colours only).
 * Bodies are lofted from a side profile through sculpted cross-sections (rocker, flared wheel arches, shoulder crease, tumblehome
 * glasshouse, crowned roof) and then dressed with a per-model kit: LED light signatures, grilles, aero, off-road gear, emergency
 * lighting, cargo bodies and liveries. Special builders cover the open vehicles (tractor, loader, kart).
 * Output per vehicle: one body geometry with two groups (0 = paint / trim, 1 = lamps that glow) + one wheel geometry per wheel size.
 * `lite` builds (parked cars merged into street chunks) use fewer stations, skip small parts and return a single group.
 * Forward = +z, ground = y 0.
 */
export type CarKind =
  | 'sedan' | 'hatch' | 'bakkie' | 'suv' | 'minibus' | 'coach' | 'coupe' | 'bakkie1' | 'cruiser'
  | 'sport' | 'hothatch' | 'gt' | 'hyper' | 'taxi' | 'police' | 'lux' | 'kombi' | 'box' | 'dropside' | 'lorry' | 'flatbed'
  | 'fire' | 'garbage' | 'ambulance' | 'trophy' | 'tractor' | 'loader' | 'kart';

type Kit = 'plain' | 'sport' | 'gt' | 'hyper' | 'off' | 'lux' | 'work' | 'bus' | 'police' | 'taxi' | 'retro' | 'trophy' | 'truck';
type Rim = 'multi' | 'five' | 'mesh' | 'steel' | 'race' | 'turbine' | 'truck' | 'tractor' | 'kart';
type Head = 'slim' | 'round' | 'square' | 'quad' | 'bar';
type Grille = 'mesh' | 'slat' | 'big' | 'kidney' | 'slot' | 'none';
type Tail = 'bar' | 'cluster' | 'tall' | 'round';
interface Liv { t: 'stripe' | 'checker' | 'blocks' | 'racing' | 'twin' | 'side' | 'upper'; c1: number[]; c2?: number[] }
interface Cargo { t: 'box' | 'flat' | 'drop' | 'fire' | 'garbage' | 'amb'; z0: number; z1: number; top: number; w: number; col?: number[] }
interface Spec {
  L: number; W: number; H: number; wr: number; wrR?: number; ax: [number, number]; belt: number; sill: number;
  prof: [number, number][]; glass: [number, number][]; bed?: [number, number];
  flare?: number; shoulder?: number; tumble?: number; corner?: number; extraAx?: number[]; dual?: boolean;
  kit: Kit; rim: Rim; head: Head; grille: Grille; tail: Tail;
  roof?: number[]; blackPillar?: boolean; liv?: Liv; cargo?: Cargo; caliper?: number[]; tw?: number; special?: 'tractor' | 'loader' | 'kart';
}

// ---------------------------------------------------------------- palette (linear-ish albedo; lamps are drawn unlit)
const GLASS = [0.018, 0.028, 0.042], DARK = [0.028, 0.028, 0.032], GBLACK = [0.012, 0.012, 0.014], TYRE = [0.022, 0.022, 0.025], CHROME = [0.86, 0.88, 0.9],
  STEEL = [0.42, 0.44, 0.47], GUN = [0.16, 0.17, 0.19], PLATE = [0.93, 0.82, 0.18], WHITE = [0.92, 0.92, 0.9], CARBON = [0.05, 0.05, 0.055], RED = [0.75, 0.04, 0.03],
  YEL = [0.95, 0.7, 0.04], BLU = [0.04, 0.16, 0.6], WOOD = [0.36, 0.24, 0.13];
const HEAD = [1.25, 1.25, 1.18], DRL = [1.5, 1.7, 2.0], TAIL = [0.85, 0.03, 0.03], AMBER = [1.3, 0.55, 0.04], BLUEL = [0.15, 0.35, 1.8], REDL = [1.8, 0.06, 0.05], REV = [0.9, 0.9, 0.9];

// ---------------------------------------------------------------- the line-up
const SEDAN_P: [number, number][] = [[-2.315, 0.58], [-2.29, 0.9], [-2.1, 0.98], [-1.55, 1.0], [-1.0, 1.36], [-0.4, 1.44], [0.25, 1.43], [1.0, 0.99], [1.9, 0.86], [2.25, 0.76], [2.315, 0.52]];
const SPORT_P: [number, number][] = [[-2.425, 0.6], [-2.4, 0.92], [-2.15, 0.99], [-1.6, 1.04], [-0.8, 1.34], [-0.2, 1.38], [0.35, 1.36], [1.1, 0.92], [2.05, 0.8], [2.36, 0.68], [2.425, 0.42]];
const BOXCAB_P: [number, number][] = [[-3.0, 0.82], [-2.99, 1.02], [0.98, 1.02], [1.02, 2.12], [1.6, 2.18], [2.35, 1.36], [2.82, 1.1], [3.0, 0.68]];
const LORRY_P: [number, number][] = [[-3.7, 0.92], [-3.69, 1.18], [1.85, 1.18], [1.9, 2.8], [2.2, 2.95], [3.4, 2.95], [3.62, 2.72], [3.7, 1.7], [3.71, 0.78]];
const SPECS: Record<CarKind, Spec> = {
  // --- the Manzini street fleet
  sedan: { L: 4.63, W: 1.78, H: 1.44, wr: 0.33, ax: [-1.34, 1.36], belt: 0.92, sill: 0.3, prof: SEDAN_P, glass: [[-1.0, -0.1], [-0.02, 0.85]], flare: 0.03, shoulder: 0.025, kit: 'plain', rim: 'five', head: 'slim', grille: 'slat', tail: 'cluster' },
  hatch: { L: 4.05, W: 1.75, H: 1.47, wr: 0.32, ax: [-1.24, 1.28], belt: 0.95, sill: 0.3, prof: [[-2.025, 0.6], [-2.0, 0.98], [-1.9, 1.32], [-1.55, 1.45], [-0.6, 1.47], [0.25, 1.45], [0.95, 1.0], [1.8, 0.86], [1.98, 0.74], [2.025, 0.52]], glass: [[-1.5, -0.85], [-0.75, -0.05], [0.05, 0.85]], flare: 0.03, shoulder: 0.02, kit: 'plain', rim: 'multi', head: 'slim', grille: 'mesh', tail: 'cluster' },
  coupe: { L: 4.33, W: 1.66, H: 1.37, wr: 0.31, ax: [-1.26, 1.31], belt: 0.9, sill: 0.27, prof: [[-2.165, 0.56], [-2.15, 0.93], [-1.45, 0.97], [-1.0, 1.34], [0.1, 1.37], [0.75, 0.98], [1.95, 0.87], [2.14, 0.8], [2.165, 0.5]], glass: [[-0.95, -0.15], [-0.08, 0.68]], corner: 0.06, flare: 0.035, shoulder: 0.015, tumble: 0.84, kit: 'retro', rim: 'mesh', head: 'quad', grille: 'kidney', tail: 'bar' },
  suv: { L: 4.8, W: 1.86, H: 1.82, wr: 0.38, ax: [-1.37, 1.4], belt: 1.15, sill: 0.45, prof: [[-2.4, 0.72], [-2.38, 1.2], [-2.3, 1.72], [-2.0, 1.8], [0.3, 1.82], [1.0, 1.25], [2.1, 1.12], [2.36, 0.98], [2.4, 0.7]], glass: [[-2.15, -1.25], [-1.15, -0.2], [-0.1, 0.85]], flare: 0.05, shoulder: 0.025, kit: 'off', rim: 'five', head: 'slim', grille: 'big', tail: 'tall', blackPillar: true },
  cruiser: { L: 4.9, W: 1.87, H: 1.98, wr: 0.4, ax: [-1.42, 1.45], belt: 1.24, sill: 0.5, prof: [[-2.45, 0.78], [-2.44, 1.3], [-2.42, 1.94], [-2.1, 1.98], [0.45, 1.98], [0.82, 1.3], [2.25, 1.2], [2.43, 1.05], [2.45, 0.74]], glass: [[-2.2, -1.25], [-1.15, -0.2], [-0.1, 0.72]], corner: 0.05, flare: 0.07, shoulder: 0.01, tumble: 0.9, kit: 'off', rim: 'steel', head: 'round', grille: 'slat', tail: 'tall', roof: WHITE },
  bakkie: { L: 5.32, W: 1.86, H: 1.8, wr: 0.38, ax: [-1.56, 1.52], belt: 1.15, sill: 0.46, prof: [[-2.66, 0.72], [-2.64, 1.14], [-0.98, 1.14], [-0.85, 1.74], [-0.3, 1.8], [0.55, 1.8], [1.25, 1.22], [2.4, 1.1], [2.62, 0.96], [2.66, 0.68]], glass: [[-0.75, 0.0], [0.08, 1.0]], bed: [-2.6, -0.98], flare: 0.06, shoulder: 0.025, kit: 'off', rim: 'five', head: 'slim', grille: 'big', tail: 'tall' },
  bakkie1: { L: 5.2, W: 1.8, H: 1.74, wr: 0.37, ax: [-1.5, 1.6], belt: 1.14, sill: 0.44, prof: [[-2.6, 0.72], [-2.58, 1.12], [-0.32, 1.12], [-0.2, 1.7], [0.2, 1.74], [0.7, 1.74], [1.35, 1.18], [2.36, 1.06], [2.56, 0.94], [2.6, 0.66]], glass: [[-0.1, 1.05]], bed: [-2.55, -0.32], flare: 0.04, kit: 'work', rim: 'steel', head: 'square', grille: 'big', tail: 'tall' },
  minibus: { L: 5.38, W: 1.88, H: 2.28, wr: 0.36, ax: [-1.65, 1.6], belt: 1.22, sill: 0.42, prof: [[-2.69, 0.62], [-2.67, 2.1], [-2.45, 2.28], [1.45, 2.28], [1.75, 2.2], [2.32, 1.3], [2.62, 1.08], [2.69, 0.62]], glass: [[-2.45, -1.25], [-1.15, 0.05], [0.15, 1.7]], tumble: 0.95, kit: 'bus', rim: 'steel', head: 'slim', grille: 'big', tail: 'tall', blackPillar: true, liv: { t: 'stripe', c1: [0.85, 0.62, 0.05] } },
  coach: { L: 12, W: 2.5, H: 3.5, wr: 0.5, ax: [-3.4, 3.9], extraAx: [-4.75], belt: 1.95, sill: 0.55, prof: [[-6, 0.75], [-5.98, 3.3], [-5.6, 3.5], [5.2, 3.5], [5.6, 3.4], [5.95, 1.8], [6, 0.75]], glass: [[-5.6, 5.4]], tumble: 0.97, corner: 0.03, kit: 'bus', rim: 'truck', head: 'slim', grille: 'slot', tail: 'tall', blackPillar: true, liv: { t: 'stripe', c1: [0.1, 0.3, 0.85] } },
  // --- performance
  sport: { L: 4.85, W: 1.9, H: 1.38, wr: 0.35, ax: [-1.42, 1.46], belt: 0.9, sill: 0.27, prof: SPORT_P, glass: [[-1.3, -0.2], [-0.1, 0.92]], flare: 0.06, shoulder: 0.035, corner: 0.16, tumble: 0.76, kit: 'sport', rim: 'multi', head: 'slim', grille: 'mesh', tail: 'bar', roof: GBLACK, blackPillar: true, caliper: [0.85, 0.06, 0.04] },
  hothatch: { L: 4.1, W: 1.82, H: 1.43, wr: 0.33, ax: [-1.26, 1.3], belt: 0.93, sill: 0.27, prof: [[-2.05, 0.62], [-2.02, 0.98], [-1.9, 1.3], [-1.55, 1.42], [-0.6, 1.43], [0.25, 1.41], [0.98, 0.96], [1.82, 0.82], [2.0, 0.7], [2.05, 0.48]], glass: [[-1.55, -0.6], [-0.5, 0.85]], flare: 0.07, shoulder: 0.03, tumble: 0.78, kit: 'sport', rim: 'five', head: 'slim', grille: 'mesh', tail: 'cluster', roof: GBLACK, blackPillar: true, liv: { t: 'twin', c1: WHITE }, caliper: [0.85, 0.06, 0.04] },
  gt: { L: 4.6, W: 2.0, H: 1.24, wr: 0.35, ax: [-1.3, 1.35], belt: 0.82, sill: 0.22, prof: [[-2.3, 0.62], [-2.27, 0.92], [-1.7, 0.98], [-0.9, 1.2], [-0.3, 1.24], [0.3, 1.21], [0.95, 0.84], [1.9, 0.7], [2.22, 0.56], [2.3, 0.36]], glass: [[-0.8, 0.8]], flare: 0.11, shoulder: 0.04, corner: 0.2, tumble: 0.7, kit: 'gt', rim: 'race', head: 'slim', grille: 'mesh', tail: 'bar', roof: GBLACK, blackPillar: true, liv: { t: 'racing', c1: WHITE }, caliper: [0.95, 0.75, 0.05] },
  hyper: { L: 4.9, W: 2.0, H: 1.08, wr: 0.36, ax: [-1.4, 1.5], belt: 0.62, sill: 0.16, prof: [[-2.45, 0.72], [-2.3, 0.96], [-1.5, 0.9], [-0.9, 0.98], [-0.4, 1.08], [0.25, 1.06], [0.85, 0.7], [1.6, 0.56], [2.3, 0.42], [2.45, 0.28]], glass: [[-0.5, 0.75]], flare: 0.13, shoulder: 0.03, corner: 0.28, tumble: 0.5, kit: 'hyper', rim: 'turbine', head: 'bar', grille: 'slot', tail: 'bar', liv: { t: 'side', c1: [0.05, 0.85, 0.9] }, caliper: [0.05, 0.75, 0.9] },
  lux: { L: 4.95, W: 1.98, H: 1.78, wr: 0.4, ax: [-1.45, 1.5], belt: 1.12, sill: 0.42, prof: [[-2.475, 0.72], [-2.46, 1.18], [-2.38, 1.7], [-2.1, 1.76], [0.4, 1.78], [1.05, 1.22], [2.2, 1.12], [2.44, 0.98], [2.475, 0.7]], glass: [[-2.15, -1.2], [-1.1, -0.15], [-0.05, 0.95]], corner: 0.1, flare: 0.035, shoulder: 0.02, tumble: 0.86, kit: 'lux', rim: 'turbine', head: 'slim', grille: 'mesh', tail: 'bar', roof: GBLACK, blackPillar: true, caliper: [0.25, 0.26, 0.28] },
  // --- services
  taxi: { L: 4.63, W: 1.78, H: 1.44, wr: 0.33, ax: [-1.34, 1.36], belt: 0.92, sill: 0.3, prof: SEDAN_P, glass: [[-1.0, -0.1], [-0.02, 0.85]], flare: 0.03, shoulder: 0.025, kit: 'taxi', rim: 'steel', head: 'slim', grille: 'slat', tail: 'cluster', liv: { t: 'checker', c1: GBLACK, c2: WHITE } },
  police: { L: 4.85, W: 1.9, H: 1.42, wr: 0.35, ax: [-1.42, 1.46], belt: 0.92, sill: 0.28, prof: SPORT_P.map(([z, y]) => [z, y > 1 ? y + 0.04 : y] as [number, number]), glass: [[-1.3, -0.2], [-0.1, 0.92]], flare: 0.05, shoulder: 0.03, corner: 0.15, tumble: 0.78, kit: 'police', rim: 'five', head: 'slim', grille: 'mesh', tail: 'bar', blackPillar: true, liv: { t: 'blocks', c1: BLU, c2: [0.95, 0.85, 0.08] } },
  ambulance: { L: 6.0, W: 2.0, H: 2.75, wr: 0.38, ax: [-1.75, 1.75], belt: 1.15, sill: 0.48, prof: BOXCAB_P, glass: [[1.1, 1.95]], bed: [-2.95, 1.0], tumble: 0.92, kit: 'truck', rim: 'steel', head: 'slim', grille: 'big', tail: 'tall', cargo: { t: 'amb', z0: -3.0, z1: 0.98, top: 2.75, w: 2.04 } },
  fire: { L: 7.4, W: 2.35, H: 3.3, wr: 0.5, ax: [-2.35, 2.4], extraAx: [-3.6], dual: true, belt: 1.6, sill: 0.6, prof: LORRY_P, glass: [[2.05, 3.0]], bed: [-3.65, 1.85], tumble: 0.95, corner: 0.03, kit: 'truck', rim: 'truck', head: 'square', grille: 'big', tail: 'tall', cargo: { t: 'fire', z0: -3.7, z1: 1.8, top: 3.05, w: 2.4 } },
  garbage: { L: 7.4, W: 2.35, H: 3.4, wr: 0.5, ax: [-2.35, 2.4], extraAx: [-3.6], dual: true, belt: 1.6, sill: 0.6, prof: LORRY_P, glass: [[2.05, 3.0]], bed: [-3.65, 1.85], tumble: 0.95, corner: 0.03, kit: 'truck', rim: 'truck', head: 'square', grille: 'big', tail: 'tall', cargo: { t: 'garbage', z0: -3.75, z1: 1.8, top: 3.3, w: 2.4, col: [0.08, 0.42, 0.18] } },
  // --- vans and trucks
  kombi: { L: 4.6, W: 1.75, H: 2.0, wr: 0.33, ax: [-1.25, 1.2], belt: 1.08, sill: 0.36, prof: [[-2.3, 0.62], [-2.28, 1.6], [-2.15, 1.94], [-1.8, 2.0], [1.6, 2.0], [1.95, 1.9], [2.22, 1.55], [2.3, 1.12], [2.31, 0.6]], glass: [[-1.95, -1.2], [-1.1, -0.2], [-0.1, 0.8], [0.9, 1.75]], corner: 0.22, tumble: 0.92, kit: 'retro', rim: 'steel', head: 'round', grille: 'none', tail: 'round', liv: { t: 'upper', c1: [0.95, 0.94, 0.9] } },
  box: { L: 6.0, W: 2.0, H: 2.75, wr: 0.38, ax: [-1.75, 1.75], belt: 1.15, sill: 0.48, prof: BOXCAB_P, glass: [[1.1, 1.95]], bed: [-2.95, 1.0], tumble: 0.92, kit: 'truck', rim: 'steel', head: 'slim', grille: 'big', tail: 'tall', cargo: { t: 'box', z0: -3.0, z1: 0.98, top: 2.85, w: 2.06, col: [0.94, 0.94, 0.92] } },
  dropside: { L: 6.0, W: 2.0, H: 2.2, wr: 0.38, ax: [-1.75, 1.75], belt: 1.15, sill: 0.48, prof: BOXCAB_P, glass: [[1.1, 1.95]], bed: [-2.95, 1.0], tumble: 0.92, kit: 'truck', rim: 'steel', head: 'slim', grille: 'big', tail: 'tall', cargo: { t: 'drop', z0: -3.0, z1: 0.95, top: 1.5, w: 2.0 } },
  lorry: { L: 7.4, W: 2.35, H: 3.6, wr: 0.5, ax: [-2.35, 2.4], extraAx: [-3.6], dual: true, belt: 1.6, sill: 0.6, prof: LORRY_P, glass: [[2.05, 3.0]], bed: [-3.65, 1.85], tumble: 0.95, corner: 0.03, kit: 'truck', rim: 'truck', head: 'square', grille: 'big', tail: 'tall', cargo: { t: 'box', z0: -3.7, z1: 1.8, top: 3.6, w: 2.46, col: [0.93, 0.93, 0.91] } },
  flatbed: { L: 7.4, W: 2.35, H: 2.95, wr: 0.5, ax: [-2.35, 2.4], extraAx: [-3.6], dual: true, belt: 1.6, sill: 0.6, prof: LORRY_P, glass: [[2.05, 3.0]], bed: [-3.65, 1.85], tumble: 0.95, corner: 0.03, kit: 'truck', rim: 'truck', head: 'square', grille: 'big', tail: 'tall', cargo: { t: 'flat', z0: -3.75, z1: 1.8, top: 1.55, w: 2.45 } },
  trophy: { L: 4.9, W: 2.12, H: 1.92, wr: 0.45, ax: [-1.55, 1.55], belt: 1.25, sill: 0.66, prof: [[-2.45, 0.88], [-2.43, 1.24], [-0.7, 1.24], [-0.58, 1.84], [-0.2, 1.92], [0.45, 1.92], [1.0, 1.34], [2.2, 1.22], [2.42, 1.08], [2.45, 0.82]], glass: [[-0.45, 0.95]], bed: [-2.4, -0.72], flare: 0.15, shoulder: 0.02, kit: 'trophy', rim: 'five', head: 'square', grille: 'mesh', tail: 'tall', roof: GBLACK, liv: { t: 'side', c1: WHITE }, caliper: [0.9, 0.08, 0.04] },
  // --- open vehicles (special builders; prof/glass unused)
  tractor: { L: 4.1, W: 2.1, H: 2.9, wr: 0.5, wrR: 0.82, ax: [-1.0, 1.3], belt: 1.4, sill: 0.6, prof: [[-2, 1], [2, 1]], glass: [], kit: 'work', rim: 'tractor', head: 'round', grille: 'slat', tail: 'round', special: 'tractor', tw: 0.34 },
  loader: { L: 5.0, W: 2.1, H: 2.9, wr: 0.5, wrR: 0.82, ax: [-1.0, 1.3], belt: 1.4, sill: 0.6, prof: [[-2, 1], [2, 1]], glass: [], kit: 'work', rim: 'tractor', head: 'round', grille: 'slat', tail: 'round', special: 'loader', tw: 0.34 },
  kart: { L: 1.9, W: 1.3, H: 1.05, wr: 0.14, wrR: 0.15, ax: [-0.55, 0.55], belt: 0.3, sill: 0.08, prof: [[-1, 0.3], [1, 0.3]], glass: [], kit: 'plain', rim: 'kart', head: 'round', grille: 'none', tail: 'round', special: 'kart', tw: 0.17 },
};

/** Paint colours weighted like a real Southern African car park: mostly white, silver and grey, plus a few bold ones. */
export const PAINTS: number[][] = [[0.86, 0.86, 0.85], [0.86, 0.86, 0.85], [0.86, 0.86, 0.85], [0.55, 0.57, 0.6], [0.55, 0.57, 0.6], [0.22, 0.23, 0.25], [0.22, 0.23, 0.25],
  [0.02, 0.02, 0.025], [0.05, 0.1, 0.25], [0.35, 0.04, 0.05], [0.6, 0.06, 0.05], [0.06, 0.18, 0.12], [0.55, 0.5, 0.42], [0.08, 0.12, 0.2], [0.75, 0.73, 0.68]];   // real car park: white, silver, grey, black, navy, maroon, red, bottle green, champagne

// ---------------------------------------------------------------- shape helpers
const profY = (s: Spec, z: number): number => {
  const p = s.prof; if (z <= p[0][0]) return p[0][1];
  for (let i = 0; i + 1 < p.length; i++) if (z <= p[i + 1][0]) { const t = (z - p[i][0]) / Math.max(1e-4, p[i + 1][0] - p[i][0]); return p[i][1] + (p[i + 1][1] - p[i][1]) * t; }
  return p[p.length - 1][1];
};
const axles = (s: Spec): number[] => [...s.ax, ...(s.extraAx ?? [])];
const planK = (s: Spec, z: number): number => 1 - (s.corner ?? 0.13) * Math.pow(Math.min(1, Math.abs((2 * z) / s.L)), 3.2);
/** Wheel-arch flare amount at z (smooth plateau over each axle). */
const flareAt = (s: Spec, z: number): number => { let f = 0; for (const a of axles(s)) { const d = (z - a) / (s.wr * 1.85); f = Math.max(f, Math.exp(-d * d * d * d)); } return f * (s.flare ?? 0.02); };
const HALF = 11, RING = HALF * 2 + 1;
/** Half cross-section at z, from under the rocker up to the roof crown (11 points). */
function half(s: Spec, z: number): [number, number][] {
  const wS = (s.W / 2) * planK(s, z), fl = flareAt(s, z), sh = s.shoulder ?? 0.015, top = profY(s, z), cabin = top > s.belt + 0.12;
  const wG = cabin ? wS * (s.tumble ?? (s.H > 2 ? 0.93 : 0.8)) : wS * 0.95;
  const yb = cabin ? s.belt : Math.min(s.belt, top - 0.06), ys = s.sill, ym = ys + (yb - ys) * 0.5;
  const p: [number, number][] = [[wS * 0.86, ys - 0.03], [wS * 0.965 + fl * 0.5, ys + 0.04], [wS + fl, ys + 0.15], [wS + fl * 0.92 + sh * 0.3, ym], [wS + sh + fl * 0.25, yb - 0.085], [wS * 0.99, yb]];
  // wheel arches: lower-body points inside an arch circle are lifted onto its rim, which opens a clean round wheel well
  for (const a of axles(s)) { const r = a < 0 ? (s.wrR ?? s.wr) : s.wr, R = r * 1.13, dz = z - a; if (Math.abs(dz) >= R) continue; const yA = r + Math.sqrt(R * R - dz * dz); for (let j = 0; j < 5; j++) if (p[j][1] < yA) p[j][1] = Math.min(yA, yb - 0.02 - (4 - j) * 0.002); }
  if (cabin) { const gt = top - Math.min(0.12, (top - yb) * 0.22); p.push([wS * 0.955, yb + 0.03], [wG, gt], [wG * 0.94, top - 0.025], [wG * 0.64, top], [wG * 0.27, top + 0.03]); }
  else { const r = Math.max(0.01, top - yb); p.push([wS * 0.955, yb + r * 0.35 + 0.004], [wS * 0.9, yb + r * 0.75 + 0.008], [wS * 0.8, top], [wS * 0.5, top + 0.014], [wS * 0.2, top + 0.022]); }
  return p;
}
const sideAt = (s: Spec, z: number, k = 3): number => half(s, z)[k][0];
const wheelX = (s: Spec, r: number): number => {
  if (s.special === 'kart') return 0.55; if (s.special) return s.W / 2 - (s.tw ?? 0.3) / 2 - (r > 0.6 ? 0 : 0.18);
  return sideAt(s, s.ax[1], 2) + 0.012 - tyreW(s, r) / 2;   // tyre wall flush with the flared arch
};
const tyreW = (s: Spec, r: number): number => s.tw ?? (s.kit === 'gt' || s.kit === 'hyper' ? r * 0.82 : s.kit === 'sport' || s.kit === 'trophy' ? r * 0.72 : r * 0.62);

// ---------------------------------------------------------------- geometry builders
type Buckets = THREE.BufferGeometry[][];
/** Polished alloy colours (wheel faces) registered by the wheel builder. */
const ALLOY = new WeakSet<number[]>();
/**
 * Surface type of a colour, read by the vehicle shader (one draw call, many real materials):
 * 0 paint (clear-coated, metallic flake) · 1 glass · 2 chrome · 3 gloss-black trim · 4 matte rubber / plastic · 5 carbon fibre
 * 6 tyre rubber · 7 brushed / cast metal · 8 plate / vinyl · 9 polished alloy
 */
function surfOf(c: number[]): number {
  return c === GLASS ? 1 : c === CHROME ? 2 : c === GBLACK ? 3 : c === DARK ? 4 : c === CARBON ? 5 : c === TYRE ? 6 : c === STEEL || c === GUN ? 7 : c === PLATE ? 8 : ALLOY.has(c) ? 9 : 0;
}
function paint(g: THREE.BufferGeometry, c: number[]): THREE.BufferGeometry {
  if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes['position'].count, a = new Float32Array(n * 3), sf = new Float32Array(n).fill(surfOf(c));
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.setAttribute('surf', new THREE.BufferAttribute(sf, 1)); return g;
}
/** Turn a surface inside out (render its inner faces). */
function flip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); n.computeVertexNormals();
  const p = n.attributes['position'], nm = n.attributes['normal'];
  for (let t = 0; t < p.count; t += 3) for (const at of [p, nm]) { const x = at.getX(t + 1), y = at.getY(t + 1), z = at.getZ(t + 1); at.setXYZ(t + 1, at.getX(t + 2), at.getY(t + 2), at.getZ(t + 2)); at.setXYZ(t + 2, x, y, z); }
  for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), -nm.getY(i), -nm.getZ(i));
  return n;
}
class Dress {
  readonly b: Buckets = [[], []];
  constructor(readonly lite: boolean) {}
  /** Add a geometry: bucket 0 = body (paint material), 1 = lamp (unlit). */
  put(g: THREE.BufferGeometry, c: number[], lamp = false): void { this.b[lamp ? 1 : 0].push(paint(g, c)); }
  box(sx: number, sy: number, sz: number, x: number, y: number, z: number, c: number[], o: { rx?: number; ry?: number; rz?: number; lamp?: boolean } = {}): void {
    if (this.lite && Math.max(sx, sy, sz) < 0.2 && !o.lamp) return;   // far LOD: small trim is invisible anyway
    const g = new THREE.BoxGeometry(sx, sy, sz); if (o.rz) g.rotateZ(o.rz); if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); g.translate(x, y, z); this.put(g, c, o.lamp);
  }
  /** Cylinder along an axis. */
  cyl(r0: number, r1: number, h: number, x: number, y: number, z: number, c: number[], axis: 'x' | 'y' | 'z' = 'y', seg = 12, lamp = false, rx = 0): void {
    if (this.lite && Math.max(r0, r1) < 0.08 && h < 0.3 && !lamp) return;
    const g = new THREE.CylinderGeometry(r0, r1, h, this.lite ? Math.max(6, seg >> 1) : seg); if (axis === 'x') g.rotateZ(Math.PI / 2); if (axis === 'z') g.rotateX(Math.PI / 2); if (rx) g.rotateX(rx); g.translate(x, y, z); this.put(g, c, lamp);
  }
  sph(r: number, x: number, y: number, z: number, c: number[], sx = 1, sy = 1, sz = 1): void { const g = new THREE.SphereGeometry(r, this.lite ? 8 : 14, this.lite ? 6 : 10); g.scale(sx, sy, sz); g.translate(x, y, z); this.put(g, c); }
  /** Arc of boxes (fender / arch lip) around a centre in the y-z plane, at lateral x. */
  arc(x: number, cy: number, cz: number, R: number, a0: number, a1: number, wx: number, th: number, c: number[], n = 7): void {
    for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * (i + 0.5)) / n, len = (R * (a1 - a0)) / n + 0.01; this.box(wx, th, len, x, cy + Math.sin(a) * R, cz + Math.cos(a) * R, c, { rx: -(a - Math.PI / 2) + 0 }); }
  }
}

/** The lofted shell, coloured per band (rocker, doors, shoulder, glass, pillars, roof) with the livery applied. */
function loft(s: Spec, col: number[], d: Dress, liv?: Liv): void {
  const zs = new Set<number>(); const N = d.lite ? (s.L > 8 ? 14 : 9) : s.L > 8 ? 40 : s.L > 5.5 ? 34 : 28;
  for (let i = 0; i <= N; i++) zs.add(Math.round((-s.L / 2 + (s.L * i) / N) * 1000) / 1000);
  for (const p of s.prof) zs.add(p[0]); if (!d.lite) for (const gl of s.glass) { zs.add(gl[0]); zs.add(gl[1]); } for (const a of axles(s)) { const R = (a < 0 ? (s.wrR ?? s.wr) : s.wr) * 1.13, n = d.lite ? 4 : 10; for (let k = 0; k <= n; k++) zs.add(Math.round((a - R + (2 * R * k) / n) * 1000) / 1000); zs.add(a - R - 0.03); zs.add(a + R + 0.03); }
  if (s.bed) { zs.add(s.bed[0]); zs.add(s.bed[1]); }
  if (liv?.t === 'blocks') for (let z = -s.L / 2; z < s.L / 2; z += 0.45) zs.add(Math.round(z * 1000) / 1000);
  const Z = [...zs].filter((z) => z >= -s.L / 2 - 1e-6 && z <= s.L / 2 + 1e-6).sort((a, b) => a - b);
  const pos: number[] = [], idx: number[] = [], triCol: number[][] = [];
  for (const z of Z) { const h = half(s, z); for (let j = 0; j < HALF; j++) pos.push(-h[j][0], h[j][1], z); pos.push(0, h[HALF - 1][1] + (h[HALF - 1][1] > s.belt + 0.1 ? 0.012 : 0.006), z); for (let j = HALF - 1; j >= 0; j--) pos.push(h[j][0], h[j][1], z); }
  const roofC = s.roof ?? col, pillarC = s.blackPillar ? GBLACK : roofC;
  for (let i = 0; i + 1 < Z.length; i++) {
    const zm = (Z[i] + Z[i + 1]) / 2, top = profY(s, zm), cabin = top > s.belt + 0.12, slope = Math.abs(profY(s, Z[i + 1]) - profY(s, Z[i])) / Math.max(0.01, Z[i + 1] - Z[i]);
    const inGlass = cabin && s.glass.some(([a, b]) => zm > a + 0.03 && zm < b - 0.03), screen = cabin && slope > 0.3;
    const bed = !!s.bed && zm > s.bed[0] && zm < s.bed[1];
    for (let j = 0; j + 1 < RING; j++) {
      const a = i * RING + j, b = a + 1, c = a + RING, e = c + 1; idx.push(a, c, b, b, c, e);
      const k = j < HALF ? j : RING - 2 - j, right = j >= HALF;
      let q = col;
      if (k === 0) q = DARK;
      else if (k === 1 && (s.kit === 'sport' || s.kit === 'gt' || s.kit === 'hyper' || s.kit === 'off' || s.kit === 'trophy')) q = s.kit === 'off' || s.kit === 'trophy' ? GUN : CARBON;
      else if (cabin && k === 5) q = s.kit === 'lux' || s.kit === 'retro' ? CHROME : GBLACK;
      else if (cabin && k === 6) q = inGlass ? GLASS : pillarC;
      else if (cabin && k === 7) q = screen ? pillarC : roofC;
      else if (cabin && k >= 8) q = screen ? GLASS : roofC;
      else if (bed && k >= 6) q = DARK;
      if (liv && q === col) {
        const L = liv;
        if (L.t === 'stripe' && k === 3) q = L.c1;
        else if (L.t === 'side' && (k === 2 || k === 3) && zm > s.ax[0] + 0.5 && zm < s.ax[1] - 0.4) q = k === 2 ? L.c1 : col;
        else if (L.t === 'checker' && k === 3) q = (i + (right ? 1 : 0)) % 2 ? L.c1 : (L.c2 ?? col);
        else if (L.t === 'blocks' && (k === 2 || k === 3)) q = (Math.floor((zm + 10) / 0.45) + k) % 2 ? L.c1 : (L.c2 ?? WHITE);
        else if (L.t === 'racing' && k >= 9) q = L.c1;
        else if (L.t === 'twin' && k === 9) q = L.c1;
        else if (L.t === 'upper' && k >= 4) q = L.c1;
      }
      if (liv && (liv.t === 'racing' || liv.t === 'twin') && cabin && k >= 8 && !screen && q === roofC && roofC !== col) q = liv.t === 'racing' && k >= 9 ? liv.c1 : q;
      triCol.push(q, q);
    }
  }
  // underside + end caps (fanned to the centre of each end ring)
  const under = pos.length / 3; for (const z of Z) pos.push(0, s.sill - 0.04, z);
  for (let i = 0; i + 1 < Z.length; i++) { const a = i * RING, c = a + RING, m = under + i, r0 = i * RING + RING - 1, r1 = (i + 1) * RING + RING - 1; idx.push(a, m, c, c, m, m + 1, r0, r1, m, m, r1, m + 1); triCol.push(DARK, DARK, DARK, DARK); }
  for (const end of [0, Z.length - 1]) {
    const c0 = pos.length / 3; let cy = 0; for (let j = 0; j < RING; j++) cy += pos[(end * RING + j) * 3 + 1]; pos.push(0, cy / RING, Z[end]);
    for (let j = 0; j + 1 < RING; j++) { const a = end * RING + j, b = a + 1; if (end === 0) idx.push(a, b, c0); else idx.push(a, c0, b); triCol.push(col); }
  }
  const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g0.setIndex(idx); g0.computeVertexNormals();
  const g = g0.toNonIndexed(); g0.dispose();
  const nTri = g.attributes['position'].count / 3, ca = new Float32Array(nTri * 9), pa = g.attributes['position'];
  for (let t = 0; t < nTri; t++) { const q = triCol[t] ?? col; for (let v = 0; v < 3; v++) { const y = pa.getY(t * 3 + v), ao = 0.72 + 0.28 * Math.min(1, Math.max(0, (y - s.sill + 0.05) / Math.max(0.2, s.belt - s.sill))); ca[t * 9 + v * 3] = q[0] * ao; ca[t * 9 + v * 3 + 1] = q[1] * ao; ca[t * 9 + v * 3 + 2] = q[2] * ao; } }
  const sa = new Float32Array(nTri * 3); for (let t = 0; t < nTri; t++) sa[t * 3] = sa[t * 3 + 1] = sa[t * 3 + 2] = surfOf(triCol[t] ?? col);
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); g.setAttribute('surf', new THREE.BufferAttribute(sa, 1)); d.b[0].push(g);
}

// ---------------------------------------------------------------- dressing: lamps, grilles, aero, kit, cargo
function dress(s: Spec, col: number[], d: Dress, kind: CarKind, liv?: Liv): void {
  const f = s.L / 2, hw = s.W / 2, lite = d.lite;
  const noseY = (z: number): number => profY(s, z), front = f - 0.02, rear = -f + 0.02;
  const nTop = noseY(f - 0.06), cabOver = s.H > 2.6 && !!s.cargo;
  const lampY = Math.max(s.sill + 0.22, Math.min(nTop - (cabOver ? 0.55 : 0.09), s.belt - (s.H > 2 ? 0.25 : 0.1)));
  const fw = (s.W / 2) * planK(s, f), rw = (s.W / 2) * planK(s, -f);
  const nSlope = Math.atan2(noseY(f - 0.25) - noseY(f - 0.02), 0.23);
  const tailY = Math.max(s.sill + 0.3, Math.min(noseY(-f + 0.05) - 0.1, s.belt - 0.04));

  // ---- headlights
  for (const sd of [-1, 1]) {
    const lx = sd * fw * 0.66;
    if (s.head === 'slim') {
      const big = s.H > 1.7, lh = big ? 0.13 : 0.085, lw = fw * (big ? 0.42 : 0.46);
      d.box(lw, lh, 0.05, lx, lampY, front - 0.005, GBLACK, { rx: nSlope * 0.6, ry: -sd * 0.12 });
      d.box(lw * 0.36, lh * 0.55, 0.06, lx + sd * lw * 0.18, lampY + 0.004, front + 0.005, HEAD, { lamp: true, rx: nSlope * 0.6, ry: -sd * 0.12 });         // projector
      d.box(lw * 0.36, lh * 0.55, 0.06, lx - sd * lw * 0.2, lampY + 0.004, front - 0.005, HEAD, { lamp: true, rx: nSlope * 0.6, ry: -sd * 0.12 });
      d.box(lw * 0.98, 0.018, 0.05, lx, lampY - lh * 0.5, front + 0.0, DRL, { lamp: true, rx: nSlope * 0.6, ry: -sd * 0.12 });                              // DRL underline
      if (!lite) d.box(0.022, 0.1, 0.05, sd * fw * 0.9, lampY - 0.04, front - 0.04, DRL, { lamp: true, ry: -sd * 0.5 });                   // wrap-around hook
    } else if (s.head === 'round') {
      d.cyl(0.13, 0.13, 0.1, lx * 0.95, lampY, front + 0.01, CHROME, 'z', 16); d.cyl(0.105, 0.105, 0.1, lx * 0.95, lampY, front + 0.03, HEAD, 'z', 16, true);
      if (!lite) d.cyl(0.04, 0.04, 0.06, lx * 0.95, lampY - 0.24, front + 0.02, AMBER, 'z', 8, true);
    } else if (s.head === 'quad') {
      for (const o of [0.12, 0.34]) { d.box(0.2, 0.17, 0.08, sd * (fw * 0.3 + o), lampY, front + 0.01, GBLACK); d.cyl(0.075, 0.075, 0.06, sd * (fw * 0.3 + o), lampY, front + 0.03, HEAD, 'z', 12, true); }
    } else if (s.head === 'square') {
      d.box(0.36, 0.22, 0.08, sd * fw * 0.72, lampY, front + 0.01, CHROME); d.box(0.3, 0.17, 0.06, sd * fw * 0.72, lampY, front + 0.04, HEAD, { lamp: true });
      d.box(0.1, 0.17, 0.06, sd * fw * 0.94, lampY, front + 0.02, AMBER, { lamp: true });
    }
  }
  if (s.head === 'bar') { d.box(fw * 1.7, 0.035, 0.06, 0, lampY + 0.02, front + 0.03, DRL, { lamp: true }); for (const sd of [-1, 1]) d.box(0.28, 0.06, 0.06, sd * fw * 0.7, lampY - 0.04, front + 0.02, HEAD, { lamp: true, ry: -sd * 0.25 }); }

  // ---- grille + lower fascia
  const gTop = s.head === 'bar' ? lampY - 0.08 : lampY + (cabOver ? 0.25 : 0.04), gBot = s.sill + 0.16;
  const gw = s.grille === 'big' ? fw * 1.05 : fw * 0.8, gh = Math.max(0.08, gTop - gBot), gy = (gTop + gBot) / 2;
  if (s.grille === 'mesh') {
    d.box(fw * 0.95, gh * 0.7, 0.05, 0, gy - gh * 0.05, front + 0.01, GBLACK);
    if (!lite) for (let i = 0; i < 4; i++) d.box(fw * 0.9, 0.012, 0.03, 0, gy - gh * 0.35 + (i + 0.5) * gh * 0.18, front + 0.04, GUN);
  } else if (s.grille === 'slat') {
    d.box(gw, gh * 0.55, 0.05, 0, lampY, front + 0.01, GBLACK); for (let i = 0; i < (lite ? 2 : 4); i++) d.box(gw * 0.96, 0.025, 0.03, 0, lampY - gh * 0.2 + i * gh * 0.13, front + 0.04, CHROME);
  } else if (s.grille === 'big') {
    d.box(gw + 0.06, gh + 0.06, 0.05, 0, gy + 0.03, front + 0.005, CHROME); d.box(gw, gh, 0.05, 0, gy + 0.03, front + 0.02, GBLACK);
    for (let i = 0; i < (lite ? 2 : 5); i++) d.box(gw * 0.94, 0.03, 0.03, 0, gBot + 0.08 + (i * gh) / 5, front + 0.045, s.kit === 'truck' || s.kit === 'bus' ? CHROME : GUN);
  } else if (s.grille === 'kidney') {
    for (const sd of [-1, 1]) { d.box(0.16, 0.2, 0.05, sd * 0.1, lampY, front + 0.02, CHROME); d.box(0.13, 0.17, 0.05, sd * 0.1, lampY, front + 0.035, GBLACK); }
    d.box(fw * 1.4, 0.06, 0.04, 0, lampY, front + 0.01, GBLACK);
  } else if (s.grille === 'slot') d.box(fw * 1.1, 0.05, 0.05, 0, lampY - 0.12, front + 0.02, GBLACK);
  // bumper / lower intake
  if (s.kit === 'sport' || s.kit === 'gt' || s.kit === 'hyper' || s.kit === 'police') {
    d.box(fw * 1.1, 0.16, 0.06, 0, s.sill + 0.12, front + 0.02, GBLACK);
    for (const sd of [-1, 1]) d.box(0.26, 0.12, 0.03, sd * fw * 0.74, s.sill + 0.16, front + 0.012, GBLACK);
    d.box(s.W * (s.kit === 'gt' ? 0.98 : 0.9), 0.025, s.kit === 'gt' ? 0.18 : 0.08, 0, s.sill - 0.02, front + (s.kit === 'gt' ? 0.04 : 0.0), CARBON);                          // splitter
  } else if (s.kit === 'off' || s.kit === 'trophy' || s.kit === 'work') {
    d.box(fw * 2.0, 0.2, 0.16, 0, s.sill + 0.08, front + 0.05, s.kit === 'work' ? STEEL : GUN); d.box(fw * 1.0, 0.07, 0.1, 0, s.sill - 0.06, front + 0.06, STEEL);   // bumper + bash plate
  } else if (s.kit === 'truck' || s.kit === 'bus') {
    d.box(s.W * 0.98, 0.3, 0.14, 0, s.sill + 0.12, front + 0.05, s.kit === 'bus' ? GBLACK : GUN); for (const sd of [-1, 1]) d.box(0.18, 0.08, 0.06, sd * fw * 0.75, s.sill + 0.14, front + 0.13, AMBER, { lamp: true });
  } else { d.box(fw * 1.3, 0.1, 0.05, 0, s.sill + 0.1, front + 0.01, GBLACK); if (!lite) for (const sd of [-1, 1]) d.box(0.13, 0.05, 0.05, sd * fw * 0.75, s.sill + 0.12, front + 0.03, DRL, { lamp: true }); }
  d.box(0.44, 0.1, 0.02, 0, s.sill + (s.kit === 'off' || s.kit === 'work' ? 0.36 : 0.25), front + 0.07, PLATE);

  // ---- tail
  if (s.tail === 'bar') { d.box(rw * 1.75, 0.045, 0.05, 0, tailY, rear - 0.03, TAIL, { lamp: true }); for (const sd of [-1, 1]) d.box(0.3, 0.1, 0.06, sd * rw * 0.78, tailY - 0.02, rear - 0.02, TAIL, { lamp: true, ry: sd * 0.2 }); }
  else if (s.tail === 'cluster') for (const sd of [-1, 1]) { d.box(0.38, 0.13, 0.07, sd * rw * 0.72, tailY, rear - 0.02, GBLACK, { ry: sd * 0.2 }); d.box(0.34, 0.05, 0.05, sd * rw * 0.72, tailY + 0.02, rear - 0.05, TAIL, { lamp: true, ry: sd * 0.2 }); d.box(0.05, 0.1, 0.05, sd * rw * 0.88, tailY - 0.01, rear - 0.05, TAIL, { lamp: true, ry: sd * 0.2 }); if (!lite) d.box(0.1, 0.035, 0.05, sd * rw * 0.62, tailY - 0.045, rear - 0.05, REV, { lamp: true }); }
  else if (s.tail === 'tall') for (const sd of [-1, 1]) { const th = Math.min(0.55, (s.H > 2 ? 0.6 : 0.42)), ty = s.cargo ? s.sill + 0.5 : tailY - th * 0.25; d.box(0.14, th, 0.06, sd * (rw - 0.1), ty, rear - 0.03, GBLACK); d.box(0.1, th * 0.45, 0.05, sd * (rw - 0.1), ty + th * 0.22, rear - 0.055, TAIL, { lamp: true }); d.box(0.1, th * 0.2, 0.05, sd * (rw - 0.1), ty - th * 0.22, rear - 0.055, AMBER, { lamp: true }); }
  else for (const sd of [-1, 1]) d.cyl(0.06, 0.06, 0.06, sd * rw * 0.75, tailY, rear - 0.03, TAIL, 'z', 10, true);
  d.box(0.44, 0.1, 0.02, 0, s.sill + 0.3, rear - 0.035, PLATE);
  if (!s.cargo && s.kit !== 'hyper') d.box(rw * 1.6, 0.14, 0.07, 0, s.sill + 0.08, rear - 0.02, s.kit === 'lux' || s.kit === 'retro' ? CHROME : GBLACK);   // rear bumper insert

  // ---- side details: mirrors, handles, shut lines, arch shadows, calipers
  const mz = s.prof.find((p, i) => i > 0 && p[1] < s.prof[i - 1][1] - 0.2 && p[0] > 0)?.[0] ?? f * 0.4;
  for (const sd of [-1, 1]) {
    const mx = sd * (sideAt(s, mz - 0.12, 5) + 0.08), my = s.belt + (cabOver ? 0.45 : 0.08);
    d.box(0.14, 0.03, 0.05, sd * (sideAt(s, mz - 0.12, 5) + 0.02), my - 0.03, mz - 0.1, GBLACK);
    d.box(0.15, cabOver ? 0.4 : 0.1, 0.08, mx, my, mz - 0.12, s.kit === 'sport' || s.kit === 'gt' || s.kit === 'police' ? CARBON : s.blackPillar ? GBLACK : col, { ry: sd * 0.15 });
    if (!lite && !cabOver) d.box(0.02, 0.025, 0.08, mx + sd * 0.07, my - 0.02, mz - 0.13, AMBER, { lamp: true });
  }
  if (!lite) {
    for (let i = 0; i + 1 < s.glass.length; i++) { const z = (s.glass[i][1] + s.glass[i + 1][0]) / 2; for (const sd of [-1, 1]) d.box(0.01, s.belt - s.sill - 0.18, 0.012, sd * (sideAt(s, z) + 0.004), (s.sill + 0.14 + s.belt) / 2, z, GBLACK); }
    if (s.kit !== 'bus' && !s.cargo) for (const gl of s.glass) for (const sd of [-1, 1]) d.box(0.025, 0.025, 0.15, sd * (sideAt(s, gl[0] + 0.18, 4) + 0.01), s.belt - 0.11, gl[0] + 0.2, s.kit === 'lux' ? CHROME : s.blackPillar ? GBLACK : col);
  }
  const arch = new THREE.CircleGeometry(1, lite ? 10 : 18, 0, Math.PI * 2);
  for (const az of axles(s)) for (const sd of [-1, 1]) {
    const r = az < 0 ? (s.wrR ?? s.wr) : s.wr, R = r * 1.13, sx = (s.W / 2) * planK(s, az) * 0.86, dep = Math.max(0.3, sx - 0.25);
    const ln = new THREE.CylinderGeometry(R, R, dep, lite ? 10 : 18, 1, true, 0, Math.PI); ln.rotateZ(Math.PI / 2); ln.translate(sd * (sx - dep / 2 + 0.01), r, az); d.put(flip(ln), GBLACK);   // wheel-well liner
    const a = arch.clone(); a.scale(R, R, 1); a.rotateY((sd * Math.PI) / 2); a.translate(sd * (sx - dep + 0.01), r, az); d.put(a, GBLACK);
    if (s.kit === 'off' || s.kit === 'trophy') d.arc(sd * (sideAt(s, az, 2) + 0.02), r, az, r * 1.2, 0.05, Math.PI - 0.05, 0.08, 0.07, GUN, lite ? 4 : 9);
    if (s.caliper && !lite) d.box(0.06, r * 0.4, r * 0.3, sd * (wheelX(s, r) - tyreW(s, r) * 0.22), r + r * 0.12, az - r * 0.3, s.caliper);
  }
  arch.dispose();

  // ---- roof furniture & kits
  const rz0 = s.glass.length ? s.glass[0][0] : -0.5, rz1 = s.glass.length ? s.glass[s.glass.length - 1][1] : 0.5, roofY = s.H;
  if (!lite && (s.kit === 'plain' || s.kit === 'sport' || s.kit === 'police' || s.kit === 'lux')) d.box(0.06, 0.06, 0.2, 0, roofY + 0.04, rz0 + 0.05, GBLACK, { rx: 0.25 });   // shark-fin antenna
  // exhausts
  const ex = (n: number, r: number, c: number[]): void => { for (let i = 0; i < n; i++) { const sd = i % 2 ? 1 : -1, o = n > 2 ? (i < 2 ? 0.55 : 0.75) : 0.65; d.cyl(r, r, 0.14, sd * rw * o, s.sill + 0.06, rear - 0.05, c, 'z', 12); if (!lite) d.cyl(r * 0.7, r * 0.7, 0.15, sd * rw * o, s.sill + 0.06, rear - 0.06, GBLACK, 'z', 10); } };
  switch (s.kit) {
    case 'sport': {
      ex(4, 0.045, CHROME);
      d.box(rw * 1.5, 0.12, 0.08, 0, s.sill + 0.02, rear - 0.04, CARBON); if (!lite) for (let i = -2; i <= 2; i++) d.box(0.02, 0.12, 0.18, i * rw * 0.25, s.sill + 0.02, rear + 0.05, CARBON);   // diffuser + fins
      const dy = noseY(-f + 0.15); d.box(rw * 1.55, 0.03, 0.14, 0, dy + 0.04, -f + 0.12, kind === 'hothatch' ? GBLACK : CARBON, { rx: -0.12 });                          // lip spoiler
      if (kind === 'hothatch') d.box(s.W * 0.72, 0.03, 0.32, 0, s.H - 0.02, -f + 0.42, GBLACK, { rx: 0.18 });                                                                   // roof wing
      break;
    }
    case 'gt': {
      ex(2, 0.06, GUN);
      const wy = s.H + 0.08, wz = -f + 0.3;
      d.box(s.W * 0.98, 0.04, 0.42, 0, wy, wz, CARBON, { rx: 0.1 }); for (const sd of [-1, 1]) { d.box(0.02, 0.24, 0.5, sd * s.W * 0.49, wy - 0.02, wz, CARBON); d.box(0.03, wy - noseY(wz) + 0.02, 0.1, sd * 0.32, (wy + noseY(wz)) / 2 - 0.02, wz + 0.05, CARBON, { rx: -0.3 }); }
      d.box(rw * 1.7, 0.1, 0.36, 0, s.sill + 0.0, rear + 0.1, CARBON, { rx: -0.22 }); if (!lite) for (let i = -3; i <= 3; i++) d.box(0.015, 0.2, 0.42, i * rw * 0.24, s.sill + 0.05, rear + 0.1, CARBON, { rx: -0.25 });
      for (const sd of [-1, 1]) { d.box(0.18, 0.015, 0.14, sd * fw * 0.85, s.sill + 0.3, front - 0.1, CARBON, { rz: sd * 0.2 }); d.box(0.04, 0.04, 0.14, sd * rw * 0.5, s.sill + 0.1, rear - 0.06, RED); }   // canards, tow hooks
      d.box(0.36, 0.1, 0.5, 0, s.H + 0.04, 0.0, CARBON);                                                                                                                   // roof scoop
      if (!lite) for (let i = 0; i < 6; i++) d.box(0.5, 0.012, 0.03, 0, noseY(1.25 + i * 0.07) + 0.01, 1.25 + i * 0.07, GBLACK);                                                // louvres
      for (const sd of [-1, 1]) { const g = new THREE.CircleGeometry(0.26, lite ? 12 : 24); g.rotateY((sd * Math.PI) / 2); g.translate(sd * (sideAt(s, 0, 3) + 0.006), (s.sill + s.belt) / 2 + 0.02, 0.0); d.put(g, WHITE); }   // number roundels
      break;
    }
    case 'hyper': {
      const wy = s.H + 0.06, wz = -f + 0.25;
      d.box(s.W * 0.96, 0.05, 0.4, 0, wy, wz, CARBON, { rx: 0.12 }); for (const sd of [-1, 1]) d.box(0.025, 0.45, 0.75, sd * s.W * 0.48, wy - 0.12, wz + 0.05, CARBON);
      d.box(0.02, 0.38, 1.6, 0, noseY(-1.2) + 0.15, -1.25, col);                                                                                                           // shark fin
      d.box(rw * 1.8, 0.2, 0.5, 0, s.sill + 0.02, rear + 0.15, CARBON, { rx: -0.3 }); d.box(rw * 1.6, 0.03, 0.05, 0, tailY + 0.05, rear - 0.02, TAIL, { lamp: true });
      for (const sd of [-1, 1]) { d.box(0.06, 0.22, 0.6, sd * (sideAt(s, -0.6, 3) + 0.02), s.sill + 0.28, -0.6, GBLACK); d.box(0.24, 0.02, 0.18, sd * fw * 0.8, s.sill + 0.2, front - 0.05, CARBON, { rz: sd * 0.25 }); }
      d.box(s.W * 1.02, 0.025, 0.4, 0, s.sill - 0.04, front + 0.05, CARBON);
      break;
    }
    case 'off': case 'trophy': {
      for (const sd of [-1, 1]) d.box(0.1, 0.06, s.L * 0.36, sd * (sideAt(s, 0, 1) + 0.06), s.sill - 0.02, (s.ax[0] + s.ax[1]) / 2, GUN);                                    // rock sliders / steps
      if (kind === 'cruiser' || kind === 'trophy' || kind === 'bakkie') { d.box(fw * 1.7, 0.06, 0.06, 0, s.sill + 0.42, front + 0.17, kind === 'trophy' ? GBLACK : STEEL); for (const sd of [-1, 1]) d.box(0.06, 0.48, 0.06, sd * fw * 0.55, s.sill + 0.2, front + 0.17, kind === 'trophy' ? GBLACK : STEEL); }   // bull bar
      if (kind === 'cruiser') {
        d.box(0.12, 0.85, 0.12, fw * 0.95, s.belt + 0.25, 1.05, GBLACK); d.box(0.14, 0.12, 0.2, fw * 0.95, s.H + 0.02, 1.08, GBLACK);                                         // snorkel
        d.cyl(0.36, 0.36, 0.24, 0, 1.15, -f - 0.12, TYRE, 'z', 16); d.cyl(0.2, 0.2, 0.25, 0, 1.15, -f - 0.12, STEEL, 'z', 12);                                                   // spare wheel
      }
      if (kind !== 'bakkie') {
        const ry = s.H + 0.1; for (const sd of [-1, 1]) d.box(0.05, 0.05, rz1 - rz0 - 0.2, sd * s.W * 0.4, ry, (rz0 + rz1) / 2, GBLACK); for (let i = 0; i < (lite ? 2 : 5); i++) d.box(s.W * 0.8, 0.03, 0.04, 0, ry + 0.02, rz0 + 0.15 + (i * (rz1 - rz0 - 0.3)) / 4, GBLACK);   // roof rack
        for (let i = -1; i <= 1; i++) { d.cyl(0.07, 0.07, 0.08, i * 0.32, ry + 0.12, rz1 - 0.12, GBLACK, 'z', 10); d.cyl(0.055, 0.055, 0.04, i * 0.32, ry + 0.12, rz1 - 0.07, HEAD, 'z', 10, true); }   // spotlights
      }
      if (kind === 'trophy') {
        d.cyl(0.42, 0.42, 0.3, 0, 1.55, -1.7, TYRE, 'x', 16); d.cyl(0.25, 0.25, 0.31, 0, 1.55, -1.7, GUN, 'x', 10);                                                             // spare in the bed
        for (const sd of [-1, 1]) { d.box(0.06, 0.8, 0.06, sd * 0.75, 1.6, -0.75, GBLACK, { rx: -0.25 }); d.box(0.06, 0.06, 1.4, sd * 0.75, 1.95, -1.35, GBLACK, { rx: 0.35 }); }   // cage / bed bars
        d.box(1.55, 0.06, 0.06, 0, 1.98, -0.83, GBLACK); d.box(1.4, 0.08, 0.1, 0, s.H + 0.06, 0.6, DRL, { lamp: true });                                                       // roof LED bar
        for (const sd of [-1, 1]) d.box(0.05, 0.4, 0.3, sd * (sideAt(s, -2.0, 2) + 0.05), 0.42, s.ax[0] - 0.55, GBLACK);                                                       // mud flaps
      }
      if (kind === 'suv') for (const sd of [-1, 1]) d.box(0.04, 0.045, 2.0, sd * s.W * 0.36, s.H + 0.03, -0.75, CHROME);                                                       // roof rails
      if (kind === 'bakkie') { const by = 1.14; for (const sd of [-1, 1]) d.box(0.06, 0.55, 0.06, sd * hw * 0.88, by + 0.25, -1.05, CHROME); d.box(s.W * 0.88, 0.06, 0.06, 0, by + 0.52, -1.05, CHROME); d.box(0.06, 0.06, 0.8, 0, by + 0.52, -1.45, CHROME); }   // sports bar
      ex(1, 0.05, STEEL);
      break;
    }
    case 'lux': {
      ex(2, 0.05, CHROME);
      for (const sd of [-1, 1]) d.box(0.02, 0.02, s.L * 0.55, sd * (sideAt(s, 0, 2) + 0.006), s.sill + 0.17, 0, CHROME);
      for (const sd of [-1, 1]) d.box(0.08, 0.04, 0.3, sd * (fw * 0.97), noseY(f - 0.6) - 0.02, f - 0.6, GBLACK);                                                             // fender vents
      break;
    }
    case 'retro': {
      if (kind === 'kombi') {
        const g = new THREE.CircleGeometry(0.17, lite ? 10 : 24); g.translate(0, 1.0, front + 0.04); d.put(g, CHROME); const g2 = new THREE.CircleGeometry(0.13, lite ? 10 : 24); g2.translate(0, 1.0, front + 0.045); d.put(g2, liv?.c1 ?? WHITE);
        d.box(0.05, 0.38, 0.05, 0, profY(s, 2.1), 2.1, CHROME, { rx: -0.9 });                                                                                                   // split windscreen bar
        d.box(s.W * 0.95, 0.12, 0.1, 0, s.sill + 0.12, front + 0.04, CHROME); d.box(s.W * 0.95, 0.12, 0.1, 0, s.sill + 0.12, rear - 0.04, CHROME);
        for (const sd of [-1, 1]) for (let i = 0; i < (lite ? 2 : 5); i++) d.box(0.012, 0.03, 0.22, sd * (sideAt(s, -1.5, 3) + 0.005), 0.75 + i * 0.06, -1.6, GBLACK);   // engine louvres
      } else {
        d.box(s.W * 0.9, 0.09, 0.08, 0, s.sill + 0.14, front + 0.06, CHROME); ex(1, 0.045, CHROME);
        const dy = noseY(-f + 0.15); d.box(rw * 1.6, 0.04, 0.12, 0, dy + 0.03, -f + 0.1, GBLACK, { rx: -0.1 });                                                                    // ducktail
      }
      break;
    }
    case 'police': {
      ex(2, 0.045, CHROME);
      const ly = s.H + 0.06, lz = -0.15; d.box(1.15, 0.07, 0.3, 0, ly - 0.02, lz, GBLACK);
      for (const sd of [-1, 1]) { d.box(0.5, 0.09, 0.24, sd * 0.29, ly + 0.05, lz, sd < 0 ? BLUEL : REDL, { lamp: true }); d.box(0.06, 0.04, 0.03, sd * fw * 0.3, s.sill + 0.25, front + 0.06, sd < 0 ? BLUEL : REDL, { lamp: true }); }
      d.box(fw * 1.1, 0.06, 0.06, 0, s.sill + 0.38, front + 0.2, GBLACK); for (const sd of [-1, 1]) d.box(0.06, 0.4, 0.06, sd * fw * 0.4, s.sill + 0.2, front + 0.2, GBLACK);   // push bar
      d.box(0.01, 0.6, 0.01, -rw * 0.4, s.H + 0.25, -0.9, GBLACK);
      break;
    }
    case 'taxi': {
      d.box(0.62, 0.2, 0.26, 0, s.H + 0.11, -0.1, GBLACK); d.box(0.58, 0.16, 0.27, 0, s.H + 0.12, -0.1, [1.4, 1.05, 0.2], { lamp: true });                                     // roof sign
      ex(1, 0.04, STEEL);
      break;
    }
    case 'bus': {
      if (kind === 'minibus') { d.box(0.55, 0.07, 0.8, 0, s.H + 0.03, 0.4, [0.8, 0.8, 0.78]); d.box(s.W * 0.6, 0.06, 0.04, 0, s.H + 0.02, 1.5, GBLACK); for (const sd of [-1, 1]) d.box(0.05, 0.05, 2.2, sd * s.W * 0.38, s.H + 0.04, -0.9, STEEL); }
      if (kind === 'coach') { d.box(1.4, 0.18, 2.8, 0, s.H + 0.08, -2.2, [0.85, 0.85, 0.84]); d.box(1.4, 0.6, 0.05, 0, 1.3, rear - 0.03, GBLACK); d.box(s.W * 0.9, 0.12, 0.06, 0, s.H - 0.25, front + 0.02, DRL, { lamp: true });
        for (const sd of [-1, 1]) for (let i = 0; i < (lite ? 2 : 4); i++) d.box(0.012, 0.75, 1.2, sd * (sideAt(s, 0, 2) + 0.006), 0.95, -3.6 + i * 1.6, GBLACK); }                  // luggage bay doors
      ex(1, 0.05, STEEL);
      break;
    }
    case 'work': { for (let i = 0; i < 2; i++) for (const sd of [-1, 1]) d.box(0.05, 0.6, 0.05, sd * hw * 0.85, 1.4, -0.4, STEEL); d.box(s.W * 0.86, 0.5, 0.03, 0, 1.4, -0.42, STEEL); ex(1, 0.04, STEEL); break; }   // headache rack
    case 'truck': {
      for (const sd of [-1, 1]) { d.box(0.06, 0.7, 0.04, sd * (hw + 0.18), s.belt + 0.4, mz + 0.02, GBLACK); d.box(0.05, 0.05, 0.25, sd * (hw + 0.1), s.belt + 0.75, mz + 0.05, GBLACK); }
      if (s.L > 7) { d.box(s.W * 0.9, 0.08, 0.1, 0, s.H < 3.2 ? 3.0 : 3.0, 2.6, GBLACK); for (let i = -2; i <= 2; i++) d.box(0.12, 0.06, 0.05, i * 0.3, 3.0, 2.66, AMBER, { lamp: true });   // cab marker lights
        for (const sd of [-1, 1]) { d.box(0.42, 0.55, 1.1, sd * (hw - 0.05), 0.95, 0.9, sd < 0 ? STEEL : GBLACK); d.cyl(0.07, 0.07, 1.8, sd * (hw - 0.35), 2.2, 1.85, CHROME); }   // fuel tank, battery box, exhaust stacks
        d.box(s.W * 0.9, 0.5, 0.06, 0, 2.6, 2.15, col, { rx: -0.35 }); }                                                                                                         // roof deflector
      break;
    }
    default: if (kind === 'sedan' || kind === 'hatch') ex(1, 0.04, CHROME);
  }

  // ---- cargo bodies
  const cg = s.cargo;
  if (cg) {
    const cz = (cg.z0 + cg.z1) / 2, cl = cg.z1 - cg.z0, floor = s.bed ? profY(s, s.bed[0] + 0.1) + 0.02 : s.sill + 0.5, cc = cg.col ?? col;
    for (const sd of [-1, 1]) d.box(0.12, 0.2, s.L * 0.92, sd * 0.42, s.sill + 0.25, -0.1, GBLACK);                                                                                   // chassis rails
    if (cg.t === 'box' || cg.t === 'amb') {
      const h = cg.top - floor, by = floor + h / 2;
      d.box(cg.w, h, cl, 0, by, cz, cc); d.box(cg.w + 0.03, 0.06, cl + 0.03, 0, floor + 0.03, cz, GUN); d.box(cg.w + 0.02, 0.05, cl + 0.02, 0, cg.top - 0.02, cz, GUN);
      for (const sd of [-1, 1]) { d.box(cg.w * 0.48, h * 0.94, 0.02, sd * cg.w * 0.245, by, cg.z0 - 0.005, cc); d.box(0.03, h * 0.6, 0.04, sd * 0.12, by, cg.z0 - 0.03, CHROME); }   // rear doors + handles
      d.box(0.03, h * 0.92, 0.03, 0, by, cg.z0 - 0.02, GBLACK);
      if (!lite) for (const sd of [-1, 1]) for (let i = 1; i < 6; i++) d.box(0.012, h * 0.96, 0.03, sd * (cg.w / 2 + 0.005), by, cg.z0 + (i * cl) / 6, cg.t === 'amb' ? cc : [cc[0] * 0.85, cc[1] * 0.85, cc[2] * 0.85]);
      for (const sd of [-1, 1]) { d.box(0.06, 0.06, 0.06, sd * (cg.w / 2 - 0.03), cg.top - 0.05, cg.z0 - 0.03, REDL, { lamp: true }); d.box(0.05, 0.05, 0.05, sd * (cg.w / 2 + 0.01), cg.top - 0.05, cg.z1 - 0.1, AMBER, { lamp: true }); }
      if (cg.t === 'amb') {
        for (const sd of [-1, 1]) { const zz = cz; for (let i = 0; i < (lite ? 4 : 10); i++) d.box(0.02, 0.24, cl / 10, sd * (cg.w / 2 + 0.012), floor + 0.55, cg.z0 + (i + 0.5) * cl / 10, i % 2 ? RED : YEL); d.box(0.02, 0.07, cl, sd * (cg.w / 2 + 0.012), cg.top - 0.32, zz, RED);
          const cr = new THREE.PlaneGeometry(0.5, 0.14); cr.rotateY((sd * Math.PI) / 2); const cr2 = cr.clone(); cr2.rotateX(Math.PI / 2); cr.translate(sd * (cg.w / 2 + 0.02), floor + 1.25, cz); cr2.translate(sd * (cg.w / 2 + 0.02), floor + 1.25, cz); d.put(cr, RED); d.put(cr2, RED); }   // star-of-life cross
        for (let i = 0; i < 2; i++) for (const sd of [-1, 1]) d.box(0.25, 0.12, 0.12, sd * (cg.w / 2 - 0.2), cg.top + 0.06, i ? cg.z1 - 0.1 : cg.z0 + 0.1, i ? BLUEL : REDL, { lamp: true });
        d.box(1.1, 0.1, 0.25, 0, s.H - 0.6 + 0.05, 1.45, GBLACK); for (const sd of [-1, 1]) d.box(0.5, 0.09, 0.2, sd * 0.28, s.H - 0.48, 1.45, sd < 0 ? BLUEL : REDL, { lamp: true });
      } else if (!lite) { const lg = new THREE.PlaneGeometry(cl * 0.55, h * 0.3); for (const sd of [-1, 1]) { const q = lg.clone(); q.rotateY((sd * Math.PI) / 2); q.translate(sd * (cg.w / 2 + 0.008), by + h * 0.05, cz); d.put(q, kind === 'lorry' ? [0.05, 0.3, 0.75] : [0.85, 0.15, 0.08]); const q2 = new THREE.PlaneGeometry(cl * 0.55, h * 0.06); q2.rotateY((sd * Math.PI) / 2); q2.translate(sd * (cg.w / 2 + 0.009), by - h * 0.18, cz); d.put(q2, YEL); } lg.dispose(); }   // fleet livery panels
    } else if (cg.t === 'flat' || cg.t === 'drop') {
      const dy = floor + 0.1; d.box(cg.w, 0.12, cl, 0, dy, cz, cg.t === 'flat' ? WOOD : GUN); d.box(cg.w, 0.9, 0.06, 0, dy + 0.5, cg.z1 - 0.04, cg.t === 'flat' ? STEEL : col);   // deck + headboard
      if (cg.t === 'drop') for (const sd of [-1, 1]) { d.box(0.04, 0.38, cl, sd * cg.w / 2, dy + 0.24, cz, col); d.box(cg.w, 0.38, 0.04, 0, dy + 0.24, cg.z0, col); }
      else { for (const sd of [-1, 1]) for (let i = 0; i <= (lite ? 2 : 5); i++) d.box(0.06, 0.8, 0.06, sd * (cg.w / 2 - 0.03), dy + 0.45, cg.z0 + 0.1 + (i * (cl - 0.2)) / (lite ? 2 : 5), STEEL);
        d.box(1.4, 0.7, 1.2, 0, dy + 0.42, cz - 0.6, [0.55, 0.42, 0.25]); d.box(1.0, 0.5, 1.0, 0.1, dy + 1.02, cz - 0.6, [0.6, 0.47, 0.28]); }                                    // a couple of crates
      for (const sd of [-1, 1]) d.box(0.14, 0.12, 0.05, sd * (cg.w / 2 - 0.12), dy - 0.1, cg.z0 - 0.02, TAIL, { lamp: true });
    } else if (cg.t === 'fire') {
      const h = cg.top - floor, by = floor + h / 2;
      d.box(cg.w, h, cl, 0, by, cz, col);
      for (const sd of [-1, 1]) { for (let i = 0; i < 3; i++) { const z = cg.z0 + 0.35 + i * (cl - 0.4) / 3 + (cl - 0.4) / 6; d.box(0.02, h * 0.78, (cl - 0.6) / 3.3, sd * (cg.w / 2 + 0.006), by + 0.05, z, STEEL); if (!lite) for (let k = 0; k < 6; k++) d.box(0.025, 0.012, (cl - 0.6) / 3.3, sd * (cg.w / 2 + 0.012), by - h * 0.32 + k * h * 0.13, z, GUN); }
        d.box(0.02, 0.14, cl, sd * (cg.w / 2 + 0.01), floor + 0.12, cz, WHITE); }
      for (const sd of [-1, 1]) { d.box(0.06, 0.08, cl * 0.95, sd * 0.42, cg.top + 0.28, cz, STEEL); }                                                                            // ladder
      if (!lite) for (let i = 0; i < 12; i++) d.box(0.84, 0.04, 0.04, 0, cg.top + 0.28, cg.z0 + 0.15 + (i * cl * 0.9) / 11, STEEL);
      for (const sd of [-1, 1]) { d.box(0.08, 0.3, 0.08, sd * 0.42, cg.top + 0.12, cg.z0 + 0.4, GBLACK); d.box(0.08, 0.3, 0.08, sd * 0.42, cg.top + 0.12, cg.z1 - 0.3, GBLACK); }
      d.cyl(0.4, 0.4, 0.4, 0, cg.top + 0.05, cg.z0 + 0.6, CHROME, 'x', 14);                                                                                                      // hose reel
      d.box(1.4, 0.1, 0.3, 0, s.H + 0.06, 2.75, GBLACK); for (const sd of [-1, 1]) d.box(0.6, 0.12, 0.26, sd * 0.36, s.H + 0.14, 2.75, sd < 0 ? BLUEL : REDL, { lamp: true });
      for (const sd of [-1, 1]) d.box(0.02, 0.14, s.L * 0.48, sd * (sideAt(s, 2.7, 3) + 0.01), 1.3, 2.7, WHITE);
    } else if (cg.t === 'garbage') {
      const h = cg.top - floor, by = floor + h / 2;
      d.box(cg.w, h * 0.8, cl * 0.75, 0, floor + h * 0.4, cg.z1 - cl * 0.375, cc);
      const top = new THREE.CylinderGeometry(cg.w / 2, cg.w / 2, cl * 0.75, lite ? 8 : 16, 1, false, 0, Math.PI); top.rotateX(Math.PI / 2); top.rotateZ(Math.PI / 2); top.scale(1, h * 0.4 / (cg.w / 2), 1); top.rotateZ(-Math.PI / 2); top.rotateZ(Math.PI / 2);
      const tp = new THREE.CylinderGeometry(cg.w / 2, cg.w / 2, cl * 0.75, lite ? 8 : 16, 1, false, -Math.PI / 2, Math.PI); tp.rotateX(Math.PI / 2); tp.scale(1, (h * 0.25) / (cg.w / 2), 1); tp.translate(0, floor + h * 0.8, cg.z1 - cl * 0.375); d.put(tp, cc); top.dispose();
      d.box(cg.w * 0.98, h * 0.95, cl * 0.26, 0, by + 0.05, cg.z0 + cl * 0.13, WHITE, { rx: -0.12 }); d.box(cg.w * 0.7, 0.35, 0.3, 0, floor + 0.3, cg.z0 - 0.08, GUN);                   // tailgate hopper
      for (const sd of [-1, 1]) { d.box(0.02, 0.18, cl * 0.7, sd * (cg.w / 2 + 0.006), floor + h * 0.5, cg.z1 - cl * 0.375, WHITE); d.box(0.08, 0.8, 0.08, sd * (cg.w / 2 - 0.1), floor + 0.5, cg.z0 - 0.02, GBLACK); d.box(0.08, 0.08, 0.08, sd * (cg.w / 2 - 0.1), cg.top - 0.1, cg.z0 + 0.05, AMBER, { lamp: true }); }
    }
  }
  if (!s.cargo && s.bed) { const [b0, b1] = s.bed, by = profY(s, (b0 + b1) / 2); for (const sd of [-1, 1]) d.box(0.05, 0.05, b1 - b0, sd * hw * 0.93, by + 0.02, (b0 + b1) / 2, GBLACK); d.box(s.W * 0.86, 0.04, 0.04, 0, by + 0.02, b0 + 0.02, CHROME); }
}

// ---------------------------------------------------------------- open vehicles
function tractor(s: Spec, col: number[], d: Dress, loader: boolean): void {
  const rR = s.wrR ?? 0.8, rz = s.ax[0], fz = s.ax[1], roofC = WHITE;
  d.box(0.62, 0.34, 3.0, 0, 0.82, 0.4, GUN);                                                                                                                                   // frame
  d.box(0.78, 0.72, 1.75, 0, 1.3, 1.0, col); d.box(0.7, 0.1, 1.75, 0, 1.69, 1.0, col); d.box(0.6, 0.06, 1.6, 0, 1.75, 1.0, col);                                                // bonnet
  d.box(0.62, 0.62, 0.05, 0, 1.28, 1.88, GBLACK); for (let i = 0; i < 6; i++) d.box(0.58, 0.03, 0.03, 0, 1.03 + i * 0.1, 1.91, CHROME);                                         // grille
  for (const sd of [-1, 1]) { d.cyl(0.08, 0.08, 0.06, sd * 0.26, 1.58, 1.9, HEAD, 'z', 12, true); d.box(0.02, 0.4, 1.3, sd * 0.4, 1.3, 1.0, GBLACK); for (let i = 0; i < 4; i++) d.box(0.02, 0.03, 0.5, sd * 0.401, 1.12 + i * 0.1, 1.3, CHROME); }
  d.box(1.0, 0.32, 0.3, 0, 0.92, 2.05, GUN); for (let i = 0; i < 4; i++) d.box(0.95, 0.07, 0.05, 0, 0.82 + i * 0.08, 2.22, GBLACK);                                              // front weights
  d.cyl(0.055, 0.055, 1.3, 0.28, 2.3, 1.45, GBLACK); d.cyl(0.07, 0.055, 0.15, 0.28, 2.98, 1.45, GBLACK);                                                                        // exhaust stack
  // cab
  const cy0 = 1.45, cy1 = 2.85, cz0 = -1.35, cz1 = 0.18;
  d.box(1.3, 0.08, cz1 - cz0, 0, cy0, (cz0 + cz1) / 2, GUN);
  for (const x of [-0.65, 0.65]) for (const z of [cz0, cz1]) d.box(0.07, cy1 - cy0, 0.07, x, (cy0 + cy1) / 2, z, GBLACK);
  d.box(1.5, 0.1, 1.75, 0, cy1 + 0.05, (cz0 + cz1) / 2, roofC); d.box(1.42, 0.06, 1.66, 0, cy1 + 0.12, (cz0 + cz1) / 2, roofC);
  d.box(1.24, cy1 - cy0 - 0.1, 0.02, 0, (cy0 + cy1) / 2 + 0.05, cz1, GLASS); d.box(1.24, cy1 - cy0 - 0.4, 0.02, 0, (cy0 + cy1) / 2 + 0.2, cz0, GLASS);
  for (const sd of [-1, 1]) { d.box(0.02, cy1 - cy0 - 0.3, cz1 - cz0 - 0.1, sd * 0.65, (cy0 + cy1) / 2 + 0.12, (cz0 + cz1) / 2, GLASS); d.box(0.12, 0.08, 0.06, sd * 0.6, cy1 - 0.05, cz1 + 0.04, HEAD, { lamp: true }); d.box(0.1, 0.1, 0.05, sd * 0.6, cy1 - 0.05, cz0 - 0.04, TAIL, { lamp: true }); }
  d.box(0.12, 0.08, 0.12, 0, cy1 + 0.22, (cz0 + cz1) / 2, AMBER, { lamp: true });                                                                                             // beacon
  d.box(0.5, 0.12, 0.45, 0, cy0 + 0.35, -0.85, GBLACK); d.box(0.5, 0.5, 0.1, 0, cy0 + 0.6, -1.05, GBLACK);                                                                     // seat
  const sw = new THREE.TorusGeometry(0.17, 0.02, 6, d.lite ? 10 : 18); sw.rotateX(Math.PI / 2 - 0.6); sw.translate(0, cy0 + 0.75, -0.15); d.put(sw, GBLACK); d.cyl(0.025, 0.025, 0.6, 0, cy0 + 0.45, -0.05, GBLACK, 'y', 6, false, 0.6);
  // fenders over the big rear wheels, small ones over the fronts
  for (const sd of [-1, 1]) { const x = sd * wheelX(s, rR); d.arc(x, rR, rz, rR + 0.1, 0.15, Math.PI - 0.15, (s.tw ?? 0.34) + 0.18, 0.05, col, d.lite ? 6 : 12); d.box(0.5, 0.06, 0.9, sd * 0.85, cy0 + 0.02, rz, col);
    const xf = sd * wheelX(s, s.wr); d.arc(xf, s.wr, fz, s.wr + 0.08, 0.35, Math.PI - 0.35, (s.tw ?? 0.34) + 0.08, 0.04, col, d.lite ? 4 : 8); }
  d.box(0.9, 0.2, 0.4, 0, 0.75, -1.7, GUN); for (const sd of [-1, 1]) d.box(0.08, 0.08, 0.6, sd * 0.35, 0.6, -1.95, GBLACK);                                                    // 3-point hitch
  if (loader) {
    for (const sd of [-1, 1]) { d.box(0.12, 0.16, 2.6, sd * 0.68, 1.35, 1.25, col, { rx: 0.42 }); d.cyl(0.05, 0.05, 1.6, sd * 0.52, 1.25, 1.1, CHROME, 'z', 8, false, -0.3); }   // lift arms + rams
    d.box(2.1, 0.08, 0.8, 0, 0.32, 2.75, GUN); d.box(2.1, 0.8, 0.08, 0, 0.68, 2.38, GUN, { rx: -0.2 }); for (const sd of [-1, 1]) d.box(0.06, 0.6, 0.8, sd * 1.05, 0.55, 2.62, GUN);   // bucket
    if (!d.lite) for (let i = -4; i <= 4; i++) d.box(0.06, 0.04, 0.16, i * 0.23, 0.29, 3.2, STEEL);                                                                           // teeth
  }
}
function kart(s: Spec, col: number[], d: Dress): void {
  const suit = [col[0] * 0.35 + 0.05, col[1] * 0.35 + 0.05, col[2] * 0.35 + 0.08];
  for (const sd of [-1, 1]) d.box(0.035, 0.035, 1.45, sd * 0.3, 0.1, 0.02, CHROME); for (const z of [-0.55, 0.0, 0.55]) d.box(0.65, 0.03, 0.03, 0, 0.1, z, CHROME);            // tube frame
  d.box(0.56, 0.015, 1.0, 0, 0.085, 0.05, CARBON);
  d.box(1.02, 0.14, 0.28, 0, 0.15, 0.86, col); d.box(0.9, 0.1, 0.22, 0, 0.25, 0.8, col, { rx: 0.4 });                                                                          // nose cone
  for (const sd of [-1, 1]) { d.box(0.18, 0.18, 0.68, sd * 0.5, 0.17, -0.02, col); d.box(0.2, 0.03, 0.6, sd * 0.5, 0.27, -0.02, WHITE); }                                     // side pods + stripe
  d.box(0.34, 0.3, 0.1, 0, 0.32, 0.5, col, { rx: -0.5 }); d.box(0.22, 0.14, 0.02, 0, 0.36, 0.55, WHITE, { rx: -0.5 });                                                          // front fairing + number board
  const g = new THREE.CircleGeometry(0.05, 12); g.rotateX(-0.5); g.translate(0, 0.36, 0.565); d.put(g, GBLACK);
  d.box(0.42, 0.06, 0.4, 0, 0.18, -0.28, GBLACK); d.box(0.42, 0.42, 0.06, 0, 0.38, -0.5, GBLACK, { rx: 0.3 });                                                                  // seat
  d.box(0.24, 0.26, 0.26, 0.3, 0.28, -0.6, GUN); d.cyl(0.05, 0.05, 0.3, 0.42, 0.3, -0.72, CHROME, 'z', 10); d.box(0.1, 0.12, 0.1, 0.3, 0.45, -0.6, GBLACK);                      // engine, pipe, airbox
  d.box(1.15, 0.05, 0.05, 0, 0.14, -0.86, CHROME); for (const sd of [-1, 1]) d.box(0.05, 0.05, 0.25, sd * 0.4, 0.14, -0.74, CHROME);                                          // rear bumper
  d.cyl(0.015, 0.015, 0.4, 0, 0.38, 0.35, GBLACK, 'y', 6, false, 0.9); const sw = new THREE.TorusGeometry(0.12, 0.016, 6, d.lite ? 10 : 18); sw.rotateX(Math.PI / 2 - 0.9); sw.translate(0, 0.5, 0.25); d.put(sw, GBLACK);
  // driver: suit, arms on the wheel, helmet with a visor
  d.box(0.36, 0.4, 0.24, 0, 0.55, -0.32, suit, { rx: 0.3 }); for (const sd of [-1, 1]) { d.box(0.08, 0.08, 0.42, sd * 0.15, 0.55, -0.02, suit, { rx: 0.35 }); d.box(0.09, 0.09, 0.4, sd * 0.13, 0.22, 0.25, suit); d.sph(0.045, sd * 0.1, 0.5, 0.2, GBLACK); }
  d.sph(0.16, 0, 0.92, -0.25, col, 1, 1.05, 1.1); d.box(0.24, 0.08, 0.06, 0, 0.94, -0.12, GLASS, { rx: -0.2 }); d.box(0.04, 0.17, 0.3, 0, 1.03, -0.27, WHITE);
  d.box(0.06, 0.03, 0.03, 0, 0.12, -0.9, TAIL, { lamp: true });
}

// ---------------------------------------------------------------- paint options (player paint shop)
export type LiveryChoice = 'factory' | 'none' | 'racing' | 'twin' | 'side' | 'stripe';
export interface PaintOpts { accent?: number[]; livery?: LiveryChoice; rim?: number[] }
const optKey = (o?: PaintOpts): string => (o ? `${o.accent?.join(',') ?? ''}/${o.livery ?? ''}/${o.rim?.join(',') ?? ''}` : '');
/** Factory accent (stripe / roof / livery colour) and wheel colour for a kind, as linear RGB. */
export function factoryAccent(kind: CarKind): number[] { const s = SPECS[kind]; return s.liv?.c1 ?? s.roof ?? WHITE; }
export function factoryRim(kind: CarKind): number[] { return rimColour(SPECS[kind].rim); }
const rimColour = (style: Rim): number[] => style === 'race' ? [0.95, 0.72, 0.12] : style === 'turbine' ? GUN : style === 'mesh' ? [0.78, 0.8, 0.82] : style === 'steel' ? [0.25, 0.26, 0.28] : style === 'tractor' ? [0.95, 0.72, 0.05] : style === 'truck' ? [0.82, 0.83, 0.85] : style === 'kart' ? WHITE : [0.72, 0.74, 0.77];

// ---------------------------------------------------------------- assembly
const cache = new Map<string, THREE.BufferGeometry>();
const custom = new Map<string, THREE.BufferGeometry>();
function lru(m: Map<string, THREE.BufferGeometry>, key: string, make: () => THREE.BufferGeometry, max = 16): THREE.BufferGeometry {
  let g = m.get(key); if (g) { m.delete(key); m.set(key, g); return g; }
  g = make(); m.set(key, g);
  while (m.size > max) { const [k, old] = m.entries().next().value as [string, THREE.BufferGeometry]; m.delete(k); old.dispose(); }   // a disposed geometry still on screen is simply re-uploaded
  return g;
}
function build(kind: CarKind, col: number[], stripe: number[] | undefined, lite: boolean, o?: PaintOpts): THREE.BufferGeometry {
  const base = SPECS[kind], acc = o?.accent ?? stripe;
  const s: Spec = base.roof && o?.accent ? { ...base, roof: o.accent } : base, d = new Dress(lite);
  let liv: Liv | undefined = s.liv ? { ...s.liv, c1: acc ?? s.liv.c1 } : stripe ? { t: 'stripe', c1: stripe } : undefined;
  if (o?.livery === 'none') liv = undefined;
  else if (o?.livery && o.livery !== 'factory') liv = { t: o.livery, c1: acc ?? factoryAccent(kind) };
  if (s.special === 'kart') kart(s, col, d); else if (s.special) tractor(s, col, d, s.special === 'loader');
  else { loft(s, col, d, liv); dress(s, col, d, kind, liv); }
  const groups = d.b.map((list) => (list.length ? mergeGeometries(list) : null));
  for (const list of d.b) for (const g of list) g.dispose();
  const parts = groups.filter((g): g is THREE.BufferGeometry => !!g);
  if (lite) { const out = mergeGeometries(parts)!; for (const p of parts) p.dispose(); out.computeBoundingSphere(); return out; }
  const out = mergeGeometries(parts, true)!; let gi = 0; groups.forEach((g, i) => { if (g) out.groups[gi++].materialIndex = i; });
  for (const p of parts) p.dispose(); out.computeBoundingSphere(); return out;
}
/** Body shell (no wheels) in the given paint; `stripe` overrides the livery colour (taxis, coaches, race field). Cached per kind + colour. */
export function carBody(kind: CarKind, col: number[], stripe?: number[], o?: PaintOpts): THREE.BufferGeometry {
  const key = `${kind}|${col.join(',')}|${stripe ? stripe.join(',') : ''}|${optKey(o)}`;
  if (o) return lru(custom, key, () => build(kind, col, stripe, false, o));   // paint-shop jobs: small evicting cache (a colour picker drag makes dozens)
  let g = cache.get(key); if (!g) { g = build(kind, col, stripe, false, o); cache.set(key, g); } return g;
}

// ---------------------------------------------------------------- wheels
const wheelCache = new Map<string, THREE.BufferGeometry>();
/** One wheel (lathed tyre with rounded sidewalls + styled rim, brake disc) with the axle along x, centred on the origin. */
export function wheelGeo(r: number, style: Rim = 'five', w = r * 0.62, lite = false, rimCol?: number[]): THREE.BufferGeometry {
  const key = `${r}|${style}|${w}|${lite}|${rimCol?.join(',') ?? ''}`;
  if (rimCol) return lru(customWheels, key, () => buildWheel(r, style, w, lite, rimCol), 24);
  let g = wheelCache.get(key); if (g) return g;
  g = buildWheel(r, style, w, lite); wheelCache.set(key, g); return g;
}
const customWheels = new Map<string, THREE.BufferGeometry>();
function buildWheel(r: number, style: Rim, w: number, lite: boolean, rimCol?: number[]): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  const seg = lite ? 10 : 22, rimR = style === 'tractor' ? r * 0.55 : style === 'kart' ? r * 0.6 : style === 'truck' ? r * 0.58 : style === 'steel' ? r * 0.62 : r * 0.7;
  const d = new Dress(lite);
  // tyre: lathe profile (bead -> sidewall bulge -> tread shoulder) mirrored across the centre line
  const hw = w / 2, prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [[rimR * 0.98, -hw * 0.9], [rimR + (r - rimR) * 0.35, -hw], [r - (r - rimR) * 0.12, -hw * 0.98], [r, -hw * 0.82], [r, hw * 0.82], [r - (r - rimR) * 0.12, hw * 0.98], [rimR + (r - rimR) * 0.35, hw], [rimR * 0.98, hw * 0.9]];
  for (const [x, y] of lite ? [pts[0], pts[3], pts[4], pts[7]] : pts) prof.push(new THREE.Vector2(x, y));
  const tyre = new THREE.LatheGeometry(prof, seg); tyre.rotateZ(Math.PI / 2); d.put(tyre, TYRE);
  if (style === 'tractor' && !lite) for (let k = 0; k < 18; k++) for (const sd of [-1, 1]) { const a = (k / 18) * Math.PI * 2 + (sd > 0 ? 0.17 : 0); const lug = new THREE.BoxGeometry(hw * 0.95, 0.07, 0.11); lug.rotateX(-sd * 0.5); lug.translate(sd * hw * 0.47, r + 0.02, 0); lug.rotateX(a); d.put(lug, TYRE); }
  const rimC = (rimCol ?? rimColour(style)).slice(); if (style !== 'steel' && style !== 'tractor') ALLOY.add(rimC);
  for (const sd of lite ? [1] : [-1, 1]) {   // far LOD: outer face only (carStatic turns left-side wheels around)
    const face = sd * (hw - 0.025);
    const barrel = new THREE.CircleGeometry(rimR * 0.98, seg); barrel.rotateY((sd * Math.PI) / 2); barrel.translate(face - sd * 0.05, 0, 0); d.put(barrel, GUN);
    if (sd > 0 && !lite && style !== 'tractor' && style !== 'truck') { const disc = new THREE.CircleGeometry(rimR * 0.78, seg); disc.rotateY(Math.PI / 2); disc.translate(face - 0.035, 0, 0); d.put(disc, [0.32, 0.33, 0.34]); }
    const lip = new THREE.RingGeometry(rimR * 0.9, rimR, seg); lip.rotateY((sd * Math.PI) / 2); lip.translate(face, 0, 0); d.put(lip, style === 'steel' ? rimC : CHROME);
    const spokes = (n: number, wdt: number, len: number, c: number[], twist = 0, depth = 0.03): void => {
      for (let k = 0; k < n; k++) { const sp = new THREE.BoxGeometry(depth, len, wdt); sp.translate(face - sd * depth * 0.3, rimR * 0.18 + len / 2, 0); if (twist) sp.rotateX(twist); sp.rotateX((k * Math.PI * 2) / n); d.put(sp, c); }
    };
    if (style === 'steel' || style === 'tractor' || style === 'truck') {
      const disc = new THREE.CircleGeometry(rimR * 0.9, seg); disc.rotateY((sd * Math.PI) / 2); disc.translate(face - sd * 0.01, 0, 0); d.put(disc, rimC);
      if (!lite) for (let k = 0; k < (style === 'truck' ? 10 : 6); k++) { const a = (k / (style === 'truck' ? 10 : 6)) * Math.PI * 2, hole = new THREE.CircleGeometry(rimR * 0.1, 8); hole.rotateY((sd * Math.PI) / 2); hole.translate(face + sd * 0.002, Math.sin(a) * rimR * 0.58, Math.cos(a) * rimR * 0.58); d.put(hole, GBLACK); }
      const cap = new THREE.CircleGeometry(rimR * (style === 'truck' ? 0.32 : 0.36), 16); cap.rotateY((sd * Math.PI) / 2); cap.translate(face + sd * 0.006, 0, 0); d.put(cap, style === 'tractor' ? rimC : CHROME);
    } else if (style === 'five') spokes(5, rimR * 0.26, rimR * 0.8, rimC);
    else if (style === 'multi') { spokes(10, rimR * 0.1, rimR * 0.8, rimC); }
    else if (style === 'mesh') { spokes(lite ? 8 : 14, rimR * 0.06, rimR * 0.8, rimC, 0.35); if (!lite) spokes(14, rimR * 0.06, rimR * 0.8, rimC, -0.35); }
    else if (style === 'race') { spokes(6, rimR * 0.16, rimR * 0.82, rimC); const nut = new THREE.CylinderGeometry(rimR * 0.16, rimR * 0.2, 0.06, 6); nut.rotateZ(Math.PI / 2); nut.translate(face + sd * 0.01, 0, 0); d.put(nut, RED); }
    else if (style === 'turbine') { spokes(lite ? 6 : 12, rimR * 0.13, rimR * 0.82, rimC, 0.5, 0.04); }
    else if (style === 'kart') spokes(5, rimR * 0.3, rimR * 0.8, rimC);
    if (style !== 'steel' && style !== 'tractor' && style !== 'truck') { const hub = new THREE.CircleGeometry(rimR * 0.2, 12); hub.rotateY((sd * Math.PI) / 2); hub.translate(face + sd * 0.004, 0, 0); d.put(hub, style === 'race' ? RED : GUN); }
  }
  g = mergeGeometries(d.b[0])!; for (const p of d.b[0]) p.dispose(); g.computeBoundingSphere(); return g;
}
/** Wheel centres (FL, FR, RL, RR) for a kind: [x, y, z]; extra axles (coaches, lorries) follow. */
export function wheelSpots(kind: CarKind): [number, number, number][] {
  const s = SPECS[kind], rR = s.wrR ?? s.wr, xf = wheelX(s, s.wr), xr = wheelX(s, rR);
  const o: [number, number, number][] = [[xf, s.wr, s.ax[1]], [-xf, s.wr, s.ax[1]], [xr, rR, s.ax[0]], [-xr, rR, s.ax[0]]];
  for (const a of s.extraAx ?? []) o.push([xr, rR, a], [-xr, rR, a]);
  return o;
}
export const carSize = (kind: CarKind): { L: number; W: number; H: number; wr: number } => SPECS[kind];
const wheelOf = (kind: CarKind, i: number, lite: boolean, rim?: number[]): THREE.BufferGeometry => {
  const s = SPECS[kind], rear = i >= 2, r = rear ? (s.wrR ?? s.wr) : s.wr, w = tyreW(s, r) * (rear && s.dual ? 1.7 : 1);
  return wheelGeo(r, s.rim, w, lite, rim);
};

/**
 * Real materials on vertex-coloured vehicles, all in the body's one draw call: the 'surf' attribute picks the surface model per
 * fragment. High-frequency detail (paint flake, carbon weave, tread, brushing) is computed in object space, so it stays sharp at any
 * zoom, costs no texture memory, and fades with the pixel footprint (no shimmer, nothing spent at distance).
 */
function vehicleSurfaces<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float surf; varying float vSurf; varying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf; vObj = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vSurf; varying vec3 vObj; float sId = 0.0; float sHi = 1.0;
      float vh1(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      vec3 vh3(vec3 p){ return vec3(vh1(p), vh1(p + 19.19), vh1(p + 47.47)); }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      sId = floor(vSurf + 0.5);
      vec3 oN = normalize(cross(dFdx(vObj), dFdy(vObj)));
      float ofw = length(fwidth(vObj)); sHi = clamp(1.0 - ofw * 140.0, 0.0, 1.0);
      vec2 tp = abs(oN.y) > 0.6 ? vObj.xz : (abs(oN.x) > 0.6 ? vObj.zy : vObj.xy);     // the face's own plane (triplanar pick)
      if (sId == 1.0) { roughnessFactor = 0.02; metalnessFactor = 0.0; diffuseColor.rgb *= 0.8; }                                   // glass
      else if (sId == 2.0) { roughnessFactor = 0.05; metalnessFactor = 1.0; diffuseColor.rgb = vec3(0.92, 0.93, 0.95); }            // chrome
      else if (sId == 3.0) { roughnessFactor = 0.2; metalnessFactor = 0.0; }                                                       // gloss black trim
      else if (sId == 4.0) { roughnessFactor = 0.82 + 0.1 * vh1(floor(vObj * 400.0)) * sHi; metalnessFactor = 0.0; }               // matte rubber / textured plastic
      else if (sId == 5.0) {                                                                                                        // carbon fibre: 2x2 twill under lacquer
        vec2 cp = tp * 140.0; float tow = mod(floor(cp.x) + floor(cp.y * 0.5 + floor(cp.x) * 0.5), 2.0);
        float sheen = 0.5 + 0.5 * sin(fract(tow > 0.5 ? cp.x : cp.y) * 3.14159);
        diffuseColor.rgb = mix(vec3(0.045), mix(vec3(0.025, 0.026, 0.03), vec3(0.11, 0.115, 0.125), sheen), sHi); roughnessFactor = mix(0.35, 0.18 + 0.15 * (1.0 - sheen), sHi); metalnessFactor = 0.2; }
      else if (sId == 6.0) {                                                                                                        // tyre rubber: tread blocks, sidewall grain
        float r = length(vObj.yz), ang = atan(vObj.y, vObj.z), tread = 1.0 - step(0.5, abs(oN.x));
        float blk = step(0.78, fract(ang * 30.0 / 6.2832 + step(0.0, vObj.x) * 0.5)) + step(0.9, fract(abs(vObj.x) * 22.0));
        diffuseColor.rgb *= mix(1.0, 1.0 - 0.55 * min(blk, 1.0), tread * sHi) * (0.92 + 0.12 * vh1(floor(vObj * 300.0)) * sHi);
        diffuseColor.rgb += (1.0 - tread) * sHi * step(0.93, fract(r * 40.0)) * 0.015;                                            // moulded sidewall rings
        roughnessFactor = 0.9; metalnessFactor = 0.0; }
      else if (sId == 7.0) { float br = vh1(vec3(floor(tp.y * 900.0), 1.0, 2.0)); roughnessFactor = mix(0.42, 0.28 + 0.2 * br, sHi); metalnessFactor = 0.85; diffuseColor.rgb *= 0.9 + 0.12 * br * sHi; }   // brushed / cast metal
      else if (sId == 8.0) { roughnessFactor = 0.35; metalnessFactor = 0.0; }                                                       // plate / vinyl
      else if (sId == 9.0) { float rad = length(vObj.yz); roughnessFactor = 0.16 + 0.06 * step(0.5, fract(rad * 160.0)) * sHi; metalnessFactor = 1.0; }   // polished alloy, machined rings
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (sId == 0.0 && metalnessFactor > 0.25) { vec3 fl = vh3(floor(vObj * 1100.0)) - 0.5; normal = normalize(normal + fl * 0.16 * sHi); }   // metallic flakes under the clear coat
      if (sId == 7.0 || sId == 4.0) { normal = normalize(normal + (vh3(floor(vObj * 500.0)) - 0.5) * 0.05 * sHi); }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
      material.clearcoat *= (sId == 0.0 || sId == 5.0) ? 1.0 : 0.0;
      #endif`);
  };
  const key = m.type + '|veh-surf1'; m.customProgramCacheKey = () => key;
  return m;
}

/** Glossy two-layer look without a physical material: metallic base, sky reflections from the scene environment. */
export const carPaintMat = vehicleSurfaces(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.5, envMapIntensity: 1.35 }));
/** Player's own car: same vertex-coloured shell under a clear coat. */
export const playerPaintMat = vehicleSurfaces(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 }));
export type PaintFinish = 'metallic' | 'gloss' | 'matte' | 'pearlescent';
const finishMats = new Map<PaintFinish, THREE.MeshPhysicalMaterial>();
/** Player paint in a chosen finish: metallic flake, solid gloss, satin matte, or a pearl that shifts colour with the angle. */
export function playerPaint(f: PaintFinish): THREE.MeshPhysicalMaterial {
  let m = finishMats.get(f); if (m) return m;
  m = f === 'metallic' ? playerPaintMat
    : f === 'gloss' ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 })
    : f === 'matte' ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05, clearcoat: 0, envMapIntensity: 0.6 })
    : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.26, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 520], envMapIntensity: 1.35 });
  if (f !== 'metallic') vehicleSurfaces(m); finishMats.set(f, m); return m;
}
/** Lamps: unlit, so LED signatures read at any time of day (values above 1 bloom). */
export const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const wheelMat = vehicleSurfaces(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5, envMapIntensity: 1.1 }));

/** Whole static vehicle (body + wheels) as one single-material geometry: parked cars. Reduced detail. */
export function carStatic(kind: CarKind, col: number[], stripe?: number[]): THREE.BufferGeometry {
  const key = `S|${kind}|${col.join(',')}|${stripe ? stripe.join(',') : ''}`; const hit = cache.get(key); if (hit) return hit;
  const parts = [build(kind, col, stripe, true)];
  wheelSpots(kind).forEach(([x, y, z], i) => { const w = wheelOf(kind, Math.min(i, 3), true).clone(); if (x < 0) w.rotateY(Math.PI); parts.push(w.translate(x, y, z)); });
  const g = mergeGeometries(parts)!; for (const p of parts) p.dispose(); g.computeBoundingSphere(); cache.set(key, g); return g;
}

/** Drivable / traffic vehicle: body mesh (paint + lamps) + spinning wheels. userData: car (detail group), wheels (rotate .x to spin). */
export function makeCar(kind: CarKind, col: number[], stripe?: number[], mat: THREE.Material = carPaintMat, o?: PaintOpts): THREE.Group {
  const g = new THREE.Group(), detail = new THREE.Group(); const s = SPECS[kind];
  const body = new THREE.Mesh(carBody(kind, col, stripe, o), [mat, lampMat]); body.castShadow = true; detail.add(body);
  const wheels: THREE.Object3D[] = [];
  wheelSpots(kind).forEach(([x, y, z], i) => { const w = new THREE.Mesh(wheelOf(kind, Math.min(i, 3), false, o?.rim), wheelMat); w.position.set(x, y, z); w.castShadow = false; detail.add(w); wheels.push(w); });
  g.add(detail); g.userData['car'] = detail; g.userData['wheels'] = wheels; g.userData['paint'] = col; g.userData['size'] = s;
  return g;
}
