# Project Interface profiles

Android builds can embed a MaaFramework Project Interface without moving it into this repository. Point `src-tauri/gen/android/local.properties` at a TOML profile:

```properties
pi.profile=/absolute/path/to/your-pi-profile.toml
```

`pi.profile` is read from a Gradle property (`-Ppi.profile`), then `local.properties`, then the `PI_PROFILE` environment variable. `pi_assets` must be the directory containing `interface.json`. The build syncs the selected files, packs them as `assets/pi.zip`, and the Android runtime unpacks that archive to app-private storage before Tauri starts.

The TOML profile uses snake_case keys (`pi_assets`, `pi_include`, `resource_id`, and `maa_dir`). Relative `pi_assets` and `bundle` paths resolve from the profile directory; relative `maa_dir` paths resolve from the repository root. The default pack list contains `interface.json`, common resource directories, configuration, data, locale, and `CONTACT`/`LICENSE`. If the project keeps assets elsewhere, replace `pi_include` with the required patterns. Resource paths declared by `interface.json` are resolved from the unpacked Project Interface root at runtime.

When `interface.json` declares `agent`, configure the matching number of `[[agent.runtimes]]` entries — the build fails when the declared and configured counts differ. Each entry requires a local `bundle`, the executable, the explicit list of files to mark executable, and the server command. Use `{pi}`, `{bundle}`, `{identifier}`, and `{nativeLib}` placeholders in paths, arguments, and environment values. The bundle is a ZIP archive: it may not contain symlinks, must stay below the ZIP64 threshold, and must ship `lib/arm64-v8a/libMaaAgentClient.so` and `lib/arm64-v8a/libMaaAgentServer.so`.

For agent-server runtimes, set `MAAFW_BINARY_PATH` to the bundle library directory (`{bundle}/lib/arm64-v8a`). The Python binding joins that directory with `libMaaAgentServer.so`; `{nativeLib}` intentionally omits that library because only the child agent process needs it.

Changing the profile changes the packaged APK; it is build-time embedding, not a runtime switch. Remove or clear `pi.profile` to return to the built-in fixture in `src-tauri/fixtures/pi/minimal`.

## In-repo profiles

When the Project Interface is a submodule of this repository, keep the profile next to it and use relative paths — the same profile then works on every checkout. M9A is set up this way:

- `resource/m9a` — submodule of <https://github.com/MAA1999/M9A.git> tracking `main`, plus its nested `MaaCommonAssets` submodule (OCR models).
- `resource/m9a.toml` — profile for it, translated from M9A's own `Android/profile.yaml` (`feat/support-android-app` branch).
- `resource/m9a-agent-runtime-arm64-v8a.zip` — the Python agent runtime. It is a build artifact and is not committed because CI rebuilds it on every run.

Point a checkout at it with `pi.profile=<repo>/resource/m9a.toml`.

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
scripts/build-agent-runtime.sh  # Python agent runtime ZIP
python3 resource/m9a/tools/configure.py  # generate OCR model symlinks
```

`pack_agent_bundle.py` is the only supported way to build the archive: it dereferences symlinks, keeps the result below the ZIP64 threshold, and verifies that `lib/arm64-v8a/libMaaAgentClient.so` and `libMaaAgentServer.so` are present.

Keep the MaaFramework version of `libMaaAgentClient.so`/`libMaaAgentServer.so` aligned with the libraries vendored in `vendor/maa/android`.

The M9A job in `.github/workflows/ci.yml` performs this workflow and then builds the release APK.

> Note: `MaaAgentCoreAndroid` currently ships `maafw 5.12.3`, while `vendor/maa/android` vendors `v5.13.0-beta.5`. The bundle build drops the pinned `maafw` from `requirements.txt` in favour of the core's copy. If the agent handshake ever fails on device, align the two.
