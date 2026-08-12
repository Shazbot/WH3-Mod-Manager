import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AutoSizer, List, type ListRowProps } from "react-virtualized";
import {
  IoAdd,
  IoArrowBack,
  IoArrowForward,
  IoCheckmark,
  IoChevronDown,
  IoChevronForward,
  IoClose,
  IoGrid,
  IoList,
  IoSearch,
} from "react-icons/io5";
import { useAppSelector } from "../hooks";
import AbilityTooltipCard from "./skillsViewer/AbilityTooltipCard";
import { calculateUnitViewerStats } from "../unitViewer/calculator";
import type {
  UnitViewerAbility,
  UnitViewerCalculatedStats,
  UnitViewerCatalogGroup,
  UnitViewerCatalogUnit,
  UnitViewerConstants,
  UnitViewerContext,
  UnitViewerFatigue,
  UnitViewerUiGroup,
  UnitViewerUnitModel,
  UnitViewerUnitSize,
} from "../unitViewer/types";

type BrowserRow =
  | { kind: "group"; group: UnitViewerCatalogGroup }
  | { kind: "unit"; groupKey: string; unit: UnitViewerCatalogUnit };

type ComparisonSelection = "first" | "left" | `unit:${string}`;

const DEFAULT_CONTEXT: UnitViewerContext = {
  unitSize: "ultra",
  rank: 0,
  fatigue: "threshold_fresh",
};

const isMissingUnitViewerSessionError = (message: string) =>
  /unit viewer session (?:expired|missing)/i.test(message);

const FATIGUE_LABELS: Record<UnitViewerFatigue, string> = {
  threshold_fresh: "Fresh",
  threshold_active: "Active",
  threshold_winded: "Winded",
  threshold_tired: "Tired",
  threshold_very_tired: "Very Tired",
  threshold_exhausted: "Exhausted",
};

const UnitCasteBadge = ({ caste }: { caste: string }) => {
  const normalized = caste.toLowerCase();
  if (normalized === "lord") {
    return <span aria-hidden="true" title="Lord" className="mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-amber-500/80 bg-amber-950 text-[11px] font-bold text-amber-200">L</span>;
  }
  if (normalized === "hero") {
    return <span aria-hidden="true" title="Hero" className="mr-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-cyan-500/80 bg-cyan-950 text-[11px] font-bold text-cyan-200">H</span>;
  }
  return null;
};

const formatValue = (value: number | undefined, suffix = "") =>
  value == undefined ? "—" : `${Number.isInteger(value) ? value : Math.round(value * 100) / 100}${suffix}`;

const getDeltaClass = (delta: number, lowerIsBetter: boolean) => {
  if (Math.abs(delta) < 0.0001) return "text-gray-400";
  const isBetter = lowerIsBetter ? delta < 0 : delta > 0;
  return isBetter ? "text-lime-300" : "text-red-300";
};

const StatValue = ({
  value,
  baseline,
  suffix,
  lowerIsBetter = false,
}: {
  value: number | undefined;
  baseline?: number;
  suffix?: string;
  lowerIsBetter?: boolean;
}) => {
  const delta = value != undefined && baseline != undefined ? value - baseline : 0;
  return (
    <span className="whitespace-nowrap font-medium tabular-nums text-gray-100">
      {formatValue(value, suffix)}
      {baseline != undefined && value != undefined && Math.abs(delta) > 0.0001 && (
        <span className={`ml-1 text-[13px] font-semibold ${getDeltaClass(delta, lowerIsBetter)}`}>
          ({delta > 0 ? "+" : ""}{formatValue(delta, suffix)})
        </span>
      )}
    </span>
  );
};

const StatRow = ({
  label,
  value,
  baseline,
  suffix,
  lowerIsBetter,
  iconData,
}: {
  label: string;
  value: number | undefined;
  baseline?: number;
  suffix?: string;
  lowerIsBetter?: boolean;
  iconData?: string;
}) => (
  <div className="grid h-10 grid-cols-[minmax(8rem,1fr)_minmax(8.5rem,auto)] items-center gap-3 overflow-hidden border-b border-gray-700/60 px-3 text-[15px]">
    <span className="flex min-w-0 items-center gap-2 text-gray-300">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        {iconData && <img src={`data:image/png;base64,${iconData}`} className="h-5 w-5 object-contain" alt="" title={label} />}
      </span>
      <span className="truncate">{label}</span>
    </span>
    <span className="text-right"><StatValue value={value} baseline={baseline} suffix={suffix} lowerIsBetter={lowerIsBetter} /></span>
  </div>
);

const StatTextRow = ({ label, value, iconData }: { label: string; value: string; iconData?: string }) => (
  <div className="grid h-10 grid-cols-[minmax(8rem,1fr)_minmax(8.5rem,auto)] items-center gap-3 overflow-hidden border-b border-gray-700/60 px-3 text-[15px]">
    <span className="flex min-w-0 items-center gap-2 text-gray-300">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        {iconData && <img src={`data:image/png;base64,${iconData}`} className="h-5 w-5 object-contain" alt="" title={label} />}
      </span>
      <span className="truncate">{label}</span>
    </span>
    <span className="truncate text-right font-medium text-gray-100">{value || "—"}</span>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-2 overflow-hidden rounded border border-gray-600/90 bg-gray-950/75">
    <h3 className="bg-gray-800 px-3 py-2 text-[15px] font-semibold text-amber-100">{title}</h3>
    {children}
  </section>
);

