import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import type { TerrainChunkState } from "../terrain/TerrainChunkManager.ts";

export class TerrainRenderer {
  readonly root = new THREE.Group();
  readonly terrain: THREE.Mesh;
  readonly surveyPad: THREE.Group;
  readonly sampler: TerrainSampler;
  private readonly definition: EnvironmentDefinition;
  private readonly chunkRoot = new THREE.Group();
  private editorMode = false;
  private readonly chunkLods = new Map<string, readonly THREE.Mesh[]>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.05 });

  constructor(
    definition: EnvironmentDefinition,
    sampler: TerrainSampler,
    quality: EnvironmentQuality,
  ) {
    this.definition = definition;
    this.sampler = sampler;
    this.root.name = "a17-terrain";
    const width = definition.worldBounds.maxX - definition.worldBounds.minX + 1;
    const depth = definition.worldBounds.maxZ - definition.worldBounds.minZ + 1;
    this.terrain = this.createTerrainMesh(0, 0, width, quality === "high" ? 128 : 72);
    this.terrain.name = "terrain-editor-surface";
    this.terrain.receiveShadow = true;
    this.terrain.visible = false;
    this.root.add(this.terrain);

    this.chunkRoot.name = "terrain-chunks";
    const minChunkX = Math.floor(definition.worldBounds.minX / definition.chunkSize);
    const maxChunkX = Math.floor(definition.worldBounds.maxX / definition.chunkSize);
    const minChunkZ = Math.floor(definition.worldBounds.minZ / definition.chunkSize);
    const maxChunkZ = Math.floor(definition.worldBounds.maxZ / definition.chunkSize);
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
        const centerX = chunkX * definition.chunkSize + definition.chunkSize / 2;
        const centerZ = chunkZ * definition.chunkSize + definition.chunkSize / 2;
        const lods = ([16, 8, 4] as const).map((segments, lod) => {
          const mesh = this.createTerrainMesh(centerX, centerZ, definition.chunkSize, quality === "low" ? Math.max(3, segments / 2) : segments);
          mesh.name = `terrain-chunk:${chunkX},${chunkZ}:lod${lod}`;
          mesh.visible = false;
          mesh.receiveShadow = lod < 2;
          this.chunkRoot.add(mesh);
          return mesh;
        });
        this.chunkLods.set(`${chunkX},${chunkZ}`, lods);
      }
    }
    this.root.add(this.chunkRoot);

    this.surveyPad = this.createSurveyPad();
    this.root.add(this.surveyPad);
  }

  updateChunks(states: readonly TerrainChunkState[]) {
    this.chunkLods.forEach((lods) => lods.forEach((mesh) => { mesh.visible = false; }));
    states.forEach(({ x, z, lod }) => {
      const meshes = this.chunkLods.get(`${x},${z}`);
      if (meshes) meshes[lod].visible = true;
    });
  }

  setEditorMode(enabled: boolean) {
    if (this.editorMode && !enabled) this.chunkLods.forEach((lods) => lods.forEach((mesh) => this.refreshMesh(mesh)));
    this.editorMode = enabled;
    this.terrain.visible = enabled;
    this.chunkRoot.visible = !enabled;
  }

  /** Re-samples both the authoring surface and every runtime LOD after an edit. */
  refreshFromSampler(region?: Readonly<{ x: number; z: number; radius: number }>) {
    this.refreshMesh(this.terrain, region);
    if (!this.editorMode) this.chunkLods.forEach((lods) => lods.forEach((mesh) => this.refreshMesh(mesh)));
  }

  dispose() {
    const materials = new Set<THREE.Material>();
    this.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
    });
    materials.forEach((material) => material.dispose());
  }

  private createTerrainMesh(centerX: number, centerZ: number, size: number, segments: number) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(centerX, 0, centerZ);
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const sample = this.sampler.sample(x, z);
      positions.setY(index, sample.height);
      color.setHex(this.sampler.colorAt(x, z));
      const surfaceTint = sample.surface === "soft" ? new THREE.Color(0x40514b)
        : sample.surface === "submerged" ? new THREE.Color(0x142f34)
          : sample.surface === "hazard" ? new THREE.Color(0x75543e)
            : sample.surface === "steep" ? new THREE.Color(0x1b292d) : color;
      color.lerp(surfaceTint, sample.surface === "stable" ? 0 : 0.44);
      const variation = 0.88 + (Math.sin(x * 0.43 + z * 0.19) * 0.5 + 0.5) * 0.15;
      colors[index * 3] = color.r * variation;
      colors[index * 3 + 1] = color.g * variation;
      colors[index * 3 + 2] = color.b * variation;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, this.material);
  }

  private refreshMesh(mesh: THREE.Mesh, region?: Readonly<{ x: number; z: number; radius: number }>) {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      if (region && Math.hypot(x - region.x, z - region.z) > region.radius + 1) continue;
      const sample = this.sampler.sample(x, z);
      positions.setY(index, sample.height);
      color.setHex(this.sampler.colorAt(x, z));
      const tint = sample.surface === "soft" ? 0x40514b
        : sample.surface === "submerged" ? 0x142f34
          : sample.surface === "hazard" ? 0x75543e
            : sample.surface === "steep" ? 0x1b292d : color.getHex();
      color.lerp(new THREE.Color(tint), sample.surface === "stable" ? 0 : 0.44);
      const variation = 0.88 + (Math.sin(x * 0.43 + z * 0.19) * 0.5 + 0.5) * 0.15;
      colors.setXYZ(index, color.r * variation, color.g * variation, color.b * variation);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  private createSurveyPad() {
    const group = new THREE.Group();
    group.name = "survey-pad";
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0x1c3035, roughness: 0.84, metalness: 0.24 });
    const insetMaterial = new THREE.MeshStandardMaterial({ color: 0x263b3f, roughness: 0.9, metalness: 0.08 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x84604a, roughness: 0.55, metalness: 0.42 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(27, 0.42, 27), slabMaterial);
    slab.position.y = -0.28;
    slab.receiveShadow = true;
    group.add(slab);
    const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(3.18, 0.045, 3.18), insetMaterial, 64);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let z = -3.5; z <= 3.5; z += 1) {
      for (let x = -3.5; x <= 3.5; x += 1) {
        matrix.makeTranslation(x * 3.28, -0.035, z * 3.28);
        panels.setMatrixAt(index++, matrix);
      }
    }
    panels.receiveShadow = true;
    group.add(panels);
    const railLong = new THREE.BoxGeometry(27.7, 0.3, 0.26);
    const railShort = new THREE.BoxGeometry(0.26, 0.3, 27.7);
    [
      [new THREE.Mesh(railLong, trimMaterial), 0, -13.65],
      [new THREE.Mesh(railLong, trimMaterial), 0, 13.65],
      [new THREE.Mesh(railShort, trimMaterial), -13.65, 0],
      [new THREE.Mesh(railShort, trimMaterial), 13.65, 0],
    ].forEach(([mesh, x, z]) => {
      const rail = mesh as THREE.Mesh;
      rail.position.set(x as number, 0.07, z as number);
      rail.castShadow = true;
      group.add(rail);
    });
    return group;
  }
}
