// A door's name written in light just above its frame, e.g. "POST-QUANTUM DAY · 2035". Original design.
import * as THREE from 'three'
import { DOOR, type RGB } from './worlds'

const W = 2048, H = 220
const WIDTH = 5.6 // world units: a long name reads from well back down the path

export interface DoorCaption {
  mesh: THREE.Mesh
  setText(text: string): void
  setTint(rgb: RGB): void
  setOpacity(o: number): void
  dispose(): void
}

export function doorCaption(text: string, tint: RGB): DoorCaption {
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.anisotropy = 4
  const material = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // red: the letters; green: a soft dark halo round them, so the rain behind never runs through
        vec2 m = texture2D(uMap, vUv).rg;
        float a = m.r * uOpacity, halo = m.g * 0.42 * uOpacity;
        float cover = max(a, halo);
        if (cover < 0.002) discard;
        gl_FragColor = vec4(uColor * a, cover);
      }
    `,
    // premultiplied: the letters add their light, the halo darkens what's behind
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, WIDTH * H / W), material)
  // close over the opening, so it's still in view as the door fills the screen
  mesh.position.y = DOOR.height + 0.62
  mesh.renderOrder = 7
  mesh.name = 'Door caption'

  const draw = (t: string) => {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Wide tracking reads as engraved light rather than a label; a long name steps down to fit.
    const text = t.toUpperCase()
    let size = 96
    for (; size >= 48; size -= 4) {
      ctx.font = `400 ${size}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Inter", sans-serif`
      ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(size * 0.24)}px`
      if (ctx.measureText(text).width < W - 160) break
    }
    const x = W / 2 + Math.round(size * 0.12), y = H / 2 + 2
    // the halo, in green: the letters blurred wide, laid down a few times so it has body
    ctx.fillStyle = '#0f0'
    ctx.shadowColor = '#0f0'
    ctx.shadowBlur = size * 0.6
    for (let k = 0; k < 2; k++) ctx.fillText(text, x, y)
    // the letters, in red, added on top
    ctx.shadowBlur = 0
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#f00'
    ctx.fillText(text, x, y)
    ctx.globalCompositeOperation = 'source-over'
    texture.needsUpdate = true
  }
  const setTint = (rgb: RGB) => {
    // mostly white, warmed by the door's colour, held below the bloom threshold's glare
    const c = material.uniforms.uColor.value as THREE.Color
    c.setRGB(0.45 + rgb[0] * 0.55, 0.45 + rgb[1] * 0.55, 0.45 + rgb[2] * 0.55).multiplyScalar(0.95)
  }
  draw(text)
  setTint(tint)
  return {
    mesh,
    setText: draw,
    setTint,
    setOpacity: o => { material.uniforms.uOpacity.value = o; mesh.visible = o > 0.002 },
    dispose: () => { texture.dispose(); material.dispose(); mesh.geometry.dispose() },
  }
}
