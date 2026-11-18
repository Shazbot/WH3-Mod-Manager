import * as crypto from "crypto";
import * as fs from "fs";
import * as nodePath from "path";
import { toWinePath } from "./nativePatches/launch";

const DLL_NAME = "WH3LuaSocketLate.dll";

export const luaSocketDllResourcePath = () => {
  const packaged = nodePath.join(process.resourcesPath, "luaSocket", DLL_NAME);
  if (fs.existsSync(packaged)) return packaged;
  return nodePath.resolve(__dirname, "../../tools/luaSocket", DLL_NAME);
};

/** Copies the DLL to <appData>/luaSocket/<hash>/; the game pins loaded DLLs, so versions never overwrite each other. */
export const ensureLuaSocketDll = (appDataPath: string, sourcePath: string): string => {
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`LuaSocket DLL is missing: ${sourcePath}`);
  }
  const source = fs.readFileSync(sourcePath);
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  const targetDirectory = nodePath.join(appDataPath, "luaSocket", sourceHash.slice(0, 16));
  fs.mkdirSync(targetDirectory, { recursive: true });
  const targetPath = nodePath.join(targetDirectory, DLL_NAME);
  let existingHash: string | undefined;
  if (fs.existsSync(targetPath))
    existingHash = crypto.createHash("sha256").update(fs.readFileSync(targetPath)).digest("hex");
  if (existingHash !== sourceHash) fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
};

const toLuaString = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const luaSocketLoaderScript = (dllPath: string, platform: NodeJS.Platform = process.platform) => {
  const gamePath = platform === "linux" ? toWinePath(dllPath) : dllPath;
  return `-- WHMM normal-mod loader: delayed native load on WH3's own Lua thread.
if rawget(_G,'__wh3_socket_late_loader') then return end
local environment=getfenv(1)
local dll_path=${toLuaString(gamePath)}
local timer='wh3_socket_late_attach_v1'
local state={dll_path=dll_path,phase='waiting for UI'}
_G.__wh3_socket_late_loader=state
local function attach()
    state.phase='loading'
    local entry,err=package.loadlib(dll_path,'luaopen_wh3_socket_late')
    if type(entry)~='function' then
        state.phase='failed';state.error=tostring(err)
        out('WH3 late socket loader: '..state.error)
        return
    end
    local ok,result=pcall(entry,environment)
    if not ok or type(result)~='table' then
        state.phase='failed';state.error=tostring(result or 'native host/build guard rejected initialization')
        out('WH3 late socket loader: '..state.error)
        return
    end
    state.phase='loaded';state.native=result
    out('WH3 late socket loader: loaded external DLL on Lua thread '..tostring(result.lua_thread_id))
end
local armed=false
local function arm()
    if armed then return end
    armed=true;state.phase='delayed load scheduled'
    core:add_listener(timer,'RealTimeTrigger',function(context) return context.string==timer end,attach,false)
    real_timer.register_singleshot(timer,5000)
end
core:add_ui_created_callback(arm)
if core:is_battle() or core.ui_is_created then arm() end
`;
};
