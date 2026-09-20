import { defineConfig } from "lint-staged/config";

export default defineConfig({
  // `tsc` rejects individual filepaths, so the type check runs once for the
  // whole project. `pnpm test` also runs the full Vitest suite because tests
  // can cover cross-module behavior that no single staged file isolates.
  // Gating both on TS/TSX keeps docs-only commits fast.
  // Returning a command from a function (instead of a plain string) stops
  // lint-staged from appending the staged filepaths as arguments.
  "*.{ts,tsx}": () => ["tsc --noEmit", "pnpm test"],

  // Kotlin type and reference errors are caught by the compiler, not by the
  // Rust or TypeScript checks. Compiling the debug variant keeps this limited
  // to static analysis instead of packaging an APK.
  "*.{kt,kts}": () =>
    "./src-tauri/gen/android/gradlew --project-dir src-tauri/gen/android :app:compileUniversalDebugKotlin",

  // Biome formats and lints in one pass. `--no-errors-on-unmatched` keeps it
  // quiet for the extensions it does not handle (Biome has no Markdown or YAML
  // support, so AGENTS.md and ci.yml are left alone).
  "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,json,jsonc,css,svg,html}":
    "biome check --write --no-errors-on-unmatched",

  // `cargo fmt` always formats the whole crate rather than a single file. That
  // is safe here because CI enforces `cargo fmt --check`, so files that are not
  // part of this commit are already rustfmt-clean and stay untouched.
  "*.rs": () => "cargo fmt --manifest-path src-tauri/Cargo.toml",
});
