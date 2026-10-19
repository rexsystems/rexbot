import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { BotProfile } from "@rex/shared";

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(512, 512, false);
renderer.setScissorTest(true);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const camera = new THREE.PerspectiveCamera(36, 1, .1, 20);
camera.position.set(0, .16, 2.8);
camera.lookAt(0, -.04, 0);
const sphere = new THREE.SphereGeometry(.62, 32, 24);
const geometries: Record<BotProfile["shape"], THREE.BufferGeometry> = {
  orb: sphere,
  pebble: sphere.clone().scale(1.08, .86, .95),
  cube: new RoundedBoxGeometry(1.1, 1.1, 1, 5, .22),
  capsule: new THREE.CapsuleGeometry(.46, .36, 12, 32).rotateZ(Math.PI / 2),
  diamond: new THREE.OctahedronGeometry(.77, 0),
};
const eyeGeometry = new THREE.SphereGeometry(1, 20, 16);
const white = new THREE.MeshStandardMaterial({ color: "#fffaf4", roughness: .19 });
const iris = new THREE.MeshStandardMaterial({ color: "#132a3d", roughness: .24, metalness: .1 });
const glint = new THREE.MeshBasicMaterial({ color: "white" });
const mouthMaterial = new THREE.MeshStandardMaterial({ color: "#17313a", roughness: .8 });
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = shadowCanvas.height = 64;
const shadowContext = shadowCanvas.getContext("2d")!;
const shadowGradient = shadowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
shadowGradient.addColorStop(0, "rgba(0,0,0,.45)");
shadowGradient.addColorStop(1, "rgba(0,0,0,0)");
shadowContext.fillStyle = shadowGradient;
shadowContext.fillRect(0, 0, 64, 64);
const shadowMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false });
const shadowGeometry = new THREE.PlaneGeometry(1.65, 1.65);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

interface AvatarView {
  canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; scene: THREE.Scene;
  character: THREE.Group; eyes: THREE.Group[]; bodyMaterial: THREE.MeshPhysicalMaterial;
  mouthGeometry: THREE.BufferGeometry; bot: BotProfile; visible: boolean; drawn: boolean; reduced?: boolean;
}
const views = new Set<AvatarView>();
let frame = 0;
let lastRender = 0;

function draw(view: AvatarView, time: number) {
  const reduced = reducedMotion.matches;
  const animated = !reduced && (view.bot.motion !== "still" || view.bot.blink);
  if (view.drawn && !animated && view.reduced === reduced) return;
  view.reduced = reduced;
  const t = reduced ? 0 : time / 1000;
  view.character.rotation.set(0, 0, 0);
  view.character.position.y = 0;
  if (!reduced) {
    if (view.bot.motion === "float") { view.character.position.y = Math.sin(t * 1.4) * .055; view.character.rotation.z = Math.sin(t * .8) * .045; }
    if (view.bot.motion === "orbit") { view.character.rotation.y = Math.sin(t * .8) * .4; view.character.rotation.z = Math.sin(t * .8) * .065; }
    if (view.bot.motion === "spin") view.character.rotation.y = t * .65;
  }
  const blinkPhase = (t % 5.2) / 5.2;
  const blink = !reduced && view.bot.blink && blinkPhase > .91 && blinkPhase < .97 ? Math.max(.045, Math.abs(blinkPhase - .94) / .03) : 1;
  for (const eye of view.eyes) eye.scale.y = blink;
  const size = Math.min(512, Math.max(32, Math.round(view.canvas.getBoundingClientRect().width * Math.min(devicePixelRatio, 2))));
  if (view.canvas.width !== size) { view.canvas.width = view.canvas.height = size; }
  renderer.setViewport(0, 0, size, size);
  renderer.setScissor(0, 0, size, size);
  renderer.render(view.scene, camera);
  view.context.clearRect(0, 0, size, size);
  view.context.drawImage(renderer.domElement, 0, 512 - size, size, size, 0, 0, size, size);
  view.canvas.dataset.renderer = "webgl";
  view.canvas.dataset.motion = reduced ? "paused" : view.bot.motion;
  view.canvas.dataset.blink = String(!reduced && view.bot.blink);
  view.drawn = true;
}

function animate(time: number) {
  frame = requestAnimationFrame(animate);
  if (document.hidden || time - lastRender < 1000 / 24) return;
  lastRender = time;
  for (const view of views) if (view.visible && view.canvas.isConnected) draw(view, time);
}

export function mountAvatar(canvas: HTMLCanvasElement, bot: BotProfile) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x3d2830, 2.7));
  const key = new THREE.DirectionalLight(0xfff2dc, 3.5);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa5d3ff, 2.5);
  rim.position.set(3, 1, -3);
  scene.add(rim);
  const character = new THREE.Group();
  scene.add(character);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({ color: bot.color, roughness: .28, metalness: .03, clearcoat: .7, clearcoatRoughness: .22 });
  character.add(new THREE.Mesh(geometries[bot.shape], bodyMaterial));
  function surfaceZ(x: number, y: number) {
    if (bot.shape === "cube") return .5;
    if (bot.shape === "diamond") return .77 - Math.abs(x) - Math.abs(y);
    if (bot.shape === "capsule") return Math.sqrt(.46 ** 2 - y ** 2);
    if (bot.shape === "pebble") return Math.sqrt(.62 ** 2 - (x / 1.08) ** 2 - (y / .86) ** 2) * .95;
    return Math.sqrt(.62 ** 2 - x ** 2 - y ** 2);
  }
  const eyes: THREE.Group[] = [];
  for (const x of [-.205, .205]) {
    const eye = new THREE.Group();
    eye.position.set(x, .12, surfaceZ(x, .12) - .018);
    const whiteBall = new THREE.Mesh(eyeGeometry, white);
    whiteBall.scale.set(.145, .175, .12);
    eye.add(whiteBall);
    const pupil = new THREE.Mesh(eyeGeometry, iris);
    pupil.position.set(.018, -.008, .103);
    pupil.scale.set(.072, .095, .045);
    eye.add(pupil);
    const highlight = new THREE.Mesh(eyeGeometry, glint);
    highlight.position.set(.035, .034, .14);
    highlight.scale.set(.024, .03, .012);
    eye.add(highlight);
    character.add(eye);
    eyes.push(eye);
  }
  const curve = new THREE.CatmullRomCurve3([[-.13, -.19], [-.07, -.235], [0, -.255], [.07, -.235], [.13, -.19]].map(([x, y]) => new THREE.Vector3(x!, y!, surfaceZ(x!, y!) + .018)));
  const mouthGeometry = new THREE.TubeGeometry(curve, 20, .016, 6, false);
  character.add(new THREE.Mesh(mouthGeometry, mouthMaterial));
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -.73;
  scene.add(shadow);
  const view: AvatarView = { canvas, context, scene, character, eyes, bodyMaterial, mouthGeometry, bot, visible: true, drawn: false };
  const observer = new IntersectionObserver(([entry]) => { view.visible = Boolean(entry?.isIntersecting); });
  observer.observe(canvas);
  views.add(view);
  draw(view, performance.now());
  if (!frame) frame = requestAnimationFrame(animate);
  return () => {
    observer.disconnect();
    views.delete(view);
    bodyMaterial.dispose();
    mouthGeometry.dispose();
    if (!views.size) { cancelAnimationFrame(frame); frame = 0; }
  };
}
