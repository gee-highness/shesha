/**
 * Town ground: a procedural site plan for every paved surface between the kerbs and the buildings.
 *
 * The planner's rules, in the order they are applied:
 *  1. LAND USE (ground-class raster, 10 m): urban (8) and industrial (9) are built-up land; everything else stays natural
 *     except building forecourts.
 *  2. SOFT LANDSCAPE IS KEPT: green ground from the aerial photo / satellite colour (yards, parks, verges, sports fields) is never
 *     paved over, so the city keeps its lawns and trees.
 *  3. FORECOURTS (building-proximity field, baked per tile): within ~2 m of a footprint is the apron / stoep / shopfront, always hard.
 *     Fading out to ~7 m it becomes the driveway / yard. Shopfront aprons use large saw-cut slabs, homes use small flags and pavers.
 *  4. PLOTS: built-up land is cut into plots (24 m in town, 48 m in industry, edges warped so no grid shows). Each plot gets ONE
 *     surface spec from a weighted catalogue, as a developer would build it, with a slightly darker plot edge (boundary joint):
 *       town:     large saw-cut concrete 1.2 m, small flags 0.6 m, red-brick stretcher bond, charcoal herringbone pavers,
 *                 exposed-aggregate wash, broom-finish cast slab 3 m, compacted red earth (township yards)
 *       industry: 6 m hardstanding panels with dowel joints, patched asphalt yard, compacted crusher-run
 *  5. EVERY UNIT DIFFERS: each slab / paver has its own tone; each plot has its own cement tint (warm or cool) and age.
 *  6. WEATHERING: tyre-polished tracks, grime pooling at the building line, rain-dark blooms, hairline cracks, moss in joints next
 *     to greenery, oil spots on yards and drains/manhole covers, all from world-space noise so nothing tiles.
 *  7. DISTANCE: joints and fine grain fade with pixel footprint (no shimmer); far away only the averaged tones remain, so
 *     the town still reads as concrete from the hills.
 */
