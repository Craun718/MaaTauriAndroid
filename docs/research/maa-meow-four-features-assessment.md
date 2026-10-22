# MAA-Meow 四项能力复核与移植建议

日期：2026-10-22。MaaTauriAndroid 基线：`93e1b15`；MAA-Meow 最新 upstream/main：`f41ad2d955388cbab2dda161b8ba5e2f143df8b0`。以下评估描述实现前基线，来自提交 diff 和源码静态阅读；用户随后要求逐项实现，工作区落地范围见末节「本轮实现」。未编译、运行测试或真机验证。

## 仓库同步与关联聊天

本地仓库 `/home/gxrs/coding/clone-github/MAA-Meow` 的 reflog 显示 origin/main 已从 `aa9193f` 更新到 `f41ad2d`。本次重新 fetch upstream/main 与 origin/main，两者差异为 `0 / 0`；执行普通 push `upstream/main → origin/main` 返回 `Everything up-to-date`，再用 `ls-remote` 核对 origin/main 为上述完整 `f41ad2d`。本地 main 也为同一提交。当前开发分支仍为 `feat/default-task`（`fb2adab`），工作区干净，没有切分支、强推或合并开发分支。

已读取关联聊天 `01a11aa5-8e9b-7e51-a3bd-70c0bda31165`。它处理的是 MaaFwApp PR #36 的 RunLauncher 合并冲突：保留不抢占运行的语义，并合入日志 label。聊天报告合并提交 `b437656` 已推送；这是当时聊天的记录，不是本次验证 PR 现态。该 PR 不等于下面四个 MAA-Meow 提交，也不是“失败信息聚合”的实现来源。

## 实现前结论

