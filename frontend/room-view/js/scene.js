import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { ROOM, WINDOW, DOOR, HEATER, HIDDEN_NODES, SENSORS, CAMERA_PRESETS } from './layout.js';
import { GLSL, MAX_SOURCES, buildSources, colorFor, cssColor, sample, writeUniforms } from './field.js';

const gsap = window.gsap;
const SMALL_SCREEN = matchMedia('(max-width: 820px)').matches;

function makeFieldUniforms(opacity) {
  return {
    uSrc: { value: Array.from({ length: MAX_SOURCES }, () => new THREE.Vector4()) },
    uSrcP: { value: Array.from({ length: MAX_SOURCES }, () => new THREE.Vector2(1, 0.4)) },
    uCount: { value: 0 },
    uTarget: { value: 21 },
    uOpacity: { value: opacity },
    uTime: { value: 0 },
  };
}

const SURFACE_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SURFACE_FRAGMENT = /* glsl */ `
  ${GLSL}
  uniform float uOpacity;
  uniform float uGrid;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    float t = fieldAt(vWorld);
    vec3 color = rampColor(t);
    float strength = clamp(abs(t - uTarget) / 4.0, 0.0, 1.0);
    float edge = smoothstep(0.0, 0.035, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    // a fine technical grid on the floor, like a configurator stage
    float line = 0.0;
    if (uGrid > 0.0) {
      vec2 g = abs(fract(vWorld.xz * 2.0) - 0.5);
      line = smoothstep(0.48, 0.5, max(g.x, g.y));
    }
    float alpha = uOpacity * (0.07 + 0.75 * smoothstep(0.0, 1.0, strength)) * edge + line * 0.06 * edge;
    gl_FragColor = vec4(color * (1.0 + 0.25 * strength), alpha);
  }
`;

