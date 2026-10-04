import {
  Mesh, PlaneGeometry, SphereGeometry, ShaderMaterial, BackSide, Color, Vector3, DoubleSide,
} from 'three';
import { COLORS, WATER_Y } from './config.js';

const SUN_DIR = new Vector3(-0.35, 0.8, 0.5).normalize();
export { SUN_DIR };

const COMMON_PARS = '';

/** Gradient sky dome with hazy horizon + soft sun glow. */
export function createSky() {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      horizon: { value: new Color(COLORS.skyHorizon) },
      top: { value: new Color(COLORS.skyTop) },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_PARS}
      uniform vec3 horizon; uniform vec3 top; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        float t = pow(smoothstep(0.0, 0.75, h), 0.7);
        vec3 col = mix(horizon, top, t);
        // below-horizon haze so the seam with water is soft
        col = mix(col, horizon, smoothstep(0.08, -0.05, vDir.y) * 0.8);
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 24.0) * 0.25 + pow(s, 400.0) * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(1500, 32, 16), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/** Animated procedural ocean: layered wave normals, fresnel sky reflection, sun glitter, haze. */
export function createWater() {
  const mat = new ShaderMaterial({
    fog: false,
    toneMapped: false,
    side: DoubleSide,
    uniforms: {
      time: { value: 0 },
      deep: { value: new Color(COLORS.waterDeep) },
      shallow: { value: new Color(COLORS.waterShallow) },
      horizon: { value: new Color(COLORS.skyHorizon) },
      top: { value: new Color(COLORS.skyTop) },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${COMMON_PARS}
      uniform float time; uniform vec3 deep; uniform vec3 shallow; uniform vec3 horizon; uniform vec3 top; uniform vec3 sunDir;
      varying vec3 vWorld;

      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      // isotropic ripple height: rotated, drifting octaves (no dominant direction => no stripes)
      float height(vec2 p, float fadeHi) {
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        float h = 0.0, a = 0.5, f = 0.16;
        vec2 q = p;
        for (int i = 0; i < 5; i++) {
          vec2 drift = vec2(cos(float(i) * 1.7), sin(float(i) * 2.3)) * time * (0.12 + 0.05 * float(i));
          float w = (i < 3) ? 1.0 : fadeHi;
          h += a * w * (vnoise(q * f + drift) - 0.5);
          q = rot * q; f *= 2.03; a *= 0.52;
        }
        return h;
      }

      void main() {
        vec2 p = vWorld.xz;
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 V = toCam / dist;

        float fadeHi = 1.0 - smoothstep(25.0, 140.0, dist);   // fine ripples vanish with distance (no shimmer)
        float e = 0.35 + dist * 0.004;
        float h0 = height(p, fadeHi);
        vec2 g = vec2(height(p + vec2(e, 0.0), fadeHi) - h0, height(p + vec2(0.0, e), fadeHi) - h0) / e;
        g *= 2.4 * mix(0.35, 1.0, fadeHi);
        vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

        float ndv = max(dot(N, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        float ry = clamp(R.y, 0.0, 1.0);
        vec3 refl = mix(horizon, top, pow(ry, 0.45));

        float diffuse = clamp(dot(N, sunDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 body = mix(deep, shallow, smoothstep(0.25, 0.9, diffuse) * 0.8 + h0 * 0.6);
        vec3 col = mix(body, refl, clamp(fres * 0.4, 0.0, 1.0));

        float spec = pow(max(dot(R, sunDir), 0.0), 160.0) * (0.35 + 0.65 * fadeHi);
        col += vec3(1.0, 0.95, 0.85) * spec * 1.4;

        // haze only near the horizon
        float haze = smoothstep(220.0, 900.0, dist);
        col = mix(col, horizon, clamp(haze * 0.95, 0.0, 0.95));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(3000, 3000, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_Y;
  mesh.frustumCulled = false;
  return mesh;
}
