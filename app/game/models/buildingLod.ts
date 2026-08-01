import { rotatedFootprintSize } from "../domain/placement.ts";
import type { BuildingDefinition, BuildingInstance } from "../domain/types.ts";
import type { DataDrivenWorld } from "../sim/world.ts";

export type LodPoint3 = Readonly<{ x: number; y: number; z: number }>;
export type FrustumPlane = Readonly<{ normal: LodPoint3; constant: number }>;

export type BuildingLodSubject = Readonly<{
  instanceId: string;
  definitionId: string;
  center: LodPoint3;
  radius: number;
}>;

export type BuildingDetailTier = 0 | 1 | 2;
export type BuildingLodDecision = Readonly<{
  instanceId: string;
  definitionId: string;
  visible: boolean;
  detailTier: BuildingDetailTier | null;
  detail: "full" | "operational" | "silhouette" | "culled";
  distance: number;
  culledReason?: "frustum" | "distance";
}>;

export type BuildingLodOptions = Readonly<{
  nearDistance?: number;
  farDistance?: number;
  maxDistance?: number;
  frustumPlanes?: readonly FrustumPlane[];
}>;

const validateRadius = (radius: number) => {
  if (!Number.isFinite(radius) || radius < 0) throw new RangeError("LOD subject radius must be finite and non-negative");
};

const defaultHeight = (definition: BuildingDefinition) => (
  definition.id === "project_dock"
    ? 7
    : Math.max(2, Math.min(8, Math.max(definition.footprint.x, definition.footprint.z) * 1.4))
);

export const createBuildingLodSubject = (
  instance: BuildingInstance,
  definition: BuildingDefinition,
  height = defaultHeight(definition),
): BuildingLodSubject => {
  if (!Number.isFinite(height) || height <= 0) throw new RangeError("building LOD height must be positive");
  const size = rotatedFootprintSize(definition, instance.rotation);
  const radius = Math.hypot(size.x, height, size.z) / 2;
  return {
    instanceId: instance.id,
    definitionId: instance.definitionId,
    center: {
      x: instance.position.x + size.x / 2,
      y: height / 2,
      z: instance.position.z + size.z / 2,
    },
    radius,
  };
};

/** Creates conservative world-space spheres once per placement/topology rebuild. */
export const createWorldBuildingLodSubjects = (
  world: DataDrivenWorld,
  heightFor: (definition: BuildingDefinition, instance: BuildingInstance) => number = defaultHeight,
) => world.allInstances().map((instance) => {
  const definition = world.registry.buildings.get(instance.definitionId);
  if (!definition) throw new Error(`unknown LOD building definition: ${instance.definitionId}`);
  return createBuildingLodSubject(instance, definition, heightFor(definition, instance));
});

const outsideFrustum = (subject: BuildingLodSubject, planes: readonly FrustumPlane[]) => planes.some((plane) => {
  const normalLength = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z);
  if (normalLength === 0) throw new RangeError("frustum plane normal must not be zero");
  const signed = plane.normal.x * subject.center.x
    + plane.normal.y * subject.center.y
    + plane.normal.z * subject.center.z
    + plane.constant;
  return signed < -subject.radius * normalLength;
});

/**
 * Pure distance/frustum classification. Distances are measured to the bounding
 * sphere surface so large buildings do not lose detail while the player is beside them.
 */
export const classifyBuildingLods = (
  subjects: readonly BuildingLodSubject[],
  camera: LodPoint3,
  options: BuildingLodOptions = {},
): readonly BuildingLodDecision[] => {
  const nearDistance = options.nearDistance ?? 18;
  const farDistance = options.farDistance ?? 45;
  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  if (![nearDistance, farDistance].every(Number.isFinite)
    || nearDistance < 0 || farDistance <= nearDistance || maxDistance < farDistance) {
    throw new RangeError("LOD distances must satisfy 0 <= near < far <= max");
  }
  return subjects.map((subject): BuildingLodDecision => {
    validateRadius(subject.radius);
    const distance = Math.max(0, Math.hypot(
      subject.center.x - camera.x,
      subject.center.y - camera.y,
      subject.center.z - camera.z,
    ) - subject.radius);
    if (options.frustumPlanes && outsideFrustum(subject, options.frustumPlanes)) {
      return { instanceId: subject.instanceId, definitionId: subject.definitionId, visible: false, detailTier: null, detail: "culled", distance, culledReason: "frustum" };
    }
    if (distance > maxDistance) {
      return { instanceId: subject.instanceId, definitionId: subject.definitionId, visible: false, detailTier: null, detail: "culled", distance, culledReason: "distance" };
    }
    const detailTier: BuildingDetailTier = distance < nearDistance ? 0 : distance < farDistance ? 1 : 2;
    const detail = detailTier === 0 ? "full" : detailTier === 1 ? "operational" : "silhouette";
    return { instanceId: subject.instanceId, definitionId: subject.definitionId, visible: true, detailTier, detail, distance };
  });
};

export const visibleBuildingLods = (decisions: readonly BuildingLodDecision[]) => (
  decisions.filter(({ visible }) => visible)
);

/** Extracts six normalized planes from a column-major projection-view matrix. */
export const frustumPlanesFromMatrix = (elements: readonly number[]): readonly FrustumPlane[] => {
  if (elements.length !== 16 || elements.some((value) => !Number.isFinite(value))) {
    throw new RangeError("frustum matrix must contain 16 finite elements");
  }
  const raw = [
    [elements[3] + elements[0], elements[7] + elements[4], elements[11] + elements[8], elements[15] + elements[12]],
    [elements[3] - elements[0], elements[7] - elements[4], elements[11] - elements[8], elements[15] - elements[12]],
    [elements[3] + elements[1], elements[7] + elements[5], elements[11] + elements[9], elements[15] + elements[13]],
    [elements[3] - elements[1], elements[7] - elements[5], elements[11] - elements[9], elements[15] - elements[13]],
    [elements[3] + elements[2], elements[7] + elements[6], elements[11] + elements[10], elements[15] + elements[14]],
    [elements[3] - elements[2], elements[7] - elements[6], elements[11] - elements[10], elements[15] - elements[14]],
  ] as const;
  return raw.map(([x, y, z, constant]) => {
    const length = Math.hypot(x, y, z);
    if (length === 0) throw new RangeError("frustum matrix produced a zero plane");
    return { normal: { x: x / length, y: y / length, z: z / length }, constant: constant / length };
  });
};
