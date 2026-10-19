# Native patch exporters

These tools generate pack-ready files under the ignored `native-patches/`
directory. They read the preserved original EXE and upstream feature code;
they do not install patches or modify game files.

```sh
python3 -B tools/nativePatchPackages/export.py
python3 -B tools/nativePatchPackages/export_logging.py
```

The first command exports the independent projectile-casting and officer-death
packages. The second exports the v7d native logging package, using the existing
`data/wh3_native_logging.pack` as its companion. Enable that pack with the native
logging manifest. The Lua asset requirement checks its decoded bootstrap bytes.

Defaults point to this workspace's supplied WH3 project/game files. See `--help`
for alternate source, original, companion, dependency and output paths. The logging
export also reads the hash-verified v7d reference executable to compare the emitted
backend with its previously validated code; it does not execute that image.

Both exporters use Python Capstone and Keystone. Logging also uses GCC and GNU
binutils with the upstream compiler settings. The analysis libraries are needed
only while exporting. `--analysis-deps` selects their import directory. Logging
checks the original temporary analysis directory, then the workspace cache.

Only the generated `.wh3patch.json` files belong under `whmm_patches/` in a mod
pack. Payloads are embedded. Companion Lua content continues through normal pack
loading. Runtime packages use format v2 signatures/relative references and retain
exact expected-byte checks; future game versions can still require an update.

Exporter defaults use `on_failure: "warn"` for casting and officer death, and `on_failure: "silent"` for native logging. These packages require loader 2.1.0.
