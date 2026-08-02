import { IRONWIND_TOPOGRAPHY } from "./ironwindTopography.ts";

export type IronwindCliffAssetId =
  | "ironwind_cliff_straight_16m"
  | "ironwind_cliff_outer_corner"
  | "ironwind_natural_arch";

export type WorldVector3 = Readonly<{ x: number; y: number; z: number }>;
export type WorldTransform = Readonly<{
  position: WorldVector3;
  rotation: WorldVector3;
  scale: WorldVector3;
}>;

export type CliffPlacementMetadata = Readonly<{
  moduleLength: number;
  lod: Readonly<{
    nodes: readonly ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"];
    distances: readonly [number, number];
    triangles: readonly [number, number, number];
  }>;
  collision: Readonly<{
    nodes: readonly string[];
    mode: "wall" | "arch_opening";
  }>;
  seams: Readonly<{
    start: WorldVector3;
    end: WorldVector3;
  }>;
  passage?: Readonly<{
    width: number;
    height: number;
    heading: number;
  }>;
}>;

export type IronwindCliffPlacement = Readonly<{
  id: string;
  assetId: IronwindCliffAssetId;
  transform: WorldTransform;
  metadata: CliffPlacementMetadata;
}>;

const MODULE_LENGTH = 16;
const CLIFF_HEIGHT = 12;
const CLIFF_HEIGHT_SCALE = IRONWIND_TOPOGRAPHY.relief / CLIFF_HEIGHT;
const CLIFF_FACE_OFFSET = 2.4;
const LOD_DISTANCES = [56, 128] as const;
const LOD_NODES = ["VIS_LOD0", "VIS_LOD1", "VIS_LOD2"] as const;
const STRAIGHT_TRIANGLES = [736, 336, 108] as const;
const CORNER_TRIANGLES = [840, 440, 168] as const;
const ARCH_TRIANGLES = [288, 192, 132] as const;

const faultXAt = (z: number) => IRONWIND_TOPOGRAPHY.fault.baseX
  + Math.sin((z + 18) * IRONWIND_TOPOGRAPHY.fault.wavelength) * IRONWIND_TOPOGRAPHY.fault.amplitude;

const headingFor = (from: Readonly<{ x: number; z: number }>, to: Readonly<{ x: number; z: number }>) => (
  Math.atan2(-(to.z - from.z), to.x - from.x)
);

const point3 = (x: number, y: number, z: number): WorldVector3 => ({ x, y, z });

/**
 * Deterministic P4 placement plan for the first Ironwind cliff kit.
 * Straight transforms follow authored 16 m fault samples. The terminal outer
 * corner wraps the cliff belt northward, while a separately scaled arch spans
 * the complete ten-metre coal vehicle corridor.
 */
