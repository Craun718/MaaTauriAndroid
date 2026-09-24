# 资源接入

MaaTauriAndroid 本身不包含业务资源。资源开发者写好 Project Interface 之后，用一份 TOML profile 告诉本仓库「资源在哪、包名叫什么、agent 怎么拉起」，再出 APK。

资源在**构建期**打进 APK。换资源就要重新出包，不能在设备上换一份 `interface.json` 接着用。

开发资源前请先读 [Project Interface V2 协议](https://github.com/MaaXYZ/MaaFramework/blob/main/docs/zh_cn/3.3-ProjectInterfaceV2%E5%8D%8F%E8%AE%AE.md)。本应用面向发布后的配置与运行；写 Pipeline、对识别请用 MaaFramework 提供的调试工具。

配方字段的完整注释见 [`pi-profile.sample.toml`](pi-profile.sample.toml)。

## 环境

- JDK 17、Android SDK
- Python 3（下载 MaaFramework 产物、组装 Python agent）
- 一份 `interface_version` 为 `2` 的资源项目
- `arm64-v8a` 设备或镜像（当前 APK 只收这一个 ABI）

MaaFramework 原生库和 agent runtime 不在 profile 里，先铺环境：

```bash
scripts/setup.sh   # 子模块 + vendor/maa/android + 内置 agent runtime
```

## 打包配方

把 `pi-profile.sample.toml` 拷到仓库外改好，然后：

```properties
# src-tauri/gen/android/local.properties（不进 git）
pi.profile=/absolute/path/to/your-pi-profile.toml
```

或设环境变量 `PI_PROFILE`、传 Gradle 属性 `-Ppi.profile`。`pi.profile` 的读取顺序是 Gradle 属性、`local.properties`、`PI_PROFILE`。`pi_assets` 必须是包含 `interface.json` 的目录。

TOML profile 使用 snake_case 键。相对 `pi_assets` 和 `bundle` 路径相对**配方文件自己所在的目录**；相对 `maa_dir` 路径相对**仓库根**。

最小例子：

```toml
pi_assets = "/path/to/your-pi"

resource_id = "yourpi"   # 拼成 top.natsuu.mta.yourpi
app_name = "Your PI"
```

`resource_id` 只收小写字母、数字、下划线，且不能以数字开头；省略时是 `fixture`。可选的 `app_name` 设置 Android 桌面图标名称和 Activity 标题；省略时构建使用 `MaaTauriAndroid`。`maa_dir` 缺省为 `vendor/maa/android`，它是打包进 `jniLibs` 的 MaaFramework 库目录。

`pi_include` 只能**额外**加：它列出的是 `interface.json` 推导集合之外、还需要打包的相对 `pi_assets` 路径。列出的路径不存在也会让构建失败。`pi_exclude` 会被直接拒绝：推导集合不能被裁剪，写它只会得到一个静默无效的过滤器。

可选 `[signing]` 给 release APK 签名。没有 `[signing]` 时 release 保持未签名；签名后要长期复用同一个 keystore，Android 拒绝用不同签名覆盖安装。keystore 和密码不要提交进仓库。

### 仓库内置配置

本仓库用 submodule 的形式内置了 M9A、NarutoMobile、MAAPVZ，profile 放在资源旁边并使用相对路径，这样同一份 profile 在每个 checkout 上都能工作：

- `resource/m9a`、`resource/m9a.toml`：M9A 的 submodule 和 profile
- `resource/narutomobile`、`resource/narutomobile.toml`：NarutoMobile 的 submodule 和 profile
- `resource/maapvz`、`resource/maapvz.toml`：MAAPVZ 的 submodule 和 profile

对应的 Python agent runtime 由 CI 每次重新构建，是 `resource/*-agent-runtime-arm64-v8a.zip` 构建产物，不提交。某个 checkout 要使用仓库内资源，设：

```properties
pi.profile=/path/to/repo/resource/m9a.toml
```

### 打包集合由推导得到，而不是显式列出

基础集合从来不会被列出。`PiPackage` 读取 `interface.json`，并跟随协议自身的引用：

| 来源 | 被打包内容 |
| --- | --- |
| `resource[].path`、`controller[].attach_resource_path` | 加载根目录（递归） |
| `import[]` | 任务/选项/预设文件，并继续读取以到达嵌套图标 |
| `languages{}` | 已声明的翻译文件 |
| 任意深度及每个导入文件中的 `icon` / `contact` / `license` / `description` / `doc` / `desc` / `welcome` | 当值指向文件时打包该文件，包括 `$Key` 查表和 Markdown 图片链接 |
| `agent`（对象或数组） | 包含 `child_args` 入口点的 `agent` 目录 |
| — | `data/`，Agent 会读取它，但协议不会声明它 |

接口声明了、但项目中并不存在的路径会**使构建失败**，因为无声的错误打包正是以这种方式进入产物的。M9A v4.9.0 把 `i18n/` 改名为 `locales/`；旧的许可名单没有匹配到任何内容，构建仍然通过，最终 APK 里的接口指向了自身压缩包中不存在的翻译文件，在真机上导致硬性的项目加载失败。

被文档描述为“文件路径、URL 或纯文本”的值只在能解析为现有路径时才被当作路径处理，因此普通文字和远程 URL 会原样保留。绝对路径和 `..` 逃逸会被忽略。开发残留物（`__pycache__`、`.git`、`node_modules`、`.venv`、`*.pyc`/`*.pyo`）会在复制时被过滤掉。

## 资源约定

按桌面端习惯写即可，下面几条是 Android 上会对不上的地方：

| 桌面端 | 在 MaaTauriAndroid 里 |
| --- | --- |
| 把资源放到工作目录旁 | 构建期打成 `assets/pi.zip`，设备上解包到应用私有存储，换资源重新出包 |
| `agent.child_exec` / `agent.child_args` 决定怎么起 agent | `child_args` 只参与打包，让 `agent/` 和入口文件进包；实际命令行由 profile 的 `exec` + `args` 决定 |
| 应用名、图标来自 PI 顶层 `label` / `icon` | 图标从 `interface.json` 的 `icon` 生成，应用名来自 profile 的 `app_name` |
| 改完资源刷新即可 | 资源随 APK 绑定，重装或清数据后生效；改 profile 也会改变打出的 APK |

`contact` / `license` 指向文件时，对应文件随 PI 打包，不需要在 profile 里另写条目。

## Agent

资源的 `interface.json` 里声明了 `agent` 才需要这一节。没声明就把 TOML 里的 `agent` 整段删掉。

声明了却没配齐运行时，构建会直接失败，不会默默跳过。`interface.json` 的 `agent` 是对象时按 1 个算，是数组时有几个算几个；`[[agent.runtimes]]` 条数必须和它按顺序一一对应。

每个 runtime 是一个 ZIP：

- `bundle`：本地 runtime ZIP 路径，相对 profile 所在目录
- `exec`：ZIP 内的入口文件，相对 bundle 根，例如 `bin/python3`
- `executables`：ZIP 内需要显式标记成可执行的文件列表
- `args`：实际命令行参数
- `working_dir`：工作目录，通常写 `{pi}`
- `env`：可选，传给子进程的环境变量

`args`、`env` 和 `working_dir` 里可以用四个占位符：

- `{pi}`：解包后的 Project Interface 根目录
- `{bundle}`：runtime ZIP 解包后的根目录
- `{identifier}`：本次运行分给该 agent 的 TCP 端口
- `{nativeLib}`：应用原生库目录（`applicationInfo.nativeLibraryDir`）

`identifier` 不会像某些桌面端方案那样自动追加到命令最后；必须把 `{identifier}` 写进 `args`。子进程要实现 MaaFW 的 AgentServer 侧，监听这个端口，和壳内的 AgentClient 走 AgentClient/Server IPC。

Python 例子：

```toml
[agent]
timeout_ms = 15000

[[agent.runtimes]]
bundle = "/absolute/path/to/agent-runtime.zip"
exec = "bin/python3"
executables = ["bin/python3"]
args = ["-u", "agent/main.py", "{identifier}"]
working_dir = "{pi}"

[agent.runtimes.env]
PYTHONHOME = "{bundle}/prefix"
PYTHONPATH = "{bundle}/site-packages/pure.zip:{bundle}/site-packages"
LD_LIBRARY_PATH = "{bundle}/prefix/lib:{bundle}/site-packages/chaquopy/lib:{bundle}/lib/arm64-v8a:{nativeLib}"
MAAFW_BINARY_PATH = "{bundle}/lib/arm64-v8a"
```

bundle ZIP 有硬性约束，任何语言的 agent 都躲不开：

- 不能包含符号链接
- 不能触发 ZIP64
- 必须包含 `lib/arm64-v8a/libMaaAgentClient.so` 和 `lib/arm64-v8a/libMaaAgentServer.so`

子进程真正需要的是 `libMaaAgentServer.so`，通过 `MAAFW_BINARY_PATH` 或 `LD_LIBRARY_PATH` 加载；`libMaaAgentClient.so` 只由应用宿主使用，但每个 bundle 仍必须携带它。

保持 `libMaaAgentClient.so` / `libMaaAgentServer.so` 的 MaaFramework 版本与 `vendor/maa/android` 中 vendored 的库一致。

### Python

用仓库脚本组运行时，不要自己拼一套 CPython。Python 内核来自 MaaAgentCoreAndroid 的预编译 core，本地只叠资源项目的依赖：

```bash
scripts/build-agent-runtime.sh m9a
scripts/build-agent-runtime.sh narutomobile
scripts/build-agent-runtime.sh maapvz
```

脚本先按 `MAAFW_SCRIPT_REF` 从 [MaaFwApp](https://github.com/Aliothmoon/MaaFwApp) 取 `build_agent_bundle.py`，再把 `CORE_REPO` 替换成 [Craun718/MaaAgentCoreAndroid](https://github.com/Craun718/MaaAgentCoreAndroid)，组装 CPython + 标准库 + `maa` 包 + 资源项目的 `requirements.txt`，最后交给 `pack_agent_bundle.py` 出 ZIP。

`src-tauri/profiles/pack_agent_bundle.py` 是构建 **Python** agent 压缩包的唯一受支持方式：

```bash
python3 src-tauri/profiles/pack_agent_bundle.py \
  <bundle_dir> <agent_lib_dir> <out_zip>
```

它会解引用符号链接、强制非 ZIP64，把两个 `.so` 放进 `lib/arm64-v8a/`，并且额外要求 MaaAgentCoreAndroid bundle 的 `agent-core.json` 标记。

> 注意：原生库由 `MAAFW_VERSION` 固定在 MaaFramework `v5.13.0`；`MAAFW_CORE_REPO` 和 `MAAFW_CORE_TAG` 把 core 固定在 `3.13.15-maafw5.13.0`，所以 bundle 里的 Python `maa` 包保持 5.13.0，core 自带副本会优先于 `requirements.txt` 中的 `maafw` 固定版本。Python agent 通过 AgentClient/Server IPC 与本机 agent 原生库通信，该协议在补丁版本之间保持兼容。

### 编译型（C++ / Go / Rust）

运行时契约与语言无关。编译型 agent（单文件 ELF，或二进制加共享库）直接把自己的文件放进 ZIP，`exec` 指向 ZIP 内入口，`executables` 列出要标记可执行的文件：

```toml
[[agent.runtimes]]
bundle = "/absolute/path/to/compiled-agent-runtime.zip"
exec = "bin/my_agent"
executables = ["bin/my_agent"]
args = ["{identifier}"]
working_dir = "{pi}"

[agent.runtimes.env]
LD_LIBRARY_PATH = "{bundle}/lib/arm64-v8a"
MAAFW_BINARY_PATH = "{bundle}/lib/arm64-v8a"
```

这种 ZIP 不需要 `agent-core.json`，用普通 `zip` 打包即可，但要自己保证无符号链接、不触发 ZIP64、带齐两个 `.so`。`agent.child_args` 要指向资源里的同一入口（编译型就写 ELF 路径），让入口随 PI 打包；实际拉起仍由 profile 的 `exec` 负责。进程通过 `{identifier}` 获得 TCP 端口，并且必须实现 AgentClient/Server IPC 协议。

## 出包

改完 profile 或上游资源后，重新跑构建即可：

```bash
cd src-tauri/gen/android
./gradlew :app:installDebug
./gradlew :app:assembleRelease
```

仓库完整出包流程先运行 `scripts/setup.sh`，再按根 README 的 Tauri 命令出 APK。profile 改变会改变打包出的 APK；这是构建期嵌入，不是运行时开关。移除或清空 `pi.profile` 可回到 `src-tauri/fixtures/pi/minimal` 中的内置 fixture。

`scripts/setup.sh` 和 `src-tauri/profiles/pack_agent_bundle.py` 之外的细节见 [Agent runtime 构建](../../docs/agent-runtime.md)。

## 装上之后

1. 安装资源项目提供的 APK。
2. 授权 Shizuku；root 设备可直接使用，应用内二选一。
3. 第一次打开会解包嵌入的 `pi.zip`；有 agent 时会一并解包 runtime。
4. 选服务器、核对任务、开始。

debug 构建每次的签名可能不同，覆盖安装报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE` 时先卸载再装。

## 常见问题

| 现象 | 原因 |
| --- | --- |
| 构建报 `pi.profile points at a missing file` | profile 路径没写对，或文件不是 TOML |
| 构建报 `resource_id` 不合法 | 只允许小写字母、数字、下划线，且不能数字开头 |
| 构建报 agent 数量对不上 | `interface.json` 的 `agent[]` 和 `[[agent.runtimes]]` 没有按顺序一一对应 |
| 构建报 bundle 缺 `.so` | ZIP 里没有 `lib/arm64-v8a/libMaaAgentClient.so` 和 `libMaaAgentServer.so` |
| 设备端拒绝解开 agent runtime | 包里有符号链接、触发了 ZIP64，或入口不是可执行文件 |
| M9A v4.9.0 构建绿但真机加载失败 | 上游把 `i18n/` 改名成 `locales/`，旧许可名单失配；当前推导集合会直接报缺路径 |

查看运行日志：

```bash
adb logcat -s MaaTauriAndroidControl
```
