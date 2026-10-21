# MAA-Meow 近期 Android 改动移植评估

评估日期：2026-10-21。当前项目基线：`e6a961e91958c82da2bea8b1aef33047e2c54dd2`。
上游基线：`Aliothmoon/MAA-Meow` 的 `aa9193f9a11eb1f1cfa71ed5fb917487cb94f3de`。

## 同步结果与范围

已获取本地 `/home/gxrs/coding/clone-github/MAA-Meow` 的 upstream/main、origin/main；两者以及本地 main 原本就在 aa9193f。执行普通 push `refs/remotes/upstream/main:refs/heads/main` 返回 Everything up-to-date，随后远端查询确认 origin/main 为上述完整 hash。保留工作区的 `feat/default-task`（fb2adab），未切分支、合并或强推。

用户给出的二十条是多条提交的汇总，并非一条 commit。本研究用指定提交的 diff 和 `git show upstream/main:<path>` 对照当前项目源码；MAA-Meow 工作区所在的开发分支不作为上游最终状态。仅新增研究文档，未修改产品代码，未编译、运行测试或真机验证。

## 结论

可以移植，但应按当前 Kotlin + JNI + Rust + React 的边界实现，不能整批 cherry-pick。优先补服务重建保护、提权进程有期限的退出与独立 lifeline、App/游戏历史退出原因及诊断容错；预览应处理本项目主线程到 JNI 的阻塞，而不是照搬上游 AIDL oneway。Root 统一 shell、XMSF 简化应配套评估，Compose 分页代码不适用于 React。

诊断、USB 安全调试、解锁和导入八项的逐条核对及源码依据见 [诊断与输入专项](maa-meow-diagnostics-assessment.md)。下表覆盖其余十二项。

## 运行与平台十二项

