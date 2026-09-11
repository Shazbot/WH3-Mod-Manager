import Registry from "winreg";

export const WINDOWS_DEVELOPER_MODE_REGISTRY_KEY = "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock";
export const WINDOWS_DEVELOPER_MODE_REGISTRY_VALUE = "AllowDevelopmentWithoutDevLicense";

type RegistryValue = { name: string; value: string };
type RegistryValueReader = () => Promise<RegistryValue[]>;

const readDeveloperModeRegistryValues: RegistryValueReader = () =>
  new Promise((resolve, reject) => {
    const key = new Registry({ hive: Registry.HKLM, key: WINDOWS_DEVELOPER_MODE_REGISTRY_KEY });
    key.values((error, values) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(values);
    });
  });

export const isWindowsDeveloperModeEnabled = async (
  platform = process.platform,
  readValues: RegistryValueReader = readDeveloperModeRegistryValues,
): Promise<boolean> => {
  if (platform !== "win32") return true;
  try {
    const value = (await readValues()).find((item) => item.name === WINDOWS_DEVELOPER_MODE_REGISTRY_VALUE);
    return value?.value === "1" || value?.value?.toLowerCase() === "0x1";
  } catch {
    return false;
  }
};
