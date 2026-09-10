# Project Interface profiles

Android builds can embed an external MaaFramework Project Interface without moving it into this repository. Copy `pi-profile.sample.toml` outside the repository, update its paths, and point `src-tauri/gen/android/local.properties` at the profile:

```properties
pi.profile=/absolute/path/to/your-pi-profile.toml
```

`pi.assets` must be the directory containing `interface.json`. Relative asset paths resolve against the profile file. The build syncs the selected files, packs them as `assets/pi.zip`, and the Android runtime unpacks that archive to app-private storage before Tauri starts.

The TOML profile uses snake_case keys (`pi_assets`, `pi_include`, `resource_id`, and `maa_dir`). The default pack list contains `interface.json`, common resource directories, configuration, data, locale, and `CONTACT`/`LICENSE`. If the project keeps assets elsewhere, replace `pi_include` with the required patterns. Resource paths declared by `interface.json` are resolved from the unpacked Project Interface root at runtime.

Changing the profile changes the packaged APK; it is build-time embedding, not a runtime resource switch. Remove or clear `pi.profile` to return to the built-in fixture.
