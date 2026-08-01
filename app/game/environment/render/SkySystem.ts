import * as THREE from "three";
import type { EnvironmentQuality } from "../types.ts";
import { a17SolarElevationAt } from "../EnvironmentCycle.ts";
import type { WeatherKind } from "./WeatherSystem.ts";

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
  private readonly cloudLayers = new THREE.Group();
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sunOffset = new THREE.Vector3(-38, 54, 32);
  private timeOfDay = 0.68;
  private sunAzimuth = 0;
  private weatherKind: WeatherKind = "clear";
  private weatherStrength = 0;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, quality: EnvironmentQuality = "high") {
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

    const cloudGeometry = new THREE.SphereGeometry(174, 32, 16);
    [
      { scale: 1, opacity: 0.055, speed: 0.0018 },
      { scale: 0.985, opacity: 0.035, speed: -0.0011 },
    ].forEach(({ scale, opacity, speed }, index) => {
      const layer = new THREE.Mesh(
        cloudGeometry.clone(),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          transparent: true,
          depthWrite: false,
          uniforms: { opacity: { value: opacity }, phase: { value: index * 3.7 } },
          vertexShader: "varying vec3 vDirection; void main(){ vDirection=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
          fragmentShader: `uniform float opacity; uniform float phase; varying vec3 vDirection;
            void main(){ float band=smoothstep(.08,.42,vDirection.y)*(1.0-smoothstep(.62,.86,vDirection.y));
            float wave=sin(vDirection.x*23.0+vDirection.z*11.0+phase)+sin(vDirection.z*31.0-vDirection.x*7.0-phase*.7);
            float cloud=smoothstep(.45,1.35,wave)*band; gl_FragColor=vec4(vec3(.74,.82,.81),cloud*opacity); }`,
        }),
      );
      layer.scale.setScalar(scale);
      layer.userData.speed = speed;
      this.cloudLayers.add(layer);
    });
    cloudGeometry.dispose();
    this.root.add(this.cloudLayers);

    this.hemisphere = new THREE.HemisphereLight(0xb9e7e3, 0x19272a, 1.85);
    this.root.add(this.hemisphere);
    this.sun.position.set(-38, 54, 32);
    this.sun.castShadow = true;
    const shadowSize = quality === "high" ? 2048 : 1024;
    const shadowDistance = quality === "high" ? 42 : 24;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.camera.left = -shadowDistance;
    this.sun.shadow.camera.right = shadowDistance;
    this.sun.shadow.camera.top = shadowDistance;
    this.sun.shadow.camera.bottom = -shadowDistance;
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

  setSunAzimuth(normalized: number) {
    this.sunAzimuth = THREE.MathUtils.clamp(normalized, -1, 1);
    this.applyTimeOfDay(this.timeOfDay);
  }

  setShadowDistance(distance: number) {
    const value = THREE.MathUtils.clamp(distance, 12, 96);
    this.sun.shadow.camera.left = -value;
    this.sun.shadow.camera.right = value;
    this.sun.shadow.camera.top = value;
    this.sun.shadow.camera.bottom = -value;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  setWeatherInfluence(kind: WeatherKind, strength: number) {
    this.weatherKind = kind;
    this.weatherStrength = THREE.MathUtils.clamp(strength, 0, 1);
    this.applyTimeOfDay(this.timeOfDay);
  }

  update(camera: THREE.Camera, delta = 0) {
    this.root.position.copy(camera.position);
    this.sun.target.position.copy(camera.position);
    this.sun.position.copy(camera.position).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
    this.cloudLayers.children.forEach((layer) => {
      layer.rotation.y += delta * (layer.userData.speed as number) * 60;
      const material = (layer as THREE.Mesh).material as THREE.ShaderMaterial;
      material.uniforms.phase.value += delta * (layer.userData.speed as number) * 95;
    });
  }

  dispose() {
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.sun.dispose();
  }

  private applyTimeOfDay(value: number) {
    const orbit = (value - 0.25) * Math.PI * 2;
    const altitude = a17SolarElevationAt(value);
    const daylight = THREE.MathUtils.smoothstep(altitude * 0.5 + 0.5, 0.08, 0.72);
    const horizontal = new THREE.Vector2(Math.cos(orbit) * 68, Math.sin(orbit * 0.82) * 54)
      .rotateAround(new THREE.Vector2(), this.sunAzimuth * Math.PI);
    this.sunOffset.set(horizontal.x, Math.max(-9, altitude * 72), horizontal.y);
    this.sun.intensity = 0.25 + daylight * 3.85;
    const material = this.dome.material as THREE.ShaderMaterial;
    material.uniforms.sunAmount.value = daylight;
    const twilight = 1 - Math.min(1, Math.abs(altitude) * 4);
    material.uniforms.topColor.value.setHex(daylight > 0.18 ? 0x17343e : 0x07111e).lerp(new THREE.Color(0x4b2930), twilight * 0.32);
    material.uniforms.horizonColor.value.setHex(daylight > 0.18 ? 0xb89777 : 0x26334b).lerp(new THREE.Color(0xd17b58), twilight * 0.48);
    material.uniforms.bottomColor.value.setHex(daylight > 0.18 ? 0x536a69 : 0x111b2a);
    this.sun.color.setHex(daylight > 0.18 ? 0xffe7bd : 0x9bb8d8).lerp(new THREE.Color(0xffa06b), twilight * 0.55);
    this.hemisphere.intensity = 0.42 + daylight * 1.43;
    this.hemisphere.color.setHex(daylight > 0.18 ? 0xb9e7e3 : 0x7186ad);
    const weatherDimming = this.weatherKind === "electrical_storm" ? 0.56
      : this.weatherKind === "mist" ? 0.34
        : this.weatherKind === "mineral_wind" ? 0.18 : 0;
    this.sun.intensity *= 1 - weatherDimming * this.weatherStrength;
    this.hemisphere.intensity *= 1 - weatherDimming * this.weatherStrength * 0.42;
    if (this.weatherKind === "mineral_wind") this.sun.color.lerp(new THREE.Color(0xe3a671), this.weatherStrength * 0.24);
    if (this.weatherKind === "electrical_storm") {
      this.sun.color.lerp(new THREE.Color(0x9ebbd3), this.weatherStrength * 0.42);
      this.hemisphere.color.lerp(new THREE.Color(0x738aa5), this.weatherStrength * 0.4);
    }
    this.moons.visible = daylight < 0.72;
    this.dustBand.visible = daylight > 0.16;
  }
}
