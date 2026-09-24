# Agent runtime 构建

资源的 `interface.json` 声明了 agent（自定义识别器 / 动作）时，APK 需要随包携带对应的运行时 ZIP：一个能在 Android 上跑起来的 Python（或编译型）agent 载荷。本文讲这个 ZIP 是怎么构建出来的。

协议层的配方写法（`[[agent.runtimes]]`、占位符、条数对应关系）见 [打包规则与配方说明](../src-tauri/profiles/README.md)，本文只讲构建。

## ZIP 里有什么

以 Python agent 为例，产物是一个 arm64-v8a 的 ZIP：

```text
<项目>-agent-runtime-arm64-v8a.zip
├── bin/python3                       # 解释器入口
├── prefix/                           # PYTHONHOME：CPython 标准库
├── site-packages/
│   ├── pure.zip                      # 纯 Python 包，收进 zip 交 zipimport
│   └── …                             # 带 .so 的包留在磁盘（dlopen 需要真实路径）
└── lib/arm64-v8a/
    ├── libMaaAgentClient.so          # 与 vendor/maa/android 同源的 agent 库
    └── libMaaAgentServer.so
```

出包时它由配方的 `bundle` 指向，构建进 APK 的 assets；设备上由 `AgentRuntimeManager` 解包到应用私有目录，按 `[[agent.runtimes]]` 拉起子进程。ZIP 有两条硬性约束（`ZipSafety` / `validateAgentBundle` 强制）：

- **不能含符号链接**——打包时解引用成普通文件，解不开的链接直接报错；
- **不能触发 ZIP64**——条目数上限 0xFFFF，超限直接失败，而不是产出一个设备端打不开的包。

## 一键与分步

```bash
scripts/setup.sh                        # 全量：子模块 + MaaFramework + 三个 runtime
scripts/build-agent-runtime.sh m9a      # 也可单跑某一个
scripts/build-agent-runtime.sh narutomobile
scripts/build-agent-runtime.sh maapvz
```

runtime ZIP 是构建产物，不进 git——CI 每次重新构建。

## 流水线四步

`scripts/build-agent-runtime.sh` 做四件事：

1. **取打包脚本**：从 MaaFwApp 下载钉定 commit（`MAAFW_SCRIPT_REF`）的 `scripts/build_agent_bundle.py`，并把其中的 `CORE_REPO` 替换为本仓库的 fork（`MAAFW_CORE_REPO`）。
2. **组装 Python 核心 + site-packages**：`build_agent_bundle.py` 从 MaaAgentCoreAndroid 的 release 下载预编译核心（CPython + 标准库 + `maa` 包，钉 `MAAFW_CORE_TAG`，缓存在 `.cache/maafw/`），再用资源项目自己的 `requirements.txt` 装依赖——Android 轮子来自 Chaquopy 索引（`--extra-index-url https://chaquo.com/pypi-13.1/`），装完剪掉排除列表里的包，纯 Python 的收进 `pure.zip`。
3. **备 agent 库**：`libMaaAgentClient.so` / `libMaaAgentServer.so` 优先复用 `vendor/maa/android/arm64-v8a/` 里已铺好的；没有就从 MaaFramework release（钉 `MAAFW_VERSION`）下载。**两个来源必须是同一版本**，这是 bundle 与壳内 MaaFramework 对齐的关键。
4. **打包**：`src-tauri/profiles/pack_agent_bundle.py` 把 bundle 目录和两个 `.so` 打成上述约束的 ZIP，并校验 `lib/arm64-v8a/` 里两个 `.so` 齐全。

## 版本钉定

全部集中在 `scripts/env.sh`，可用同名环境变量覆盖；改动时同步 `.github/workflows/ci.yml` 和 `vendor/maa/README.md`：

| 变量 | 值 | 作用 |
|:---|:---|:---|
| `MAAFW_VERSION` | `v5.13.0` | MaaFramework 原生库版本（`vendor/maa` 与兜底下载） |
| `MAAFW_CORE_REPO` | `Craun718/MaaAgentCoreAndroid` | 预编译 Python 核心的来源 fork |
| `MAAFW_CORE_TAG` | `3.13.15-maafw5.13.0` | 核心版本（对应 MaaFW 5.13.0） |
| `MAAFW_SCRIPT_REF` | `f4f6f22…` | `build_agent_bundle.py` 在 MaaFwApp 上的钉定 commit |

对齐规则：核心自带的 Python `maa` 包版本**覆盖** `requirements.txt` 里的 `maafw` 钉定，所以升级 MaaFramework 时必须连 `MAAFW_CORE_TAG` 一起换。Python agent 与原生库之间走 AgentClient/Server IPC，patch 版本间保持兼容。

