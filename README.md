# MaaTauriAndroid

MaaFramework 的 Android 通用界面（Tauri 实现）

## 项目简介

MaaTauriAndroid 是基于 [MaaFramework](https://github.com/MaaXYZ/MaaFramework) 的 Android 通用界面，采用 [Tauri 2](https://github.com/tauri-apps/tauri)（Rust 后端 + WebView 前端）构建。资源开发者通过 [Project Interface V2 协议](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md)描述任务、选项和界面文本，用户即可在手机上配置并运行自动化任务。

MaaFramework 以 JNI 方式跑在应用内，截屏和点击经由 Shizuku 或 root 提权的控制服务完成，不经过 adb。

MaaTauriAndroid 本身不包含具体业务资源。Android 上要把资源在**构建期**打进 APK：换一份资源 = 换一份配方 + 重新出包，不必改本仓库的代码。

## 主要功能

### 任务与资源

- 支持 Project Interface V2 的任务、选项、预设、国际化和 `import`；支持 PI 声明的 agent（自定义识别器 / 动作）。
- 任务说明支持 Markdown 渲染。
- 支持中文 / 英文界面切换。

### 运行与设备

- 提权方式支持 [Shizuku](https://shizuku.rikka.app/) 或 root，二选一，可在应用内切换。
- 支持按规则定时执行。
- 运行中在系统通知里显示进度。

### 更新与诊断

- 应用内自更新，支持 Mirror酱 和 GitHub Releases 两个源。
- 运行日志可回看、导出，诊断数据可清理。
- 资源可在 PI 里配置 Sentry 遥测；只有资源提供了配置、且用户未关闭时才会发送（debug 构建不发送）。

## 运行要求

| 项目 | 要求 |
|:---|:---|
| 系统 | Android 9（API 28）及以上，arm64-v8a |
| 提权 | [Shizuku](https://shizuku.rikka.app/) 或 root，二选一，可在应用内切换 |
| 资源 | 一份符合 Project Interface V2 的资源项目（已在构建期打进当前 APK） |

不同资源可能还要求目标应用已安装、通知权限、电池白名单等，以对应资源项目的说明为准。

## 快速开始

### 使用已打包的 APK

1. 安装资源项目提供的 APK。
2. 安装 [Shizuku](https://shizuku.rikka.app/) 并完成授权，root 设备可直接使用。
3. 选择任务、核对选项，开始运行。

注意：debug 构建每次的签名可能不同，覆盖安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 时需先卸载重装（会清除应用内配置）。

### 接入自己的资源项目

1. 按 [Project Interface V2 协议](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md)写好 `interface.json` 和资源。开发和排查 Pipeline 请用 MaaFramework 提供的调试工具，不要把本应用当调试器。
2. 拷贝 [`pi-profile.sample.toml`](src-tauri/profiles/pi-profile.sample.toml)，按注释填写资源路径和 agent 运行时，放到本仓库之外。
3. 在 `src-tauri/gen/android/local.properties` 里写 `pi.profile=<配方的绝对路径>`（或设环境变量 `PI_PROFILE`、Gradle 参数 `-Ppi.profile`）。
4. 执行 `scripts/setup.sh` 初始化子模块、下载 MaaFramework 并构建 agent runtime（构建细节见 [Agent runtime 构建](docs/agent-runtime.md)），然后出包：

```bash
pnpm tauri android build --target aarch64 --apk --split-per-abi
```

打包集合由 `interface.json` 自动推导，规则详见 [src-tauri/profiles/README.md](src-tauri/profiles/README.md)。清除 `pi.profile` 时构建回退到内置 fixture（`src-tauri/fixtures/pi/minimal`）。当前 commit 没有对应 tag 时出 debug 包，有 tag 对应才用 release 签名。

## 资源开发

- [Project Interface V2 协议](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md)
- [MaaPracticeBoilerplate](https://github.com/MaaXYZ/MaaPracticeBoilerplate)
- [打包规则与配方说明](src-tauri/profiles/README.md)
- [Agent runtime 构建](docs/agent-runtime.md)

## 从源码构建

需要 pnpm 11（`corepack pnpm@11`，与 CI 一致）、Rust stable、Android SDK/NDK、Python 3（构建 agent runtime 用）。请在 clone 下来的仓库里执行：

```bash
scripts/setup.sh   # 初始化子模块、下载 MaaFramework 二进制并构建 agent runtime ZIP
pnpm install       # 安装 Node 依赖（同时安装 husky 钩子）
pnpm dev           # 前端开发服务器
```

本地检查：

```bash
pnpm typecheck     # tsc --noEmit
pnpm lint          # Biome lint
pnpm test          # Vitest
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

本仓库的 Actions 只用于自身的开发测试；资源项目的出包与发布请下游自行集成。代码风格、测试与提交规范等仓库约定见 [AGENTS.md](AGENTS.md)。

## 相关项目

- [MaaFramework](https://github.com/MaaXYZ/MaaFramework) — 基于图像识别的自动化框架
- [MFAAvalonia](https://github.com/MaaXYZ/MFAAvalonia) — MaaFramework 的跨平台通用桌面界面
- [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp) — MaaFramework 的 Android GUI

## 开源许可

本项目基于 [LGPL-2.1](LICENSE) 开源。

## 致谢

MaaTauriAndroid 使用了 [MaaFramework](https://github.com/MaaXYZ/MaaFramework)、[Tauri](https://github.com/tauri-apps/tauri)、[Shizuku](https://github.com/RikkaApps/Shizuku) 等开源项目。`vendor/maa/` 内的 MaaFramework 二进制保留其原始许可（[vendor/maa/MAA-LICENSE.md](vendor/maa/MAA-LICENSE.md)）；`resource/` 下的资源项目归各自上游所有。