| 上游提交与作用 | 本项目现状、移植结论 |
| --- | --- |
| [4491c49：Android 17 excludeFromRecents](https://github.com/Aliothmoon/MAA-Meow/commit/4491c49) | 上游在启动游戏和运行巡检时，针对 API 37 的虚拟屏任务，通过反射调用 `WindowContainerTransaction.setTaskForceExcludedFromRecents`，核对 display/task 并限制重复操作。本项目 [AppLauncher.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/AppLauncher.kt) 的 `withLaunchFlags`（621 行）仅加 `FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS`，没有同等强制排除逻辑。可移植，优先级中等；需要放在提权进程中，按目标 display/task 排除，任务更换后补设，反射失败只记诊断。API 37 行为依据为上游实现与注释，本次未在 Android 17 设备复现，不能据此声称已确认本项目出现相同问题。 |
| [685f83e：预览 Surface 异步处理](https://github.com/Aliothmoon/MAA-Meow/commit/685f83e) | 上游将 `setMonitorSurface` 改成 oneway，去掉可能持锁等待的 JNI 方法上的 FastNative，移除无人消费的 Surface 引用。本项目 [PreviewRouter.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/pip/PreviewRouter.kt):38 直接调同进程 `ControlHost.attachPreviewSurface`，不存在该远端 AIDL 调用，也没有 FastNative。[VirtualDisplayPipController.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/pip/VirtualDisplayPipController.kt):196 的 Surface 回调能直接到 JNI；[virtual_display.cpp](../../src-tauri/gen/android/app/src/main/native/virtual_display.cpp):733 的 null 分支调用 `stop_preview`，后者在 687 行持锁 join 渲染线程。存在值得修复的 UI 阻塞路径，但不是已复现的 ANR。建议以有序渲染队列处理挂摘，核对 Surface 销毁、窗口引用所有权、display 代次和最终停机，不能简单把回调扔到线程池而不保证失效 Surface 的生命周期。 |
| [e588000：系统重建进度服务不残留](https://github.com/Aliothmoon/MAA-Meow/commit/e588000) | 上游用本进程运行 token 判断系统在任务死亡后重建服务，无任务时在创建/启动入口 stopSelf，避免先发通知。本项目 [RunForegroundService.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RunForegroundService.kt):47 在 onCreate 无条件把 running 设为 true，55 行启动通知；仅返回 START_NOT_STICKY，没有有效运行令牌校验。建议优先补；令牌必须在合法 start 请求前登记，不能用 onCreate 自己写入的 running 或可能尚未到达的 progress snapshot 证明任务存在。同时防止旧服务 onDestroy 清理掉新运行。源码确认缺口，ROM 重建场景尚待真机验证。 |
| [2523fe4：提权进程不留孤儿](https://github.com/Aliothmoon/MAA-Meow/commit/2523fe4) | 上游增加唯一退出口：清理前启动 5 秒硬期限，最终 halt；握手传 pipe lifeline，独占线程读 EOF 监视 App 死亡，避免 Binder 线程池堵塞使死亡回调无法执行；拒收/超时连接销毁已回投 binder，拉起前有期限地清理残留。本项目 [OwnerLease.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/OwnerLease.kt) 已有同步确认的 Binder 死亡监视，[ControlServiceClient.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt):95、492 已销毁过期/拒收服务，611 行已有残留 root 进程 kill；这些不必重做。但 [PrivilegedControlServiceImpl.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/PrivilegedControlServiceImpl.kt):328 必须等 exitCleanup 返回才 killProcess，没有硬期限，也无独立 lifeline。某一步抛异常已有隔离，某一步卡死则仍可能无法退出。建议优先补 deadline + pipe；自定义 Root 握手可传 FD，Shizuku 路径可扩展 attachOwner，同样保证确认后才能创建资源。 |
| [78571bf：Root 对齐 Shizuku 运行环境](https://github.com/Aliothmoon/MAA-Meow/commit/78571bf) | 上游显式 nsenter 到 init 挂载命名空间，降权前修复共享目录属主，并记录 namespace。本项目 [ControlServiceClient.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt):667 已配置 libsu FLAG_MOUNT_MASTER，不能认定完全缺失命名空间处理；[libsu 原始 API 文档](https://raw.githubusercontent.com/topjohnwu/libsu/6.0.0/core/src/main/java/com/topjohnwu/superuser/Shell.java)说明该选项向 root shell 传 --mount-master。实际 ROM/su 是否生效仍须观测。建议补 namespace 诊断与受控目录属主修复，按机型证据决定显式 nsenter fallback。不能对无关目录递归 chown。 |
| [b1df863：FPS 监控竞态](https://github.com/Aliothmoon/MAA-Meow/commit/b1df863) | 上游修的是 App 侧 GameFpsWatcher，不是提权侧同名 GameFpsMonitor：每轮独立 advisor；不可取消的读取返回后 ensureActive，防止旧轮发布。本项目 [run_supervisor.rs](../../src-tauri/src/run_supervisor.rs):330 已每轮 new FpsAdvisor，不存在共享判定器 reset 的同一问题。但 357 行同步 sample_fps（内部 IPC）返回后，359 行立即发全局 FPS 事件，stop 信号仅在下轮 select 检查；停止/快速重启窗口仍可能发出旧结果。可借鉴读取后检查 stop/执行代次，事件带 executionId 并由消费端过滤；这是静态风险推断，不是确认已发生竞态。 |
| [34435a3：分页预加载和配置渲染](https://github.com/Aliothmoon/MAA-Meow/commit/34435a3) | 上游 Compose 在触摸/滑动期间暂停邻页预构建，空闲后按帧错开，停止离屏动画/周期更新，按需加载业务数据。本项目 [App.tsx](../../src/App.tsx):21 使用 React lazy routes，87 行只渲染匹配路由，没有同等 Pager 常驻模型。不能搬 Compose 实现。只建议在确认路由切换卡顿后做空闲 import/必要数据预取，测量首帧和内存，避免为模仿上游而引入全页常驻。 |
| [e935adf：常驻页面开销、返回键与预览](https://github.com/Aliothmoon/MAA-Meow/commit/e935adf) | 上游保留分页后约束 PageBackHandler、暂停离屏预览和动画、减少 PiP 参数频繁 IPC。本项目路由卸载，原生 [VirtualDisplayPipController.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/pip/VirtualDisplayPipController.kt) 已独立管理 PiP；不需要复刻 Compose back handler。但 [RunActivityTabs.tsx](../../src/components/RunActivityTabs.tsx):156、165 用 hidden 保留任务与日志两个子树，179 行仍渲染 events.map。可按可见性暂停日志列表计算/订阅或延后挂载，保留日志数据与滚动恢复；先测量再选择，hidden 本身不会停止 React 更新。 |
| [f992ae4：XmsfFirewall 去掉 iptables](https://github.com/Aliothmoon/MAA-Meow/commit/f992ae4) | 上游先统一 shell uid 后才删除无法使用的 iptables 层，保留 binder/cmd。本项目 [XmsfFirewall.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/XmsfFirewall.kt):50、205 仍有真实 iptables 分支；Root 在 API 34+ 仍 keep-root，故这层在当前设计下可能可用，不能独立认定死代码删掉。统一 shell 后可去除常规切断 fallback；旧版留下的规则要考虑迁移恢复。另 249 行命令 readText + waitFor 无超时，使退出 deadline 更有价值。 |
| [41ed98a：提权服务统一处理](https://github.com/Aliothmoon/MAA-Meow/commit/41ed98a) | 上游所有 SDK 上 root/root-Shizuku 均降到 shell uid，删 keep-root 与失效提示。本项目 [ControlServiceClient.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/control/ControlServiceClient.kt):600、[launcher.c](../../src-tauri/gen/android/app/src/main/native/launcher.c):219 仍保留新版 Android root 身份。技术上可改，但需要一起核对 ShellIdentityContext、Root 回投身份检查、agent runtime/目标包记录目录、XMSF 和 root_launch_debug.log 的可写路径，尤其当前日志在 App 外部私有目录或缓存目录，不能假定降权后同样可写。建议作为独立配套变更，经过 Root/Shizuku × 系统版本真机验证，不与小修混合。 |
| [026b0c0：统一机型检测](https://github.com/Aliothmoon/MAA-Meow/commit/026b0c0) | 上游把缓存 ROM、SystemProps 和 Manufacturer 收口。本项目已有 [RunNotificationVendor.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RunNotificationVendor.kt):19 厂商归一化，但 [RunNotificationFactory.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RunNotificationFactory.kt):574 还有直接 Samsung 判断，[RuntimeBridge.kt](../../src-tauri/gen/android/app/src/main/java/top/natsuu/mta/RuntimeBridge.kt):875 读市场型号等属性。可以小范围收敛，注意品牌/厂商/ROM/市场型号是不同概念，保留现有通知能力探测而非一概只看厂商名。优先级低于运行稳定性。 |
| [0c04b6a：条件返回简化](https://github.com/Aliothmoon/MAA-Meow/commit/0c04b6a) | 上游合并权限授予、网络、无障碍、phantom killer 条件返回，截图换 Bitmap.scale。属于自身代码清理，无新增用户能力。本项目应按本地可读性处理；不需要为对齐而移植，不应更改短路顺序与失败日志。 |

## 建议实施顺序与验收

1. 先做小而明确的防护：导入配置已有 4 MiB 限额，补明确超限反馈；新增 App/游戏历史退出原因并整体隔离诊断异常；进度服务以运行令牌区分合法启动与系统重建；诊断与日志文件打开失败隔离主流程。
2. 提权进程退出：沿用 OwnerLease，增加独立 pipe EOF 与统一退出 deadline，确认清理中 Binder/子进程/原生 join 卡住时也能退出；期限强杀无法保证恢复完成，沿用目标包记录和启动恢复机制。
3. 预览与 FPS：把 UI 可达的 native join 改为有序生命周期协议；停止、重启、切 PiP、Surface 销毁竞态下拒绝过期操作及过期 FPS。
4. 再独立评估 USB 安全设置提示、API 37 最近任务处理、Root/shell 收口与机型检测。USB 修改应由用户操作触发；前端提示走 en/zh i18n。解锁录制/回放功能若当前没有对应产品入口，不为这些上游修复另建一整套功能。

实现时为业务状态机、参数构造、导入边界和错误隔离写测试，交 CI 执行；不新增组件渲染测试。Android 必须补充服务重建、清理挂起、App 强杀、旧连接回投、Surface 反复挂摘，以及不同 Root/Shizuku 环境真机结论。本次只有静态评估，不以现有测试文件存在推定验证通过。

## 参考边界

- Android 官方 [Recents 文档](https://developer.android.com/guide/components/activities/recents)说明常规任务排除机制；该文档不能单独证明上游所述 API 37 特例，本评估对此保留真机验证要求。
- 代码证据固定在文首两仓库提交。上游为 Kotlin/Compose + MAA，自项目为 React/Tauri + MaaFramework，业务配置页和运行时不能直接套用。
- 源码复用时按文件原始授权处理：MAA-Meow 根 LICENSE 为 AGPL-3.0，另有保留原始许可的第三方代码；当前项目根 LICENSE 为 LGPL-2.1。本文只研究行为与实现边界，未复制上游产品代码。
