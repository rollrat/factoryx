import {
  WORLD_SOURCE_CHUNK_SIZE,
  WORLD_SOURCE_FORMAT,
  WORLD_SOURCE_SAMPLE_SPACING,
  WORLD_SOURCE_SCHEMA_VERSION,
  type CaveGraph,
  type WorldBounds,
  type WorldSourceParseResult,
  type WorldSourceV3,
  type WorldSourceValidationIssue,
  type Vec2,
  type Vec3,
} from "./types.ts";

const ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/;
const EPSILON = 1e-8;

type MutableIssue = WorldSourceValidationIssue;
type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (record: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(record, key);

const issue = (
  issues: MutableIssue[],
  code: WorldSourceValidationIssue["code"],
  path: string,
  message: string,
) => issues.push({ code, path, message });

const object = (
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: MutableIssue[],
): RecordValue | null => {
  if (!isRecord(value)) {
    issue(issues, "invalid_type", path, "expected an object");
    return null;
  }
  const allowed = new Set([...required, ...optional]);
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) issue(issues, "unknown_property", `${path}.${key}`, "property is not part of WorldSourceV3");
  });
  required.forEach((key) => {
    if (!own(value, key)) issue(issues, "missing_property", `${path}.${key}`, "required property is missing");
  });
  return value;
};

const array = (value: unknown, path: string, issues: MutableIssue[], min = 0, max = 8192): readonly unknown[] | null => {
  if (!Array.isArray(value)) {
    issue(issues, "invalid_type", path, "expected an array");
    return null;
  }
  if (value.length < min || value.length > max) issue(issues, "invalid_value", path, `array length must be ${min}..${max}`);
  return value;
};

const finite = (value: unknown, path: string, issues: MutableIssue[]): value is number => {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
    issue(issues, "invalid_type", path, "expected a finite JSON number (negative zero is not canonical)");
    return false;
  }
  return true;
};

const numberInRange = (value: unknown, path: string, issues: MutableIssue[], min: number, max: number) => {
  if (finite(value, path, issues) && (value < min || value > max)) issue(issues, "invalid_value", path, `number must be in ${min}..${max}`);
};

const positive = (value: unknown, path: string, issues: MutableIssue[], allowZero = false) => {
  if (finite(value, path, issues) && (allowZero ? value < 0 : value <= 0)) {
    issue(issues, "invalid_value", path, allowZero ? "number must be non-negative" : "number must be positive");
  }
};

const safeInteger = (value: unknown, path: string, issues: MutableIssue[], min = Number.MIN_SAFE_INTEGER) => {
  if (!finite(value, path, issues)) return;
  if (!Number.isSafeInteger(value) || value < min) issue(issues, "invalid_value", path, `expected a safe integer >= ${min}`);
};

const literal = <T extends string | number>(value: unknown, expected: T, path: string, issues: MutableIssue[]) => {
  if (value !== expected) issue(issues, "invalid_value", path, `expected ${JSON.stringify(expected)}`);
};

const oneOf = <T extends string>(value: unknown, values: readonly T[], path: string, issues: MutableIssue[]): value is T => {
  if (typeof value !== "string" || !values.includes(value as T)) {
    issue(issues, "invalid_value", path, `expected one of ${values.join(", ")}`);
    return false;
  }
  return true;
};

const text = (value: unknown, path: string, issues: MutableIssue[], id = false) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 160 || (id && !ID_PATTERN.test(value))) {
    issue(issues, "invalid_value", path, id ? "expected a stable lowercase ID" : "expected a non-empty string of at most 160 characters");
  }
};

const boolean = (value: unknown, path: string, issues: MutableIssue[]) => {
  if (typeof value !== "boolean") issue(issues, "invalid_type", path, "expected a boolean");
};

const stringList = (value: unknown, path: string, issues: MutableIssue[], ids = false) => {
  const values = array(value, path, issues, 0, 256);
  if (!values) return;
  const seen = new Set<string>();
  values.forEach((entry, index) => {
    text(entry, `${path}[${index}]`, issues, ids);
    if (typeof entry === "string") {
      if (seen.has(entry)) issue(issues, "invalid_value", `${path}[${index}]`, "duplicate list value");
      seen.add(entry);
    }
  });
};

const vec2 = (value: unknown, path: string, issues: MutableIssue[]) => {
  const result = object(value, path, ["x", "z"], [], issues);
  if (!result) return;
  finite(result.x, `${path}.x`, issues);
  finite(result.z, `${path}.z`, issues);
};

const vec3 = (value: unknown, path: string, issues: MutableIssue[], positiveComponents = false) => {
  const result = object(value, path, ["x", "y", "z"], [], issues);
  if (!result) return;
  (positiveComponents ? positive : finite)(result.x, `${path}.x`, issues);
  (positiveComponents ? positive : finite)(result.y, `${path}.y`, issues);
  (positiveComponents ? positive : finite)(result.z, `${path}.z`, issues);
};

const quaternion = (value: unknown, path: string, issues: MutableIssue[]) => {
  const result = object(value, path, ["x", "y", "z", "w"], [], issues);
  if (!result) return;
  finite(result.x, `${path}.x`, issues);
  finite(result.y, `${path}.y`, issues);
  finite(result.z, `${path}.z`, issues);
  finite(result.w, `${path}.w`, issues);
};

const polygonShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const points = array(value, path, issues, 3, 4096);
  points?.forEach((point, index) => vec2(point, `${path}[${index}]`, issues));
};

const holesShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const holes = array(value, path, issues, 0, 128);
  holes?.forEach((hole, index) => polygonShape(hole, `${path}[${index}]`, issues));
};

const priority = (value: unknown, path: string, issues: MutableIssue[]) => {
  safeInteger(value, path, issues, -1_000_000);
  if (typeof value === "number" && value > 1_000_000) issue(issues, "invalid_value", path, "priority is outside the supported range");
};

const validateMacroFormShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const form = object(value, path,
    ["id", "kind", "priority", "operation", "center", "rotationRadians", "size", "height", "falloff", "biomeId", "gameplayTags"],
    ["splineId"], issues);
  if (!form) return;
  text(form.id, `${path}.id`, issues, true);
  oneOf(form.kind, ["basin", "plateau", "ridge", "fault-step", "canyon", "crater-ring", "sinkhole", "saddle"], `${path}.kind`, issues);
  priority(form.priority, `${path}.priority`, issues);
  oneOf(form.operation, ["add", "min", "max", "carve", "smooth-union"], `${path}.operation`, issues);
  vec2(form.center, `${path}.center`, issues);
  finite(form.rotationRadians, `${path}.rotationRadians`, issues);
  const size = object(form.size, `${path}.size`, ["x", "z"], [], issues);
  if (size) {
    positive(size.x, `${path}.size.x`, issues);
    positive(size.z, `${path}.size.z`, issues);
  }
  finite(form.height, `${path}.height`, issues);
  positive(form.falloff, `${path}.falloff`, issues, true);
  text(form.biomeId, `${path}.biomeId`, issues, true);
  if (own(form, "splineId")) text(form.splineId, `${path}.splineId`, issues, true);
  stringList(form.gameplayTags, `${path}.gameplayTags`, issues);
};

const validateBiomeRegionShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const region = object(value, path, ["id", "biomeId", "priority", "polygon", "holes", "transition"], [], issues);
  if (!region) return;
  text(region.id, `${path}.id`, issues, true);
  text(region.biomeId, `${path}.biomeId`, issues, true);
  priority(region.priority, `${path}.priority`, issues);
  polygonShape(region.polygon, `${path}.polygon`, issues);
  holesShape(region.holes, `${path}.holes`, issues);
  const transition = object(region.transition, `${path}.transition`, ["terrain", "material", "vegetation", "atmosphere"], [], issues);
  if (transition) Object.entries(transition).forEach(([key, width]) => numberInRange(width, `${path}.transition.${key}`, issues, 0, 256));
};

const validateSplineShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const spline = object(value, path,
    ["id", "kind", "priority", "operation", "stratumId", "width", "maxGradeDegrees", "minTurnRadius", "controlPoints"],
    ["bakedPolyline"], issues);
  if (!spline) return;
  text(spline.id, `${path}.id`, issues, true);
  oneOf(spline.kind, ["route", "river", "cliff", "cave"], `${path}.kind`, issues);
  priority(spline.priority, `${path}.priority`, issues);
  oneOf(spline.operation, ["flatten", "carve", "mark"], `${path}.operation`, issues);
  text(spline.stratumId, `${path}.stratumId`, issues, true);
  positive(spline.width, `${path}.width`, issues);
  numberInRange(spline.maxGradeDegrees, `${path}.maxGradeDegrees`, issues, 0, 90);
  positive(spline.minTurnRadius, `${path}.minTurnRadius`, issues, true);
  const points = array(spline.controlPoints, `${path}.controlPoints`, issues, 2, 8192);
  points?.forEach((point, index) => vec3(point, `${path}.controlPoints[${index}]`, issues));
  if (own(spline, "bakedPolyline")) {
    const baked = array(spline.bakedPolyline, `${path}.bakedPolyline`, issues, 2, 65_536);
    baked?.forEach((point, index) => vec3(point, `${path}.bakedPolyline[${index}]`, issues));
  }
};

const validateWaterBodyShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  if (!isRecord(value)) {
    issue(issues, "invalid_type", path, "expected an object");
    return;
  }
  if (value.kind === "lake" || value.kind === "marsh") {
    const water = object(value, path, ["id", "kind", "priority", "polygon", "holes", "level"], ["outletSplineId"], issues);
    if (!water) return;
    text(water.id, `${path}.id`, issues, true);
    priority(water.priority, `${path}.priority`, issues);
    polygonShape(water.polygon, `${path}.polygon`, issues);
    holesShape(water.holes, `${path}.holes`, issues);
    finite(water.level, `${path}.level`, issues);
    if (own(water, "outletSplineId")) text(water.outletSplineId, `${path}.outletSplineId`, issues, true);
    return;
  }
  if (value.kind === "river") {
    const water = object(value, path, ["id", "kind", "priority", "splineId", "widthProfile", "bedProfile", "flowSpeed"], [], issues);
    if (!water) return;
    text(water.id, `${path}.id`, issues, true);
    priority(water.priority, `${path}.priority`, issues);
    text(water.splineId, `${path}.splineId`, issues, true);
    const widths = array(water.widthProfile, `${path}.widthProfile`, issues, 2, 8192);
    widths?.forEach((entry, index) => positive(entry, `${path}.widthProfile[${index}]`, issues));
    const beds = array(water.bedProfile, `${path}.bedProfile`, issues, 2, 8192);
    beds?.forEach((entry, index) => finite(entry, `${path}.bedProfile[${index}]`, issues));
    positive(water.flowSpeed, `${path}.flowSpeed`, issues, true);
    return;
  }
  if (value.kind === "waterfall") {
    const water = object(value, path, ["id", "kind", "priority", "fromSocket", "toSocket", "width"], [], issues);
    if (!water) return;
    text(water.id, `${path}.id`, issues, true);
    priority(water.priority, `${path}.priority`, issues);
    text(water.fromSocket, `${path}.fromSocket`, issues);
    text(water.toSocket, `${path}.toSocket`, issues);
    positive(water.width, `${path}.width`, issues);
    return;
  }
  issue(issues, "invalid_value", `${path}.kind`, "unknown water body kind");
};

const validateGameplayVolumeShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const volume = object(value, path, ["kind", "center", "size"], [], issues);
  if (!volume) return;
  literal(volume.kind, "box", `${path}.kind`, issues);
  vec3(volume.center, `${path}.center`, issues);
  vec3(volume.size, `${path}.size`, issues, true);
};

const validateCaveGraphShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const graph = object(value, path, ["id", "stratumId", "rooms", "corridors", "portals"], [], issues);
  if (!graph) return;
  text(graph.id, `${path}.id`, issues, true);
  text(graph.stratumId, `${path}.stratumId`, issues, true);
  const rooms = array(graph.rooms, `${path}.rooms`, issues, 1, 1024);
  rooms?.forEach((entry, index) => {
    const roomPath = `${path}.rooms[${index}]`;
    const room = object(entry, roomPath,
      ["id", "shellAssetId", "floorPolygon", "floorHeight", "ceilingHeight", "portalIds"], ["buildVolume"], issues);
    if (!room) return;
    text(room.id, `${roomPath}.id`, issues, true);
    text(room.shellAssetId, `${roomPath}.shellAssetId`, issues, true);
    polygonShape(room.floorPolygon, `${roomPath}.floorPolygon`, issues);
    finite(room.floorHeight, `${roomPath}.floorHeight`, issues);
    finite(room.ceilingHeight, `${roomPath}.ceilingHeight`, issues);
    if (own(room, "buildVolume")) validateGameplayVolumeShape(room.buildVolume, `${roomPath}.buildVolume`, issues);
    stringList(room.portalIds, `${roomPath}.portalIds`, issues, true);
  });
  const corridors = array(graph.corridors, `${path}.corridors`, issues, 0, 2048);
  corridors?.forEach((entry, index) => {
    const corridorPath = `${path}.corridors[${index}]`;
    const corridor = object(entry, corridorPath, ["id", "fromRoomId", "toRoomId", "splineId", "width", "clearance"], [], issues);
    if (!corridor) return;
    text(corridor.id, `${corridorPath}.id`, issues, true);
    text(corridor.fromRoomId, `${corridorPath}.fromRoomId`, issues, true);
    text(corridor.toRoomId, `${corridorPath}.toRoomId`, issues, true);
    text(corridor.splineId, `${corridorPath}.splineId`, issues, true);
    positive(corridor.width, `${corridorPath}.width`, issues);
    positive(corridor.clearance, `${corridorPath}.clearance`, issues);
  });
  const portals = array(graph.portals, `${path}.portals`, issues, 1, 2048);
  portals?.forEach((entry, index) => {
    const portalPath = `${path}.portals[${index}]`;
    const portal = object(entry, portalPath, ["id", "roomId", "position", "footprint", "transitionAssetId"], [], issues);
    if (!portal) return;
    text(portal.id, `${portalPath}.id`, issues, true);
    text(portal.roomId, `${portalPath}.roomId`, issues, true);
    vec3(portal.position, `${portalPath}.position`, issues);
    polygonShape(portal.footprint, `${portalPath}.footprint`, issues);
    text(portal.transitionAssetId, `${portalPath}.transitionAssetId`, issues, true);
  });
};

const validateGameplayZoneShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const zone = object(value, path, ["id", "kind", "priority", "operation", "stratumId", "polygon", "holes", "tags"], ["elevationRange"], issues);
  if (!zone) return;
  text(zone.id, `${path}.id`, issues, true);
  oneOf(zone.kind, ["build-patch", "resource-pad", "route-corridor", "build-exclusion", "hazard"], `${path}.kind`, issues);
  priority(zone.priority, `${path}.priority`, issues);
  oneOf(zone.operation, ["include", "exclude"], `${path}.operation`, issues);
  text(zone.stratumId, `${path}.stratumId`, issues, true);
  polygonShape(zone.polygon, `${path}.polygon`, issues);
  holesShape(zone.holes, `${path}.holes`, issues);
  stringList(zone.tags, `${path}.tags`, issues);
  if (own(zone, "elevationRange")) {
    const range = object(zone.elevationRange, `${path}.elevationRange`, ["min", "max"], [], issues);
    if (range) {
      finite(range.min, `${path}.elevationRange.min`, issues);
      finite(range.max, `${path}.elevationRange.max`, issues);
    }
  }
};

const validatePlacementShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const placement = object(value, path, ["id", "assetId", "priority", "stratumId", "biomeId", "transform", "tags"], [], issues);
  if (!placement) return;
  text(placement.id, `${path}.id`, issues, true);
  text(placement.assetId, `${path}.assetId`, issues, true);
  priority(placement.priority, `${path}.priority`, issues);
  text(placement.stratumId, `${path}.stratumId`, issues, true);
  text(placement.biomeId, `${path}.biomeId`, issues, true);
  const transform = object(placement.transform, `${path}.transform`, ["position", "rotation", "scale"], [], issues);
  if (transform) {
    vec3(transform.position, `${path}.transform.position`, issues);
    quaternion(transform.rotation, `${path}.transform.rotation`, issues);
    vec3(transform.scale, `${path}.transform.scale`, issues, true);
  }
  stringList(placement.tags, `${path}.tags`, issues);
};

const validateResourceAnchorShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const anchor = object(value, path,
    ["id", "itemId", "position", "extractionBuildingId", "recipeId", "unlockId", "medium", "stratumId", "padRadius", "protectionRadius"], [], issues);
  if (!anchor) return;
  text(anchor.id, `${path}.id`, issues, true);
  text(anchor.itemId, `${path}.itemId`, issues, true);
  vec3(anchor.position, `${path}.position`, issues);
  text(anchor.extractionBuildingId, `${path}.extractionBuildingId`, issues, true);
  text(anchor.recipeId, `${path}.recipeId`, issues, true);
  text(anchor.unlockId, `${path}.unlockId`, issues, true);
  oneOf(anchor.medium, ["solid", "fluid"], `${path}.medium`, issues);
  text(anchor.stratumId, `${path}.stratumId`, issues, true);
  positive(anchor.padRadius, `${path}.padRadius`, issues);
  positive(anchor.protectionRadius, `${path}.protectionRadius`, issues);
};

const validateReviewCameraShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const camera = object(value, path,
    ["id", "name", "purpose", "position", "target", "fov", "timeOfDay", "weather", "weatherStrength", "quality", "expectedLandmarkIds"], [], issues);
  if (!camera) return;
  text(camera.id, `${path}.id`, issues, true);
  text(camera.name, `${path}.name`, issues);
  oneOf(camera.purpose, ["baseline", "topology", "scale", "route", "reveal", "water", "cave", "vista"], `${path}.purpose`, issues);
  vec3(camera.position, `${path}.position`, issues);
  vec3(camera.target, `${path}.target`, issues);
  numberInRange(camera.fov, `${path}.fov`, issues, 1, 179);
  numberInRange(camera.timeOfDay, `${path}.timeOfDay`, issues, 0, 1);
  oneOf(camera.weather, ["clear", "mist", "mineral_wind", "electrical_storm"], `${path}.weather`, issues);
  numberInRange(camera.weatherStrength, `${path}.weatherStrength`, issues, 0, 1);
  oneOf(camera.quality, ["low", "high"], `${path}.quality`, issues);
  stringList(camera.expectedLandmarkIds, `${path}.expectedLandmarkIds`, issues, true);
};

const validateLegacyLayerShape = (value: unknown, path: string, issues: MutableIssue[]) => {
  const layer = object(value, path,
    ["id", "sourceFormat", "sourceVersion", "priority", "operation", "strokes", "environmentSettings", "landmarkOffsets"], [], issues);
  if (!layer) return;
  text(layer.id, `${path}.id`, issues, true);
  literal(layer.sourceFormat, "factoryx-world-studio", `${path}.sourceFormat`, issues);
  literal(layer.sourceVersion, 2, `${path}.sourceVersion`, issues);
  priority(layer.priority, `${path}.priority`, issues);
  literal(layer.operation, "legacy-sculpt", `${path}.operation`, issues);
  const strokes = array(layer.strokes, `${path}.strokes`, issues, 0, 4096);
  strokes?.forEach((entry, index) => {
    const strokePath = `${path}.strokes[${index}]`;
    const stroke = object(entry, strokePath, ["brush", "x", "z", "radius", "strength"], ["biomeId", "surface", "targetHeight"], issues);
    if (!stroke) return;
    oneOf(stroke.brush, ["raise", "lower", "flatten", "smooth", "biome", "surface", "rock_scatter", "vegetation_scatter"], `${strokePath}.brush`, issues);
    finite(stroke.x, `${strokePath}.x`, issues);
    finite(stroke.z, `${strokePath}.z`, issues);
    numberInRange(stroke.radius, `${strokePath}.radius`, issues, Number.MIN_VALUE, 64);
    numberInRange(stroke.strength, `${strokePath}.strength`, issues, 0, 4);
    if (own(stroke, "biomeId")) text(stroke.biomeId, `${strokePath}.biomeId`, issues, true);
    if (own(stroke, "surface")) oneOf(stroke.surface, ["stable", "soft", "steep", "submerged", "hazard", "cave_floor"], `${strokePath}.surface`, issues);
    if (own(stroke, "targetHeight")) finite(stroke.targetHeight, `${strokePath}.targetHeight`, issues);
  });
  const settings = object(layer.environmentSettings, `${path}.environmentSettings`,
    ["timeOfDay", "sunAzimuth", "fogDensity", "weather", "weatherStrength", "scatterDensity", "landmarksVisible", "resourceAnchorsVisible", "quality"], [], issues);
  if (settings) {
    numberInRange(settings.timeOfDay, `${path}.environmentSettings.timeOfDay`, issues, 0, 1);
    numberInRange(settings.sunAzimuth, `${path}.environmentSettings.sunAzimuth`, issues, -1, 1);
    numberInRange(settings.fogDensity, `${path}.environmentSettings.fogDensity`, issues, 0, 0.04);
    oneOf(settings.weather, ["clear", "mist", "mineral_wind", "electrical_storm"], `${path}.environmentSettings.weather`, issues);
    numberInRange(settings.weatherStrength, `${path}.environmentSettings.weatherStrength`, issues, 0, 1);
    numberInRange(settings.scatterDensity, `${path}.environmentSettings.scatterDensity`, issues, 0, 1);
    boolean(settings.landmarksVisible, `${path}.environmentSettings.landmarksVisible`, issues);
    boolean(settings.resourceAnchorsVisible, `${path}.environmentSettings.resourceAnchorsVisible`, issues);
    oneOf(settings.quality, ["low", "high"], `${path}.environmentSettings.quality`, issues);
  }
  if (!isRecord(layer.landmarkOffsets)) {
    issue(issues, "invalid_type", `${path}.landmarkOffsets`, "expected an object keyed by landmark ID");
  } else {
    Object.entries(layer.landmarkOffsets).forEach(([id, raw]) => {
      text(id, `${path}.landmarkOffsets.${id}`, issues, true);
      const offset = object(raw, `${path}.landmarkOffsets.${id}`, ["x", "z", "rotation"], [], issues);
      if (!offset) return;
      numberInRange(offset.x, `${path}.landmarkOffsets.${id}.x`, issues, -64, 64);
      numberInRange(offset.z, `${path}.landmarkOffsets.${id}.z`, issues, -64, 64);
      numberInRange(offset.rotation, `${path}.landmarkOffsets.${id}.rotation`, issues, -Math.PI * 2, Math.PI * 2);
    });
  }
};

