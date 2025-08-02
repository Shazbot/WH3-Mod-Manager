import React, { memo, useContext, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite/components/Modal/index";
import { addCategory, removeCategory, renameCategory, setCategoryColor } from "../appSlice";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faEdit, faPlus } from "@fortawesome/free-solid-svg-icons";
import { useLocalizations } from "../localizationContext";

interface EditCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EditCategoriesModal = memo(({ isOpen, onClose }: EditCategoriesModalProps) => {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.app.categories);
  const categoryColors = useAppSelector((state) => state.app.categoryColors || {});
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const localized = useLocalizations();

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const colorOptions = [
    { name: localized.colorBlue, bg: "bg-blue-100 dark:bg-blue-900", text: "text-blue-800 dark:text-blue-300" },
    {
      name: localized.colorEmerald,
      bg: "bg-emerald-100 dark:bg-emerald-900",
      text: "text-emerald-800 dark:text-emerald-300",
    },
    { name: localized.colorRed, bg: "bg-red-100 dark:bg-red-900", text: "text-red-800 dark:text-red-300" },
    { name: localized.colorAmber, bg: "bg-amber-100 dark:bg-amber-900", text: "text-amber-800 dark:text-amber-300" },
    { name: localized.colorPurple, bg: "bg-purple-100 dark:bg-purple-900", text: "text-purple-800 dark:text-purple-300" },
    { name: localized.colorRose, bg: "bg-rose-100 dark:bg-rose-900", text: "text-rose-800 dark:text-rose-300" },
    { name: localized.colorTeal, bg: "bg-teal-100 dark:bg-teal-900", text: "text-teal-800 dark:text-teal-300" },
    // { name: "Orange", bg: "bg-orange-100 dark:bg-orange-900", text: "text-orange-800 dark:text-orange-300" },
    { name: localized.colorSlate, bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-800 dark:text-slate-300" },
    { name: localized.colorWhite, bg: "bg-white dark:bg-white", text: "text-gray-900 dark:text-gray-900" },
    // { name: "Black", bg: "bg-gray-900 dark:bg-gray-900", text: "text-white dark:text-white" },
    { name: localized.colorLime, bg: "bg-lime-200 dark:bg-lime-200", text: "text-gray-900 dark:text-gray-900" },
    { name: localized.colorSky, bg: "bg-sky-200 dark:bg-sky-200", text: "text-gray-900 dark:text-gray-900" },
    { name: localized.colorFuchsia, bg: "bg-fuchsia-200 dark:bg-fuchsia-200", text: "text-gray-900 dark:text-gray-900" },
  ];

  const handleAddCategory = () => {
    if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
      dispatch(addCategory({ category: newCategoryName.trim(), mods: [] }));
      setNewCategoryName("");
    }
  };

  const handleDeleteCategory = (category: string) => {
    const modsInCategory = mods.filter((mod) => mod.categories && mod.categories.includes(category));
    dispatch(removeCategory({ category, mods: modsInCategory }));
  };

  const handleStartEdit = (category: string) => {
    setEditingCategory(category);
    setEditingCategoryName(category);
  };

  const handleSaveEdit = () => {
    if (
      editingCategory &&
      editingCategoryName.trim() &&
      editingCategoryName.trim() !== editingCategory &&
      !categories.includes(editingCategoryName.trim())
    ) {
      dispatch(
        renameCategory({
          oldCategory: editingCategory,
          newCategory: editingCategoryName.trim(),
        })
      );
    }
    setEditingCategory(null);
    setEditingCategoryName("");
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditingCategoryName("");
  };

  const filteredCategories = categories.filter((cat) => cat !== "Uncategorized");

  return (
    <Modal show={isOpen} onClose={onClose} size="3xl">
      <Modal.Header>{localized.editCategories}</Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          {/* Add new category section */}
          <div className="border-b pb-4">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
              {localized.addNewCategory}
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={localized.enterCategoryName}
                className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                onKeyPress={(e) => e.key === "Enter" && handleAddCategory()}
              />
              <button
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim() || categories.includes(newCategoryName.trim())}
                className="px-4 py-2 text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
              >
                <FontAwesomeIcon icon={faPlus} className="mr-1" />
                {localized.add}
              </button>
            </div>
          </div>

          {/* Existing categories section */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
              {localized.existingCategories}
            </h3>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                <div className="col-span-3">{localized.categoryName}</div>
                <div className="col-span-7">{localized.color}</div>
                <div className="col-span-2 text-center">{localized.actions}</div>
              </div>

              {filteredCategories.map((category) => (
                <div
                  key={category}
                  className="grid grid-cols-12 gap-4 items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  {editingCategory === category ? (
                    <>
                      <div className="col-span-10">
                        <input
                          type="text"
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          className="w-full bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                          onKeyPress={(e) => {
                            if (e.key === "Enter") handleSaveEdit();
                            if (e.key === "Escape") handleCancelEdit();
                          }}
                          autoFocus
                        />
                      </div>
                      <div className="col-span-2 flex gap-1 justify-center">
                        <button
                          onClick={handleSaveEdit}
                          disabled={
                            !editingCategoryName.trim() ||
                            editingCategoryName.trim() === editingCategory ||
                            categories.includes(editingCategoryName.trim())
                          }
                          className="px-2 py-1 text-white bg-green-600 hover:bg-green-700 rounded text-sm disabled:opacity-50"
                        >
                          ✓
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-2 py-1 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="col-span-3">
                        <span className="text-gray-900 dark:text-white font-medium truncate block">
                          {category}
                        </span>
                      </div>
                      <div className="col-span-7">
                        <div className="flex gap-1 flex-wrap">
                          {colorOptions.map((color) => (
                            <button
                              key={color.name}
                              onClick={() =>
                                dispatch(setCategoryColor({ category, color: color.name.toLowerCase() }))
                              }
                              className={`w-6 h-6 rounded-full border-2 ${
                                (categoryColors[category] || "blue") === color.name.toLowerCase()
                                  ? "border-gray-400 dark:border-gray-300"
                                  : "border-gray-200 dark:border-gray-600"
                              } ${color.bg}`}
                              title={localized.setCategoryColorTooltip.replace('{{category}}', category).replace('{{color}}', color.name)}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="col-span-2 flex gap-1 justify-center">
                        <button
                          onClick={() => handleStartEdit(category)}
                          className="p-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          title={localized.renameCategoryTooltip}
                        >
                          <FontAwesomeIcon icon={faEdit} />
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(category)}
                          className="p-2 text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                          title={localized.deleteCategoryTooltip}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {filteredCategories.length === 0 && (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  {localized.noCategoriesFound}
                </p>
              )}
            </div>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <button
          onClick={onClose}
          className="text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 focus:ring-4 focus:ring-gray-300 dark:focus:ring-gray-700 font-medium rounded-lg text-sm px-5 py-2.5"
        >
          {localized.close}
        </button>
      </Modal.Footer>
    </Modal>
  );
});

export default EditCategoriesModal;
