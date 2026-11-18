import { Injectable, computed, signal } from '@angular/core';
import * as THREE from 'three';
import { CAR_CATALOG, DEFAULT_CAR, CarDef } from '../game/cars';
import { LiveryChoice, PaintFinish, PaintOpts, factoryAccent, factoryRim } from '../game/graphics/car-gen';

/** One car's paint job. Colours are CSS hex (sRGB). */
export interface CarPaint { body: string; accent: string; rim: string; finish: PaintFinish; livery: LiveryChoice }

/** Showroom colours a car gets from the factory when its catalogue entry has no fixed paint (stable per car id). */
const FACTORY_BODY = ['#d7263d', '#1b4fd8', '#f5f5f2', '#16181d', '#f2a900', '#0f8b5f', '#7b2cbf', '#ff6b1a', '#9aa3ad', '#00a6c8', '#b5172b', '#2e3a59'];
const hexOf = (rgb: number[]): string => '#' + new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2]).getHexString();
export const rgbOf = (hex: string): number[] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/**
 * Per-car paint shop: every car in the garage keeps its own body colour, accent (stripes / roof / livery), wheel colour,
 * finish and livery style. Saved on this device; untouched cars use their factory spec.
 */
@Injectable({ providedIn: 'root' })
export class PaintService {
  private readonly KEY = 'shesha.paint';
  readonly saved = signal<Record<string, Partial<CarPaint>>>(this.load());
  /** The car being driven (set by the app); the Tuning > Visuals tab paints this one. */
  readonly current = signal<CarDef>(DEFAULT_CAR);
  readonly currentPaint = computed(() => this.get(this.current()));

  factory(def: CarDef): CarPaint {
    let h = 0; for (const ch of def.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const body = def.paint !== undefined ? '#' + new THREE.Color(def.paint).getHexString() : FACTORY_BODY[h % FACTORY_BODY.length];
    const accent = def.stripe !== undefined ? '#' + new THREE.Color(def.stripe).getHexString() : hexOf(factoryAccent(def.gen));
    return { body, accent, rim: hexOf(factoryRim(def.gen)), finish: 'metallic', livery: 'factory' };
  }
  get(def: CarDef): CarPaint { return { ...this.factory(def), ...(this.saved()[def.id] ?? {}) }; }
  isCustom(def: CarDef): boolean { return !!this.saved()[def.id]; }
  set(def: CarDef, patch: Partial<CarPaint>): void { this.saved.update((s) => ({ ...s, [def.id]: { ...(s[def.id] ?? {}), ...patch } })); this.persist(); }
  reset(def: CarDef): void { this.saved.update((s) => { const n = { ...s }; delete n[def.id]; return n; }); this.persist(); }
  setCurrent(patch: Partial<CarPaint>): void { this.set(this.current(), patch); }

  /** Generator inputs for a paint job. */
  opts(p: CarPaint): { body: number[]; o: PaintOpts } { return { body: rgbOf(p.body), o: { accent: rgbOf(p.accent), rim: rgbOf(p.rim), livery: p.livery } }; }

  private load(): Record<string, Partial<CarPaint>> {
    try { const v = JSON.parse(localStorage.getItem(this.KEY) ?? '{}'); const ids = new Set(CAR_CATALOG.map((c) => c.id)); return Object.fromEntries(Object.entries(v).filter(([k]) => ids.has(k))) as Record<string, Partial<CarPaint>>; } catch { return {}; }
  }
  private persist(): void { try { localStorage.setItem(this.KEY, JSON.stringify(this.saved())); } catch { /* private mode: paint lasts for this session */ } }
}
