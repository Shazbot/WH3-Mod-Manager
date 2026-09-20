These files are helper tools used by WH3 Mod Manager.

## WH3AssetHost.exe

WH3AssetHost is a helper application used by WH3 Mod Manager for the 3D model preview feature.

It reads Total War: WARHAMMER III game/mod asset files and converts the required models, textures, skeletons and animations into a format that the mod manager can display.

It is launched automatically by WH3 Mod Manager when needed and is not intended to be run manually.

WH3AssetHost is built from The Asset Editor project:
https://github.com/Shazbot/TheAssetEditor

## Why is this .exe file here?

WH3AssetHost.exe is bundled with WH3 Mod Manager because the 3D model preview feature needs a native helper to process Total War game assets.

It is not a standalone installer, background service, advertisement, or telemetry program.

If you downloaded WH3 Mod Manager from its official release page, this file is an expected component of the application.

WH3 Mod Manager:
https://github.com/Shazbot/WH3-Mod-Manager


## texconv.exe

The unit painter uses Microsoft's DirectXTex texconv utility to encode edited
textures back to DDS while preserving the source WH3 texture format and mip
count.

texconv is distributed with the WH3AssetHost publish output and is launched
only when exporting a painted unit variant.

DirectXTex:
https://github.com/microsoft/DirectXTex

The bundled texconv build is from the pinned May 2026 DirectXTex release.
DirectXTex is licensed under the MIT License; the redistributed license is
included as DirectXTex-LICENSE.txt.

When updating WH3AssetHost in this directory, copy the complete publish output
rather than WH3AssetHost.exe by itself so texconv.exe and its license remain
beside the host executable.
