import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * V-Me characters on the pavements: the VRoid bodies, looks (skin / hair / clothes colours) and walk cycle from V-Me
 * (src/app/avatar/*, public/avatars/looks/*.json, src/app/performer/pose-library.ts walkCycle + REST arms), loaded as optimised
 * plain glTF. Only the people nearest the player get a full character (a small pool); everyone else stays a cheap instanced figure.
 */
type E3 = { x: number; y: number; z: number };
const e = (x = 0, y = 0, z = 0): E3 => ({ x, y, z });
const TAU = Math.PI * 2;

/** V-Me pose-library walkCycle(phase, amount) with its relaxed rest arms (humanoid bone names, VRM 1.0 normalised frame). */
function walkCycle(phase: number, amount: number): Record<string, E3> {
  const a = Math.max(0, Math.min(1, amount)), s = Math.sin(TAU * phase), c = Math.cos(TAU * phase), swing = 0.55 * a;
  return {
    leftUpperLeg: e(-swing * s), rightUpperLeg: e(swing * s),
    leftLowerLeg: e(Math.max(0, swing * 1.1 * c)), rightLowerLeg: e(Math.max(0, -swing * 1.1 * c)),
    leftFoot: e(0.12 * a * s), rightFoot: e(-0.12 * a * s),
    spine: e(0.04 * a, 0.08 * a * s, 0), chest: e(0, -0.06 * a * s, 0), hips: e(0, -0.05 * a * s, 0.03 * a * c),
    leftUpperArm: e(0.05 + 0.35 * a * s, 0.05, -1.2), rightUpperArm: e(0.05 - 0.35 * a * s, 0.05, 1.2),
    leftLowerArm: e(0, -0.12, 0), rightLowerArm: e(0, 0.12, 0), leftHand: e(0, 0, -0.05), rightHand: e(0, 0, 0.05),
  };
}
/** VRoid J_Bip node name -> humanoid bone name. */
const BONES: Record<string, string> = {
  J_Bip_C_Hips: 'hips', J_Bip_C_Spine: 'spine', J_Bip_C_Chest: 'chest',
  J_Bip_L_UpperLeg: 'leftUpperLeg', J_Bip_R_UpperLeg: 'rightUpperLeg', J_Bip_L_LowerLeg: 'leftLowerLeg', J_Bip_R_LowerLeg: 'rightLowerLeg',
  J_Bip_L_Foot: 'leftFoot', J_Bip_R_Foot: 'rightFoot', J_Bip_L_UpperArm: 'leftUpperArm', J_Bip_R_UpperArm: 'rightUpperArm',
  J_Bip_L_LowerArm: 'leftLowerArm', J_Bip_R_LowerArm: 'rightLowerArm', J_Bip_L_Hand: 'leftHand', J_Bip_R_Hand: 'rightHand',
};
/** V-Me looks (public/avatars/looks), mapped onto the bodies shipped with the game. */
const LOOKS: { base: string; skin: string; hair: string; clothes: string }[] = [
  { base: 'sample-e', skin: '#8a5a3c', hair: '#1a1210', clothes: '#c9783a' }, { base: 'hair-male', skin: '#5a3523', hair: '#121010', clothes: '#f4f1ea' },
  { base: 'base-female', skin: '#7a4a32', hair: '#1c1412', clothes: '#f3eefb' }, { base: 'sample-d', skin: '#8a5a3c', hair: '#1a1210', clothes: '#f4f6fb' },
  { base: 'sample-e', skin: '#6e4228', hair: '#bdbdbd', clothes: '#6a4c93' }, { base: 'base-male', skin: '#5a3523', hair: '#151010', clothes: '#f77f00' },
  { base: 'hair-male', skin: '#6e4228', hair: '#141012', clothes: '#232136' }, { base: 'sample-d', skin: '#6b4028', hair: '#1a1210', clothes: '#18161c' },
  { base: 'base-female', skin: '#c08457', hair: '#2a1d16', clothes: '#6c5ce7' }, { base: 'base-female', skin: '#7a4a32', hair: '#1a1210', clothes: '#ffb3cf' },
  { base: 'sample-e', skin: '#7a4a32', hair: '#1a1210', clothes: '#3d5a80' }, { base: 'hair-male', skin: '#4e2e1d', hair: '#121010', clothes: '#f4f1ea' },
  { base: 'base-male', skin: '#5e3a26', hair: '#121010', clothes: '#1f2a44' }, { base: 'hair-male', skin: '#7a4a32', hair: '#141012', clothes: '#2b2d42' },
  { base: 'base-female', skin: '#6e4228', hair: '#1a1210', clothes: '#1d3557' }, { base: 'sample-d', skin: '#5a3523', hair: '#151010', clothes: '#2d2a3a' },
];
const BODIES = ['base-male', 'base-female', 'hair-male', 'sample-e', 'sample-d'];

/**
 * Merge a cloned character into ONE skinned mesh: textures packed into an atlas, UVs remapped, bone indices unified across its skins,
 * look tints baked as vertex colours. A VRoid body is ~15 materials / up to 130 primitives; this makes it a single draw call.
 */
function mergeCharacter(root: THREE.Object3D, atlas: { tex: THREE.Texture; slot: Map<THREE.Texture | null, [number, number]>; grid: number }, tint: Record<'skin' | 'hair' | 'clothes', THREE.Color>): THREE.SkinnedMesh | null {
  const meshes: THREE.SkinnedMesh[] = []; root.updateMatrixWorld(true); root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  if (!meshes.length) return null;
  const bones: THREE.Bone[] = [], inv: THREE.Matrix4[] = [], idx = new Map<THREE.Bone, number>();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [];
  for (const m of meshes) {
    const g = m.geometry, mats = Array.isArray(m.material) ? m.material : [m.material];
    const map = m.skeleton.bones.map((b, k) => { let i = idx.get(b); if (i === undefined) { i = bones.length; idx.set(b, i); bones.push(b); inv.push(m.skeleton.boneInverses[k].clone()); } return i; });
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes['position'].count, materialIndex: 0 }];
    const P = g.attributes['position'], N = g.attributes['normal'], U = g.attributes['uv'], I = g.attributes['skinIndex'], W = g.attributes['skinWeight'];
    if (!P || !I || !W) continue;
    for (const gr of groups) {
      const mt = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial, [tx, ty] = atlas.slot.get(mt.map ?? null) ?? [0, 0], G = atlas.grid;
      const nm = mt.name.toUpperCase(), c = nm.includes('_SKIN') || nm.includes('_FACE') ? tint.skin : nm.includes('_HAIR') ? tint.hair : nm.includes('_CLOTH') ? tint.clothes : null;
      const base = mt.map ? [1, 1, 1] : [mt.color.r, mt.color.g, mt.color.b];
      for (let k = gr.start; k < gr.start + gr.count; k++) {
        const v = g.index ? g.index.getX(k) : k;
        pos.push(P.getX(v), P.getY(v), P.getZ(v)); if (N) nor.push(N.getX(v), N.getY(v), N.getZ(v)); else nor.push(0, 1, 0);
        const u = U ? Math.min(1, Math.max(0, U.getX(v))) : 0.5, w = U ? Math.min(1, Math.max(0, U.getY(v))) : 0.5;
        uv.push((tx + u * 0.996 + 0.002) / G, (ty + w * 0.996 + 0.002) / G);
        col.push(c ? c.r : base[0], c ? c.g : base[1], c ? c.b : base[2]);
        si.push(map[I.getX(v)] ?? 0, map[I.getY(v)] ?? 0, map[I.getZ(v)] ?? 0, map[I.getW(v)] ?? 0); sw.push(W.getX(v), W.getY(v), W.getZ(v), W.getW(v));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: atlas.tex, vertexColors: true, roughness: 0.75, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide });
  const out = new THREE.SkinnedMesh(geo, mat); out.frustumCulled = false; out.castShadow = false;
  out.bind(new THREE.Skeleton(bones, inv), meshes[0].bindMatrix.clone());
  for (const m of meshes) m.parent?.remove(m);
  return out;
}
/** Pack every texture a body uses into one canvas atlas (512 px tiles). */
function buildAtlas(tpl: THREE.Object3D): { tex: THREE.Texture; slot: Map<THREE.Texture | null, [number, number]>; grid: number } {
  const maps: THREE.Texture[] = []; tpl.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; for (const mt of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) if (mt.map && !maps.includes(mt.map)) maps.push(mt.map); });
  const G = Math.max(1, Math.ceil(Math.sqrt(maps.length + 1))), T = G > 4 ? 256 : 512, cv = document.createElement('canvas'); cv.width = cv.height = G * T;
  const c2 = cv.getContext('2d')!; c2.fillStyle = '#ffffff'; c2.fillRect(0, 0, cv.width, cv.height);
  const slot = new Map<THREE.Texture | null, [number, number]>(); slot.set(null, [G - 1, G - 1]);   // last tile: plain white (untextured parts)
  maps.forEach((t, i) => { const x = i % G, y = Math.floor(i / G); slot.set(t, [x, y]); c2.clearRect(x * T, y * T, T, T); try { c2.drawImage(t.image as CanvasImageSource, x * T, y * T, T, T); } catch { /* unreadable image: stays clear */ } });
  const tex = new THREE.CanvasTexture(cv); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, slot, grid: G };
}

