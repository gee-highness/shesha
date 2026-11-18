import type { VehicleArchetypeConfig, VehicleArchetypeId } from '../models/vehicle.types';
import { ARCHETYPES } from '../services/tuning.service';
import { CarKind, carSize, wheelSpots } from './graphics/car-gen';

export type CarClass = 'Local' | 'Sports' | 'Race' | 'Everyday' | 'SUV' | 'Van & Truck' | 'Service' | 'Farm' | 'Kart';

export interface CarDef {
  id: string; name: string; cls: CarClass; file: string; archetype: VehicleArchetypeId;
  /** Model faces -Z (three.js Ferrari) instead of +Z (Kenney). */
  flip?: boolean; paintable?: boolean; blurb: string;
  /** Wheel nodes in order FL, FR, RL, RR. */
  wheels: [string, string, string, string];
  /** Generated body (car-gen.ts) instead of a glTF file: drawn at true size, wheelbase / track come from the body. */
  gen?: CarKind;
  /** Waist stripe colour for generated bodies (minibus taxi, coach). */
  stripe?: number;
  /** Fixed paint for generated bodies that are not paintable. */
  paint?: number;
  /** This car's own figures on top of its archetype (mass, power, drive, grip, size, gearing). */
  spec: Partial<VehicleArchetypeConfig>;
}
const K: [string, string, string, string] = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];
type Drive = 'AWD' | 'RWD' | 'FWD';
/** mass kg, power kW, drive, tyre grip, wheelbase m (sets the model's size), track m, + any other figure. */
const sp = (massKg: number, engineMaxPowerKw: number, driveType: Drive, tireGripPeak: number, wheelBaseM: number, trackWidthM: number, more: Partial<VehicleArchetypeConfig> = {}): Partial<VehicleArchetypeConfig> =>
  ({ massKg, engineMaxPowerKw, driveType, tireGripPeak, wheelBaseM, trackWidthM, ...more });
/** Rev range + gearing shorthand: peak rpm, limiter, final drive, drag. */
const rev = (enginePeakRpm: number, engineMaxRpm: number, finalDrive: number, dragCoefficient: number, more: Partial<VehicleArchetypeConfig> = {}): Partial<VehicleArchetypeConfig> =>
  ({ enginePeakRpm, engineMaxRpm, finalDrive, dragCoefficient, ...more });
const ROAD = rev(5800, 6600, 4.1, 0.34), DIESEL = rev(3600, 4400, 3.9, 0.42), LORRY = rev(2400, 3000, 3.7, 0.62, { engineIdleRpm: 650 }), KART = rev(9500, 11500, 12, 0.5, { engineIdleRpm: 1800, suspensionRestLengthM: 0.3 });
const c = (id: string, name: string, cls: CarClass, archetype: VehicleArchetypeId, blurb: string, spec: Partial<VehicleArchetypeConfig>, extra: Partial<CarDef> = {}): CarDef =>
  ({ id, name, cls, file: `assets/models/cars/${id}.glb`, archetype, blurb, wheels: K, spec, ...extra });
/** A generated Southern-African body: true-size, wheelbase / track read from the shape. */
const g = (id: string, name: string, gen: CarKind, archetype: VehicleArchetypeId, blurb: string, massKg: number, engineMaxPowerKw: number, driveType: Drive, tireGripPeak: number, more: Partial<VehicleArchetypeConfig> = {}, extra: Partial<CarDef> = {}): CarDef =>
  ({ id, name, cls: 'Local', file: '', archetype, blurb, wheels: K, gen, paintable: true, spec: { massKg, engineMaxPowerKw, driveType, tireGripPeak, ...more }, ...extra });

