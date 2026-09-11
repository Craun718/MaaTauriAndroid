# Project Interface profiles

Android builds can embed a MaaFramework Project Interface without moving it into this repository. Point `src-tauri/gen/android/local.properties` at a TOML profile:

```properties
pi.profile=/absolute/path/to/your-pi-profile.toml
```

`pi.profile` is read from a Gradle property (`-Ppi.profile`), then `local.properties`, then the `PI_PROFILE` environment variable. `pi_assets` must be the directory containing `interface.json`. The build syncs the selected files, packs them as `assets/pi.zip`, and the Android runtime unpacks that archive to app-private storage before Tauri starts.

The TOML profile uses snake_case keys (`pi_assets`, `pi_include`, `resource_id`, and `maa_dir`). Relative `pi_assets` and `bundle` paths resolve from the profile directory; relative `maa_dir` paths resolve from the repository root. The default pack list contains `interface.json`, common resource directories, configuration, data, locale, and `CONTACT`/`LICENSE`. If the project keeps assets elsewhere, replace `pi_include` with the required patterns. Resource paths declared by `interface.json` are resolved from the unpacked Project Interface root at runtime.

When `interface.json` declares `agent`, configure the matching number of `[[agent.runtimes]]` entries — the build fails when the declared and configured counts differ. Each entry requires a local `bundle`, the executable, the explicit list of files to mark executable, and the server command. `bundle_sha256` is an optional pin: when set, the build refuses to package an archive whose digest differs; when omitted, the build records the archive's actual digest in the agent descriptor instead, and that recorded digest is what the on-device runtime verifies the packaged bundle against. Use `{pi}`, `{bundle}`, `{identifier}`, and `{nativeLib}` placeholders in paths, arguments, and environment values. The bundle is a ZIP archive: it may not contain symlinks, must stay below the ZIP64 threshold, and must ship `lib/arm64-v8a/libMaaAgentClient.so` and `lib/arm64-v8a/libMaaAgentServer.so`.

Changing the profile changes the packaged APK; it is build-time embedding, not a runtime switch. Remove or clear `pi.profile` to return to the built-in fixture in `src-tauri/fixtures/pi/minimal`.

## In-repo profiles

When the Project Interface is a submodule of this repository, keep the profile next to it and use relative paths — the same profile then works on every checkout. M9A is set up this way:

- `resource/m9a` — submodule of <https://github.com/MAA1999/M9A.git> tracking `main`, plus its nested `MaaCommonAssets` submodule (OCR models).
- `resource/m9a.toml` — profile for it, translated from M9A's own `Android/profile.yaml` (`feat/support-android-app` branch).
- `resource/m9a-agent-runtime-arm64-v8a.zip` — the Python agent runtime. It is a build artifact and is not committed; the profile leaves `bundle_sha256` unset because CI rebuilds it on every run.

Point a checkout at it with `pi.profile=<repo>/resource/m9a.toml`.

### Agent runtime

The runtime ZIP is produced by `build_agent_bundle.py` from [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp), which layers M9A's dependencies onto a prebuilt Android CPython core from [MaaAgentCoreAndroid](https://github.com/Aliothmoon/MaaAgentCoreAndroid):

```bash
# 1. lay out the PI: submodule + OCR models
git submodule update --init --recursive
python3 resource/m9a/tools/configure.py

# 2. build the agent runtime
cd /path/to/MaaFwApp
python3 scripts/build_agent_bundle.py \
  --out <repo>/resource/m9a-agent-dist \
  --abi arm64-v8a \
  --requirements <repo>/resource/m9a/requirements.txt \
  --exclude pillow --require pillow==11.0.0 \
  --extra-index-url https://chaquo.com/pypi-13.1/

# 3. copy libMaaAgentClient.so and libMaaAgentServer.so out of the MaaFramework
#    Android release, then pack the bundle (no symlinks, no ZIP64)
unzip -j MAA-android-aarch64-<tag>.zip \
  'bin/libMaaAgentClient.so' 'bin/libMaaAgentServer.so' -d /tmp/maafw-agent-libs
python3 src-tauri/profiles/pack_agent_bundle.py \
  resource/m9a-agent-dist/arm64-v8a/bundle \
  /tmp/maafw-agent-libs \
  resource/m9a-agent-runtime-arm64-v8a.zip

# 4. optional: pin the archive with bundle_sha256 in resource/m9a.toml
shasum -a 256 resource/m9a-agent-runtime-arm64-v8a.zip
```

`pack_agent_bundle.py` is the only supported way to build the archive: it dereferences symlinks, keeps the result below the ZIP64 threshold, verifies that `lib/arm64-v8a/libMaaAgentClient.so` and `libMaaAgentServer.so` are present, and prints the digest.

The `bundle_sha256` in `resource/m9a.toml` is deliberately left unset: CI rebuilds the runtime on every run and the archive bytes are not reproducible across machines, so a pin would fail the build. The build records the digest it packaged into `runtime.json`, and the on-device runtime verifies the packaged bundle against that. Set the field when a hand-built runtime must stay byte-identical. Keep the MaaFramework version of `libMaaAgentClient.so`/`libMaaAgentServer.so` aligned with the libraries vendored in `vendor/maa/android`.

The M9A job in `.github/workflows/ci.yml` performs this workflow and then builds the release APK.

> Note: `MaaAgentCoreAndroid` currently ships `maafw 5.12.3`, while `vendor/maa/android` vendors `v5.13.0-beta.5`. The bundle build drops the pinned `maafw` from `requirements.txt` in favour of the core's copy. If the agent handshake ever fails on device, align the two.
