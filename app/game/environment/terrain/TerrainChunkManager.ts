import type { EnvironmentDefinition, EnvironmentQuality } from "../types.ts";

export type TerrainChunkState = Readonly<{ x: number; z: number; distance: number; lod: 0 | 1 | 2 }>;

export class TerrainChunkManager {
  private active: readonly TerrainChunkState[] = [];
  private readonly definition: EnvironmentDefinition;

  constructor(definition: EnvironmentDefinition) {
    this.definition = definition;
  }

  update(cameraX: number, cameraZ: number, quality: EnvironmentQuality): readonly TerrainChunkState[] {
    const radius = quality === "high" ? 2 : 1;
    const centerX = Math.floor(cameraX / this.definition.chunkSize);
    const centerZ = Math.floor(cameraZ / this.definition.chunkSize);
    const chunks: TerrainChunkState[] = [];
    for (let z = centerZ - radius; z <= centerZ + radius; z += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        const worldX = x * this.definition.chunkSize;
        const worldZ = z * this.definition.chunkSize;
        if (worldX < this.definition.worldBounds.minX || worldX > this.definition.worldBounds.maxX
          || worldZ < this.definition.worldBounds.minZ || worldZ > this.definition.worldBounds.maxZ) continue;
        const distance = Math.max(Math.abs(x - centerX), Math.abs(z - centerZ));
        chunks.push({ x, z, distance, lod: distance === 0 ? 0 : distance === 1 ? 1 : 2 });
      }
    }
    this.active = chunks;
    return chunks;
  }

  snapshot() {
    return this.active.map((chunk) => ({ ...chunk }));
  }
}
