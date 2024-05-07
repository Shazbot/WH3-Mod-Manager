import React, { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../hooks";
import { IoMdArrowDropright } from "react-icons/io";
import TreeView, { INode, ITreeViewOnSelectProps, flattenTree } from "react-accessible-treeview";
import cx from "classnames";
import "@silevis/reactgrid/styles.css";
import { getDBNameFromString, getDBSubnameFromString } from "../../utility/packFileHelpers";
import { selectDBTable } from "../../appSlice";
import { gameToPackWithDBTablesName } from "../../supportedGames";

type PackTablesTreeViewProps = {
  tableFilter: string;
};

const PackTablesTreeView = React.memo((props: PackTablesTreeViewProps) => {
  const dispatch = useAppDispatch();
  const currentDBTableSelection = useAppSelector((state) => state.app.currentDBTableSelection);
  const currentGame = useAppSelector((state) => state.app.currentGame);

  const packsData = useAppSelector((state) => state.app.packsData);

  const packPath =
    currentDBTableSelection?.packPath ?? (gameToPackWithDBTablesName[currentGame] || "db.pack");
  const packData = packsData[packPath];
  // const packData = currentPackData.data;
  if (!packData) {
    console.log("PackTablesTreeView: no pack data");
    return <></>;
  }

  // console.log("TreeView packsData:", packData);

  type TreeData = { name: string; children?: TreeData[] };
  const result = packData.tables.reduce(
    (map, packFileName) => {
      const dbName = getDBNameFromString(packFileName);
      const dbSubname = getDBSubnameFromString(packFileName);

      if (dbName && dbSubname) {
        if (typeof map.children === "undefined") {
          map.children = [];
        }
        map.children = map.children || [];
        const existingNode = map.children.find((node) => node.name == dbName);
        if (existingNode) existingNode.children?.push({ name: dbSubname, children: [] });
        else map.children.push({ name: dbName, children: [{ name: dbSubname, children: [] }] });
      }
      return map;
    },
    { name: "", children: [] } as TreeData
  );

  // console.log(result);
  const data = flattenTree(result);

  const onTreeSelect = (props: ITreeViewOnSelectProps) => {
    // console.log("ON TREE SELECT");
    // console.log(props);
    if (
      props.isSelected &&
      props.element.parent &&
      props.element.children &&
      props.element.children.length < 1
    ) {
      const parentLeaf = data.find((leaf) => leaf.id == props.element.parent);
      if (parentLeaf) {
        const packPath = packData.packPath;
        const dbName = parentLeaf.name;
        const dbSubname = props.element.name;
        console.log(`SENT GET PACK DATA ${packPath + " " + dbName + " " + dbSubname}}`);
        window.api?.getPackData(packPath, { dbName, dbSubname });
        dispatch(
          selectDBTable({
            packPath: packData.packPath,
            dbName: parentLeaf.name,
            dbSubname: props.element.name,
          })
        );
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

export default PackTablesTreeView;
