# Repository Guidelines

## 项目结构

- `src/`：React 前端源码。`pages/` 存放页面，`components/` 存放可复用 UI，`lib/` 存放 Tauri IPC 与工具函数，`store/` 存放 Zustand 状态。
- `src/components/ui/`：daisyUI（`daisyui`，纯 CSS 的 Tailwind 插件，无运行时 JS）封装层。控件外观由 daisyUI 的组件类（`input` / `select` / `checkbox` / `radio` / `tabs` 等）提供，颜色、圆角、尺寸来自 `src/index.css` 里 `"ttflow"` 主题的 token；各封装组件只负责把调用处的 props 映射到这些类，页面/组件只写布局 class。daisyUI 没有对应组件的形态（如卡片式单选）才用它的语义 token（`border-base-300` / `bg-base-100` / `text-primary`）组合，不要新引入第二套组件库。
- `src-tauri/src/`：Rust 后端。领域加载/解析逻辑在 `domain/`，Maa 运行时在 `runtime.rs`，配置持久化在 `persistence.rs`，敏感数据处理在 `secrets.rs`。
- `src-tauri/gen/android/`：Android Shell、JNI 桥接、Shizuku 控制服务与 Gradle 工程。
- `src-tauri/fixtures/`：嵌入式测试项目数据。
- `vendor/maa/`：vendored MaaFramework 二进制与许可文件；不要修改二进制内容。

## 系统栏适配（edge-to-edge）

`android:targetSdkVersion` 是 36，从 Android 15 起平台强制 edge-to-edge，而在 Android 16 上 `R.attr#windowOptOutEdgeToEdgeEnforcement` 已废弃停用，**应用无法退出 edge-to-edge**，因此必须自己处理 window insets。

分工是明确的：**insets 由原生负责，前端不要碰。**

- 原生：`MainActivity.insetContainerOf` 把 `systemBars() | displayCutout()` 作为 padding 施加到 WebView 的**父容器**上。监听器刻意不挂在 WebView 自身——`ViewCompat.setOnApplyWindowInsetsListener` 会顶掉该 view 自己的 `onApplyWindowInsets`，而 Chromium 依赖它跟踪软键盘和计算 `env(safe-area-inset-*)`；insets 也原样返回不消费，避免影响输入法。`values/themes.xml` 的 `windowBackground` 取 `@color/surface`（`values-night` 为深色对应值），让系统栏后面的那条留白与 Web 的 `--surface` 同色。
- 前端：**不要**再用 `env(safe-area-inset-*)` 加 padding。原生已经按 inset 收窄过 WebView 视口，再加一次就是双重叠加（`fixed bottom-0` 的底部导航会整体抬高）。同理，新增页面不要自己补状态栏留白。

改 `--tt-surface`（`src/index.css` 的 `:root`，深色值在同文件的 `prefers-color-scheme` 块里）时记得同步 `res/values{,-night}/colors.xml`，两边一起改。

## 构建、测试与开发

**除非用户明确要求，否则不要自行在本地执行编译或测试。**

本地可用（仅用于开发与格式化，不作为验证手段）：

