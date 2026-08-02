import {
  safeParseWorldSourceV3,
  type CaveCorridor,
  type CaveGraph,
  type CavePortal,
  type CaveRoom,
  type Vec2,
  type Vec3,
  type WorldSourceV3,
} from "../worldSourceV3/index.ts";

export type CaveRuntimeIssue = Readonly<{
  code: string;
  path: string;
  message: string;
}>;

export type CaveRouteSegment = Readonly<{
  from: Vec3;
  to: Vec3;
  startDistance: number;
  endDistance: number;
  length: number;
  horizontalLength: number;
  gradeDegrees: number;
}>;

export type CaveRuntimeRoom = CaveRoom & Readonly<{
  clearance: number;
}>;

export type CaveRuntimePortal = CavePortal & Readonly<{
  clearance: number;
}>;

export type CaveRuntimeCorridor = CaveCorridor & Readonly<{
  route: readonly Vec3[];
  routeLength: number;
  segments: readonly CaveRouteSegment[];
  maxRouteGradeDegrees: number;
}>;

export type CaveRuntimeGraph = Readonly<{
  id: string;
  stratumId: string;
  rooms: readonly CaveRuntimeRoom[];
  portals: readonly CaveRuntimePortal[];
  corridors: readonly CaveRuntimeCorridor[];
}>;

export type CaveRuntimeView = Readonly<{
  graphs: readonly CaveRuntimeGraph[];
}>;

export type CaveRuntimeViewResult =
  | Readonly<{ ok: true; value: CaveRuntimeView }>
  | Readonly<{ ok: false; issues: readonly CaveRuntimeIssue[] }>;

const EPSILON = 1e-6;

const compareId = <T extends Readonly<{ id: string }>>(left: T, right: T) => left.id.localeCompare(right.id);
const distance3 = (from: Vec3, to: Vec3) => Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
const horizontalDistance = (from: Vec3, to: Vec3) => Math.hypot(to.x - from.x, to.z - from.z);

/** Includes a polygon edge so authored portal and corridor endpoints are stable at seams. */
const pointInPolygon = (point: Vec2, polygon: readonly Vec2[]) => {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const from = polygon[previous];
    const to = polygon[index];
    const cross = (point.z - from.z) * (to.x - from.x) - (point.x - from.x) * (to.z - from.z);
    const onSegment = Math.abs(cross) <= EPSILON
      && point.x >= Math.min(from.x, to.x) - EPSILON && point.x <= Math.max(from.x, to.x) + EPSILON
      && point.z >= Math.min(from.z, to.z) - EPSILON && point.z <= Math.max(from.z, to.z) + EPSILON;
    if (onSegment) return true;
    if ((from.z > point.z) !== (to.z > point.z)) {
      const crossingX = (to.x - from.x) * (point.z - from.z) / (to.z - from.z) + from.x;
      if (point.x < crossingX) inside = !inside;
    }
  }
  return inside;
};

const issue = (issues: CaveRuntimeIssue[], code: string, path: string, message: string) => {
  issues.push({ code, path, message });
};

const buildSegments = (route: readonly Vec3[]): readonly CaveRouteSegment[] => {
  let cursor = 0;
  return route.slice(1).map((to, index) => {
    const from = route[index];
    const length = distance3(from, to);
    const horizontalLength = horizontalDistance(from, to);
    const segment = {
      from,
      to,
      startDistance: cursor,
      endDistance: cursor + length,
      length,
      horizontalLength,
      gradeDegrees: Math.atan2(Math.abs(to.y - from.y), horizontalLength) * 180 / Math.PI,
    } as const;
    cursor = segment.endDistance;
    return segment;
  });
};

