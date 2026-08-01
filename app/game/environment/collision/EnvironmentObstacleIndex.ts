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
}
