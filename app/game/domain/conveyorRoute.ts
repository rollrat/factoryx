import type { QuarterRotation } from "./placement.ts";
import type { GridCell } from "./types.ts";

export type ConveyorRouteCellKind = "straight" | "corner_cw" | "corner_ccw";

export type ConveyorRouteCell = Readonly<{
  x: number;
  z: number;
  /** Outgoing direction. The terminal cell keeps its incoming direction. */
  rotation: QuarterRotation;
  kind: ConveyorRouteCellKind;
}>;

const assertGridCell = (name: string, value: GridCell) => {
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.z)) {
    throw new RangeError(`${name} must contain safe integer grid coordinates`);
  }
};

const directionRotation = (from: GridCell, to: GridCell): QuarterRotation => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 1 && dz === 0) return 0;
  if (dx === 0 && dz === 1) return 1;
  if (dx === -1 && dz === 0) return 2;
  if (dx === 0 && dz === -1) return 3;
  throw new RangeError("conveyor route cells must be cardinally adjacent");
};

const normalizedRotation = (rotation: number): QuarterRotation => {
  if (!Number.isFinite(rotation)) throw new RangeError("defaultRotation must be finite");
  return (((Math.trunc(rotation) % 4) + 4) % 4) as QuarterRotation;
};

const pathCells = (start: GridCell, end: GridCell, zFirst: boolean): GridCell[] => {
  const result: GridCell[] = [{ ...start }];
  let x = start.x;
  let z = start.z;

  const walkX = () => {
    while (x !== end.x) {
      x += Math.sign(end.x - x);
      result.push({ x, z });
    }
  };
  const walkZ = () => {
    while (z !== end.z) {
      z += Math.sign(end.z - z);
      result.push({ x, z });
    }
  };

  if (zFirst) {
    walkZ();
    walkX();
  } else {
    walkX();
    walkZ();
  }
  return result;
};

/**
 * Builds the canonical one-cell-wide Manhattan conveyor route.
 *
 * Quarter rotations follow the placement convention: 0=+X, 1=+Z, 2=-X,
 * 3=-Z. On a corner, rotation is the outgoing direction; kind records whether
 * the turn from the incoming direction is clockwise or counter-clockwise.
 */
export const buildConveyorRoute = (
  start: GridCell,
  end: GridCell,
  zFirst: boolean,
  defaultRotation: number,
): readonly ConveyorRouteCell[] => {
  assertGridCell("start", start);
  assertGridCell("end", end);
  const cells = pathCells(start, end, zFirst);
  const fallbackRotation = normalizedRotation(defaultRotation);

  return cells.map((current, index) => {
    const previous = cells[index - 1];
    const next = cells[index + 1];
    const incoming = previous ? directionRotation(previous, current) : null;
    const outgoing = next ? directionRotation(current, next) : null;
    const rotation = outgoing ?? incoming ?? fallbackRotation;
    let kind: ConveyorRouteCellKind = "straight";

    if (incoming !== null && outgoing !== null && incoming !== outgoing) {
      const turn = (outgoing - incoming + 4) % 4;
      if (turn === 1) kind = "corner_cw";
      else if (turn === 3) kind = "corner_ccw";
      else throw new RangeError("conveyor route cannot reverse inside one cell");
    }

    return { x: current.x, z: current.z, rotation, kind };
  });
};
