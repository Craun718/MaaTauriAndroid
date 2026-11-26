# Agent runtime 构建

资源的 `interface.json` 声明了 agent（自定义识别器 / 动作）时，APK 需要随包携带对应的运行时 ZIP：一个能在 Android 上跑起来的 Python（或编译型）agent 载荷。本文讲这个 ZIP 是怎么构建出来的。

协议层的配方写法（`[[agent.runtimes]]`、占位符、条数对应关系）见 [打包规则与配方说明](resource-packaging.md)，本文只讲构建。

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

出包时它由配方的 `bundle` 指向，构建进 APK 的 assets；设备上由 `AgentRuntimeManager` 解包到应用私有目录，按 `[[agent.runtimes]]` 拉起子进程。ZIP 有两条硬性约束（`ZipSafety` / `AgentRuntimeZip` 强制）：

- **不能含符号链接**——打包时解引用成普通文件，解不开的链接直接报错；
- **不能触发 ZIP64**——条目数上限 0xFFFF，超限直接失败，而不是产出一个设备端打不开的包。

## 已有本地资源：构建 Python runtime

先看资源的 `interface.json`：未声明 `agent` 就不需要 runtime ZIP，配方也不要写 `[agent]`。使用 C++、Go 或 Rust agent 时，见下方「编译型 agent（ELF）」。以下步骤只适用于 Python agent。

从 MaaTauriAndroid 仓库根目录运行：

```bash
scripts/build-agent-runtime.sh \
  --project-dir "/path/to/your/resource" \
  --out "/path/to/your/resource-agent-runtime-arm64-v8a.zip"
```

把两个示例路径分别替换成你的资源目录和 ZIP 输出位置。脚本使用资源目录里的 `requirements.txt`；文件在别处时用 `--requirements` 指定。如果没有额外 Python 依赖，传一个空的 requirements 文件即可。这个脚本只组装 runtime，不克隆资源，也不修改 `interface.json`。

默认目标是 `arm64-v8a`。如需 `x86_64`，加 `--abi x86_64`，并让 ZIP 文件名、配方中的 `{abi}` 和 APK 的目标架构一致。其他参数见 `scripts/build-agent-runtime.sh --help`。

把产出的 ZIP 填到配方的 `[[agent.runtimes]].bundle`；每个 agent 对应一个 ZIP，按 `interface.json` 中的声明顺序填写。ZIP 不提交到 Git。配方与 APK 命令见[资源接入](resource-packaging.md)。如果直接用 Tauri/Gradle 出包，先用 `scripts/setup.sh` 下载与目标 ABI 对应的 APK 原生库；下面的 `build_apk.py` 会自己准备原生库。

## 在 CI 中从 Git 提交构建

已有资源目录时跳过本节。`build-resource.py` 只在 GitHub Actions 中运行，用来从同一个提交重建资源和 runtime。它将资源检出到 `resource/<id>`，不会覆盖已有目录；随后下载对应 ABI 的 MaaFramework 原生库、整理 PI，再调用上面的 runtime 脚本。

在 workflow 的 `run` 步骤中使用，例如：

```bash
python3 scripts/build-resource.py \
  "https://github.com/example/resource.git" \
  --id my_project --ref commit_hash
```

把 URL 和 `commit_hash` 换成资源仓库地址与实际提交哈希。默认输出 `resource/my_project-agent-runtime-arm64-v8a.zip`。**只有资源仓库依赖 Git 子模块时才加 `--submodules`**，脚本会递归检出各子模块锁定的提交。它与 Python 依赖安装无关。

如果只准备资源、不构建 Python runtime，例如资源没有 agent，或要自己交叉编译 agent，加 `--skip-runtime`。

## 从本地配方构建 APK

`scripts/build_apk.py` 从已有资源目录和本地配方构建 APK。对 Python agent，可选以下方式：