const validateRootShape = (value: unknown, issues: MutableIssue[]): value is RecordValue => {
  const source = object(value, "$", [
    "format", "schemaVersion", "environmentId", "environmentVersion", "generatorVersion", "seed", "coordinateSystem", "bounds",
    "chunkSize", "sampleSpacing", "macroForms", "biomeRegions", "splines", "waterBodies", "caves", "gameplayZones", "placements",
    "resourceAnchors", "reviewCameras",
  ], ["legacySculptLayer"], issues);
  if (!source) return false;
  literal(source.format, WORLD_SOURCE_FORMAT, "$.format", issues);
  literal(source.schemaVersion, WORLD_SOURCE_SCHEMA_VERSION, "$.schemaVersion", issues);
  text(source.environmentId, "$.environmentId", issues, true);
  safeInteger(source.environmentVersion, "$.environmentVersion", issues, 1);
  safeInteger(source.generatorVersion, "$.generatorVersion", issues, 1);
  safeInteger(source.seed, "$.seed", issues, 0);
  const coordinate = object(source.coordinateSystem, "$.coordinateSystem", ["handedness", "up", "forward", "unit"], [], issues);
  if (coordinate) {
    literal(coordinate.handedness, "right", "$.coordinateSystem.handedness", issues);
    literal(coordinate.up, "+Y", "$.coordinateSystem.up", issues);
    literal(coordinate.forward, "+Z", "$.coordinateSystem.forward", issues);
    literal(coordinate.unit, "meter", "$.coordinateSystem.unit", issues);
  }
  const bounds = object(source.bounds, "$.bounds", ["minX", "maxXExclusive", "minZ", "maxZExclusive"], [], issues);
  if (bounds) Object.entries(bounds).forEach(([key, entry]) => finite(entry, `$.bounds.${key}`, issues));
  literal(source.chunkSize, WORLD_SOURCE_CHUNK_SIZE, "$.chunkSize", issues);
  literal(source.sampleSpacing, WORLD_SOURCE_SAMPLE_SPACING, "$.sampleSpacing", issues);

  const validators: ReadonlyArray<readonly [string, number, (entry: unknown, path: string, target: MutableIssue[]) => void]> = [
    ["macroForms", 2048, validateMacroFormShape],
    ["biomeRegions", 512, validateBiomeRegionShape],
    ["splines", 2048, validateSplineShape],
    ["waterBodies", 1024, validateWaterBodyShape],
    ["caves", 256, validateCaveGraphShape],
    ["gameplayZones", 2048, validateGameplayZoneShape],
    ["placements", 65_536, validatePlacementShape],
    ["resourceAnchors", 4096, validateResourceAnchorShape],
    ["reviewCameras", 512, validateReviewCameraShape],
  ];
  validators.forEach(([key, max, validator]) => {
    const values = array(source[key], `$.${key}`, issues, 0, max);
    values?.forEach((entry, index) => validator(entry, `$.${key}[${index}]`, issues));
  });
  if (own(source, "legacySculptLayer")) validateLegacyLayerShape(source.legacySculptLayer, "$.legacySculptLayer", issues);
  return true;
};

const insideBounds = (point: Vec2 | Vec3, bounds: WorldBounds) => point.x >= bounds.minX && point.x < bounds.maxXExclusive
  && point.z >= bounds.minZ && point.z < bounds.maxZExclusive;

const validatePointBounds = (point: Vec2 | Vec3, path: string, bounds: WorldBounds, issues: MutableIssue[]) => {
  if (!insideBounds(point, bounds)) issue(issues, "out_of_bounds", path, "x/z coordinate lies outside the half-open world bounds");
};

const signedArea = (polygon: readonly Vec2[]) => polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length];
  return sum + point.x * next.z - next.x * point.z;
}, 0) * 0.5;

const orientation = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const onSegment = (a: Vec2, b: Vec2, point: Vec2) => Math.abs(orientation(a, b, point)) <= EPSILON
  && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
  && point.z >= Math.min(a.z, b.z) - EPSILON && point.z <= Math.max(a.z, b.z) + EPSILON;

const segmentsIntersect = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && onSegment(a, b, c))
    || (Math.abs(abD) <= EPSILON && onSegment(a, b, d))
    || (Math.abs(cdA) <= EPSILON && onSegment(c, d, a))
    || (Math.abs(cdB) <= EPSILON && onSegment(c, d, b));
};

