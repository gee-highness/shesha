import * as THREE from 'three';
import type { RaycastVehicle } from './raycast-vehicle';

/** A moving circle obstacle (AI car), with its own velocity and mass. */
export interface DynamicCollider { x: number; z: number; r: number; vx: number; vz: number; mass: number; id: number }
export interface CollisionResult { impactSpeed: number; hitKind: 'none' | 'static' | 'car'; hitId: number; hits: CarHit[] }
/** Another vehicle as an oriented box (centre, heading, half length / width), with its motion. */
export interface CarBody { id: number; x: number; z: number; yaw: number; hl: number; hw: number; vx: number; vz: number; w: number; mass: number }
/** Impulse (N s) the solver applied to another vehicle, and where (world x,z). */
export interface CarHit { id: number; jx: number; jz: number; px: number; pz: number; speed: number; sx: number; sz: number }

/** Separating-axis test for two oriented boxes. Normal points from B to A; contact = mean of the corners inside the other box. */
export function boxContact(a: CarBody, b: CarBody): { nx: number; nz: number; pen: number; px: number; pz: number } | null {
  const axes = [[Math.sin(a.yaw), Math.cos(a.yaw)], [Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)]];
  const ext = (o: CarBody, ax: number[]) => o.hl * Math.abs(ax[0] * Math.sin(o.yaw) + ax[1] * Math.cos(o.yaw)) + o.hw * Math.abs(ax[0] * Math.cos(o.yaw) - ax[1] * Math.sin(o.yaw));
  const dx = a.x - b.x, dz = a.z - b.z; let best = 1e9, nx = 0, nz = 0;
  for (const ax of axes) { const d = dx * ax[0] + dz * ax[1], o = ext(a, ax) + ext(b, ax) - Math.abs(d); if (o <= 0) return null; if (o < best) { best = o; const sg = d < 0 ? -1 : 1; nx = ax[0] * sg; nz = ax[1] * sg; } }
  const corners = (o: CarBody) => { const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw), rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw); return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => [o.x + fx * o.hl * u + rx * o.hw * v, o.z + fz * o.hl * u + rz * o.hw * v]); };
  const inside = (o: CarBody, p: number[]) => { const qx = p[0] - o.x, qz = p[1] - o.z; return Math.abs(qx * Math.sin(o.yaw) + qz * Math.cos(o.yaw)) <= o.hl + 0.02 && Math.abs(qx * Math.cos(o.yaw) - qz * Math.sin(o.yaw)) <= o.hw + 0.02; };
  let px = 0, pz = 0, n = 0;
  for (const c of corners(a)) if (inside(b, c)) { px += c[0]; pz += c[1]; n++; }
  for (const c of corners(b)) if (inside(a, c)) { px += c[0]; pz += c[1]; n++; }
  if (!n) { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; n = 1; }
  return { nx, nz, pen: best, px: px / n, pz: pz / n };
}
/** Moment of inertia of a car body about its vertical axis (solid box). */
export const yawInertia = (b: { mass: number; hl: number; hw: number }): number => (b.mass * (4 * b.hl * b.hl + 4 * b.hw * b.hw)) / 12;
/**
 * Equal-and-opposite impulse between two boxes at a contact (restitution e, Coulomb friction mu). Mutates both bodies' velocities and
 * returns the normal impulse magnitude. Velocity of a body point = v + w x r with w = (0, w, 0): (w*rz, -w*rx).
 */
