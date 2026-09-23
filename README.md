# MaaTauriAndroid

[MaaFramework](https://github.com/MaaXYZ/MaaFramework) 项目的 Android 壳应用。基于 Tauri 2（Rust 后端 + WebView 前端），把 MAA 生态项目的 Project Interface 在构建期打包进 APK，在真机上通过内嵌的 MaaFramework 运行时执行自动化任务。

应用本体与资源相互独立：指向不同的 `pi.profile` 即可打包出对应资源的 APK，无需改动应用代码。

## 支持的资源

| 资源 | 上游仓库 | 构建配置 | CI Job |
| ---- | -------- | -------- | ------ |
| M9A（明日方舟） | [MAA1999/M9A](https://github.com/MAA1999/M9A) | `resource/m9a.toml` | `m9a-android` |
| MaaPVZ（植物大战僵尸） | [Maa-Assistant-PVZ-The-best/MAAPVZ](https://github.com/Maa-Assistant-PVZ-The-best/MAAPVZ) | `resource/maapvz.toml` | `maapvz-android` |
| MAN（火影忍者手游） | [duorua/narutomobile](https://github.com/duorua/narutomobile) | `resource/narutomobile.toml` | `narutomobile-android` |

资源以 git submodule 形式引入，各配一份 TOML profile 描述打包入口（`pi_assets`）、agent 运行时与子进程环境。APK 的打包集合由 `interface.json` 自动推导，规则详见 [src-tauri/profiles/README.md](src-tauri/profiles/README.md)。**不要修改 submodule 中的任何内容**；需要调整上游行为时改本仓库的代码。

## 工程结构

- `src/`：React 19 前端（Vite + Tailwind CSS 4 + daisyUI 5，Zustand 状态管理）。
- `src-tauri/src/`：Rust 后端。领域加载/解析在 `domain/`，Maa 运行时在 `runtime.rs`，配置持久化在 `persistence.rs`，敏感数据处理在 `secrets.rs`。
- `src-tauri/gen/android/`：Android Shell、JNI 桥接、Shizuku 控制服务与 Gradle 工程。
- `src-tauri/profiles/`：Project Interface profile 的解析与打包规则。
- `resource/`：资源 submodule 与对应的 `*.toml` profile。
- `vendor/maa/`：vendored MaaFramework 二进制与许可文件，不要修改二进制内容。
- `scripts/`：初始化与资源准备脚本。

## 本地开发

前置要求：pnpm 11（`corepack pnpm@11`，与 CI 一致）、Rust stable、Android SDK/NDK、Python 3（构建 agent runtime 用）。

```bash
scripts/setup.sh   # 初始化子模块、下载 MaaFramework 二进制并构建 agent runtime ZIP
pnpm install       # 安装 Node 依赖（同时安装 husky 钩子）
pnpm dev           # Vite 前端开发服务器
pnpm tauri dev     # 桌面壳调试（Wayland 下用 pnpm tauri:dev:wayland-safe）
```

## 构建 APK

通过 `pi.profile` 指定打包的资源 profile（优先级：Gradle `-Ppi.profile` → `local.properties` → 环境变量 `PI_PROFILE`）：

```properties
# src-tauri/gen/android/local.properties
pi.profile=/absolute/path/to/resource/m9a.toml
```

```bash
pnpm tauri android build --target aarch64 --apk --split-per-abi
```

profile 是构建期嵌入而非运行时切换：改 profile 就要重新出包。清除 `pi.profile` 则回退到内置 fixture（`src-tauri/fixtures/pi/minimal`）。

签名策略：当前 commit 没有对应 tag 时用 debug 签名打包，只有有 tag 对应的 commit 才使用 release 打包。

## 检查与测试

```bash
pnpm typecheck      # tsc --noEmit
pnpm lint           # Biome lint
pnpm format:check   # Biome 格式校验（pnpm format 直接格式化）
pnpm test           # Vitest（前端纯逻辑测试）
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

提交时 husky + lint-staged 会自动对暂存文件执行类型检查、格式化与 Rust 格式化；完整测试交给 CI。

## CI

CI 定义在 [.github/workflows/ci.yml](.github/workflows/ci.yml)，由 push / PR 触发（带路径过滤），也支持 `workflow_dispatch` 手动触发。

| Job | 作用 |
| --- | --- |
| `frontend` | `pnpm check` + `pnpm test` + `pnpm build`，产出 `dist` artifact |
| `rust` | `cargo fmt --check` + `cargo test`（桌面目标） |
| `android-rust` | Android 目标的 `cargo check` |
| `m9a-android` / `narutomobile-android` / `maapvz-android` | 构建对应资源的 arm64 debug APK，并上传 APK 与 agent runtime artifact |

## 许可

- 本项目以 [LGPL-2.1](LICENSE) 发布。
- `vendor/maa/` 内的 MaaFramework 二进制保留其原始许可（[vendor/maa/MAA-LICENSE.md](vendor/maa/MAA-LICENSE.md)），更新二进制时必须保留许可说明。
- `resource/` 下的项目资源归各自上游仓库所有。

## 参与开发

代码风格、edge-to-edge 适配、测试与提交规范等仓库约定见 [AGENTS.md](AGENTS.md)。
