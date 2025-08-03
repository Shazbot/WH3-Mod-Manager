import React, { useState, useEffect } from "react";
import { Modal } from "../flowbite";
import { useAppSelector } from "../hooks";
import { useLocalizations } from "../localizationContext";

interface RenameModalProps {
  show: boolean;
  onClose: () => void;
  mod: Mod;
}

interface PreviewItem {
  originalName: string;
  newName: string;
}

const RenameModal: React.FC<RenameModalProps> = ({ show, onClose, mod }) => {
  const [searchRegex, setSearchRegex] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [previewData, setPreviewData] = useState<PreviewItem[]>([]);
  const [regexError, setRegexError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  
  const isDev = useAppSelector((state) => state.app.isDev);
  const localizations = useLocalizations();

  // Helper function to extract the base filename from a packed file path
  const getBaseFilename = (filePath: string): string => {
    const parts = filePath.split("\\");
    return parts[parts.length - 1];
  };

  // Helper function to replace the base filename in a packed file path
  const replaceBaseFilename = (filePath: string, newBasename: string): string => {
    const parts = filePath.split("\\");
    parts[parts.length - 1] = newBasename;
    return parts.join("\\");
  };

  const generatePreview = () => {
    try {
      if (!searchRegex) {
        setPreviewData([]);
        setRegexError("");
        return;
      }

      let regex: RegExp | null = null;
      if (useRegex) {
        regex = new RegExp(searchRegex, "g");
      }
      setRegexError("");

      // Get pack files to preview
      window.api?.getPackFilesList(mod.path).then((files: string[]) => {
        const preview: PreviewItem[] = [];
        
        for (const fileName of files) {
          // Check path filter first (if provided)
          if (pathFilter.trim()) {
            const filePath = fileName.substring(0, fileName.lastIndexOf("\\"));
            if (!filePath.includes(pathFilter.trim())) {
              continue; // Skip files that don't match path filter
            }
          }

          const baseFilename = getBaseFilename(fileName);
          let newBaseFilename: string;
          let shouldInclude = false;

          if (useRegex && regex) {
            // Reset regex lastIndex for each iteration
            regex.lastIndex = 0;
            if (regex.test(baseFilename)) {
              regex.lastIndex = 0;
              newBaseFilename = baseFilename.replace(regex, replaceText);
              shouldInclude = newBaseFilename !== baseFilename;
            }
          } else {
            // Simple string replacement
            if (baseFilename.includes(searchRegex)) {
              newBaseFilename = baseFilename.replace(new RegExp(escapeRegExp(searchRegex), "g"), replaceText);
              shouldInclude = newBaseFilename !== baseFilename;
            }
          }

          if (shouldInclude) {
            const newFileName = replaceBaseFilename(fileName, newBaseFilename!);
            preview.push({
              originalName: fileName,
              newName: newFileName
            });
          }
        }
        
        setPreviewData(preview);
      }).catch((error: any) => {
        console.error("Failed to get pack files list:", error);
        setPreviewData([]);
      });

    } catch (error) {
      if (useRegex) {
        setRegexError(localizations.invalidRegularExpression);
      }
      setPreviewData([]);
    }
  };

  // Helper function to escape special regex characters for literal string matching
  const escapeRegExp = (string: string): string => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  const handleRename = async () => {
    if (!searchRegex) return;
    if (!isDev && previewData.length === 0) return;

    setIsRenaming(true);
    try {
      await window.api?.renamePackedFiles(mod.path, searchRegex, replaceText, useRegex, isDev, pathFilter);
      
      // Refresh the mod data or show success message
      console.log("Rename operation completed successfully");
      onClose();
    } catch (error) {
      console.error("Rename operation failed:", error);
      // Show error message to user
    } finally {
      setIsRenaming(false);
    }
  };

  useEffect(() => {
    if (show) {
      // Reset form when modal opens
      setSearchRegex("");
      setReplaceText("");
      setPathFilter("");
      setPreviewData([]);
      setRegexError("");
      setUseRegex(false);
    }
  }, [show]);

  useEffect(() => {
    // Debounce the preview generation
    const timer = setTimeout(() => {
      generatePreview();
    }, 300);

    return () => clearTimeout(timer);
  }, [searchRegex, replaceText, pathFilter, useRegex, mod.path]);

  return (
    <Modal
      show={show}
      onClose={onClose}
      size="4xl"
      position="center"
    >
      <Modal.Header>
        {localizations.renamePackFiles} - {mod.name}
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <input
              type="checkbox"
              id="useRegex"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="useRegex" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {localizations.useRegularExpression}
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {useRegex ? localizations.searchPatternRegex : localizations.searchText}
            </label>
            <input
              type="text"
              value={searchRegex}
              onChange={(e) => setSearchRegex(e.target.value)}
              placeholder={useRegex ? localizations.searchPatternPlaceholderRegex : localizations.searchTextPlaceholder}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            />
            {regexError && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{localizations.invalidRegularExpression}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {localizations.replaceWith}
            </label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder={useRegex ? localizations.replaceWithPlaceholderRegex : localizations.replaceWithPlaceholder}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {localizations.pathFilterOptional}
            </label>
            <input
              type="text"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder={localizations.pathFilterPlaceholder}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {localizations.pathFilterDescription}
            </p>
          </div>

          <div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-3">
              {localizations.preview} ({localizations.filesWillBeRenamed.replace('{{count}}', previewData.length.toString())})
            </h3>
            
            {previewData.length > 0 ? (
              <div className="max-h-60 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-lg">
                <div className="space-y-2 p-3">
                  {previewData.map((item, index) => {
                    const originalParts = item.originalName.split("\\");
                    const newParts = item.newName.split("\\");
                    const originalPath = originalParts.slice(0, -1).join("\\");
                    const originalFilename = originalParts[originalParts.length - 1];
                    const newPath = newParts.slice(0, -1).join("\\");
                    const newFilename = newParts[newParts.length - 1];
                    
                    return (
                      <div key={index} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 space-y-1">
                        <div className="font-mono text-xs">
                          <span className="text-gray-500 dark:text-gray-400 text-xs font-semibold">{localizations.from}</span>
                          <div className="ml-2">
                            {originalPath && (
                              <span className="text-gray-400 dark:text-gray-500">
                                {originalPath}\
                              </span>
                            )}
                            <span className="text-gray-900 dark:text-white font-medium">
                              {originalFilename}
                            </span>
                          </div>
                        </div>
                        <div className="font-mono text-xs">
                          <span className="text-gray-500 dark:text-gray-400 text-xs font-semibold">{localizations.to}</span>
                          <div className="ml-2">
                            {newPath && (
                              <span className="text-gray-400 dark:text-gray-500">
                                {newPath}\
                              </span>
                            )}
                            <span className="text-green-600 dark:text-green-400 font-medium">
                              {newFilename}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                {searchRegex ? localizations.noFilesMatch : localizations.enterSearchPattern}
              </div>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-500 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:ring-4 focus:ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700 dark:focus:ring-gray-700"
          >
            {localizations.cancel}
          </button>
          <button
            onClick={handleRename}
            disabled={!searchRegex || isRenaming || !!regexError || (!isDev && previewData.length === 0)}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          >
            {isRenaming ? localizations.renaming : previewData.length > 0 ? localizations.renameNFiles.replace('{{count}}', previewData.length.toString()) : isDev ? localizations.testRename : localizations.noFilesToRename}
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default RenameModal;