const validateGraph = (
  graph: CaveGraph,
  graphIndex: number,
  source: WorldSourceV3,
  issues: CaveRuntimeIssue[],
): CaveRuntimeGraph => {
  const graphPath = `$.caves[${graphIndex}]`;
  const rooms = [...graph.rooms].sort(compareId).map((room) => ({ ...room, clearance: room.ceilingHeight - room.floorHeight }));
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const portals = [...graph.portals].sort(compareId).map((portal) => {
    const room = roomById.get(portal.roomId);
    const portalPath = `${graphPath}.portals[${graph.portals.findIndex(({ id }) => id === portal.id)}]`;
    const clearance = room?.clearance ?? 0;
    if (room) {
      if (!pointInPolygon(portal.position, room.floorPolygon)) {
        issue(issues, "portal_outside_room", `${portalPath}.position`, "portal position must land in its room floor polygon");
      }
      if (!pointInPolygon(portal.position, portal.footprint)) {
        issue(issues, "portal_position_outside_footprint", `${portalPath}.position`, "portal position must land in its footprint");
      }
      if (portal.footprint.some((point) => !pointInPolygon(point, room.floorPolygon))) {
        issue(issues, "portal_footprint_outside_room", `${portalPath}.footprint`, "portal footprint must be fully contained by its room");
      }
      if (portal.position.y < room.floorHeight - EPSILON || portal.position.y > room.ceilingHeight + EPSILON) {
        issue(issues, "portal_vertical_clearance", `${portalPath}.position.y`, "portal elevation must be between its room floor and ceiling");
      }
    }
    return { ...portal, clearance };
  });

  rooms.forEach((room) => {
    const roomIndex = graph.rooms.findIndex(({ id }) => id === room.id);
    const roomPath = `${graphPath}.rooms[${roomIndex}]`;
    if (room.clearance <= EPSILON) issue(issues, "room_clearance", roomPath, "room ceiling must leave positive floor clearance");
    if (room.buildVolume) {
      const half = { x: room.buildVolume.size.x / 2, y: room.buildVolume.size.y / 2, z: room.buildVolume.size.z / 2 };
      if (room.buildVolume.center.y - half.y < room.floorHeight - EPSILON
        || room.buildVolume.center.y + half.y > room.ceilingHeight + EPSILON) {
        issue(issues, "build_volume_clearance", `${roomPath}.buildVolume`, "build volume must fit between room floor and ceiling");
      }
      const corners = [-1, 1].flatMap((x) => [-1, 1].map((z) => ({ x: room.buildVolume!.center.x + half.x * x, z: room.buildVolume!.center.z + half.z * z })));
      if (corners.some((corner) => !pointInPolygon(corner, room.floorPolygon))) {
        issue(issues, "build_volume_outside_room", `${roomPath}.buildVolume`, "build volume footprint must fit in the room floor polygon");
      }
    }
  });

  const splines = new Map(source.splines.map((spline) => [spline.id, spline]));
  const corridors = [...graph.corridors].sort(compareId).map((corridor) => {
    const corridorIndex = graph.corridors.findIndex(({ id }) => id === corridor.id);
    const corridorPath = `${graphPath}.corridors[${corridorIndex}]`;
    const spline = splines.get(corridor.splineId);
    const route = spline ? [...(spline.bakedPolyline ?? spline.controlPoints)] : [];
    const segments = buildSegments(route);
    const routeLength = segments.at(-1)?.endDistance ?? 0;
    const maxRouteGradeDegrees = Math.max(0, ...segments.map(({ gradeDegrees }) => gradeDegrees));
    const fromRoom = roomById.get(corridor.fromRoomId);
    const toRoom = roomById.get(corridor.toRoomId);
    if (corridor.clearance <= EPSILON) issue(issues, "corridor_clearance", `${corridorPath}.clearance`, "corridor must leave positive floor clearance");
    if (fromRoom && route[0] && !pointInPolygon(route[0], fromRoom.floorPolygon)) {
      issue(issues, "corridor_start_outside_room", `${corridorPath}.splineId`, "route start must land in the source room");
    }
    if (toRoom && route.at(-1) && !pointInPolygon(route.at(-1)!, toRoom.floorPolygon)) {
      issue(issues, "corridor_end_outside_room", `${corridorPath}.splineId`, "route end must land in the destination room");
    }
    if (spline && maxRouteGradeDegrees > spline.maxGradeDegrees + EPSILON) {
      issue(issues, "route_grade", `${corridorPath}.splineId`, `route grade ${maxRouteGradeDegrees.toFixed(3)} exceeds ${spline.maxGradeDegrees}`);
    }
    return { ...corridor, route, routeLength, segments, maxRouteGradeDegrees };
  });

  if (rooms.length > 0) {
    const adjacent = new Map(rooms.map((room) => [room.id, new Set<string>()]));
    corridors.forEach((corridor) => {
      adjacent.get(corridor.fromRoomId)?.add(corridor.toRoomId);
      adjacent.get(corridor.toRoomId)?.add(corridor.fromRoomId);
    });
    const visited = new Set<string>([rooms[0].id]);
    const pending = [rooms[0].id];
    while (pending.length) {
      const roomId = pending.shift()!;
      [...(adjacent.get(roomId) ?? [])].sort().forEach((next) => {
        if (!visited.has(next)) { visited.add(next); pending.push(next); }
      });
    }
    rooms.filter((room) => !visited.has(room.id)).forEach((room) => {
      issue(issues, "disconnected_room", graphPath, `room ${room.id} is not connected by a corridor`);
    });
  }
  return { id: graph.id, stratumId: graph.stratumId, rooms, portals, corridors };
};

export const safeCreateCaveRuntimeView = (value: unknown): CaveRuntimeViewResult => {
  const parsed = safeParseWorldSourceV3(value);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  const issues: CaveRuntimeIssue[] = [];
  const graphs = parsed.value.caves
    .map((graph, index) => validateGraph(graph, index, parsed.value, issues))
    .sort(compareId);
  return issues.length ? { ok: false, issues } : { ok: true, value: { graphs } };
};

export class CaveRuntimeValidationError extends Error {
  readonly issues: readonly CaveRuntimeIssue[];

  constructor(issues: readonly CaveRuntimeIssue[]) {
    super(`Invalid cave runtime view: ${issues.map(({ path, message }) => `${path}: ${message}`).join("; ")}`);
    this.name = "CaveRuntimeValidationError";
    this.issues = issues;
  }
}

export const createCaveRuntimeView = (value: unknown): CaveRuntimeView => {
  const result = safeCreateCaveRuntimeView(value);
  if (!result.ok) throw new CaveRuntimeValidationError(result.issues);
  return result.value;
};