## 三个内置项目的差异

各资源只差 `requirements.txt` 与排除/重钉列表（脚本内的 `EXCLUDES` / `REQUIREMENTS`）：

| 项目 | 重钉 | 排除 |
|:---|:---|:---|
| m9a | `pillow==11.0.0` | `pillow` |
| narutomobile | `pillow==11.0.0` | `pillow` `win32-setctime` `colorama` `jeepney` |
| maapvz | `pillow==11.0.0` | `pillow` `win32-setctime` `colorama` `jeepney` `onnxruntime` |

模式是统一的：先排除依赖解析默认选中的版本，再用 `--require` 钉回 Chaquopy 索引上有 Android 轮子的版本（桌面 PyPI 上的 pillow 没有 arm64 Android 轮子）；纯桌面依赖直接剪掉。

## 给下游：为自己的资源构建

`build-agent-runtime.sh` 目前只认仓库内三个项目。外部资源项目自行集成时，照搬四步流水线即可——`build_agent_bundle.py`（来自 MaaFwApp）和 `pack_agent_bundle.py` 都是通用命令行工具：

```bash
# 1-2. 组装你的 bundle（requirements 用你资源项目的）
python3 build_agent_bundle.py \
  --out <你的-dist 目录> --abi arm64-v8a \
  --requirements <你的资源>/requirements.txt \
  --extra-index-url https://chaquo.com/pypi-13.1/ \
  --core-tag <MaaAgentCoreAndroid 的 tag> --work <缓存目录>

# 3. 准备与壳内 vendor/maa 同版本的 libMaaAgentClient.so / libMaaAgentServer.so

# 4. 打包（脚本不挑项目，任何 bundle 目录都能打）
python3 pack_agent_bundle.py \
  <你的-dist>/arm64-v8a/bundle <agent-libs 目录> <你的-runtime>.zip
```

然后在配方里把 `[[agent.runtimes]]` 的 `bundle` 指向产出的 ZIP，条数与 PI 的 `agent[]` 一一对应。PI 没声明 agent 时，配方里的 `agent` 整段删掉即可。

## 编译型 agent（ELF）

`[[agent.runtimes]]` 只声明一个 ZIP（`bundle`）、包内可执行体路径（`exec`）、要标记可执行的文件（`executables`）、命令行（`args`）、工作目录（`working_dir`）与环境（`env`）。Rust 侧每次运行给每个 runtime 起一个 `AgentClient` TCP，端口经 `{identifier}` 占位符传给子进程；Kotlin 侧用 `ProcessBuilder` 直接执行 `exec`。C++ / Go / Rust 单文件 ELF（或二进制 + 共享库）把可执行体放进 bundle 即可，配方写法见 [打包规则与配方说明](../src-tauri/profiles/README.md)。

编译型 agent 的包体约束：

- **包体**：bundle 是普通 ZIP，须满足无符号链接、条目数不超 0xFFFF，且构建期 `validateAgentBundle` 强制包内含 `lib/arm64-v8a/libMaaAgentClient.so` 与 `libMaaAgentServer.so`。子进程真正需要的是 Server 库（链接它，或经 `MAAFW_BINARY_PATH` / `LD_LIBRARY_PATH` 加载）；Client 库只被壳内宿主进程使用，但每个 bundle 仍必须带上。
- **打包工具**：用普通 `zip` 打包即可，自行保证无符号链接、条目数不超 0xFFFF。
- **通信协议**：子进程必须实现 MaaFW 的 AgentServer 侧，监听 `{identifier}`（TCP 端口）与壳内 `AgentClient` 走 AgentClient/Server IPC。`interface.json` 的 `agent.child_args` 指向入口——ELF 就写包内二进制路径，`agent/` 目录整体随 PI 打包。

最小配方示例：

```toml
[agent]
timeout_ms = 15000

[[agent.runtimes]]
bundle = "/path/to/compiled-agent-runtime.zip"
exec = "bin/my_agent"
executables = ["bin/my_agent"]
args = ["{identifier}"]
working_dir = "{pi}"

[agent.runtimes.env]
LD_LIBRARY_PATH = "{bundle}/lib/arm64-v8a"
MAAFW_BINARY_PATH = "{bundle}/lib/arm64-v8a"
```

出包只需把 bundle 目录压成 ZIP，`exec` 与 `executables` 指向的文件在设备端会被 `AgentRuntimeManager` 自动标成可执行：

```bash
cd <bundle 目录>
zip -r compiled-agent-runtime.zip .
```
