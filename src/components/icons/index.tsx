// Optimized icon imports with tree-shaking
// Import only the specific icons needed to reduce bundle size

// React Icons - import specific icons only
import { HiOutlineCollection } from "react-icons/hi";
import { GoGear } from "react-icons/go";
import { FaXmark } from "react-icons/fa6";
import { BsEyeFill, BsEyeSlashFill } from "react-icons/bs";
import { BiSolidRightArrow, BiSolidDownArrow } from "react-icons/bi";
import { MdDragIndicator } from "react-icons/md";
import { FiSettings } from "react-icons/fi";
import { AiOutlineQuestionCircle } from "react-icons/ai";
import { GiSettingsKnobs } from "react-icons/gi";

// Create lazy-loaded icon components for heavy icons
import React from "react";

// Keep these imports explicit. A template-literal import creates a Webpack context rooted at
// `react-icons`, which package exports do not expose as a directory and which breaks the renderer
// build before the requested icon set can be loaded.
type LazyIconModule = Record<string, React.ComponentType<{ size?: number; className?: string }>>;
const iconSetLoaders: Record<string, () => Promise<unknown>> = {
  ai: () => import("react-icons/ai"),
  bi: () => import("react-icons/bi"),
  bs: () => import("react-icons/bs"),
  cg: () => import("react-icons/cg"),
  ci: () => import("react-icons/ci"),
  di: () => import("react-icons/di"),
  fa: () => import("react-icons/fa"),
  fa6: () => import("react-icons/fa6"),
  fc: () => import("react-icons/fc"),
  fi: () => import("react-icons/fi"),
  gi: () => import("react-icons/gi"),
  go: () => import("react-icons/go"),
  gr: () => import("react-icons/gr"),
  hi: () => import("react-icons/hi"),
  hi2: () => import("react-icons/hi2"),
  im: () => import("react-icons/im"),
  io: () => import("react-icons/io"),
  io5: () => import("react-icons/io5"),
  lia: () => import("react-icons/lia"),
  lu: () => import("react-icons/lu"),
  md: () => import("react-icons/md"),
  pi: () => import("react-icons/pi"),
  ri: () => import("react-icons/ri"),
  rx: () => import("react-icons/rx"),
  si: () => import("react-icons/si"),
  sl: () => import("react-icons/sl"),
  tb: () => import("react-icons/tb"),
  tfi: () => import("react-icons/tfi"),
  ti: () => import("react-icons/ti"),
  vsc: () => import("react-icons/vsc"),
  wi: () => import("react-icons/wi"),
};

// Icon loading fallback
const IconFallback = ({ size = 16 }: { size?: number }) => (
  <div style={{ width: size, height: size }} className="bg-gray-300 rounded animate-pulse" />
);

// Lazy load heavy icon sets (removed unused LazyReactIcon)

// Helper component for lazy-loaded icons
export const LazyIcon = ({
  iconName,
  iconSet,
  size = 16,
  className = "",
}: {
  iconName: string;
  iconSet: string;
  size?: number;
  className?: string;
}) => {
  const [IconComponent, setIconComponent] = React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    const loadIcon = async () => {
      try {
        const loadIconSet = iconSetLoaders[iconSet];
        if (!loadIconSet) throw new Error(`Unknown icon set: ${iconSet}`);
        const iconModule = (await loadIconSet()) as LazyIconModule;
        const Icon = iconModule[iconName];
        if (Icon) {
          setIconComponent(() => Icon);
        }
      } catch (error) {
        console.warn(`Failed to load icon ${iconName} from ${iconSet}:`, error);
      }
    };

    loadIcon();
  }, [iconName, iconSet]);

  if (!IconComponent) {
    return <IconFallback size={size} />;
  }

  return React.createElement(IconComponent as any, { size, className });
};

// Pre-define commonly used icons for better performance
export const Icons = {
  Collection: HiOutlineCollection,
  Gear: GoGear,
  Close: FaXmark,
  EyeOpen: BsEyeFill,
  EyeClosed: BsEyeSlashFill,
  ArrowRight: BiSolidRightArrow,
  ArrowDown: BiSolidDownArrow,
  Drag: MdDragIndicator,
  Settings: FiSettings,
  Help: AiOutlineQuestionCircle,
  SettingsKnobs: GiSettingsKnobs,
} as const;

export type IconName = keyof typeof Icons;
