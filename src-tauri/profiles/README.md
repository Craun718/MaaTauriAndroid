# Project Interface profiles

Android builds can embed a MaaFramework Project Interface without moving it into this repository. Point `src-tauri/gen/android/local.properties` at a TOML profile:

```properties
pi.profile=/absolute/path/to/your-pi-profile.toml
```

`pi.profile` is read from a Gradle property (`-Ppi.profile`), then `local.properties`, then the `PI_PROFILE` environment variable. `pi_assets` must be the directory containing `interface.json`. The build resolves the pack set from that interface, packs it as `assets/pi.zip`, and the Android runtime unpacks that archive to app-private storage before Tauri starts.

The TOML profile uses snake_case keys (`pi_assets`, `resource_id`, `app_name`, and `maa_dir`). Relative `pi_assets` and `bundle` paths resolve from the profile directory; relative `maa_dir` paths resolve from the repository root. The optional `app_name` sets the Android launcher and activity title; when omitted, the build uses `MaaTauriAndroid`.

### Pack set is derived, not listed

The base set is never listed. `PiPackage` reads `interface.json` and follows the protocol's own references:

| Source | Packed |
| ------ | ------ |
| `resource[].path`, `controller[].attach_resource_path` | load roots, recursively |
| `import[]` | the task/option/preset files, read to reach nested icons |
| `languages{}` | the declared translation files |
| `icon` / `contact` / `license` / `description` / `doc` / `desc` / `welcome`, at any depth and in every imported file | the file when the value names one, including `$Key` lookups and markdown image links |
| `agent` (object or array) | the `agent` directory holding the `child_args` entrypoint |
| — | `data/`, which the Agent reads without the protocol declaring it |

A path the interface declares but the project lacks **fails the build**, because that is exactly how a silent mis-pack ships. M9A v4.9.0 renamed `i18n/` to `locales/`; the old allow-list matched nothing, the build stayed green, and the APK shipped an interface pointing at translation files absent from its own archive — a hard project-load failure on device.

`pi_include` still exists, but its meaning changed: it now lists **extra** project-relative paths to pack on top of the derived set, for assets that live outside the interface and that no protocol key reaches (a tool-shipped `data/` sibling, a hand-written guide, a bundled dictionary). It can never remove anything, and a listed path that does not exist fails the build like any other declared path. `pi_exclude` is rejected outright — the derived set cannot be pruned, so an entry there would only be a filter that silently does nothing.

Values documented as "file path, URL or plain text" are only treated as paths when they resolve, so prose and remote URLs are left alone. Absolute paths and `..` escapes are ignored. Development leftovers (`__pycache__`, `.git`, `node_modules`, `.venv`, `*.pyc`/`*.pyo`) are filtered out of the copy.

`CONTACT` and `LICENSE` are packaged when `interface.json` names them, which it does through `contact`/`license`; the M9A profile needs no entry for either.

When `interface.json` declares `agent`, configure the matching number of `[[agent.runtimes]]` entries — the build fails when the declared and configured counts differ. Each entry requires a local `bundle`, the executable, the explicit list of files to mark executable, and the server command. Use `{pi}`, `{bundle}`, `{identifier}`, and `{nativeLib}` placeholders in paths, arguments, and environment values. The bundle is a ZIP archive: it may not contain symlinks, must stay below the ZIP64 threshold, and must ship `lib/arm64-v8a/libMaaAgentClient.so` and `lib/arm64-v8a/libMaaAgentServer.so`.

For agent-server runtimes, set `MAAFW_BINARY_PATH` to the bundle library directory (`{bundle}/lib/arm64-v8a`). The Python binding joins that directory with `libMaaAgentServer.so`; `{nativeLib}` intentionally omits that library because only the child agent process needs it.

Changing the profile changes the packaged APK; it is build-time embedding, not a runtime switch. Remove or clear `pi.profile` to return to the built-in fixture in `src-tauri/fixtures/pi/minimal`.

