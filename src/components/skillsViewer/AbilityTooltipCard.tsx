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
  return `${value}${suffix}`;
};

const AbilityTooltipCard = ({
  ability,
  icons,
  fallbackIconData,
}: {
  ability: AbilityTooltipData;
  icons: Record<string, string>;
  fallbackIconData?: string;
}) => {
  const abilityIcon = getIconData(ability.iconPath, icons, fallbackIconData);
  const typeIcon = getIconData(ability.typeIconPath, icons, undefined);
  const loreIcon = getIconData(ability.loreIconPath, icons, undefined);

  return (
    <div className="border border-red-900/70 bg-black/55 px-3 py-2 text-gray-100">
      <div className="flex items-center gap-2">
        {abilityIcon && <img className="h-6 w-6 object-contain" src={`data:image/png;base64,${abilityIcon}`} alt="" />}
        <div className="font-semibold text-[15px]">{ability.name}</div>
      </div>
      <div className="mt-1 space-y-0.5 text-[12px] text-gray-300">
        <div className="flex items-center gap-1">
          {loreIcon && <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${loreIcon}`} alt="" />}
          <span>{ability.sourceTypeName}</span>
          {ability.loreGroupName && <span>{ability.loreGroupName}</span>}
        </div>
        <div className="flex items-center gap-1">
          {typeIcon && <img className="h-4 w-4 object-contain" src={`data:image/png;base64,${typeIcon}`} alt="" />}
          <span>{ability.abilityTypeName}</span>
        </div>
      </div>

      {ability.projectile && (
        <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
          <div>
            <span className="text-gray-300">Projectile Damage:</span>{" "}
            <span>{formatNumber(ability.projectile.totalDamage)}</span>
            {ability.projectile.apPct != undefined && (
              <span className="text-gray-400"> ({ability.projectile.apPct}% AP)</span>
            )}
          </div>
          {ability.projectile.explosion && (
            <div>
              <span className="text-gray-300">Explosion Damage:</span>{" "}
              <span>{formatNumber(ability.projectile.explosion.totalDamage)}</span>
              {ability.projectile.explosion.apPct != undefined && (
                <span className="text-gray-400"> ({ability.projectile.explosion.apPct}% AP)</span>
              )}
            </div>
          )}
          {ability.projectile.numProjectiles != undefined && (
            <div>
              <span className="text-gray-300">Projectiles:</span> {ability.projectile.numProjectiles}
            </div>
          )}
        </div>
      )}

      {(ability.projectile?.spawnedVortex || ability.vortex) && (
        <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
          {(() => {
            const vortex = ability.projectile?.spawnedVortex || ability.vortex;
            if (!vortex) return null;
            return (
              <>
                {vortex.dps != undefined && (
                  <div>
                    <span className="text-gray-300">Damage Per Second:</span> {vortex.dps}
                    {vortex.apPct != undefined && (
                      <span className="text-gray-400"> ({vortex.apPct}% AP)</span>
                    )}
                  </div>
                )}
                {vortex.duration != undefined && (
                  <div>
                    <span className="text-gray-300">Duration:</span> {formatNumber(vortex.duration, "s")}
                  </div>
                )}
                {vortex.radius != undefined && (
                  <div>
                    <span className="text-gray-300">Radius:</span> {formatNumber(vortex.radius, "m")}
                  </div>
                )}
                {vortex.movementSpeed != undefined && (
                  <div>
                    <span className="text-gray-300">Movement Speed:</span>{" "}
                    {formatNumber(vortex.movementSpeed, "m/s")}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {ability.directDamage && (
        <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
          {(ability.directDamage.dpsMin != undefined || ability.directDamage.dpsMax != undefined) && (
            <div>
              <span className="text-gray-300">Damage Per Second:</span> {ability.directDamage.dpsMin ?? 0}-
              {ability.directDamage.dpsMax ?? 0}
            </div>
          )}
          {ability.directDamage.duration != undefined && (
            <div>
              <span className="text-gray-300">Duration:</span> {formatNumber(ability.directDamage.duration, "s")}
            </div>
          )}
        </div>
      )}

      {ability.bonuses.length > 0 && (
        <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
          {ability.bonuses.map((bonus) => (
            <div key={bonus.key} className={bonus.isPositive ? "text-lime-300" : "text-red-300"}>
              <span className="text-yellow-200">➤</span> {bonus.label}: {bonus.valueText}
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
        {ability.stats.range != undefined && (
          <div>
            <span className="text-gray-300">Range:</span> {formatNumber(ability.stats.range, "m")}
          </div>
        )}
        {ability.stats.effectRange != undefined && (
          <div>
            <span className="text-gray-300">Effect range:</span> {formatNumber(ability.stats.effectRange, "m")}
          </div>
        )}
        {ability.stats.cooldown != undefined && (
          <div>
            <span className="text-gray-300">Cooldown:</span> {formatNumber(ability.stats.cooldown, "s")}
          </div>
        )}
        {ability.stats.duration != undefined && (
          <div>
            <span className="text-gray-300">Duration:</span> {formatNumber(ability.stats.duration, "s")}
          </div>
        )}
        {ability.stats.womCost != undefined && (
          <div>
            <span className="text-gray-300">Winds of Magic Cost:</span> {ability.stats.womCost}
          </div>
        )}
        {ability.stats.miscastChance != undefined && (
          <div>
            <span className="text-gray-300">Miscast Chance:</span> {formatNumber(ability.stats.miscastChance, "%")}
          </div>
        )}
        {ability.affectedUnitsText && (
          <div>
            <span className="text-gray-300">Affected units:</span> {ability.affectedUnitsText}
          </div>
        )}
      </div>

      {ability.additionalUiEffects.length > 0 && (
        <div className="mt-2 border-t border-red-900/60 pt-1 text-[12px]">
          {ability.additionalUiEffects.map((additionalEffect) => (
            <div key={additionalEffect.key} className="text-lime-300">
              ▲ {additionalEffect.text}
            </div>
          ))}
        </div>
      )}

      {ability.description && <div className="mt-2 text-[12px] italic text-gray-200">{ability.description}</div>}
    </div>
  );
};

export default AbilityTooltipCard;