/** Full physics config for a catalogue car: archetype + the car's own figures; springs and dampers follow the mass. */
export function carConfig(def: CarDef): VehicleArchetypeConfig {
  const a = ARCHETYPES[def.archetype], s = def.spec, m = (s.massKg ?? a.massKg) / a.massKg;
  const cfg: VehicleArchetypeConfig = { ...a, name: def.name, tagline: def.blurb, suspensionStiffness: a.suspensionStiffness * m, suspensionDamping: a.suspensionDamping * m, ...s };
  if (def.gen) {
    const w = wheelSpots(def.gen), z = carSize(def.gen);
    cfg.wheelBaseM = w[0][2] - w[2][2]; cfg.trackWidthM = w[0][0] * 2;
    cfg.dragCoefficient = s.dragCoefficient ?? Math.max(0.3, (0.36 * z.W * z.H) / 2.2);   // physics uses a fixed 2.2 m2 frontal area
  }
  return cfg;
}

export const CAR_CATALOG: CarDef[] = [
  c('ferrari', 'Ferrari 458 Italia', 'Sports', 'RWD_DRIFT', 'Mid-engine V8 icon. Paintable.', sp(1485, 419, 'RWD', 1.24, 2.65, 1.67, rev(7900, 9000, 4.1, 0.33, { downforceCoefficient: 1.6 })), { file: 'assets/models/cars/ferrari-lod.glb', flip: true, paintable: true, wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] }),
  // ---- generated local bodies (paintable, true size)
  g('gusheshe', 'Gusheshe 325', 'coupe', 'RWD_DRIFT', 'Boxy rear-drive legend of every spin event. Paintable.', 1180, 155, 'RWD', 1.02, rev(6200, 7000, 4.1, 0.36)),
  g('sa-hatch', 'Vivo GT Hatch', 'hatch', 'AWD_GRIP', 'The hatch on every street, warmed up. Paintable.', 1080, 110, 'FWD', 1.08, ROAD),
  g('sa-sedan', 'Corolla-type Sedan', 'sedan', 'AWD_GRIP', 'Runs forever. Paintable.', 1290, 103, 'FWD', 1.0, ROAD),
  g('sa-bakkie-1', 'Single-Cab Bakkie', 'bakkie1', 'HEAVY_CRUISER', 'Half-ton workhorse, light tail. Paintable.', 1650, 110, 'RWD', 0.94, DIESEL),
  g('sa-bakkie', 'Double-Cab Bakkie', 'bakkie', 'HEAVY_CRUISER', 'Turbo-diesel 4x4 double cab. Paintable.', 2100, 150, 'AWD', 0.98, DIESEL),
  g('sa-suv', 'Fortuner-type SUV', 'suv', 'HEAVY_CRUISER', 'Seven seats, school run to Sibebe. Paintable.', 2130, 150, 'AWD', 0.98, DIESEL),
  g('sa-cruiser', 'Bush Cruiser 4x4', 'cruiser', 'HEAVY_CRUISER', 'Straight-six, solid axles, goes anywhere. Paintable.', 2350, 151, 'AWD', 0.96, rev(3400, 4200, 4.1, 0.5, { suspensionRestLengthM: 0.46 })),
  g('sa-quantum', 'Quantum Minibus Taxi', 'minibus', 'HEAVY_CRUISER', 'Fifteen seats, one stripe, no brakes spared.', 2250, 111, 'RWD', 0.93, DIESEL, { paintable: false, paint: 0xf0f0ec, stripe: 0xd9a514 }),
  g('sa-coach', 'Intercity Coach', 'coach', 'HEAVY_CRUISER', 'Twelve metres to Johannesburg. Mind the corners.', 13500, 300, 'RWD', 0.88, LORRY, { paintable: false, paint: 0xf2f2ee, stripe: 0x1d4ed8 }),
  // ---- coachworks bodies (generated, true size): performance, everyday, work and service vehicles
  g('sedan-sports', 'Sports Sedan', 'sport', 'AWD_GRIP', 'Four-door pace with all-wheel grip, quad pipes and a black roof. Paintable.', 1650, 280, 'AWD', 1.16, rev(6400, 7200, 3.6, 0.33), { cls: 'Sports' }),
  g('hatchback-sports', 'Hot Hatch', 'hothatch', 'AWD_GRIP', 'Light, nimble and loud. Twin stripes, roof wing. Paintable.', 1350, 180, 'FWD', 1.12, rev(6200, 7000, 3.9, 0.34), { cls: 'Sports' }),
  g('race', 'GT Racer', 'gt', 'AWD_GRIP', 'Track-bred GT: swan-neck wing, centre-lock wheels, louvred bonnet. Paintable.', 1250, 400, 'RWD', 1.45, rev(7400, 8600, 3.73, 0.36, { downforceCoefficient: 2.4 }), { cls: 'Race' }),
  g('race-future', 'Future Racer', 'hyper', 'AWD_GRIP', 'Le Mans-style prototype: shark fin, turbine wheels, light-bar face. Paintable.', 1050, 520, 'AWD', 1.55, rev(8200, 9400, 3.5, 0.38, { downforceCoefficient: 3.0 }), { cls: 'Race' }),
  g('sedan', 'City Sedan', 'sedan', 'AWD_GRIP', 'The everyday Manzini commuter. Paintable.', 1300, 103, 'FWD', 1.0, ROAD, { cls: 'Everyday' }),
  g('taxi', 'Metered Taxi', 'taxi', 'AWD_GRIP', 'Chequered band, roof sign. Cruise Nkosi Hlusaza St like a local.', 1350, 110, 'FWD', 1.0, ROAD, { cls: 'Everyday', paintable: false, paint: 0xf2c214 }),
  g('suv', 'Crossover SUV', 'suv', 'HEAVY_CRUISER', 'Soft suspension, big presence. Paintable.', 1900, 150, 'AWD', 0.98, DIESEL, { cls: 'SUV' }),
  g('suv-luxury', 'Luxury SUV', 'lux', 'HEAVY_CRUISER', 'Floating roof, chrome and turbine wheels for the Ezulwini run. Paintable.', 2300, 300, 'AWD', 1.06, rev(5600, 6400, 3.4, 0.38), { cls: 'SUV' }),
  g('van', 'Kombi Van', 'kombi', 'HEAVY_CRUISER', 'Two-tone retro kombi with round eyes and a split screen. Paintable.', 1900, 111, 'RWD', 0.95, DIESEL, { cls: 'Van & Truck' }),
  g('delivery', 'Delivery Van', 'box', 'HEAVY_CRUISER', 'Matsapha logistics box van. Paintable cab.', 2400, 120, 'RWD', 0.92, DIESEL, { cls: 'Van & Truck' }),
  g('delivery-flat', 'Dropside Van', 'dropside', 'HEAVY_CRUISER', 'Open dropside hauler. Paintable.', 2200, 120, 'RWD', 0.92, DIESEL, { cls: 'Van & Truck' }),
  g('truck', 'Box Truck', 'lorry', 'HEAVY_CRUISER', 'Cab-over rigid with a 6 m box. Heavy and unstoppable. Paintable cab.', 5500, 210, 'RWD', 0.9, LORRY, { cls: 'Van & Truck' }),
  g('truck-flat', 'Flatbed Truck', 'flatbed', 'HEAVY_CRUISER', 'Freight on the MR3, stake sides and a load of crates. Paintable cab.', 5000, 210, 'RWD', 0.9, LORRY, { cls: 'Van & Truck' }),
  g('vehicle-truck-red', 'Trophy Truck (Red)', 'trophy', 'HEAVY_CRUISER', 'Long-travel desert racer: huge flares, cage, LED bar.', 1600, 330, 'AWD', 1.2, rev(6200, 7200, 3.9, 0.42), { cls: 'Van & Truck', paintable: false, paint: 0xc81e1e }),
  g('vehicle-truck-yellow', 'Trophy Truck (Yellow)', 'trophy', 'HEAVY_CRUISER', 'Long-travel desert racer: huge flares, cage, LED bar.', 1600, 330, 'AWD', 1.2, rev(6200, 7200, 3.9, 0.42), { cls: 'Van & Truck', paintable: false, paint: 0xf2b705 }),
  g('vehicle-truck-green', 'Trophy Truck (Green)', 'trophy', 'HEAVY_CRUISER', 'Long-travel desert racer: huge flares, cage, LED bar.', 1600, 330, 'AWD', 1.2, rev(6200, 7200, 3.9, 0.42), { cls: 'Van & Truck', paintable: false, paint: 0x1f8a3c }),
  g('vehicle-truck-purple', 'Trophy Truck (Purple)', 'trophy', 'HEAVY_CRUISER', 'Long-travel desert racer: huge flares, cage, LED bar.', 1600, 330, 'AWD', 1.2, rev(6200, 7200, 3.9, 0.42), { cls: 'Van & Truck', paintable: false, paint: 0x6b2fb3 }),
  g('police', 'Police Interceptor', 'police', 'AWD_GRIP', 'Royal Eswatini Police pursuit: battenburg livery, light bar, push bar.', 1600, 250, 'RWD', 1.15, rev(6000, 6800, 3.6, 0.35), { cls: 'Service', paintable: false, paint: 0xf4f4f2 }),
  g('ambulance', 'Ambulance', 'ambulance', 'HEAVY_CRUISER', 'Emergency response box body with chequer bands and beacons.', 3200, 140, 'RWD', 0.92, DIESEL, { cls: 'Service', paintable: false, paint: 0xf4f4f2 }),
  g('firetruck', 'Fire Engine', 'fire', 'HEAVY_CRUISER', 'Biggest thing on the road: shutters, ladder, hose reel.', 9000, 260, 'RWD', 0.88, LORRY, { cls: 'Service', paintable: false, paint: 0xc4161c }),
  g('garbage-truck', 'Refuse Truck', 'garbage', 'HEAVY_CRUISER', 'Municipal compactor. Paintable cab.', 8000, 210, 'RWD', 0.88, LORRY, { cls: 'Service' }),
  g('tractor', 'Tractor', 'tractor', 'HEAVY_CRUISER', 'Malkerns farm country: lugged tyres, exhaust stack, glass cab. Paintable.', 3200, 75, 'RWD', 0.9, rev(2100, 2600, 7, 0.8, { engineIdleRpm: 700 }), { cls: 'Farm' }),
  g('tractor-shovel', 'Loader Tractor', 'loader', 'HEAVY_CRUISER', 'Front shovel loader with toothed bucket. Paintable.', 4200, 80, 'AWD', 0.9, rev(2100, 2600, 7, 0.85, { engineIdleRpm: 700 }), { cls: 'Farm' }),
  g('kart-oobi', 'Kart Bi', 'kart', 'RWD_DRIFT', 'Pure drift fun, helmeted driver included. Paintable.', 230, 21, 'RWD', 1.3, KART, { cls: 'Kart', paint: 0xe0262b }),
  g('kart-oodi', 'Kart Di', 'kart', 'RWD_DRIFT', 'Pure drift fun, helmeted driver included. Paintable.', 230, 21, 'RWD', 1.3, KART, { cls: 'Kart' }),
  g('kart-ooli', 'Kart Li', 'kart', 'RWD_DRIFT', 'Pure drift fun, helmeted driver included. Paintable.', 230, 21, 'RWD', 1.3, KART, { cls: 'Kart' }),
  g('kart-oopi', 'Kart Pi', 'kart', 'RWD_DRIFT', 'Pure drift fun, helmeted driver included. Paintable.', 230, 21, 'RWD', 1.3, KART, { cls: 'Kart' }),
  g('kart-oozi', 'Kart Zi', 'kart', 'RWD_DRIFT', 'Pure drift fun, helmeted driver included. Paintable.', 230, 21, 'RWD', 1.3, KART, { cls: 'Kart' }),
];
export const CAR_CLASSES: CarClass[] = ['Local', 'Sports', 'Race', 'Everyday', 'SUV', 'Van & Truck', 'Service', 'Farm', 'Kart'];
/** Models used for ambient traffic on the real OSM roads. */
export const TRAFFIC_MODELS = ['taxi', 'van', 'sedan', 'hatchback-sports', 'suv', 'delivery', 'truck', 'sedan-sports', 'suv-luxury', 'van', 'taxi', 'ambulance', 'police'];