- `scripts/setup.sh`：初始化子模块、下载 MaaFramework 二进制并构建 agent runtime ZIP。
- `pnpm install`：安装 Node 依赖。包管理器统一用 **pnpm 11**（与 CI 一致，`corepack pnpm@11`）。
- `pnpm dev`：启动 Vite 前端开发服务器。
- `pnpm typecheck`：`tsc --noEmit`，只做类型检查不产出文件。
- `pnpm lint`：用 Biome 做 lint。
- `pnpm format` / `pnpm format:check`：用 Biome 格式化 / 校验 JS、TS、JSON、CSS、HTML 和 SVG。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`：格式化 Rust 代码。

除非用户明确要求在本地运行，否则不要自行执行以下命令：

- `pnpm test` / `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android --features tauri/custom-protocol --lib`
- `pnpm tauri android build --target aarch64 --apk`

## CI 与验证

CI 定义在 `.github/workflows/ci.yml`，由 push / PR 触发，也支持 `workflow_dispatch` 手动触发。

| Job            | 作用                                                                |
| -------------- | ------------------------------------------------------------------- |
| `frontend`     | `pnpm check` + `pnpm test` + `pnpm build`（TypeScript 检查），产出 `dist` artifact |
| `rust`         | `cargo fmt --check` + `cargo test`（桌面目标）                      |
| `android-rust` | Android 目标的 `cargo check`，依赖 `frontend` 的 `dist`             |
| `m9a-android`  | 构建 arm64 debug APK，并上传 APK 与 agent runtime artifact          |

`m9a-android` 受路径过滤控制，仅在 `resource/m9a/**`、`resource/m9a.toml`、`src/**`、`src-tauri/src/**`、`src-tauri/gen/android/**`、`vendor/maa/**`、`package.json`、`pnpm-lock.yaml` 等路径变更时触发；需要强制跑（例如只改了文档但要出包）用 `workflow_dispatch`。

## 真机测试

装机注意：`m9a-android` 目前每次构建都会重新生成 debug 密钥（`android-debug-keystore-v1` 缓存步骤不生效），所以**不同 CI 产物的签名互不相同**。`adb install -r` 会报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，只能先 `adb uninstall` 再装；卸载会清掉 app 私有数据（`configuration.json` 里的运行配置、Keystore 里的密码），动手前先确认 `secretManifest` 是否为空。

## 代码风格

TypeScript/React 使用 2 空格缩进、函数组件、显式返回类型和 camelCase 变量；React 组件与类型使用 PascalCase。Rust 提交前运行 `cargo fmt`；错误类型使用 `thiserror`，公共 IPC 数据使用 `serde` 的 camelCase 表示。Tailwind class 应保持语义清晰，避免为一次性样式引入自定义 CSS。

新增表单控件时优先复用 `src/components/ui/` 里的封装（`Checkbox` / `RadioGroup` / `SegmentGroup` / `TextField` / `Select`），不要在页面里手写原生 `<input>`，也不要绕过封装直接写 daisyUI 组件类：状态样式集中在各封装组件内部（`src/index.css` 只保留原始色板、`@theme` 具名 utility、daisyUI 主题和 `.rich-description`），散落各处会失去统一主题。

颜色分两层，改色只需要动 `src/index.css` 里 `:root` 的 `--tt-*` 原始色板一处：

- 项目自己的具名 utility（`bg-surface` / `bg-raised` / `bg-surface-muted` / `text-ink` / `text-ink-muted` / `border-line` / `bg-accent`）来自 `@theme`，定义在 `src/index.css` 的 `@theme` 块；
- daisyUI 组件的语义 token（`bg-base-100` / `text-base-content` / `border-base-300` / `text-primary` / `text-error` 等）由 `@plugin "daisyui/theme"` 的 `"ttflow"` 主题提供，其取值同样引用 `--tt-*`。

两套名字指向同一批原始变量，取值必然一致；写新组件时按「daisyUI 有对应组件就用它的类，没有就用它的语义 token」来选。不要写 `bg-[var(--color-*)]` 任意值或硬编码十六进制。深色由 `prefers-color-scheme` 覆盖 `--tt-*` 同名变量实现，所以 daisyUI 主题不需要单独的 `--prefersdark` 变体，也不要引入 `data-theme` 切换。

一个易踩的坑：`--color-accent` 是 `@theme` 和 daisyUI 主题共用的变量名，两处都必须指向 `var(--tt-accent)`，否则 `bg-accent` 会被静默覆盖。

daisyUI 把自己的样式包在 `@layer utilities > daisyui.*` 子层里，而层自身的规则排在子层之后，因此 Tailwind 工具类（`w-full` / `min-w-full` / `border` 等）可以正常覆盖组件默认样式——`.input` 自带的 `width: clamp(3rem, 20rem, 100%)` 就是靠 `w-full` 压过去的。反之，要覆盖 daisyUI 默认外观时优先用工具类，不要加 `!important`。

界面文案一律走 `src/lib/i18n.ts`：所有字符串写在 `en` / `zh` 两份目录里（`zh` 用 `Record<MessageKey, string>` 约束，漏 key 会编译失败），组件内用 `useTranslation()` 取 `t`，不要在 JSX 里写死文字，也不要给 `t` 传运行时拼出来的 key。语言存于 `UserConfiguration.uiLanguage`（`system` 跟随设备语言，`zh*` 判为中文，其余英文）；`resolveLanguage` 负责把设置解析成实际语言，`projectLanguage` 负责映射成项目 locale（`zh_cn` / `en_us`）。

新增用户可见的文案时，必须同时补上 `en` 与 `zh` 两份；只有后端（Rust）产出的诊断/运行消息仍是英文原文。

## 测试指南

只测业务逻辑，不测 UI。组件渲染、样式、布局与交互（点击/输入/键盘/焦点、主题或语言切换后的界面文案变化）都不做自动化测试，这些交给人工与截图验证；不为页面和 `src/components/` 下的组件新增渲染测试。

前端测试放在被测代码旁，命名为 `*.test.ts`，使用 Vitest，只测纯逻辑：`src/lib/` 与 `src/store/` 里的解析、状态迁移、IPC 调用的参数构造与错误分支。用 mock 掉 `@tauri-apps/api` 这类边界的方式断言行为，不渲染真实组件，也不断言 DOM 结构或 class。只有确实需要驱动 React 状态时才改用 `*.test.tsx` + `renderHook`，并且只验证状态与回调。Rust 单元测试放在同一源文件的 `#[cfg(test)]` 模块中。

改动既有页面或组件时，顺手清掉其中属于 UI 的渲染断言，把仍值得保留的业务逻辑抽到 `src/lib/`、`src/store/` 或自定义 hook 里再覆盖。

修改 IPC、任务解析、持久化或密码加密时，必须补充覆盖正常与失败路径的测试。

**写好测试后交给 CI 跑**（`frontend` 与 `rust` job）；除非用户明确要求本地测试，不要在本地执行 `pnpm test` / `cargo test`。涉及 Android 的改动以 `android-rust` 的 `cargo check` 结果为准。

## 提交与 PR

提交前由 husky + lint-staged 的 pre-commit 钩子自动执行检查（配置见 `lint-staged.config.mjs`），**刻意不跑测试**（测试交给 CI 的 `frontend` / `rust` job）：

| 暂存文件                                              | 动作                                             |
| ----------------------------------------------------- | ------------------------------------------------ |
| `*.{ts,tsx}`                                          | `tsc --noEmit`，整项目类型检查                   |
| `*.{js,jsx,ts,tsx,mjs,cjs,mts,cts,json,jsonc,css,svg,html}` | `biome check --write`，格式化并 lint 后自动重新暂存 |
| `*.rs`                                                | `cargo fmt --manifest-path src-tauri/Cargo.toml` |

两个细节：`tsc` 不接受单个文件路径，`cargo fmt` 只能整 crate 格式化，因此这两项都以函数形式配置——不拼接暂存文件名。`cargo fmt` 之所以安全，是因为 CI 有 `cargo fmt --check`，未参与本次提交的 `.rs` 文件本来就是干净的。

钩子由 `pnpm install` 触发的 `prepare` 脚本安装，`core.hooksPath` 指向 `.husky/_`。Biome 规则在 `biome.json`：`resource/`（M9A submodule，JSON 被 `resource/m9a.toml` 的 sha256 锁定）、`vendor/`、`src-tauri/gen/` 一律不处理。Biome 不覆盖 Markdown 和 YAML，这些文件不进入 pre-commit 格式化流程。紧急情况下用 `git commit --no-verify` 跳过。

新提交使用 Conventional Commits，例如 `fix(resolver): preserve encrypted fields` 或 `feat(android): add shizuku status`。PR 应包含变更原因与 CI 运行结果；UI 变更需要截图，Android 行为变更需要注明真机验证结论。

## 安全注意事项

密码只能通过 `SecretBridge` 交给 Android Keystore 加密，禁止明文写入配置文件、日志或前端持久层。更新 Maa 二进制时必须保留许可说明，并优先使用官方发布的未修改产物。
