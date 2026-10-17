# Agent runtime 构建

资源的 `interface.json` 声明了 agent（自定义识别器 / 动作）时，APK 需要随包携带对应的运行时 ZIP：一个能在 Android 上跑起来的 Python（或编译型）agent 载荷。本文讲这个 ZIP 是怎么构建出来的。

协议层的配方写法（`[[agent.runtimes]]`、占位符、条数对应关系）见 [打包规则与配方说明](../src-tauri/profiles/README.md)，本文只讲构建。

## ZIP 里有什么

以 Python agent 为例，产物是一个选定 ABI 的 ZIP（默认 `arm64-v8a`）：

```text
<项目>-agent-runtime-<abi>.zip
├── bin/python3                       # 解释器入口
├── prefix/                           # PYTHONHOME：CPython 标准库
├── site-packages/
│   ├── pure.zip                      # 纯 Python 包，收进 zip 交 zipimport
│   └── …                             # 带 .so 的包留在磁盘（dlopen 需要真实路径）
└── lib/<abi>/
    ├── libMaaAgentClient.so          # 与 vendor/maa/android 同源的 agent 库
    └── libMaaAgentServer.so
```

出包时它由配方的 `bundle` 指向，构建进 APK 的 assets；设备上由 `AgentRuntimeManager` 解包到应用私有目录，按 `[[agent.runtimes]]` 拉起子进程。ZIP 有两条硬性约束（`ZipSafety` / `validateAgentBundle` 强制）：

- **不能含符号链接**——打包时解引用成普通文件，解不开的链接直接报错；
- **不能触发 ZIP64**——条目数上限 0xFFFF，超限直接失败，而不是产出一个设备端打不开的包。

## 一键与分步

```bash
scripts/setup.sh                              # MaaFramework 原生库
python3 scripts/build-resource.py \
  https://github.com/MAA1999/M9A.git \
  --id m9a --ref f4640501729562a7106a39bdad48274c6c8ba424 \
  --submodules --exclude pillow --require pillow==11.0.0
```

`build-resource.py` 接收任意 Git URL，克隆指定 ref 及其子模块，先调用 `prepare-pi.py` 适配 interface 位置和 OCR 模型，再调用通用 runtime 脚本；传 `--skip-runtime` 时会在 PI 准备和 MaaFramework 下载后停止，供编译型 agent 自己构建。资源目录和 Python runtime ZIP 名字来自 `--id`；省略时从仓库名推导。`--abi arm64-v8a|x86_64` 选择 runtime ABI，默认保持 arm64；x86_64 runtime 还需要对应的壳层构建，内置 profile 会通过 `{abi}` 自动解析。`build-agent-runtime.sh` 本身继续保持通用：`--project-dir` 与 `--out` 必填，其余参数都有默认值（`--help` 查看完整说明）。仓库内置项目的完整调用参数见下文「仓库内置项目的构建参数」。

没有 `requirements.txt` 的 Python agent 项目会得到一个空的依赖锁，仍会打包预编译 Python 核心和 Maa agent 库；编译型 agent 仍需要单独的打包流程。

runtime ZIP 是构建产物，不进 git——CI 每次重新构建。Python 项目的本地构建保持 `<项目>-agent-runtime-<abi>.zip` 这个名字（profile 的 `bundle` 按它解析）；CI 在上传前会把它改名为 `<项目>-agent-runtime-<abi>-<7 位 commit hash>.zip`，APK 同理，便于把下载到的包对应回具体提交。MaaEnd 是双编译型 agent 例外：CI 上传一个 `maaend-agent-runtime-<abi>-<hash>` artifact，其中包含 `maaend-go-service-runtime-<abi>-<hash>.zip` 和 `maaend-cpp-algo-runtime-<abi>-<hash>.zip` 两个 bundle。

## 流水线三步

`scripts/build-agent-runtime.sh` 做三件事：

