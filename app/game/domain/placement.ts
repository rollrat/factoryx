import type {
  BuildingDefinition,
  GridCell,
  LocalPosition,
  PortDefinition,
} from "./types.ts";

export type QuarterRotation = 0 | 1 | 2 | 3;

export const WORLD_UNITS_PER_TILE = 1 as const;

export type RotatedFootprint = Readonly<{ x: number; z: number }>;

export type WorldPort = Readonly<{
  definition: PortDefinition;
  connectionCell: GridCell;
  position: LocalPosition;
  facing: GridCell;
}>;

export type PlacementModelTransform = Readonly<{
  position: LocalPosition;
  rotationY: number;
}>;

/**
 * The coordinate-only part of a placement plan. Preview and commit consumers
 * should share this projection instead of rebuilding any of these values.
 */
export type PlacementProjection = Readonly<{
  buildingId: BuildingDefinition["id"];
  anchorCell: GridCell;
  rotation: QuarterRotation;
  rotatedFootprint: RotatedFootprint;
  occupiedCells: readonly GridCell[];
  modelTransform: PlacementModelTransform;
  worldPorts: readonly WorldPort[];
}>;

export const normalizeQuarterRotation = (rotation: number): QuarterRotation => (
  ((Math.trunc(rotation) % 4) + 4) % 4
) as QuarterRotation;

const cleanZero = (value: number) => Object.is(value, -0) ? 0 : value;
const cell = (x: number, z: number): GridCell => ({ x: cleanZero(x), z: cleanZero(z) });

/** Returns the minimum occupied cell containing a world-space X/Z point. */
export const worldPointToAnchorCell = (
  point: Readonly<{ x: number; z: number }>,
): GridCell => cell(
  Math.floor(point.x / WORLD_UNITS_PER_TILE),
  Math.floor(point.z / WORLD_UNITS_PER_TILE),
);

export const rotatedFootprintSize = (
  building: Pick<BuildingDefinition, "footprint">,
  rotation: number,
): RotatedFootprint => {
  const normalized = normalizeQuarterRotation(rotation);
  return normalized % 2 === 0
    ? { ...building.footprint }
    : { x: building.footprint.z, z: building.footprint.x };
};

export const rotateFacing = (facing: GridCell, rotation: number): GridCell => {
  switch (normalizeQuarterRotation(rotation)) {
    case 1: return cell(-facing.z, facing.x);
    case 2: return cell(-facing.x, -facing.z);
    case 3: return cell(facing.z, -facing.x);
    default: return { ...facing };
  }
};

export const rotateLocalPosition = (position: LocalPosition, rotation: number): LocalPosition => {
  switch (normalizeQuarterRotation(rotation)) {
    case 1: return { x: -position.z, y: position.y, z: position.x };
    case 2: return { x: -position.x, y: position.y, z: -position.z };
    case 3: return { x: position.z, y: position.y, z: -position.x };
    default: return { ...position };
  }
};

export const rotateConnectionCell = (
  cell: GridCell,
  footprint: Readonly<{ x: number; z: number }>,
  rotation: number,
): GridCell => {
  switch (normalizeQuarterRotation(rotation)) {
    case 1: return { x: footprint.z - 1 - cell.z, z: cell.x };
    case 2: return { x: footprint.x - 1 - cell.x, z: footprint.z - 1 - cell.z };
    case 3: return { x: cell.z, z: footprint.x - 1 - cell.x };
    default: return { ...cell };
  }
};

export const occupiedWorldCells = (
  building: BuildingDefinition,
  anchor: GridCell,
  rotation: number,
): readonly GridCell[] => {
  const size = rotatedFootprintSize(building, rotation);
  const cells: GridCell[] = [];
  for (let localX = 0; localX < size.x; localX += 1) {
    for (let localZ = 0; localZ < size.z; localZ += 1) {
      cells.push({ x: anchor.x + localX, z: anchor.z + localZ });
    }
  }
  return cells;
};

/**
 * Model origins and PortDefinition.localPosition are both measured from the
 * center of the rotated foundation, while anchor cells mark its minimum edge.
 */
export const placementModelCenter = (
  building: Pick<BuildingDefinition, "footprint">,
  anchor: GridCell,
  rotation: number,
  elevation = 0,
): LocalPosition => {
  const footprint = rotatedFootprintSize(building, rotation);
  return {
    x: (anchor.x + footprint.x / 2) * WORLD_UNITS_PER_TILE,
    y: elevation,
    z: (anchor.z + footprint.z / 2) * WORLD_UNITS_PER_TILE,
  };
};

/** Matches the X/Z quarter-turn convention used by rotateLocalPosition. */
export const placementModelRotationY = (rotation: number) => cleanZero(
  -normalizeQuarterRotation(rotation) * Math.PI / 2,
);

export const placementModelTransform = (
  building: Pick<BuildingDefinition, "footprint">,
  anchor: GridCell,
  rotation: number,
  elevation = 0,
): PlacementModelTransform => ({
  position: placementModelCenter(building, anchor, rotation, elevation),
  rotationY: placementModelRotationY(rotation),
});

export const worldPort = (
  building: BuildingDefinition,
  port: PortDefinition,
  anchor: GridCell,
  rotation: number,
  elevation = 0,
): WorldPort => {
  const connectionCell = rotateConnectionCell(port.connectionCell, building.footprint, rotation);
  const position = rotateLocalPosition(port.localPosition, rotation);
  const center = placementModelCenter(building, anchor, rotation, elevation);
  return {
    definition: port,
    connectionCell: { x: anchor.x + connectionCell.x, z: anchor.z + connectionCell.z },
    position: {
      x: center.x + position.x,
      y: center.y + position.y,
      z: center.z + position.z,
    },
    facing: rotateFacing(port.localFacing, rotation),
  };
};

export const worldPorts = (
  building: BuildingDefinition,
  anchor: GridCell,
  rotation: number,
  elevation = 0,
) => building.ports.map((port) => worldPort(building, port, anchor, rotation, elevation));

export const projectPlacement = (
  building: BuildingDefinition,
  anchor: GridCell,
  rotation: number,
  elevation = 0,
): PlacementProjection => {
  const normalizedRotation = normalizeQuarterRotation(rotation);
  return {
    buildingId: building.id,
    anchorCell: { ...anchor },
    rotation: normalizedRotation,
    rotatedFootprint: rotatedFootprintSize(building, normalizedRotation),
    occupiedCells: occupiedWorldCells(building, anchor, normalizedRotation),
    modelTransform: placementModelTransform(building, anchor, normalizedRotation, elevation),
    worldPorts: worldPorts(building, anchor, normalizedRotation, elevation),
  };
};