export const createIronwindCliffPlacements = (): readonly IronwindCliffPlacement[] => {
  const baseY = IRONWIND_TOPOGRAPHY.lowerTerrace.height;
  const faultPoints = [-96, -80, -64, -48, -32, -16, 0]
    .map((z) => ({ x: faultXAt(z) - CLIFF_FACE_OFFSET, z }));
  const straights = faultPoints.slice(1).flatMap((to, index): IronwindCliffPlacement[] => {
    if (index === 3) return [];
    const from = faultPoints[index];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    return [{
      id: `ironwind-cliff:straight:${String(index).padStart(2, "0")}`,
      assetId: "ironwind_cliff_straight_16m",
      transform: {
        position: point3((from.x + to.x) * 0.5, baseY, (from.z + to.z) * 0.5),
        rotation: point3(0, headingFor(from, to), 0),
        scale: point3(length / MODULE_LENGTH, CLIFF_HEIGHT_SCALE, 1),
      },
      metadata: {
        moduleLength: MODULE_LENGTH,
        lod: { nodes: LOD_NODES, distances: LOD_DISTANCES, triangles: STRAIGHT_TRIANGLES },
        collision: { nodes: ["COL_WALL", "COL_WALKABLE"], mode: "wall" },
        seams: { start: point3(from.x, baseY, from.z), end: point3(to.x, baseY, to.z) },
      },
    }];
  });

  const cornerStart = faultPoints[faultPoints.length - 1];
  const previous = faultPoints[faultPoints.length - 2];
  const tangentX = cornerStart.x - previous.x;
  const tangentZ = cornerStart.z - previous.z;
  const tangentLength = Math.hypot(tangentX, tangentZ);
  const forward = { x: tangentX / tangentLength, z: tangentZ / tangentLength };
  const right = { x: -forward.z, z: forward.x };
  const cornerPivot = { x: cornerStart.x + forward.x * 8, z: cornerStart.z + forward.z * 8 };
  const cornerEnd = { x: cornerPivot.x + right.x * 8, z: cornerPivot.z + right.z * 8 };
  const corner: IronwindCliffPlacement = {
    id: "ironwind-cliff:outer-corner:00",
    assetId: "ironwind_cliff_outer_corner",
    transform: {
      position: point3(cornerPivot.x, baseY, cornerPivot.z),
      rotation: point3(0, headingFor(cornerStart, { x: cornerStart.x + forward.x, z: cornerStart.z + forward.z }), 0),
      scale: point3(1, CLIFF_HEIGHT_SCALE, 1),
    },
    metadata: {
      moduleLength: MODULE_LENGTH,
      lod: { nodes: LOD_NODES, distances: LOD_DISTANCES, triangles: CORNER_TRIANGLES },
      collision: { nodes: ["COL_WALL", "COL_WALKABLE"], mode: "wall" },
      seams: { start: point3(cornerStart.x, baseY, cornerStart.z), end: point3(cornerEnd.x, baseY, cornerEnd.z) },
    },
  };

  const vehicleFrom = { x: 38, z: -25 };
  const vehicleTo = { x: 69, z: -53 };
  const vehicleProgress = 0.4;
  const archPosition = {
    x: vehicleFrom.x + (vehicleTo.x - vehicleFrom.x) * vehicleProgress,
    z: vehicleFrom.z + (vehicleTo.z - vehicleFrom.z) * vehicleProgress,
  };
  const archWidthScale = 1.35;
  const archClearanceWidth = 8 * archWidthScale;
  const archHeading = Math.atan2(vehicleTo.x - vehicleFrom.x, vehicleTo.z - vehicleFrom.z);
  const vehicleLength = Math.hypot(vehicleTo.x - vehicleFrom.x, vehicleTo.z - vehicleFrom.z);
  const archCross = {
    x: (vehicleTo.z - vehicleFrom.z) / vehicleLength,
    z: -(vehicleTo.x - vehicleFrom.x) / vehicleLength,
  };
  const arch: IronwindCliffPlacement = {
    id: "ironwind-cliff:natural-arch:00",
    assetId: "ironwind_natural_arch",
    transform: {
      position: point3(
        archPosition.x,
        baseY + IRONWIND_TOPOGRAPHY.relief * vehicleProgress,
        archPosition.z,
      ),
      rotation: point3(0, archHeading, 0),
      scale: point3(archWidthScale, 1, 1),
    },
    metadata: {
      moduleLength: MODULE_LENGTH,
      lod: { nodes: LOD_NODES, distances: LOD_DISTANCES, triangles: ARCH_TRIANGLES },
      collision: { nodes: ["COL_WALL"], mode: "arch_opening" },
      seams: {
        start: point3(archPosition.x - archCross.x * 8 * archWidthScale, baseY, archPosition.z - archCross.z * 8 * archWidthScale),
        end: point3(archPosition.x + archCross.x * 8 * archWidthScale, baseY, archPosition.z + archCross.z * 8 * archWidthScale),
      },
      passage: { width: archClearanceWidth, height: 6.4, heading: archHeading },
    },
  };

  return [...straights, corner, arch];
};

export const IRONWIND_CLIFF_PLACEMENTS = createIronwindCliffPlacements();
