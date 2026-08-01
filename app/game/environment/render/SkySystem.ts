import * as THREE from "three";

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
};

export class SkySystem {
  readonly root = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xffe7bd, 3.8);
  private readonly dome: THREE.Mesh;
  private readonly moons = new THREE.Group();
  private readonly dustBand: THREE.Mesh;
  private timeOfDay = 0.68;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.root.name = "a17-sky";
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(190, 32, 18),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          topColor: { value: new THREE.Color(0x17343e) },
          horizonColor: { value: new THREE.Color(0xb89777) },
          bottomColor: { value: new THREE.Color(0x536a69) },
          sunAmount: { value: 0.72 },
        },
        vertexShader: `varying vec3 vWorld; void main(){ vec4 world = modelMatrix * vec4(position,1.0); vWorld = normalize(world.xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor; uniform float sunAmount;
          varying vec3 vWorld;
          void main(){
            float h = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 low = mix(bottomColor, horizonColor, smoothstep(0.12, 0.48, h));
            vec3 color = mix(low, topColor, smoothstep(0.48, 0.92, h));
            gl_FragColor = vec4(color * (0.42 + sunAmount * 0.72), 1.0);
          }`,
      }),
    );
    this.dome.frustumCulled = false;
    this.root.add(this.dome);

    const moonMaterialA = new THREE.MeshBasicMaterial({ color: 0xcfd9cf, fog: false });
    const moonMaterialB = new THREE.MeshBasicMaterial({ color: 0xa9958a, fog: false });
    const moonA = new THREE.Mesh(new THREE.SphereGeometry(5.5, 20, 14), moonMaterialA);
    const moonB = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), moonMaterialB);
    moonA.position.set(-84, 58, -112);
    moonB.position.set(-58, 73, -118);
    this.moons.add(moonA, moonB);
    this.root.add(this.moons);

    this.dustBand = new THREE.Mesh(
      new THREE.TorusGeometry(112, 2.8, 4, 96),
      new THREE.MeshBasicMaterial({ color: 0xd8c4a7, transparent: true, opacity: 0.16, depthWrite: false, fog: false }),
    );
    this.dustBand.rotation.set(Math.PI * 0.58, 0.18, -0.22);
    this.dustBand.position.set(12, 42, -10);
    this.root.add(this.dustBand);

    const hemisphere = new THREE.HemisphereLight(0xb9e7e3, 0x19272a, 1.85);
    this.root.add(hemisphere);
    this.sun.position.set(-38, 54, 32);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -42;
    this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 42;
    this.sun.shadow.camera.bottom = -42;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    this.sun.shadow.bias = -0.00035;
    this.root.add(this.sun);
    this.scene.add(this.root);
    this.applyTimeOfDay(this.timeOfDay);
  }

  setTimeOfDay(normalized: number) {
    this.timeOfDay = ((normalized % 1) + 1) % 1;
    this.applyTimeOfDay(this.timeOfDay);
  }

  getTimeOfDay() { return this.timeOfDay; }

  update(camera: THREE.Camera) {
    this.root.position.copy(camera.position);
    this.sun.target.position.copy(camera.position);
    this.sun.position.set(camera.position.x - 38, camera.position.y + 54, camera.position.z + 32);
    this.sun.target.updateMatrixWorld();
  }

  dispose() {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.sun.dispose();
  }

  private applyTimeOfDay(value: number) {
    const daylight = THREE.MathUtils.smoothstep(Math.sin((value - 0.25) * Math.PI * 2) * 0.5 + 0.5, 0.08, 0.72);
    this.sun.intensity = 0.25 + daylight * 3.85;
    const material = this.dome.material as THREE.ShaderMaterial;
    material.uniforms.sunAmount.value = daylight;
    this.moons.visible = daylight < 0.72;
    this.dustBand.visible = daylight > 0.16;
  }
}
