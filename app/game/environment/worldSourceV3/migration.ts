import { parseWorldStudioDocument } from "../authoring.ts";
import type { EnvironmentDefinition } from "../types.ts";
import type { WorldSourceV3, WorldSourceValidationIssue } from "./types.ts";
import { safeParseWorldSourceV3 } from "./validation.ts";

export type WorldSourceV2MigrationResult =
  | Readonly<{ ok: true; value: WorldSourceV3 }>
  | Readonly<{ ok: false; issues: readonly WorldSourceValidationIssue[] }>;

const migrationIssue = (path: string, message: string): WorldSourceV2MigrationResult => ({
  ok: false,
  issues: [{ code: "invalid_value", path, message }],
});

/**
 * Preserves a validated World Studio v2 draft as the final local-correction
 * layer of an already-authored v3 topology. Neither input object is mutated.
 */
export const migrateWorldStudioV2ToV3 = (
  value: unknown,
  definition: EnvironmentDefinition,
  baseSource: WorldSourceV3,
): WorldSourceV2MigrationResult => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return migrationIssue("$", "expected a World Studio v2 object");
  const raw = value as Record<string, unknown>;
  if (raw.format !== "factoryx-world-studio" || raw.version !== 2) {
    return migrationIssue("$.version", "migration accepts only factoryx-world-studio version 2 documents");
  }

  const base = safeParseWorldSourceV3(baseSource);
  if (!base.ok) return { ok: false, issues: base.issues };
  if (base.value.legacySculptLayer) return migrationIssue("$.legacySculptLayer", "base source already contains migrated v2 authoring data");
  if (base.value.environmentId !== definition.id || base.value.environmentVersion !== definition.version || base.value.seed !== definition.seed) {
    return migrationIssue("$", "base source identity does not match the environment definition");
  }

  const document = parseWorldStudioDocument(value, definition);
  if (!document) return migrationIssue("$", "World Studio v2 validation failed; the original document was not changed");

  const candidate: WorldSourceV3 = {
    ...base.value,
    legacySculptLayer: {
      id: "legacy-sculpt-v2",
      sourceFormat: "factoryx-world-studio",
      sourceVersion: 2,
      priority: 1_000_000,
      operation: "legacy-sculpt",
      strokes: document.strokes.map((stroke) => ({ ...stroke })),
      environmentSettings: {
        timeOfDay: document.timeOfDay,
        sunAzimuth: document.sunAzimuth,
        fogDensity: document.fogDensity,
        weather: document.weather,
        weatherStrength: document.weatherStrength,
        scatterDensity: document.scatterDensity,
        landmarksVisible: document.landmarksVisible,
        resourceAnchorsVisible: document.resourceAnchorsVisible,
        quality: document.quality,
      },
      landmarkOffsets: Object.fromEntries(
        Object.entries(document.landmarkOffsets).map(([id, offset]) => [id, { ...offset }]),
      ),
    },
  };

  const migrated = safeParseWorldSourceV3(candidate);
  return migrated.ok ? migrated : { ok: false, issues: migrated.issues };
};
