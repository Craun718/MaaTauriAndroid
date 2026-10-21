# MAA-Meow 诊断与防护改动移植评估

研究日期：2026-10-21。范围仅限所列 8 项提交；结论来自源码静态审阅，未编译、未运行测试、未进行真机验证，未访问 resource 子 checkout。

比较基线：MaaTauriAndroid 当前源码（本地 git 查询 HEAD 为 `e6a961e`）；MAA-Meow `upstream/main`（fetch 后查询为 `aa9193f`）。逐项执行了 `git show <commit>` 阅读实现差异；需要核对上游最终实现时使用 `git show upstream/main:<path>`，没有把停在 `feat/default-task` 的工作区文件当作 main。本文仅写入本文件，不执行同步、提交或推送。

本地证据链接指向当前源码及起始行；正文注明适用行段。上游提交链接对应原始改动，补充的最终实现路径与行号均来自 `upstream/main`，不代表提交当时的行号。建议属于基于这些证据的工程判断。

## 已确认结论

| 提交 | 本项目实际状态 | 移植判断 |
| --- | --- | --- |
| a9b681d App／游戏死因记录 | 有游戏退出检测、提权进程死亡取证；缺少 App／游戏历史退出原因 | 建议优先适配，不能以现有死亡取证代替 |
| 1ca1989 死因异常隔离 | 尚无上述记录器；现有取证仅部分边界兜底 | 与 a9b681d 一起引入 |
| 99feef6 USB 调试安全设置 | 有启动警告和输入失败结果；缺少属性检测及 Root 修复 | 建议适配；应采用 main 的 Root 二次确认 |
| 59ad1be 定时解锁失败日志 | 有调度与启动日志；没有内置 PIN／手势解锁链路 | 暂缓，随解锁功能建设引入 |
| 152aab5 存储未就绪容错 | 历史日志打开／写入已容错；建目录及调度去重仍可能阻止执行 | 部分等价，建议定点补强 |
| de596a0 回放注入统计 | 有单事件注入结果与触点管理；没有解锁回放统计 | 暂缓；复用结果模型，避免重复实现输入系统 |
| ba517b6 录制时间 API 兼容 | minSdk 同为 28；没有录制时间实现 | 当前无对应缺陷，作为未来实现约束 |
| 6a68c63 配置导入大小限制 | Android 有界复制、Rust 文件预检与解析前限制，均为 4 MiB | 核心已覆盖；需改善 Android 超限错误反馈 |

## 1. a9b681d：记录 App 与游戏进程死亡原因

