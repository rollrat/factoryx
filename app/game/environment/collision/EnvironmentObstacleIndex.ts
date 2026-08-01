export type EnvironmentObstacle = Readonly<{ id: string; x: number; z: number; radius: number; stratumId: string }>;

export class EnvironmentObstacleIndex {
  private readonly obstacles: readonly EnvironmentObstacle[];

  constructor(obstacles: readonly EnvironmentObstacle[]) {
    this.obstacles = obstacles.map((obstacle) => ({ ...obstacle }));
  }

  query(x: number, z: number, radius: number, stratumId = "surface") {
    return this.obstacles.filter((obstacle) => obstacle.stratumId === stratumId
      && Math.hypot(obstacle.x - x, obstacle.z - z) <= obstacle.radius + radius);
  }

  resolve(start: Readonly<{ x: number; z: number }>, desired: Readonly<{ x: number; z: number }>, radius: number, stratumId = "surface") {
    const afterX = this.query(desired.x, start.z, radius, stratumId).length === 0 ? { x: desired.x, z: start.z } : { ...start };
    const afterZ = this.query(afterX.x, desired.z, radius, stratumId).length === 0 ? { x: afterX.x, z: desired.z } : afterX;
    return { position: afterZ, blocked: afterZ.x !== desired.x || afterZ.z !== desired.z } as const;
  }
}