const HAZE_FRAGMENT = /* glsl */ `
  ${GLSL}
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vWorld;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    float t = fieldAt(vWorld);
    float strength = clamp(abs(t - uTarget) / 4.0, 0.0, 1.0);
    float n = noise(vWorld.xz * 1.6 + vec2(uTime * 0.05, uTime * 0.03)) * 0.6 + 0.4;
    float edge = smoothstep(0.0, 0.12, min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)));
    gl_FragColor = vec4(rampColor(t), uOpacity * (0.25 + strength) * n * edge);
  }
`;

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function studioFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, 'rgba(70,86,108,.55)');
  grad.addColorStop(0.5, 'rgba(40,50,64,.25)');
  grad.addColorStop(1, 'rgba(20,26,34,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RoomScene {
  constructor(container, { onSensorClick } = {}) {
    this.container = container;
    this.onSensorClick = onSensorClick;
    this.temps = {};
    this.controlsState = null;
    this.target = 21;
    this.roomTemp = 21;
    this.sources = [];
    this.layers = { heatmap: true, air: true, volume: false, labels: true };
    this.clock = new THREE.Clock();
    this.windowState = 'closed';
    this.doorOpen = false;
    this.heaterGlow = 0;

    this._setupRenderer();
    this._setupScene();
    this._setupControls();
    window.addEventListener('resize', () => this._resize());
    this._resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  // ------------------------------------------------------------------ setup

  _setupRenderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, SMALL_SCREEN ? 1.5 : 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(r.domElement);
    this.renderer = r;

    const labels = new CSS2DRenderer();
    labels.domElement.style.position = 'absolute';
    labels.domElement.style.inset = '0';
    labels.domElement.style.pointerEvents = 'none';
    this.container.appendChild(labels.domElement);
    this.labelRenderer = labels;
  }

  _setupScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.camera.position.set(11, 9, -15);

    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1f27, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.1);
    key.position.set(5, 8, -7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 5;
    key.target.position.set(-0.1, 0, -1.7);
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9cc8ff, 0.7);
    rim.position.set(-6, 5, 6);
    scene.add(rim);

    // studio floor: soft glow + contact shadows
    const glow = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshBasicMaterial({ map: studioFloorTexture(), transparent: true, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(-0.1, -0.012, -1.75);
    scene.add(glow);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.01;
    shadow.receiveShadow = true;
    scene.add(shadow);
  }

  _setupControls() {
    const c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.06;
    c.minDistance = 1.0;
    c.maxDistance = 17;
    c.maxPolarAngle = 1.47;
    c.target.set(...CAMERA_PRESETS.overview.target);
    c.autoRotateSpeed = 0.35;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.8;
    this.controls = c;

    // click a sensor (but not when the pointer was dragging the view)
    const ray = new THREE.Raycaster();
    let down = null;
    this.renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(p, this.camera);
      const hit = ray.intersectObjects(Object.values(this.sensorMeshes || {}).map(s => s.core))[0];
      if (hit) this.onSensorClick?.(hit.object.userData.sensor);
    });
  }

  // ------------------------------------------------------------------ the room

  async load(url, onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, e => e.total && onProgress?.(e.loaded / e.total));
    const model = gltf.scene;
    model.scale.setScalar(0.01);
    model.traverse(obj => {
      if (HIDDEN_NODES.includes(obj.name)) obj.visible = false;
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        const m = obj.material;
        if (m?.name === 'walls') { m.color.set(0xe9e6e1); m.roughness = 0.92; }
        if (m?.name === 'dark_glass') { m.transparent = true; m.opacity = 0.85; }
      }
      if (/^air\.?exit$/.test(obj.name)) this.vent = obj;
    });
    this.scene.add(model);
    this.model = model;

    this._buildWindow();
    this._buildDoor();
    this._buildHeater();
    this._buildHeatSurfaces();
    this._buildHaze();
    this._buildParticles();
    this._buildSensors();
    this._resize();
  }

  _frameMaterial() {
    return new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.35 });
  }

  _buildWindow() {
    const x = ROOM.leftWallX;
    const w = WINDOW.z1 - WINDOW.z0, h = WINDOW.y1 - WINDOW.y0;
    const zc = (WINDOW.z0 + WINDOW.z1) / 2, yc = (WINDOW.y0 + WINDOW.y1) / 2;
    const group = new THREE.Group();

    // what you see through the window: a sky tinted by the outside temperature
    this.skyMaterial = new THREE.MeshBasicMaterial({ color: 0x9cc9f0 });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.skyMaterial);
    sky.rotation.y = Math.PI / 2;
    sky.position.set(x + 0.003, yc, zc);
    group.add(sky);

    const frame = this._frameMaterial();
    const t = 0.06, d = 0.1;
    for (const [sx, sy, sz, px, py, pz] of [
      [d, t, w + 2 * t, x + d / 2, WINDOW.y1 + t / 2, zc], [d, t, w + 2 * t, x + d / 2, WINDOW.y0 - t / 2, zc],
      [d, h, t, x + d / 2, yc, WINDOW.z0 - t / 2], [d, h, t, x + d / 2, yc, WINDOW.z1 + t / 2],
    ]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frame);
      bar.position.set(px, py, pz);
      bar.castShadow = true;
      group.add(bar);
    }
    // window sill
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, w + 0.24), new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.6 }));
    sill.position.set(x + 0.1, WINDOW.y0 - t - 0.015, zc);
    group.add(sill);

    // the sash: tilts around its bottom edge, swings around its side hinge
    this.tiltPivot = new THREE.Group();
    this.tiltPivot.position.set(x + 0.06, WINDOW.y0, WINDOW.z1);
    this.hingePivot = new THREE.Group();
    this.tiltPivot.add(this.hingePivot);
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshPhysicalMaterial({ color: 0xd6ecff, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.rotation.y = Math.PI / 2;
    glass.position.set(0, h / 2, -w / 2);
    this.hingePivot.add(glass);
    const sashFrame = this._frameMaterial();
    for (const [sx, sy, sz, py, pz] of [[0.04, 0.035, w, h, -w / 2], [0.04, 0.035, w, 0, -w / 2], [0.04, h, 0.035, h / 2, 0], [0.04, h, 0.035, h / 2, -w]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), sashFrame);
      bar.position.set(0, py, pz);
      this.hingePivot.add(bar);
    }
    group.add(this.tiltPivot);
    this.scene.add(group);
  }

  _buildDoor() {
    const x = ROOM.leftWallX;
    const w = DOOR.z1 - DOOR.z0, h = DOOR.y1 - DOOR.y0, zc = (DOOR.z0 + DOOR.z1) / 2;
    const corridor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x3a3228 }));
    corridor.rotation.y = Math.PI / 2;
    corridor.position.set(x + 0.003, h / 2, zc);
    this.scene.add(corridor);
    const frame = this._frameMaterial();
    for (const [sx, sy, sz, py, pz] of [[0.1, 0.07, w + 0.14, h + 0.035, zc], [0.1, h, 0.07, h / 2, DOOR.z0 - 0.035], [0.1, h, 0.07, h / 2, DOOR.z1 + 0.035]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frame);
      bar.position.set(x + 0.05, py, pz);
      bar.castShadow = true;
      this.scene.add(bar);
    }
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(x + 0.03, 0, DOOR.z1);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.045, h - 0.02, w - 0.02), new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.55 }));
    panel.position.set(0.0225, (h - 0.02) / 2, -w / 2);
    panel.castShadow = true;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 12), new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.9, roughness: 0.25 }));
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0.075, 1.0, -w + 0.12);
    this.doorPivot.add(panel, handle);
    this.scene.add(this.doorPivot);
  }

  _buildHeater() {
    if (this.vent) {
      this.vent.traverse(o => {
        if (o.isMesh) {
          o.material = o.material.clone(); // shared with the forks on the table
          o.material.emissive = new THREE.Color(0xff7a2e);
          o.material.emissiveIntensity = 0;
          this.ventMaterial = o.material;
        }
      });
    }
    this.heaterLight = new THREE.PointLight(0xff8a3d, 0, 2.6, 2);
    this.heaterLight.position.set(HEATER.x, HEATER.y + 0.25, HEATER.z - 0.2);
    this.scene.add(this.heaterLight);
  }

  _buildHeatSurfaces() {
    this.fieldUniforms = makeFieldUniforms(0.85);
    const make = (w, h, grid) => new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.ShaderMaterial({
        uniforms: { ...this.fieldUniforms, uGrid: { value: grid } },
        vertexShader: SURFACE_VERTEX,
        fragmentShader: SURFACE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
      }),
    );
    const sx = ROOM.max.x - ROOM.min.x, sz = ROOM.max.z - ROOM.min.z, sy = ROOM.max.y;
    const floor = make(sx, sz, 16);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((ROOM.min.x + ROOM.max.x) / 2, 0.004, (ROOM.min.z + ROOM.max.z) / 2);
    const left = make(sz, sy, 0);
    left.rotation.y = Math.PI / 2;
    left.position.set(ROOM.leftWallX + 0.005, sy / 2, (ROOM.min.z + ROOM.max.z) / 2);
    const back = make(sx, sy, 0);
    back.rotation.y = Math.PI;
    back.position.set((ROOM.min.x + ROOM.max.x) / 2, sy / 2, ROOM.backWallZ - 0.005);
    this.surfaces = new THREE.Group();
    this.surfaces.add(floor, left, back);
    for (const m of [left, back]) m.material.uniforms.uOpacity = { value: 0.5 };
    this.scene.add(this.surfaces);
  }

  _buildHaze() {
    this.haze = new THREE.Group();
    const sx = ROOM.max.x - ROOM.min.x - 0.1, sz = ROOM.max.z - ROOM.min.z - 0.1;
    this.hazeUniforms = makeFieldUniforms(0.07);
    for (let i = 0; i < 12; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), new THREE.ShaderMaterial({
        uniforms: this.hazeUniforms, vertexShader: SURFACE_VERTEX, fragmentShader: HAZE_FRAGMENT,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((ROOM.min.x + ROOM.max.x) / 2, 0.15 + i * 0.18, (ROOM.min.z + ROOM.max.z) / 2);
      this.haze.add(plane);
    }
    this.haze.visible = this.layers.volume;
    this.scene.add(this.haze);
  }

  _buildParticles() {
    const n = SMALL_SCREEN ? 1100 : 2600;
    this.particleCount = n;
    this.pPos = new Float32Array(n * 3);
    this.pVel = new Float32Array(n * 3);
    this.pCol = new Float32Array(n * 3);
    this.pPhase = new Float32Array(n);
    for (let i = 0; i < n; i++) { this._respawn(i, false); this.pPhase[i] = Math.random() * 100; }
    this.pAlpha = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    // Each particle has its own transparency: air at the comfort temperature is invisible,
    // clearly cold or warm air shows. Normal blending, so nothing turns into white "snow".
    this.particleUniforms = { uSize: { value: 0.035 }, uScale: { value: 450 } };
    this.particles = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.particleUniforms,
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float alpha;
        uniform float uSize, uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
    }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  _respawn(i, atOpening) {
    const p = this.pPos, v = this.pVel;
    const open = { closed: 0, tilted: 0.5, open: 1 }[this.controlsState?.window] || 0;
    if (atOpening && open && Math.random() < 0.45) {
      p[i * 3] = ROOM.leftWallX + 0.08;
      p[i * 3 + 1] = WINDOW.y0 + Math.random() * (WINDOW.y1 - WINDOW.y0) * (open < 1 ? 0.35 : 1) + (open < 1 ? (WINDOW.y1 - WINDOW.y0) * 0.65 : 0);
      p[i * 3 + 2] = WINDOW.z0 + Math.random() * (WINDOW.z1 - WINDOW.z0);
    } else if (atOpening && this.controlsState?.door_open && Math.random() < 0.3) {
      p[i * 3] = ROOM.leftWallX + 0.08;
      p[i * 3 + 1] = Math.random() * 1.9;
      p[i * 3 + 2] = DOOR.z0 + Math.random() * (DOOR.z1 - DOOR.z0);
    } else {
      p[i * 3] = ROOM.min.x + 0.1 + Math.random() * (ROOM.max.x - ROOM.min.x - 0.2);
      p[i * 3 + 1] = 0.08 + Math.random() * 2.25;
      p[i * 3 + 2] = ROOM.min.z + 0.1 + Math.random() * (ROOM.max.z - ROOM.min.z - 0.2);
    }
    v[i * 3] = v[i * 3 + 1] = v[i * 3 + 2] = 0;
  }

  _buildSensors() {
    this.sensorMeshes = {};
    const halo = softDotTexture();
    for (const [name, info] of Object.entries(SENSORS)) {
      const group = new THREE.Group();
      group.position.set(...info.pos);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.04, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.3 }));
      core.userData.sensor = name;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
      glow.scale.setScalar(0.32);
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
      ring.scale.setScalar(0.5);
      const el = document.createElement('div');
      el.className = 'label3d';
      el.innerHTML = `<div class="pill"><span class="swatch"></span><span class="lname">${info.label}</span><span class="lvalue">—</span></div>`;
      el.addEventListener('click', () => this.onSensorClick?.(name));
      const label = new CSS2DObject(el);
      label.position.set(0, 0.06, 0);
      group.add(core, glow, ring, label);
      this.scene.add(group);
      this.sensorMeshes[name] = { group, core, glow, ring, el, phase: Math.random() * 6 };
    }
  }

  // ------------------------------------------------------------------ updates from the app

  setState({ temps, controls, target, room, heaterRunning }) {
    this.temps = temps;
    this.target = target;
    this.roomTemp = room ?? this.roomTemp;
    if (controls) {
      if (controls.window !== this.windowState) this._animateWindow(controls.window);
      if (!!controls.door_open !== this.doorOpen) this._animateDoor(!!controls.door_open);
      // a muted sky: wintry blue-grey when it's cold outside, warm haze when it's hot
      const sky = colorFor(controls.outside_c, 15);
      this.skyMaterial.color.setRGB(0.5 + sky[0] * 0.32, 0.55 + sky[1] * 0.3, 0.6 + sky[2] * 0.28, THREE.SRGBColorSpace);
    }
    this.controlsState = controls;
    const heaterOn = heaterRunning ?? (temps.Heater != null && room != null && temps.Heater - room > 4);
    this.heaterTarget = heaterOn ? 1 : 0;
    this.sources = buildSources(temps, controls, room);
  }

  updateLabels() {
    for (const [name, s] of Object.entries(this.sensorMeshes || {})) {
      const t = this.temps[name];
      const bad = t == null;
      s.el.classList.toggle('bad', bad);
      s.el.querySelector('.lvalue').textContent = bad ? 'No signal' : `${t.toFixed(1)}°`;
      s.el.querySelector('.swatch').style.color = s.el.querySelector('.swatch').style.background = bad ? '#ff7a6b' : cssColor(t, this.target);
    }
  }

  setLayers(layers) {
    Object.assign(this.layers, layers);
    if (this.surfaces) this.surfaces.visible = this.layers.heatmap;
    if (this.particles) this.particles.visible = this.layers.air;
    if (this.haze) this.haze.visible = this.layers.volume;
    this.labelRenderer.domElement.classList.toggle('labels-hidden', !this.layers.labels);
    this.controls.autoRotate = !!this.layers.rotate;
  }

  flyTo(preset, duration = 1.6) {
    const view = typeof preset === 'string' ? CAMERA_PRESETS[preset] : preset;
    if (!view) return;
    gsap.killTweensOf(this.camera.position);
    gsap.killTweensOf(this.controls.target);
    gsap.to(this.camera.position, { x: view.pos[0], y: view.pos[1], z: view.pos[2], duration, ease: 'power3.inOut' });
    gsap.to(this.controls.target, { x: view.target[0], y: view.target[1], z: view.target[2], duration, ease: 'power3.inOut' });
  }

  flyToSensor(name) {
    const p = SENSORS[name].pos;
    const toCenter = new THREE.Vector3(-0.12 - p[0], 0, -1.75 - p[2]).normalize();
    const pos = [p[0] + toCenter.x * 2.2, p[1] + 0.6, p[2] + toCenter.z * 2.2];
    this.flyTo({ pos, target: p }, 1.4);
  }

  _animateWindow(state) {
    this.windowState = state;
    gsap.to(this.hingePivot.rotation, { y: state === 'open' ? -1.15 : 0, duration: 1.4, ease: 'power3.inOut' });
    gsap.to(this.tiltPivot.rotation, { z: state === 'tilted' ? -0.2 : 0, duration: 1.1, ease: 'power3.inOut' });
  }

  _animateDoor(open) {
    this.doorOpen = open;
    gsap.to(this.doorPivot.rotation, { y: open ? -1.25 : 0, duration: 1.5, ease: 'power3.inOut' });
  }

  // ------------------------------------------------------------------ every frame

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    this.controls.update();
    if (this.fieldUniforms) {
      writeUniforms(this.fieldUniforms, this.sources, this.target);
      writeUniforms(this.hazeUniforms, this.sources, this.target);
      this.hazeUniforms.uTime.value = time;
      this._stepParticles(dt, time);
      this._stepSensors(time);
      this.heaterGlow += ((this.heaterTarget || 0) - this.heaterGlow) * Math.min(1, dt * 1.5);
      if (this.ventMaterial) this.ventMaterial.emissiveIntensity = this.heaterGlow * 2.2;
      this.heaterLight.intensity = this.heaterGlow * 1.4;
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  _stepParticles(dt, time) {
    if (!this.particles?.visible || !this.sources.length) return;
    const p = this.pPos, v = this.pVel, col = this.pCol, phase = this.pPhase;
    const c = this.controlsState;
    const open = { closed: 0, tilted: 0.5, open: 1 }[c?.window] || 0;
    const zc = (WINDOW.z0 + WINDOW.z1) / 2, dzc = (DOOR.z0 + DOOR.z1) / 2;
    const room = this.roomTemp;
    for (let i = 0; i < this.particleCount; i++) {
      const k = i * 3;
      const x = p[k], y = p[k + 1], z = p[k + 2];
      const t = sample(this.sources, x, y, z) ?? room;
      // warm air rises, cold air sinks, plus a slow drift
      let ax = Math.sin(time * 0.3 + phase[i]) * 0.02;
      let ay = (t - room) * 0.05;
      let az = Math.cos(time * 0.27 + phase[i] * 1.3) * 0.02;
      if (open && x < ROOM.leftWallX + 1.8 && Math.abs(z - zc) < 1.4) { ax += 0.32 * open; ay -= 0.12 * open; }
      if (c?.door_open && x < ROOM.leftWallX + 1.4 && Math.abs(z - dzc) < 1.0) { ax += 0.18; }
      const dh = Math.hypot(x - HEATER.x, z - HEATER.z);
      if (this.heaterGlow > 0.3 && dh < 0.9 && y < 1.6) { ay += 0.25 * this.heaterGlow; ax += 0.05; az -= 0.08; }
      v[k] = v[k] * 0.96 + ax * dt;
      v[k + 1] = v[k + 1] * 0.96 + ay * dt;
      v[k + 2] = v[k + 2] * 0.96 + az * dt;
      p[k] += v[k] * dt * 6; p[k + 1] += v[k + 1] * dt * 6; p[k + 2] += v[k + 2] * dt * 6;
      if (p[k] < ROOM.min.x + 0.03 || p[k] > ROOM.max.x - 0.03 || p[k + 1] < 0.03 || p[k + 1] > 2.37 ||
          p[k + 2] < ROOM.min.z + 0.03 || p[k + 2] > ROOM.max.z - 0.03 || Math.random() < 0.0015) {
        this._respawn(i, true);
      }
      // near the target the air is invisible; it shows where it is clearly cold or warm
      const rgb = colorFor(t, this.target);
      const strength = Math.min(1, Math.abs(t - this.target) / 4);
      col[k] = rgb[0]; col[k + 1] = rgb[1]; col[k + 2] = rgb[2];
      this.pAlpha[i] = Math.max(0, strength - 0.12) * 0.95;
    }
    const attrs = this.particles.geometry.attributes;
    attrs.position.needsUpdate = attrs.color.needsUpdate = attrs.alpha.needsUpdate = true;
  }

  _stepSensors(time) {
    for (const [name, s] of Object.entries(this.sensorMeshes)) {
      const t = this.temps[name];
      const rgb = t == null ? [1, 0.45, 0.4] : colorFor(t, this.target);
      s.core.material.emissive.setRGB(rgb[0], rgb[1], rgb[2]);
      s.glow.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
      s.ring.material.color.setRGB(rgb[0], rgb[1], rgb[2]);
      const pulse = (time * 0.6 + s.phase) % 1;
      s.ring.scale.setScalar(0.2 + pulse * 0.6);
      s.ring.material.opacity = (1 - pulse) * (t == null ? 0.7 : 0.4);
    }
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < 820 ? 50 : 38;
    this.camera.updateProjectionMatrix();
    if (this.particleUniforms) this.particleUniforms.uScale.value = h * this.renderer.getPixelRatio() / 2;
  }
}
