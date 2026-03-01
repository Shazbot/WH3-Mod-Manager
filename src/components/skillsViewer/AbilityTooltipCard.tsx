import React from "react";

const getIconData = (
  iconPath: string | undefined,
  icons: Record<string, string>,
  fallbackIconData: string | undefined,
) => {
  if (iconPath && icons[iconPath]) return icons[iconPath];
  return fallbackIconData || "";
};

const formatNumber = (value: number | undefined, suffix = "") => {
  if (value == undefined) return "";
  if (!Number.isFinite(value)) return "∞";
  return `${value}${suffix}`;
};

const formatDelta = (value: number, suffix = "") => {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}${suffix}`;
};

const getAdditionalEffectStatePresentation = (effectState: string | undefined) => {
  const normalized = (effectState || "").toLowerCase();
  if (normalized === "negative") {
    return { arrow: "▼", className: "text-red-300" };
  }
  if (normalized === "magic") {
    return { arrow: "⇈", className: "text-cyan-300" };
  }
  return { arrow: "▲", className: "text-lime-300" };
};

const getDiffClassName = (delta: number) => {
  if (delta > 0) return "text-lime-300";
  if (delta < 0) return "text-red-300";
  return "text-gray-400";
};

const nearlyEqual = (left: number | undefined, right: number | undefined) => {
  if (left == undefined || right == undefined) return false;
  return Math.abs(left - right) < 0.0001;
};

const renderValueWithDiff = (
  value: number | undefined,
  compareValue: number | undefined,
  suffix = "",
): React.ReactNode => {
  if (value == undefined) return null;
  const showDiff =
    compareValue != undefined &&
    Number.isFinite(value) &&
    Number.isFinite(compareValue) &&
    Math.abs(value - compareValue) > 0.0001;

  return (
    <>
      {formatNumber(value, suffix)}
      {showDiff && (
        <span className={`ml-1 text-[12px] ${getDiffClassName(value - compareValue)}`}>
          ({formatDelta(value - compareValue, suffix)})
        </span>
      )}
    </>
  );
};

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
      <span className="text-gray-300">{label}:</span>
      <span className="text-right">{children}</span>
    </div>
  );
};

const AbilityTooltipCard = ({
  ability,
  compareAbility,
  icons,
  fallbackIconData,
}: {
  ability: AbilityTooltipData;
  compareAbility?: AbilityTooltipData;
  icons: Record<string, string>;
  fallbackIconData?: string;
}) => {
  const abilityIcon = getIconData(ability.iconPath, icons, fallbackIconData);
  const typeIcon = getIconData(ability.typeIconPath, icons, undefined);
  const loreIcon = getIconData(ability.loreIconPath, icons, undefined);
  const displayedVortex = ability.projectile?.spawnedVortex || ability.vortex;
  const displayedCompareVortex = compareAbility?.projectile?.spawnedVortex || compareAbility?.vortex;
  const isDirectDurationDuplicated = nearlyEqual(ability.directDamage?.duration, ability.stats.duration);
  const isVortexDurationDuplicated = nearlyEqual(displayedVortex?.duration, ability.stats.duration);
  const isStatsDurationDuplicated = isDirectDurationDuplicated || isVortexDurationDuplicated;

  const bonusCompareMap = new Map<string, AbilityTooltipBonusData>();
  for (const baseBonus of compareAbility?.bonuses || []) {
    const compareKey = baseBonus.compareKey || baseBonus.label;
    bonusCompareMap.set(compareKey, baseBonus);
  }

  return (
    <div className="border border-red-900/70 bg-black/60 px-4 py-3 text-[13px] leading-5 text-gray-100">
      <div className="flex items-center gap-2.5">
        {abilityIcon && <img className="h-7 w-7 object-contain" src={`data:image/png;base64,${abilityIcon}`} alt="" />}
        <div className="font-semibold text-[18px] leading-tight">{ability.name}</div>
      </div>

      <div className="mt-1.5 space-y-0.5 text-[13px] text-gray-300">
        <div className="flex items-center gap-1.5">
          {loreIcon && <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${loreIcon}`} alt="" />}
          <span>{ability.sourceTypeName}</span>
          {ability.loreGroupName && <span>{ability.loreGroupName}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {typeIcon && <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${typeIcon}`} alt="" />}
          <span>{ability.abilityTypeName}</span>
        </div>
      </div>

      {ability.projectile && (
        <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
          <Row label="Ranged Damage">
            {renderValueWithDiff(ability.projectile.totalDamage, compareAbility?.projectile?.totalDamage)}
            {ability.projectile.apPct != undefined && (
              <span className="text-gray-400">
                {" "}
                ({ability.projectile.apPct}% AP
                {compareAbility?.projectile?.apPct != undefined && Math.abs(ability.projectile.apPct - compareAbility.projectile.apPct) > 0.0001 && (
                  <span className={`ml-1 ${getDiffClassName(ability.projectile.apPct - compareAbility.projectile.apPct)}`}>
                    {formatDelta(ability.projectile.apPct - compareAbility.projectile.apPct, "%")}
                  </span>
                )}
                )
              </span>
            )}
          </Row>

          {ability.projectile.explosion && (
            <Row label="Explosive Damage">
              {renderValueWithDiff(
                ability.projectile.explosion.totalDamage,
                compareAbility?.projectile?.explosion?.totalDamage,
              )}
              {ability.projectile.explosion.apPct != undefined && (
                <span className="text-gray-400">
                  {" "}
                  ({ability.projectile.explosion.apPct}% AP
                  {compareAbility?.projectile?.explosion?.apPct != undefined &&
                    Math.abs(ability.projectile.explosion.apPct - compareAbility.projectile.explosion.apPct) > 0.0001 && (
                      <span
                        className={`ml-1 ${getDiffClassName(
                          ability.projectile.explosion.apPct - compareAbility.projectile.explosion.apPct,
                        )}`}
                      >
                        {formatDelta(ability.projectile.explosion.apPct - compareAbility.projectile.explosion.apPct, "%")}
                      </span>
                    )}
                  )
                </span>
              )}
            </Row>
          )}

          {ability.projectile.numProjectiles != undefined && (
            <Row label="Number of projectiles">
              {renderValueWithDiff(ability.projectile.numProjectiles, compareAbility?.projectile?.numProjectiles)}
            </Row>
          )}
        </div>
      )}

      {displayedVortex && (
        <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
          {displayedVortex.dps != undefined && (
            <Row label="Damage Per Second">
              {renderValueWithDiff(displayedVortex.dps, displayedCompareVortex?.dps)}
              {displayedVortex.apPct != undefined && (
                <span className="text-gray-400">
                  {" "}
                  ({displayedVortex.apPct}% AP
                  {displayedCompareVortex?.apPct != undefined &&
                    Math.abs(displayedVortex.apPct - displayedCompareVortex.apPct) > 0.0001 && (
                      <span className={`ml-1 ${getDiffClassName(displayedVortex.apPct - displayedCompareVortex.apPct)}`}>
                        {formatDelta(displayedVortex.apPct - displayedCompareVortex.apPct, "%")}
                      </span>
                    )}
                  )
                </span>
              )}
            </Row>
          )}
          {displayedVortex.duration != undefined && (
            <Row label="Duration">
              {renderValueWithDiff(displayedVortex.duration, displayedCompareVortex?.duration, "s")}
            </Row>
          )}
          {displayedVortex.radius != undefined && (
            <Row label="Radius">{renderValueWithDiff(displayedVortex.radius, displayedCompareVortex?.radius, "m")}</Row>
          )}
          {displayedVortex.movementSpeed != undefined && (
            <Row label="Movement Speed">
              {renderValueWithDiff(displayedVortex.movementSpeed, displayedCompareVortex?.movementSpeed, "m/s")}
            </Row>
          )}
        </div>
      )}

      {ability.directDamage && (
        <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
          {(ability.directDamage.dpsMin != undefined || ability.directDamage.dpsMax != undefined) && (
            <Row label="Damage Per Second">
              <>
                {renderValueWithDiff(ability.directDamage.dpsMin, compareAbility?.directDamage?.dpsMin)}-
                {renderValueWithDiff(ability.directDamage.dpsMax, compareAbility?.directDamage?.dpsMax)}
              </>
            </Row>
          )}
          {ability.directDamage.duration != undefined && (
            <Row label="Duration">
              {renderValueWithDiff(ability.directDamage.duration, compareAbility?.directDamage?.duration, "s")}
            </Row>
          )}
        </div>
      )}

      {ability.bonuses.length > 0 && (
        <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
          {ability.bonuses.map((bonus) => {
            const bonusIcon = getIconData(bonus.iconPath, icons, undefined);
            const compareKey = bonus.compareKey || bonus.label;
            const compareBonus = bonusCompareMap.get(compareKey);
            const hasDiff =
              compareBonus?.numericValue != undefined &&
              bonus.numericValue != undefined &&
              Math.abs(bonus.numericValue - compareBonus.numericValue) > 0.0001;
            const diffValue =
              compareBonus?.numericValue != undefined && bonus.numericValue != undefined
                ? bonus.numericValue - compareBonus.numericValue
                : undefined;

            return (
              <div key={bonus.key} className={bonus.isPositive ? "text-lime-300" : "text-red-300"}>
                {bonusIcon ? (
                  <img className="mr-1 inline-block h-4 w-4 object-contain align-[-2px]" src={`data:image/png;base64,${bonusIcon}`} alt="" />
                ) : (
                  <span className="text-yellow-200">➤</span>
                )}
                {" "}
                {bonus.label}: {bonus.valueText}
                {hasDiff && diffValue != undefined && (
                  <span className={`ml-1 text-[12px] ${getDiffClassName(diffValue)}`}>
                    ({formatDelta(diffValue, bonus.valueSuffix || "")})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
        {ability.stats.range != undefined && (
          <Row label="Range">{renderValueWithDiff(ability.stats.range, compareAbility?.stats.range, "m")}</Row>
        )}
        {ability.stats.effectRange != undefined && (
          <Row label="Effect range">
            {renderValueWithDiff(ability.stats.effectRange, compareAbility?.stats.effectRange, "m")}
          </Row>
        )}
        {ability.stats.cooldown != undefined && (
          <Row label="Cooldown">
            {renderValueWithDiff(ability.stats.cooldown, compareAbility?.stats.cooldown, "s")}
          </Row>
        )}
        {ability.stats.duration != undefined && !isStatsDurationDuplicated && (
          <Row label="Duration">
            {renderValueWithDiff(ability.stats.duration, compareAbility?.stats.duration, "s")}
          </Row>
        )}
        {ability.stats.womCost != undefined && (
          <Row label="Winds of Magic Cost">
            {renderValueWithDiff(ability.stats.womCost, compareAbility?.stats.womCost)}
          </Row>
        )}
        {ability.stats.miscastChance != undefined && (
          <Row label="Miscast Chance">
            {renderValueWithDiff(ability.stats.miscastChance, compareAbility?.stats.miscastChance, "%")}
          </Row>
        )}
        {ability.affectedUnitsText && <Row label="Affected units">{ability.affectedUnitsText}</Row>}
        {ability.enabledIfText && <Row label="Enabled if">{ability.enabledIfText}</Row>}
      </div>

      {ability.additionalUiEffects.length > 0 && (
        <div className="mt-2.5 space-y-0.5 border-t border-red-900/60 pt-1.5">
          {ability.additionalUiEffects.map((additionalEffect) => {
            const presentation = getAdditionalEffectStatePresentation(additionalEffect.effectState);
            return (
              <div key={additionalEffect.key} className={presentation.className}>
                {presentation.arrow} {additionalEffect.text}
              </div>
            );
          })}
        </div>
      )}

      {ability.description && <div className="mt-2.5 text-[13px] italic leading-5 text-gray-200">{ability.description}</div>}
    </div>
  );
};

export default AbilityTooltipCard;