| 配方或选项 | runtime 处理 |
| --- | --- |
| 配方没有 `[agent]` | 不准备 runtime |
| 默认 | 从源码构建 core，再组装 Python runtime |
| `--use-prebuilt-core` | 下载预编译 core，再组装 Python runtime |
| `--reuse-runtime-zip` | 复用配方中的所有已有 ZIP，不重新组装 runtime |

默认模式和 `--use-prebuilt-core` 都只组装配方中的第一个 runtime。若配方声明了多个 runtime，先分别准备好所有 ZIP，再用 `--reuse-runtime-zip` 构建 APK。自行打包的编译型 agent 也用这个选项。

复用时会逐个检查 ZIP 是否含目标 ABI 的两个 Maa agent 库。Python ZIP 必须有版本清单；Python ZIP 和带清单的编译型 ZIP 都会核对清单里的 ABI 和 MaaFramework 版本。旧的编译型 ZIP 没有清单，只有 APK 使用带版本标记的标准原生库时，Gradle 才会用 SHA-256 比对 ZIP 内的两个库。新打包的编译型 agent 请用下文的 `pack_compiled_agent.py` 生成带清单的 ZIP。

`build_apk.py` 的旧参数 `--skip-runtime` 是 `--reuse-runtime-zip` 的兼容别名；它与 CI 脚本里「只准备资源」的 `--skip-runtime` 用途不同。

## 流水线三步

`scripts/build-agent-runtime.sh` 做三件事：

1. **组装 Python 核心 + site-packages**：仓库内 `scripts/build_agent_bundle.py`（vendored 自 MaaFwApp，AGPL-3.0，来源 commit 见文件头；升级脚本时手动同步副本并同步头注释）从 MaaAgentCoreAndroid 的 release 下载预编译核心（CPython + 标准库 + `maa` 包，仓库与版本由 `MAAFW_CORE_REPO` / `MAAFW_CORE_TAG` 钉定，缓存在 `.cache/maafw/`），再用资源项目自己的 `requirements.txt` 装依赖——Android 轮子来自 Chaquopy 索引（`--extra-index-url https://chaquo.com/pypi-13.1/`），装完剪掉排除列表里的包，纯 Python 的收进 `pure.zip`。
2. **备 agent 库**：仅当 `vendor/maa/android/<abi>/.maafw-version` 与 `MAAFW_VERSION` 一致且两个库均存在时，复用其中的 `libMaaAgentClient.so` / `libMaaAgentServer.so`；否则使用该版本的缓存或从 MaaFramework release 下载对应架构。直接用 Tauri/Gradle 构建 APK 前，使用 `scripts/setup.sh <abi>` 准备配套的壳内原生库。
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

构建机需要与目标 Python 主次版本一致的 Python（默认 3.13）、Android SDK、NDK 29.0.14206865、CMake 3.31、Ninja、Git、packaging 和 CPython 的构建工具。`ANDROID_HOME` 指向 SDK；NDK 优先取 `ANDROID_NDK_HOME` / `ANDROID_NDK_ROOT`，否则取 `$ANDROID_HOME/ndk/29.0.14206865`。

```bash
python3 scripts/build_agent_core.py \
  --python-version 3.13.15 --maafw-version 6.0.0b3 \
  --work-dir build/agent-core --jobs 2

scripts/build-agent-runtime.sh \
  --project-dir "/path/to/your/resource" --out /tmp/agent-runtime.zip \
  --core build/agent-core/dist/agent-core-3.13.15-arm64-v8a.tar.gz
```

也可手动触发 `.github/workflows/agent-core.yml`，从 `android-python-agent-core-<commit>` artifact 下载两种 ABI 的 core、构建元数据和哈希。MaaFramework 版本输入留空时读取根目录 `.maafwversion`。该工作流只上传构建产物，不发布 release，也不修改已有 core tag。构建时检查 ELF 架构、文件布局及 RECORD 哈希；Python 导入、OpenCV 运算和 ORT 模型推理仍需 Android 真机验证。

