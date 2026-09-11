# Repository Guidelines

## 项目结构

- `src/`：React 前端源码。`pages/` 存放页面，`components/` 存放可复用 UI，`lib/` 存放 Tauri IPC 与工具函数，`store/` 存放 Zustand 状态。
- `src-tauri/src/`：Rust 后端。领域加载/解析逻辑在 `domain/`，Maa 运行时在 `runtime.rs`，配置持久化在 `persistence.rs`，敏感数据处理在 `secrets.rs`。
- `src-tauri/gen/android/`：Android Shell、JNI 桥接、Shizuku 控制服务与 Gradle 工程。
- `src-tauri/fixtures/`：嵌入式测试项目数据。
- `vendor/maa/`：vendored MaaFramework 二进制与许可文件；不要修改二进制内容。

## 构建、测试与开发

- `scripts/setup.sh`：初始化子模块、下载 MaaFramework 二进制并构建 agent runtime ZIP。
- `pnpm install`：安装 Node 依赖。
- `pnpm install`：安装 Node 依赖。
- `pnpm dev`：启动 Vite 前端开发服务器。
- `pnpm build`：运行 TypeScript 检查并生成生产前端。
- `pnpm test`：运行 Vitest 测试。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：格式化 Rust 代码。
- `cargo test --manifest-path src-tauri/Cargo.toml`：运行 Rust 单元测试。
- `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android --features tauri/custom-protocol --lib`：检查 Android Rust 目标。
- `pnpm tauri android build --target aarch64 --apk`：构建 Android arm64 APK；需设置 `ANDROID_HOME` 与 `JAVA_HOME`。

## 代码风格

TypeScript/React 使用 2 空格缩进、函数组件、显式返回类型和 camelCase 变量；React 组件与类型使用 PascalCase。Rust 提交前运行 `cargo fmt`；错误类型使用 `thiserror`，公共 IPC 数据使用 `serde` 的 camelCase 表示。Tailwind class 应保持语义清晰，避免为一次性样式引入自定义 CSS。

## 测试指南

前端测试放在被测代码旁，命名为 `*.test.tsx` 或 `*.test.ts`，使用 Vitest 与 Testing Library。Rust 单元测试放在同一源文件的 `#[cfg(test)]` 模块中。修改 IPC、任务解析、持久化或密码加密时，必须补充覆盖正常与失败路径的测试。提交前至少运行 `pnpm test`、`cargo test`，涉及 Android 时运行 Android `cargo check`。

## 提交与 PR

当前工作区未包含 Git 历史，因此项目尚未确立既有提交约定。新提交建议使用 Conventional Commits，例如 `fix(resolver): preserve encrypted fields` 或 `feat(android): add shizuku status`。PR 应包含变更原因、验证命令与结果；UI 变更需要截图，Android 行为变更需要设备验证说明。

## 安全注意事项

密码只能通过 `SecretBridge` 交给 Android Keystore 加密，禁止明文写入配置文件、日志或前端持久层。更新 Maa 二进制时必须保留许可说明，并优先使用官方发布的未修改产物。