| 能力与原始提交 | 本项目基线结论 | 建议 |
| --- | --- | --- |
| [aa9193f：virtualdisplay fallback](https://github.com/Aliothmoon/MAA-Meow/commit/aa9193f9a11eb1f1cfa71ed5fb917487cb94f3de) | 当前仍是单组 flags 创建，没有同等权限降级 | 优先适配：分档创建、实际能力诊断、兼容档警告 |
| [a9b681d：App／游戏历史退出原因](https://github.com/Aliothmoon/MAA-Meow/commit/a9b681d789eeb24b5ab0cdddbb0de5fecf50f32b) | 已于前一轮移植，包含查询失败隔离和游戏死亡紧急补查 | 保留现有实现，补设备验证即可 |
| [dbdf760：用户目录不可访问诊断与指引](https://github.com/Aliothmoon/MAA-Meow/commit/dbdf760efb113de3820c5583242d4fa80618b387) | 有部分 Root 环境／属主修复，但缺少同等目录探测和分类指引 | 适配诊断与指引，围绕本项目 runtime 目录实现 |
| [235fb3a：任务失败信息聚合](https://github.com/Aliothmoon/MAA-Meow/commit/235fb3a711055790a75708188433259730864c6d) | 有失败原因与首个失败保留；缺少显式稳定的遥测归组 | 适配 fingerprint 设计，不复制 MAA 专属回调结构 |

## 1. VirtualDisplay 分档 fallback

原提交将建屏参数拆为基础 flags 与版本相关档位。Android 13+ 先申请可信、独立显示组、始终解锁等能力；Android 14+ 再带独立焦点相关位。只在 `SecurityException` 时尝试下一档；其他异常不被当作权限不足吞掉。兼容档去掉可信／独立组／始终解锁等权限敏感能力，保留触摸反馈禁用。成功后记录所用 tier、实际 Display flags 和 display group，运行日志提示能力降低，遥测附 `vd.tier`。

上游提交说明以 Android 15 QPR2、MuMu 15、redroid15 的 shell 权限差异为背景；这些具体设备现象本次没有复现。应当把它视为上游报告的兼容目标，不能声称本项目已在这些设备验证。

本项目切入点：[PrivilegedControlServiceImpl.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/PrivilegedControlServiceImpl.kt:71) 的 `startVirtualDisplay`。目前按 SDK 拼出单个 flags 整数后直接创建。建议抽纯逻辑的档位生成／重试策略，保留现有 ShellIdentityContext、IME 隐藏、分辨率稳定和资源释放流程；只降级权限异常，并保证所有档失败时清理资源。

不能把成功返回 displayId 当作完整能力成功：兼容档可能跟随主屏熄屏／锁屏，注入也可能抢主屏焦点。将 tier、requested flags、effective flags、groupId 沿现有控制桥返回，在启动运行日志显示具体限制；这比仅写 Android logcat 更容易排障。注意 VirtualDisplay 创建参数和 Display.flags 的位定义不同，不能共用同一套数值解码。当前本项目基础 flags 还包含 PRESENTATION，与上游明确不申请该位不同；是否去掉应作为单独的行为选择，不能在移植 fallback 时无说明地修改。

本项目最新 `93e1b15` 的 wake lock 与 stream watchdog 解决电源保持／画面停滞问题，并不代替权限降级；wake lock 也不能恢复兼容档丢失的独立显示组和始终解锁能力。

另外，本次同步新增的 [95b27c5：Legacy／VDM 模式选择](https://github.com/Aliothmoon/MAA-Meow/commit/95b27c50a801e067447d24ce5629f83cfb9fa27b) 是更大的后续功能。最新 `BackgroundDisplay` 根据设置选后端；选 VDM 失败不会自动回退 Legacy，VDM 内部另有 alwaysUnlocked／trusted 的四档组合。不要把原提交的 Legacy flags fallback 与新增 VDM 后端混为一项。本次建议先补现有后端的 fallback，VDM 另立范围评估。

VDM 当前源码还要求进程的 uid 与 euid 都永久为 shell；本项目 API 34+ Root 后端仍保留 root，因此不能直接复用这条 VDM 启动路径。该限制来自上游实现的显式检查，不能推定所有 VDM 用法都必然需要同样的进程策略。

## 2. 历史进程退出原因已经落地

原提交在 App 启动查询自身退出记录，服务连接后和游戏消失时查询游戏历史记录，记录 reason、detail、status、importance、PSS／RSS、description，首次最多三条，并按包名的时间／pid 水位去重。后续上游 `1ca1989` 把整个诊断事务纳入异常隔离。

本项目的已落地记录是 `8bf6e21` 与 `3b0db76`，参见 [移植落地记录](maa-meow-porting-status.md)。代码位于 `control/ProcessExitHistory.kt`，App 启动、提权服务初始化时的遗留目标包查询及运行中游戏状态探测已有入口；紧急补查避免轮询节流漏掉刚发生的游戏死亡。无需再实现一套记录器。

这不是逐字段完全一致的复制：当前记录基础 reason／description 等信息，没有上游隐藏 subreason 的反射增强，预期退出分级也更粗。可以按排障需要再补可读 reason／可选 subreason；不能把隐藏接口失败变成运行失败。

平台边界：历史退出 API 从 Android API 30 起提供，跨 UID 包查询要求 DUMP 权限，系统历史是有限环形缓冲区，因此不能把它当成完整审计记录。依据：[Android ActivityManager 官方文档](https://developer.android.com/reference/android/app/ActivityManager#getHistoricalProcessExitReasons(java.lang.String,int,int))。更低系统应保持跳过，ROM 的记录完整性及跨包查询仍须设备验证。

## 3. 目录诊断应针对本项目的权限边界

上游 `UserDirProbe` 已有建目录／写探针；本提交让失败原因附带最近存在父目录的 uid，以及 `/proc/self/mountinfo` 中覆盖目标路径的最深挂载点与文件系统类型。UI 将提示扩展到独立目录：可用 Root 启动一次修复，或切回应用目录并重启。这是“失败时说明谁能访问哪条路径”，不是遇到任何文件错误都自动换目录。

本项目没有同构的“MAA 用户目录二选一”。Android 提权侧 agent runtime 使用 `/data/local/tmp/maa-tauri-android`，Rust 的 app_data_dir 则承载配置／日志等；两个权限主体和用途应分别检查。`AgentRuntimeManager.prepare` 的 staging 创建／发布是适合增加探针的位置。已有 Root namespace 日志及受限 runtime 树属主修复，不能据此认定全部存储问题已经可诊断或自动修复。

建议返回结构化错误：操作、路径、errno／异常类型、当前 uid/gid、最近父目录 uid/gid／权限、挂载类型。前端按可确认原因给 en／zh 指引，例如重新连接 Root 后端、重新准备 runtime；只对明确归本应用管理的目录执行修复。Root 高版本仍可能保留 root，不能无条件提示“Root 启动一次必然修好”。挂载只读、SELinux、空间不足与属主错误也不能混为一类。

探测必须在实际访问目录的进程中执行：App 内 Rust 使用的资源／日志目录应在其访问边界诊断，提权 agent runtime 则在提权进程诊断，不能用 App 的挂载视图解释服务的访问失败。上游本次也没有新增 Root 修复器；目录切换提示只按当前目录类型选择，并不根据诊断内容自动判定根因。

## 4. 失败聚合实为遥测归组稳定化

`235fb3a` 的核心变化：去掉 `first`／`pre_task` 任务名里的 `0x…@` 实例地址；从 Sentry fingerprint 和标题中移除不稳定的 `pre_task`，保留为 tag。相同根因在不同运行里会落入同一个 issue，同时仍能按前驱任务筛选。它没有新增“收集所有任务失败并展示”的 UI。

更准确地说，它减少这些字段造成的拆组，其他 fingerprint 字段变化仍会产生不同分组；同轮截图附件去重也使用此指纹，但重复截图不等于错误事件被吞掉。依据：[TaskFailure](https://github.com/Aliothmoon/MAA-Meow/blob/235fb3a711055790a75708188433259730864c6d/app/src/main/java/com/aliothmoon/maameow/telemetry/TaskFailure.kt#L79-L137)、[IncidentReporter](https://github.com/Aliothmoon/MAA-Meow/blob/235fb3a711055790a75708188433259730864c6d/app/src/main/java/com/aliothmoon/maameow/telemetry/IncidentReporter.kt#L46-L105)。

本项目 [runtime.rs](../../src-tauri/src/runtime.rs:1390) 的 `FailureLog` 保留第一个失败，后续任务可以继续并记录实时日志；这和 Sentry issue 归组是两个层次。[telemetry.rs](../../src-tauri/src/telemetry.rs:154) 目前直接 `capture_message`，而 [lib.rs](../../src-tauri/src/lib.rs:3389) 会将完整 diagnosis 拼入上报消息，未设显式业务 fingerprint。诊断文本变化是否在 Sentry 后台造成拆组尚未通过事件样本确认，但确实缺少稳定归组的应用侧契约。

建议以项目标识、失败类型／diagnostic code、稳定 task entry 和必要节点名构建显式 fingerprint；运行 id、pid、时间、前驱节点、可变诊断全文留在 tags／extra，不参与分组。保留完整日志和首个失败的队列语义。本项目使用 MaaFramework，不能照搬 MAA 的 AsstMsg、taskChain、ProcessTask 解析；也不应未经证据就对任意 PI 节点名全局删除 `0x…@`，以免改写合法名称。先覆盖实际 MaaFramework 回调中的不稳定字段。

## 后续范围与验证

### 2026-10-22 本轮实现（工作区未提交）

- 虚拟屏：新增 `VirtualDisplayPolicy`，保留原基础 flags 和 PRESENTATION，SDK 33+ 仅在权限异常时尝试兼容档。创建后处理失败会释放显示；释放时重置能力状态。AIDL 新增固定 transaction 28，RuntimeBridge 在原状态数组后追加 tier／requested flags／effective flags／group id，Rust 解析为可选 `capabilities`。旧格式及未知能力按未知处理。预览卡与运行日志补中英文兼容提示；`vd.tier` 在每轮启动／结束清除，事件捕获时应用，避免 async 换线程丢失或前台运行继承旧值。
- 目录：提权侧新增 `DirectoryAccess`，在 runtime staging／runtime 目录建目录及独占随机文件写读探测，并对发布失败和具有明确文件系统 errno 的后续准备失败补诊断。错误带操作、路径、kind、errno、uid/gid、可读取的最近存在祖先和最深挂载信息；可选取证失败不覆盖原始失败。JNI 保留 Binder 异常正文，Rust 和前端解析 `MTA_DIRECTORY_ACCESS` 协议，前端按确认的原因提供 en／zh 指引。App 内 MaaFramework 日志目录由 Rust 独立探测，失败只告警。没有新增目录切换或扩大 Root 修复范围。
- 遥测：任务失败显式使用项目名、固定类别、原样任务入口、状态、diagnostic code 构造指纹；准备阶段使用稳定的阶段类别，目录失败再按 scope／operation／kind 区分。标题不拼动态诊断；完整诊断放在 `failure.details`。已有首失败、队列继续、截图采样、遥测同意门槛保留，没有假设 MaaFramework 节点带 MAA 的实例地址格式。
- 死因记录：复核已有 `ProcessExitHistory`、`ExitHistoryTransaction` 和 `ExitQueryQueue` 及其测试，本轮没有重复实现或新增隐藏 subreason 查询。

新增业务测试源码覆盖 flags／权限重试／末档失败、状态数组兼容与能力降级判断、挂载路径边界与转义、诊断失败隔离、目录探测清理、错误协议正常／损坏路径、指纹同因稳定／异因分离与合法入口保留。没有新增 UI 渲染或语言切换测试。

本轮仅运行格式化与 `git diff --check`，没有本地编译、typecheck、测试、构建或真机验证。代码尚未提交／推送，暂无本轮 CI 结果；前端和 Rust 测试等待现有 CI，Kotlin 单测由 `m9a-android`／`maaend-android` 的现有 app unit-test 步骤运行。仍须验证 Root／Shizuku 权限裁剪、熄屏／锁屏、主屏焦点、目录访问故障和 Sentry 实际事件归组。

建议顺序为：VirtualDisplay fallback → runtime 目录诊断与分类指引 → 稳定遥测 fingerprint。历史死因沿用已落地实现。适配应按本项目 Kotlin／AIDL／JNI／Rust／React 边界重写；MAA-Meow 与本项目的根许可证分别为 AGPL-3.0 与 LGPL-2.1，不能把整份产品代码当成无条件可直接 cherry-pick 的依赖。

若进入实现，业务测试覆盖：各 SDK 档位、仅权限异常重试、末档失败、档位清理；目录探针成功与失败／最深挂载匹配／诊断自身失败；同因 fingerprint 稳定、异因分离、合法节点名保留。测试交 CI 跑；Android Kotlin／AIDL 编译和真机需单独验证，Android Rust check 不能替代。设备覆盖 Root／Shizuku、权限裁剪系统、熄屏锁屏、主屏焦点、Root→Shizuku 切换与目录只读。本文没有宣称这些验证已通过。