interface Avatar { root: THREE.Object3D; bones: [THREE.Object3D, string, THREE.Quaternion][]; hips?: THREE.Object3D; hipY: number; owner: number }

export class PedAvatars {
  private templates = new Map<string, THREE.Object3D>();
  private atlases = new Map<string, ReturnType<typeof buildAtlas>>();
  private pool: Avatar[] = [];
  ready = false;
  private q = new THREE.Quaternion(); private eu = new THREE.Euler();

  constructor(private scene: THREE.Scene, readonly size: number, private base = 'assets/models/people/') {}

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const got = await Promise.all(BODIES.map((b) => loader.loadAsync(this.base + b + '.glb').then((g) => [b, g.scene] as const).catch(() => null)));
    for (const g of got) if (g) this.templates.set(g[0], g[1]);
    if (!this.templates.size) return;
    for (let i = 0; i < this.size; i++) {
      const look = LOOKS[i % LOOKS.length], tpl = this.templates.get(look.base) ?? this.templates.values().next().value!;
      const root = cloneSkinned(tpl);
      // V-Me look colours, as vertex-colour multipliers on the atlas (skin / hair take the target tone, clothes keep their fabric detail)
      const tint = { skin: new THREE.Color(look.skin).multiplyScalar(1.9), hair: new THREE.Color(look.hair).multiplyScalar(2.2), clothes: new THREE.Color(1, 1, 1).lerp(new THREE.Color(look.clothes).multiplyScalar(1.4), 0.55) };
      let atlas = this.atlases.get(look.base); if (!atlas) { atlas = buildAtlas(tpl); this.atlases.set(look.base, atlas); }
      const merged = mergeCharacter(root, atlas, tint); if (merged) root.add(merged);
      const bones: Avatar['bones'] = []; let hips: THREE.Object3D | undefined;
      root.traverse((o) => { const h = BONES[o.name]; if (h) { bones.push([o, h, o.quaternion.clone()]); if (h === 'hips') hips = o; } });
      root.visible = false; this.scene.add(root);
      this.pool.push({ root, bones, hips, hipY: hips?.position.y ?? 0, owner: -1 });
    }
    this.ready = true;
  }

  /** Show / pose the full characters for the given people (index -> pose). Returns the set of indices drawn as characters. */
  place(list: { id: number; x: number; y: number; z: number; yaw: number; phase: number; amount: number }[]): Set<number> {
    const used = new Set<number>(); if (!this.ready) return used;
    const want = new Map(list.map((p) => [p.id, p]));
    for (const a of this.pool) if (a.owner >= 0 && !want.has(a.owner)) { a.owner = -1; a.root.visible = false; }   // free characters whose person left the ring
    for (const p of list) {
      let a = this.pool.find((q) => q.owner === p.id) ?? this.pool.find((q) => q.owner < 0); if (!a) continue;
      a.owner = p.id; a.root.visible = true; used.add(p.id);
      a.root.position.set(p.x, p.y, p.z); a.root.rotation.set(0, p.yaw + Math.PI, 0);                 // VRM 0.x bodies face -Z
      const pose = walkCycle(p.phase / TAU, p.amount);
      for (const [bone, name, rest] of a.bones) {
        const r = pose[name]; if (!r) { bone.quaternion.copy(rest); continue; }
        this.q.setFromEuler(this.eu.set(-r.x, r.y, -r.z));                                                // VRM 1.0 normalised -> VRM 0.x raw frame
        bone.quaternion.copy(rest).multiply(this.q);
      }
      if (a.hips) a.hips.position.y = a.hipY + Math.abs(Math.sin(p.phase)) * 0.02 * p.amount;              // V-Me WalkAnimator hip bob
    }
    return used;
  }
}
