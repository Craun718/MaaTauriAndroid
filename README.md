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
- 前台模式在物理屏上显示可拖动的悬浮控制球（需「显示在其他应用上层」权限）：点开就是遥控面板，能看到本次运行的任务清单与实时日志、停止当前任务、导出日志，或直接跳回本应用，不必切回界面。

### 更新与诊断

- 应用内自更新，支持 Mirror酱 和 GitHub Releases 两个源。
- 运行日志可回看、导出，诊断数据可清理。
- 资源可在 PI 里配置 Sentry 遥测；只有资源提供了配置、且用户未关闭时才会发送（debug 构建不发送）。

## 运行要求

| 项目 | 要求 |
|:---|:---|
| 系统 | Android 9（API 28）及以上，arm64-v8a（x86_64 需显式选择该 ABI） |
| 提权 | [Shizuku](https://shizuku.rikka.app/) 或 root，二选一，可在应用内切换 |
| 资源 | 一份符合 Project Interface V2 的资源项目（已在构建期打进当前 APK） |

不同资源可能还要求目标应用已安装、通知权限、电池白名单等，以对应资源项目的说明为准。

## 快速开始

### 资源开发

首先，你**必须**要学习并理解基于 [MaaFramework](https://github.com/MaaXYZ/MaaFramework) 进行开发所需的基础知识，并开发自己的项目资源。

- 项目模板: [MaaPracticeBoilerplate](https://github.com/MaaXYZ/MaaPracticeBoilerplate)

### 接入自己的资源项目

0. 安装 pnpm、Rust、Android SDK/NDK。
1. 按 [Project Interface V2 协议](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md)写好 `interface.json` 和资源。开发和排查 Pipeline 请用 MaaFramework 提供的调试工具，不要把本应用当调试器。
2. 拷贝 [`pi-profile.sample.toml`](src-tauri/profiles/pi-profile.sample.toml)，按注释填写资源路径和 agent 运行时，放到本仓库之外。
3. 在 `src-tauri/gen/android/local.properties` 里写 `pi.profile=<配方的绝对路径>`（或设环境变量 `PI_PROFILE`、Gradle 参数 `-Ppi.profile`）。
4. 执行 `scripts/setup.sh` 下载 MaaFramework，
5. _如果你的项目使用了 AgentServer，需要按 [Agent runtime 构建](docs/agent-runtime.md)构建自己的 agent runtime，并填写`pi-profile.toml`的相关字段。_
6. 编译出包：

```bash
pnpm install

pnpm tauri android build --target aarch64 --apk --split-per-abi
```

需要 x86_64 时改用 `scripts/setup.sh x86_64` 和 `pnpm tauri android build --target x86_64 --apk --split-per-abi`，agent runtime 也必须在 CI 手动触发时选择 `x86_64`。

打包集合由 `interface.json` 自动推导，规则详见 [src-tauri/profiles/README.md](src-tauri/profiles/README.md)。清除 `pi.profile` 时构建回退到内置 fixture（`src-tauri/fixtures/pi/minimal`）。上面的 `pnpm tauri android build` 默认构建 release。`scripts/build_apk.py` 在未显式传 `--release` / `--debug` 时，会按当前 commit 是否有 tag 自动选择构建模式；release APK 只有在 profile 配置了 `[signing]` 时才会签名。

### 使用已打包的 APK

1. 安装资源项目提供的 APK。
2. 安装 [Shizuku](https://shizuku.rikka.app/) 或使用 root 进行授权。
3. 选择任务、核对选项，开始运行。

## 半自动构建

本项目配置了半自动构建脚本：

```bash
python scripts/build_apk.py --profile <path/to/profile.toml> --release
```

该脚本会额外完成这些步骤：

1. 读取 profile.toml，确认资源已存在。
2. 拉取/校验对应 ABI 的 MaaFramework。
3. 准备 agent runtime ZIP _（仅当 profile 配置了 agent）_ ：
   - 默认先从源码构建 Android 用的 agent core，再用它和资源项目的 Python 依赖打包 runtime ZIP。
   - `--use-prebuilt-core`：跳过本地构建 core，改用预编译 agent core；runtime ZIP 仍会重新打包。
   - `--skip-runtime`：不生成新的 runtime ZIP，直接复用 profile 的 `bundle` 已指向的本地 ZIP。
4. 自动把 pi.profile=<path/to/profile.toml> 写入 src-tauri/gen/android/local.properties。
5. 配置 Android NDK、链接器和 Rust target。
6. 执行 pnpm install --frozen-lockfile、cargo clean 和一次 Android 目标 cargo check。
7. 最后调用以下命令：

```bash
pnpm tauri android build \
  --target aarch64 \
  --apk \
  --split-per-abi
```

## 自动化构建

本仓库的 Actions 只用于自身的测试；资源项目的出包与发布可参考本仓库的流水线配置。

注意：debug 构建每次的签名可能不同，覆盖安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 时需先卸载重装（会清除应用内配置）。

## 相关项目

- [MaaFramework](https://github.com/MaaXYZ/MaaFramework) — 基于图像识别的自动化框架
- [MFAAvalonia](https://github.com/MaaXYZ/MFAAvalonia) — MaaFramework 的跨平台通用桌面界面
- [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp) — MaaFramework 的 Android GUI
- [MXU](https://github.com/MistEO/MXU) — MaaFramework Next UI

## 开源许可

本项目基于 [LGPL-2.1](LICENSE) 开源。

## 致谢

MaaTauriAndroid 使用了 [MaaFramework](https://github.com/MaaXYZ/MaaFramework)、[Tauri](https://github.com/tauri-apps/tauri)、[Shizuku](https://github.com/RikkaApps/Shizuku) 等开源项目；设计思路参考了 [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp)、[MXU](https://github.com/MistEO/MXU) 和 [MFAAvalonia](https://github.com/MaaXYZ/MFAAvalonia)，其中资源接入与 agent runtime 构建参考了 [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp)。

随附的第三方代码与二进制保留各自许可：`vendor/maa/` 内的 MaaFramework 二进制沿用 [LGPL-3.0](vendor/maa/MAA-LICENSE.md)；agent runtime 组装脚本 [scripts/build_agent_bundle.py](scripts/build_agent_bundle.py) 源自 MaaFwApp，按 [AGPL-3.0](scripts/MAA-FWAPP-LICENSE.md) 许可随附。

`resource/` 下的资源项目归各自上游所有。