## In-repo profiles

When the Project Interface is a submodule of this repository, keep the profile next to it and use relative paths — the same profile then works on every checkout. M9A, NarutoMobile, and MAAPVZ are set up this way:

- `resource/m9a` — submodule of <https://github.com/MAA1999/M9A.git> tracking `main`, plus its nested `MaaCommonAssets` submodule (OCR models).
- `resource/m9a.toml` — profile for it, translated from M9A's own `Android/profile.yaml` (`feat/support-android-app` branch).
- `resource/m9a-agent-runtime-arm64-v8a.zip` — the Python agent runtime. It is a build artifact and is not committed because CI rebuilds it on every run.
- `resource/narutomobile` — submodule of <https://github.com/duorua/narutomobile.git> tracking `main`.
- `resource/narutomobile.toml` — profile for it. Its `interface.json` lives in `assets/` and its agent in the repository root, so `scripts/prepare-narutomobile-pi.sh` first assembles the upstream `Android/pi-root/` tree.
- `resource/narutomobile-agent-runtime-arm64-v8a.zip` — the Python agent runtime. It is a build artifact and is not committed because CI rebuilds it on every run.
- `resource/maapvz` — submodule of <https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ.git> tracking `main`, plus its nested `MaaCommonAssets` submodule.
- `resource/maapvz.toml` — profile for it. As with NarutoMobile, `scripts/prepare-maapvz-pi.sh` first assembles `Android/pi-root/` from `assets/` and the root agent.
- `resource/maapvz-agent-runtime-arm64-v8a.zip` — the Python agent runtime. It is a build artifact and is not committed because CI rebuilds it on every run.

Point a checkout at one of them with `pi.profile=<repo>/resource/m9a.toml`, `pi.profile=<repo>/resource/narutomobile.toml`, or `pi.profile=<repo>/resource/maapvz.toml`.

### Agent runtime

The runtime ZIP is produced by `scripts/build-agent-runtime.sh`, which wraps
`build_agent_bundle.py` from [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp).
Run the full setup with:

```bash
scripts/setup.sh
```

Or run the individual steps:

```bash
scripts/fetch-submodules.sh     # M9A + MaaCommonAssets
scripts/fetch-maafw.sh          # MaaFramework Android binaries → vendor/maa/android/
scripts/build-agent-runtime.sh m9a           # M9A Python agent runtime ZIP
scripts/build-agent-runtime.sh narutomobile  # NarutoMobile Python agent runtime ZIP
scripts/prepare-maapvz-pi.sh                # assemble MAAPVZ's PI root
scripts/build-agent-runtime.sh maapvz       # MAAPVZ Python agent runtime ZIP
python3 resource/m9a/tools/configure.py  # generate OCR model symlinks
scripts/prepare-narutomobile-pi.sh       # assemble NarutoMobile's PI root
```

`pack_agent_bundle.py` is the only supported way to build the archive: it dereferences symlinks, keeps the result below the ZIP64 threshold, and verifies that `lib/arm64-v8a/libMaaAgentClient.so` and `libMaaAgentServer.so` are present.

Keep the MaaFramework version of `libMaaAgentClient.so`/`libMaaAgentServer.so` aligned with the libraries vendored in `vendor/maa/android`.

The M9A, NarutoMobile, and MAAPVZ jobs in `.github/workflows/ci.yml` perform this workflow and then build the release APK.

> Note: native libraries are pinned to MaaFramework `v5.13.0` by `MAAFW_VERSION`; our fork `Craun718/MaaAgentCoreAndroid` is pinned to `3.13.15-maafw5.13.0` by `MAAFW_CORE_REPO` and `MAAFW_CORE_TAG`, so the bundle's Python `maa` package stays at 5.13.0 — the core's copy wins over the `maafw` pin in `requirements.txt`. The Python agent talks to the native agent libraries over the AgentClient/Server IPC protocol, which stays compatible across patch releases.