const AbilityButton = ({
  ability,
  icons,
  compareAbility,
}: {
  ability: UnitViewerAbility;
  icons: Record<string, string>;
  compareAbility?: UnitViewerAbility;
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 430, maxHeight: 400 });
  const isOpen = isHovered || isFocused || isPinned;
  const icon = ability.tooltip.iconPath ? icons[ability.tooltip.iconPath] : undefined;

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(430, Math.max(240, viewportWidth - 16));
      const measuredHeight = tooltipRef.current?.scrollHeight || 400;
      const below = Math.max(0, viewportHeight - rect.bottom - 8);
      const above = Math.max(0, rect.top - 8);
      const placeBelow = below >= Math.min(measuredHeight, 240) || below >= above;
      const maxHeight = Math.max(120, placeBelow ? below : above);
      const height = Math.min(measuredHeight, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, viewportWidth - width - 8)),
        top: placeBelow ? rect.bottom + 6 : Math.max(8, rect.top - height - 6),
        width,
        maxHeight,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  return (
    <div>
      <button
        ref={buttonRef}
        type="button"
        className="flex w-full items-center gap-2 rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-left text-xs hover:border-amber-500 focus:border-amber-400 focus:outline-none"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onClick={() => setIsPinned((pinned) => !pinned)}
        aria-expanded={isOpen}
      >
        {icon ? (
          <img src={`data:image/png;base64,${icon}`} className="h-8 w-8 object-contain" alt="" />
        ) : (
          <span className="h-8 w-8 rounded bg-gray-700" />
        )}
        <span className="leading-tight">{ability.tooltip.name}</span>
      </button>
      {isOpen && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[10000] overflow-y-auto shadow-2xl"
          style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
          role="tooltip"
        >
          <AbilityTooltipCard
            ability={ability.tooltip}
            compareAbility={compareAbility?.tooltip}
            icons={icons}
          />
        </div>,
        document.body,
      )}
    </div>
  );
};