export const TOWN_GROUND_DECL = /* glsl */ `
uniform sampler2D uGroundCls; uniform vec4 uClsBox;
float tgH(vec2 p){ return sh1(p); }
// rectangular grid seam: returns (seam 0..1, cell hash, cell hash 2)
vec3 tgGrid(vec2 p, vec2 size, float stagger, float jw, float fw){
  vec2 q = p / size; float row = floor(q.y); q.x += stagger * mod(row, 2.0) * 0.5;
  vec2 id = floor(q), f = fract(q); vec2 e = min(f, 1.0 - f) * size;
  float s = (1.0 - smoothstep(jw, jw + fw * 1.5, min(e.x, e.y))) * clamp(1.0 - fw * 6.0 / max(size.x, size.y) * 4.0, 0.0, 1.0);
  return vec3(s, tgH(id + 13.1), tgH(id + 71.7));
}
// herringbone pavers (two orientations interleaved)
vec3 tgHerring(vec2 p, float fw){
  vec2 q = p / 0.1; vec2 c = floor(q / 2.0); float o = mod(c.x + c.y, 2.0);
  vec2 r = o < 0.5 ? q : vec2(q.y, -q.x);
  vec3 g = tgGrid(r * 0.1, vec2(0.2, 0.1), 1.0, 0.006, fw * 1.4);
  return vec3(g.x, tgH(c + g.y * 7.0), g.z);
}
vec4 townGround(vec2 wp, vec2 p, vec3 base, float fw, float bld){
  // ---- 1. land use
  vec2 cuv = (wp - uClsBox.xy) / uClsBox.zw;
  float cls = (cuv.x > 0.0 && cuv.y > 0.0 && cuv.x < 1.0 && cuv.y < 1.0) ? floor(texture2D(uGroundCls, cuv).r * 255.0 + 0.5) : 0.0;
  float town = cls == 8.0 ? 1.0 : 0.0, ind = cls == 9.0 ? 1.0 : 0.0;
  // ---- 2. soft landscape stays (green, saturated ground)
  float green = clamp((base.g - max(base.r, base.b)) * 9.0 + (base.g - base.b) * 2.0, 0.0, 1.0);
  float soft = smoothstep(0.25, 0.7, green);
  // ---- 3. forecourts
  float apron = smoothstep(0.55, 0.95, bld), yard = smoothstep(0.15, 0.6, bld);
  float hard = max(apron, max(town, ind) * max(1.0 - soft, 0.0) * mix(0.55, 1.0, yard));
  hard = max(hard, yard * 0.6 * (1.0 - soft));
  if (hard < 0.02) return vec4(base, 0.0);
  // ---- 4. plots (warped edges) and their surface spec
  float plot = ind > 0.5 ? 48.0 : 24.0;
  vec2 pw = p + 3.0 * vec2(svn(p * 0.05 + 4.0) - 0.5, svn(p * 0.05 + 9.0) - 0.5);
  vec2 lid = floor(pw / plot); float lh = tgH(lid + 3.3), lh2 = tgH(lid + 8.9), lage = tgH(lid + 21.0);
  vec2 lf = fract(pw / plot); float ledge = min(min(lf.x, 1.0 - lf.x), min(lf.y, 1.0 - lf.y)) * plot;
  float plotLine = (1.0 - smoothstep(0.05, 0.12 + fw, ledge)) * clamp(1.0 - fw * 3.0, 0.0, 1.0);
  float aaF = clamp(1.0 - fw * 5.0, 0.0, 1.0);
  vec3 cementWarm = vec3(0.70, 0.67, 0.61), cementCool = vec3(0.62, 0.64, 0.66);
  vec3 cem = mix(cementCool, cementWarm, lh2) * mix(1.06, 0.84, lage);           // tint and age per plot
  vec3 col; float seam = 0.0, unit = 0.5;
  float kind;
  if (apron > 0.5) kind = town > 0.5 || ind > 0.5 ? (lh < 0.6 ? 0.0 : 5.0) : (lh < 0.5 ? 1.0 : 2.0);   // shopfront slabs vs home flags / pavers
  else if (ind > 0.5) kind = lh < 0.5 ? 10.0 : (lh < 0.8 ? 11.0 : 12.0);
  else kind = lh < 0.22 ? 0.0 : lh < 0.38 ? 1.0 : lh < 0.5 ? 2.0 : lh < 0.6 ? 3.0 : lh < 0.72 ? 4.0 : lh < 0.88 ? 5.0 : 6.0;
  if (kind == 0.0) { vec3 g = tgGrid(p, vec2(1.2, 1.2), 0.0, 0.008, fw); seam = g.x; unit = g.y; col = cem * (0.94 + 0.12 * g.y); }
  else if (kind == 1.0) { vec3 g = tgGrid(p, vec2(0.6, 0.6), 0.0, 0.006, fw); seam = g.x; unit = g.y; col = cem * vec3(0.98, 0.98, 1.0) * (0.9 + 0.18 * g.y); }
  else if (kind == 2.0) { vec3 g = tgGrid(p.yx, vec2(0.22, 0.11), 1.0, 0.005, fw); seam = g.x; unit = g.y; col = mix(vec3(0.56, 0.30, 0.22), vec3(0.66, 0.40, 0.29), g.y) * (0.9 + 0.12 * g.z); }
  else if (kind == 3.0) { vec3 g = tgHerring(p, fw); seam = g.x; unit = g.y; col = mix(vec3(0.34, 0.34, 0.35), vec3(0.47, 0.46, 0.45), g.y); }
  else if (kind == 4.0) { float sp = step(0.82, tgH(floor(p * 30.0))) * aaF; col = cem * (0.86 + 0.1 * svn(p * 3.0)) + sp * vec3(0.10, 0.08, 0.06) - step(0.9, tgH(floor(p * 30.0) + 5.0)) * 0.06 * aaF; unit = 0.5; }
  else if (kind == 5.0) { vec3 g = tgGrid(p, vec2(3.0, 3.0), 0.0, 0.01, fw); seam = g.x; unit = g.y; float broom = (svn(vec2(p.x * 40.0, p.y * 1.5)) - 0.5) * 0.06 * aaF; col = cem * (0.95 + 0.08 * g.y + broom); }
  else if (kind == 6.0) { col = mix(vec3(0.52, 0.33, 0.22), vec3(0.62, 0.45, 0.32), svn(p * 0.7)) * (0.9 + 0.15 * sfbm(p * 2.3)); unit = 0.5; }
  else if (kind == 10.0) { vec3 g = tgGrid(p, vec2(6.0, 6.0), 0.0, 0.015, fw); seam = g.x; unit = g.y; col = cem * vec3(0.95, 0.96, 0.98) * (0.9 + 0.1 * g.y); }
  else if (kind == 11.0) { float pch = step(0.62, svn(p * 0.18 + lid)); col = mix(vec3(0.20, 0.205, 0.21), vec3(0.27, 0.27, 0.27), pch) * (0.9 + 0.18 * sfbm(p * 1.7)); unit = 0.3; }
  else { col = mix(vec3(0.50, 0.48, 0.45), vec3(0.62, 0.60, 0.56), svn(p * 1.3)) * (0.9 + 0.12 * step(0.7, tgH(floor(p * 18.0))) * aaF); unit = 0.5; }
  // ---- 5/6. weathering
  float big = sfbm(p * 0.06 + lid * 0.37), mid = sfbm(p * 0.45 + 2.0);
  col *= 0.86 + 0.24 * big;                                                       // rain-dark blooms and sun-bleached patches
  col *= 1.0 - 0.18 * smoothstep(0.75, 1.0, bld) * (0.6 + 0.4 * mid);             // grime pooling at the building line
  float track = smoothstep(0.62, 0.8, svn(vec2(p.x * 0.35 + lh * 9.0, p.y * 0.04))) * yard * (1.0 - apron);
  col = mix(col, col * 1.08 + 0.02, track * 0.6);                                // tyre-polished drive tracks
  float crack = smoothstep(0.965, 0.995, sridge(p * 0.9 + lid * 3.1)) * aaF * (0.4 + lage);
  col *= 1.0 - crack * 0.35;
  vec3 joint = mix(col * 0.55, vec3(0.20, 0.26, 0.14), soft * 0.8 + 0.25 * green); // moss creeps into joints near greenery
  col = mix(col, joint, seam * 0.85);
  col *= 1.0 - plotLine * 0.22;
  float oil = smoothstep(0.78, 0.9, svn(p * 0.6 + lid * 5.0)) * (ind + yard * 0.5) * (1.0 - apron);
  col = mix(col, col * 0.55, oil * 0.6);
  { vec2 mc = (lid + vec2(0.3 + 0.4 * lh, 0.3 + 0.4 * lh2)) * plot; float dm = length(p - mc);   // a drain / manhole cover per plot
    float cover = (1.0 - smoothstep(0.32, 0.34 + fw, dm)) * step(0.45, lage) * aaF; float ring = cover * (1.0 - smoothstep(0.26, 0.28 + fw, dm));
    col = mix(col, vec3(0.16, 0.16, 0.17) * (0.8 + 0.4 * step(0.5, fract((p.x - mc.x) * 12.0))), cover); col = mix(col, col * 0.7, ring * 0.5); }
  col *= 0.97 + 0.06 * unit * aaF;
  // ---- HD close-up layer (only within a few metres of the camera: zero cost beyond the fade)
  float nearF = clamp(1.0 - fw * 40.0, 0.0, 1.0);
  if (nearF > 0.01) {
    float grain = tgH(floor(p * 90.0)) - 0.5, agg = step(0.86, tgH(floor(p * 45.0) + 1.7));        // cement grain + exposed aggregate stones
    float trowel = svn(vec2(p.x * 6.0 + p.y * 2.0, p.y * 0.6)) - 0.5;                                 // trowel / float marks
    col *= 1.0 + nearF * (grain * 0.10 + trowel * 0.05 * (kind == 0.0 || kind == 5.0 || kind == 10.0 ? 1.0 : 0.3) - agg * 0.06);
    col += nearF * seam * (1.0 - seam) * 0.25 * vec3(0.10);                                            // bevelled unit edges catch light
    col *= 1.0 - nearF * step(0.995, tgH(floor(p * 7.0) + lid)) * 0.25;                                  // the odd chipped corner / stain
  }
  return vec4(clamp(col, 0.0, 1.0), clamp(hard, 0.0, 1.0));
}
`;

export const TOWN_GROUND_APPLY = /* glsl */ `
  { vec2 tp = vW.xz; float tfw = fwidth(tp.x) + fwidth(tp.y);
    float tbld = 0.0;
    if (uMaskOn > 0.5) { vec2 muv = (vW.xz - uMaskBox.xy) / uMaskBox.zw; if (muv.x > 0.0 && muv.y > 0.0 && muv.x < 1.0 && muv.y < 1.0) tbld = texture2D(uRoadMask, muv).g; }
    vec4 tg = townGround(tp, mod(tp, 4096.0), diffuseColor.rgb, tfw, tbld);
    diffuseColor.rgb = mix(diffuseColor.rgb, tg.rgb, tg.a); }
`;
