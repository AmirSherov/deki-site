/* DEKI — WebGL stage.
   One reel (modelled in Blender, 3d/build_reel.py) lives on a fixed canvas and
   travels between `.reel-slot` placeholders as the page scrolls: it docks in a
   slot, then morphs (position, size, orientation, an extra turn) into the next
   one when both are near the viewport. A particle field drifts behind it. */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
const D = (window.DEKI = window.DEKI || {});
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('gl');
// same profile as main.js: touch devices get a lighter pipeline
const lite = D.lite ?? (!matchMedia('(hover: hover) and (pointer: fine)').matches || innerWidth < 760);

function fail() {
  root.classList.add('no-webgl');
  canvas.remove();
  dispatchEvent(new Event('deki:scene-ready'));
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  fail();
}

if (renderer) start();

function start() {
  // quality ladder: start high, step down if the device can't hold the frame rate
  const LADDER = lite ? [1.5, 1.25, 1, 0.85] : [1.75, 1.5, 1.25, 1];
  let q = 0;
  const dprFor = (i) => Math.min(devicePixelRatio, LADDER[i]);
  renderer.setPixelRatio(dprFor(q));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;   // the aurora pass and the main scene share one frame

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const CAM_Z = 12;
  camera.position.set(0, 0, CAM_Z);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-4, 5, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0x9b3bff, 60, 30, 1.6);
  rim.position.set(5, 2, -3);
  scene.add(rim);
  const under = new THREE.PointLight(0x5aff1f, 18, 20, 1.8);
  under.position.set(-3, -4, 3);
  scene.add(under);

  /* ── aurora background: domain-warped noise in the brand violet/green, lit by the mouse ── */
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, transparent: true,
    uniforms: { uTime: { value: 0 }, uMouse: { value: new THREE.Vector2(0, 0) }, uRes: { value: new THREE.Vector2(1, 1) }, uScroll: { value: 0 }, uFade: { value: 0 }, uOct: { value: lite ? 2 : 4 } },
    vertexShader: /* glsl */ `void main(){ gl_Position = vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uScroll, uFade; uniform vec2 uMouse, uRes; uniform int uOct;
      vec3 hash3(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yxz + 19.19); return fract((p.xxy + p.yxx) * p.zyx); }
      float noise(vec3 p){
        vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        float n = 0.0;
        for (int z=0; z<2; z++) for (int y=0; y<2; y++) for (int x=0; x<2; x++) {
          vec3 o = vec3(x,y,z);
          vec3 w = mix(1.0-f, f, o);
          n += hash3(i+o).x * w.x * w.y * w.z;
        }
        return n;
      }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i=0;i<4;i++){ if (i>=uOct) break; s += a*noise(p); p = p*2.03 + 11.3; a *= 0.5; } return s; }
      void main(){
        vec2 uv = gl_FragCoord.xy / uRes;
        vec2 p = (uv - 0.5) * vec2(uRes.x/uRes.y, 1.0);
        float t = uTime * 0.075;
        // bigger, slower shapes that fill the whole screen
        vec3 q = vec3(p * 0.78, t + uScroll * 0.35);
        float w1 = fbm(q + vec3(fbm(q*1.3 + 3.1), fbm(q*1.1 - 2.4), 0.0) * 1.15);
        float w2 = fbm(q*1.6 - vec3(w1, w1*0.7, 0.3) * 1.2);
        float w3 = fbm(q*0.6 + vec3(w2*0.8, -w1, 1.7));
        vec3 deep   = vec3(0.16, 0.0, 0.42);
        vec3 violet = vec3(0.537, 0.102, 1.0);
        vec3 lilac  = vec3(0.69, 0.40, 1.0);
        vec3 magenta= vec3(0.78, 0.10, 1.0);
        vec3 green  = vec3(0.345, 1.0, 0.0);
        vec3 col = mix(deep, violet, smoothstep(0.18, 0.7, w1));
        col = mix(col, magenta, smoothstep(0.45, 0.7, w3) * 0.5);
        col = mix(col, lilac, smoothstep(0.55, 0.8, w1) * 0.75);
        col = mix(col, green, smoothstep(0.47, 0.7, w2) * 0.8);
        // inner glow on the densest folds
        col += lilac * pow(smoothstep(0.4, 0.85, w1), 3.0) * 1.1;
        col += green * pow(smoothstep(0.45, 0.8, w2), 3.0) * 0.8;
        // mouse light
        vec2 m = uMouse * vec2(uRes.x/uRes.y, 1.0) * 0.5;
        float d = length(p - m);
        col += mix(violet, lilac, 0.5) * exp(-d*d*4.0) * 0.5;
        // bright ridges, like northern lights: two layers at different scales
        float r1 = 1.0 - smoothstep(0.0, 0.06, abs(fract(w1*3.0 + t) - 0.5) - 0.44);
        float r2 = 1.0 - smoothstep(0.0, 0.05, abs(fract(w2*4.0 - t*1.3) - 0.5) - 0.45);
        col += lilac * r1 * 0.35 * smoothstep(0.25, 0.65, w1);
        col += green * r2 * 0.3 * smoothstep(0.4, 0.65, w2);
        // push saturation
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = max(mix(vec3(l), col, 1.35), 0.0);
        // soft vignette: the aurora reaches the edges now
        float vig = smoothstep(2.0, 0.1, length(p * vec2(0.85, 1.0)));
        float a = clamp((0.2 + 0.95 * smoothstep(0.3, 0.72, w1) + 0.4 * smoothstep(0.45, 0.7, w2)) * vig, 0.0, 1.0) * uFade;
        gl_FragColor = vec4(col * a * 1.35, a);
      }`,
  });
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

  /* ── particles ── */
  const COUNT = lite ? 420 : 1600;
  const pos = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const col = new Float32Array(COUNT * 3);
  const palette = [new THREE.Color('#5aff1f'), new THREE.Color('#b46bff'), new THREE.Color('#ffffff'), new THREE.Color('#8b1cff')];
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 26;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
    pos[i * 3 + 2] = -14 + Math.random() * 16;
    seed[i] = Math.random();
    const c = palette[Math.random() < 0.55 ? 2 : Math.floor(Math.random() * 4)];
    col.set([c.r, c.g, c.b], i * 3);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScroll: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uSpeed: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; attribute vec3 aColor;
      uniform float uTime, uScroll, uPx, uSpeed;
      varying vec3 vColor; varying float vA;
      void main() {
        vec3 p = position;
        float depth = (p.z + 14.0) / 16.0;                  // 0 far → 1 near
        p.y += uScroll * (0.4 + depth * 1.6);
        p.y = mod(p.y + 8.0, 16.0) - 8.0;                   // wrap vertically
        p.x += sin(uTime * 0.2 + aSeed * 40.0) * 0.3;
        p.y += cos(uTime * 0.17 + aSeed * 30.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 50.0);
        gl_PointSize = (1.2 + aSeed * 2.6) * uPx * (1.0 + uSpeed * 0.8) * (14.0 / -mv.z);
        vColor = aColor; vA = tw * (0.25 + depth * 0.75);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor, a * vA * 0.7);
      }`,
  });
  scene.add(new THREE.Points(pGeo, pMat));

  /* ── reel rig: root (slot position/scale) → tilt (orientation) → model ── */
  const rig = new THREE.Group();
  const tilt = new THREE.Group();
  const holder = new THREE.Group();
  rig.add(tilt);
  tilt.add(holder);
  scene.add(rig);
  rig.visible = false;

  // soft violet halo behind the reel
  const haloTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(160,80,255,0.55)');
    gr.addColorStop(0.35, 'rgba(139,28,255,0.22)');
    gr.addColorStop(1, 'rgba(139,28,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(5.5, 5.5, 1);
  halo.position.z = -1.2;
  rig.add(halo);

  const Phys = lite ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial;   // no clearcoat/sheen passes on phones
  const M = (o) => {
    if (lite) ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor'].forEach((k) => delete o[k]);
    return new Phys(o);
  };
  const MATS = {
    Tape: M({ color: 0x050506, metalness: 0.35, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }),
    Inlay: M({ color: 0xd9a441, metalness: 1, roughness: 0.22, envMapIntensity: 1.6 }),
    Disc: M({ color: 0x3cff00, emissive: 0x2ad000, emissiveIntensity: 0.35, metalness: 0, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, sheen: 0.4, sheenColor: new THREE.Color(0xc8ff9a) }),
    Hub: M({ color: 0x2fc800, emissive: 0x1a9000, emissiveIntensity: 0.3, roughness: 0.4, clearcoat: 0.5 }),
  };

  let spinner = null;     // disc + hub rotate like a playing reel
  let modelH = 2.42;

  const manager = new THREE.LoadingManager();
  manager.onProgress = (_, loaded, total) => dispatchEvent(new CustomEvent('deki:progress', { detail: loaded / total }));
  new GLTFLoader(manager).load(
    'assets/3d/deki_reel.glb',
    (gltf) => {
      const model = gltf.scene;
      spinner = new THREE.Group();
      const parts = [];
      model.traverse((o) => { if (o.isMesh) parts.push(o); });
      parts.forEach((o) => {
        const name = (o.material && o.material.name) || o.name;
        const key = Object.keys(MATS).find((k) => name.startsWith(k) || o.name.startsWith(k));
        if (key) o.material = MATS[key];
        if (key === 'Disc' || key === 'Hub') spinner.attach(o);
      });
      model.add(spinner);
      const box = new THREE.Box3().setFromObject(model);
      const c = box.getCenter(new THREE.Vector3());
      modelH = box.max.y - box.min.y;
      model.position.sub(c);          // centre the whole "d" in its slot
      holder.add(model);
      rig.visible = true;
      dispatchEvent(new Event('deki:scene-ready'));
    },
    (e) => e.total && dispatchEvent(new CustomEvent('deki:progress', { detail: e.loaded / e.total })),
    () => fail()
  );

  /* ── slots ── */
  const slots = [...document.querySelectorAll('[data-reel]')].map((el, id) => ({
    el, id,
    rx: Number(el.dataset.rx || 0),
    ry: Number(el.dataset.ry || 0),
    s: Number(el.dataset.scale || 1),
  }));

  function measureSlots() {
    const sx = scrollX, sy = scrollY;
    slots.forEach((s) => {
      const r = s.el.getBoundingClientRect();
      s.x = r.left + sx + r.width / 2;
      s.y = r.top + sy + r.height / 2;
      s.h = Math.min(r.height, r.width * 1.15);
    });
  }
  measureSlots();
  addEventListener('load', measureSlots);
  document.fonts && document.fonts.ready.then(measureSlots);
  if (window.ScrollTrigger) window.ScrollTrigger.addEventListener('refresh', measureSlots);

  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  let vw = 0, vh = 0, worldH = 1, worldW = 1;
  function resize() {
    // on phones the URL bar changes innerHeight while scrolling; keep the tallest
    // canvas we've seen so we don't reallocate the framebuffer mid-scroll
    const w = innerWidth;
    const h = lite && w === vw ? Math.max(vh, innerHeight) : innerHeight;
    if (w === vw && h === vh) return;
    vw = w; vh = h;
    renderer.setSize(vw, vh, true);
    camera.aspect = vw / vh;
    camera.updateProjectionMatrix();
    worldH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_Z;
    worldW = worldH * camera.aspect;
    bgMat.uniforms.uRes.value.set(vw * renderer.getPixelRatio(), vh * renderer.getPixelRatio());
  }
  resize();
  addEventListener('resize', () => { resize(); measureSlots(); });

  // where should the reel be right now? returns screen-space target
  function target() {
    const mid = innerHeight / 2;
    const sy = scrollY;
    const rs = slots.map((s) => ({ s, cx: s.x - scrollX, cy: s.y - sy, h: s.h }));
    let a = rs[0], b = null, t = 0;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].cy <= mid) a = rs[i];
      if (rs[i].cy > mid) { b = rs[i]; break; }
    }
    if (a && b && a !== b) {
      const span = b.cy - a.cy;
      if (span < innerHeight * 1.9) {
        t = smooth(THREE.MathUtils.clamp((mid - a.cy) / span, 0, 1));
      } else {
        // far apart: stay docked to whichever slot is nearer and scroll with it
        if (mid - a.cy > b.cy - mid) { a = b; }
        b = null;
      }
    } else if (!a || a.cy > mid) {
      a = rs[0]; b = null;
    }
    if (!b) return { key: `${a.s.id}`, cx: a.cx, cy: a.cy, h: a.h, rx: a.s.rx, ry: a.s.ry, turn: 0 };
    return {
      key: `${a.s.id}-${b.s.id}`,
      cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), h: lerp(a.h, b.h, t),
      rx: lerp(a.s.rx, b.s.rx, t), ry: lerp(a.s.ry, b.s.ry, t),
      turn: Math.sin(t * Math.PI) * 0.6 + t * Math.PI * 2,   // a full flip while travelling
    };
  }

  /* ── intro ── */
  let intro = reduce ? 1 : 0;
  addEventListener('deki:intro', () => {
    if (reduce || !window.gsap) { intro = 1; return; }
    const o = { v: 0 };
    window.gsap.to(o, { v: 1, duration: 2.2, ease: 'expo.out', delay: 0.1, onUpdate: () => (intro = o.v) });
  });

  /* ── loop ── */
  const clock = new THREE.Clock();
  const m = { x: 0, y: 0 };
  let spin = 0, turnS = 0, speed = 0;
  const cur = { x: 0, y: 0, s: 1, rx: 0, ry: 0 };
  let first = true, lastKey = '';
  const wrapPI = (x) => x - Math.PI * 2 * Math.round(x / (Math.PI * 2));
  let frameN = 0, ema = 1 / 60, settle = 0, onScreen = true;

  function adapt(rawDt) {
    if (document.hidden || rawDt > 0.25) return;            // tab switches aren't jank
    ema += (rawDt - ema) * 0.05;
    if (++settle < 90 || q >= LADDER.length - 1) return;   // let it warm up, then re-check
    if (ema > 1 / 50) {
      q++;
      settle = 0;
      renderer.setPixelRatio(dprFor(q));
      renderer.setSize(vw, vh, true);
      pMat.uniforms.uPx.value = renderer.getPixelRatio();
      bgMat.uniforms.uRes.value.set(vw * renderer.getPixelRatio(), vh * renderer.getPixelRatio());
      if (q >= 2) { pGeo.setDrawRange(0, Math.floor(COUNT * 0.6)); bgMat.uniforms.uOct.value = 2; }
    }
  }

  function frame() {
    requestAnimationFrame(frame);
    const rawDt = clock.getDelta();
    adapt(rawDt);
    const dt = Math.min(rawDt, 0.05);
    frameN++;
    const t = clock.elapsedTime;
    const vel = D.velocity || 0;
    speed += (Math.min(Math.abs(vel) / 40, 1) - speed) * 0.08;

    m.x += ((D.mouse ? D.mouse.x : 0) - m.x) * 0.05;
    m.y += ((D.mouse ? D.mouse.y : 0) - m.y) * 0.05;

    // aurora fades in with the intro
    bgMat.uniforms.uTime.value = t;
    bgMat.uniforms.uScroll.value = scrollY / Math.max(innerHeight, 1);
    bgMat.uniforms.uMouse.value.set(m.x, -m.y);
    bgMat.uniforms.uFade.value += (intro - bgMat.uniforms.uFade.value) * 0.03;

    pMat.uniforms.uTime.value = t;
    pMat.uniforms.uScroll.value = scrollY * 0.0025;
    pMat.uniforms.uSpeed.value = speed;
    camera.position.x = m.x * 0.35;
    camera.position.y = -m.y * 0.25;
    camera.lookAt(0, 0, 0);

    if (rig.visible) {
      const tg = target();
      // screen → world on the z=0 plane
      const wx = (tg.cx / vw - 0.5) * worldW;
      const wy = -(tg.cy / vh - 0.5) * worldH;
      const ws = (tg.h / vh) * worldH / modelH;
      // switching which off-screen slot we're parked at must not drag the reel
      // across the viewport — jump straight there instead
      const jump = tg.key !== lastKey && Math.abs(wy - cur.y) > worldH * 0.6;
      lastKey = tg.key;
      const k = first || jump ? 1 : (lite ? 0.3 : 0.14);
      first = false;
      cur.x += (wx - cur.x) * k;
      cur.y += (wy - cur.y) * k;
      cur.s += (ws - cur.s) * k;
      cur.rx += (tg.rx - cur.rx) * k;
      cur.ry += (tg.ry - cur.ry) * k;
      // a full turn equals no turn: ease along the shortest way so the reel never unwinds 360°
      turnS += wrapPI(tg.turn - turnS) * (jump ? 1 : 0.1);

      const e = intro;
      rig.position.set(cur.x, cur.y + (1 - e) * -1.2, 0);
      rig.scale.setScalar(Math.max(cur.s * (0.6 + 0.4 * e), 0.0001));
      tilt.rotation.x = cur.rx + m.y * 0.18 + Math.sin(t * 0.6) * 0.04;
      tilt.rotation.y = cur.ry + turnS + m.x * 0.3 + Math.sin(t * 0.4) * 0.08 + (1 - e) * -2.4;
      tilt.rotation.z = Math.sin(t * 0.5) * 0.03 - vel * 0.002;

      spin += dt * (0.5 + speed * 7) * Math.sign(vel || 1);
      if (spinner) spinner.rotation.z = -spin;
      halo.material.opacity = 0.65 + Math.sin(t * 1.3) * 0.12 + speed * 0.3;
      MATS.Disc.emissiveIntensity = 0.35 + speed * 0.6;

      // skip drawing the reel entirely while it is parked off-screen
      onScreen = Math.abs(cur.y) < worldH * 0.5 + cur.s * modelH && Math.abs(cur.x) < worldW * 0.5 + cur.s * modelH;
      tilt.visible = onScreen;
      halo.visible = onScreen;
    }

    // with only the particle dust on screen, phones can draw at half rate
    if (lite && !onScreen && (frameN & 1)) return;
    renderer.clear();
    renderer.render(bgScene, bgCam);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
