import type { UnitViewerAbility } from "./types";

type Guard = (value: unknown) => boolean;
const text: Guard = (value) => typeof value === "string";
const number: Guard = (value) => typeof value === "number" && Number.isFinite(value);
const boolean: Guard = (value) => typeof value === "boolean";
const optional =
  (guard: Guard): Guard =>
  (value) =>
    value === undefined || guard(value);
const array =
  (guard: Guard): Guard =>
  (value) => {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index++) {
      if (!guard(value[index])) return false;
    }
    return true;
  };

// Reject unrecognized fields so new nested metadata cannot silently bypass the clone below.
const object =
  (fields: Record<string, Guard>): Guard =>
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const record = value as Record<string, unknown>;
    return (
      Object.keys(record).every((key) => Object.prototype.hasOwnProperty.call(fields, key)) &&
      Object.entries(fields).every(([key, guard]) => guard(record[key]))
    );
  };

const vortex = object({
  key: text,
  dps: optional(number),
  apDps: optional(number),
  apPct: optional(number),
  duration: optional(number),
  radius: optional(number),
  movementSpeed: optional(number),
  numVortexes: optional(number),
});

const ability = object({
  key: text,
  passive: boolean,
  isSpell: boolean,
  tooltip: object({
    key: text,
    name: text,
    description: text,
    sourceTypeName: text,
    loreGroupName: text,
    abilityTypeName: text,
    overpowerOption: optional(text),
    iconPath: optional(text),
    loreIconPath: optional(text),
    typeIconPath: optional(text),
    affectedUnitsText: optional(text),
    enabledIfText: optional(text),
    stats: object({
      range: optional(number),
      cooldown: optional(number),
      duration: optional(number),
      effectRange: optional(number),
      womCost: optional(number),
      miscastChance: optional(number),
      minRange: optional(number),
    }),
    bonuses: array(
      object({
        key: text,
        compareKey: optional(text),
        label: text,
        valueText: text,
        numericValue: optional(number),
        valueSuffix: optional(text),
        isPositive: boolean,
        iconPath: optional(text),
      }),
    ),
    additionalUiEffects: array(
      object({
        key: text,
        text,
        sortOrder: optional(number),
        effectState: optional(text),
      }),
    ),
    projectile: optional(
      object({
        key: text,
        totalDamage: optional(number),
        apDamage: optional(number),
        apPct: optional(number),
        numProjectiles: optional(number),
        explosion: optional(
          object({
            key: text,
            totalDamage: optional(number),
            apDamage: optional(number),
            apPct: optional(number),
            radius: optional(number),
            duration: optional(number),
          }),
        ),
        spawnedVortex: optional(vortex),
      }),
    ),
    vortex: optional(vortex),
    directDamage: optional(
      object({
        dpsMin: optional(number),
        dpsMax: optional(number),
        duration: optional(number),
      }),
    ),
  }),
});

export const isCachedUnitViewerAbility = (value: unknown): value is UnitViewerAbility => ability(value);

/** Copies every branch accepted by the v33 validator; keep both in sync when the format changes. */
export const cloneCachedUnitViewerAbility = (value: UnitViewerAbility): UnitViewerAbility => {
  const tooltip = Object.assign({}, value.tooltip, {
    stats: Object.assign({}, value.tooltip.stats),
    bonuses: value.tooltip.bonuses.map((bonus) => Object.assign({}, bonus)),
    additionalUiEffects: value.tooltip.additionalUiEffects.map((effect) => Object.assign({}, effect)),
  });
  if (value.tooltip.projectile) {
    const projectile = Object.assign({}, value.tooltip.projectile);
    if (projectile.explosion) projectile.explosion = Object.assign({}, projectile.explosion);
    if (projectile.spawnedVortex) projectile.spawnedVortex = Object.assign({}, projectile.spawnedVortex);
    tooltip.projectile = projectile;
  }
  if (tooltip.vortex) tooltip.vortex = Object.assign({}, tooltip.vortex);
  if (tooltip.directDamage) tooltip.directDamage = Object.assign({}, tooltip.directDamage);
  return Object.assign({}, value, { tooltip });
};