1. **组装 Python 核心 + site-packages**：仓库内 `scripts/build_agent_bundle.py`（vendored 自 MaaFwApp，AGPL-3.0，来源 commit 见文件头；升级脚本时手动同步副本并同步头注释）从 MaaAgentCoreAndroid 的 release 下载预编译核心（CPython + 标准库 + `maa` 包，仓库与版本由 `MAAFW_CORE_REPO` / `MAAFW_CORE_TAG` 钉定，缓存在 `.cache/maafw/`），再用资源项目自己的 `requirements.txt` 装依赖——Android 轮子来自 Chaquopy 索引（`--extra-index-url https://chaquo.com/pypi-13.1/`），装完剪掉排除列表里的包，纯 Python 的收进 `pure.zip`。
2. **备 agent 库**：`libMaaAgentClient.so` / `libMaaAgentServer.so` 优先复用 `vendor/maa/android/<abi>/` 里已铺好的；没有就从 MaaFramework release（钉 `MAAFW_VERSION`）下载对应架构。**两个来源必须是同一版本**，这是 bundle 与壳内 MaaFramework 对齐的关键。
3. **打包**：`src-tauri/profiles/pack_agent_bundle.py` 把 bundle 目录和两个 `.so` 打成上述约束的 ZIP，并校验 `lib/<abi>/` 里两个 `.so` 齐全。

## 版本钉定

### 从源码构建包含 OpenCV / ORT 的 core

`scripts/build_agent_core.py` 从源码交叉编译 CPython、OpenCV 和 ONNX Runtime，产出 `arm64-v8a` 与 `x86_64` 两份 core。`scripts/build_agent_native.py` 维护原生依赖版本和 Android 适配：

| 库 | 版本 | 内容 |
|:---|:---|:---|
| OpenCV | 4.12.0 | `cv2.so`；CPU、无 GUI，包含 core/imgproc/imgcodecs/calib3d/features2d/flann/photo/video/objdetect/dnn/ml；不包含 contrib 与视频输入输出 |
| ONNX Runtime | 1.23.2 | `onnxruntime` Python 包与原生扩展；CPU provider，不启用 CUDA、NNAPI、XNNPACK |
| ORT Python 依赖 | 见 `ORT_REQUIREMENTS` | coloredlogs、humanfriendly、flatbuffers、packaging、protobuf、sympy、mpmath，下载纯 Python wheel |
| C++ 运行库 | 来自构建使用的 NDK | `prefix/lib/libc++_shared.so` 与许可声明，沿用配方已有的 `LD_LIBRARY_PATH` |

NumPy 仍为 2.3.2，StrEnum 仍为 0.4.15。OpenCV 和 ORT 均使用目标 CPython 的头文件、共享库以及目标 NumPy 头文件编译，构建机 Python 只用于生成源码。OpenCV 上游默认禁用 Android Python binding，脚本会修改该判断；ORT 的 Python 探测则替换为显式的目标库配置。上游片段不匹配时直接失败。源码 tag 对应的 commit、输入 wheel 的哈希及版本记录在 `build-metadata.json`，许可证随 core 打包。

构建机需要与目标 Python 主次版本一致的 Python（默认 3.13）、Android SDK、NDK 28.2.13676358、CMake 3.31、Ninja、Git、packaging 和 CPython 的构建工具。`ANDROID_HOME` 指向 SDK；NDK 优先取 `ANDROID_NDK_HOME` / `ANDROID_NDK_ROOT`，否则取 `$ANDROID_HOME/ndk/28.2.13676358`。

```bash
python3 scripts/build_agent_core.py \
  --python-version 3.13.15 --maafw-version 5.14.2 \
  --work-dir build/agent-core --jobs 2

scripts/build-agent-runtime.sh \
  --project-dir <你的资源目录> --out /tmp/agent-runtime.zip \
  --core build/agent-core/dist/agent-core-3.13.15-arm64-v8a.tar.gz
```

也可手动触发 `.github/workflows/agent-core.yml`，从 `android-python-agent-core-<commit>` artifact 下载两种 ABI 的 core、构建元数据和哈希。该工作流只上传构建产物，不发布 release，也不修改已有 core tag。构建时检查 ELF 架构、文件布局及 RECORD 哈希；Python 导入、OpenCV 运算和 ORT 模型推理仍需 Android 真机验证。

core 的 `provides` 会声明这两者及 ORT 的依赖，runtime 组装会跳过 requirements 中对应项的版本钉定；`opencv-python-headless` 也映射到 core 的无 GUI OpenCV，不提供 `opencv-contrib-python`。OpenCV 这里的版本是源码版本 `4.12.0`，不包含 PyPI wheel 的打包后缀。完整依赖锁建议传 `--no-deps`，避免 pip 为传递依赖重新解析 core 已包含的原生库。

### 下载预编译 core

全部集中在 `scripts/env.sh`，可用同名环境变量覆盖；改动时同步 `.github/workflows/ci.yml` 和 `vendor/maa/README.md`：

