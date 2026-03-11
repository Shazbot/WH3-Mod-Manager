import { createContext } from "react";

/**
 * The skills data of the tab a skill node is drawn in.
 *
 * Redux only holds the latest response, which belongs to another tree once an older tab is shown again.
 */
export const SkillsDataContext = createContext<SkillsData | undefined>(undefined);
