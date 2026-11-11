# MaaMeow v0.26.0 通用改进验证记录

日期：2026-11-12（Asia/Shanghai）。本轮按 12 个 Conventional Commit 拆分；复查修正折入对应提交。

## 实现与接口

| 提交主题 | 技术落点 |
| --- | --- |
| `feat(schedule): persist alarm delivery evidence` | 原始闹钟缓存与未来注册列表分离；AtomicFile 保存注册/投递证据，投递身份独立于执行 claim |
| `feat(schedule): report missed alarm deliveries` | 10 分钟宽限、持久待报告队列、JNI 落盘确认、`missed` 历史结果与通知；保留宽限内旧触发点；诊断记录实际闹钟方式 |
| `fix(android): scope display wake locks to active use` | 保活条件为有效虚拟屏加任务运行、前台可见预览或 PiP；空闲后台释放锁 |
| `feat(update): archive release notes locally` | 按项目/渠道存储已安装与待更新说明；读取及标记已读 IPC |
| `feat(update): expose archived changelog` | 设置页回看；首次提示顺序为引导、项目公告、版本说明；复用 Markdown |
| `feat(update): track MirrorChyan credential status` | 独立凭证状态与验证 IPC；配置代次和请求序号拒绝旧响应；匿名检查保持不变 |
| `feat(settings): show CDK validation and expiry` | 验证已保存值、到期天数与错误反馈；保存失败保持原凭证；CDK 掩码输入 |
| `feat(preview): add compact virtual display view` | 点击折叠为缩略图窄栏，不卸载画面组件；实际画面边界用于 PiP |
| `refactor(settings): unify setting rows and help` | 设置行、整行开关、独立帮助按钮与内外跳转标识；PI 说明不折叠 |
| `refactor(tasks): separate task editing from persistence` | TaskEditor 仅接受数据与回调；applyTaskEdit 负责不可变状态变换，页面负责保存 |
| `feat(guide): add isolated task configuration demo` | 固定示例、内存编辑、步骤判定；不提供任务运行或资源操作；旧用户不强制重走引导 |
| `fix(backup): require password re-entry after import` | 按当前项目声明剥离各作用域密码，重新生成 manifest；导入失败保留原配置 |

新增更新 IPC：`update_get_release_notes`、`update_mark_release_notes_read`、`update_get_credential_status`、`update_validate_credential`。PiP 请求新增可选 `displayId`、`viewing`，旧请求仍可反序列化。

Mirror酱错误码已按[官方错误码表](https://github.com/MirrorChyan/docs/blob/main/ErrorCode.md)修正：7001 过期、7002 无效、7003 配额耗尽、7004 类型不匹配、7005 封禁。到期字段使用[官方接口定义](https://github.com/MirrorChyan/docs/blob/main/Integration.md)的 `cdk_expired_time`（秒）。普通更新检查仍不携带 CDK。

## 已执行检查

- 所有最终提交保留原有 pre-commit，未使用 `--no-verify`。
- 涉及前端的提交由钩子执行 `tsc --noEmit`、整套 Vitest 和 Biome。最终前端用例为 44 个测试文件、329 个测试，相关钩子均通过。
- 涉及 Kotlin 的提交由钩子执行 `:app:compileUniversalDebugKotlin`，最终通过。
- 涉及 Rust 的提交由钩子执行 `cargo fmt`。没有额外执行本地 Cargo 编译或测试；新增 Rust 与 Kotlin 单元用例留给现有 CI。
- 浏览器手动走通演示：启用任务、修改开关与下拉选项、拖动排序、切换配置、完成退出；另检查了中途跳过。
- 检查设置说明展开、更新日志回看和预览展开/收起。390×844 视口覆盖中英文与深浅色；320×720 窄屏检查预览，并以 20px 根字号检查英文设置，无横向溢出。

为了正常执行原有 Kotlin 钩子，本机缺失的三个 Tauri 源码包从可用镜像恢复，SHA-256 与 Cargo.lock 一致。钩子编译临时使用内置 fixture，结束后恢复原 local.properties 资源配方；未修改上游资源或 vendored 二进制。

## 截图及其边界

截图均为本项目 Vite 前端、固定示例项目和模拟 IPC 的最终集成界面。没有真实 CDK，也没有连接 Android 控制服务。预览截图明确保留 Stream unavailable；它们用于布局检查，不证明截屏流、PiP 或亮屏锁在真机上正常。

| 界面 | 中文浅色 | 英文深色 |
| --- | --- | --- |
| 更新与 CDK | [截图](screenshots/meow-v0260/settings-zh-light.png) | [截图](screenshots/meow-v0260/settings-en-dark.png) |
| 设置行及帮助 | [截图](screenshots/meow-v0260/settings-behavior-zh-light.png) | [截图](screenshots/meow-v0260/settings-behavior-en-dark.png) |
| 更新日志 | [截图](screenshots/meow-v0260/changelog-zh-light.png) | [截图](screenshots/meow-v0260/changelog-en-dark.png) |
| 展开预览 | [截图](screenshots/meow-v0260/preview-expanded-zh-light.png) | [截图](screenshots/meow-v0260/preview-expanded-en-dark.png) |
| 折叠预览 | [截图](screenshots/meow-v0260/preview-compact-zh-light.png) | [截图](screenshots/meow-v0260/preview-compact-en-dark.png) |
| 任务演示 | [截图](screenshots/meow-v0260/demo-zh-light.png) | [截图](screenshots/meow-v0260/demo-en-dark.png) |

补充：[中文深色设置](screenshots/meow-v0260/settings-zh-dark.png)、[英文浅色设置](screenshots/meow-v0260/settings-en-light.png)、[320 宽预览](screenshots/meow-v0260/preview-compact-en-dark-narrow.png)、[320 宽大字号设置](screenshots/meow-v0260/settings-en-dark-large-text.png)。

## 待 CI 与真机验证

本轮未推送提交，因此没有本轮 CI 结果。需要现有 frontend、rust、android-rust 和 Android app unit test 步骤验证。

ADB 设备列表为空，未构建或安装 APK，以下不能标记为通过：

- Android 11 与较新系统：任务运行时不中断，任务结束退后台能自然息屏，返回预览恢复画面；服务断开和虚拟屏替换不残留亮屏锁。
- 真实闹钟未投递、迟到投递、重启、精确闹钟拒绝回退、无通知权限及存储失败重试。
- 真实视频流折叠不重连、横竖屏触控与 PiP 进出。
- 实际 APK 升级后版本说明只提示一次；真实 Mirror酱验证及下载解析并发。
- Keystore 环境下导入后密码重填、重启后仍为空，以及导入失败恢复原密码。
