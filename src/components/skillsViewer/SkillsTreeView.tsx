import React, { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";

type SkillsTreeViewProps = {
  tableFilter: string;
};

const collator = new Intl.Collator("en");

const SkillsTreeView = React.memo((props: SkillsTreeViewProps) => {
  const dispatch = useAppDispatch();

  const skillsData = useAppSelector((state) => state.app.skillsData);
  if (!skillsData || !skillsData.subtypes) {
    console.log("skillsData or skillsData.subtypes missing!");
    return <></>;
  }
  // const subtypeToSkills = skillsData.subtypeToSkills;
  const agentSubtypes = [...skillsData.subtypes].sort(collator.compare);

  console.log("skillsData subtypes:", skillsData.subtypes);
  // const subtypes = Object.keys(subtypeToSkills);
  // return <></>;

  type TreeData = { name: string; children?: TreeData[] };
  const result = agentSubtypes.reduce(
    (treeData, subtype) => {
      treeData.children = treeData.children || [];
      treeData.children.push({ name: subtype, children: [] });

      return treeData;
    },
    { name: "", children: [] } as TreeData
  );

  // console.log(result);
  const data = flattenTree(result);

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    // console.log("ON TREE SELECT");
    // console.log(props);
    if (props.isSelected) {
      const parentLeaf = data.find((leaf) => leaf.id == props.element.parent);
      if (parentLeaf) {
        const agentSubtype = props.element.name;
        console.log(`SENT GET PACK DATA ${agentSubtype}`);
        window.api?.getSkillsForSubtype(agentSubtype);
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
      "h-4"
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
              <span onClick={(e) => handleSelect(e)} className="relative">
                {/* <span onClick={(e) => handleSelect(e)} className="absolute">
                  {element.name}
                </span> */}
                {element.name}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
});

export default SkillsTreeView;
