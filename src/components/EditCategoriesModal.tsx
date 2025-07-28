import React, { memo, useContext, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks";
import { Modal } from "../flowbite/components/Modal/index";
import { addCategory, removeCategory, renameCategory } from "../appSlice";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faEdit, faPlus } from "@fortawesome/free-solid-svg-icons";
import localizationContext from "../localizationContext";

interface EditCategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const EditCategoriesModal = memo(({ isOpen, onClose }: EditCategoriesModalProps) => {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((state) => state.app.categories);
  const mods = useAppSelector((state) => state.app.currentPreset.mods);
  const localized: Record<string, string> = useContext(localizationContext);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const handleAddCategory = () => {
    if (newCategoryName.trim() && !categories.includes(newCategoryName.trim())) {
      dispatch(addCategory({ category: newCategoryName.trim(), mods: [] }));
      setNewCategoryName("");
    }
  };

  const handleDeleteCategory = (category: string) => {
    const modsInCategory = mods.filter((mod) => 
      mod.categories && mod.categories.includes(category)
    );
    dispatch(removeCategory({ category, mods: modsInCategory }));
  };

  const handleStartEdit = (category: string) => {
    setEditingCategory(category);
    setEditingCategoryName(category);
  };

  const handleSaveEdit = () => {
    if (editingCategory && editingCategoryName.trim() && 
        editingCategoryName.trim() !== editingCategory &&
        !categories.includes(editingCategoryName.trim())) {
      dispatch(renameCategory({ 
        oldCategory: editingCategory, 
        newCategory: editingCategoryName.trim() 
      }));
    }
    setEditingCategory(null);
    setEditingCategoryName("");
  };

  const handleCancelEdit = () => {
    setEditingCategory(null);
    setEditingCategoryName("");
  };

  const filteredCategories = categories.filter(cat => cat !== "Uncategorized");

  return (
    <Modal show={isOpen} onClose={onClose}>
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
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredCategories.map((category) => (
                <div
                  key={category}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  {editingCategory === category ? (
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        value={editingCategoryName}
                        onChange={(e) => setEditingCategoryName(e.target.value)}
                        className="flex-1 bg-white dark:bg-gray-600 border border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                        onKeyPress={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        autoFocus
                      />
                      <button
                        onClick={handleSaveEdit}
                        disabled={!editingCategoryName.trim() || 
                                editingCategoryName.trim() === editingCategory ||
                                categories.includes(editingCategoryName.trim())}
                        className="px-3 py-2 text-white bg-green-600 hover:bg-green-700 rounded-lg text-sm disabled:opacity-50"
                      >
                        {localized.save}
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-lg text-sm"
                      >
                        {localized.cancel}
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-gray-900 dark:text-white font-medium">
                        {category}
                      </span>
                      <div className="flex gap-2">
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