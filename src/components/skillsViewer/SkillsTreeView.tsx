import React, { memo, useRef } from "react";
import { useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";

type SkillsTreeViewProps = {
  tableFilter: string;
  onDoubleClick?: (subtype: string, subtypeIndex: number) => void;
};

const collator = new Intl.Collator("en");

const SkillsTreeView = memo((props: SkillsTreeViewProps) => {
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLocalizingSubtypes = useAppSelector((state) => state.app.isLocalizingSubtypes);
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

  // console.log(result);
  const data = flattenTree(result);

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    console.log("SkillsTreeView onTreeSelect");
    // console.log(props);
    if (props.isSelected) {
      const parentLeaf = data.find((leaf) => leaf.id == props.element.parent);
      if (parentLeaf) {
        const metadata = props.element.metadata as TreeMetadata;
        console.log(`SENT GET PACK DATA`, metadata);
        window.api?.getSkillsForSubtype(metadata.subtype, metadata.subtypeIndex);
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
      { [`${baseClass}--closed`]: !isOpen },
      { [`${baseClass}--open`]: isOpen },
      { [`rotate-90`]: isOpen },
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
      return isShown || currentNode.name.includes(props.tableFilter) || areNodeChildrenShown(currentNode);
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
      isParentFiltered = parentNode.name.includes(props.tableFilter) || isAnyNodeParentShown(parentNode);

    return isParentFiltered;
  };

  const isTreeNodeFiltered = (element: INode): boolean => {
    if (props.tableFilter == "") return false;

    return !(
      element.name.includes(props.tableFilter) ||
      areNodeChildrenShown(element) ||
      isAnyNodeParentShown(element)
    );
  };

  // console.log("TREE DATA is", data);

  return (
    <div>
      <TreeView
        data={data}
        aria-label="Controlled expanded node tree"
        onSelect={(props) => onTreeSelect(props)}
        nodeRenderer={({
          element,
          isBranch,
          isExpanded,
          isDisabled,
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
                "flex items-center [&:not(:first-child)]:mt-2 hover:overflow-visible cursor-default " +
                (isTreeNodeFiltered(element) ? "hidden" : "")
              }
            >
              {isBranch && <ArrowIcon className="" isOpen={isExpanded} />}
              <span
                onClick={(e) => {
                  if (props.onDoubleClick) {
                    const evt = { ...e } as React.MouseEvent;
                    if (clickTimer.current) clearTimeout(clickTimer.current);
                    clickTimer.current = setTimeout(() => {
                      clickTimer.current = null;
                      handleSelect(evt);
                    }, 250);
                  } else {
                    handleSelect(e);
                  }
                }}
                onDoubleClick={() => {
                  if (clickTimer.current) {
                    clearTimeout(clickTimer.current);
                    clickTimer.current = null;
                  }
                  const metadata = element.metadata as TreeMetadata;
                  props.onDoubleClick?.(metadata.subtype, metadata.subtypeIndex);
                }}
                className="relative hover:underline cursor-pointer"
              >
                {/* <span onClick={(e) => handleSelect(e)} className="absolute">
                  {element.name}
                </span> */}
                {`${
                  isLocalizingSubtypes
                    ? (skillsData.subtypesToLocalizedNames[element.name] ?? element.name)
                    : element.name
                }${
                  skillsData.subtypeToNumSets[(element.metadata as TreeMetadata).subtype] > 1
                    ? ` ${(element.metadata as TreeMetadata).subtypeIndex + 1}`
                    : ""
                }`}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
});

export default SkillsTreeView;