const UnitCard = ({
  unit,
  stats,
  compareUnit,
  compareStats,
  statIconPaths,
  icons,
  imageSrc,
  onRemove,
  onMoveLeft,
  onMoveRight,
}: {
  unit: UnitViewerUnitModel;
  stats: UnitViewerCalculatedStats;
  compareUnit?: UnitViewerUnitModel;
  compareStats?: UnitViewerCalculatedStats;
  statIconPaths: Record<string, string>;
  icons: Record<string, string>;
  imageSrc?: string;
  onRemove: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
}) => {
  const statIcon = (statKey: string) => icons[statIconPaths[statKey]];
  const compareAbilities = new Map((compareUnit?.abilities || []).map((ability) => [ability.key, ability]));
  const abilitiesBySection = {
    active: unit.abilities.filter((ability) => !ability.passive && !ability.isSpell),
    spells: unit.abilities.filter((ability) => ability.isSpell),
    passive: unit.abilities.filter((ability) => ability.passive && !ability.isSpell),
  };
  return (
    <article className="w-[370px] shrink-0 rounded border border-gray-600 bg-gray-900/90 text-gray-100 shadow-xl">
      <header className="sticky top-0 z-20 flex h-[86px] items-center gap-3 overflow-hidden border-b border-gray-700 bg-gray-900 px-3 py-2">
        {imageSrc ? (
          <img src={imageSrc} className="h-16 w-16 shrink-0 object-contain" alt="" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center bg-gray-800 text-2xl text-gray-600">?</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight text-amber-100">{unit.name}</div>
          <div className="mt-1 truncate text-[11px] text-gray-500" title={unit.key}>{unit.key}</div>
        </div>
        <div className="flex self-start">
          <button type="button" disabled={!onMoveLeft} onClick={onMoveLeft} className="p-1 text-gray-400 hover:text-white disabled:text-gray-700" aria-label={`Move ${unit.name} left`}><IoArrowBack size={17} /></button>
          <button type="button" disabled={!onMoveRight} onClick={onMoveRight} className="p-1 text-gray-400 hover:text-white disabled:text-gray-700" aria-label={`Move ${unit.name} right`}><IoArrowForward size={17} /></button>
          <button type="button" onClick={onRemove} className="p-1 text-gray-400 hover:text-white" aria-label={`Remove ${unit.name}`}><IoClose size={19} /></button>
        </div>
      </header>

      <div className="px-2 pb-3">
        <Section title="Costs">
          <StatRow label="SP Cost" value={stats.recruitmentCost} baseline={compareStats?.recruitmentCost} lowerIsBetter />
          <StatRow label="SP Upkeep" value={stats.upkeepCost} baseline={compareStats?.upkeepCost} lowerIsBetter />
          <StatRow label="MP Cost" value={stats.multiplayerCost} baseline={compareStats?.multiplayerCost} lowerIsBetter />
        </Section>
        <Section title="Defence">
          <StatRow label="Health" value={stats.health} baseline={compareStats?.health} iconData={statIcon("stat_health")} />
          <StatRow label="Entities" value={stats.entityCount} baseline={compareStats?.entityCount} />
          <StatRow label="Health / Entity" value={stats.healthPerEntity} baseline={compareStats?.healthPerEntity} iconData={statIcon("stat_health")} />
          <StatRow label="Barrier" value={stats.barrier} baseline={compareStats?.barrier} />
          <StatRow label="Armour" value={stats.armour} baseline={compareStats?.armour} iconData={statIcon("stat_armour")} />
          <StatRow label="Missile Block" value={stats.shieldBlock} baseline={compareStats?.shieldBlock} suffix="%" iconData={statIcon("stat_missile_block_chance")} />
          <StatRow label="Ward Save" value={unit.wardSave} baseline={compareUnit?.wardSave} suffix="%" iconData={statIcon("stat_resistance_all")} />
          <StatRow label="Physical Resistance" value={unit.physicalResistance} baseline={compareUnit?.physicalResistance} suffix="%" iconData={statIcon("stat_resistance_physical")} />
          <StatRow label="Missile Resistance" value={unit.missileResistance} baseline={compareUnit?.missileResistance} suffix="%" iconData={statIcon("stat_resistance_missile")} />
          <StatRow label="Magic Resistance" value={unit.magicResistance} baseline={compareUnit?.magicResistance} suffix="%" iconData={statIcon("stat_resistance_magic")} />
          <StatRow label="Fire Resistance" value={unit.fireResistance} baseline={compareUnit?.fireResistance} suffix="%" iconData={statIcon("stat_resistance_flame")} />
        </Section>
        <Section title="Battle Stats">
          <StatRow label="Leadership" value={stats.leadership} baseline={compareStats?.leadership} iconData={statIcon("stat_morale")} />
          <StatRow label="Speed" value={stats.speed} baseline={compareStats?.speed} iconData={statIcon("scalar_speed")} />
          <StatRow label="Charge Speed" value={stats.chargeSpeed} baseline={compareStats?.chargeSpeed} iconData={statIcon("scalar_charge_speed")} />
          <StatRow label="Melee Attack" value={stats.meleeAttack} baseline={compareStats?.meleeAttack} iconData={statIcon("stat_melee_attack")} />
          <StatRow label="Melee Defence" value={stats.meleeDefence} baseline={compareStats?.meleeDefence} iconData={statIcon("stat_melee_defence")} />
          <StatRow label="Weapon Strength" value={stats.weaponStrength} baseline={compareStats?.weaponStrength} iconData={statIcon("stat_weapon_damage")} />
          <StatRow label="Base Damage" value={stats.baseDamage} baseline={compareStats?.baseDamage} iconData={statIcon("stat_melee_damage_base")} />
          <StatRow label="AP Damage" value={stats.apDamage} baseline={compareStats?.apDamage} iconData={statIcon("stat_melee_damage_ap")} />
          <StatRow label="Bonus vs Large" value={stats.bonusVsLarge} baseline={compareStats?.bonusVsLarge} iconData={statIcon("stat_bonus_vs_large")} />
          <StatRow label="Bonus vs Infantry" value={stats.bonusVsInfantry} baseline={compareStats?.bonusVsInfantry} iconData={statIcon("stat_bonus_vs_infantry")} />
          <StatRow label="Charge Bonus" value={stats.chargeBonus} baseline={compareStats?.chargeBonus} iconData={statIcon("stat_charge_bonus")} />
          <StatRow label="Attack Interval" value={stats.attackInterval} baseline={compareStats?.attackInterval} suffix="s" lowerIsBetter />
          <StatRow label="Splash Max Attacks" value={unit.meleeWeapon.splashMaxAttacks} baseline={compareUnit?.meleeWeapon.splashMaxAttacks} />
          <StatTextRow label="Splash Target Size" value={unit.meleeWeapon.splashTargetSize || ""} />
          <StatRow label="Mass" value={stats.mass} baseline={compareStats?.mass} iconData={statIcon("stat_mass")} />
        </Section>
        {[{ label: "Missile Weapon", stats: stats.primaryMissile, base: compareStats?.primaryMissile }, { label: "Secondary Missile", stats: stats.secondaryMissile, base: compareStats?.secondaryMissile }].map((missile) => (
          <Section key={missile.label} title={missile.label}>
            <StatRow label="Ammunition" value={missile.stats?.ammo} baseline={missile.base?.ammo} iconData={statIcon("stat_ammo")} />
            <StatRow label="Range" value={missile.stats?.range} baseline={missile.base?.range} iconData={statIcon("scalar_missile_range")} />
            <StatRow label="Damage / 10s" value={missile.stats?.damagePerTenSeconds} baseline={missile.base?.damagePerTenSeconds} iconData={statIcon("stat_missile_damage_over_time")} />
            <StatRow label="Reload Time" value={missile.stats?.reloadTime} baseline={missile.base?.reloadTime} suffix="s" lowerIsBetter iconData={statIcon("stat_reloading")} />
            <StatRow label="Projectile Damage" value={missile.stats?.baseDamage} baseline={missile.base?.baseDamage} iconData={statIcon("scalar_missile_damage_base")} />
            <StatRow label="Projectile AP" value={missile.stats?.apDamage} baseline={missile.base?.apDamage} iconData={statIcon("scalar_missile_damage_ap")} />
            <StatRow label="Explosion Damage" value={missile.stats?.explosionBaseDamage} baseline={missile.base?.explosionBaseDamage} iconData={statIcon("scalar_missile_explosion_damage_base")} />
            <StatRow label="Explosion AP" value={missile.stats?.explosionApDamage} baseline={missile.base?.explosionApDamage} iconData={statIcon("scalar_missile_explosion_damage_ap")} />
            <StatRow label="Explosion Radius" value={missile.stats?.explosionRadius} baseline={missile.base?.explosionRadius} />
            <StatRow label="Shots / Volley" value={missile.stats?.shotsPerVolley} baseline={missile.base?.shotsPerVolley} />
            <StatRow label="Projectiles" value={missile.stats?.projectileNumber} baseline={missile.base?.projectileNumber} />
            <StatRow label="Burst Size" value={missile.stats?.burstSize} baseline={missile.base?.burstSize} />
            <StatRow label="Bonus vs Large" value={missile.stats?.bonusVsLarge} baseline={missile.base?.bonusVsLarge} iconData={statIcon("stat_bonus_vs_large")} />
            <StatRow label="Bonus vs Infantry" value={missile.stats?.bonusVsInfantry} baseline={missile.base?.bonusVsInfantry} iconData={statIcon("stat_bonus_vs_infantry")} />
          </Section>
        ))}
        <Section title="Additional">
          <div className="flex flex-wrap gap-1.5 p-2 text-xs">
            {unit.isHighThreat && <span className="rounded bg-red-950 px-2 py-1">High Threat</span>}
            {unit.canSiege && <span className="rounded bg-amber-950 px-2 py-1">Siege Attacker</span>}
            {unit.canSkirmish && <span className="rounded bg-green-950 px-2 py-1">Skirmisher</span>}
            {unit.groundStatEffectGroup && <span className="rounded bg-gray-800 px-2 py-1">Ground: {unit.groundStatEffectGroup}</span>}
            {stats.fatigueModifier !== 0 && <span className="rounded bg-gray-800 px-2 py-1">Vigour: {stats.fatigueModifier}</span>}
          </div>
          {unit.groundStatEffects.length > 0 && <div className="space-y-1 border-t border-gray-800 p-2 text-xs text-gray-300">{unit.groundStatEffects.map((effect, index) => <div key={`${effect.groundType}:${effect.stat}:${index}`}>{effect.groundType}: {effect.stat} {effect.multiplier >= 1 ? "+" : ""}{Math.round((effect.multiplier - 1) * 100)}%</div>)}</div>}
        </Section>
        {unit.attributes.length > 0 && <Section title="Unit Attributes">
          <div className="space-y-1.5 p-2">
            {unit.attributes.map((attribute) => <div key={attribute.key} title={attribute.description} className="flex min-h-9 items-center gap-2 rounded bg-gray-900 px-2 py-1 text-xs text-gray-200">
              {icons[attribute.iconPath] ? <img src={`data:image/png;base64,${icons[attribute.iconPath]}`} className="h-7 w-7 shrink-0 object-contain" alt="" /> : <span className="h-7 w-7 shrink-0 rounded bg-gray-800" />}
              <span>{attribute.name}</span>
            </div>)}
          </div>
        </Section>}
        {(["active", "spells", "passive"] as const).map((section) => abilitiesBySection[section].length > 0 && (
          <Section key={section} title={section === "active" ? "Abilities" : section === "spells" ? "Spells" : "Passive Abilities"}>
            <div className="space-y-1.5 p-2">
              {abilitiesBySection[section].map((ability) => <AbilityButton key={ability.key} ability={ability} icons={icons} compareAbility={compareAbilities.get(ability.key)} />)}
            </div>
          </Section>
        ))}
      </div>
    </article>
  );
};

const RosterUnitTile = memo(({
  unit,
  imageSrc,
  isSelected,
  onToggle,
  onRequestImage,
}: {
  unit: UnitViewerCatalogUnit;
  imageSrc?: string;
  isSelected: boolean;
  onToggle: (unitKey: string) => void;
  onRequestImage: (assetPath: string) => void;
}) => {
  const tileRef = useRef<HTMLDivElement>(null);
  const cardPath = unit.unitCardPath;

  useEffect(() => {
    if (!cardPath || imageSrc) return;
    const element = tileRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      onRequestImage(cardPath);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onRequestImage(cardPath);
    }, { rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cardPath, imageSrc, onRequestImage]);

  return (
    <div ref={tileRef}>
      <button
        type="button"
        title={unit.key}
        aria-pressed={isSelected}
        aria-label={isSelected ? `Remove ${unit.name} from comparison` : `Add ${unit.name} to comparison`}
        onClick={() => onToggle(unit.key)}
        className={`flex w-full flex-col gap-1 rounded border p-1.5 text-left transition-colors ${isSelected ? "border-amber-400 bg-amber-900/40" : "border-gray-700 bg-gray-900 hover:border-amber-500/70 hover:bg-gray-800"}`}
      >
        <span className="relative block w-full overflow-hidden rounded bg-[#030712]" style={{ aspectRatio: "164 / 212" }}>
          {imageSrc
            ? <img src={imageSrc} className="h-full w-full object-cover" alt="" />
            : <span className="flex h-full w-full items-center justify-center text-2xl text-gray-700">?</span>}
          <span className={`absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full border shadow ${isSelected ? "border-amber-300 bg-amber-500 text-gray-900" : "border-gray-600 bg-gray-900/90 text-gray-200"}`}>
            {isSelected ? <IoCheckmark size={15} /> : <IoAdd size={15} />}
          </span>
        </span>
        <span className="flex min-h-8 items-start text-[13px] leading-tight text-gray-200">
          <UnitCasteBadge caste={unit.caste} />
          <span className="line-clamp-2">{unit.name}</span>
        </span>
      </button>
    </div>
  );
});

const UnitViewerTab = memo(() => {
  const currentGame = useAppSelector((state) => state.app.currentGame);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const enabledMods = useMemo(() => mods.filter((mod) => mod.isEnabled), [mods]);
  const signature = enabledMods.map((mod) => `${mod.path}:${mod.loadOrder ?? ""}:${mod.lastChangedLocal ?? ""}:${mod.lastChanged ?? ""}`).join("|");
  const [groups, setGroups] = useState<UnitViewerCatalogGroup[]>([]);
  const [unitGroups, setUnitGroups] = useState<UnitViewerUiGroup[]>([]);
  const [constants, setConstants] = useState<UnitViewerConstants>();
  const [sessionId, setSessionId] = useState<string>();
  const sessionIdRef = useRef<string>();
  const [sessionRefreshToken, setSessionRefreshToken] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, UnitViewerUnitModel>>({});
  const [icons, setIcons] = useState<Record<string, Record<string, string>>>({});
  const [statIcons, setStatIcons] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [context, setContext] = useState<UnitViewerContext>(DEFAULT_CONTEXT);
  const [comparison, setComparison] = useState<ComparisonSelection>("first");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [rosterGroupKey, setRosterGroupKey] = useState<string>();
  const [cardImages, setCardImages] = useState<Record<string, string>>({});
  const requestedCardPathsRef = useRef(new Set<string>());
  const pendingCardPathsRef = useRef(new Set<string>());
  const cardFlushTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const flushCardImagesRef = useRef<() => void>(() => undefined);

  const resetCardImages = useCallback(() => {
    if (cardFlushTimerRef.current) clearTimeout(cardFlushTimerRef.current);
    cardFlushTimerRef.current = undefined;
    requestedCardPathsRef.current = new Set();
    pendingCardPathsRef.current = new Set();
    setCardImages({});
  }, []);

  const recoverMissingSession = useCallback((failedSessionId: string) => {
    if (sessionIdRef.current !== failedSessionId) return false;
    sessionIdRef.current = undefined;
    setSessionId(undefined);
    setDetails({});
    setIcons({});
    setStatIcons({});
    setImages({});
    resetCardImages();
    setLoadingKeys(new Set());
    setError(undefined);
    setSessionRefreshToken((token) => token + 1);
    return true;
  }, [resetCardImages]);

  const flushCardImageRequests = useCallback(() => {
    const requestedSessionId = sessionIdRef.current;
    if (!requestedSessionId) return;
    const paths = Array.from(pendingCardPathsRef.current).slice(0, 60);
    for (const path of paths) pendingCardPathsRef.current.delete(path);
    if (paths.length === 0) return;
    window.api?.getUnitViewerAssets(requestedSessionId, paths).then((result) => {
      if (sessionIdRef.current !== requestedSessionId) return;
      if (!result?.success) {
        if (result?.error && isMissingUnitViewerSessionError(result.error)) recoverMissingSession(requestedSessionId);
        return;
      }
      const assets = Object.entries(result.assets || {});
      if (assets.length === 0) return;
      setCardImages((current) => {
        const next = { ...current };
        for (const [path, asset] of assets) next[path] = `data:${asset.mimeType || "image/png"};base64,${asset.base64}`;
        return next;
      });
    }).catch(() => undefined);
    if (pendingCardPathsRef.current.size > 0 && !cardFlushTimerRef.current) {
      cardFlushTimerRef.current = setTimeout(() => {
        cardFlushTimerRef.current = undefined;
        flushCardImagesRef.current();
      }, 0);
    }
  }, [recoverMissingSession]);

  useEffect(() => {
    flushCardImagesRef.current = flushCardImageRequests;
  }, [flushCardImageRequests]);

  useEffect(() => () => {
    if (cardFlushTimerRef.current) clearTimeout(cardFlushTimerRef.current);
  }, []);

  const requestCardImage = useCallback((assetPath: string) => {
    if (requestedCardPathsRef.current.has(assetPath)) return;
    requestedCardPathsRef.current.add(assetPath);
    pendingCardPathsRef.current.add(assetPath);
    if (cardFlushTimerRef.current) return;
    cardFlushTimerRef.current = setTimeout(() => {
      cardFlushTimerRef.current = undefined;
      flushCardImagesRef.current();
    }, 60);
  }, []);

  const toggleSelectedUnit = useCallback((unitKey: string) => {
    setSelectedKeys((keys) => (keys.includes(unitKey) ? keys.filter((key) => key !== unitKey) : [...keys, unitKey]));
  }, []);

  useEffect(() => {
    if (currentGame !== "wh3") return;
    let cancelled = false;
    sessionIdRef.current = undefined;
    setSessionId(undefined);
    setLoadingKeys(new Set());
    resetCardImages();
    setLoading(true);
    setError(undefined);
    window.api?.getUnitViewerCatalog(enabledMods).then((result) => {
      if (cancelled) return;
      if (!result?.success || !result.sessionId || !result.groups || !result.constants) {
        setError(result?.error || "Failed to load Unit Viewer");
        setGroups([]);
        return;
      }
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      setGroups(result.groups);
      setUnitGroups(result.unitGroups || []);
      setConstants(result.constants);
      setStatIcons(result.statIcons || {});
      setCollapsed((current) => Object.fromEntries(
        result.groups!.map((group) => [group.key, current[group.key] ?? true]),
      ));
      const available = new Set(result.groups.flatMap((group) => group.units.map((unit) => unit.key)));
      setSelectedKeys((keys) => keys.filter((key) => available.has(key)));
      setDetails({});
      setIcons({});
      setImages({});
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Failed to load Unit Viewer");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentGame, enabledMods, resetCardImages, sessionRefreshToken, signature]);

  useEffect(() => {
    if (!sessionId) return;
    const requestedSessionId = sessionId;
    for (const key of selectedKeys) {
      if (details[key] || loadingKeys.has(key)) continue;
      setLoadingKeys((current) => new Set(current).add(key));
      window.api?.getUnitViewerDetails(requestedSessionId, key).then(async (result) => {
        if (!result?.success || !result.unit) throw new Error(result?.error || `Failed to load ${key}`);
        if (sessionIdRef.current !== requestedSessionId) return;
        setDetails((current) => ({ ...current, [key]: result.unit! }));
        setIcons((current) => ({ ...current, [key]: result.icons || {} }));
        if (result.unit.unitCardPath) {
          const asset = await window.api?.getUnitViewerAsset(requestedSessionId, result.unit.unitCardPath);
          if (asset?.error && isMissingUnitViewerSessionError(asset.error)) throw new Error(asset.error);
          if (asset?.success && asset.base64) {
            setImages((current) => ({ ...current, [key]: `data:${asset.mimeType || "image/png"};base64,${asset.base64}` }));
          }
        }
      }).catch((reason) => {
        const message = reason instanceof Error ? reason.message : `Failed to load ${key}`;
        if (isMissingUnitViewerSessionError(message) && recoverMissingSession(requestedSessionId)) return;
        if (sessionIdRef.current === requestedSessionId) setError(message);
      })
        .finally(() => setLoadingKeys((current) => { const next = new Set(current); next.delete(key); return next; }));
    }
  }, [details, loadingKeys, recoverMissingSession, selectedKeys, sessionId]);

  const filterLower = filter.trim().toLowerCase();
  const browserRows = useMemo(() => {
    const rows: BrowserRow[] = [];
    for (const group of groups) {
      const filteredUnits = filterLower
        ? group.units.filter((unit) => `${unit.name} ${unit.key} ${unit.category} ${unit.caste}`.toLowerCase().includes(filterLower))
        : group.units;
      if (filteredUnits.length === 0 && !group.name.toLowerCase().includes(filterLower)) continue;
      rows.push({ kind: "group", group: { ...group, units: filteredUnits } });
      if (collapsed[group.key] === false || filterLower) {
        for (const unit of filteredUnits) rows.push({ kind: "unit", groupKey: group.key, unit });
      }
    }
    return rows;
  }, [collapsed, filterLower, groups]);

  const rosterGroup = useMemo(
    () => groups.find((group) => group.key === rosterGroupKey) || groups[0],
    [groups, rosterGroupKey],
  );

  const rosterSections = useMemo(() => {
    if (!rosterGroup) return [];
    const units = filterLower
      ? rosterGroup.units.filter((unit) => `${unit.name} ${unit.key} ${unit.category} ${unit.caste}`.toLowerCase().includes(filterLower))
      : rosterGroup.units;
    const unitsByUiGroup = new Map<string, UnitViewerCatalogUnit[]>();
    for (const unit of units) {
      const sectionUnits = unitsByUiGroup.get(unit.uiGroupKey) || [];
      sectionUnits.push(unit);
      unitsByUiGroup.set(unit.uiGroupKey, sectionUnits);
    }
    const knownKeys = new Set(unitGroups.map((unitGroup) => unitGroup.key));
    return [
      ...unitGroups,
      ...Array.from(unitsByUiGroup.keys())
        .filter((key) => !knownKeys.has(key))
        .map((key) => ({ key, name: key, order: Number.MAX_SAFE_INTEGER })),
    ]
      .filter((unitGroup) => unitsByUiGroup.has(unitGroup.key))
      .map((unitGroup) => ({ ...unitGroup, units: unitsByUiGroup.get(unitGroup.key)! }));
  }, [filterLower, rosterGroup, unitGroups]);

  useEffect(() => {
    if (!isRosterOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsRosterOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRosterOpen]);

  const calculated = useMemo(() => {
    if (!constants) return {} as Record<string, UnitViewerCalculatedStats>;
    return Object.fromEntries(Object.entries(details).map(([key, unit]) => [key, calculateUnitViewerStats(unit, constants, context)]));
  }, [constants, context, details]);
  const unitNames = useMemo(
    () => new Map(groups.flatMap((group) => group.units.map((unit) => [unit.key, unit.name] as const))),
    [groups],
  );

  useEffect(() => {
    if (!comparison.startsWith("unit:")) return;
    const comparisonKey = comparison.slice("unit:".length);
    if (!selectedKeys.includes(comparisonKey)) setComparison("first");
  }, [comparison, selectedKeys]);

  const getComparisonKey = (unitKey: string, index: number) => {
    let comparisonKey: string | undefined;
    if (comparison === "first") comparisonKey = selectedKeys[0];
    else if (comparison === "left") comparisonKey = index > 0 ? selectedKeys[index - 1] : undefined;
    else comparisonKey = comparison.slice("unit:".length);
    return comparisonKey === unitKey ? undefined : comparisonKey;
  };

  const moveSelectedUnit = (index: number, offset: -1 | 1) => {
    setSelectedKeys((keys) => {
      const destination = index + offset;
      if (index < 0 || destination < 0 || destination >= keys.length) return keys;
      const next = [...keys];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  if (currentGame !== "wh3") return <div className="px-6 py-4 text-gray-300">Unit Viewer is available only for Warhammer 3.</div>;

  const renderBrowserRow = ({ index, key, style }: ListRowProps) => {
    const row = browserRows[index];
    if (row.kind === "group") {
      const isCollapsed = collapsed[row.group.key] !== false && !filterLower;
      return <button key={key} style={style} type="button" className="flex w-full items-center gap-1 border-b border-gray-800 bg-gray-900 px-2 text-left text-sm font-semibold text-amber-100 hover:bg-gray-800" onClick={() => setCollapsed((current) => ({ ...current, [row.group.key]: current[row.group.key] === false }))}>
        {isCollapsed ? <IoChevronForward /> : <IoChevronDown />}<span className="truncate">{row.group.name}</span><span className="ml-auto text-xs text-gray-500">{row.group.units.length}</span>
      </button>;
    }
    const isSelected = selectedKeys.includes(row.unit.key);
    return <button key={key} style={style} type="button" aria-label={row.unit.name} className={`flex w-full items-center border-b border-gray-800/60 px-7 text-left text-sm ${isSelected ? "bg-amber-900/60 text-amber-100" : "bg-gray-950 text-gray-300 hover:bg-gray-800"}`} title={row.unit.key} onClick={() => toggleSelectedUnit(row.unit.key)}>
      <UnitCasteBadge caste={row.unit.caste} /><span className="truncate">{row.unit.name}</span>
    </button>;
  };

  return (
    <div className="fixed bottom-0 left-12 right-0 top-8 flex overflow-hidden bg-gray-950 text-white">
      <aside className="flex w-[330px] shrink-0 flex-col border-r border-gray-700">
        <div className="p-3">
          <div className="mb-2 flex items-center gap-2">
            <h1 className="text-lg font-semibold text-amber-100">Unit Viewer</h1>
            <div className="ml-auto flex overflow-hidden rounded border border-gray-700">
              <button type="button" aria-label="Browse units as a list" aria-pressed={!isRosterOpen} title="List browser" onClick={() => setIsRosterOpen(false)} className={`px-2 py-1 ${isRosterOpen ? "bg-gray-900 text-gray-400 hover:text-white" : "bg-amber-700 text-white"}`}><IoList size={16} /></button>
              <button type="button" aria-label="Browse unit cards by category" aria-pressed={isRosterOpen} title="Card browser" onClick={() => setIsRosterOpen(true)} className={`px-2 py-1 ${isRosterOpen ? "bg-amber-700 text-white" : "bg-gray-900 text-gray-400 hover:text-white"}`}><IoGrid size={16} /></button>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded border border-gray-700 bg-gray-900 px-2">
            <IoSearch className="text-gray-500" />
            <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search units or keys" className="w-full bg-transparent py-2 text-sm outline-none" />
          </label>
        </div>
        <div className="min-h-0 flex-1">
          {loading ? <div className="p-4 text-sm text-gray-400">Loading units and enabled mods…</div> : error && groups.length === 0 ? <div className="p-4 text-sm text-red-300">{error}</div> : <AutoSizer>{({ height, width }) => <List width={width} height={height} rowCount={browserRows.length} rowHeight={34} rowRenderer={renderBrowserRow} overscanRowCount={12} />}</AutoSizer>}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-700 bg-gray-900 px-4 py-2">
          <label className="text-xs text-gray-400">Unit Size <select value={context.unitSize} onChange={(event) => setContext((current) => ({ ...current, unitSize: event.target.value as UnitViewerUnitSize }))} className="ml-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white">{(["small", "medium", "large", "ultra"] as UnitViewerUnitSize[]).map((size) => <option key={size} value={size}>{size[0].toUpperCase() + size.slice(1)}</option>)}</select></label>
          <label className="text-xs text-gray-400">Rank <select value={context.rank} onChange={(event) => setContext((current) => ({ ...current, rank: Number(event.target.value) }))} className="ml-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white">{Array.from({ length: 10 }, (_, rank) => <option key={rank} value={rank}>{rank}</option>)}</select></label>
          <label className="text-xs text-gray-400">Vigour <select value={context.fatigue} onChange={(event) => setContext((current) => ({ ...current, fatigue: event.target.value as UnitViewerFatigue }))} className="ml-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white">{Object.entries(FATIGUE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs text-gray-400">Comparison <select value={comparison} onChange={(event) => setComparison(event.target.value as ComparisonSelection)} className="ml-1 max-w-52 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white">
            <option value="first">Compare to first</option>
            {selectedKeys.map((key) => <option key={key} value={`unit:${key}`}>Compare to {details[key]?.name || unitNames.get(key) || key}</option>)}
            <option value="left">Compare to left position</option>
          </select></label>
          <span className="ml-auto text-xs text-gray-500">{selectedKeys.length} selected</span>
        </div>
        {error && groups.length > 0 && <div className="border-b border-red-900 bg-red-950/70 px-4 py-2 text-sm text-red-200">{error}</div>}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {selectedKeys.length === 0 ? <div className="flex h-full items-center justify-center text-gray-500">Select units from the roster to compare them.</div> : <div className="flex items-start gap-3">{selectedKeys.map((key, index) => {
            const unit = details[key]; const stats = calculated[key];
            if (!unit || !stats) return <div key={key} className="flex h-40 w-[370px] shrink-0 items-center justify-center rounded border border-gray-700 bg-gray-900 text-gray-300">Loading unit…</div>;
            const comparisonKey = getComparisonKey(key, index);
            return <UnitCard
              key={key}
              unit={unit}
              stats={stats}
              compareUnit={comparisonKey ? details[comparisonKey] : undefined}
              compareStats={comparisonKey ? calculated[comparisonKey] : undefined}
              statIconPaths={constants?.statIconPaths || {}}
              icons={{ ...statIcons, ...(icons[key] || {}) }}
              imageSrc={images[key]}
              onRemove={() => setSelectedKeys((keys) => keys.filter((unitKey) => unitKey !== key))}
              onMoveLeft={index > 0 ? () => moveSelectedUnit(index, -1) : undefined}
              onMoveRight={index < selectedKeys.length - 1 ? () => moveSelectedUnit(index, 1) : undefined}
            />;
          })}</div>}
        </div>
      </main>
      {/* The panel background is an arbitrary value because Tailwind 3.2 has no gray-950 shade. */}
      {isRosterOpen && (
        <div role="dialog" aria-label="Unit card browser" className="absolute inset-0 z-40 flex flex-col bg-[#030712]">
          <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-700 bg-gray-900 px-4 py-2">
            <h2 className="text-lg font-semibold text-amber-100">Unit Cards</h2>
            <label className="text-xs text-gray-400">Faction Group <select
              aria-label="Subculture"
              value={rosterGroup?.key || ""}
              onChange={(event) => setRosterGroupKey(event.target.value)}
              className="ml-1 max-w-72 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white"
            >{groups.map((group) => <option key={group.key} value={group.key}>{group.name}</option>)}</select></label>
            <label className="flex min-w-52 items-center gap-2 rounded border border-gray-700 bg-gray-800 px-2">
              <IoSearch className="text-gray-500" />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search units or keys" aria-label="Search unit cards" className="w-full bg-transparent py-1 text-sm outline-none" />
            </label>
            <span className="ml-auto text-xs text-gray-500">{selectedKeys.length} selected</span>
            <button type="button" onClick={() => setIsRosterOpen(false)} aria-label="Close unit card browser" className="flex items-center gap-1 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-200 hover:border-amber-500 hover:text-white">
              <IoClose size={18} /> Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {loading ? <div className="text-sm text-gray-400">Loading units and enabled mods…</div>
              : rosterSections.length === 0 ? <div className="flex h-full items-center justify-center text-gray-500">No units match the current search.</div>
                : rosterSections.map((section) => (
                  <section key={section.key} className="mb-5">
                    <h3 className="mb-2 flex items-baseline gap-2 border-b border-gray-700 pb-1 text-[15px] font-semibold text-amber-100">
                      {section.name}<span className="text-xs font-normal text-gray-500">{section.units.length}</span>
                    </h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
                      {section.units.map((unit) => (
                        <RosterUnitTile
                          key={unit.key}
                          unit={unit}
                          imageSrc={unit.unitCardPath ? cardImages[unit.unitCardPath] : undefined}
                          isSelected={selectedKeys.includes(unit.key)}
                          onToggle={toggleSelectedUnit}
                          onRequestImage={requestCardImage}
                        />
                      ))}
                    </div>
                  </section>
                ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default UnitViewerTab;