上游：[a9b681d789eeb24b5ab0cdddbb0de5fecf50f32b](https://github.com/Aliothmoon/MAA-Meow/commit/a9b681d789eeb24b5ab0cdddbb0de5fecf50f32b)。

**作用。** App 启动时在 API 30+ 调用 `getHistoricalProcessExitReasons` 查询自身；服务连接后补查游戏，运行中发现游戏消失也即时查询。游戏查询经提权服务利用跨包查询权限，隐藏 subreason 反射失败时保留基础记录。记录 timestamp、pid、进程名、reason、detail、status、importance、PSS／RSS、description；最多查询 16 条，首次回溯 3 条，以每包 `(timestamp, pid)` 水位去重并同步保存。覆盖安装、正常退出和被调用方 force-stop 的游戏按 INFO，其余 WARN；只落本地应用日志，不直接进入遥测。

上游最终证据：`app/src/main/java/com/aliothmoon/maameow/data/log/ProcessExitRecorder.kt:29–46,69–91`，`data/log/ProcessExitLog.kt:12–82`，`remote/internal/ProcessExitQuery.kt:16–40`（后两路径同属上述 Java 包）。触发挂接可在原提交的 `MaaApplication`、`UnifiedStateDispatcher`、`MaaCompositionService` diff 核对。

**当前已有与缺失。**

- 游戏监控已经在连续两次发现任务不存在后中止运行：[run_supervisor.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/run_supervisor.rs:404)（404–423）。这是存活判定，日志仍只有退出事实，不包含系统死因。
- 已有提权进程断连后记 pid／时间、重连后补取系统 logcat 的链路：[ServiceDeathForensics.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ServiceDeathForensics.kt:16)（16–52）、[ControlServiceClient.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt:377)（377–442）。它只保存最近一次提权服务死亡，不能补查 App 自身或游戏的历史退出。
- [MaaApplication.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/MaaApplication.kt:7)（7–14）没有自身历史退出查询；[控制 AIDL](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/aidl/top/natsuu/mta/IMaaTauriAndroidControlService.aidl:64)（64–104）提供游戏状态和系统日志，没有历史退出记录接口。对本项目 `src/`、Rust 与 Android 源码的语义检索也未发现该 API 或水位记录器。

**建议。** 优先引入 Android 原生记录器，再扩展现有 AIDL 查询受控游戏包；复用本项目实际记录的目标包，不能照搬上游固定游戏包列表。保留 API 30 门槛、数量限制、首次回溯、水位、预期退出分级，并配套下一项异常隔离。历史退出记录与现有 logcat 取证可互补。

**边界。** 现有取证文件还会成为遥测附件：[lib.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/lib.rs:2199)（2199–2211）；上游这项要求只落本地日志，不能直接套用现有附件上报路径。不同厂商返回的历史记录完整性、跨包权限和隐藏 subreason 是否可用均未真机确认；系统接受 force-stop 描述也只能支持分级启发式，不能证明退出由本应用发起。

## 2. 1ca1989：死因记录异常隔离

上游：[1ca198947c7ea51c248208b8467f9d9840bb45fc](https://github.com/Aliothmoon/MAA-Meow/commit/1ca198947c7ea51c248208b8467f9d9840bb45fc)。

**作用。** 将 `recordSelf`、`recordGame` 整个流程置于 `guarded`，覆盖查询以外的偏好读取、格式化、水位持久化等异常；普通 `Exception` 只记 WARN，`CancellationException` 上抛。原实现只保护 API 查询，仍可能从 App 启动协程或游戏死亡处理传播异常。最终源码为上游 `data/log/ProcessExitRecorder.kt:29–57`。

**当前已有与缺失。** 尚无对应记录器，因此不能单独应用此修复。现有取证在 Binder 调用处捕获 `Throwable`，但 `forensics.take()` 位于该 try 之前：[ControlServiceClient.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt:425)（425–442）；其 SharedPreferences 读写在 [ServiceDeathForensics.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ServiceDeathForensics.kt:28)（28–52）也未整体保护。不能据此认定本项目所有死亡取证已经完全隔离。

**建议。** 与 a9b681d 作为同一功能引入；边界应覆盖整个诊断事务，并确保采集失败不延迟既有停止处理。若采用 Kotlin 协程，取消要继续传播；若仍使用普通线程，不应机械复制协程模板。现有取证边界可顺便定点补齐，但本次未修改代码。

## 3. 99feef6：USB 调试安全设置提示与 Root 开启

上游：[99feef6564c3d73940e9ce8692f861b43fb932fd](https://github.com/Aliothmoon/MAA-Meow/commit/99feef6564c3d73940e9ce8692f861b43fb932fd)。

**作用。** 小米 ROM 的 `persist.security.adbinput != 1` 被视为 shell 触控受限。手动启动先提示，任务执行路径写 WARNING，覆盖定时任务；Shizuku 提供开发者设置入口，Root 提供开启并继续启动，以及服务连上后的自动修复。脚本设置 adbinput、fastboot 属性并重启安全中心 remote 进程，最后再次设置并独立读回 adbinput；没有移植 USB 安装相关操作。弹窗同时改为修复优先，并合并设备检查逻辑。

**当前已有与缺失。**

- 已有智能分辨率／护眼检测：[RuntimeBridge.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RuntimeBridge.kt:800)（800–817）、[displayHazards.ts](/home/gxrs/coding/clone-github/MaaTauriAndroid/src/lib/displayHazards.ts:3)（3–20）；提示框只有继续／取消：[RunPanel.tsx](/home/gxrs/coding/clone-github/MaaTauriAndroid/src/components/RunPanel.tsx:484)（484–510）。没有 adbinput 条件和修复入口。
- 输入注入失败已有错误码与通用消息：[InputResult.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/InputResult.kt:23)（23–40），但不能提前识别小米安全设置。Root 后端已经通过 libsu 启动服务：[ControlServiceClient.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt:585)（585–614）。因此具备接入条件，不必新增一套后端。

**建议。** 将检测结果扩展到现有启动警告模型，同时在 Rust 共用启动路径记录 warning，避免仅在手动 UI 提示而漏掉调度。建议先实现准确检测和设置入口，再适配 Root 修复及成功后的重新检测；文案同时进入本项目 en／zh 字典。

**必须注意最终源码差异。** `upstream/main` 的 `manager/MiuiAdbInputEnabler.kt:22–39` 已比原提交多了 Root 侧预读取：若 Root 读到值为 1，跳过脚本，避免 App 误读时重复改属性、重置 USB、杀安全中心。移植应采用这个最终行为。该脚本有系统副作用，不能把属性读取失败直接视为可静默修复的证据。各 ROM 的属性可见性和实际拦截行为未真机验证。

## 4. 59ad1be：定时解锁失败诊断日志

上游：[59ad1be883ac020472f700655c913d34253c1092](https://github.com/Aliothmoon/MAA-Meow/commit/59ad1be883ac020472f700655c913d34253c1092)。

**作用。** 解锁失败时将解锁方式、凭证是否配置、录制时间、是否需要密码、唤醒前亮屏／锁屏状态和提权侧步骤耗时写入触发日志。新增 `getLastWakeTrace(sinceElapsedMs)`，只收本次发起之后的 trace，旧服务或取证失败不改变原任务结局；失败摘要随结果传给遥测。trace 最多 40 行，异常退出也保存已完成步骤。PIN 不记录内容或位数，注入补足到 1 秒预算；手势不记录坐标和步数，送达统计改为 all／partial／none。空回放返回 GESTURE_EMPTY，重录写盘失败时录制时间与内存手势保持一致。

上游最终证据：`remote/internal/WakeTrace.kt:10–33`、`WakeUnlockController.kt:45–50,176–201,244–269,294–302`；原提交的 `domain/launch/LaunchPipeline.kt`、`WakeDiagnosis.kt`、`telemetry/TelemetryController.kt` diff 可核对失败取证隔离与结果传递。

**当前已有与缺失。** 已有调度触发结果和 detail：[schedule.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/schedule.rs:82)（82–100）；但结果枚举没有解锁失败分类。Android 定时服务只等待项目／引擎和连接后端后调用启动：[ScheduleExecutionService.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/ScheduleExecutionService.kt:33)（33–69）；Rust 入口处理后端、抢占与运行启动：[lib.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/lib.rs:5967)（5967–6053），没有凭证读取、唤醒解锁或 trace。控制 AIDL 也没有 unlock／录制接口。检索本项目实际源码未找到 PIN／手势解锁存储链路；闹钟的 RTC_WAKEUP 并不是解除锁屏。

**建议。** 暂缓独立移植。未来建设解锁时，将这项与基础功能同时设计：唤醒前快照、请求关联、有限 trace、异常隔离、脱敏、结果分类缺一不可。不要为了日志直接引入上游整套解锁和遥测依赖。现阶段可改善通用启动失败日志，但不能宣称已有或已修复解锁失败诊断。

## 5. 152aab5：存储未就绪时日志容错

上游：[152aab5ab058e3b204e2b051030db609cef7dfae](https://github.com/Aliothmoon/MAA-Meow/commit/152aab5ab058e3b204e2b051030db609cef7dfae)。

**作用。** 触发日志 `FileWriter` 打开失败时捕获 IOException，改用自定义 NullWriter，任务照常收尾及上报；不使用需要更高 API 的 `Writer.nullWriter()`。另外 `getExternalFilesDir(null)` 为 null 时拼出预期外部私有目录，避免 `File(null, "Maa")` 形成错误根路径并被 lazy 缓存。上游最终 `schedule/service/ScheduleTriggerLogger.kt:45–81`；路径修复详见原提交的 `data/config/MaaPathConfig.kt` diff。

**当前已有与缺失。**

- 已有等价的可选历史 writer：打开失败返回 None，写入／flush 失败不打断运行：[run_log.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/run_log.rs:96)（96–121、176–185）。不能判定这项完全缺失。
- 边界仍不完整：同文件 117 行 `create_dir_all(.../logs)` 失败会返回错误，调用方 [lib.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/lib.rs:2900)（2900–2907）使用 `?` 中断启动。这里目录还承载运行日志，应先区分运行必需文件与可选诊断，不能简单把所有 I/O 错误吞掉。
- 调度记录写入使用 Result：[schedule.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/schedule.rs:214)（214–229）。多处调用为 `let _ =`，但 JNI 调度入口 5975–5977 的 `is_duplicate(...).unwrap_or(true)` 在触发历史不可读时会直接跳过；当前不具备“日志不可用仍照常触发”的完整语义。
- 运行和调度目录取 Tauri `app_data_dir`：[lib.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/lib.rs:5702)（5702–5710），没有上游那个 lazy 外部目录空值构造。Android 分享回退处显式检查外部目录，且在 runCatching 内：[RuntimeBridge.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RuntimeBridge.kt:975)（975–991）；不是同一缺陷。

**建议。** 保留已有 writer 容错，针对运行目录创建和调度历史读失败单独设计降级。去重同时影响重复执行，建议把去重状态与可丢失的诊断历史分离，再讨论无日志继续；不要直接把 `unwrap_or(true)` 改成 false。没有证据支持照搬上游预期外部目录拼接。

## 6. de596a0：解锁手势回放注入统计

上游：[de596a07169f6899a7ad8de6d9924748d32c1674](https://github.com/Aliothmoon/MAA-Meow/commit/de596a07169f6899a7ad8de6d9924748d32c1674)。

**作用。** 回放从专用 SingleTouch 改回复用 InputControlUtils，前后 cancel 清槽，finally 确保中断也清理；统计 down 与全部事件的接受情况，用于区分“注入被拒”和“注入已接受但锁屏仍在”。依赖回放时无任务在跑的前提。原提交输出具体计数，随后 59ad1be 将其收敛为 all／partial／none，避免点按次数暴露 PIN 位数。

**当前已有与缺失。** 本项目已有详细单事件结果和注入返回值：[PrivilegedControlServiceImpl.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/PrivilegedControlServiceImpl.kt:387)（387–410、617–661、768–788），也有 cancelFirst 与成功后更新触点状态。它不是无结果的独立单指实现；但目前没有解锁回放器、批次统计、锁屏结果判定，也没有整次回放前后清槽契约。

**建议。** 随解锁功能适配，复用现有结果码和触点规划，新增批次清理及互斥，不复制上游整套输入工具。统计采用最终脱敏分类，不能单独引入原提交的计数日志。当前输入失败日志会记录 x／y、keyCode 和 textLength（405–407），未来用于解锁时必须另设脱敏出口；游戏触控诊断本身不等于解锁凭证记录。Android 接受注入不代表锁屏已解开，这个区分需要保留。

## 7. ba517b6：录制时间 API 兼容

上游：[ba517b6827886192f943a3558ccc8560c17dedfd](https://github.com/Aliothmoon/MAA-Meow/commit/ba517b6827886192f943a3558ccc8560c17dedfd)。

**作用。** `recordedAtMs()` 不再调用 API 31 的 `AtomicFile.getLastModifiedTime`；本进程优先返回内存时间，否则检查 `.bak`，备份存在时优先取备份 `File.lastModified()`，与 AtomicFile 读取回滚一致。返回值为正才有效。最终源码：上游 `data/preferences/UnlockGestureStore.kt:42–64,83–98`。

**当前已有与缺失。** 本项目 [build.gradle.kts](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/build.gradle.kts:279) 的 minSdk 为 28、targetSdk 为 36，兼容范围相关；但没有解锁手势存储／recordedAtMs，未检出该高版本 API 调用。不能把 Rust 配置原子写入当成这项 Kotlin 录制时间功能。

**建议。** 当前无需独立修复。未来实现时直接采用低 API 文件时间方案，保持备份优先和内存时间一致，并把读不到时间作为可选诊断缺失处理。文件修改时间也不是可信审计时间；本次未验证具体设备文件系统行为。

## 8. 6a68c63：导入配置文件大小限制

上游：[6a68c6354ea483ec99fd8aa9373f6e487be8b03f](https://github.com/Aliothmoon/MAA-Meow/commit/6a68c6354ea483ec99fd8aa9373f6e487be8b03f)。

**作用。** 将无界 readText 改为按字节计数的输入流读取，上限 8 MiB；超限在写入累积缓冲区前抛 BackupTooLargeException，关闭输入流并由 SettingsViewModel 显示本地化大小提示。限制是字节数，不是字符数，也不依赖文件提供方报告的大小。最终上游 `data/preferences/ConfigBackupManager.kt:62–64,91–92,143–154`。

**当前已有与缺失。**

- Android 已有 4 MiB 限制，64 KiB 分块复制所选 URI 到缓存，累计超限先抛错，失败删除临时文件：[RuntimeBridge.kt](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RuntimeBridge.kt:206)（206–246；常量在 55 行）。这是实际流量限制，已防止未知长度 URI 被无界读入内存或持续落盘。
- Rust 导入命令先查 metadata 大小，再读取，解析后也会删除缓存文件：[lib.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/lib.rs:3658)（3658–3682）。解析器在反序列化前再次检查 bytes.len，上限同为 4 MiB：[configuration_backup.rs](/home/gxrs/coding/clone-github/MaaTauriAndroid/src-tauri/src/configuration_backup.rs:9)（9–28、96–103）。已有超限失败用例源码（636–649），本次未运行。
- 差异在错误反馈：Android 流复制异常最终 `getOrNull()`，再把 null 传回；Rust 将无选择路径解释为 imported=false（lib.rs:3649–3653）。因此 Android 最早拦截的超限可能表现为取消，而不会到达 Rust 的 TooLarge 消息，更没有上游那种明确的本地化大小提示。

**建议。** 不必再次移植核心限制，也不应仅为对齐上游放宽为 8 MiB。优先让文件选择桥区分取消、超限、读取失败，把超限作为结构化错误交给前端 en／zh 文案。Rust 的 metadata 检查与 read 间仍非原子有界读取，但当前路径来自受控缓存复制，风险范围不同；未来若增加任意文件路径导入，再考虑读取端最多读取上限加一字节。

## 后续实现顺序与未验证项

建议先做 `a9b681d + 1ca1989`，然后是 `99feef6` 的检测与修复入口、`152aab5` 的明确降级边界和 `6a68c63` 的错误反馈；`59ad1be + de596a0 + ba517b6` 留到内置解锁功能立项时一起设计。以上顺序是移植收益与现有依赖的判断，不表示已经实施。

若后续进入实现，应补业务逻辑成功／失败路径覆盖并交 CI；本研究不执行验证。尚未确认的事项集中在 ROM 权限／属性行为、历史退出信息完整度、隐藏 API 可用性、存储不可用时的实际运行依赖及锁屏交互，均不能仅凭源码宣布真机可用。
