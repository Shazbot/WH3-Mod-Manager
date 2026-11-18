These files are helper tools used by WH3 Mod Manager.

## WH3LuaSocketLate.dll

WH3LuaSocketLate.dll is an optional LuaSocket (TCP) host for Total War: WARHAMMER III scripting. It is only used when a game is launched with the --lua-socket option (CLI) or options.luaSocket (MCP game_launch). It is never loaded otherwise.

WH3 Mod Manager copies it to <appData>/luaSocket/<hash>/ and generates a small Lua loader inside the temporary start-game pack. The loader calls package.loadlib(path, "luaopen_wh3_socket_late") about 5 seconds after the UI is created, on the game's own Lua thread.

Listening ports (localhost): frontend 23456, campaign 23457, battle 23458.

SHA256: ed7a99cf09959d7e247cccaeadd79bc61c3b1469981c7584f232daf2e392a319
Source: K:\tools\WH3LuaSocketLate\v1\ (built from the luasocket_late project; includes LuaSocket and Lua code, see LUASOCKET-LICENSE and LUA-LICENSE).

## Why is this .dll file here?

The game pins a loaded DLL until the process exits, so WHMM keeps each version in its own hash-named folder. It is not an installer, background service, advertisement, or telemetry component.

WH3 Mod Manager:
https://github.com/Shazbot/WH3-Mod-Manager
