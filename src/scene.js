import {
  WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Fog, Color,
  PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace, Vector3, PMREMGenerator, Scene as EnvScene,
  MathUtils,
} from 'three';
import { CAMERA, COLORS, MAX_DPR, R_OUT, TOWER_TOP, WALL, COLS, TILE_W } from './config.js';
import { settingsFor } from './quality.js';
import { frameFor } from './aim.js';
import { createSky, createWater, SUN_DIR } from './environment.js';

/**
 * Renderer, camera, lights, sky/ocean. Returns a stage object:
 *   { renderer, scene, camera, sky, water, sun, target, update(timeSec), render(), resize() }
 * `target` is the point the camera orbits/looks at; later workstreams may move it
 * (camera-follow) and call stage.frame() to re-aim.
 */
export function createStage(container) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // re-rendered only when something moved (stage.shadowDirty)
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(COLORS.skyHorizon);
  scene.fog = new Fog(COLORS.fog, 60, 420);

  const camera = new PerspectiveCamera(CAMERA.fov, 1, 0.5, 4000);

  // Sky + ocean
  const sky = createSky();
  const water = createWater();
  scene.add(sky, water);

  // Image-based light from the sky for soft reflections on glossy ivory tiles
  const pmrem = new PMREMGenerator(renderer);
  const envScene = new EnvScene();
  envScene.add(createSky());
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // Lights
  const hemi = new HemisphereLight(0xcfe6ff, 0xa9b9c4, 1.8);
  scene.add(hemi);

  const sun = new DirectionalLight(0xfff1d8, 2.0);
  const target = new Vector3(0, 20, 0);
  sun.target.position.copy(target);
  sun.position.copy(target).addScaledVector(SUN_DIR, 60);
  sun.castShadow = true;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 800 || matchMedia('(pointer: coarse)').matches;
  const shadowRes = smallScreen ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  const sc = sun.shadow.camera;
  sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 10; sc.far = 150;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const stage = {
    renderer, scene, camera, sky, water, sun, target,
    _w: 1, _h: 1, dprCap: MAX_DPR, shadowDirty: true, quality: 0,
    /** Aim camera at stage.target from the configured pitch, fitting the tower width. */
    rimY: 24 * 1.3,
    pitchDeg: CAMERA.pitchDeg, zoom: 1, pan: 0,
    frame() {
      const f = frameFor({ w: stage._w, h: stage._h, wall: WALL, cols: COLS, pitchDeg: stage.pitchDeg, zoom: stage.zoom, rimY: stage.rimY, pan: stage.pan });
      stage.effZoom = f.zoom;
      target.y = f.ty;
      camera.position.set(0, f.camY, f.camZ);
      camera.lookAt(target);
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(SUN_DIR, 60);
      stage.shadowDirty = true;
    },
    resize() {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      stage._w = w; stage._h = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, stage.dprCap));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      stage.frame();
    },
    update(t) {
      water.material.uniforms.time.value = t;
      sky.position.copy(camera.position);
      water.position.x = camera.position.x;
      water.position.z = camera.position.z;
    },
    /** Apply an adaptive-quality level (see quality.js). */
    setQuality(level) {
      const q = settingsFor(level, window.devicePixelRatio || 1);
      stage.quality = level; stage.dprCap = q.dpr;
      sun.castShadow = q.shadows;
      stage.shadowDirty = true;
      stage.resize();
    },
    render() {
      renderer.shadowMap.needsUpdate = stage.shadowDirty;
      stage.shadowDirty = false;
      renderer.render(scene, camera);
    },
  };

  window.addEventListener('resize', stage.resize);
  window.addEventListener('orientationchange', stage.resize);
  stage.resize();
  return stage;
}
