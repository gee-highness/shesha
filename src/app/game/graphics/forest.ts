import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Real tree models (Quaternius "Stylized Nature MegaKit", CC0) at game cost.
 *  - Near the camera (NEAR m): the actual models, instanced per species and refilled as you drive.
 *  - Everywhere else: impostors baked from the same models at load (VIEWS views round each tree into one atlas), drawn as one
 *    camera-facing quad per tree (2 triangles) that picks the view matching the angle you look from. Lit like the terrain, fogged.
 */
export interface TreeSpot { x: number; y: number; z: number; rot: number; s: number; sp: number; tint: THREE.Color }
export const SPECIES = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'Pine_1', 'Pine_3', 'TwistedTree_1', 'Bush_Common'];
const VIEWS = 8, NEAR = 70, CELL = 50;

interface Species { parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[]; frame: number; off: number }

export class Forest {
  readonly group = new THREE.Group();
  private species: Species[] = [];
  private atlas?: THREE.WebGLRenderTarget;
  private grid = new Map<number, TreeSpot[]>();
  private near: THREE.InstancedMesh[][] = [];
  private lastX = 1e9; private lastZ = 1e9;
  readonly impostorMat: THREE.MeshStandardMaterial;
  private uni = { uSize: { value: [] as THREE.Vector2[] }, uNear: { value: NEAR - 4 } };
  ready = false;

