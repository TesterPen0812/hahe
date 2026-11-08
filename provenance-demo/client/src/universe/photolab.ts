// DEV-only photo lab (/photolab.html): galleries, every seal state, the live sequence and the
// forgery, under the scene's own bloom and tone mapping, without walking the scene.
// window.lab drives it for screenshots: lab.shot('gallery' | 'seals' | 'live0' | 'live1' | 'live2'),
// lab.qday(), lab.today(), lab.arrive(), lab.forge(), lab.reset(), lab.bg('blue' | 'prism'), lab.clean().
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { ItemSummary } from '@provenance-demo/shared'
import type { LiveArrival, SealPart } from './contract'
import { buildGallery, type GalleryPhoto, type SealVerdict } from './gallery'
import { createLiveSequence } from './liveSequence'
import { PhotoCard } from './photoCard'
import { labelFor, toLiveArrival } from './sealParts'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.95
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
const BG = { blue: new THREE.Color('#0a1022'), prism: new THREE.Color('#06070b') }
scene.background = BG.blue
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 300)
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.58))
composer.addPass(new OutputPass())
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight)
})

// a few motes so the glass has something behind it
{
  const n = 1400, pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 160, Math.random() * 8 - 1, -Math.random() * 80 - 14], i * 3)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#5b6fb0', size: 0.03, transparent: true, opacity: 0.45 })))
}

/** A plainly marked fake, like the toy break's. */
function forgedImage() {
  const c = document.createElement('canvas'); c.width = 900; c.height = 1200
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 0, 1200); g.addColorStop(0, '#2a2240'); g.addColorStop(1, '#b0624a')
  x.fillStyle = g; x.fillRect(0, 0, 900, 1200)
  x.fillStyle = '#140f1c'; x.beginPath(); x.moveTo(0, 900); x.lineTo(260, 640); x.lineTo(470, 860); x.lineTo(700, 560); x.lineTo(900, 820); x.lineTo(900, 1200); x.lineTo(0, 1200); x.fill()
  x.save(); x.translate(450, 420); x.rotate(-0.12); x.strokeStyle = '#ef6b5b'; x.lineWidth = 14; x.strokeRect(-260, -80, 520, 160)
  x.fillStyle = '#ef6b5b'; x.font = '900 120px -apple-system, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('FORGED', 0, 6); x.restore()
  return c.toDataURL('image/jpeg', 0.9)
}

const items: ItemSummary[] = await fetch('/api/items').then(r => r.json()).catch(() => [])
const green = (kind: 'legacy' | 'hybrid') => items.filter(i => i.verification.kind === kind && i.verification.status === 'green')
const legacy = green('legacy'), hybrid = green('hybrid')
const url = (list: ItemSummary[], i: number) => list.length ? list[i % list.length].imageUrl : forgedImage()

// ---- the gallery, straight down -z from the origin, Q-Day's wave from the start ----
const galleryPhotos: GalleryPhoto[] = [
  { id: 'L1', url: url(legacy, 0), kind: 'legacy' },
  { id: 'H1', url: url(hybrid, 0), kind: 'hybrid' },
  { id: 'L2', url: url(legacy, 1), kind: 'legacy' },
  { id: 'H2', url: url(hybrid, 1), kind: 'hybrid' },
]
const galleryPath = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -30), new THREE.Vector3(0, 0, -60)])
const gallery = buildGallery(galleryPhotos, galleryPath, 0.08, 0.32, 0, { ground: () => 0 })
scene.add(gallery.group)
const verdicts = new Map<string, SealVerdict>([
  ['L1', { status: 'green', anchored: true }],
  ['H1', { status: 'green', anchored: true }],
  ['L2', { status: 'grey', anchored: false }],
  ['H2', { status: 'amber', anchored: true }],
])
let qdayAt = -1

// ---- seal specimens: every state, side by side ----
const SPECIMENS: { parts: SealPart[]; kicker: string; tone?: 'mint' | 'brass' | 'rose' | 'ash'; reject?: boolean; lost?: boolean }[] = [
  { kicker: "Today's standard", parts: [{ alg: 'rsa-pss-2048', state: 'holds' }] },
  { kicker: 'Logged before Post-Quantum Day', tone: 'brass', parts: [{ alg: 'rsa-pss-2048', state: 'anchored' }] },
  { kicker: 'Not proven', tone: 'ash', lost: true, parts: [{ alg: 'rsa-pss-2048', state: 'broken' }] },
  { kicker: 'Verified human', tone: 'mint', parts: [{ alg: 'ml-dsa-65', state: 'holds' }, { alg: 'ed25519', state: 'holds' }, { alg: 'es256', state: 'holds' }] },
  { kicker: 'Device verified', tone: 'mint', parts: [{ alg: 'ml-dsa-65', state: 'holds' }, { alg: 'ed25519', state: 'broken' }, { alg: 'es256', state: 'broken' }] },
  { kicker: 'Rejected', tone: 'rose', reject: true, parts: [{ alg: 'rsa-toy-96', state: 'holds' }, { alg: 'ml-dsa-65', state: 'missing' }] },
]
const specimens: PhotoCard[] = []
const forged = forgedImage()
SPECIMENS.forEach((s, i) => {
  const card = new PhotoCard({ width: 2.3, seed: i * 0.7 })
  card.setParts(s.parts, { at: -100 })
  card.setLabel({ kicker: s.kicker, tone: s.tone, parts: s.parts })
  if (s.reject) card.reject = 1
  if (s.lost) card.lost = 1
  const col = i % 3, row = Math.floor(i / 3)
  card.mesh.position.set(40 + (col - 1) * 2.75, 4.3 - row * 3.3, -10)
  scene.add(card.mesh)
  void card.setPhoto(s.reject ? forged : url(i % 2 ? hybrid : legacy, i)).then(() => card.showPhoto(true))
  specimens.push(card)
})

