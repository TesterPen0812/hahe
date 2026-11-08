// A door's name written in light just above its frame, e.g. "Q-DAY · 2035". Original design.
import * as THREE from 'three'
import { DOOR, type RGB } from './worlds'

const W = 1024, H = 144
const WIDTH = 2.5 // world units

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
        float a = texture2D(uMap, vUv).r * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, WIDTH * H / W), material)
  mesh.position.y = DOOR.height + 0.62
  mesh.renderOrder = 7
  mesh.name = 'Door caption'

  const draw = (t: string) => {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '300 64px -apple-system, BlinkMacSystemFont, "Helvetica Neue", "Inter", sans-serif'
    // Wide tracking reads as engraved light rather than a label.
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '22px'
    ctx.fillText(t.toUpperCase(), W / 2 + 11, H / 2 + 2)
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
