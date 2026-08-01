import type { DefinitionRegistry } from "./types.ts";
import { assertValidDefinitions, type DefinitionSource } from "./validate.ts";

export function createDefinitionRegistry(source: DefinitionSource): DefinitionRegistry {
  assertValidDefinitions(source);
  return {
    items: new Map(source.items.map((definition) => [definition.id, definition])),
    recipes: new Map(source.recipes.map((definition) => [definition.id, definition])),
    buildings: new Map(source.buildings.map((definition) => [definition.id, definition])),
    projectStages: new Map(source.projectStages.map((definition) => [definition.id, definition])),
  };
}
