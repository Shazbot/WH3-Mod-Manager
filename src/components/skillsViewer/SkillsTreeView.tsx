import React, { memo, useEffect, useRef } from "react";
import { useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import { buildKeyPrefixDisplay } from "../viewer/viewerHelpers";

type SkillsTreeViewProps = {
  tableFilter: string;
  hideRepeatedKeyPrefixes?: boolean;
  onSelect?: (subtype: string, subtypeIndex: number) => void;
  onHover?: (subtype: string, subtypeIndex: number) => void;
  onDoubleClick?: (subtype: string, subtypeIndex: number, firstClickSelected: boolean) => void;
  isSelectionCleared?: boolean;
};

const collator = new Intl.Collator("en");
// Kept stable because the tree re-applies `selectedIds` whenever the array changes.
const NO_SELECTED_IDS: string[] = [];
// How long the pointer rests on a row before `onHover`, so sweeping past rows does not load their trees.
const HOVER_DELAY_MS = 100;
const SKILL_NODE_SET_PREFIX = "set_";
/** Known game/DLC prefixes that are boilerplate in skill node-set keys. */
const SKILL_NODE_SET_OUTLIER_PREFIXES = [
  /^wh_pro\d+_skill_node_set_/,
  /^wh2_dlc\d+_/,
  /^wh_dlc\d+_skill_node_set_/,
  /^wh2_pro\d+_skill_node_/,
  /^wh3_dlc\d+_skill_node_set_/,
  /^wh3_dlc\d+_/,
  /^wh3_pro\d+_/,
] as const;

const stripKnownSkillNodeSetPrefix = (value: string) => {
  for (const prefix of SKILL_NODE_SET_OUTLIER_PREFIXES) {
    const match = prefix.exec(value);
    if (match) return value.slice(match[0].length);
  }
  return value;
};

const SkillsTreeView = memo((props: SkillsTreeViewProps) => {
  const firstClickSelected = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const isLocalizingSubtypes = useAppSelector((state) => state.app.isLocalizingSubtypes);
  const isShowingSkillNodeSetNames = useAppSelector((state) => state.app.isShowingSkillNodeSetNames);
  const skillsData = useAppSelector((state) => state.app.skillsData);
  if (!skillsData || !skillsData.subtypes) {
    console.log("skillsData or skillsData.subtypes missing!");
    return <></>;
  }
  // const subtypeToSkills = skillsData.subtypeToSkills;
  const agentSubtypes = [...skillsData.subtypes].sort(collator.compare);

  type TreeData = {
    name: string;
    children?: TreeData[];
    metadata: TreeMetadata;
  };
  type TreeMetadata = { subtype: string; subtypeIndex: number };

  const result = agentSubtypes.reduce(
    (treeData, subtype) => {
      treeData.children = treeData.children || [];
      for (let i = 0; i < skillsData.subtypeToNumSets[subtype]; i++) {
        treeData.children.push({ name: subtype, children: [], metadata: { subtype, subtypeIndex: i } });
      }

      return treeData;
    },
    { name: "", children: [], metadata: { subtype: "", subtypeIndex: 0 } } as TreeData,
  );

  const hideRepeatedKeyPrefixes = props.hideRepeatedKeyPrefixes ?? true;

  const getSkillNodeSetKey = (metadata: TreeMetadata) =>
    skillsData.subtypesToSet?.[metadata.subtype]?.[metadata.subtypeIndex] ?? metadata.subtype;

  const getFullNodeLabel = (metadata: TreeMetadata) => {
    if (isShowingSkillNodeSetNames) {
      return getSkillNodeSetKey(metadata);
    }

    const subtypeName = isLocalizingSubtypes
      ? (skillsData.subtypesToLocalizedNames[metadata.subtype] ?? metadata.subtype)
      : metadata.subtype;
    const indexSuffix = (skillsData.subtypeToNumSets[metadata.subtype] ?? 0) > 1 ? ` ${metadata.subtypeIndex + 1}` : "";
    return `${subtypeName}${indexSuffix}`;
  };

  const fullNodeLabels = (result.children ?? []).map((node) => getFullNodeLabel(node.metadata));
  const displayNodeLabels = (() => {
    if (!hideRepeatedKeyPrefixes) return undefined;

    const shortened = buildKeyPrefixDisplay(fullNodeLabels).shortened;
    const candidates = fullNodeLabels.map((fullLabel) => {
      let shortenedLabel = shortened.get(fullLabel) ?? fullLabel;
      if (isShowingSkillNodeSetNames) {
        shortenedLabel = stripKnownSkillNodeSetPrefix(shortenedLabel);
        if (shortenedLabel.startsWith(SKILL_NODE_SET_PREFIX)) {
          shortenedLabel = shortenedLabel.slice(SKILL_NODE_SET_PREFIX.length);
        }
      }
      return shortenedLabel;
    });
    const candidateCounts = new Map<string, number>();
    for (const candidate of candidates) {
      candidateCounts.set(candidate, (candidateCounts.get(candidate) ?? 0) + 1);
    }

    const displayLabels = new Map<string, string>();
    for (let index = 0; index < fullNodeLabels.length; index++) {
      const fullLabel = fullNodeLabels[index];
      const candidate = candidates[index];
      if (candidate !== fullLabel && candidateCounts.get(candidate) === 1) {
        displayLabels.set(fullLabel, candidate);
      }
    }
    return displayLabels;
  })();

  const getDisplayLabel = (fullLabel: string) => displayNodeLabels?.get(fullLabel) ?? fullLabel;

  if (hideRepeatedKeyPrefixes) {
    result.children?.sort((first, second) => {
      const firstLabel = getDisplayLabel(getFullNodeLabel(first.metadata));
      const secondLabel = getDisplayLabel(getFullNodeLabel(second.metadata));
      return collator.compare(firstLabel, secondLabel);
    });
  }

  // console.log(result);
  const data = flattenTree(result);

  const getFullNodeLabelForElement = (element: INode) => getFullNodeLabel(element.metadata as TreeMetadata);

  const getNodeLabel = (element: INode) => getDisplayLabel(getFullNodeLabelForElement(element));

  const getNodeTooltip = (element: INode) => {
    const metadata = element.metadata as TreeMetadata;
    const fullLabel = getFullNodeLabelForElement(element);
    if (displayNodeLabels?.has(fullLabel)) return fullLabel;

    if (isShowingSkillNodeSetNames) {
      return metadata.subtype;
    }

    return getSkillNodeSetKey(metadata);
  };

  const onTreeSelect = (treeProps: ITreeViewOnSelectProps) => {
    console.log("SkillsTreeView onTreeSelect");
    // console.log(props);
    if (treeProps.isSelected) {
      const parentLeaf = data.find((leaf) => leaf.id == treeProps.element.parent);
      if (parentLeaf) {
        const metadata = treeProps.element.metadata as TreeMetadata;
        console.log(`SENT GET PACK DATA`, metadata);
        props.onSelect?.(metadata.subtype, metadata.subtypeIndex);
        if (!props.onSelect) {
          window.api?.getSkillsForSubtype(metadata.subtype, metadata.subtypeIndex);
        }
        // dispatch(
        //   selectDBTable({
        //     packPath: packData.packPath,
        //     dbName: parentLeaf.name,
        //     dbSubname: props.element.name,
        //   })
        // );
      }
    }
  };

  const ArrowIcon = ({ isOpen, className }: { isOpen: boolean; className: string }) => {
    const baseClass = "arrow";
    const classes = cx(
      baseClass,
      { "arrow--closed": !isOpen },
      { "arrow--open": isOpen },
      { "rotate-90": isOpen },
      className,
      "w-4",
      "h-4",
    );
    return (
      <span className="w-4 h-4">
        <IoMdArrowDropright size={"100%"} className={classes} />
      </span>
    );
  };

  const areNodeChildrenShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.children.length == 0) return false;

    const childNodes = elementData.children
      .map((childId) => data.find((node) => node.id == childId))
      .filter((id) => id != null);

    const res = childNodes.reduce((isShown, currentNode) => {
      if (!currentNode) return isShown;
      return (
        isShown ||
        getFullNodeLabelForElement(currentNode).includes(props.tableFilter) ||
        areNodeChildrenShown(currentNode)
      );
    }, false);

    return res;
  };

  const isAnyNodeParentShown = (element: INode): boolean => {
    const elementData = data.find((node) => node.id == element.id);
    if (!elementData) return true;
    if (elementData.parent == null) return false;

    let isParentFiltered = false;
    const parentNode = data.find((node) => node.id == element.parent);
    if (parentNode)
      isParentFiltered =
        getFullNodeLabelForElement(parentNode).includes(props.tableFilter) || isAnyNodeParentShown(parentNode);

    return isParentFiltered;
  };

  const isTreeNodeFiltered = (element: INode): boolean => {
    if (props.tableFilter == "") return false;

    return !(
      getFullNodeLabelForElement(element).includes(props.tableFilter) ||
      areNodeChildrenShown(element) ||
      isAnyNodeParentShown(element)
    );
  };

  // console.log("TREE DATA is", data);

  return (
    <div className="skills-node-sets-tree">
      <TreeView
        data={data}
        aria-label="Controlled expanded node tree"
        onSelect={(props) => onTreeSelect(props)}
        selectedIds={props.isSelectionCleared ? NO_SELECTED_IDS : undefined}
        nodeRenderer={({
          element,
          isBranch,
          isExpanded,
          isDisabled,
          isSelected,
          getNodeProps,
          level,
          handleExpand,
          handleSelect,
        }) => {
          return (
            <div
              {...getNodeProps({ onClick: handleExpand })}
              style={{
                marginLeft: 40 * (level - 1),
                opacity: isDisabled ? 0.5 : 1,
              }}
              className={
                "flex items-center not-first:mt-2 hover:overflow-visible cursor-default " +
                (isTreeNodeFiltered(element) ? "hidden" : "")
              }
            >
              {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
              <span
                onMouseEnter={() => {
                  const metadata = element.metadata as TreeMetadata;
                  clearTimeout(hoverTimer.current);
                  hoverTimer.current = setTimeout(
                    () => props.onHover?.(metadata.subtype, metadata.subtypeIndex),
                    HOVER_DELAY_MS,
                  );
                }}
                onMouseLeave={() => clearTimeout(hoverTimer.current)}
                onMouseDown={(e) => {
                  if (e.detail > 1) {
                    e.preventDefault();
                  } else if (e.button === 0) {
                    // A click is coming, so the hover delay is not worth waiting out.
                    clearTimeout(hoverTimer.current);
                    const metadata = element.metadata as TreeMetadata;
                    props.onHover?.(metadata.subtype, metadata.subtypeIndex);
                  }
                }}
                onClick={(e) => {
                  if (e.detail === 1) firstClickSelected.current = !isSelected;
                  handleSelect(e);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  const metadata = element.metadata as TreeMetadata;
                  props.onDoubleClick?.(metadata.subtype, metadata.subtypeIndex, firstClickSelected.current);
                }}
                className="relative hover:underline cursor-pointer"
                title={getNodeTooltip(element)}
              >
                {getNodeLabel(element)}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
});

export default SkillsTreeView;