export function carImpulse(a: CarBody, b: CarBody, c: { nx: number; nz: number; px: number; pz: number }, e = 0.15, mu = 0.45): number {
  const ia = 1 / a.mass, ib = 1 / b.mass, Ia = yawInertia(a), Ib = yawInertia(b);
  const rax = c.px - a.x, raz = c.pz - a.z, rbx = c.px - b.x, rbz = c.pz - b.z;
  const vx = a.vx + a.w * raz - (b.vx + b.w * rbz), vz = a.vz - a.w * rax - (b.vz - b.w * rbx);
  const vn = vx * c.nx + vz * c.nz; if (vn >= 0) return 0;
  const ran = raz * c.nx - rax * c.nz, rbn = rbz * c.nx - rbx * c.nz;
  const j = (-(1 + e) * vn) / (ia + ib + (ran * ran) / Ia + (rbn * rbn) / Ib);
  const push = (jx: number, jz: number) => { a.vx += jx * ia; a.vz += jz * ia; a.w += (raz * jx - rax * jz) / Ia; b.vx -= jx * ib; b.vz -= jz * ib; b.w -= (rbz * jx - rbx * jz) / Ib; };
  push(c.nx * j, c.nz * j);
  const tx = -c.nz, tz = c.nx, vt = vx * tx + vz * tz, rat = raz * tx - rax * tz, rbt = rbz * tx - rbx * tz;   // scraping friction along the contact
  const jt = Math.max(-mu * j, Math.min(mu * j, -vt / (ia + ib + (rat * rat) / Ia + (rbt * rbt) / Ib)));
  push(tx * jt, tz * jt);
  return j;
}

/**
 * Static world collision (building footprints, tree trunks, poles) in a spatial hash, plus an impulse solver
 * that treats the car as a chain of circles (works on non-convex building outlines, no tunnelling at 60 Hz+ with sub-steps).
 */
export class CollisionWorld {
  private static _fwd = new THREE.Vector3();
  private readonly CELL = 32;
  private polys: Float32Array[] = [];
  private polyBox: number[] = [];
  private polyRoof: boolean[] = []; // solid flat roof the car may land on / drive over
  private polyY: number[] = []; // [y0,y1] per polygon (absolute metres); +-1e9 = always
  private circleY: number[] = [];
  private circles: number[] = [];
  private polyGrid = new Map<number, number[]>();
  private circleGrid = new Map<number, number[]>();

  private key(cx: number, cz: number): number { return cx * 100003 + cz; }

  /** Road clearance test (set by the world): true when a solid at (x,z,r) spanning y0..y1 would sit inside a carriageway. */
  public clear: ((x: number, z: number, r: number, y0: number, y1: number) => boolean) | null = null;
  public cut = 0; // colliders refused because they were in a road

  /** `keep` = never cut (building shells, bridge parapets: placed deliberately). Returns false when the road volume removed it. */
  addPolygon(pts: number[], y0 = -1e9, y1 = 1e9, roof = false, keep = false): boolean {
    if (this.clear && !keep && !roof) {
      const n = pts.length / 2;
      for (let a = 0; a < n; a++) {
        const b = (a + 1) % n, ax = pts[a * 2], az = pts[a * 2 + 1], L = Math.hypot(pts[b * 2] - ax, pts[b * 2 + 1] - az), m = Math.max(1, Math.ceil(L / 0.8));
        for (let k = 0; k < m; k++) if (this.clear(ax + ((pts[b * 2] - ax) * k) / m, az + ((pts[b * 2 + 1] - az) * k) / m, 0, y0, y1)) { this.cut++; return false; }
      }
    }
    const idx = this.polys.length; this.polys.push(Float32Array.from(pts)); this.polyY.push(y0, y1); this.polyRoof.push(roof);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    this.polyBox.push(x0, z0, x1, z1);
    for (let a = Math.floor(x0 / this.CELL); a <= Math.floor(x1 / this.CELL); a++) for (let b = Math.floor(z0 / this.CELL); b <= Math.floor(z1 / this.CELL); b++) {
      const k = this.key(a, b); let l = this.polyGrid.get(k); if (!l) { l = []; this.polyGrid.set(k, l); } l.push(idx);
    }
    return true;
  }

  addCircle(x: number, z: number, r: number, y0 = -1e9, y1 = 1e9, keep = false): boolean {
    if (!keep && this.clear && this.clear(x, z, r, y0, y1)) { this.cut++; return false; }
    const idx = this.circles.length / 3; this.circles.push(x, z, r); this.circleY.push(y0, y1);
    const k = this.key(Math.floor(x / this.CELL), Math.floor(z / this.CELL)); let l = this.circleGrid.get(k); if (!l) { l = []; this.circleGrid.set(k, l); } l.push(idx);
    return true;
  }

