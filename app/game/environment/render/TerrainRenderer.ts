import * as THREE from "three";
import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";
import { TerrainSampler } from "../terrain/TerrainSampler.ts";
import type { TerrainChunkEviction, TerrainChunkState } from "../terrain/TerrainChunkManager.ts";

export class TerrainRenderer {
  readonly root = new THREE.Group();
  readonly terrain: THREE.Mesh;
  readonly surveyPad: THREE.Group;
  readonly sampler: TerrainSampler;
  private readonly definition: EnvironmentDefinition;
  private readonly chunkRoot = new THREE.Group();
  private editorMode = false;
  private readonly chunkLods = new Map<string, readonly THREE.Mesh[]>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0.035 });
  private previewQuality: EnvironmentQuality;

  constructor(
    definition: EnvironmentDefinition,
    sampler: TerrainSampler,
    quality: EnvironmentQuality,
  ) {
    this.definition = definition;
    this.sampler = sampler;
    this.previewQuality = quality;
    this.configureTerrainMaterial();
    this.root.name = "a17-terrain";
    const width = definition.worldBounds.maxX - definition.worldBounds.minX + 1;
    this.terrain = this.createTerrainMesh(0, 0, width, quality === "high" ? 256 : 128, 0);
    this.terrain.name = "terrain-editor-surface";
    this.terrain.receiveShadow = true;
    this.terrain.visible = false;
    this.root.add(this.terrain);

    this.chunkRoot.name = "terrain-chunks";
    this.root.add(this.chunkRoot);

    this.surveyPad = this.createSurveyPad();
    this.root.add(this.surveyPad);
  }

  updateChunks(states: readonly TerrainChunkState[], evictions: readonly TerrainChunkEviction[] = []) {
    evictions.forEach(({ x, z }) => this.releaseChunk(x, z));
    this.chunkLods.forEach((lods) => lods.forEach((mesh) => { mesh.visible = false; }));
    states.forEach(({ x, z, lod }) => {
      const meshes = this.ensureChunk(x, z);
      meshes[lod].visible = true;
    });
  }

  setPreviewQuality(quality: EnvironmentQuality) { this.previewQuality = quality; }

  residentChunkCount() { return this.chunkLods.size; }

  residentMeshCount() {
    let count = 0;
    this.chunkLods.forEach((lods) => { count += lods.length; });
    return count;
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
    this.chunkLods.clear();
  }

  private ensureChunk(chunkX: number, chunkZ: number) {
    const key = `${chunkX},${chunkZ}`;
    const existing = this.chunkLods.get(key);
    if (existing) return existing;
    const centerX = chunkX * this.definition.chunkSize + this.definition.chunkSize / 2;
    const centerZ = chunkZ * this.definition.chunkSize + this.definition.chunkSize / 2;
    const lods = (this.previewQuality === "high" ? [64, 32, 16] : [32, 16, 8]).map((segments, lod) => {
      const mesh = this.createTerrainMesh(centerX, centerZ, this.definition.chunkSize, segments, 2.5);
      mesh.name = `terrain-chunk:${chunkX},${chunkZ}:lod${lod}`;
      mesh.visible = false;
      mesh.receiveShadow = lod < 2;
      this.chunkRoot.add(mesh);
      return mesh;
    });
    this.chunkLods.set(key, lods);
    return lods;
  }

  private releaseChunk(chunkX: number, chunkZ: number) {
    const key = `${chunkX},${chunkZ}`;
    const lods = this.chunkLods.get(key);
    if (!lods) return;
    lods.forEach((mesh) => {
      this.chunkRoot.remove(mesh);
      mesh.geometry.dispose();
    });
    this.chunkLods.delete(key);
  }

  private createTerrainMesh(centerX: number, centerZ: number, size: number, segments: number, skirtDepth: number) {
    const row = segments + 1;
    const surfaceVertexCount = row * row;
    const perimeter: number[] = [];
    for (let x = 0; x <= segments; x += 1) perimeter.push(x);
    for (let z = 1; z <= segments; z += 1) perimeter.push(z * row + segments);
    for (let x = segments - 1; x >= 0; x -= 1) perimeter.push(segments * row + x);
    for (let z = segments - 1; z >= 1; z -= 1) perimeter.push(z * row);
    const totalVertexCount = surfaceVertexCount + (skirtDepth > 0 ? perimeter.length : 0);
    const positions = new Float32Array(totalVertexCount * 3);
    const normals = new Float32Array(totalVertexCount * 3);
    const colors = new Float32Array(totalVertexCount * 3);
    const indices: number[] = [];
    const minX = centerX - size / 2;
    const minZ = centerZ - size / 2;

    for (let z = 0; z <= segments; z += 1) {
      for (let x = 0; x <= segments; x += 1) {
        const index = z * row + x;
        const worldX = minX + x / segments * size;
        const worldZ = minZ + z / segments * size;
        this.writeTerrainVertex(positions, normals, colors, index, worldX, worldZ, 0);
      }
    }
    for (let z = 0; z < segments; z += 1) {
      for (let x = 0; x < segments; x += 1) {
        const a = z * row + x;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    if (skirtDepth > 0) {
      perimeter.forEach((surfaceIndex, offset) => {
        const skirtIndex = surfaceVertexCount + offset;
        this.writeTerrainVertex(
          positions, normals, colors, skirtIndex,
          positions[surfaceIndex * 3], positions[surfaceIndex * 3 + 2], skirtDepth,
        );
        const nextOffset = (offset + 1) % perimeter.length;
        indices.push(surfaceIndex, skirtIndex, perimeter[nextOffset], perimeter[nextOffset], skirtIndex, surfaceVertexCount + nextOffset);
      });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.userData.surfaceVertexCount = surfaceVertexCount;
    geometry.userData.skirtDepth = skirtDepth;
    geometry.userData.segments = segments;
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.material);
  }

  /** Texture-scale breakup without a bitmap lookup or another draw call. */
  private configureTerrainMaterial() {
    this.material.userData.detailMode = "procedural-micro-surface";
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTerrainPosition;\nvarying vec3 vTerrainNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTerrainPosition = position;\nvTerrainNormal = normalize(normal);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vTerrainPosition;
          varying vec3 vTerrainNormal;
          float terrainHash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          float micro = terrainHash(floor(vTerrainPosition.xz * 3.25));
          float grain = mix(0.91, 1.07, micro);
          float slope = 1.0 - clamp(abs(vTerrainNormal.y), 0.0, 1.0);
          float strata = 0.94 + 0.06 * sin(vTerrainPosition.y * 5.6 + vTerrainPosition.x * 0.12);
          diffuseColor.rgb *= grain * mix(1.0, strata, smoothstep(0.24, 0.72, slope));`);
    };
    this.material.customProgramCacheKey = () => "a17-terrain-micro-surface-v1";
  }

  private refreshMesh(mesh: THREE.Mesh, region?: Readonly<{ x: number; z: number; radius: number }>) {
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    const surfaceVertexCount = geometry.userData.surfaceVertexCount as number;
    const skirtDepth = geometry.userData.skirtDepth as number;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      if (region && Math.hypot(x - region.x, z - region.z) > region.radius + 1) continue;
      this.writeTerrainVertex(positions.array as Float32Array, normals.array as Float32Array, colors.array as Float32Array,
        index, x, z, index >= surfaceVertexCount ? skirtDepth : 0);
    }
    positions.needsUpdate = true;
    normals.needsUpdate = true;
    colors.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  private writeTerrainVertex(
    positions: Float32Array,
    normals: Float32Array,
    colors: Float32Array,
    index: number,
    x: number,
    z: number,
    depth: number,
  ) {
    const sample = this.sampler.sample(x, z);
    const offset = index * 3;
    positions[offset] = x;
    positions[offset + 1] = sample.height - depth;
    positions[offset + 2] = z;
    normals[offset] = sample.normal.x;
    normals[offset + 1] = sample.normal.y;
    normals[offset + 2] = sample.normal.z;
    const color = new THREE.Color(this.sampler.colorAt(x, z));
    const tint = sample.surface === "soft" ? 0x40514b
      : sample.surface === "submerged" ? 0x142f34
        : sample.surface === "hazard" ? 0x75543e
          : sample.surface === "steep" ? 0x1b292d : color.getHex();
    color.lerp(new THREE.Color(tint), sample.surface === "stable" ? 0 : 0.44);
    const variation = 0.88 + (Math.sin(x * 0.43 + z * 0.19) * 0.5 + 0.5) * 0.15;
    colors[offset] = color.r * variation;
    colors[offset + 1] = color.g * variation;
    colors[offset + 2] = color.b * variation;
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
