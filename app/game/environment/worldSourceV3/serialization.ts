import type { WorldSourceParseResult, WorldSourceV3, WorldSourceValidationIssue } from "./types.ts";
import { parseWorldSourceV3, safeParseWorldSourceV3, WorldSourceValidationError } from "./validation.ts";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

const canonicalize = (value: unknown): JsonValue => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])])) as Readonly<{ [key: string]: JsonValue }>;
};

/** Stable JSON used by source control exports and content-addressed bake manifests. */
export const stringifyWorldSourceV3 = (source: WorldSourceV3, space: 0 | 2 = 2): string => {
  const parsed = parseWorldSourceV3(source);
  return JSON.stringify(canonicalize(parsed), null, space);
};

export const safeParseWorldSourceV3Json = (json: string): WorldSourceParseResult => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch (error) {
    const details = error instanceof Error ? error.message : "invalid JSON";
    const issue: WorldSourceValidationIssue = { code: "invalid_json", path: "$", message: details };
    return { ok: false, issues: [issue] };
  }
  return safeParseWorldSourceV3(value);
};

export const parseWorldSourceV3Json = (json: string): WorldSourceV3 => {
  const result = safeParseWorldSourceV3Json(json);
  if (!result.ok) throw new WorldSourceValidationError(result.issues);
  return result.value;
};

/**
 * SHA-256 over canonical source JSON. generatorVersion and seed are part of the
 * source contract, so either changing necessarily changes this identity.
 */
export const computeWorldSourceContentHash = async (source: WorldSourceV3): Promise<string> => {
  const bytes = new TextEncoder().encode(stringifyWorldSourceV3(source, 0));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
};
