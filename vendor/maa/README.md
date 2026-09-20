# Vendored MaaFramework

The `android/arm64-v8a` directory contains unmodified official MaaFramework
runtime libraries for Android arm64, downloaded by `scripts/fetch-maafw.sh`.
The binaries are not committed to git; run the script to populate the directory.
A `.maafw-version` marker records the requested release so changing the pin
refreshes an existing checkout.
MaaFramework is distributed under the GNU Lesser General Public License version
3; see `MAA-LICENSE.md`.

MaaTauriAndroid links to these libraries as a runtime dependency and does not include
MaaFramework application source or assets in this directory.

`libMaaAgentClient.so` is required for the Project Interface agent support: the
`MaaAgentClient*` entry points live in that library rather than in `libMaaFramework.so`,
and the Rust `maa-framework` bindings load it from the same directory as
`libMaaFramework.so` (see `CompositeLibrary` in `maa-framework-sys`). It must stay
next to `libMaaFramework.so` or `AgentClient` lookups fail at runtime.

`libMaaAgentServer.so` deliberately lives in the agent runtime bundle
(`resource/m9a-agent-runtime-arm64-v8a.zip`) instead, because only the Python agent
child process links against it; see `src-tauri/profiles/README.md`.
