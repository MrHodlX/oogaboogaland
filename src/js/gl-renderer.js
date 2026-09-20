(() => {
  "use strict";
  const BL = window.BL = window.BL || {};
  const { mat4 } = BL.math;
  const { updateWorld, traverseVisible, boundsOf, matrixModeOf, hiddenFromCamera } = BL.scene;
  const POINT_LIGHT_CAPACITY = 10;
  const QUALITY = {
    high: { dpr: 1.5, msaa: 4, shadow: 2048, bloom: true, mirror: 1024, environment: 128, environmentCadence: 1, lights: POINT_LIGHT_CAPACITY },
    medium: { dpr: 1.25, msaa: 2, shadow: 1024, bloom: true, mirror: 768, environment: 96, environmentCadence: 2, lights: POINT_LIGHT_CAPACITY },
    low: { dpr: 1, msaa: 0, shadow: 512, bloom: false, mirror: 512, environment: 64, environmentCadence: 4, lights: POINT_LIGHT_CAPACITY }
  };
  const INSTANCE_FLOATS = 20;
  // Caps the pixel ratio to bound buffer memory
  const MAX_PIXELS = 2.6e6;
  const DEFAULT_LIGHT = { x: 0.45, y: 0.85, z: 0.3 };
  const DEFAULT_SKY = [0.50, 0.52, 0.58];
  const DEFAULT_GROUND = [0.22, 0.20, 0.19];
  const DEFAULT_SUN = [0.80, 0.74, 0.66];
  const DEFAULT_CLEAR = [0.035, 0.035, 0.04];
  const DEFAULT_SHADOW_CENTER = { x: 0, y: 1.5, z: 0 };
  const DEFAULT_MOON = { x: 0, y: -1, z: 0 };
  const DEFAULT_STAR_MATRIX = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const CULL_MARGIN = 1;
  const MIRROR_EPSILON = 1e-7;
  const UP = { x: 0, y: 1, z: 0 };
  const NORTH_UP = { x: 0, y: 0, z: -1 };
  const CUBE_VIEWS = new Float32Array([1, 0, 0, 0, -1, 0, -1, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0, -1, 0]);
  const ZERO4 = new Float32Array([0, 0, 0, 1]);
  const NO_FOG = new Float32Array(3);
  const NO_MATRIX_CAVES = new Float32Array(32);
  const NO_MATRIX_PLANE = new Float32Array(4);
  const DEFAULT_MATRIX_APERTURE = new Float32Array([2.5, 3, 0.5, 0]);
  const NO_MIRROR_RIPPLES = new Float32Array(BL.mirrorRipples.CAPACITY * 4);
  const NO_MIRROR_BODY_WAVES = new Float32Array(BL.mirrorBody.CAPACITY * 4);
  const FOG_OFF = 1e8;
  const LIGHT_EYE = { x: 0, y: 0, z: 0 };
  const MESH_STRIDE = 10;
  const LINE_STRIDE = 12;
  const MATRIX_MASKS = new Int32Array([630678, 497559, 988959, 495513, 1009263, 288049, 456438, 616809]);
  const MESH_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec4 aM0;
layout(location=4) in vec4 aM1;
layout(location=5) in vec4 aM2;
layout(location=6) in vec4 aM3;
layout(location=7) in vec4 aParams;
uniform mat4 uViewProj;
uniform mat4 uLightViewProj;
uniform vec3 uEye;
out vec3 vNormal;
out vec4 vColor;
out vec4 vParams;
out vec4 vShadow;
out vec3 vWorld;
out vec3 vInstanceFacing;
out float vMatrixSurface;
flat out float vMatrixCave;
flat out float vMatrixPermanentFallback;
flat out float vSmokeOpacity;
void main() {
  mat4 m = mat4(aM0, aM1, aM2, aM3);
  vec4 w = m * vec4(aPos, 1.0);
  vNormal = normalize(mat3(m) * aNormal);
  vColor = aColor;
  vColor.rgb *= 1.0 - clamp(-aParams.y, 0.0, 1.0) * 0.88;
  // Cave ownership shares the otherwise nonnegative emissive channel. Decode it
  // before lighting so leaving the portal restores the original material exactly.
  float encoded = max(0.0, -aColor.a - 1.0);
  // Sloping HQ floors keep cave-wave ownership, but their glyphs span the
  // mesh's tiny triangle seams through the same material as the deeper ramp.
  vMatrixPermanentFallback = step(64.0, encoded);
  encoded -= vMatrixPermanentFallback * 64.0;
  float worldSurface = step(32.0, encoded);
  encoded -= worldSurface * 32.0;
  vMatrixSurface = aColor.a < 0.0 ? (1.0 - worldSurface) * (1.0 - vMatrixPermanentFallback) : 0.0;
  vMatrixCave = floor(encoded * 0.5);
  vColor.a = aColor.a < 0.0 ? encoded - vMatrixCave * 2.0 : aColor.a;
  vParams = aParams;
  vParams.y = max(0.0, aParams.y);
  // Smoke fades through coverage without a separate transparent draw pass.
  vSmokeOpacity = aParams.z < 0.0 ? -aParams.z - 1.0 : 1.0;
  vParams.z = max(0.0, aParams.z);
  vShadow = uLightViewProj * w;
  vWorld = w.xyz;
  vInstanceFacing = normalize(aM2.xyz);
  gl_Position = uViewProj * w;
  if (aParams.w != 0.0) {
    vec3 facing = normalize(aM2.xyz) * sign(aParams.w);
    if (dot(facing, uEye - aM3.xyz) <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
}`;
  const MESH_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
in vec3 vNormal;
in vec4 vColor;
in vec4 vParams;
in vec4 vShadow;
in vec3 vWorld;
in vec3 vInstanceFacing;
in float vMatrixSurface;
flat in float vMatrixCave;
flat in float vMatrixPermanentFallback;
flat in float vSmokeOpacity;
uniform vec3 uLightDir;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uSun;
uniform float uDirectStrength;
uniform float uAmbientFloor;
uniform float uDiffuseFloor;
uniform float uShadowStrength;
uniform float uShadowFloor;
uniform float uShadowBias;
uniform sampler2DShadow uShadow;
uniform float uShadowTexel;
uniform vec4 uLights[20];
uniform int uLightCount;
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec2 uFogRange;
uniform vec4 uMatrixParams;
uniform vec3 uMatrixOrigin;
uniform float uMatrixGlyph;
uniform float uMatrixCave;
uniform vec4 uMatrixCaves[8];
uniform vec4 uMatrixCaveBounds[8];
uniform float uMatrixCaveNear;
uniform float uMatrixPermanentCave;
uniform vec4 uMatrixPermanentPlane;
uniform vec4 uMatrixPermanentAperture;
uniform float uMatrixLivingGlobal;
uniform sampler2D uMatrixGlyphTex;
uniform int uMatrixSamples;
uniform float uClipMinY;
uniform float uClipMaxY;
uniform float uMatrixGlyphOpacity;
#ifdef MATRIX_SAMPLE_INTERPOLATION
vec2 matrixSampleOffsets[4];
#endif
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oBright;
float matrixHash(int n) {
  uint x = uint(n);
  x ^= x >> 16;
  x *= 2146121005u;
  x ^= x >> 15;
  x *= 2221713035u;
  x ^= x >> 16;
  return float(x >> 8) / 16777216.0;
}
float matrixPixelCoverage(vec2 p, vec2 halfSize, vec2 footprint) {
#ifdef MATRIX_SAMPLE_INTERPOLATION
  if (uMatrixSamples > 1) {
    float covered = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= uMatrixSamples) break;
      covered += all(lessThanEqual(abs(p + matrixSampleOffsets[i]), halfSize)) ? 1.0 : 0.0;
    }
    return covered / float(uMatrixSamples);
  }
#endif
  // Integrate the pixel rectangle over the screen pixel's footprint. A distance
  // smoothstep dims resolved cores and loses energy as several voxels minify.
  vec2 lo = max(p - footprint * 0.5, -halfSize);
  vec2 hi = min(p + footprint * 0.5, halfSize);
  vec2 covered = max(hi - lo, vec2(0.0)) / footprint;
  return covered.x * covered.y;
}
float matrixGlyphAt(vec3 n, float flow, out float glow, out float tip, out float palette, out float sideMix, out float sideShade) {
  const float streamPitch = 0.12;
  const float glyphGap = 0.13;
  const float pixelPitch = 0.021;
  const float pixelSize = 0.016;
  vec3 viewDir = normalize(uEye - vWorld);
  float viewNormal = max(abs(dot(viewDir, n)), 0.08);
  vec3 glyphWorld = vWorld + viewDir * (0.015 / viewNormal);
  vec3 rel = glyphWorld - uMatrixOrigin;
  flow = length(rel.xz);
  vec3 worldDx = dFdx(vWorld), worldDy = dFdy(vWorld);
  vec3 an = abs(n);
  float streamGrid;
  float localCross;
  float travelCoord;
  vec3 crossAxis;
  vec3 flowAxis;
  int stream;
  if (an.y >= an.x && an.y >= an.z) {
    vec2 radial = flow > 0.0001 ? rel.xz / flow : vec2(1.0, 0.0);
    crossAxis = vec3(-radial.y, 0.0, radial.x);
    flowAxis = vec3(radial.x, 0.0, radial.y);
    float angle = atan(rel.z, rel.x);
    float level = clamp(ceil(log2(max(flow, 0.75) / 0.75)), 0.0, 6.0);
    int rayCount = int(32.0 * exp2(level));
    float rayStep = 6.28318530718 / float(rayCount);
    int ray = int(floor((angle + 3.14159265359) / rayStep + 0.5));
    int wrappedRay = ray % rayCount;
    if (wrappedRay < 0) wrappedRay += rayCount;
    stream = wrappedRay * (2048 / rayCount);
    float centerAngle = float(ray) * rayStep - 3.14159265359;
    localCross = atan(sin(angle - centerAngle), cos(angle - centerAngle)) * flow;
    streamGrid = float(stream);
    travelCoord = flow;
  } else if (an.x >= an.z) {
    crossAxis = vec3(0.0, 0.0, -sign(n.x));
    flowAxis = vec3(0.0, 1.0, 0.0);
    streamGrid = glyphWorld.z / streamPitch;
    stream = int(floor(streamGrid));
    localCross = (fract(streamGrid) * streamPitch - streamPitch * 0.5) * -sign(n.x);
    travelCoord = -glyphWorld.y;
  } else {
    crossAxis = vec3(sign(n.z), 0.0, 0.0);
    flowAxis = vec3(0.0, 1.0, 0.0);
    streamGrid = glyphWorld.x / streamPitch;
    stream = int(floor(streamGrid));
    localCross = (fract(streamGrid) * streamPitch - streamPitch * 0.5) * sign(n.z);
    travelCoord = -glyphWorld.y;
  }
  int rank = int(floor(matrixHash(stream + 7) * 8.0));
  glow = tip = palette = sideMix = 0.0;
  sideShade = 1.0;
  if (float(rank) >= uMatrixParams.w * 8.0) return 0.0;
  float streamSeed = matrixHash(stream);
  float speed = 0.56 + matrixHash(stream + 19) * 0.64;
  int trainLength = 7 + int(floor(streamSeed * 6.0));
  int gapLength = 2 + int(floor(matrixHash(stream + 41) * 5.0));
  int sequence = trainLength + gapLength;
  float phase = matrixHash(stream + 73) * float(sequence) * glyphGap;
  float movingGrid = (travelCoord - uMatrixParams.z * speed - phase) / glyphGap;
  int flowCell = int(floor(movingGrid));
  int trainPosition = flowCell % sequence;
  if (trainPosition < 0) trainPosition += sequence;
  if (trainPosition >= trainLength) return 0.0;
  float trail = float(trainPosition + 1) / float(trainLength);
  glow = (0.58 + matrixHash(stream + 101) * 0.36) * (0.48 + trail * 0.52);
  tip = trainPosition == trainLength - 1 ? 1.0 : trainPosition == trainLength - 2 ? 0.55 : 0.0;
  vec2 local = vec2(localCross, fract(movingGrid) * glyphGap - glyphGap * 0.5);
  // Falling motion and glyph orientation are independent: wall characters keep
  // the reference mesh's upright Y axis while their centres travel downward.
  if (an.y < max(an.x, an.z)) local.y = -local.y;
  vec2 footprint = max(abs(vec2(dot(worldDx, crossAxis), dot(worldDx, flowAxis)))
    + abs(vec2(dot(worldDy, crossAxis), dot(worldDy, flowAxis))), vec2(0.00001));
#ifdef MATRIX_SAMPLE_INTERPOLATION
  // Use the framebuffer's real sample locations, just as the voxel meshes do.
  // Explicit interpolation here does not force sample-frequency shading on the
  // normal scene, and requires no extra pass or per-frame resources.
  for (int i = 0; i < 4; i++) {
    if (i >= uMatrixSamples) break;
    vec3 offset = interpolateAtSample(vWorld, i) - vWorld;
    matrixSampleOffsets[i] = vec2(dot(offset, crossAxis), dot(offset, flowAxis));
  }
#endif
  // The reference boxes are .01 deep with .01 surface clearance: their back,
  // centre and front lie at .01, .015 and .02. Project that same silhouette.
  vec2 slope = vec2(dot(viewDir, crossAxis), dot(viewDir, flowAxis)) / viewNormal;
  vec2 middle = local;
  ivec2 nearest = ivec2(floor(vec2(middle.x / pixelPitch + 2.0, 3.0 - middle.y / pixelPitch)));
  int version = int(floor(uMatrixParams.z * 20.0));
  int glyph = (abs(stream * 73 + flowCell * 151) + version) & 7;
  palette = float(glyph & 1);
  float coverage = 0.0, frontCoverage = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 pixel = nearest + ivec2(dx, dy);
      if (pixel.x < 0 || pixel.x >= 4 || pixel.y < 0 || pixel.y >= 6) continue;
      float mask = texelFetch(uMatrixGlyphTex, ivec2(glyph * 6 + 1 + pixel.x, 5 - pixel.y), 0).r;
      if (mask == 0.0) continue;
      vec2 center = vec2((float(pixel.x) - 1.5) * pixelPitch, (2.5 - float(pixel.y)) * pixelPitch);
      coverage += matrixPixelCoverage(middle - center, vec2(pixelSize * 0.5) + abs(slope) * 0.005, footprint);
      frontCoverage += matrixPixelCoverage(local + slope * 0.005 - center, vec2(pixelSize * 0.5), footprint);
    }
  }
  coverage = min(coverage, 1.0);
  sideMix = clamp(1.0 - frontCoverage / max(coverage, 0.00001), 0.0, 1.0);
  vec3 sideNormal = abs(slope.x) >= abs(slope.y)
    ? crossAxis * (slope.x < 0.0 ? -1.0 : 1.0)
    : flowAxis * (slope.y < 0.0 ? -1.0 : 1.0);
  sideShade = 0.7 + max(dot(sideNormal, uLightDir), 0.0) * 0.22 + max(dot(sideNormal, viewDir), 0.0) * 0.08;
  return coverage;
}
float shadowAt(vec3 p, float bias) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(uShadow, vec3(p.xy + vec2(float(x), float(y)) * uShadowTexel, p.z - bias));
    }
  }
  return s / 9.0;
}
vec3 lightFactorAt(vec3 n) {
  float ndl = max(max(dot(n, uLightDir), 0.0), uDiffuseFloor);
  // The light matrix is orthographic, so vShadow.w is exactly 1
  vec3 sp = vShadow.xyz * 0.5 + 0.5;
  float bias = max(uShadowBias * (1.0 - ndl), uShadowBias * 0.32);
  float sh = shadowAt(sp, bias);
  vec3 factor = max(mix(uGround, uSky, n.y * 0.5 + 0.5), vec3(uAmbientFloor));
  factor += uSun * ndl * uDirectStrength * mix(1.0, max(sh, uShadowFloor), uShadowStrength);
  for (int i = 0; i < 10; i++) {
    if (i >= uLightCount) break;
    vec4 lp = uLights[i * 2];
    vec3 ld = lp.xyz - vWorld;
    float dist = length(ld);
    float a = clamp(1.0 - dist / lp.w, 0.0, 1.0);
    a *= a;
    factor += uLights[i * 2 + 1].rgb * a * max(dot(n, ld), 0.0) / max(dist, 0.0001);
  }
  return factor;
}
vec3 matrixGlyphColor(vec3 base, float glow, float tip, float sideMix, float sideShade) {
  float emission = mix(0.78, 1.15, glow);
  vec3 front = base * emission;
  vec3 side = base * emission * sideShade;
  return mix(mix(front, side, sideMix), vec3(0.84, 1.0, 0.89), tip * 0.88);
}
float matrixTravel(vec2 point, float caveIndex) {
  if (caveIndex < 0.5) return length(point - uMatrixOrigin.xz);
  vec4 cave = uMatrixCaves[int(caveIndex) - 1];
  float depth = max(0.0, cave.z - dot(point, cave.xy));
  // Project to this point's entrance crossing, not the mouth center: the path
  // agrees exactly with the exterior radial wave across the entire opening.
  return length(point + cave.xy * depth - uMatrixOrigin.xz) + depth;
}
float matrixPermanentAt(vec3 point, float caveIndex) {
  if (uMatrixPermanentCave < 0.5 || abs(caveIndex - uMatrixPermanentCave) > 0.5) return 0.0;
  float depth = -dot(uMatrixPermanentPlane, vec4(point, 1.0));
  vec4 cave = uMatrixCaves[int(uMatrixPermanentCave) - 1], bounds = uMatrixCaveBounds[int(uMatrixPermanentCave) - 1];
  float across = dot(point.xz - bounds.xz, vec2(cave.y, -cave.x)), height = point.y - bounds.y;
  // The first half metre is the actual stone frame's opening. Its exterior
  // jambs and lintel never inherit the wider carved tunnel's material.
  // Rotated voxel carving expands each nominal box by half a voxel, and
  // its boundary faces reach another half voxel beyond the cell centres.
  vec4 aperture = uMatrixPermanentAperture;
  float voxelReach = aperture.w > 0.0 ? aperture.w : 0.5 * (abs(cave.x) + abs(cave.y));
  bool room = depth > aperture.z + 2.5 - voxelReach, throat = depth <= aperture.z;
  float halfWidth = throat ? aperture.x : aperture.x + (room ? 0.5 : 0.0) + voxelReach;
  float ceiling = aperture.y + (room && !throat ? 1.0 : 0.0);
  return depth >= -0.000001 && depth <= bounds.w + voxelReach && abs(across) <= halfWidth + 0.000001 && height >= -0.000001 && height <= ceiling + 0.000001 ? 1.0 : 0.0;
}
void main() {
  if (vWorld.y < uClipMinY || vWorld.y > uClipMaxY) discard;
  if (vSmokeOpacity < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy) & 3;
    int rank = ((pixel.x & 1) ^ (pixel.y & 1)) * 8 + (pixel.y & 1) * 4
      + (((pixel.x >> 1) & 1) ^ ((pixel.y >> 1) & 1)) * 2 + ((pixel.y >> 1) & 1);
    if ((float(rank) + 0.5) / 16.0 >= vSmokeOpacity) discard;
  }
  vec3 n = normalize(vNormal);
  vec3 base = vColor.rgb;
  float cloud = step(3.5, vParams.z);
  float wholeLiving = step(1.5, vParams.z) * (1.0 - step(2.5, vParams.z));
  float emissiveLiving = step(2.5, vParams.z) * (1.0 - cloud) * step(0.001, vColor.a);
  float living = max(wholeLiving, emissiveLiving);
  float caveIndex = max(vMatrixCave, uMatrixCave);
  float flow = uMatrixParams.x > 0.0 ? matrixTravel(vWorld.xz, caveIndex) : 0.0;
  if (cloud > 0.0) flow = min(flow, 36.0);
  // Moving occupants have no static face ownership. Terrain also fills its
  // voxel-labelled entrance gaps, bounded to the one permanent cave.
  bool permanentFallback = vMatrixPermanentFallback > 0.0 && uMatrixPermanentCave > 0.0;
  if ((uMatrixParams.x > 0.0 || uMatrixPermanentCave > 0.0) && (living > 0.0 || permanentFallback) && caveIndex < 0.5 && length(vWorld.xz - uMatrixOrigin.xz) > uMatrixCaveNear) {
    for (int i = 0; i < 8; i++) {
      if (living < 0.5 && abs(float(i + 1) - uMatrixPermanentCave) > 0.5) continue;
      vec4 cave = uMatrixCaves[i], bounds = uMatrixCaveBounds[i];
      float depth = cave.z - dot(vWorld.xz, cave.xy);
      float across = dot(vWorld.xz - bounds.xz, vec2(cave.y, -cave.x));
      float height = vWorld.y - bounds.y;
      bool room = depth > 3.0;
      bool permanentDepth = abs(float(i + 1) - uMatrixPermanentCave) < 0.5 && dot(uMatrixPermanentPlane.xyz, uMatrixPermanentPlane.xyz) > 0.0 && dot(uMatrixPermanentPlane, vec4(vWorld, 1.0)) <= 0.0;
      if ((depth >= 0.0 || permanentDepth) && depth <= bounds.w && abs(across) <= (room ? 3.35 : 2.7) && height >= 0.0 && height <= (room ? 4.15 : 3.15)) {
        caveIndex = float(i + 1);
        flow = matrixTravel(vWorld.xz, caveIndex);
        break;
      }
    }
  }
  // Living occupants retain the cloud-side reveal after flying beyond the
  // island. Carved cave paths still follow their full entrance travel distance.
  if (living > 0.0 && caveIndex < 0.5) flow = min(flow, 36.0);
  float localSurface = max(vMatrixSurface, step(1.5, uMatrixGlyph));
  float permanent = matrixPermanentAt(vWorld, caveIndex);
  // A contact pixel may straddle the glass: its centre can be behind the
  // plane while uncovered MSAA samples still see the ordinary front floor.
  // Certify the whole static pixel footprint without moving the world plane.
  float permanentDepth = -dot(uMatrixPermanentPlane, vec4(vWorld, 1.0));
  float permanentFootprint = 0.5 * (abs(dFdx(permanentDepth)) + abs(dFdy(permanentDepth)));
  if (living < 0.5 && uMatrixGlyph < 0.5 && permanentDepth < permanentFootprint + 0.000001) permanent = 0.0;
  float front = max(permanent, mix(1.0, uMatrixLivingGlobal, living) * uMatrixParams.x * (1.0 - smoothstep(uMatrixParams.y - 1.5, uMatrixParams.y, flow)));
  if (uMatrixGlyph > 2.5) {
    // The original black liner is an effect, not the unrevealed cave material.
    // Blend it only behind the advancing front; the ordinary stone stays below.
    if (front <= 0.0) discard;
    float fog = smoothstep(uFogRange.x, uFogRange.y, distance(vWorld, uEye));
    oColor = vec4(uFog * fog, front);
    oBright = vec4(0.0, 0.0, 0.0, front);
    return;
  }
  float ndl = max(max(dot(n, uLightDir), 0.0), uDiffuseFloor);
  float localGlyph = step(0.5, uMatrixGlyph) * (1.0 - step(1.5, uMatrixGlyph));
  if (localGlyph > 0.0) {
    float reveal = (caveIndex > 0.0 ? front : 1.0) * uMatrixGlyphOpacity;
    if (reveal <= 0.0) discard;
    float glow = clamp(vColor.a * vParams.x, 0.0, 1.0);
    float tip = clamp(vParams.z, 0.0, 1.0);
    float sideMix = 1.0 - smoothstep(0.45, 0.9, abs(dot(n, normalize(vInstanceFacing))));
    vec3 viewDir = normalize(uEye - vWorld);
    float sideShade = 0.7 + max(dot(n, uLightDir), 0.0) * 0.22 + max(dot(n, viewDir), 0.0) * 0.08;
    vec3 matrixGreen = matrixGlyphColor(base, glow, tip, sideMix, sideShade);
    float matrixFog = smoothstep(uFogRange.x, uFogRange.y, distance(vWorld, uEye));
    oColor = vec4(mix(matrixGreen, uFog, matrixFog), reveal);
    oBright = vec4(matrixGreen * (glow * 0.9 + tip * 0.85) * (1.0 - matrixFog), reveal);
    return;
  }
  float fog = smoothstep(uFogRange.x, uFogRange.y, distance(vWorld, uEye));
  vec3 matrixColorResult = vec3(0.0);
  vec3 matrixBrightResult = vec3(0.0);
  if (front > 0.0) {
    vec3 matrixGreen;
    float matrixBloom;
    vec3 matrixColor;
    float matrixCoverage = 1.0;
    vec3 matrixSide = vec3(0.0);
    float matrixSideWeight = 0.0;
    if (living > 0.0) {
      matrixGreen = vec3(0.72, 1.0, 0.8) * (0.72 + ndl * 0.28);
      matrixColor = matrixGreen;
      matrixBloom = 0.72;
    } else if (localSurface > 0.0) {
      matrixGreen = matrixColor = vec3(0.0);
      matrixBloom = 0.0;
    } else {
      float glow, tip, palette, sideMix, sideShade;
      float glyph = matrixGlyphAt(n, flow, glow, tip, palette, sideMix, sideShade);
      vec3 glyphBase = mix(vec3(24.0, 220.0, 74.0), vec3(70.0, 255.0, 112.0), palette) / 255.0;
      matrixGreen = matrixGlyphColor(glyphBase, glow, tip, 0.0, sideShade);
      matrixSide = matrixGlyphColor(glyphBase, glow, tip, 1.0, sideShade);
      matrixSideWeight = sideMix;
      matrixColor = matrixGreen;
      matrixCoverage = glyph;
      matrixBloom = glow * 0.9 + tip * 0.85;
    }
    // RGBA8 stores each covered voxel sample before MSAA resolves it. Clamp
    // color and bloom separately BEFORE coverage to preserve that same order.
    // Multiplying coverage first overfeeds bloom on partially covered hot tips.
    vec3 frontColor = clamp(mix(matrixColor, uFog, fog), 0.0, 1.0);
    vec3 sideColor = clamp(mix(matrixSide, uFog, fog), 0.0, 1.0);
    vec3 frontBright = clamp(matrixGreen * matrixBloom * (1.0 - fog), 0.0, 1.0);
    vec3 sideBright = clamp(matrixSide * matrixBloom * (1.0 - fog), 0.0, 1.0);
    matrixColorResult = mix(uFog * fog, mix(frontColor, sideColor, matrixSideWeight), matrixCoverage);
    matrixBrightResult = mix(frontBright, sideBright, matrixSideWeight) * matrixCoverage;
    if (front >= 1.0) {
      oColor = vec4(matrixColorResult, 1.0);
      oBright = vec4(matrixBrightResult, 1.0);
      return;
    }
  }
  // Negative instance glow is body heat; ordinary material emission remains
  // nonnegative. Keep color variation and directional shading in the embers.
  float ember = clamp(-vParams.x, 0.0, 1.0);
  float detail = 0.72 + dot(base, vec3(0.2126, 0.7152, 0.0722)) * 0.28;
  vec3 heat = vec3(1.0, 0.12 + ember * 0.85, 0.01 + ember * ember * ember * 0.74) * detail;
  base = mix(base, heat, ember * 0.9);
  float emissive = max(clamp(vColor.a * max(0.0, vParams.x), 0.0, 1.0), ember * 0.9);
  vec3 lightFactor = lightFactorAt(n);
  vec3 lit = base * lightFactor;
  vec3 col = mix(lit, base * 1.15, emissive);
  col = mix(col, vec3(1.0, 0.86, 0.45), vParams.y * 0.4);
  float tip = clamp(vParams.z, 0.0, 1.0) * (1.0 - step(1.5, vParams.z));
  col = mix(col, vec3(0.84, 1.0, 0.89), tip * 0.88);
  // Blend the two finished RGBA8 appearances, including their independent bloom.
  // Original emission fades out with the stone instead of surviving in Matrix
  // colors until the front becomes fully covered.
  vec3 normalColor = clamp(mix(col, uFog, fog), 0.0, 1.0);
  vec3 normalBright = clamp(col * (emissive * 0.9 + vParams.y * 0.5 + tip * 0.85) * (1.0 - fog), 0.0, 1.0);
  oColor = vec4(mix(normalColor, matrixColorResult, front), 1.0);
  oBright = vec4(mix(normalBright, matrixBrightResult, front), 1.0);
}`;
  const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 aM0;
layout(location=4) in vec4 aM1;
layout(location=5) in vec4 aM2;
layout(location=6) in vec4 aM3;
uniform mat4 uLightViewProj;
out float vWorldY;
void main() {
  vec4 world = mat4(aM0, aM1, aM2, aM3) * vec4(aPos, 1.0);
  vWorldY = world.y;
  gl_Position = uLightViewProj * world;
}`;
  const SHADOW_FS = `#version 300 es
precision highp float;
in float vWorldY;
uniform float uClipMinY;
uniform float uClipMaxY;
void main() {
  if (vWorldY < uClipMinY || vWorldY > uClipMaxY) discard;
}`;
  const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=2) in vec2 aSide;
layout(location=3) in vec4 aM0;
layout(location=4) in vec4 aM1;
layout(location=5) in vec4 aM2;
layout(location=6) in vec4 aM3;
layout(location=7) in vec4 aParams;
layout(location=8) in vec4 aColor;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uWidth;
out vec4 vColor;
out vec4 vParams;
void main() {
  mat4 m = uViewProj * mat4(aM0, aM1, aM2, aM3);
  vec4 ca = m * vec4(aA, 1.0);
  vec4 cb = m * vec4(aB, 1.0);
  vColor = aColor;
  vParams = aParams;
  vColor.rgb *= 1.0 - clamp(-aParams.y, 0.0, 1.0) * 0.88;
  vParams.y = max(0.0, aParams.y);
  if (ca.w < 0.05 && cb.w < 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (ca.w < 0.05) ca = mix(ca, cb, (0.05 - ca.w) / (cb.w - ca.w));
  if (cb.w < 0.05) cb = mix(cb, ca, (0.05 - cb.w) / (ca.w - cb.w));
  vec2 hv = uViewport * 0.5;
  vec2 sa = ca.xy / ca.w * hv;
  vec2 sb = cb.xy / cb.w * hv;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 0.0001 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = aSide.x < 0.5 ? ca : cb;
  vec2 off = nrm * aSide.y * uWidth * 0.5 / hv * c.w;
  gl_Position = vec4(c.xy + off, c.z, c.w);
}`;
  const LINE_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec4 vParams;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oBright;
void main() {
  float ember = clamp(-vParams.x, 0.0, 1.0);
  float detail = 0.72 + dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.28;
  vec3 heat = vec3(1.0, 0.12 + ember * 0.85, 0.01 + ember * ember * ember * 0.74) * detail;
  vec3 base = mix(vColor.rgb, heat, ember * 0.9);
  float glow = max(clamp(vColor.a * max(0.0, vParams.x), 0.0, 1.0), ember * 0.9);
  vec3 col = mix(base, vec3(1.0), glow * 0.35);
  oColor = vec4(col, 1.0);
  oBright = vec4(base * glow, 1.0);
}`;
  const MIRROR_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=3) in vec4 aM0;
layout(location=4) in vec4 aM1;
layout(location=5) in vec4 aM2;
layout(location=6) in vec4 aM3;
layout(location=7) in vec4 aParams;
layout(location=9) in vec3 aMirrorSource;
uniform mat4 uViewProj;
uniform mat4 uReflectionViewProj;
uniform mat4 uMirrorWorld;
uniform float uShard;
out vec4 vReflection;
out vec3 vWorld;
out vec2 vPortalUv;
out vec2 vMirrorLocal;
out vec2 vClipDepth;
flat out vec4 vReflectionX;
flat out vec4 vReflectionY;
flat out float vOpacity;
flat out vec3 vMirrorNormal;
void main() {
  mat4 model = mat4(aM0, aM1, aM2, aM3);
  vec4 world = model * vec4(aPos, 1.0);
  mat4 source = uShard > 0.5 ? uMirrorWorld : model;
  vec3 local = uShard > 0.5 ? aMirrorSource : aPos;
  vWorld = world.xyz;
  vReflection = uReflectionViewProj * source * vec4(local, 1.0);
  vReflectionX = uReflectionViewProj * vec4(source[0].xyz, 0.0);
  vReflectionY = uReflectionViewProj * vec4(source[1].xyz, 0.0);
  vMirrorLocal = local.xy;
  vPortalUv = vec2(local.x / 5.0 + 0.5, 1.0 - (local.y + 1.75) / 3.25);
  vOpacity = aParams.z < 0.0 ? -aParams.z - 1.0 : 1.0;
  vMirrorNormal = normalize(model[2].xyz);
  gl_Position = uViewProj * world;
  vClipDepth = gl_Position.zw;
  // Clip the aperture in x/y/w, preserving its physical depth for the fragment
  // shader. Clamping individual vertices to the near plane bends the pane and
  // even far-clips visible glass when a corner lies behind the eye.
  if (uShard < 0.5) gl_Position.z = 0.0;
}`;
  const MIRROR_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 vReflection;
in vec3 vWorld;
in vec2 vPortalUv;
in vec2 vMirrorLocal;
in vec2 vClipDepth;
flat in vec4 vReflectionX;
flat in vec4 vReflectionY;
flat in float vOpacity;
flat in vec3 vMirrorNormal;
uniform sampler2D uReflection;
uniform vec2 uReflectionScale;
uniform sampler2D uMatrixGlyphTex;
uniform vec3 uTint;
uniform float uPortal;
uniform float uReveal;
uniform int uRippleActive;
uniform float uRippleTime;
uniform vec4 uRipples[${BL.mirrorRipples.CAPACITY}];
uniform sampler2D uBodyField;
uniform vec4 uBodyBounds;
uniform vec2 uBodyTexel;
uniform int uBodyContacts;
uniform int uBodyActive;
uniform vec4 uBodyWaves[${BL.mirrorBody.CAPACITY}];
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oBright;
float rippleHash(int n) {
  uint x = uint(n);
  x ^= x >> 16;
  x *= 2146121005u;
  x ^= x >> 15;
  x *= 2221713035u;
  x ^= x >> 16;
  return float(x >> 8) / 16777216.0;
}
vec4 bodyField(vec2 uv, int layer) {
  uv = clamp(uv, uBodyTexel * 0.5, vec2(1.0) - uBodyTexel * 0.5);
  return texture(uBodyField, vec2(uv.x, (uv.y + float(layer)) / ${BL.mirrorBody.CAPACITY + 1}.0));
}
void main() {
  // The ratio cancels perspective interpolation, recovering the original
  // planar depth. Glass inside the near plane still closes the cave entrance.
  gl_FragDepth = clamp(0.5 * vClipDepth.x / vClipDepth.y + 0.5, 0.0, 1.0);
  if (vPortalUv.y > 1.0 - uReveal) discard;
  if (vOpacity < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy) & 3;
    int rank = ((pixel.x & 1) ^ (pixel.y & 1)) * 8 + (pixel.y & 1) * 4
      + (((pixel.x >> 1) & 1) ^ ((pixel.y >> 1) & 1)) * 2 + ((pixel.y >> 1) & 1);
    if ((float(rank) + 0.5) / 16.0 >= vOpacity) discard;
  }
  vec2 displacement = vec2(0.0);
  float ringLight = 0.0, glyphCrest = 0.0;
  vec2 pixelFootprint = max(fwidth(vMirrorLocal) / 0.021, vec2(0.001));
  if (uPortal < 0.5 && uRippleActive > 0) {
    for (int i = 0; i < ${BL.mirrorRipples.CAPACITY}; i++) {
      vec4 wave = uRipples[i];
      if (wave.w <= 0.0) continue;
      vec2 offset = vMirrorLocal - wave.xy;
      float distance = length(offset);
      float radius = ${BL.mirrorRipples.START_RADIUS.toFixed(6)} + wave.z * ${BL.mirrorRipples.SPEED.toFixed(6)};
      float phase = (distance - radius) / ${BL.mirrorRipples.WIDTH.toFixed(6)};
      if (phase > 3.0 || phase < -5.5) continue;
      float primary = exp(-phase * phase);
      float trailingPhase = phase + 2.5;
      float trailing = exp(-trailingPhase * trailingPhase) * 0.28;
      float slope = (primary * phase + trailing * trailingPhase) * wave.w;
      displacement += offset / max(distance, 0.0001) * slope * 0.045;
      ringLight += (primary - trailing) * wave.w * 0.055;
      glyphCrest = max(glyphCrest, primary * smoothstep(${BL.mirrorRipples.GLYPH_THRESHOLD.toFixed(6)}, 0.85, wave.w));
    }
  }
  if (uPortal < 0.5 && (uBodyContacts > 0 || uBodyActive > 0)) {
    vec2 bodyUv = (vMirrorLocal - uBodyBounds.xy) / uBodyBounds.zw;
    if (uBodyContacts > 0) {
      vec4 field = bodyField(bodyUv, 0);
      float distance = (field.r - 0.5) * ${(BL.mirrorBody.RANGE * 2).toFixed(6)};
      float phase = (distance - 0.02) / 0.075;
      float contact = exp(-phase * phase) * field.a;
      glyphCrest = max(glyphCrest, contact * (0.66 + 0.06 * sin(uRippleTime * 3.0 + vMirrorLocal.y * 4.0)));
      ringLight += contact * 0.022;
    }
    for (int i = 0; i < ${BL.mirrorBody.CAPACITY}; i++) {
      vec4 wave = uBodyWaves[i];
      if (wave.y <= 0.0) continue;
      vec4 field = bodyField(bodyUv, i + 1);
      float distance = (field.r - 0.5) * ${(BL.mirrorBody.RANGE * 2).toFixed(6)};
      float phase = (distance - wave.x * ${BL.mirrorBody.SPEED.toFixed(6)}) / ${BL.mirrorBody.WIDTH.toFixed(6)};
      if (phase > 3.0 || phase < -5.5 || field.a < 0.5) continue;
      float primary = exp(-phase * phase);
      float trailingPhase = phase + 2.5;
      float trailing = exp(-trailingPhase * trailingPhase) * 0.28;
      vec2 gradient = field.gb * 2.0 - 1.0;
      gradient /= max(length(gradient), 0.0001);
      displacement += gradient * (primary * phase + trailing * trailingPhase) * wave.y * 0.045;
      ringLight += (primary - trailing) * wave.y * 0.055;
      glyphCrest = max(glyphCrest, primary * smoothstep(0.55, 0.85, wave.y));
    }
  }
  displacement *= min(1.0, 0.035 / max(length(displacement), 0.0001));
  // Perturb in the mirror's own plane, then project. A fixed screen-space
  // offset would slide the water rings when the camera moves or looks obliquely.
  vec4 rippled = vReflection + vReflectionX * displacement.x + vReflectionY * displacement.y;
  vec2 projectedUv = (rippled.xy / rippled.w * 0.5 + 0.5) * uReflectionScale;
  vec2 uv = mix(projectedUv, vPortalUv, uPortal);
  vec3 reflected = texture(uReflection, uv).rgb;
  float sheen = pow(max(0.0, 1.0 - abs(fract((vWorld.x + vWorld.y) * 0.22) - 0.5) * 7.0), 5.0) * 0.08;
  vec3 color = mix(reflected, uTint, 0.1) + sheen + ringLight;
  if (glyphCrest > 0.0) {
    // The crest briefly reveals the same falling green streams as the cave,
    // including their moving cells, changing runes and bright leading tips.
    float grid = vMirrorLocal.x / 0.12;
    int stream = int(floor(grid));
    int train = 7 + int(floor(rippleHash(stream) * 6.0));
    int sequence = train + 2 + int(floor(rippleHash(stream + 41) * 5.0));
    float speed = 0.56 + rippleHash(stream + 19) * 0.64;
    float phase = rippleHash(stream + 73) * float(sequence) * 0.13;
    float movingGrid = (-vMirrorLocal.y - uRippleTime * speed - phase) / 0.13;
    int flowCell = int(floor(movingGrid));
    int position = flowCell % sequence;
    if (position < 0) position += sequence;
    if (position < train) {
      vec2 local = vec2((fract(grid) - 0.5) * 0.12, (0.5 - fract(movingGrid)) * 0.13);
      vec2 pixelCoord = vec2(local.x / 0.021 + 2.0, 3.0 - local.y / 0.021);
      ivec2 pixel = ivec2(floor(pixelCoord));
      if (pixel.x >= 0 && pixel.x < 4 && pixel.y >= 0 && pixel.y < 6) {
        int glyph = (abs(stream * 73 + flowCell * 151) + int(floor(uRippleTime * 20.0))) & 7;
        float mask = texelFetch(uMatrixGlyphTex, ivec2(glyph * 6 + 1 + pixel.x, 5 - pixel.y), 0).r;
        vec2 coverage = 1.0 - smoothstep(vec2(0.38) - pixelFootprint * 0.5, vec2(0.38) + pixelFootprint * 0.5, abs(fract(pixelCoord) - 0.5));
        float alpha = glyphCrest * mask * coverage.x * coverage.y * 0.82;
        float glow = (0.58 + rippleHash(stream + 101) * 0.36) * (0.48 + float(position + 1) / float(train) * 0.52);
        float tip = position == train - 1 ? 1.0 : position == train - 2 ? 0.55 : 0.0;
        vec3 base = (glyph & 1) == 0 ? vec3(24.0, 220.0, 74.0) : vec3(70.0, 255.0, 112.0);
        vec3 green = mix(base / 255.0 * mix(0.78, 1.15, glow), vec3(0.84, 1.0, 0.89), tip * 0.88);
        color = mix(color, green, alpha);
      }
    }
  }
  oColor = vec4(color, 1.0);
  oBright = vec4(0.0);
}`;
  const SHARD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
flat in vec3 vMirrorNormal;
flat in float vOpacity;
uniform samplerCube uEnvironment;
uniform vec3 uEye;
uniform vec3 uTint;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oBright;
void main() {
  if (vOpacity < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy) & 3;
    int rank = ((pixel.x & 1) ^ (pixel.y & 1)) * 8 + (pixel.y & 1) * 4
      + (((pixel.x >> 1) & 1) ^ ((pixel.y >> 1) & 1)) * 2 + ((pixel.y >> 1) & 1);
    if ((float(rank) + 0.5) / 16.0 >= vOpacity) discard;
  }
  vec3 direction = reflect(normalize(vWorld - uEye), normalize(vMirrorNormal));
  oColor = vec4(mix(texture(uEnvironment, direction).rgb, uTint, 0.04), 1.0);
  oBright = vec4(0.0);
}`;
  const QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 1.0, 1.0);
}`;
  const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform mat4 uInvViewProj;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform mat3 uStarMatrix;
uniform float uStars;
uniform float uTime;
uniform float uHazeDrop;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oBright;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(far.xyz / far.w);
  float hazeY = d.y + uHazeDrop;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.5, hazeY));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, 0.5, -hazeY));
  float sd = max(dot(d, uSunDir), 0.0);
  float sunDisc = pow(sd, 600.0) * (1.0 - uStars);
  vec3 sun = uSun * (sunDisc + pow(sd, 6.0) * 0.18 * (1.0 - uStars));
  float moonDisc = smoothstep(0.9985, 0.999, dot(d, uMoonDir)) * uStars;
  vec3 moon = vec3(0.82, 0.88, 1.0) * moonDisc;
  vec3 stars = vec3(0.0);
  if (uStars > 0.002) {
    vec3 starD = normalize(uStarMatrix * d);
    vec3 a = abs(starD);
    vec2 f;
    float face;
    if (a.x >= a.y && a.x >= a.z) { f = starD.yz / a.x; face = starD.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { f = starD.xz / a.y; face = starD.y > 0.0 ? 2.0 : 3.0; }
    else { f = starD.xy / a.z; face = starD.z > 0.0 ? 4.0 : 5.0; }
    f = (f * 0.5 + 0.5) * 48.0;
    vec2 cell = floor(f) + face * 97.0;
    float h = hash(cell);
    if (h < 0.14) {
      float h2 = hash(cell + 17.3);
      float h3 = hash(cell + 41.7);
      float r = 0.12 + h2 * 0.18;
      float pt = 1.0 - smoothstep(0.0, r, length(fract(f) - 0.5));
      float twinkle = 0.75 + 0.25 * sin(uTime * (2.0 + h3 * 3.0) + h3 * 6.28);
      float s = pt * (0.5 + 0.5 * h2) * twinkle * uStars * smoothstep(-0.05, 0.15, hazeY);
      stars = mix(vec3(1.0), vec3(0.75, 0.85, 1.0), h3) * s;
    }
  }
  oColor = vec4(col + sun + moon + stars, 1.0);
  oBright = vec4(uSun * sunDisc * 0.6 + moon * 0.5 + stars * 0.35, 1.0);
}`;
  const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
out vec4 oColor;
void main() {
  float w[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec3 sum = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i);
    sum += texture(uTex, vUv + o).rgb * w[i];
    sum += texture(uTex, vUv - o).rgb * w[i];
  }
  oColor = vec4(sum, 1.0);
}`;
  const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
out vec4 oColor;
void main() {
  vec3 col = texture(uScene, vUv).rgb + texture(uBloom, vUv).rgb * uBloomStrength;
  oColor = vec4(col, 1.0);
}`;
  const isSupported = () => {
    try {
      const probe = document.createElement("canvas");
      return !!probe.getContext("webgl2");
    } catch {
      return false;
    }
  };
  const createRenderer = (canvas, { quality = "high" } = {}) => {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 unavailable");
    // Hoisted so the per-frame resolve allocates no draw-buffer arrays
    const DRAW_COLOR = [gl.COLOR_ATTACHMENT0, gl.NONE];
    const DRAW_BRIGHT = [gl.NONE, gl.COLOR_ATTACHMENT1];
    const DRAW_BOTH = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];
    let settings = QUALITY[quality] || QUALITY.high;
    let qualityName = QUALITY[quality] ? quality : "high";
    let width = 0, height = 0, dpr = 1, pw = 0, ph = 0;
    let lost = false;
    const size = { width: 0, height: 0 };
    const view = mat4.create();
    const proj = mat4.create();
    const viewProj = mat4.create();
    const lightView = mat4.create();
    const lightProj = mat4.create();
    const lightViewProj = mat4.create();
    const P4 = new Float32Array(4);
    const MIRROR_POINT = new Float32Array(3);
    const MIRROR_CLIP = new Float32Array(4);
    const MIRROR_RECT = new Float32Array(4);
    const mirrorView = mat4.create();
    const mirrorProj = mat4.create();
    const mirrorViewProj = mat4.create();
    const mirrorCapturedViewProj = mat4.create();
    const invViewProj = mat4.create();
    const mirrorInvViewProj = mat4.create();
    const FRUSTUM = new Float32Array(24), LIGHT_FRUSTUM = new Float32Array(24), MIRROR_FRUSTUM = new Float32Array(24);
    const CENTER = new Float32Array(3);
    let culled = 0, drawn = 0, suppressed = 0, shadowPassCount = 0;
    const mirrorEye = { x: 0, y: 0, z: 0 };
    const mirrorTarget = { x: 0, y: 0, z: 0 };
    const mirrorUp = { x: 0, y: 1, z: 0 };
    const records = new Map();
    const activeRecords = [];
    const res = { programs: {}, fbo: null, shadow: null, bloom: null, quadVao: null, matrixTexture: null };
    const mirror = { node: null, record: null, geometry: null, program: null, programReady: false, fb: null, tex: null, depth: null, width: 0, height: 0, renderWidth: 0, renderHeight: 0, portal: false, reveal: 0, frontFacing: false, walkThrough: false, captureValid: false, bodyTex: null, bodyState: null, bodyVersion: -1, shards: 0 };
    const environment = { program: null, ready: false, fb: null, tex: null, depth: null, size: 0, next: 0, valid: 0, frame: 0, origin: new Float32Array(3) };
    const mirrorDebug = {
      active: false, faux: false, portal: false, reveal: 0, surfaceDrawn: false, captureValid: false, width: 0, height: 0, textureWidth: 0, textureHeight: 0, samples: 0, allocationCount: 0, reflectionPassCount: 0, skippedPassCount: 0, resources: 0, captureExcluded: false, reflectionOnlyCount: 0, planeDistance: 0, ripples: 0, bodyContacts: 0, bodyWaves: 0,
      cameraPosition: new Float32Array(3), cameraTarget: new Float32Array(3), planeCenter: new Float32Array(3), planeNormal: new Float32Array(3), capturedViewProj: mirrorCapturedViewProj, shardsDrawn: 0, environmentPassCount: 0, environmentFaces: 0, environmentSize: 0, environmentResources: 0, skipReason: "none"
    };
    // Compile without blocking, ready flips once linked
    let parallel = null;
    let ready = false;
    let failure = null;
    const compile = (vs, fs, uniforms) => {
      const make = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        return sh;
      };
      const prog = gl.createProgram();
      const v = make(gl.VERTEX_SHADER, vs), f = make(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(prog, v);
      gl.attachShader(prog, f);
      gl.linkProgram(prog);
      return { prog, shaders: [v, f], uniforms, u: {}, clipMinY: NaN, clipMaxY: NaN };
    };
    const finishProgram = (p) => {
      if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
        const logs = p.shaders.map((sh) => gl.getShaderInfoLog(sh)).filter(Boolean).join("\n");
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(p.prog)} ${logs}`);
      }
      for (const sh of p.shaders) gl.deleteShader(sh);
      p.shaders = [];
      for (const name of p.uniforms) p.u[name] = gl.getUniformLocation(p.prog, name);
    };
    const destroyMirrorProgram = () => {
      const p = mirror.program;
      if (!p) return;
      for (const sh of p.shaders) gl.deleteShader(sh);
      gl.deleteProgram(p.prog);
      mirror.program = null;
      mirror.programReady = false;
      mirrorDebug.resources--;
    };
    const ensureMirrorProgram = () => {
      if (!mirror.program) {
        mirror.program = compile(MIRROR_VS, MIRROR_FS, ["uViewProj", "uReflectionViewProj", "uMirrorWorld", "uShard", "uReflection", "uReflectionScale", "uTint", "uPortal", "uReveal", "uMatrixGlyphTex", "uRippleActive", "uRippleTime", "uRipples", "uBodyField", "uBodyBounds", "uBodyTexel", "uBodyContacts", "uBodyActive", "uBodyWaves"]);
        mirrorDebug.resources++;
      }
      if (mirror.programReady) return true;
      if (parallel && !gl.getProgramParameter(mirror.program.prog, parallel.COMPLETION_STATUS_KHR)) return false;
      finishProgram(mirror.program);
      mirror.programReady = true;
      return true;
    };
    const buildPrograms = () => {
      ready = false;
      failure = null;
      const matrixSampling = gl.getExtension("OES_shader_multisample_interpolation");
      const meshFragment = matrixSampling ? MESH_FS.replace("#version 300 es", "#version 300 es\n#extension GL_OES_shader_multisample_interpolation : require\n#define MATRIX_SAMPLE_INTERPOLATION") : MESH_FS;
      res.programs = {
        mesh: compile(MESH_VS, meshFragment, ["uViewProj", "uLightViewProj", "uEye", "uLightDir", "uSky", "uGround", "uSun", "uDirectStrength", "uAmbientFloor", "uDiffuseFloor", "uShadowStrength", "uShadowFloor", "uShadowBias", "uShadow", "uShadowTexel", "uLights", "uLightCount", "uFog", "uFogRange", "uMatrixParams", "uMatrixOrigin", "uMatrixGlyph", "uMatrixCave", "uMatrixCaves", "uMatrixCaveBounds", "uMatrixCaveNear", "uMatrixPermanentCave", "uMatrixPermanentPlane", "uMatrixPermanentAperture", "uMatrixLivingGlobal", "uMatrixGlyphTex", "uMatrixSamples", "uClipMinY", "uClipMaxY", "uMatrixGlyphOpacity"]),
        shadow: compile(SHADOW_VS, SHADOW_FS, ["uLightViewProj", "uClipMinY", "uClipMaxY"]),
        line: compile(LINE_VS, LINE_FS, ["uViewProj", "uViewport", "uWidth"]),
        sky: compile(QUAD_VS, SKY_FS, ["uInvViewProj", "uHorizon", "uZenith", "uSun", "uSunDir", "uMoonDir", "uStarMatrix", "uStars", "uTime", "uHazeDrop"]),
        blur: compile(QUAD_VS, BLUR_FS, ["uTex", "uDir"]),
        composite: compile(QUAD_VS, COMPOSITE_FS, ["uScene", "uBloom", "uBloomStrength"])
      };
      res.quadVao = gl.createVertexArray();
    };
    const pollPrograms = () => {
      if (ready || failure) return ready;
      const list = Object.values(res.programs);
      if (parallel && !list.every((p) => gl.getProgramParameter(p.prog, parallel.COMPLETION_STATUS_KHR))) return false;
      try {
        for (const p of list) finishProgram(p);
        ready = true;
      } catch (err) {
        failure = err;
      }
      return ready;
    };
    const createTexture = (w, h, internal, filter) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const buildMatrixTexture = () => {
      const width = 48, height = 7, data = new Uint8Array(width * height);
      for (let glyph = 0; glyph < MATRIX_MASKS.length; glyph++) {
        const mask = MATRIX_MASKS[glyph];
        for (let bit = 0; bit < 24; bit++) {
          if (!((mask >> bit) & 1)) continue;
          const x = glyph * 6 + 1 + (bit & 3), y = 5 - (bit >> 2);
          data[y * width + x] = 255;
        }
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, height);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      res.matrixTexture = tex;
    };
    const bindMatrixTexture = (program) => {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, res.matrixTexture);
      gl.uniform1i(program.u.uMatrixGlyphTex, 3);
      gl.activeTexture(gl.TEXTURE0);
    };
    const createRenderbuffer = (w, h, internal, samples) => {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, w, h);
      else gl.renderbufferStorage(gl.RENDERBUFFER, internal, w, h);
      return rb;
    };
    const destroyMirrorTarget = () => {
      if (!mirror.fb) return;
      gl.deleteTexture(mirror.tex);
      gl.deleteRenderbuffer(mirror.depth);
      gl.deleteFramebuffer(mirror.fb);
      mirror.captureValid = mirrorDebug.captureValid = false;
      mirrorDebug.resources -= 3;
      mirror.fb = mirror.tex = mirror.depth = null;
      mirror.width = mirror.height = mirror.renderWidth = mirror.renderHeight = 0;
      mirrorDebug.width = mirrorDebug.height = mirrorDebug.textureWidth = mirrorDebug.textureHeight = mirrorDebug.samples = 0;
    };
    const destroyEnvironment = () => {
      if (!environment.fb) return;
      gl.deleteTexture(environment.tex);
      gl.deleteRenderbuffer(environment.depth);
      gl.deleteFramebuffer(environment.fb);
      environment.fb = environment.tex = environment.depth = null;
      environment.size = environment.valid = environment.next = environment.frame = 0;
      mirrorDebug.environmentFaces = mirrorDebug.environmentSize = mirrorDebug.environmentResources = 0;
      mirrorDebug.resources -= 3;
    };
    const ensureEnvironment = (clear) => {
      if (environment.size === settings.environment) return;
      destroyEnvironment();
      const size = environment.size = settings.environment;
      environment.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, environment.tex);
      for (let face = 0; face < 6; face++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      environment.depth = createRenderbuffer(size, size, gl.DEPTH_COMPONENT24, 0);
      environment.fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, environment.fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, environment.depth);
      gl.drawBuffers(DRAW_COLOR);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      for (let face = 0; face < 6; face++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, environment.tex, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      mirrorDebug.resources += 3;
      mirrorDebug.environmentResources = 3;
      mirrorDebug.environmentSize = size;
      mirrorDebug.allocationCount++;
    };
    // One square allocation survives camera motion and viewport resizes. Each
    // capture uses only the mirror's current projected footprint inside it.
    const ensureMirrorTarget = () => {
      const cap = settings.mirror;
      const w = cap, h = cap;
      if (mirror.fb && mirror.width === w && mirror.height === h) return;
      destroyMirrorTarget();
      mirror.tex = createTexture(w, h, gl.RGBA8, gl.LINEAR);
      mirror.depth = createRenderbuffer(w, h, gl.DEPTH_COMPONENT24, 0);
      mirror.fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, mirror.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mirror.tex, 0);
      mirrorDebug.resources += 3;
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, mirror.depth);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      mirror.width = mirrorDebug.textureWidth = w;
      mirror.height = mirrorDebug.textureHeight = h;
      mirrorDebug.samples = 0;
      mirrorDebug.allocationCount++;
    };
    const destroyMirror = () => {
      destroyEnvironment();
      if (environment.program) {
        for (const shader of environment.program.shaders) gl.deleteShader(shader);
        gl.deleteProgram(environment.program.prog);
        environment.program = null;
        environment.ready = false;
        mirrorDebug.resources--;
      }
      destroyMirrorTarget();
      destroyMirrorProgram();
      if (mirror.bodyTex) {
        gl.deleteTexture(mirror.bodyTex);
        mirrorDebug.resources--;
      }
      mirror.bodyTex = mirror.bodyState = null;
      mirror.bodyVersion = -1;
      mirror.node = mirror.record = mirror.geometry = null;
      mirror.portal = mirror.frontFacing = mirror.walkThrough = false;
      mirrorDebug.active = false;
      mirrorDebug.portal = false;
      mirrorDebug.surfaceDrawn = false;
      mirrorDebug.captureExcluded = false;
      mirrorDebug.reflectionOnlyCount = 0;
      mirrorDebug.ripples = 0;
      mirrorDebug.bodyContacts = mirrorDebug.bodyWaves = 0;
      mirror.shards = mirrorDebug.shardsDrawn = 0;
    };
    const forgetMirror = () => {
      environment.program = null;
      environment.ready = false;
      environment.fb = environment.tex = environment.depth = null;
      environment.size = environment.valid = environment.next = environment.frame = 0;
      mirrorDebug.environmentFaces = mirrorDebug.environmentSize = mirrorDebug.environmentResources = 0;
      mirror.node = mirror.record = mirror.geometry = mirror.program = mirror.fb = mirror.tex = mirror.depth = mirror.bodyTex = mirror.bodyState = null;
      mirror.bodyVersion = -1;
      mirror.programReady = false;
      mirror.width = mirror.height = mirror.renderWidth = mirror.renderHeight = 0;
      mirrorDebug.width = mirrorDebug.height = mirrorDebug.textureWidth = mirrorDebug.textureHeight = mirrorDebug.samples = 0;
      mirror.portal = mirror.frontFacing = mirror.walkThrough = mirror.captureValid = false;
      mirrorDebug.active = false;
      mirrorDebug.portal = mirrorDebug.captureValid = false;
      mirrorDebug.surfaceDrawn = false;
      mirrorDebug.captureExcluded = false;
      mirrorDebug.reflectionOnlyCount = 0;
      mirrorDebug.ripples = 0;
      mirrorDebug.bodyContacts = mirrorDebug.bodyWaves = 0;
      mirrorDebug.resources = 0;
      mirror.shards = mirrorDebug.shardsDrawn = 0;
    };
    const destroyFbo = () => {
      const f = res.fbo;
      if (!f) return;
      for (const t of f.textures) gl.deleteTexture(t);
      for (const r of f.renderbuffers) gl.deleteRenderbuffer(r);
      for (const b of f.framebuffers) gl.deleteFramebuffer(b);
      res.fbo = null;
    };
    const buildFbo = () => {
      destroyFbo();
      const samples = Math.min(settings.msaa, gl.getParameter(gl.MAX_SAMPLES));
      const f = { textures: [], renderbuffers: [], framebuffers: [], samples };
      f.color = createTexture(pw, ph, gl.RGBA8, gl.LINEAR);
      f.bright = createTexture(pw, ph, gl.RGBA8, gl.LINEAR);
      f.textures.push(f.color, f.bright);
      f.resolve = gl.createFramebuffer();
      f.framebuffers.push(f.resolve);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.resolve);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.color, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, f.bright, 0);
      if (samples > 0) {
        f.scene = gl.createFramebuffer();
        f.framebuffers.push(f.scene);
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.scene);
        const c0 = createRenderbuffer(pw, ph, gl.RGBA8, samples);
        const c1 = createRenderbuffer(pw, ph, gl.RGBA8, samples);
        const d = createRenderbuffer(pw, ph, gl.DEPTH_COMPONENT24, samples);
        f.renderbuffers.push(c0, c1, d);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.RENDERBUFFER, c1);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      } else {
        f.scene = f.resolve;
        const d = createRenderbuffer(pw, ph, gl.DEPTH_COMPONENT24, 0);
        f.renderbuffers.push(d);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.scene);
      gl.drawBuffers(DRAW_BOTH);
      const bw = Math.max(1, pw >> 2), bh = Math.max(1, ph >> 2);
      f.bloomW = bw;
      f.bloomH = bh;
      f.ping = [];
      for (let i = 0; i < 2; i++) {
        const tex = createTexture(bw, bh, gl.RGBA8, gl.LINEAR);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        f.textures.push(tex);
        f.framebuffers.push(fb);
        f.ping.push({ tex, fb });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      res.fbo = f;
    };
    const destroyShadow = () => {
      const s = res.shadow;
      if (!s) return;
      gl.deleteTexture(s.tex);
      gl.deleteFramebuffer(s.fb);
      res.shadow = null;
    };
    const buildShadow = () => {
      destroyShadow();
      const size = settings.shadow;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      res.shadow = { tex, fb, size };
    };
    const deleteRecord = (rec) => {
      if (rec.active) {
        const index = activeRecords.indexOf(rec);
        if (index >= 0) activeRecords.splice(index, 1);
        rec.active = false;
      }
      if (rec.mesh) {
        gl.deleteVertexArray(rec.mesh.vao);
        gl.deleteBuffer(rec.mesh.vbo);
      }
      if (rec.line) {
        gl.deleteVertexArray(rec.line.vao);
        gl.deleteBuffer(rec.line.vbo);
      }
      gl.deleteBuffer(rec.ibo);
      rec.nodes.length = 0;
      rec.batch = null;
      rec.data = null;
    };
    const destroyRecords = () => {
      for (const rec of records.values()) deleteRecord(rec);
      records.clear();
      activeRecords.length = 0;
    };
    const bindInstanceAttribs = (ibo) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
      for (let i = 0; i < 5; i++) {
        const loc = 3 + i;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, i * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
    };
    const makePart = (data, floatsPerVertex, layout, ibo) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      let offset = 0;
      for (const [loc, size] of layout) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, floatsPerVertex * 4, offset * 4);
        offset += size;
      }
      bindInstanceAttribs(ibo);
      gl.bindVertexArray(null);
      return { vao, vbo, count: data.length / floatsPerVertex };
    };
    const buildMeshPart = (geometry, ibo) => {
      const { verts, faces } = geometry;
      let triCount = 0;
      for (const f of faces) triCount += f.i.length - 2;
      if (!triCount) return null;
      const source = geometry.mirrorSource, stride = source ? MESH_STRIDE + 3 : MESH_STRIDE;
      const out = new Float32Array(triCount * 3 * stride);
      let o = 0;
      const put = (idx, nx, ny, nz, c, e) => {
        const b = idx * 3;
        out[o++] = verts[b];
        out[o++] = verts[b + 1];
        out[o++] = verts[b + 2];
        out[o++] = nx;
        out[o++] = ny;
        out[o++] = nz;
        out[o++] = c[0] / 255;
        out[o++] = c[1] / 255;
        out[o++] = c[2] / 255;
        out[o++] = e;
        if (source) { out[o++] = source[b]; out[o++] = source[b + 1]; out[o++] = source[b + 2]; }
      };
      for (const f of faces) {
        // Newell's method, stable when leading vertices coincide
        let nx = 0, ny = 0, nz = 0;
        for (let k = 0, m = f.i.length; k < m; k++) {
          const a = f.i[k] * 3, b = f.i[(k + 1) % m] * 3;
          nx += (verts[a + 1] - verts[b + 1]) * (verts[a + 2] + verts[b + 2]);
          ny += (verts[a + 2] - verts[b + 2]) * (verts[a] + verts[b]);
          nz += (verts[a] - verts[b]) * (verts[a + 1] + verts[b + 1]);
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        const emissive = f.emissive || 0;
        const e = f.matrixCave || f.matrixLocalGlyphSurface || f.matrixWorldGlyphSurface || f.matrixPermanentFallback ? -1 - (f.matrixCave || 0) * 2 - (f.matrixWorldGlyphSurface ? 32 : 0) - (f.matrixPermanentFallback ? 64 : 0) - emissive : emissive;
        for (let k = 1; k < f.i.length - 1; k++) {
          put(f.i[0], nx, ny, nz, f.color, e);
          put(f.i[k], nx, ny, nz, f.color, e);
          put(f.i[k + 1], nx, ny, nz, f.color, e);
        }
      }
      return makePart(out, stride, source ? [[0, 3], [1, 3], [2, 4], [9, 3]] : [[0, 3], [1, 3], [2, 4]], ibo);
    };
    const LINE_CORNERS = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
    const buildLinePart = (geometry, ibo) => {
      const { verts, lines } = geometry;
      if (!lines || !lines.length) return null;
      const out = new Float32Array(lines.length * 6 * LINE_STRIDE);
      let o = 0;
      for (const l of lines) {
        const a = l.i[0] * 3, b = l.i[1] * 3;
        for (const [end, side] of LINE_CORNERS) {
          out[o++] = verts[a];
          out[o++] = verts[a + 1];
          out[o++] = verts[a + 2];
          out[o++] = verts[b];
          out[o++] = verts[b + 1];
          out[o++] = verts[b + 2];
          out[o++] = end;
          out[o++] = side;
          out[o++] = l.color[0] / 255;
          out[o++] = l.color[1] / 255;
          out[o++] = l.color[2] / 255;
          out[o++] = l.emissive || 0;
        }
      }
      const part = makePart(out, LINE_STRIDE, [[0, 3], [1, 3], [2, 2], [8, 4]], ibo);
      part.width = geometry.lineWidth || 1.5;
      return part;
    };
    const recordFor = (geometry) => {
      let rec = records.get(geometry);
      if (!rec) {
        const ibo = gl.createBuffer();
        rec = { geometry, ibo, capacity: 0, mesh: buildMeshPart(geometry, ibo), line: buildLinePart(geometry, ibo), nodes: [], count: 0, drawCount: 0, cameraHiddenCount: 0, active: false, data: null, batch: null, batchVersion: -1, lightVisible: true, mirrorVisible: true };
        records.set(geometry, rec);
      }
      return rec;
    };
    // Gribb-Hartmann planes of a column-major view-projection: left, right, bottom, top, near, far
    const extractFrustum = (m, planes = FRUSTUM) => {
      for (let i = 0; i < 6; i++) {
        const row = i >> 1, sign = i & 1 ? -1 : 1, o = i * 4;
        const a = m[3] + sign * m[row], b = m[7] + sign * m[4 + row], c = m[11] + sign * m[8 + row], d = m[15] + sign * m[12 + row];
        const len = Math.hypot(a, b, c) || 1;
        planes[o] = a / len;
        planes[o + 1] = b / len;
        planes[o + 2] = c / len;
        planes[o + 3] = d / len;
      }
    };
    const sphereInFrustum = (x, y, z, r, planes = FRUSTUM) => {
      for (let i = 0; i < 24; i += 4) {
        if (planes[i] * x + planes[i + 1] * y + planes[i + 2] * z + planes[i + 3] < -r) return false;
      }
      return true;
    };
    // The camera, shadow and mirror passes all test the same world sphere, so
    // collect computes it once onto the node and they each just dot the planes.
    const writeCullSphere = (node) => {
      const b = boundsOf(node.geometry), w = node.world;
      mat4.transformPoint(CENTER, w, b.center[0], b.center[1], b.center[2]);
      const scale = Math.max(w[0] * w[0] + w[1] * w[1] + w[2] * w[2], w[4] * w[4] + w[5] * w[5] + w[6] * w[6], w[8] * w[8] + w[9] * w[9] + w[10] * w[10]);
      node.cullX = CENTER[0];
      node.cullY = CENTER[1];
      node.cullZ = CENTER[2];
      node.cullR = b.radius * Math.sqrt(scale) + CULL_MARGIN;
    };
    const nodeInFrustum = (node, planes) => sphereInFrustum(node.cullX, node.cullY, node.cullZ, node.cullR, planes);
    // The shadow map and the mirror capture draw every instance of a record.
    // A record wholly outside that pass's clip volume writes no depth and no
    // pixels there, so it skips the draw call; partial records draw in full.
    const markLightVisible = () => {
      for (const rec of activeRecords) {
        if (rec.geometry.castShadow === false) continue;
        const sphere = rec.batch && rec.batch.cullSphere;
        let visible = rec.batch ? !sphere || sphereInFrustum(sphere[0], sphere[1], sphere[2], sphere[3] + CULL_MARGIN, LIGHT_FRUSTUM) : false;
        for (let i = 0; !rec.batch && !visible && i < rec.count; i++) visible = nodeInFrustum(rec.nodes[i], LIGHT_FRUSTUM);
        rec.lightVisible = visible;
      }
    };
    const markMirrorVisible = () => {
      for (const rec of activeRecords) {
        const sphere = rec.batch && rec.batch.cullSphere;
        let visible = rec.batch ? !sphere || sphereInFrustum(sphere[0], sphere[1], sphere[2], sphere[3] + CULL_MARGIN, MIRROR_FRUSTUM) : false;
        for (let i = 0; !rec.batch && !visible && i < rec.count; i++) visible = nodeInFrustum(rec.nodes[i], MIRROR_FRUSTUM);
        rec.mirrorVisible = visible;
      }
    };
    const collect = (node) => {
      if (!node.geometry) return;
      if (node.mirror || node.mirrorPortal) {
        if (mirror.node) throw new Error("A scene may contain at most one mirror node");
        mirror.node = node;
        mirror.geometry = node.geometry;
        mirror.portal = !!node.mirrorPortal;
        mirror.reveal = Math.max(0, Math.min(1, node.mirrorReveal || 0));
        mirror.walkThrough = !!node.mirrorWalkThrough;
        mirrorDebug.active = true;
        mirrorDebug.portal = mirror.portal;
        mirrorDebug.reveal = mirror.reveal;
      }
      const rec = recordFor(node.geometry);
      if (node.mirror || node.mirrorPortal) mirror.record = rec;
      if (!rec.active) {
        rec.active = true;
        rec.count = 0;
        rec.drawCount = 0;
        rec.cameraHiddenCount = 0;
        activeRecords.push(rec);
      }
      if (node.instanceData) {
        rec.batch = node;
        rec.count = node.instanceCount;
        rec.drawCount = node.drawInstanceCount === undefined ? rec.count : Math.max(0, Math.min(rec.count, node.drawInstanceCount));
        suppressed += rec.count - rec.drawCount;
        rec.offscreen = !!node.cullSphere && !sphereInFrustum(node.cullSphere[0], node.cullSphere[1], node.cullSphere[2], node.cullSphere[3] + CULL_MARGIN);
        return;
      }
      // In-frustum nodes stay in front of the culled ones by swapping into the draw region
      const idx = rec.count++;
      rec.nodes[idx] = node;
      // Camera-hidden nodes still cast shadows and appear in the mirror
      writeCullSphere(node);
      if (node.smokeOpacity === 0 || hiddenFromCamera(node)) {
        rec.cameraHiddenCount++;
        suppressed++;
      } else if (nodeInFrustum(node, FRUSTUM)) {
        rec.nodes[idx] = rec.nodes[rec.drawCount];
        rec.nodes[rec.drawCount++] = node;
      } else culled++;
    };
    const uploadInstances = (rec) => {
      const need = rec.count * INSTANCE_FLOATS;
      if (rec.batch) {
        // A reserved pool that has never held an instance owns no GPU memory
        // until it does: empty cave batches cost nothing until the wave arrives.
        if (!need && !rec.capacity) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, rec.ibo);
        // Fixed-capacity systems reserve their bounded upload once; variable batches grow geometrically.
        const cap = rec.batch.fixedInstanceCapacity ? rec.batch.instanceData.length : Math.min(rec.batch.instanceData.length, Math.max(need, rec.capacity * 2));
        if (rec.capacity < cap) {
          gl.bufferData(gl.ARRAY_BUFFER, cap * 4, gl.DYNAMIC_DRAW);
          rec.capacity = cap;
          rec.batchVersion = -1;
        }
        if (rec.batchVersion !== rec.batch.instanceVersion) {
          // WebGL treats a zero source length as "the rest of the array". Empty
          // cave batches must not upload their whole reserved pool on restore.
          if (need > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, rec.batch.instanceData, 0, need);
          rec.batchVersion = rec.batch.instanceVersion;
        }
        return;
      }
      if (!rec.data || rec.data.length < need) {
        rec.data = new Float32Array(Math.max(need, (rec.data ? rec.data.length : 0) * 2, INSTANCE_FLOATS));
      }
      // The buffer mirrors rec.data exactly, so an unchanged block (static
      // props, resting crew) needs no upload this frame.
      const d = rec.data;
      // One moving node in a shared record uploads only its own span
      let lo = need, hi = 0;
      for (let i = 0; i < rec.count; i++) {
        const n = rec.nodes[i], w = n.world;
        const o = i * INSTANCE_FLOATS;
        let dirty = false;
        for (let j = 0; j < 16; j++) if (d[o + j] !== w[j]) { d[o + j] = w[j]; dirty = true; }
        // Preserve fire and smoke parameters in the cached Float32 upload.
        const glow = Math.fround(n.ember > 0 ? -n.ember : n.glow), highlight = Math.fround(n.scorch > 0 ? -n.scorch : n.highlight);
        const mode = Math.fround(n.smokeOpacity === undefined ? matrixModeOf(n) : -1 - n.smokeOpacity);
        if (d[o + 16] !== glow) { d[o + 16] = glow; dirty = true; }
        if (d[o + 17] !== highlight) { d[o + 17] = highlight; dirty = true; }
        if (d[o + 18] !== mode) { d[o + 18] = mode; dirty = true; }
        d[o + 19] = 0;
        if (dirty) {
          if (o < lo) lo = o;
          if (o + INSTANCE_FLOATS > hi) hi = o + INSTANCE_FLOATS;
        }
      }
      if (rec.capacity < d.length) {
        gl.bindBuffer(gl.ARRAY_BUFFER, rec.ibo);
        gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
        rec.capacity = d.length;
      } else if (hi > lo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, rec.ibo);
        gl.bufferSubData(gl.ARRAY_BUFFER, lo * 4, d, lo, hi - lo);
      }
    };
    const skipMirrorPass = (reason) => {
      mirrorDebug.skippedPassCount++;
      mirrorDebug.skipReason = reason;
      return false;
    };
    const reflectMirrorPoint = (out, point, center, normal) => {
      const d = (point.x - center[0]) * normal[0] + (point.y - center[1]) * normal[1] + (point.z - center[2]) * normal[2];
      out.x = point.x - 2 * d * normal[0];
      out.y = point.y - 2 * d * normal[1];
      out.z = point.z - 2 * d * normal[2];
    };
    // NDC bounds of the mirror's vertices under a view-projection, false when none lie in front
    const mirrorRect = (node, vp) => {
      const verts = (node.mirrorCaptureGeometry || node.geometry).verts, world = node.world;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, behind = false;
      for (let i = 0; i < verts.length; i += 3) {
        mat4.transformPoint(MIRROR_POINT, world, verts[i], verts[i + 1], verts[i + 2]);
        mat4.transformPoint4(MIRROR_CLIP, vp, MIRROR_POINT[0], MIRROR_POINT[1], MIRROR_POINT[2]);
        if (MIRROR_CLIP[3] <= MIRROR_EPSILON) { behind = true; continue; }
        const x = MIRROR_CLIP[0] / MIRROR_CLIP[3], y = MIRROR_CLIP[1] / MIRROR_CLIP[3];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (minX === Infinity) return false;
      // An aperture crossing the eye plane can cover the viewport even when
      // its surviving vertices and centre are offscreen. Keep that capture
      // conservatively full-size instead of freezing the previous reflection.
      if (behind) { minX = minY = -1; maxX = maxY = 1; }
      MIRROR_RECT[0] = minX;
      MIRROR_RECT[1] = minY;
      MIRROR_RECT[2] = maxX;
      MIRROR_RECT[3] = maxY;
      return true;
    };
    const updateMirrorSide = (camera) => {
      if (!mirror.walkThrough) return;
      const world = mirror.node.world, center = mirrorDebug.planeCenter, normal = mirrorDebug.planeNormal;
      center[0] = world[12];
      center[1] = world[13];
      center[2] = world[14];
      const nlen = Math.hypot(world[8], world[9], world[10]) || 1;
      normal[0] = world[8] / nlen;
      normal[1] = world[9] / nlen;
      normal[2] = world[10] / nlen;
      const cameraSide = (camera.position.x - center[0]) * normal[0] + (camera.position.y - center[1]) * normal[1] + (camera.position.z - center[2]) * normal[2];
      mirror.frontFacing = cameraSide > MIRROR_EPSILON;
      mirrorDebug.planeDistance = Math.abs(cameraSide);
      mirror.portal = !!mirror.node.mirrorPortal;
      mirror.reveal = Math.max(0, Math.min(1, mirror.node.mirrorReveal || 0));
      mirrorDebug.portal = mirror.portal;
      mirrorDebug.reveal = mirror.reveal;
    };
    const prepareMirrorCamera = (camera) => {
      const node = mirror.node, world = node.world, center = mirrorDebug.planeCenter, normal = mirrorDebug.planeNormal;
      center[0] = world[12];
      center[1] = world[13];
      center[2] = world[14];
      const nlen = Math.hypot(world[8], world[9], world[10]) || 1;
      normal[0] = world[8] / nlen;
      normal[1] = world[9] / nlen;
      normal[2] = world[10] / nlen;
      const cameraSide = (camera.position.x - center[0]) * normal[0] + (camera.position.y - center[1]) * normal[1] + (camera.position.z - center[2]) * normal[2];
      if (cameraSide <= MIRROR_EPSILON) return skipMirrorPass("back-facing");
      if (!mirrorRect(node, viewProj) || MIRROR_RECT[2] < -1 || MIRROR_RECT[0] > 1 || MIRROR_RECT[3] < -1 || MIRROR_RECT[1] > 1) {
        return skipMirrorPass("offscreen");
      }
      const area = (Math.min(1, MIRROR_RECT[2]) - Math.max(-1, MIRROR_RECT[0])) * width * 0.5 * (Math.min(1, MIRROR_RECT[3]) - Math.max(-1, MIRROR_RECT[1])) * height * 0.5;
      if (area < 16) return skipMirrorPass("negligible");
      reflectMirrorPoint(mirrorEye, camera.position, center, normal);
      reflectMirrorPoint(mirrorTarget, camera.target, center, normal);
      const up = camera.up || UP, upDot = up.x * normal[0] + up.y * normal[1] + up.z * normal[2];
      mirrorUp.x = up.x - 2 * upDot * normal[0];
      mirrorUp.y = up.y - 2 * upDot * normal[1];
      mirrorUp.z = up.z - 2 * upDot * normal[2];
      mat4.lookAt(mirrorView, mirrorEye, mirrorTarget, mirrorUp);
      mat4.perspective(mirrorProj, camera.fov, width / height, Math.min(camera.near, cameraSide * 0.5), camera.far);
      // Reflect the actual view and capture only visible glass. Fitting the
      // entire aperture to a perpendicular camera spends nearly all capture
      // texels offscreen at close range, making reflections blur and crawl.
      mat4.multiply(mirrorViewProj, mirrorProj, mirrorView);
      mirrorRect(node, mirrorViewProj);
      const left = Math.max(-1, MIRROR_RECT[0]), right = Math.min(1, MIRROR_RECT[2]);
      const bottom = Math.max(-1, MIRROR_RECT[1]), top = Math.min(1, MIRROR_RECT[3]);
      const cropX = (left + right) * 0.5, cropY = (bottom + top) * 0.5;
      const halfX = (right - left) * 0.5, halfY = (top - bottom) * 0.5;
      const screenWidth = Math.max(1, halfX * width), screenHeight = Math.max(1, halfY * height);
      const targetWidth = mirror.renderWidth = Math.max(1, Math.min(settings.mirror, Math.ceil(screenWidth * dpr)));
      const targetHeight = mirror.renderHeight = Math.max(1, Math.min(settings.mirror, Math.ceil(screenHeight * dpr)));
      mirrorDebug.width = targetWidth;
      mirrorDebug.height = targetHeight;
      mirrorProj[0] /= halfX;
      mirrorProj[8] = (mirrorProj[8] + cropX) / halfX;
      mirrorProj[5] /= halfY;
      mirrorProj[9] = (mirrorProj[9] + cropY) / halfY;
      // Sky rays unproject through the cropped projection, before the oblique clip bends z
      mat4.multiply(mirrorViewProj, mirrorProj, mirrorView);
      skyInverse(mirrorInvViewProj, mirrorProj, mirrorView);
      mat4.transformPoint(MIRROR_POINT, mirrorView, center[0], center[1], center[2]);
      let cx = mirrorView[0] * normal[0] + mirrorView[4] * normal[1] + mirrorView[8] * normal[2];
      let cy = mirrorView[1] * normal[0] + mirrorView[5] * normal[1] + mirrorView[9] * normal[2];
      let cz = mirrorView[2] * normal[0] + mirrorView[6] * normal[1] + mirrorView[10] * normal[2];
      const clen = Math.hypot(cx, cy, cz) || 1;
      cx /= clen;
      cy /= clen;
      cz /= clen;
      let cw = -(cx * MIRROR_POINT[0] + cy * MIRROR_POINT[1] + cz * MIRROR_POINT[2]);
      const qx = ((cx >= 0 ? 1 : -1) + mirrorProj[8]) / mirrorProj[0];
      const qy = ((cy >= 0 ? 1 : -1) + mirrorProj[9]) / mirrorProj[5];
      const qz = -1;
      const qw = (1 + mirrorProj[10]) / mirrorProj[14];
      const clipScale = 2 / (cx * qx + cy * qy + cz * qz + cw * qw);
      cx *= clipScale;
      cy *= clipScale;
      cz *= clipScale;
      cw *= clipScale;
      mirrorProj[2] = cx;
      mirrorProj[6] = cy;
      mirrorProj[10] = cz + 0.998;
      mirrorProj[14] = cw;
      mat4.multiply(mirrorViewProj, mirrorProj, mirrorView);
      mirrorDebug.cameraPosition[0] = mirrorEye.x;
      mirrorDebug.cameraPosition[1] = mirrorEye.y;
      mirrorDebug.cameraPosition[2] = mirrorEye.z;
      mirrorDebug.cameraTarget[0] = mirrorTarget.x;
      mirrorDebug.cameraTarget[1] = mirrorTarget.y;
      mirrorDebug.cameraTarget[2] = mirrorTarget.z;
      mirrorDebug.skipReason = "none";
      return true;
    };
    const prepareEnvironmentCamera = (camera, face) => {
      const world = mirror.node.world, at = face * 6;
      // One fixed probe beside the glass is shared by all pooled panels. Their
      // normals select reflection directions immediately, between probe updates.
      mirrorEye.x = environment.origin[0] = world[12] + world[8] * 0.04;
      mirrorEye.y = environment.origin[1] = world[13] + world[9] * 0.04;
      mirrorEye.z = environment.origin[2] = world[14] + world[10] * 0.04;
      mirrorTarget.x = mirrorEye.x + CUBE_VIEWS[at];
      mirrorTarget.y = mirrorEye.y + CUBE_VIEWS[at + 1];
      mirrorTarget.z = mirrorEye.z + CUBE_VIEWS[at + 2];
      mirrorUp.x = CUBE_VIEWS[at + 3]; mirrorUp.y = CUBE_VIEWS[at + 4]; mirrorUp.z = CUBE_VIEWS[at + 5];
      mat4.lookAt(mirrorView, mirrorEye, mirrorTarget, mirrorUp);
      mat4.perspective(mirrorProj, Math.PI / 2, 1, 0.025, camera.far);
      mat4.multiply(mirrorViewProj, mirrorProj, mirrorView);
      skyInverse(mirrorInvViewProj, mirrorProj, mirrorView);
    };
    const ensureShardProgram = () => {
      if (!environment.program) {
        environment.program = compile(MIRROR_VS, SHARD_FS, ["uViewProj", "uShard", "uEnvironment", "uEye", "uTint"]);
        mirrorDebug.resources++;
      }
      if (environment.ready) return true;
      if (parallel && !gl.getProgramParameter(environment.program.prog, parallel.COMPLETION_STATUS_KHR)) return false;
      finishProgram(environment.program);
      environment.ready = true;
      return true;
    };
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const budget = Math.sqrt(MAX_PIXELS / Math.max(1, width * height));
      dpr = Math.min(budget, Math.max(0.75, Math.min(window.devicePixelRatio || 1, settings.dpr)));
      size.width = width;
      size.height = height;
      pw = Math.max(1, Math.floor(width * dpr));
      ph = Math.max(1, Math.floor(height * dpr));
      canvas.width = pw;
      canvas.height = ph;
      buildFbo();
    };
    const init = () => {
      parallel = gl.getExtension("KHR_parallel_shader_compile");
      buildPrograms();
      buildMatrixTexture();
      buildShadow();
      resize();
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
    };
    const onLost = (e) => {
      e.preventDefault();
      lost = true;
      forgetMirror();
    };
    const onRestored = () => {
      records.clear();
      activeRecords.length = 0;
      res.fbo = null;
      res.shadow = null;
      res.matrixTexture = null;
      init();
      lost = false;
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    // The camera pass draws only the in-frustum front of each record; shadow and mirror draw all
    const drawParts = (kind, useProgram, excludeMirror = false, cull = false, matrixStage = 0) => {
      for (const rec of activeRecords) {
        if (excludeMirror && (rec === mirror.record || rec.geometry.mirrorSource)) continue;
        const part = rec[kind], n = rec.batch && rec.batch.drawInstanceCount !== undefined ? rec.drawCount : cull ? rec.drawCount : rec.count;
        if (!part || !n) continue;
        if (cull && rec.offscreen) continue;
        if (kind === "mesh" && useProgram === "shadow" && rec.geometry.castShadow === false) continue;
        if (useProgram === "shadow" ? !rec.lightVisible : !cull && !rec.mirrorVisible) continue;
        if (kind === "mesh" && useProgram === "mesh") {
          const stage = rec.geometry.matrixRevealBacking ? 1 : rec.geometry.matrixGlyph ? 2 : 0;
          if (stage !== matrixStage) continue;
          gl.uniform1f(res.programs.mesh.u.uMatrixGlyph, stage === 1 ? 3 : stage === 2 ? 1 : rec.geometry.matrixLocalGlyphSurface ? 2 : 0);
          if (stage === 2) gl.uniform1f(res.programs.mesh.u.uMatrixGlyphOpacity, rec.geometry.matrixGlyphOpacity ?? 1);
          gl.uniform1f(res.programs.mesh.u.uMatrixCave, rec.geometry.matrixCave || 0);
        }
        if (kind === "mesh") {
          const program = res.programs[useProgram], minimumY = rec.geometry.clipMinY ?? -1e6, maximumY = rec.geometry.clipMaxY ?? 1e6;
          if (minimumY !== program.clipMinY) {
            gl.uniform1f(program.u.uClipMinY, minimumY);
            program.clipMinY = minimumY;
          }
          if (maximumY !== program.clipMaxY) {
            gl.uniform1f(program.u.uClipMaxY, maximumY);
            program.clipMaxY = maximumY;
          }
        }
        if (kind === "line") gl.uniform1f(res.programs.line.u.uWidth, part.width * dpr);
        // Surface overlays stay above their backing at distant zooms in both color
        // passes. Keep the shadow depth and subsequent ordinary meshes unchanged.
        const offset = kind === "mesh" && useProgram === "mesh" && rec.geometry.depthOffset;
        if (offset) {
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(0, -4);
        }
        gl.bindVertexArray(part.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, part.count, n);
        if (offset) gl.disable(gl.POLYGON_OFFSET_FILL);
      }
    };
    // Celestial rays depend only on orientation. Removing translation before
    // inversion avoids altitude-dependent cancellation in the star shader.
    const skyInverse = (out, projection, cameraView) => {
      out.set(cameraView);
      out[12] = out[13] = out[14] = 0;
      mat4.multiply(out, projection, out);
      mat4.invert(out, out);
    };
    const drawSky = (inv, eyeHeight) => {
      const p = res.programs.sky;
      gl.useProgram(p.prog);
      gl.uniformMatrix4fv(p.u.uInvViewProj, false, inv);
      gl.uniform1f(p.u.uHazeDrop, BL.daylight.hazeDropAt(eyeHeight));
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.bindVertexArray(res.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
      gl.depthFunc(gl.LESS);
    };
    const renderMirrorCapture = (clear, sky, ground, direct, directStrength, ambientFloor, diffuseFloor, shadowStrength, shadowFloor, shadowBias, lx, ly, lz, sh, lights, lightCount, skyOn, fog, fogNear, fogFar, matrix, environmentFace = -1) => {
      const cube = environmentFace >= 0;
      if (!cube) ensureMirrorTarget();
      extractFrustum(mirrorViewProj, MIRROR_FRUSTUM);
      markMirrorVisible();
      const pg = res.programs;
      gl.bindFramebuffer(gl.FRAMEBUFFER, cube ? environment.fb : mirror.fb);
      if (cube) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + environmentFace, environment.tex, 0);
      const captureWidth = cube ? environment.size : mirror.renderWidth, captureHeight = cube ? environment.size : mirror.renderHeight;
      gl.viewport(0, 0, captureWidth, captureHeight);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, captureWidth, captureHeight);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(pg.mesh.prog);
      gl.uniformMatrix4fv(pg.mesh.u.uViewProj, false, mirrorViewProj);
      gl.uniformMatrix4fv(pg.mesh.u.uLightViewProj, false, lightViewProj);
      gl.uniform3f(pg.mesh.u.uEye, mirrorEye.x, mirrorEye.y, mirrorEye.z);
      gl.uniform3f(pg.mesh.u.uLightDir, lx, ly, lz);
      gl.uniform3fv(pg.mesh.u.uSky, sky);
      gl.uniform3fv(pg.mesh.u.uGround, ground);
      gl.uniform3fv(pg.mesh.u.uSun, direct);
      gl.uniform1f(pg.mesh.u.uDirectStrength, directStrength);
      gl.uniform1f(pg.mesh.u.uAmbientFloor, ambientFloor);
      gl.uniform1f(pg.mesh.u.uDiffuseFloor, diffuseFloor);
      gl.uniform1f(pg.mesh.u.uShadowStrength, shadowStrength);
      gl.uniform1f(pg.mesh.u.uShadowFloor, shadowFloor);
      gl.uniform1f(pg.mesh.u.uShadowBias, shadowBias);
      gl.uniform1f(pg.mesh.u.uShadowTexel, 1 / sh.size);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sh.tex);
      gl.uniform1i(pg.mesh.u.uShadow, 0);
      bindMatrixTexture(pg.mesh);
      if (lights) gl.uniform4fv(pg.mesh.u.uLights, lights);
      gl.uniform1i(pg.mesh.u.uLightCount, lightCount);
      gl.uniform3fv(pg.mesh.u.uFog, fog);
      gl.uniform2f(pg.mesh.u.uFogRange, fogNear, fogFar);
      // The mirror closes before the retreat reaches the pile. Its reflection
      // must still show the same partially transformed world as the main view.
      gl.uniform4f(pg.mesh.u.uMatrixParams, matrix ? matrix.active : 0, matrix ? matrix.radius : 0, matrix ? matrix.time : 0, matrix ? matrix.density : 0);
      gl.uniform1i(pg.mesh.u.uMatrixSamples, cube ? 1 : Math.max(1, mirrorDebug.samples));
      if (matrix) gl.uniform3fv(pg.mesh.u.uMatrixOrigin, matrix.origin);
      else gl.uniform3f(pg.mesh.u.uMatrixOrigin, 0, 0, 0);
      gl.uniform4fv(pg.mesh.u.uMatrixCaves, matrix && matrix.caves || NO_MATRIX_CAVES);
      gl.uniform4fv(pg.mesh.u.uMatrixCaveBounds, matrix && matrix.caveBounds || NO_MATRIX_CAVES);
      gl.uniform1f(pg.mesh.u.uMatrixCaveNear, matrix && matrix.caveBounds ? matrix.caveNear : FOG_OFF);
      gl.uniform1f(pg.mesh.u.uMatrixPermanentCave, matrix ? matrix.permanentCave || 0 : 0);
      gl.uniform4fv(pg.mesh.u.uMatrixPermanentPlane, matrix && matrix.permanentPlane || NO_MATRIX_PLANE);
      gl.uniform4fv(pg.mesh.u.uMatrixPermanentAperture, matrix && matrix.permanentAperture || DEFAULT_MATRIX_APERTURE);
      gl.uniform1f(pg.mesh.u.uMatrixLivingGlobal, matrix ? matrix.livingGlobal ?? 1 : 1);
      drawParts("mesh", "mesh", true);
      if (skyOn) drawSky(mirrorInvViewProj, mirrorEye.y);
      gl.useProgram(pg.mesh.prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawParts("mesh", "mesh", true, false, 1);
      drawParts("mesh", "mesh", true, false, 2);
      gl.disable(gl.BLEND);
      gl.useProgram(pg.line.prog);
      gl.uniformMatrix4fv(pg.line.u.uViewProj, false, mirrorViewProj);
      gl.uniform2f(pg.line.u.uViewport, captureWidth, captureHeight);
      gl.disable(gl.CULL_FACE);
      drawParts("line", "line", true);
      gl.enable(gl.CULL_FACE);
      if (cube) {
        environment.valid |= 1 << environmentFace;
        mirrorDebug.environmentFaces = environment.valid;
        mirrorDebug.environmentPassCount++;
        return;
      }
      mirrorDebug.reflectionOnlyCount = 0;
      for (const rec of activeRecords) if (rec !== mirror.record) mirrorDebug.reflectionOnlyCount += rec.cameraHiddenCount;
      mirrorCapturedViewProj.set(mirrorViewProj);
      mirror.captureValid = mirrorDebug.captureValid = true;
      mirrorDebug.reflectionPassCount++;
      mirrorDebug.captureExcluded = true;
    };
    const drawMirrorSurface = (camera) => {
      const rec = mirror.record, part = rec && rec.mesh, pg = mirror.program;
      mirrorDebug.ripples = 0;
      mirrorDebug.bodyContacts = mirrorDebug.bodyWaves = 0;
      const pane = !mirror.portal && mirror.frontFacing && part && mirror.tex && mirror.programReady && mirror.captureValid;
      if (!mirror.node) return;
      if (pane) {
        gl.useProgram(pg.prog);
        gl.uniformMatrix4fv(pg.u.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(pg.u.uReflectionViewProj, false, mirrorCapturedViewProj);
        gl.uniformMatrix4fv(pg.u.uMirrorWorld, false, mirror.node.world);
        gl.uniform1f(pg.u.uShard, 0);
        gl.uniform2f(pg.u.uReflectionScale, mirror.renderWidth / mirror.width, mirror.renderHeight / mirror.height);
        gl.uniform3f(pg.u.uTint, 0.56, 0.62, 0.67);
        gl.uniform1f(pg.u.uPortal, mirror.portal ? 1 : 0);
        gl.uniform1f(pg.u.uReveal, mirror.reveal);
        const ripples = mirror.node.mirrorRipples, body = mirror.node.mirrorBody;
        mirrorDebug.ripples = ripples ? ripples.active : 0;
        gl.uniform1i(pg.u.uRippleActive, mirrorDebug.ripples);
        gl.uniform1f(pg.u.uRippleTime, body ? body.time : ripples ? ripples.time : 0);
        gl.uniform4fv(pg.u.uRipples, ripples ? ripples.waves : NO_MIRROR_RIPPLES);
        const bodyActive = body && (body.contacts || body.active);
        gl.activeTexture(gl.TEXTURE4);
        if (bodyActive) {
          // One bounded silhouette atlas belongs to the mirror for its lifetime.
          // Contacts rebuild it at their capped cadence; moving wave ages are uniforms.
          if (!mirror.bodyTex) {
            mirror.bodyTex = createTexture(body.width, body.height * body.layers, gl.RGBA8, gl.LINEAR);
            mirrorDebug.resources++;
          }
          gl.bindTexture(gl.TEXTURE_2D, mirror.bodyTex);
          if (mirror.bodyState !== body || mirror.bodyVersion !== body.version) {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, body.width, body.height * body.layers, gl.RGBA, gl.UNSIGNED_BYTE, body.pixels);
            mirror.bodyState = body;
            mirror.bodyVersion = body.version;
          }
          const bounds = boundsOf(mirror.node.geometry);
          gl.uniform4f(pg.u.uBodyBounds, bounds.min[0], bounds.min[1], bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
          gl.uniform2f(pg.u.uBodyTexel, 1 / body.width, 1 / body.height);
          mirrorDebug.bodyContacts = body.contacts;
          mirrorDebug.bodyWaves = body.active;
        } else gl.bindTexture(gl.TEXTURE_2D, mirror.bodyTex || res.matrixTexture);
        gl.uniform1i(pg.u.uBodyField, 4);
        gl.uniform1i(pg.u.uBodyContacts, mirrorDebug.bodyContacts);
        gl.uniform1i(pg.u.uBodyActive, mirrorDebug.bodyWaves);
        gl.uniform4fv(pg.u.uBodyWaves, body ? body.waves : NO_MIRROR_BODY_WAVES);
        bindMatrixTexture(pg);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, mirror.tex);
        gl.uniform1i(pg.u.uReflection, 2);
        gl.bindVertexArray(part.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, part.count, rec.count);
        mirrorDebug.surfaceDrawn = true;
      }
      // Every shard reflects its own physical orientation through this shared
      // environment. No shard owns a scene pass, texture or framebuffer.
      if (mirror.shards && environment.ready && environment.tex) {
        const shardProgram = environment.program;
        gl.useProgram(shardProgram.prog);
        gl.uniformMatrix4fv(shardProgram.u.uViewProj, false, viewProj);
        gl.uniform1f(shardProgram.u.uShard, 1);
        gl.uniform3f(shardProgram.u.uEye, camera.position.x, camera.position.y, camera.position.z);
        gl.uniform3f(shardProgram.u.uTint, 0.56, 0.62, 0.67);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, environment.tex);
        gl.uniform1i(shardProgram.u.uEnvironment, 5);
        for (const shard of activeRecords) {
          if (!shard.geometry.mirrorSource || !shard.mesh || !shard.drawCount || shard.offscreen) continue;
          gl.bindVertexArray(shard.mesh.vao);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, shard.mesh.count, shard.drawCount);
          mirrorDebug.shardsDrawn += shard.drawCount;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
    };
    const blit = (f) => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, f.scene);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, f.resolve);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.drawBuffers(DRAW_COLOR);
      gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.drawBuffers(DRAW_BRIGHT);
      gl.blitFramebuffer(0, 0, pw, ph, 0, 0, pw, ph, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.drawBuffers(DRAW_BOTH);
    };
    const fullscreen = (program, fb, w, h) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, w, h);
      gl.useProgram(program.prog);
      gl.bindVertexArray(res.quadVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const render = (root, camera, opts = {}) => {
      if (lost || !pollPrograms()) return false;
      const {
        light = DEFAULT_LIGHT,
        sky = DEFAULT_SKY,
        ground = DEFAULT_GROUND,
        sun = DEFAULT_SUN,
        sunDirection = light,
        direct = sun,
        directStrength = 1,
        ambientFloor = 0,
        diffuseFloor = 0,
        shadowStrength = 1,
        shadowFloor = 0,
        shadowBias = 0.0035,
        clear = DEFAULT_CLEAR,
        bloomStrength = 0.9,
        shadowCenter = DEFAULT_SHADOW_CENTER,
        shadowExtent = 13,
        horizon,
        zenith,
        moon = DEFAULT_MOON,
        stars = 0,
        starMatrix = DEFAULT_STAR_MATRIX,
        time = 0,
        lights,
        lightCount = 0,
        fog = null,
        fogNear = 0,
        fogFar = 0,
        matrix = null
      } = opts;
      const fogColor = fog || NO_FOG, fogA = fog ? fogNear : FOG_OFF, fogB = fog ? fogFar : FOG_OFF + 1;
      if (canvas.clientWidth !== width || canvas.clientHeight !== height) resize();
      const f = res.fbo, sh = res.shadow, pg = res.programs;
      const skyOn = !!(horizon && zenith);
      const nLights = lights ? Math.min(lightCount, settings.lights) : 0;
      mat4.lookAt(view, camera.position, camera.target, camera.up || UP);
      mat4.perspective(proj, camera.fov, width / height, camera.near, camera.far);
      mat4.multiply(viewProj, proj, view);
      extractFrustum(viewProj);
      const llen = Math.hypot(light.x, light.y, light.z) || 1;
      const lx = light.x / llen, ly = light.y / llen, lz = light.z / llen;
      const slen = Math.hypot(sunDirection.x, sunDirection.y, sunDirection.z) || 1;
      const sx = sunDirection.x / slen, sy = sunDirection.y / slen, sz = sunDirection.z / slen;
      if (skyOn) {
        skyInverse(invViewProj, proj, view);
        gl.useProgram(pg.sky.prog);
        gl.uniform3fv(pg.sky.u.uHorizon, horizon);
        gl.uniform3fv(pg.sky.u.uZenith, zenith);
        gl.uniform3fv(pg.sky.u.uSun, sun);
        gl.uniform3f(pg.sky.u.uSunDir, sx, sy, sz);
        gl.uniform3f(pg.sky.u.uMoonDir, moon.x, moon.y, moon.z);
        gl.uniformMatrix3fv(pg.sky.u.uStarMatrix, false, starMatrix);
        gl.uniform1f(pg.sky.u.uStars, stars);
        gl.uniform1f(pg.sky.u.uTime, time);
      }
      // Set the light back to bracket the shadowed volume
      const lightDist = shadowExtent * 1.8, lightDepth = shadowExtent * 1.5;
      LIGHT_EYE.x = shadowCenter.x + lx * lightDist;
      LIGHT_EYE.y = shadowCenter.y + ly * lightDist;
      LIGHT_EYE.z = shadowCenter.z + lz * lightDist;
      mat4.lookAt(lightView, LIGHT_EYE, shadowCenter, Math.abs(ly) > 0.96 ? NORTH_UP : UP);
      mat4.ortho(lightProj, -shadowExtent, shadowExtent, -shadowExtent, shadowExtent, Math.max(0.5, lightDist - lightDepth), lightDist + lightDepth);
      mat4.multiply(lightViewProj, lightProj, lightView);
      mat4.transformPoint4(P4, lightViewProj, 0, 0, 0);
      const shadowSnap = sh.size * 0.5;
      lightProj[12] += (Math.round(P4[0] * shadowSnap) - P4[0] * shadowSnap) / shadowSnap;
      lightProj[13] += (Math.round(P4[1] * shadowSnap) - P4[1] * shadowSnap) / shadowSnap;
      mat4.multiply(lightViewProj, lightProj, lightView);
      for (const rec of activeRecords) {
        rec.active = false;
        // Drop the references without trimming the backing store the next
        // frame's collect would immediately regrow
        rec.nodes.fill(null);
        rec.batch = null;
        rec.offscreen = false;
      }
      activeRecords.length = 0;
      mirror.node = mirror.record = null;
      mirror.portal = mirror.frontFacing = mirror.walkThrough = false;
      mirror.reveal = 0;
      mirrorDebug.active = false;
      mirrorDebug.portal = false;
      mirrorDebug.reveal = 0;
      mirrorDebug.surfaceDrawn = false;
      mirrorDebug.ripples = 0;
      mirrorDebug.bodyContacts = mirrorDebug.bodyWaves = 0;
      mirror.shards = mirrorDebug.shardsDrawn = 0;
      culled = drawn = suppressed = 0;
      updateWorld(root, null);
      traverseVisible(root, collect);
      for (const rec of activeRecords) {
        if (rec.offscreen) culled += rec.drawCount; else drawn += rec.drawCount;
        if (rec.geometry.mirrorSource && !rec.offscreen) mirror.shards += rec.drawCount;
        uploadInstances(rec);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, sh.fb);
      gl.viewport(0, 0, sh.size, sh.size);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(pg.shadow.prog);
      gl.uniformMatrix4fv(pg.shadow.u.uLightViewProj, false, lightViewProj);
      extractFrustum(lightViewProj, LIGHT_FRUSTUM);
      markLightVisible();
      gl.cullFace(gl.FRONT);
      drawParts("mesh", "shadow");
      gl.cullFace(gl.BACK);
      shadowPassCount++;
      if (mirror.node) {
        updateMirrorSide(camera);
        if (mirror.portal) {
          skipMirrorPass("portal-open");
        } else if (prepareMirrorCamera(camera)) {
          if (!ensureMirrorProgram()) skipMirrorPass("shader-pending");
          else renderMirrorCapture(clear, sky, ground, direct, directStrength, ambientFloor, diffuseFloor, shadowStrength, shadowFloor, shadowBias, lx, ly, lz, sh, lights, nLights, skyOn, fogColor, fogA, fogB, matrix);
        }
        if (mirror.shards && ensureShardProgram()) {
          ensureEnvironment(clear);
          if (environment.valid !== 63 || environment.frame++ % settings.environmentCadence === 0) {
            const face = environment.next;
            prepareEnvironmentCamera(camera, face);
            renderMirrorCapture(clear, sky, ground, direct, directStrength, ambientFloor, diffuseFloor, shadowStrength, shadowFloor, shadowBias, lx, ly, lz, sh, lights, nLights, skyOn, fogColor, fogA, fogB, matrix, face);
            environment.next = (face + 1) % 6;
          }
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.scene);
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(clear[0], clear[1], clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.clearBufferfv(gl.COLOR, 1, ZERO4);
      gl.useProgram(pg.mesh.prog);
      gl.uniformMatrix4fv(pg.mesh.u.uViewProj, false, viewProj);
      gl.uniformMatrix4fv(pg.mesh.u.uLightViewProj, false, lightViewProj);
      gl.uniform3f(pg.mesh.u.uEye, camera.position.x, camera.position.y, camera.position.z);
      gl.uniform3f(pg.mesh.u.uLightDir, lx, ly, lz);
      gl.uniform3fv(pg.mesh.u.uSky, sky);
      gl.uniform3fv(pg.mesh.u.uGround, ground);
      gl.uniform3fv(pg.mesh.u.uSun, direct);
      gl.uniform1f(pg.mesh.u.uDirectStrength, directStrength);
      gl.uniform1f(pg.mesh.u.uAmbientFloor, ambientFloor);
      gl.uniform1f(pg.mesh.u.uDiffuseFloor, diffuseFloor);
      gl.uniform1f(pg.mesh.u.uShadowStrength, shadowStrength);
      gl.uniform1f(pg.mesh.u.uShadowFloor, shadowFloor);
      gl.uniform1f(pg.mesh.u.uShadowBias, shadowBias);
      gl.uniform1f(pg.mesh.u.uShadowTexel, 1 / sh.size);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sh.tex);
      gl.uniform1i(pg.mesh.u.uShadow, 0);
      bindMatrixTexture(pg.mesh);
      if (lights) gl.uniform4fv(pg.mesh.u.uLights, lights);
      gl.uniform1i(pg.mesh.u.uLightCount, nLights);
      gl.uniform3fv(pg.mesh.u.uFog, fogColor);
      gl.uniform2f(pg.mesh.u.uFogRange, fogA, fogB);
      gl.uniform4f(pg.mesh.u.uMatrixParams, matrix ? matrix.active : 0, matrix ? matrix.radius : 0, matrix ? matrix.time : time, matrix ? matrix.density : 0);
      gl.uniform1i(pg.mesh.u.uMatrixSamples, Math.max(1, f.samples));
      if (matrix) gl.uniform3fv(pg.mesh.u.uMatrixOrigin, matrix.origin);
      else gl.uniform3f(pg.mesh.u.uMatrixOrigin, 0, 0, 0);
      gl.uniform4fv(pg.mesh.u.uMatrixCaves, matrix && matrix.caves || NO_MATRIX_CAVES);
      gl.uniform4fv(pg.mesh.u.uMatrixCaveBounds, matrix && matrix.caveBounds || NO_MATRIX_CAVES);
      gl.uniform1f(pg.mesh.u.uMatrixCaveNear, matrix && matrix.caveBounds ? matrix.caveNear : FOG_OFF);
      gl.uniform1f(pg.mesh.u.uMatrixPermanentCave, matrix ? matrix.permanentCave || 0 : 0);
      gl.uniform4fv(pg.mesh.u.uMatrixPermanentPlane, matrix && matrix.permanentPlane || NO_MATRIX_PLANE);
      gl.uniform4fv(pg.mesh.u.uMatrixPermanentAperture, matrix && matrix.permanentAperture || DEFAULT_MATRIX_APERTURE);
      gl.uniform1f(pg.mesh.u.uMatrixLivingGlobal, matrix ? matrix.livingGlobal ?? 1 : 1);
      drawParts("mesh", "mesh", true, true);
      drawMirrorSurface(camera);
      if (skyOn) drawSky(invViewProj, camera.position.y);
      // Ordinary surfaces first, then the effect-only black liner and native
      // voxel glyphs. Alpha follows the same wave as the backing shader; depth
      // still rejects hidden faces and keeps the glyphs on their real surfaces.
      gl.useProgram(pg.mesh.prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawParts("mesh", "mesh", true, true, 1);
      drawParts("mesh", "mesh", true, true, 2);
      gl.disable(gl.BLEND);
      gl.useProgram(pg.line.prog);
      gl.uniformMatrix4fv(pg.line.u.uViewProj, false, viewProj);
      gl.uniform2f(pg.line.u.uViewport, pw, ph);
      gl.disable(gl.CULL_FACE);
      drawParts("line", "line", false, true);
      gl.enable(gl.CULL_FACE);
      if (f.samples > 0) blit(f);
      gl.disable(gl.DEPTH_TEST);
      const bw = f.bloomW, bh = f.bloomH;
      if (settings.bloom) {
        gl.useProgram(pg.blur.prog);
        gl.uniform1i(pg.blur.u.uTex, 0);
        gl.bindTexture(gl.TEXTURE_2D, f.bright);
        gl.uniform2f(pg.blur.u.uDir, 1.4 / bw, 0);
        fullscreen(pg.blur, f.ping[0].fb, bw, bh);
        gl.bindTexture(gl.TEXTURE_2D, f.ping[0].tex);
        gl.uniform2f(pg.blur.u.uDir, 0, 1.4 / bh);
        fullscreen(pg.blur, f.ping[1].fb, bw, bh);
        gl.bindTexture(gl.TEXTURE_2D, f.ping[1].tex);
        gl.uniform2f(pg.blur.u.uDir, 2.2 / bw, 0);
        fullscreen(pg.blur, f.ping[0].fb, bw, bh);
        gl.bindTexture(gl.TEXTURE_2D, f.ping[0].tex);
        gl.uniform2f(pg.blur.u.uDir, 0, 2.2 / bh);
        fullscreen(pg.blur, f.ping[1].fb, bw, bh);
      }
      gl.useProgram(pg.composite.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, f.color);
      gl.uniform1i(pg.composite.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, settings.bloom ? f.ping[1].tex : f.bright);
      gl.uniform1i(pg.composite.u.uBloom, 1);
      gl.uniform1f(pg.composite.u.uBloomStrength, settings.bloom ? bloomStrength : 0);
      fullscreen(pg.composite, null, pw, ph);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST);
      return true;
    };
    // Screen position of a world point, written into out
    const project = (x, y, z, out = {}) => {
      mat4.transformPoint4(P4, viewProj, x, y, z);
      if (P4[3] <= 0.01) return null;
      out.x = (P4[0] / P4[3] * 0.5 + 0.5) * width;
      out.y = (0.5 - P4[1] / P4[3] * 0.5) * height;
      out.depth = -P4[3];
      return out;
    };
    const ray = (px, py, camera, out) => mat4.rayFromView(out, view, width, height, camera.fov, camera.position, px, py);
    const setQuality = (name) => {
      if (!QUALITY[name] || QUALITY[name] === settings) return;
      settings = QUALITY[name];
      qualityName = name;
      buildShadow();
      resize();
    };
    const dispose = () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      destroyRecords();
      destroyMirror();
      destroyFbo();
      destroyShadow();
      if (res.matrixTexture) gl.deleteTexture(res.matrixTexture);
      for (const p of Object.values(res.programs)) gl.deleteProgram(p.prog);
      if (res.quadVao) gl.deleteVertexArray(res.quadVao);
      res.programs = {};
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
    // Drop unreferenced buffers, rebuilt on demand
    const releaseUnused = (live) => {
      let released = 0;
      if (mirror.geometry && !live.has(mirror.geometry)) destroyMirror();
      for (const geometry of records.keys()) {
        if (live.has(geometry)) continue;
        releaseGeometry(geometry);
        released++;
      }
      return released;
    };
    const releaseGeometry = (geometry) => {
      const rec = records.get(geometry);
      if (!rec) return;
      deleteRecord(rec);
      records.delete(geometry);
    };
    init();
    return {
      kind: "webgl2",
      render,
      resize,
      project,
      ray,
      setQuality,
      releaseGeometry,
      releaseUnused,
      dispose,
      get quality() {
        return qualityName;
      },
      get stats() {
        let shadowFinite = true;
        for (let i = 0; i < 16; i++) if (!Number.isFinite(lightViewProj[i])) shadowFinite = false;
        return { records: records.size, active: activeRecords.length, mirrorResources: mirrorDebug.resources, shadowResources: res.shadow ? 2 : 0, shadowSize: res.shadow ? res.shadow.size : 0, shadowPassCount, shadowFinite, culled, drawn, suppressed };
      },
      get mirror() {
        return mirrorDebug;
      },
      get ready() {
        return ready;
      },
      get failure() {
        return failure;
      },
      get size() {
        return size;
      }
    };
  };
  BL.glRenderer = { createRenderer, isSupported, QUALITY };
})();