core 的 `provides` 会声明这两者及 ORT 的依赖，runtime 组装会跳过 requirements 中对应项的版本钉定；`opencv-python-headless` 也映射到 core 的无 GUI OpenCV，不提供 `opencv-contrib-python`。OpenCV 这里的版本是源码版本 `4.12.0`，不包含 PyPI wheel 的打包后缀。完整依赖锁建议传 `--no-deps`，避免 pip 为传递依赖重新解析 core 已包含的原生库。

### 下载预编译 core

MaaFramework 版本集中在仓库根目录 `.maafwversion`（单行 release tag），`scripts/env.sh`、Rust 构建和资源 APK CI 共用该文件。预编译 core 的来源和 tag 仍配置在 `scripts/env.sh`（CI 中的 core tag 需同步）。独立组装 runtime 时可用同名环境变量选用另一套相互匹配的版本；MTA 自身的 APK 构建要求原生包匹配 `.maafwversion` 中与 Rust 绑定配套的版本：

| 变量 | 值 | 作用 |
|:---|:---|:---|
| `MAAFW_VERSION` | `v6.0.0-beta.3` | 从 `.maafwversion` 读取的 MaaFramework 原生库版本（`vendor/maa` 与兜底下载） |
| `MAAFW_CORE_REPO` | `Craun718/MaaAgentCoreAndroid` | 预编译 Python 核心的来源 fork |
| `MAAFW_CORE_TAG` | `agent-core-3.13.15-maafw6.0.0b3` | 核心版本（PyPI 包版本为 `6.0.0b3`） |

下载或复用缓存时，组装脚本会按仓库、release tag 和 ABI 对照 `scripts/build_agent_bundle.py` 中固定的 SHA-256，校验通过后才重新解包。如果缓存校验失败，构建会停止；可删除报错所指的归档后重试。更换远程 core 时需同步录入可信的 SHA-256；显式传入 `--core` 的本地产物由调用方自行验证。

对齐规则：核心自带的 Python `maa` 包版本**覆盖** `requirements.txt` 里的 `maafw` 钉定，所以升级 MaaFramework 时必须连 `MAAFW_CORE_TAG` 一起换。Python agent 与原生库之间走 AgentClient/Server IPC；v6.0.0-beta.3 使用协议 9，不要与 5.x 的库混用。组装时会在安装依赖前核对 core 清单的 ABI 和版本；Git tag `v6.0.0-beta.3` 与 Python 版本 `6.0.0b3` 视作同版。

默认预编译 core 不含 Python `onnxruntime`。资源项目确实需要它时，可通过 `--core` 提供带 Android 对应实现的 core，或发布新 core 后更新 tag。

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

## 编译型 agent（ELF）

`[[agent.runtimes]]` 只声明一个 ZIP（`bundle`）、包内可执行体路径（`exec`）、要标记可执行的文件（`executables`）、命令行（`args`）、工作目录（`working_dir`）与环境（`env`）。Rust 侧每次运行给每个 runtime 起一个 `AgentClient` TCP，端口经 `{identifier}` 占位符传给子进程；Kotlin 侧用 `ProcessBuilder` 直接执行 `exec`。C++ / Go / Rust 单文件 ELF（或二进制 + 共享库）把可执行体放进 bundle 即可，配方写法见 [打包规则与配方说明](resource-packaging.md)。

编译型 agent 的包体约束：

- **包体**：bundle 是普通 ZIP，须满足无符号链接、条目数不超 0xFFFF，且构建期 `AgentRuntimeZip` 强制包内含 `lib/<abi>/libMaaAgentClient.so` 与 `libMaaAgentServer.so`。子进程真正需要的是 Server 库（链接它，或经 `MAAFW_BINARY_PATH` / `LD_LIBRARY_PATH` 加载）；Client 库只被壳内宿主进程使用，但每个 bundle 仍必须带上。
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
cd "/path/to/bundle"
zip -r compiled-agent-runtime.zip .
```
