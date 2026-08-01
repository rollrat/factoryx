import type {
  BuildingDefinition,
  GridCell,
  LocalPosition,
  PortDefinition,
} from "./types.ts";

export type QuarterRotation = 0 | 1 | 2 | 3;

export type WorldPort = Readonly<{
  definition: PortDefinition;
  connectionCell: GridCell;
  position: LocalPosition;
  facing: GridCell;
}>;

const normalizeRotation = (rotation: number): QuarterRotation => (
  ((Math.trunc(rotation) % 4) + 4) % 4
) as QuarterRotation;

const cleanZero = (value: number) => Object.is(value, -0) ? 0 : value;
const cell = (x: number, z: number): GridCell => ({ x: cleanZero(x), z: cleanZero(z) });

export const rotatedFootprintSize = (
  building: Pick<BuildingDefinition, "footprint">,
  rotation: number,
) => {
  const normalized = normalizeRotation(rotation);
  return normalized % 2 === 0
    ? { ...building.footprint }
    : { x: building.footprint.z, z: building.footprint.x };
};

export const rotateFacing = (facing: GridCell, rotation: number): GridCell => {
  switch (normalizeRotation(rotation)) {
    case 1: return cell(-facing.z, facing.x);
    case 2: return cell(-facing.x, -facing.z);
    case 3: return cell(facing.z, -facing.x);
    default: return { ...facing };
  }
};

export const rotateLocalPosition = (position: LocalPosition, rotation: number): LocalPosition => {
  switch (normalizeRotation(rotation)) {
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
  switch (normalizeRotation(rotation)) {
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

export const worldPort = (
  building: BuildingDefinition,
  port: PortDefinition,
  anchor: GridCell,
  rotation: number,
): WorldPort => {
  const connectionCell = rotateConnectionCell(port.connectionCell, building.footprint, rotation);
  const position = rotateLocalPosition(port.localPosition, rotation);
  return {
    definition: port,
    connectionCell: { x: anchor.x + connectionCell.x, z: anchor.z + connectionCell.z },
    position: { x: anchor.x + position.x, y: position.y, z: anchor.z + position.z },
    facing: rotateFacing(port.localFacing, rotation),
  };
};

export const worldPorts = (
  building: BuildingDefinition,
  anchor: GridCell,
  rotation: number,
) => building.ports.map((port) => worldPort(building, port, anchor, rotation));
