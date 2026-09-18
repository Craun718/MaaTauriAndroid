import { defineConfig } from "lint-staged/config";

export default defineConfig({
  // `tsc` rejects individual filepaths, so the type check runs once for the
  // whole project. Gating it on TS/TSX keeps docs-only commits fast.
  // Returning a command from a function (instead of a plain string) stops
  // lint-staged from appending the staged filepaths as arguments.
  "*.{ts,tsx}": () => "tsc --noEmit",

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
