# Repository Guidelines

## 项目结构

- `src/`：React 前端源码。`pages/` 存放页面，`components/` 存放可复用 UI，`lib/` 存放 Tauri IPC 与工具函数，`store/` 存放 Zustand 状态。
- `src/components/ui/`：Ark UI（`@ark-ui/react`）封装层。Ark UI 是无样式组件库，只输出 `data-scope` / `data-part` / `data-state` 等数据属性；外观统一定义在 `src/index.css` 的 `@layer components` 里，页面/组件只写布局 class。
- `src-tauri/src/`：Rust 后端。领域加载/解析逻辑在 `domain/`，Maa 运行时在 `runtime.rs`，配置持久化在 `persistence.rs`，敏感数据处理在 `secrets.rs`。
- `src-tauri/gen/android/`：Android Shell、JNI 桥接、Shizuku 控制服务与 Gradle 工程。
- `src-tauri/fixtures/`：嵌入式测试项目数据。
- `vendor/maa/`：vendored MaaFramework 二进制与许可文件；不要修改二进制内容。

## 构建、测试与开发

**编译与测试一律通过 CI 进行，不要在本地运行。** 本地工具链（JDK、NDK、MaaFramework 版本）与 CI 不一致，本地跑出来的结果既慢又不可作为验收依据。本地只做写代码、`pnpm dev` 热更新和 `cargo fmt` 这类轻量操作。

本地可用（仅用于开发与格式化，不作为验证手段）：

- `scripts/setup.sh`：初始化子模块、下载 MaaFramework 二进制并构建 agent runtime ZIP。
- `pnpm install`：安装 Node 依赖。包管理器统一用 **pnpm 11**（与 CI 一致，`corepack pnpm@11`）；本机 node_modules 由 pnpm 11 的 store 链接，用 pnpm 10 会报 `ERR_PNPM_UNEXPECTED_STORE`。
- `pnpm dev`：启动 Vite 前端开发服务器。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：格式化 Rust 代码。

以下命令**只在 CI 中执行**，不要为了验证在本地跑：

- `pnpm test` / `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android --features tauri/custom-protocol --lib`
- `pnpm tauri android build --target aarch64 --apk`

## CI 与验证

CI 定义在 `.github/workflows/ci.yml`，由 push / PR 触发，也支持 `workflow_dispatch` 手动触发。**提交后以 CI 结果为准，job 全绿即视为编译与测试通过。**

| Job | 作用 |
| --- | --- |
| `frontend` | `pnpm test` + `pnpm build`（TypeScript 检查），产出 `dist` artifact |
| `rust` | `cargo fmt --check` + `cargo test`（桌面目标） |
| `android-rust` | Android 目标的 `cargo check`，依赖 `frontend` 的 `dist` |
| `m9a-android` | 构建 arm64 debug APK，并上传 APK 与 agent runtime artifact |

`m9a-android` 受路径过滤控制，仅在 `resource/m9a/**`、`resource/m9a.toml`、`src/**`、`src-tauri/src/**`、`src-tauri/gen/android/**`、`vendor/maa/**`、`package.json`、`pnpm-lock.yaml` 等路径变更时触发；需要强制跑（例如只改了文档但要出包）用 `workflow_dispatch`。

## 真机测试

**真机验证必须使用 CI 构建的产物，不要用本地构建的 APK。** 本机与 CI 的工具链不一致，本地产物不能作为验收依据。

流程：

1. 推送分支，等 `m9a-android` job 跑完（必要时手动 `workflow_dispatch`）。
2. 从该次运行下载 artifact：
   - `m9a-apk-debug`：arm64 debug APK，安装到设备测试。
   - `m9a-agent-runtime-arm64-v8a`：agent runtime ZIP，需要单独验证 runtime 时使用。

   在 GitHub Actions 的 run 页面直接下载，或 `gh run download <run-id> -n m9a-apk-debug`。
3. 报告真机结论时写明对应的 CI run 编号/链接与 artifact 名，便于复核。

## 代码风格

TypeScript/React 使用 2 空格缩进、函数组件、显式返回类型和 camelCase 变量；React 组件与类型使用 PascalCase。Rust 提交前运行 `cargo fmt`；错误类型使用 `thiserror`，公共 IPC 数据使用 `serde` 的 camelCase 表示。Tailwind class 应保持语义清晰，避免为一次性样式引入自定义 CSS。

新增表单控件时优先复用 `src/components/ui/` 里的封装（`Checkbox` / `RadioGroup` / `SegmentGroup` / `TextField`），不要在页面里手写原生 `<input>`，也不要绕过封装直接用 `@ark-ui/react`：状态样式集中在 `index.css`，散落各处会失去统一主题。

## 测试指南

前端测试放在被测代码旁，命名为 `*.test.tsx` 或 `*.test.ts`，使用 Vitest 与 Testing Library。Rust 单元测试放在同一源文件的 `#[cfg(test)]` 模块中。修改 IPC、任务解析、持久化或密码加密时，必须补充覆盖正常与失败路径的测试。

**写好测试后交给 CI 跑**（`frontend` 与 `rust` job），不要为了图快在本地执行 `pnpm test` / `cargo test`；本地只做 `cargo fmt`。涉及 Android 的改动以 `android-rust` 的 `cargo check` 结果为准。

## 提交与 PR

新提交使用 Conventional Commits，例如 `fix(resolver): preserve encrypted fields` 或 `feat(android): add shizuku status`。PR 应包含变更原因与 CI 运行结果；UI 变更需要截图，Android 行为变更需要注明所使用 CI artifact 的 run 编号与真机验证结论。

## 安全注意事项

密码只能通过 `SecretBridge` 交给 Android Keystore 加密，禁止明文写入配置文件、日志或前端持久层。更新 Maa 二进制时必须保留许可说明，并优先使用官方发布的未修改产物。