  /** Height of a flat roof under (x,z) that a car at height y can be standing on, or null. */
  roofAt(x: number, z: number, y: number): number | null {
    const l = this.polyGrid.get(this.key(Math.floor(x / this.CELL), Math.floor(z / this.CELL))); if (!l) return null;
    let best: number | null = null;
    for (const i of l) {
      if (!this.polyRoof[i]) continue; const top = this.polyY[i * 2 + 1]; if (y < top - 1.5 || (best !== null && top <= best)) continue;
      const bb = i * 4; if (x < this.polyBox[bb] || x > this.polyBox[bb + 2] || z < this.polyBox[bb + 1] || z > this.polyBox[bb + 3]) continue;
      const p = this.polys[i], n = p.length / 2; let inside = false;
      for (let a = 0, b = n - 1; a < n; b = a++) if ((p[a * 2 + 1] > z) !== (p[b * 2 + 1] > z) && x < ((p[b * 2] - p[a * 2]) * (z - p[a * 2 + 1])) / (p[b * 2 + 1] - p[a * 2 + 1]) + p[a * 2]) inside = !inside;
      if (inside) best = top;
    }
    return best;
  }

  get polygonCount(): number { return this.polys.length; }
  get circleCount(): number { return this.circles.length / 3; }

  /** Signed contact of circle (cx,cz,r) with polygon i: push direction (towards free space) and penetration, or null. */
  private polyContact(i: number, cx: number, cz: number, r: number, out: { nx: number; nz: number; pen: number }): boolean {
    const p = this.polys[i], n = p.length / 2;
    let best = 1e18, bx = 0, bz = 0, inside = false;
    for (let a = 0, b = n - 1; a < n; b = a++) {
      const ax = p[a * 2], az = p[a * 2 + 1], bx2 = p[b * 2], bz2 = p[b * 2 + 1];
      if ((az > cz) !== (bz2 > cz) && cx < ((bx2 - ax) * (cz - az)) / (bz2 - az) + ax) inside = !inside;
      const ex = bx2 - ax, ez = bz2 - az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((cx - ax) * ex + (cz - az) * ez) / l2));
      const qx = ax + ex * t, qz = az + ez * t, d2 = (cx - qx) ** 2 + (cz - qz) ** 2;
      if (d2 < best) { best = d2; bx = qx; bz = qz; }
    }
    const d = Math.sqrt(best);
    if (inside) { const inv = 1 / Math.max(d, 1e-6); out.nx = (bx - cx) * inv; out.nz = (bz - cz) * inv; out.pen = r + d; return true; }
    if (d >= r) return false;
    const inv = 1 / Math.max(d, 1e-6); out.nx = (cx - bx) * inv; out.nz = (cz - bz) * inv; out.pen = r - d; return true;
  }

  /** Resolve the car against statics and moving colliders. Call once per physics step, after integration. */
  /** Debug: static colliders overlapping a car-sized disc at (x,z) for a car at height y. Returns 'p<i>' / 'c<i>' ids. */
  probe(x: number, z: number, rad: number, y: number): string[] {
    const out: string[] = [], c = { nx: 0, nz: 0, pen: 0 }, gx = Math.floor(x / this.CELL), gz = Math.floor(z / this.CELL);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const key = this.key(gx + a, gz + b);
      for (const i of this.polyGrid.get(key) ?? []) {
        if (y > this.polyY[i * 2 + 1] + (this.polyRoof[i] ? -0.6 : 1.3) || y < this.polyY[i * 2] - 1.3) continue;
        const bb = i * 4; if (x < this.polyBox[bb] - rad || x > this.polyBox[bb + 2] + rad || z < this.polyBox[bb + 1] - rad || z > this.polyBox[bb + 3] + rad) continue;
        if (this.polyContact(i, x, z, rad, c)) out.push('p' + i);
      }
      for (const i of this.circleGrid.get(key) ?? []) {
        if (y > this.circleY[i * 2 + 1] + 1.3 || y < this.circleY[i * 2] - 1.3) continue;
        const d = Math.hypot(x - this.circles[i * 3], z - this.circles[i * 3 + 1]); if (d < rad + this.circles[i * 3 + 2]) out.push('c' + i);
      }
    }
    return out;
  }

  /** Nearest spot to (x,z) where a car of radius `rad` is clear of every solid (spiral search); falls back to the input. */
  freeSpot(x: number, z: number, y: number, rad = 1.6): { x: number; z: number } {
    const c = { nx: 0, nz: 0, pen: 0 };
    const free = (px: number, pz: number) => {
      const gx = Math.floor(px / this.CELL), gz = Math.floor(pz / this.CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const key = this.key(gx + a, gz + b);
        for (const i of this.polyGrid.get(key) ?? []) { if (y > this.polyY[i * 2 + 1] + (this.polyRoof[i] ? -0.6 : 1.3) || y < this.polyY[i * 2] - 1.3) continue; if (this.polyContact(i, px, pz, rad, c)) return false; }
        for (const i of this.circleGrid.get(key) ?? []) { if (y > this.circleY[i * 2 + 1] + 1.3 || y < this.circleY[i * 2] - 1.3) continue; if (Math.hypot(px - this.circles[i * 3], pz - this.circles[i * 3 + 1]) < rad + this.circles[i * 3 + 2]) return false; }
      }
      return true;
    };
    if (free(x, z)) return { x, z };
    for (let r = 1.5; r <= 30; r += 1.5) for (let k = 0, n = Math.ceil(r * 2.4); k < n; k++) { const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (free(px, pz)) return { x: px, z: pz }; }
    return { x, z };
  }

  /** Push a free-moving car body (crashed traffic) out of buildings, poles and walls; bounces its velocity off what it hit. */
  pushBody(b: CarBody, y: number): number {
    const c = { nx: 0, nz: 0, pen: 0 }, fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rad = b.hw; let hit = 0;
    for (const off of [-(b.hl - rad), 0, b.hl - rad]) {
      const cx = b.x + fx * off, cz = b.z + fz * off, gx = Math.floor(cx / this.CELL), gz = Math.floor(cz / this.CELL);
      for (let a = -1; a <= 1; a++) for (let q = -1; q <= 1; q++) {
        const key = this.key(gx + a, gz + q);
        const one = (nx: number, nz: number, pen: number) => { b.x += nx * pen; b.z += nz * pen; const vn = b.vx * nx + b.vz * nz; if (vn < 0) { b.vx -= 1.2 * vn * nx; b.vz -= 1.2 * vn * nz; b.w *= 0.6; hit = Math.max(hit, -vn); } };
        for (const i of this.polyGrid.get(key) ?? []) { if (y > this.polyY[i * 2 + 1] + (this.polyRoof[i] ? -0.6 : 1.3) || y < this.polyY[i * 2] - 1.3) continue; if (this.polyContact(i, cx, cz, rad, c)) one(c.nx, c.nz, c.pen); }
        for (const i of this.circleGrid.get(key) ?? []) { if (y > this.circleY[i * 2 + 1] + 1.3 || y < this.circleY[i * 2] - 1.3) continue; const dx = cx - this.circles[i * 3], dz = cz - this.circles[i * 3 + 1], d = Math.hypot(dx, dz), need = rad + this.circles[i * 3 + 2]; if (d < need) one(dx / (d || 1), dz / (d || 1), need - d); }
      }
    }
    return hit;
  }

  /** True when the car's circle chain placed at (x,z,y) touches any solid or moving collider. */
  private touching(x: number, z: number, y: number, fx: number, fz: number, rad: number, L: number, count: number, dynamics: DynamicCollider[]): boolean {
    const c = { nx: 0, nz: 0, pen: 0 };
    for (let k = 0; k < count; k++) {
      const off = (k / (count - 1) - 0.5) * (L - 2 * rad), cx = x + fx * off, cz = z + fz * off;
      const gx = Math.floor(cx / this.CELL), gz = Math.floor(cz / this.CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const key = this.key(gx + a, gz + b);
        for (const i of this.polyGrid.get(key) ?? []) {
          if (y > this.polyY[i * 2 + 1] + (this.polyRoof[i] ? -0.6 : 1.3) || y < this.polyY[i * 2] - 1.3) continue;
          const bb = i * 4; if (cx < this.polyBox[bb] - rad || cx > this.polyBox[bb + 2] + rad || cz < this.polyBox[bb + 1] - rad || cz > this.polyBox[bb + 3] + rad) continue;
          if (this.polyContact(i, cx, cz, rad, c)) return true;
        }
        for (const i of this.circleGrid.get(key) ?? []) {
          if (y > this.circleY[i * 2 + 1] + 1.3 || y < this.circleY[i * 2] - 1.3) continue;
          if (Math.hypot(cx - this.circles[i * 3], cz - this.circles[i * 3 + 1]) < rad + this.circles[i * 3 + 2]) return true;
        }
      }
      for (const o of dynamics) if (Math.hypot(cx - o.x, cz - o.z) < rad + o.r) return true;
    }
    return false;
  }

  /**
   * Resolve the car against statics and moving colliders. Call once per physics step, after integration.
   * `prev` = where the car was before this step: the move is swept in <=0.3 m slices so a fast car can never skip through a thin wall or pole.
   */
  resolve(v: RaycastVehicle, dynamics: DynamicCollider[] = [], dt = 1 / 60, prev?: { x: number; y: number; z: number }, bodies: CarBody[] = []): CollisionResult {
    const res: CollisionResult = { impactSpeed: 0, hitKind: 'none', hitId: -1, hits: [] };
    const L = v.config.wheelBaseM + 1.45, rad = Math.max(0.9, v.config.trackWidthM * 0.52);
    const count = Math.max(3, Math.round(L / (rad * 1.2)));
    const fwd = CollisionWorld._fwd.set(0, 0, 1).applyQuaternion(v.quaternion);
    if (prev) {
      const dx = v.position.x - prev.x, dz = v.position.z - prev.z, dist = Math.hypot(dx, dz);
      if (dist > 0.3 && dist < 40 && !this.touching(prev.x, prev.z, prev.y, fwd.x, fwd.z, rad, L, count, dynamics)) {
        const n = Math.ceil(dist / 0.3);
        for (let s = 1; s <= n; s++) {
          const t = s / n;
          if (this.touching(prev.x + dx * t, prev.z + dz * t, prev.y + (v.position.y - prev.y) * t, fwd.x, fwd.z, rad, L, count, dynamics)) {
            const tb = s / n; v.position.x = prev.x + dx * tb; v.position.z = prev.z + dz * tb; break;   // stop at the first touching slice (<=0.3 m deep) so the solver below takes a proper impulse
          }
        }
      }
    }
    const m = v.config.massKg, Iy = (m * (L * L + (rad * 2) ** 2)) / 12;
    const c = { nx: 0, nz: 0, pen: 0 }; const py = v.position.y;

    const apply = (cx: number, cz: number, nx: number, nz: number, pen: number, otherVx: number, otherVz: number, otherMass: number, kind: 'static' | 'car', id: number) => {
      const rx = cx - v.position.x, rz = cz - v.position.z;
      // positional correction
      const corr = Math.max(0, pen - 0.005) * 0.7;
      v.position.x += nx * corr; v.position.z += nz * corr;
      // relative velocity at the contact
      const vx = v.velocity.x + v.angularVelocity.y * rz - otherVx, vz = v.velocity.z - v.angularVelocity.y * rx - otherVz;   // v + w x r, w = (0, wy, 0)
      const vn = vx * nx + vz * nz;
      if (vn >= 0) return;
      const rn = rz * nx - rx * nz; // (r x n).y
      const invM = 1 / m + (otherMass > 0 ? 1 / otherMass : 0);
      const e = Math.max(0.03, 0.2 - 0.012 * -vn); // crashes absorb most energy; gentle bumps bounce a little
      const j = (-(1 + e) * vn) / (invM + (rn * rn) / Iy);
      v.velocity.x += (nx * j) / m; v.velocity.z += (nz * j) / m;
      v.angularVelocity.y += (rn * j) / Iy;
      // Coulomb friction along the surface
      const tx = -nz, tz = nx, vt = vx * tx + vz * tz, rt = rz * tx - rx * tz;
      const jt = Math.max(-0.35 * j, Math.min(0.35 * j, -vt / (invM + (rt * rt) / Iy)));
      v.velocity.x += (tx * jt) / m; v.velocity.z += (tz * jt) / m; v.angularVelocity.y += (rt * jt) / Iy;
      if (-vn > res.impactSpeed) { res.impactSpeed = -vn; res.hitKind = kind; res.hitId = id; }
    };

    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < count; k++) {
        const off = (count === 1 ? 0 : (k / (count - 1) - 0.5) * (L - 2 * rad));
        const cx = v.position.x + fwd.x * off, cz = v.position.z + fwd.z * off;
        const gx = Math.floor(cx / this.CELL), gz = Math.floor(cz / this.CELL);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const key = this.key(gx + a, gz + b);
          const pl = this.polyGrid.get(key);
          if (pl) for (const i of pl) {
            if (py > this.polyY[i * 2 + 1] + (this.polyRoof[i] ? -0.6 : 1.3) || py < this.polyY[i * 2] - 1.3) continue; // different level (bridge vs road below); on a roof you clear the walls
            const bb = i * 4; if (cx < this.polyBox[bb] - rad || cx > this.polyBox[bb + 2] + rad || cz < this.polyBox[bb + 1] - rad || cz > this.polyBox[bb + 3] + rad) continue;
            if (this.polyContact(i, cx, cz, rad, c)) apply(cx, cz, c.nx, c.nz, c.pen, 0, 0, 0, 'static', i);
          }
          const cl = this.circleGrid.get(key);
          if (cl) for (const i of cl) {
            if (py > this.circleY[i * 2 + 1] + 1.3 || py < this.circleY[i * 2] - 1.3) continue;
            const ox = this.circles[i * 3], oz = this.circles[i * 3 + 1], orr = this.circles[i * 3 + 2];
            const dx = cx - ox, dz = cz - oz, d = Math.hypot(dx, dz), need = rad + orr;
            if (d < need) { const inv = 1 / Math.max(d, 1e-5); apply(cx, cz, dx * inv, dz * inv, need - d, 0, 0, 0, 'static', -2); }
          }
        }
        for (const o of dynamics) {
          const dx = cx - o.x, dz = cz - o.z, d = Math.hypot(dx, dz), need = rad + o.r;
          if (d < need) { const inv = 1 / Math.max(d, 1e-5); apply(cx, cz, dx * inv, dz * inv, need - d, o.vx, o.vz, o.mass, 'car', o.id); }
        }
      }
    }
    // ---- vehicle vs vehicle: oriented boxes, impulses shared by mass and inertia (the other car is pushed and spun too)
    if (bodies.length) {
      const fq = CollisionWorld._fwd.set(0, 0, 1).applyQuaternion(v.quaternion), yaw = Math.atan2(fq.x, fq.z);
      const me: CarBody = { id: -1, x: v.position.x, z: v.position.z, yaw, hl: v.config.wheelBaseM / 2 + 0.95, hw: v.config.trackWidthM / 2 + 0.14, vx: v.velocity.x, vz: v.velocity.z, w: v.angularVelocity.y, mass: v.config.massKg };
      for (const src of bodies) {
        const o: CarBody = { ...src };   // work on a copy: the caller applies the returned impulse to its own car
        if (Math.abs(o.x - me.x) > me.hl + o.hl + 2 || Math.abs(o.z - me.z) > me.hl + o.hl + 2) continue;
        const ct = boxContact(me, o); if (!ct) continue;
        const ia = 1 / me.mass, ib = 1 / o.mass, share = ia / (ia + ib), corr = Math.max(0, ct.pen - 0.01);
        me.x += ct.nx * corr * share; me.z += ct.nz * corr * share;
        const bx0 = o.vx, bz0 = o.vz, ow = o.w;
        const relN = -((me.vx - o.vx) * ct.nx + (me.vz - o.vz) * ct.nz);
        const j = carImpulse(me, o, ct, 0.15, 0.45);
        void ow; res.hits.push({ id: o.id, jx: (o.vx - bx0) * o.mass, jz: (o.vz - bz0) * o.mass, px: ct.px, pz: ct.pz, speed: Math.max(0, relN), sx: -ct.nx * corr * (1 - share), sz: -ct.nz * corr * (1 - share) });
        if (j > 0 && relN > res.impactSpeed) { res.impactSpeed = relN; res.hitKind = 'car'; res.hitId = o.id; }
      }
      v.position.x = me.x; v.position.z = me.z; v.velocity.x = me.vx; v.velocity.z = me.vz; v.angularVelocity.y = me.w;
    }
    void dt;
    return res;
  }
}