| 变量 | 值 | 作用 |
|:---|:---|:---|
| `MAAFW_VERSION` | `v5.14.2` | MaaFramework 原生库版本（`vendor/maa` 与兜底下载） |
| `MAAFW_CORE_REPO` | `Craun718/MaaAgentCoreAndroid` | 预编译 Python 核心的来源 fork |
| `MAAFW_CORE_TAG` | `agent-core-3.13.15-maafw5.14.2` | 核心版本（对应 MaaFW 5.14.2） |

对齐规则：核心自带的 Python `maa` 包版本**覆盖** `requirements.txt` 里的 `maafw` 钉定，所以升级 MaaFramework 时必须连 `MAAFW_CORE_TAG` 一起换。Python agent 与原生库之间走 AgentClient/Server IPC，patch 版本间保持兼容。

上述已有 tag 的内容不变；资源 APK 的现有 CI 仍下载它，maapvz 的 `--exclude onnxruntime` 也继续用于旧 core。使用新库时，通过 `--core` 传入新产物，或发布新 core 后再更新 tag。新 core 已提供 ORT 时，requirements 中的排除参数不会删除 core 自带的副本。

## 仓库内置项目的构建参数

各资源只差 `requirements.txt` 与排除/重钉列表。URL、ref 和 runtime 参数由 CI 调用 `scripts/build-resource.py` 时传入；PI 组装由 `scripts/prepare-pi.py` 自动适配：

| 项目 | 重钉 | 排除 |
|:---|:---|:---|
| m9a | `pillow==11.0.0` | `pillow` |
| narutomobile | `pillow==11.0.0` | `pillow` `win32-setctime` `colorama` `jeepney` |
| maapvz | `pillow==11.0.0` | `pillow` `win32-setctime` `colorama` `jeepney` `onnxruntime` |
| maaend | 不适用 | 不适用；上游脚本交叉编译 `go-service` 与 `cpp-algo` |

模式是统一的：先排除依赖解析默认选中的版本，再用 `--require` 钉回 Chaquopy 索引上有 Android 轮子的版本（桌面 PyPI 上的 pillow 没有 arm64 Android 轮子）；纯桌面依赖直接剪掉。

### `--exclude` 的替换语义与当前限制

接入 Android 替代库时，`--exclude` 用于跳过上游 requirements 中原有的安装项或版本约束，替代实现由 `--require` 或 core 提供。不能仅凭包名出现在 `--exclude` 中，就判断项目不需要这个库。

例如 `--exclude pillow --require pillow==11.0.0` 表示跳过上游 Pillow 的版本约束，安装 Android 索引上的 11.0.0。当前 `plan()` 会先过滤上游项，再加入 `--require`，并把 Pillow 从后续清理名单中移除，因此替代版本会保留。单独排除不适用于 Android 的桌面依赖仍会跳过安装；`--exclude` 本身不会自动寻找替代实现。

core 自带库的替换目前还有限制：

- `decide()` 先判断 `core.provides`，再判断 `--exclude`，因此 core 已提供的库会沿用 core 版本，且不会被加入清理名单。
- `--require` 当前会无条件交给 pip，包括 core 已提供的库；尚未实现先移除旧副本、安装替代版本并同步清单的完整替换流程，不能依赖它安全覆盖 core 自带库。
- runtime 组装当前复制整个 core。源码 core 包含的 OpenCV、ORT 及其依赖都会进入 runtime，尚未根据项目需求裁剪；`provides` 表示 core 提供了什么，不代表项目实际需要什么。

### 按需打包的设计约定（尚未实现）

组件选择应放在 `scripts/build_agent_bundle.py` 的 `build()` 组装阶段，在复制 core 文件之前解析需求，并在生成 `pure.zip` 之前完成选择。core 构建阶段负责记录组件的文件归属、依赖关系和共享库；最终 ZIP 打包工具负责归档与完整性检查。

选择顺序应为：

1. 从 requirements 的直接依赖、传递依赖和 Android 条件标记识别实际需求，同时纳入 `--require` 显式添加的需求。
2. 应用 `--exclude`，跳过上游的安装项或版本约束，保留供替代实现使用的需求信息。
3. 根据 `--require` 指定的替代版本或 core 提供的 Android 实现确定最终来源；缺少可用实现时明确报错。
4. 按最终选择复制组件、安装其他依赖并更新 runtime 清单；共享依赖按所有已选组件的需求保留。