const pointInPolygon = (point: Vec2, polygon: readonly Vec2[]) => {
  if (polygon.some((vertex, index) => onSegment(vertex, polygon[(index + 1) % polygon.length], point))) return true;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if (((a.z > point.z) !== (b.z > point.z))
      && point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

const polygonEdgesIntersect = (a: readonly Vec2[], b: readonly Vec2[]) => a.some((start, index) => {
  const end = a[(index + 1) % a.length];
  return b.some((otherStart, otherIndex) => segmentsIntersect(start, end, otherStart, b[(otherIndex + 1) % b.length]));
});

const validatePolygon = (
  polygon: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  path: string,
  bounds: WorldBounds,
  issues: MutableIssue[],
) => {
  const validateRing = (ring: readonly Vec2[], ringPath: string, ccw: boolean) => {
    ring.forEach((point, index) => validatePointBounds(point, `${ringPath}[${index}]`, bounds, issues));
    if (ring.length >= 2 && ring[0].x === ring[ring.length - 1].x && ring[0].z === ring[ring.length - 1].z) {
      issue(issues, "invalid_polygon", ringPath, "polygon must not repeat its first point at the end");
    }
    const keys = new Set<string>();
    ring.forEach((point, index) => {
      const key = `${point.x},${point.z}`;
      if (keys.has(key)) issue(issues, "invalid_polygon", `${ringPath}[${index}]`, "polygon contains a repeated vertex");
      keys.add(key);
    });
    const area = signedArea(ring);
    if (Math.abs(area) <= EPSILON) issue(issues, "invalid_polygon", ringPath, "polygon has zero area");
    else if ((area > 0) !== ccw) issue(issues, "invalid_polygon", ringPath, ccw ? "outer polygon must be CCW" : "hole polygon must be CW");
    for (let first = 0; first < ring.length; first += 1) {
      const firstNext = (first + 1) % ring.length;
      for (let second = first + 1; second < ring.length; second += 1) {
        const secondNext = (second + 1) % ring.length;
        if (first === second || firstNext === second || secondNext === first) continue;
        if (segmentsIntersect(ring[first], ring[firstNext], ring[second], ring[secondNext])) {
          issue(issues, "invalid_polygon", ringPath, "polygon self-intersects");
          return;
        }
      }
    }
  };
  validateRing(polygon, `${path}.polygon`, true);
  holes.forEach((hole, index) => {
    const holePath = `${path}.holes[${index}]`;
    validateRing(hole, holePath, false);
    if (!hole.every((point) => pointInPolygon(point, polygon)) || polygonEdgesIntersect(polygon, hole)) {
      issue(issues, "invalid_polygon", holePath, "hole must be strictly contained by the outer polygon");
    }
    holes.slice(0, index).forEach((other) => {
      if (polygonEdgesIntersect(other, hole) || pointInPolygon(hole[0], other) || pointInPolygon(other[0], hole)) {
        issue(issues, "invalid_polygon", holePath, "polygon holes must not overlap or touch");
      }
    });
  });
};

const pointDistance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const validateSpline = (spline: WorldSourceV3["splines"][number], path: string, bounds: WorldBounds, issues: MutableIssue[]) => {
  const validateLine = (points: readonly Vec3[], linePath: string) => {
    points.forEach((point, index) => {
      validatePointBounds(point, `${linePath}[${index}]`, bounds, issues);
      if (index > 0 && pointDistance(points[index - 1], point) <= EPSILON) {
        issue(issues, "invalid_spline", `${linePath}[${index}]`, "spline contains a zero-length segment");
      }
    });
  };
  validateLine(spline.controlPoints, `${path}.controlPoints`);
  if (spline.bakedPolyline) {
    validateLine(spline.bakedPolyline, `${path}.bakedPolyline`);
    if (pointDistance(spline.controlPoints[0], spline.bakedPolyline[0]) > EPSILON
      || pointDistance(spline.controlPoints[spline.controlPoints.length - 1], spline.bakedPolyline[spline.bakedPolyline.length - 1]) > EPSILON) {
      issue(issues, "invalid_spline", `${path}.bakedPolyline`, "baked polyline endpoints must match the authored control points");
    }
  }
};

const addStableId = (ids: Map<string, string>, id: string, path: string, issues: MutableIssue[]) => {
  const firstPath = ids.get(id);
  if (firstPath) issue(issues, "duplicate_id", path, `stable ID ${id} is already used at ${firstPath}`);
  else ids.set(id, path);
};

const validateCaveReferences = (
  graph: CaveGraph,
  graphPath: string,
  splines: ReadonlyMap<string, WorldSourceV3["splines"][number]>,
  bounds: WorldBounds,
  issues: MutableIssue[],
) => {
  const rooms = new Map(graph.rooms.map((room) => [room.id, room]));
  const portals = new Map(graph.portals.map((portal) => [portal.id, portal]));
  graph.rooms.forEach((room, index) => {
    const roomPath = `${graphPath}.rooms[${index}]`;
    validatePolygon(room.floorPolygon, [], `${roomPath}.floor`, bounds, issues);
    if (room.ceilingHeight <= room.floorHeight) issue(issues, "invalid_value", `${roomPath}.ceilingHeight`, "ceiling must be above the floor");
    if (room.buildVolume) validatePointBounds(room.buildVolume.center, `${roomPath}.buildVolume.center`, bounds, issues);
    room.portalIds.forEach((portalId, portalIndex) => {
      const portal = portals.get(portalId);
      if (!portal) issue(issues, "broken_reference", `${roomPath}.portalIds[${portalIndex}]`, "portal does not exist in this cave graph");
      else if (portal.roomId !== room.id) issue(issues, "broken_reference", `${roomPath}.portalIds[${portalIndex}]`, "portal belongs to a different room");
    });
  });
  graph.portals.forEach((portal, index) => {
    const portalPath = `${graphPath}.portals[${index}]`;
    const room = rooms.get(portal.roomId);
    if (!room) issue(issues, "broken_reference", `${portalPath}.roomId`, "portal room does not exist");
    else if (!room.portalIds.includes(portal.id)) issue(issues, "broken_reference", portalPath, "portal is not listed by its room");
    validatePointBounds(portal.position, `${portalPath}.position`, bounds, issues);
    validatePolygon(portal.footprint, [], `${portalPath}.footprintRegion`, bounds, issues);
  });
  graph.corridors.forEach((corridor, index) => {
    const corridorPath = `${graphPath}.corridors[${index}]`;
    const from = rooms.get(corridor.fromRoomId);
    const to = rooms.get(corridor.toRoomId);
    if (!from) issue(issues, "broken_reference", `${corridorPath}.fromRoomId`, "corridor start room does not exist");
    if (!to) issue(issues, "broken_reference", `${corridorPath}.toRoomId`, "corridor end room does not exist");
    if (corridor.fromRoomId === corridor.toRoomId) issue(issues, "broken_reference", corridorPath, "corridor must connect two different rooms");
    const spline = splines.get(corridor.splineId);
    if (!spline || spline.kind !== "cave" || spline.stratumId !== graph.stratumId) {
      issue(issues, "broken_reference", `${corridorPath}.splineId`, "corridor must reference a cave spline in the same stratum");
    } else if (from && to) {
      const start = spline.controlPoints[0];
      const end = spline.controlPoints[spline.controlPoints.length - 1];
      if (!pointInPolygon(start, from.floorPolygon) || !pointInPolygon(end, to.floorPolygon)) {
        issue(issues, "invalid_spline", `${corridorPath}.splineId`, "cave spline endpoints must land inside the referenced rooms");
      }
    }
  });
};

const validateSemantics = (source: WorldSourceV3, issues: MutableIssue[]) => {
  const { bounds } = source;
  const spanX = bounds.maxXExclusive - bounds.minX;
  const spanZ = bounds.maxZExclusive - bounds.minZ;
  if (spanX <= 0 || spanZ <= 0
    || !Number.isInteger(spanX / source.chunkSize) || !Number.isInteger(spanZ / source.chunkSize)
    || !Number.isInteger(spanX / source.sampleSpacing) || !Number.isInteger(spanZ / source.sampleSpacing)) {
    issue(issues, "invalid_bounds", "$.bounds", "bounds must be increasing and aligned to chunk size and sample spacing");
  }

  const ids = new Map<string, string>();
  const rootCollections = [
    ["macroForms", source.macroForms], ["biomeRegions", source.biomeRegions], ["splines", source.splines],
    ["waterBodies", source.waterBodies], ["caves", source.caves], ["gameplayZones", source.gameplayZones],
    ["placements", source.placements], ["resourceAnchors", source.resourceAnchors], ["reviewCameras", source.reviewCameras],
  ] as const;
  rootCollections.forEach(([name, values]) => values.forEach((entry, index) => addStableId(ids, entry.id, `$.${name}[${index}].id`, issues)));
  source.caves.forEach((graph, graphIndex) => {
    graph.rooms.forEach((entry, index) => addStableId(ids, entry.id, `$.caves[${graphIndex}].rooms[${index}].id`, issues));
    graph.corridors.forEach((entry, index) => addStableId(ids, entry.id, `$.caves[${graphIndex}].corridors[${index}].id`, issues));
    graph.portals.forEach((entry, index) => addStableId(ids, entry.id, `$.caves[${graphIndex}].portals[${index}].id`, issues));
  });
  if (source.legacySculptLayer) addStableId(ids, source.legacySculptLayer.id, "$.legacySculptLayer.id", issues);

  const biomeIds = new Set(source.biomeRegions.map(({ biomeId }) => biomeId));
  const splineById = new Map(source.splines.map((spline) => [spline.id, spline]));
  const placementIds = new Set(source.placements.map(({ id }) => id));
  const strata = new Set(["surface", ...source.caves.map(({ stratumId }) => stratumId)]);

  source.biomeRegions.forEach((region, index) => validatePolygon(region.polygon, region.holes, `$.biomeRegions[${index}]`, bounds, issues));
  source.macroForms.forEach((form, index) => {
    const path = `$.macroForms[${index}]`;
    validatePointBounds(form.center, `${path}.center`, bounds, issues);
    if (form.center.x - form.size.x * 0.5 < bounds.minX || form.center.x + form.size.x * 0.5 >= bounds.maxXExclusive
      || form.center.z - form.size.z * 0.5 < bounds.minZ || form.center.z + form.size.z * 0.5 >= bounds.maxZExclusive) {
      issue(issues, "out_of_bounds", `${path}.size`, "macro form extent crosses world bounds");
    }
    if (!biomeIds.has(form.biomeId)) issue(issues, "broken_reference", `${path}.biomeId`, "macro form references an unknown biome");
    if (form.kind === "canyon" && !form.splineId) issue(issues, "broken_reference", `${path}.splineId`, "canyon macro form requires a spline");
    if (form.splineId && !splineById.has(form.splineId)) issue(issues, "broken_reference", `${path}.splineId`, "macro form spline does not exist");
  });
  source.splines.forEach((spline, index) => {
    const path = `$.splines[${index}]`;
    validateSpline(spline, path, bounds, issues);
    if (!strata.has(spline.stratumId)) issue(issues, "broken_reference", `${path}.stratumId`, "spline references an unknown stratum");
  });
  source.waterBodies.forEach((water, index) => {
    const path = `$.waterBodies[${index}]`;
    if (water.kind === "lake" || water.kind === "marsh") {
      validatePolygon(water.polygon, water.holes, path, bounds, issues);
      if (water.outletSplineId) {
        const spline = splineById.get(water.outletSplineId);
        if (!spline || spline.kind !== "river") issue(issues, "broken_reference", `${path}.outletSplineId`, "outlet must reference a river spline");
      }
    } else if (water.kind === "river") {
      const spline = splineById.get(water.splineId);
      if (!spline || spline.kind !== "river") issue(issues, "broken_reference", `${path}.splineId`, "river must reference a river spline");
      else if (water.widthProfile.length !== spline.controlPoints.length || water.bedProfile.length !== spline.controlPoints.length) {
        issue(issues, "invalid_spline", path, "river profiles must have one sample per authored control point");
      }
    }
  });
  source.caves.forEach((graph, index) => validateCaveReferences(graph, `$.caves[${index}]`, splineById, bounds, issues));
  source.gameplayZones.forEach((zone, index) => {
    const path = `$.gameplayZones[${index}]`;
    validatePolygon(zone.polygon, zone.holes, path, bounds, issues);
    if (!strata.has(zone.stratumId)) issue(issues, "broken_reference", `${path}.stratumId`, "gameplay zone references an unknown stratum");
    if (zone.elevationRange && zone.elevationRange.max <= zone.elevationRange.min) {
      issue(issues, "invalid_value", `${path}.elevationRange`, "elevation range max must be greater than min");
    }
  });
  source.placements.forEach((placement, index) => {
    const path = `$.placements[${index}]`;
    validatePointBounds(placement.transform.position, `${path}.transform.position`, bounds, issues);
    if (!strata.has(placement.stratumId)) issue(issues, "broken_reference", `${path}.stratumId`, "placement references an unknown stratum");
    if (!biomeIds.has(placement.biomeId)) issue(issues, "broken_reference", `${path}.biomeId`, "placement references an unknown biome");
    const rotation = placement.transform.rotation;
    const norm = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
    if (Math.abs(norm - 1) > 1e-4) issue(issues, "invalid_value", `${path}.transform.rotation`, "quaternion must be normalized");
  });
  source.resourceAnchors.forEach((anchor, index) => {
    const path = `$.resourceAnchors[${index}]`;
    validatePointBounds(anchor.position, `${path}.position`, bounds, issues);
    if (!strata.has(anchor.stratumId)) issue(issues, "broken_reference", `${path}.stratumId`, "resource anchor references an unknown stratum");
    if (anchor.protectionRadius < anchor.padRadius) issue(issues, "invalid_value", `${path}.protectionRadius`, "protection radius must cover the resource pad");
  });
  source.reviewCameras.forEach((camera, index) => {
    const path = `$.reviewCameras[${index}]`;
    validatePointBounds(camera.position, `${path}.position`, bounds, issues);
    validatePointBounds(camera.target, `${path}.target`, bounds, issues);
    camera.expectedLandmarkIds.forEach((landmarkId, expectedIndex) => {
      if (!placementIds.has(landmarkId)) issue(issues, "broken_reference", `${path}.expectedLandmarkIds[${expectedIndex}]`, "expected landmark placement does not exist");
    });
  });
  if (source.legacySculptLayer) {
    source.legacySculptLayer.strokes.forEach((stroke, index) => {
      const path = `$.legacySculptLayer.strokes[${index}]`;
      validatePointBounds(stroke, path, bounds, issues);
      if (stroke.brush === "biome" && (!stroke.biomeId || !biomeIds.has(stroke.biomeId))) {
        issue(issues, "broken_reference", `${path}.biomeId`, "biome stroke must reference an existing biome");
      }
      if (stroke.brush === "surface" && !stroke.surface) issue(issues, "invalid_value", `${path}.surface`, "surface stroke requires a surface value");
    });
    Object.keys(source.legacySculptLayer.landmarkOffsets).forEach((landmarkId) => {
      if (!placementIds.has(landmarkId)) issue(issues, "broken_reference", `$.legacySculptLayer.landmarkOffsets.${landmarkId}`, "landmark offset references an unknown placement");
    });
  }
};

export const validateWorldSourceV3 = (value: unknown): readonly WorldSourceValidationIssue[] => {
  const issues: MutableIssue[] = [];
  if (!validateRootShape(value, issues) || issues.length > 0) return issues;
  validateSemantics(value as unknown as WorldSourceV3, issues);
  return issues;
};

export const safeParseWorldSourceV3 = (value: unknown): WorldSourceParseResult => {
  const issues = validateWorldSourceV3(value);
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: structuredClone(value) as WorldSourceV3 };
};

export class WorldSourceValidationError extends Error {
  readonly issues: readonly WorldSourceValidationIssue[];

  constructor(issues: readonly WorldSourceValidationIssue[]) {
    super(`Invalid WorldSourceV3: ${issues.map(({ path, message }) => `${path}: ${message}`).join("; ")}`);
    this.name = "WorldSourceValidationError";
    this.issues = issues;
  }
}

export const parseWorldSourceV3 = (value: unknown): WorldSourceV3 => {
  const result = safeParseWorldSourceV3(value);
  if (!result.ok) throw new WorldSourceValidationError(result.issues);
  return result.value;
};