// ---- the live sequence, straight down -z at x = -40 ----
const LX = -40
const live = createLiveSequence({
  path: { at: d => ({ position: new THREE.Vector3(LX, 0, -d), tangent: new THREE.Vector3(0, 0, -1) }), ground: () => 0 },
  start: 12, spacing: 11, host: 'phone',
})
scene.add(live.group)
let arrivals = 0
const nextArrival = (): LiveArrival => {
  const pick = hybrid[arrivals % Math.max(1, hybrid.length)]
  arrivals++
  if (pick) return { ...toLiveArrival(pick), id: `${pick.id}-${arrivals}` }
  return { id: `x${arrivals}`, url: forgedImage(), status: 'green', label: 'verified-human', parts: [{ alg: 'ml-dsa-65', state: 'holds' }, { alg: 'ed25519', state: 'holds' }, { alg: 'es256', state: 'holds' }] }
}

// ---- camera shots ----
const look = (from: THREE.Vector3, to: THREE.Vector3) => { camera.position.copy(from); camera.lookAt(to) }
const shots: Record<string, () => void> = {
  gallery: () => look(new THREE.Vector3(0, 1.3, 3), new THREE.Vector3(0, 1.6, -12)),
  gallery1: () => look(new THREE.Vector3(-0.6, 1.5, -2.5), new THREE.Vector3(-3.2, 1.9, -7.5)),
  seals: () => look(new THREE.Vector3(40, 2.7, -0.6), new THREE.Vector3(40, 2.7, -10)),
  seal: () => look(new THREE.Vector3(37.3, 4.3, -7.3), new THREE.Vector3(37.3, 4.3, -10)),
}
const liveShot = (i: number) => () => {
  const d = live.stations()[Math.min(i, live.stations().length - 1)]
  look(new THREE.Vector3(LX, 1.15, -d), new THREE.Vector3(LX, 1.6, -d - 6))
}
let current = 'gallery'
const lab = {
  shot(name: string) { current = name; (shots[name] ?? liveShot(Number(name.replace('live', '')) || 0))() },
  qday() { qdayAt = clock.getElapsedTime(); gallery.setVerdicts(verdicts) },
  today() { qdayAt = -1 },
  arrive() { live.arrive(nextArrival()) },
  forge() {
    const parts: SealPart[] = [{ alg: 'rsa-toy-96', state: 'holds' }, { alg: 'ml-dsa-65', state: 'missing' }]
    live.showForgery({ id: `forged-${arrivals++}`, url: forgedImage(), status: 'grey', label: 'unknown', parts, naiveStatus: 'green' })
  },
  reset() { live.reset(); arrivals = 0 },
  bg(name: 'blue' | 'prism') { scene.background = BG[name] },
  clean() { document.body.classList.toggle('clean') },
  stations: () => live.stations(),
  labelFor,
}
;(window as unknown as { lab: typeof lab }).lab = lab
const ui = document.getElementById('lab-ui')!
for (const [name, fn] of Object.entries({
  gallery: () => lab.shot('gallery'), 'gallery close': () => lab.shot('gallery1'), seals: () => lab.shot('seals'),
  live0: () => lab.shot('live0'), live1: () => lab.shot('live1'), live2: () => lab.shot('live2'),
  'Post-Quantum Day': lab.qday, today: lab.today, arrive: lab.arrive, forge: lab.forge, reset: lab.reset,
  blue: () => lab.bg('blue'), prism: () => lab.bg('prism'), hide: lab.clean,
})) {
  const b = document.createElement('button'); b.textContent = name; b.onclick = fn; ui.appendChild(b)
}

const clock = new THREE.Clock()
lab.shot(current)
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime()
  gallery.update(t, qdayAt, new THREE.Vector3(0, 1.5, 0))
  for (const s of specimens) s.update(t, 1 / 60)
  live.update(t, camera)
  composer.render()
})
