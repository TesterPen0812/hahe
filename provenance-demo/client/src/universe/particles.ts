import * as THREE from 'three'
import { particleSimulationFragment, particleSimulationVertex } from './shaders'
import type { Fluid } from './fluid'

export class ParticleSimulation {
  private pair: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget]
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private material: THREE.ShaderMaterial
  private geometry = new THREE.BufferGeometry()
  private initialized = false
  private projection = new THREE.Matrix4()
  private right = new THREE.Vector3()
  private up = new THREE.Vector3()
  private cameraPosition = new THREE.Vector3()

  constructor(mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>) {
    const source = mesh.geometry
    const count = source.instanceCount
    const width = Math.min(1024, count), height = Math.ceil(count / width)
    const make = () => new THREE.WebGLRenderTarget(width, height, {
      count: 4, type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    })
    this.pair = [make(), make()]
    for (const [name, attribute] of Object.entries(source.attributes)) {
      if (name === 'position' || name === 'normal' || name === 'uv') continue
      this.geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize))
    }
    this.geometry.setAttribute('position', this.geometry.getAttribute('aBasePosition'))
    this.geometry.setDrawRange(0, count)
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: particleSimulationVertex, fragmentShader: particleSimulationFragment,
      defines: { ...mesh.material.defines },
      uniforms: {
        ...mesh.material.uniforms,
        uViewProjection: { value: this.projection }, uCameraRight: { value: this.right },
        uCameraUp: { value: this.up }, uCameraPosition: { value: this.cameraPosition },
        uFluidVelocity: { value: null }, uFluidTexel: { value: new THREE.Vector2() },
        uFluidCoupling: { value: 0 },
        uMoteBox: { value: new THREE.Vector3(9, 6, 16) },
        uWind: { value: new THREE.Vector3(0.025, 0, 0) },
        uRise: { value: 0.08 }, uTurbulence: { value: 0.18 },
      },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    const points = new THREE.Points(this.geometry, this.material)
    points.frustumCulled = false
    this.scene.add(points)
  }

  step(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, fluid: Fluid, dt: number, active: boolean) {
    const m = this.material.uniforms
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.right.setFromMatrixColumn(camera.matrixWorld, 0)
    this.up.setFromMatrixColumn(camera.matrixWorld, 1)
    this.right.multiplyScalar(2 / camera.projectionMatrix.elements[0])
    this.up.multiplyScalar(2 / camera.projectionMatrix.elements[5])
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld)
    m.uFluidVelocity.value = fluid.texture
    m.uFluidTexel.value.copy(fluid.texel)
    m.uFluidCoupling.value = active ? 0.45 : 0
    m.uDelta.value = Math.min(Math.max(dt, 0.0001), 1 / 30)
    m.uStateReady.value = this.initialized ? 1 : 0
    this.bind(this.pair[0])
    const previous = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.setRenderTarget(this.pair[1])
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(previous)
    renderer.autoClear = autoClear
    this.pair.reverse()
    this.bind(this.pair[0])
    this.initialized = true
    m.uStateReady.value = 1
  }

  private bind(target: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms
    u.uPositions.value = target.textures[0]
    u.uVelocities.value = target.textures[1]
    u.uOffsets.value = target.textures[2]
    u.uDrifts.value = target.textures[3]
  }

  reset() { this.initialized = false; this.material.uniforms.uStateReady.value = 0 }

  dispose() {
    this.pair.forEach(target => target.dispose())
    this.geometry.dispose()
    this.material.dispose()
  }
}