  constructor(private renderer: THREE.WebGLRenderer, private base = 'assets/models/nature/') {
    this.impostorMat = new THREE.MeshStandardMaterial({ alphaTest: 0.5, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    this.impostorMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uni);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aSp; uniform vec2 uSize[${SPECIES.length}]; uniform float uNear;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <project_vertex>', `
          vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float sc = length(instanceMatrix[0].xyz);
          vec3 toC = cameraPosition - ip; toC.y = 0.0; float dist = length(toC); toC /= max(dist, 1e-3);
          vec3 right = vec3(toC.z, 0.0, -toC.x);
          float yawI = atan(instanceMatrix[2].x, instanceMatrix[2].z);
          float ang = atan(toC.x, toC.z) - yawI; float fr = mod(floor(ang / 6.2831853 * ${VIEWS}.0 + 0.5), ${VIEWS}.0);
          vec2 sz = uSize[int(aSp + 0.5)];
          vec3 wp = ip + right * position.x * sz.x * sc + vec3(0.0, (sz.y + position.y * sz.x) * sc, 0.0);
          if (dist < uNear) wp = ip;                                       // the real model takes over up close
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0); gl_Position = projectionMatrix * mvPosition;
          #ifdef USE_MAP
          vMapUv = vec2((fr + uv.x) / ${VIEWS}.0, (aSp + uv.y) / ${SPECIES.length}.0);
          #endif`);
    };
    this.impostorMat.customProgramCacheKey = () => 'tree-impostor1';
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    const models = await Promise.all(SPECIES.map((n) => loader.loadAsync(this.base + n + '.glb').then((g) => g.scene).catch(() => null)));
    if (models.some((m) => !m)) return;
    const S = 224, rt = new THREE.WebGLRenderTarget(S * VIEWS, S * SPECIES.length, { samples: 0 });
    rt.texture.colorSpace = THREE.SRGBColorSpace; rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
    const scene = new THREE.Scene(); scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 1.6); scene.add(sun, sun.target);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevRT = this.renderer.getRenderTarget(), prevClear = this.renderer.getClearColor(new THREE.Color()), prevAlpha = this.renderer.getClearAlpha();
    const prevVp = this.renderer.getViewport(new THREE.Vector4()), prevSc = this.renderer.getScissor(new THREE.Vector4()), prevScT = this.renderer.getScissorTest();
    this.renderer.setRenderTarget(rt); this.renderer.setClearColor(0x3d5a2a, 0); this.renderer.clear();
    models.forEach((m, si) => {
      const model = m!; const parts: Species['parts'] = [];
      model.updateMatrixWorld(true);
      model.traverse((o) => {
        const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone(); if (mat.map) { mat.alphaTest = Math.max(mat.alphaTest, 0.45); mat.side = THREE.DoubleSide; mat.transparent = false; }
        mat.metalness = 0; mat.roughness = Math.max(0.7, mat.roughness);
        parts.push({ geo: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mat });
      });
      const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const F = Math.max(size.y, size.x, size.z) * 1.04;
      cam.left = -F / 2; cam.right = F / 2; cam.top = F / 2; cam.bottom = -F / 2; cam.updateProjectionMatrix();
      scene.add(model);
      for (let k = 0; k < VIEWS; k++) {
        const a = (k / VIEWS) * Math.PI * 2;
        cam.position.set(c.x + Math.sin(a) * 60, c.y, c.z + Math.cos(a) * 60); cam.lookAt(c.x, c.y, c.z);
        sun.position.set(c.x + Math.sin(a + 0.6) * 40, c.y + 50, c.z + Math.cos(a + 0.6) * 40); sun.target.position.copy(c);
        this.renderer.setViewport(k * S, si * S, S, S); this.renderer.setScissor(k * S, si * S, S, S); this.renderer.setScissorTest(true);
        this.renderer.render(scene, cam);
      }
      scene.remove(model);
      this.species.push({ parts, frame: F, off: c.y - F / 2 });
      this.uni.uSize.value.push(new THREE.Vector2(F, c.y - F / 2));
    });
    this.renderer.setScissorTest(prevScT); this.renderer.setScissor(prevSc); this.renderer.setViewport(prevVp); this.renderer.setRenderTarget(prevRT); this.renderer.setClearColor(prevClear, prevAlpha);
    this.atlas = rt; this.impostorMat.map = rt.texture; this.impostorMat.needsUpdate = true;
    // near pools
    this.near = this.species.map((sp) => sp.parts.map((p) => { const im = new THREE.InstancedMesh(p.geo, p.mat, 160); im.count = 0; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.name = 'trees-near'; this.group.add(im); return im; }));
    this.ready = true;
  }

  /** One impostor mesh for a block of trees (register it for distance streaming like any chunk). */
  impostors(list: TreeSpot[]): THREE.InstancedMesh {
    const q = new THREE.PlaneGeometry(1, 1); q.translate(0, 0.5, 0);
    const sp = new Float32Array(list.length); list.forEach((t, i) => (sp[i] = t.sp));
    q.setAttribute('aSp', new THREE.InstancedBufferAttribute(sp, 1));
    const im = new THREE.InstancedMesh(q, this.impostorMat, list.length), m4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => {
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.y, t.z), Q.setFromAxisAngle(up, t.rot), new THREE.Vector3(t.s, t.s, t.s))); im.setColorAt(i, t.tint);
      const k = Math.floor(t.x / CELL) * 100003 + Math.floor(t.z / CELL); let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(t);
    });
    im.computeBoundingSphere(); im.name = 'trees-far'; return im;
  }

  /** Swap the real models in around the player (cheap: only when it has moved a few metres). */
  update(px: number, pz: number): void {
    if (!this.ready || Math.hypot(px - this.lastX, pz - this.lastZ) < 4) return; this.lastX = px; this.lastZ = pz;
    const counts = this.near.map(() => 0), m4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), r = Math.ceil(NEAR / CELL);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const l = this.grid.get((cx + a) * 100003 + (cz + b)); if (!l) continue;
      for (const t of l) {
        if (Math.hypot(t.x - px, t.z - pz) >= NEAR) continue; const pool = this.near[t.sp], n = counts[t.sp]; if (!pool || n >= pool[0].instanceMatrix.count) continue;
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), Q.setFromAxisAngle(up, t.rot), new THREE.Vector3(t.s, t.s, t.s));
        for (const im of pool) { im.setMatrixAt(n, m4); im.setColorAt(n, t.tint); }
        counts[t.sp] = n + 1;
      }
    }
    this.near.forEach((pool, si) => pool.forEach((im) => { im.count = counts[si]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }));
  }
}