例如，项目声明了 `onnxruntime`，同时传入 `--exclude onnxruntime`，且 core 提供 Android ORT 时，应保留 ORT 的需求并选择 core 实现。OpenCV 的 `opencv-python` / `opencv-python-headless` 名称应归一到同一个组件；ORT 的 Python 依赖和 `libc++_shared.so` 应按依赖关系保留，不能因为移除某个组件而删掉其他组件仍需要的文件。

### MaaEnd 例外

MaaEnd `v2.32.0`（commit `5501b27f3b3f552e8897a8839521dd36caf617a9`）有两个编译型 agent。CI 先用 `build-resource.py --submodules --prepare ... --skip-runtime` 组装 PI，并把 `AndroidOpenGame` 插到 `DailyFull` / `QuickDaily` / `RealtimeAssist` 三个预设首位；随后按上游 `tools/build_android_agents.py` 交叉编译，再用 `scripts/pack_compiled_agent.py` 分别产出两个 ZIP。两个 ZIP 与 `interface.json` 的 agent 顺序一一对应，不能合成一个 bundle，否则 APK 会把同一份 agent 负载重复打包两次。

## 给下游：为自己的资源构建

`build-agent-runtime.sh` 对任何资源项目都是直接可用的通用脚本（内部组装与打包分别由 `scripts/build_agent_bundle.py` 和 `src-tauri/profiles/pack_agent_bundle.py` 完成，`--help` 可看全部参数）：

```bash
scripts/build-agent-runtime.sh \
  --project-dir <你的资源目录> \
  --out /tmp/你的-runtime-arm64-v8a.zip \
  [--requirements <文件>] \
  [--exclude pkg]... [--require spec]... \
  [--abi arm64-v8a|x86_64] [--extra-index-url url]... [--work <缓存目录>]
```

核心（CPython + 标准库 + `maa` 包）默认取 `scripts/env.sh` 钉定的 `MAAFW_CORE_REPO` / `MAAFW_CORE_TAG`，需要对齐壳内 MaaFramework 版本时用同名环境变量覆盖。

然后在配方里把 `[[agent.runtimes]]` 的 `bundle` 指向产出的 ZIP，条数与 PI 的 `agent[]` 一一对应。PI 没声明 agent 时，配方里的 `agent` 整段删掉即可。

## 编译型 agent（ELF）

`[[agent.runtimes]]` 只声明一个 ZIP（`bundle`）、包内可执行体路径（`exec`）、要标记可执行的文件（`executables`）、命令行（`args`）、工作目录（`working_dir`）与环境（`env`）。Rust 侧每次运行给每个 runtime 起一个 `AgentClient` TCP，端口经 `{identifier}` 占位符传给子进程；Kotlin 侧用 `ProcessBuilder` 直接执行 `exec`。C++ / Go / Rust 单文件 ELF（或二进制 + 共享库）把可执行体放进 bundle 即可，配方写法见 [打包规则与配方说明](../src-tauri/profiles/README.md)。

编译型 agent 的包体约束：

- **包体**：bundle 是普通 ZIP，须满足无符号链接、条目数不超 0xFFFF，且构建期 `validateAgentBundle` 强制包内含 `lib/<abi>/libMaaAgentClient.so` 与 `libMaaAgentServer.so`。子进程真正需要的是 Server 库（链接它，或经 `MAAFW_BINARY_PATH` / `LD_LIBRARY_PATH` 加载）；Client 库只被壳内宿主进程使用，但每个 bundle 仍必须带上。
- **打包工具**：优先用 `scripts/pack_compiled_agent.py` 打包单 ELF agent；用普通 `zip` 时自行保证无符号链接、条目数不超 0xFFFF。
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
LD_LIBRARY_PATH = "{bundle}/lib/{abi}"
MAAFW_BINARY_PATH = "{bundle}/lib/{abi}"
```

单文件 ELF 可直接用仓库脚本出包，它会把 ELF 放到 `bin/<name>`、复制两个 Maa agent 库到 `lib/<abi>/`，并写入可执行位与确定性时间戳：

```bash
python3 scripts/pack_compiled_agent.py \
  --elf /path/to/my-agent \
  --name my-agent \
  --abi arm64-v8a \
  --maa-dir vendor/maa/android \
  --out /path/to/compiled-agent-runtime.zip
```

如果手写 bundle 目录，出包只需把目录压成 ZIP，`exec` 与 `executables` 指向的文件在设备端会被 `AgentRuntimeManager` 自动标成可执行：

```bash
cd <bundle 目录>
zip -r compiled-agent-runtime.zip .
```
