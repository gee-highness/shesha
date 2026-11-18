import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, ViewChild, inject, input, output, signal, computed, effect, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AssetLibrary } from '../../game/graphics/asset-library';
import { CAR_CATALOG, DEFAULT_CAR, CAR_CLASSES, CarClass, CarDef, carConfig } from '../../game/cars';
import { PaintService, type CarPaint } from '../../services/paint.service';
import type { LiveryChoice, PaintFinish } from '../../game/graphics/car-gen';

@Component({
  selector: 'app-car-select',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host{position:absolute;inset:0;z-index:40;display:block}
    .card{background:linear-gradient(160deg,rgba(24,24,27,.85),rgba(9,9,11,.8));backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.12)}
    .item{transition:background .12s,transform .12s,border-color .12s}
    .item:hover{background:rgba(255,255,255,.08);transform:translateX(3px)}
    .chip{transition:.12s}
    .go{background:linear-gradient(135deg,#fbbf24,#f97316);box-shadow:0 10px 30px rgba(249,115,22,.45)}
    .bar{height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}
    .bar>i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#fbbf24)}
    .shop{background:rgba(9,9,11,.82);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12)}
    .sw{width:24px;height:24px;border-radius:999px;border:2px solid rgba(255,255,255,.18);cursor:pointer;transition:transform .1s}
    .sw:hover{transform:scale(1.15)} .sw.on{border-color:#fbbf24;box-shadow:0 0 0 2px rgba(251,191,36,.35)}
    .pick{width:24px;height:24px;border-radius:999px;overflow:hidden;border:2px dashed rgba(255,255,255,.4);cursor:pointer;position:relative;display:grid;place-items:center;font-size:13px;font-weight:900}
    .pick input{position:absolute;inset:-6px;opacity:0;cursor:pointer}
    .lbl{font-size:10px;letter-spacing:.2em;font-weight:800;color:#a1a1aa;margin:10px 0 6px}
  `],
  template: `
    <div class="absolute inset-0 bg-black/65 flex items-center justify-center p-3 sm:p-6 text-white font-sans" (click)="closeModal.emit()">
      <div class="card w-full max-w-5xl h-full max-h-[620px] rounded-3xl overflow-hidden flex flex-col sm:flex-row" (click)="$event.stopPropagation()" role="dialog" aria-label="Choose your car">
        <!-- list -->
        <div class="sm:w-[300px] flex flex-col border-b sm:border-b-0 sm:border-r border-white/10 min-h-0 max-h-[38%] sm:max-h-none">
          <div class="p-4 pb-2">
            <div class="text-[10px] tracking-[0.3em] text-amber-300 font-bold">GARAGE</div>
            <div class="text-xl font-black">{{ filtered().length }} cars</div>
            <div class="flex flex-wrap gap-1.5 mt-2">
              <button class="chip px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer" [class.bg-amber-400]="!cls()" [class.text-zinc-950]="!cls()" [class.border-white/20]="cls()" (click)="cls.set(null)">All</button>
              @for (c of classes; track c) {
                <button class="chip px-2.5 py-1 rounded-full text-[11px] font-semibold border cursor-pointer" [class.bg-amber-400]="cls() === c" [class.text-zinc-950]="cls() === c" [class.border-white/20]="cls() !== c" (click)="cls.set(c)">{{ c }}</button>
              }
            </div>
          </div>
          <div class="overflow-y-auto px-2 pb-3 flex-1">
            @for (car of filtered(); track car.id) {
              <button class="item w-full text-left px-3 py-2.5 rounded-xl mb-1 cursor-pointer border" [class.border-amber-400]="sel().id === car.id" [class.bg-white/10]="sel().id === car.id" [class.border-transparent]="sel().id !== car.id" (click)="pick(car)">
                <div class="text-sm font-bold">{{ car.name }}</div>
                <div class="text-[11px] text-zinc-400">{{ car.cls }} · {{ drive(car) }}</div>
              </button>
            }
          </div>
        </div>
        <!-- preview -->
        <div class="flex-1 flex flex-col min-h-0 relative">
          <div class="relative flex-1 min-h-0">
            <canvas #view class="w-full h-full block"></canvas>
          @if (painting()) {
            <div class="shop absolute top-16 left-3 w-[262px] max-h-[calc(100%-72px)] overflow-y-auto rounded-2xl p-3.5 text-white" role="region" aria-label="Paint shop">
              <div class="flex items-center justify-between"><div class="text-sm font-black">Paint shop</div>
                @if (paintSvc.isCustom(sel())) { <button class="text-[11px] font-bold text-amber-300 cursor-pointer hover:underline" (click)="paintSvc.reset(sel())">Reset to factory</button> }</div>
              <div class="text-[11px] text-zinc-400">Saved for {{ sel().name }}</div>
              <div class="lbl">BODY</div>
              <div class="flex flex-wrap gap-1.5">
                @for (c of bodies; track c) { <button class="sw" [class.on]="p().body === c" [style.background]="c" (click)="set({ body: c })" [attr.aria-label]="'Body ' + c"></button> }
                <label class="pick" [style.background]="p().body" title="Any colour"><span class="mix-blend-difference">+</span><input type="color" [value]="p().body" (input)="set({ body: val($event) })" aria-label="Custom body colour"></label>
              </div>
              <div class="lbl">FINISH</div>
              <div class="grid grid-cols-4 gap-1">
                @for (f of finishes; track f.id) { <button class="chip py-1 rounded-lg text-[10.5px] font-bold border cursor-pointer" [class.bg-amber-400]="p().finish === f.id" [class.text-zinc-950]="p().finish === f.id" [class.border-white/20]="p().finish !== f.id" (click)="set({ finish: f.id })">{{ f.name }}</button> }
              </div>
              <div class="lbl">STRIPES &amp; LIVERY</div>
              <div class="grid grid-cols-3 gap-1">
                @for (l of liveries; track l.id) { <button class="chip py-1 rounded-lg text-[10.5px] font-bold border cursor-pointer" [class.bg-amber-400]="p().livery === l.id" [class.text-zinc-950]="p().livery === l.id" [class.border-white/20]="p().livery !== l.id" (click)="set({ livery: l.id })">{{ l.name }}</button> }
              </div>
              <div class="lbl">ACCENT <span class="tracking-normal font-semibold text-zinc-500">· stripes, roof, livery</span></div>
              <div class="flex flex-wrap gap-1.5">
                @for (c of accents; track c) { <button class="sw" [class.on]="p().accent === c" [style.background]="c" (click)="set({ accent: c })" [attr.aria-label]="'Accent ' + c"></button> }
                <label class="pick" [style.background]="p().accent" title="Any colour"><span class="mix-blend-difference">+</span><input type="color" [value]="p().accent" (input)="set({ accent: val($event) })" aria-label="Custom accent colour"></label>
              </div>
              <div class="lbl">WHEELS</div>
              <div class="flex flex-wrap gap-1.5">
                @for (c of rims; track c) { <button class="sw" [class.on]="p().rim === c" [style.background]="c" (click)="set({ rim: c })" [attr.aria-label]="'Wheels ' + c"></button> }
                <label class="pick" [style.background]="p().rim" title="Any colour"><span class="mix-blend-difference">+</span><input type="color" [value]="p().rim" (input)="set({ rim: val($event) })" aria-label="Custom wheel colour"></label>
              </div>
            </div>
          }
          </div>
          <button class="absolute top-3 right-3 w-10 h-10 rounded-full bg-black/50 grid place-items-center cursor-pointer hover:bg-white/15" (click)="closeModal.emit()" aria-label="Close"><mat-icon>close</mat-icon></button>
          <button class="absolute top-3 left-3 h-10 px-4 rounded-full grid grid-flow-col items-center gap-1.5 cursor-pointer text-xs font-black tracking-wider" [class.bg-amber-400]="painting()" [class.text-zinc-950]="painting()" [class.bg-black/50]="!painting()" (click)="painting.set(!painting())" aria-label="Paint shop"><mat-icon class="!text-[18px] !w-[18px] !h-[18px]">palette</mat-icon>PAINT</button>
          <div class="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-end gap-4 border-t border-white/10">
            <div class="flex-1">
              <div class="text-2xl font-black leading-tight">{{ sel().name }}</div>
              <div class="text-xs text-zinc-400">{{ sel().blurb }}</div>
              <div class="text-[11px] text-amber-200/90 font-mono mb-2">{{ stats().a.engineMaxPowerKw }} kW · {{ stats().a.massKg }} kg · {{ stats().a.driveType }}</div>
              <div class="grid grid-cols-3 gap-3 text-[10px] font-bold tracking-wider text-zinc-400">
                <div>POWER<div class="bar mt-1"><i [style.width.%]="stats().power"></i></div></div>
                <div>GRIP<div class="bar mt-1"><i [style.width.%]="stats().grip"></i></div></div>
                <div>WEIGHT<div class="bar mt-1"><i [style.width.%]="stats().mass"></i></div></div>
              </div>
            </div>
            <button class="go rounded-2xl px-7 py-3.5 text-zinc-950 font-black tracking-wider cursor-pointer hover:brightness-110" (click)="choose.emit(sel())">DRIVE THIS CAR</button>
          </div>
        </div>
      </div>
    </div>
  `
})
export class CarSelectComponent implements AfterViewInit, OnDestroy {
  current = input<string>('race');
  choose = output<CarDef>();
  closeModal = output<void>();
  @ViewChild('view', { static: true }) viewRef!: ElementRef<HTMLCanvasElement>;
  private zone = inject(NgZone);

  readonly classes = CAR_CLASSES;
  readonly cls = signal<CarClass | null>(null);
  readonly sel = signal<CarDef>(DEFAULT_CAR);
  readonly filtered = computed(() => CAR_CATALOG.filter((c) => !this.cls() || c.cls === this.cls()));
  readonly stats = computed(() => {
    const a = carConfig(this.sel());
    return { a, power: Math.min(100, Math.sqrt(a.engineMaxPowerKw / 520) * 100), grip: Math.min(100, ((a.tireGripPeak - 0.8) / 0.75) * 100), mass: Math.min(100, Math.sqrt(a.massKg / 13500) * 100) };
  });

  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private pivot = new THREE.Group();
  private raf = 0; private token = 0;

  readonly paintSvc = inject(PaintService);
  readonly painting = signal(false);
  readonly p = computed(() => this.paintSvc.get(this.sel()));
  readonly bodies = ['#d7263d', '#ff6b1a', '#f2a900', '#ffe14d', '#0f8b5f', '#7ed957', '#00a6c8', '#1b4fd8', '#2e3a59', '#7b2cbf', '#ff4fa3', '#f5f5f2', '#9aa3ad', '#16181d'];
  readonly accents = ['#ffffff', '#16181d', '#d7263d', '#f2a900', '#00a6c8', '#7ed957', '#ff4fa3', '#c0c4c9'];
  readonly rims = ['#c8ccd1', '#3a3d42', '#111214', '#d4a017', '#8c6a3c', '#f2f2f2', '#c1121f', '#00a6c8'];
  readonly finishes: { id: PaintFinish; name: string }[] = [{ id: 'metallic', name: 'Metallic' }, { id: 'gloss', name: 'Gloss' }, { id: 'matte', name: 'Matte' }, { id: 'pearlescent', name: 'Pearl' }];
  readonly liveries: { id: LiveryChoice; name: string }[] = [{ id: 'factory', name: 'Factory' }, { id: 'none', name: 'Clean' }, { id: 'racing', name: 'Racing' }, { id: 'twin', name: 'Twin' }, { id: 'side', name: 'Side' }, { id: 'stripe', name: 'Waist' }];
  /** Re-dress the showroom car whenever its paint changes (keeps the turntable angle). */
  private repaint = effect(() => { this.p(); const d = this.sel(); untracked(() => { if (this.renderer) this.show(d); }); });
  /** With the paint shop open, slide the turntable to the right of the panel so the whole car stays in view. */
  private slide = effect(() => { const on = this.painting(); this.pivot.position.set(on ? 1.15 : 0, 0, on ? -1.15 : 0); });
  set(patch: Partial<CarPaint>): void { this.paintSvc.set(this.sel(), patch); }
  val(e: Event): string { return (e.target as HTMLInputElement).value; }
  drive(c: CarDef): string { return carConfig(c).driveType; }
  pick(c: CarDef): void { this.sel.set(c); this.show(c); }

  ngAfterViewInit(): void {
    const found = CAR_CATALOG.find((c) => c.id === this.current()); if (found) this.sel.set(found);
    this.zone.runOutsideAngular(() => {
      const canvas = this.viewRef.nativeElement;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture; pm.dispose();
      const key = new THREE.DirectionalLight(0xfff1d6, 2.2); key.position.set(4, 6, 3); this.scene.add(key);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.35, metalness: 0.6 }));
      floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
      this.scene.add(this.pivot);
      this.cam.position.set(5.2, 2.2, 5.2); this.cam.lookAt(0, 0.7, 0);
      this.show(this.sel());
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== w * this.renderer.getPixelRatio() || canvas.height !== h * this.renderer.getPixelRatio()) { this.renderer.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
        this.pivot.rotation.y += 0.008;
        this.renderer.render(this.scene, this.cam);
      };
      loop();
    });
  }

  private async show(def: CarDef): Promise<void> {
    const t = ++this.token;
    const car = await AssetLibrary.preview(def, this.paintSvc.get(def)).catch(() => null);
    if (!car || t !== this.token) return;
    this.pivot.clear();
    const box = new THREE.Box3().setFromObject(car), size = box.getSize(new THREE.Vector3());
    const s = 4.4 / Math.max(size.x, size.z);
    const g = new THREE.Group(); car.scale.setScalar(s); g.add(car);
    const b2 = new THREE.Box3().setFromObject(g); car.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    this.pivot.add(g);
  }

  ngOnDestroy(): void { cancelAnimationFrame(this.raf); this.renderer?.dispose(); }
}
