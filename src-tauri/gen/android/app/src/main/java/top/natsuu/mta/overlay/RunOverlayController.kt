package top.natsuu.mta.overlay

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import com.google.android.material.R as MaterialR
import org.json.JSONObject
import top.natsuu.mta.R
import top.natsuu.mta.RuntimeBridge
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs
import kotlin.math.roundToInt

private const val TAG = "MTARunOverlay"

internal const val PHASE_PREPARING = "preparing"
internal const val PHASE_RUNNING = "running"
internal const val PHASE_STOPPING = "stopping"
internal const val PHASE_FINISHED = "finished"

private const val BALL_SIZE_DP = 44
private const val BALL_MARGIN_DP = 8
private const val DRAG_SLOP_DP = 6f
private const val CARD_WIDTH_DP = 244
private const val CARD_PADDING_DP = 14
private const val CARD_RADIUS_DP = 16
/** 任务/日志列表的固定高度：列表随运行增长，卡片自己不能跟着变高变矮。 */
private const val CARD_CONTENT_DP = 120
/** 展开面板时预留的纵向空间，用来决定面板往上翻还是往下翻。 */
private const val PANEL_HEIGHT_BUDGET_DP = 330
/** 兜底上限，只在 Rust 侧的裁剪失效时生效。 */
internal const val MAX_LOG_LINES = 60

private const val TAB_TASKS = 0
private const val TAB_LOG = 1

/** 12% 不透明度：M2 主题缺少 M3 语义色时，次要按钮的淡底。 */
private const val SUBTLE_FILL_ALPHA = 0x1F

/**
 * M2 主题没有 warning 语义色，警告行用固定琥珀色，深浅色下都读得清。
 * 直接写字面量而不是 `Color.parseColor`：文件顶层的初始化在单元测试里也会跑，
 * 而 android.jar 的桩方法会抛异常。
 */
private val WARNING_ACCENT = 0xFFF59E0B.toInt()

private val LOG_TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm:ss")

/**
 * 一份运行态快照，由 Rust 在每次变化时推送（`run_progress::push_overlay`，
 * 落到 [top.natsuu.mta.RuntimeBridge.updateRunOverlay]）。
 *
 * 字段名是 JNI 契约的一部分，改 Rust 侧序列化时要一起改。
 */
internal data class RunOverlaySnapshot(
    val foreground: Boolean,
    val phase: String,
    val done: Int,
    val total: Int,
    val label: String,
    val status: String,
    /** 本次运行会跑的任务显示名，顺序与 Rust 侧一致。 */
    val tasks: List<String>,
    /** [tasks] 中最后开始的那个，运行开始前是 -1。 */
    val active: Int,
    /** 最近若干条运行日志，旧的在前。 */
    val log: List<RunOverlayLogLine>,
) {
    val finished: Boolean
        get() = phase == PHASE_FINISHED
}

/** 一条日志行：时间、级别（info / warn / error）与已经压平成一行的正文。 */
internal data class RunOverlayLogLine(
    val atUnixMs: Long,
    val level: String,
    val message: String,
)

/**
 * 宽进解析：缺字段走默认值，脏帧返回 null 丢掉。推送是旁路，解析失败绝不能
 * 掀翻调用线程。
 */
internal fun parseRunOverlaySnapshot(json: String): RunOverlaySnapshot? = runCatching {
    val payload = JSONObject(json)
    RunOverlaySnapshot(
        foreground = payload.optBoolean("foreground", false),
        phase = payload.optString("phase", PHASE_RUNNING),
        done = payload.optInt("done"),
        total = payload.optInt("total"),
        label = payload.optString("label"),
        status = payload.optString("status"),
        tasks = parseTasks(payload),
        active = payload.optInt("active", -1),
        log = parseLog(payload),
    )
}.getOrNull()

/** 空标签也要占位，否则列表下标就和 Rust 推来的 `active` 对不上了。 */
private fun parseTasks(payload: JSONObject): List<String> {
    val raw = payload.optJSONArray("tasks") ?: return emptyList()
    return List(raw.length()) { index -> raw.optString(index) }
}

private fun parseLog(payload: JSONObject): List<RunOverlayLogLine> {
    val raw = payload.optJSONArray("log") ?: return emptyList()
    val lines = ArrayList<RunOverlayLogLine>(raw.length())
    for (index in 0 until raw.length()) {
        val entry = raw.optJSONObject(index) ?: continue
        val message = entry.optString("message")
        if (message.isEmpty()) continue
        lines.add(
            RunOverlayLogLine(
                atUnixMs = entry.optLong("at"),
                level = entry.optString("level", "info"),
                message = message,
            ),
        )
    }
    return if (lines.size > MAX_LOG_LINES) lines.takeLast(MAX_LOG_LINES) else lines
}

/** 小球角标：有进度报进度，没进度报阶段。 */
internal fun ballLabel(snapshot: RunOverlaySnapshot, context: Context): String {
    if (snapshot.total > 0) {
        return context.getString(
            R.string.overlay_progress_fraction,
            snapshot.done,
            snapshot.total,
        )
    }
    return context.getString(phaseLabelRes(snapshot.phase))
}

internal fun phaseLabelRes(phase: String): Int = when (phase) {
    PHASE_PREPARING -> R.string.overlay_state_preparing
    PHASE_STOPPING -> R.string.overlay_state_stopping
    else -> R.string.overlay_state_running
}

/** `HH:mm:ss  正文`；没带时间戳的帧只显示正文。 */
internal fun formatLogLine(line: RunOverlayLogLine): String {
    if (line.atUnixMs <= 0) return line.message
    val time = Instant.ofEpochMilli(line.atUnixMs)
        .atZone(ZoneId.systemDefault())
        .toLocalTime()
        .format(LOG_TIME_FORMAT)
    return "$time  ${line.message}"
}

/**
 * 前台模式的悬浮遥控层。
 *
 * 前台模式跑起来后目标应用会盖满物理屏，本应用退到后台，用户既看不到进度也没有
 * 停止入口；这一层把运行态画成一个可拖动的小球，点开后是停止 / 打开应用的
 * 控制面板。三个条件同时成立才会出现：前台模式、用户开了「前台控制球」、已授予
 * 悬浮窗权限（后两者由设置页负责）。
 *
 * 覆盖层画在物理屏上，而前台模式的截屏拍的正是这块屏幕，所以小球压住的那点面积
 * 会进入识别画面：球可以拖走，也可以随时在设置里关掉这一层。
 */
object RunOverlayController {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val fallbackAccent = Color.parseColor("#3B82F6")
    private val fallbackOutline = Color.parseColor("#33808080")

    private var manager: WindowManager? = null
    private var themedContext: Context? = null
    private var ball: TextView? = null
    private var ballParams: WindowManager.LayoutParams? = null
    private var panel: View? = null
    private var panelViews: PanelViews? = null
    private var snapshot: RunOverlaySnapshot? = null
    private var activeTab = TAB_TASKS
    /** 上次铺进列表的内容指纹；只变了状态句的帧不该重建整个列表。 */
    private var contentSignature: String? = null

    private class PanelViews(
        val title: TextView,
        val fraction: TextView,
        val bar: ProgressBar,
        val detail: TextView,
        val tabTasks: TextView,
        val tabLog: TextView,
        val export: TextView,
        val scroll: ScrollView,
        val content: LinearLayout,
    )

    /**
     * Rust 推来的一帧。WindowManager 只能在主线程动，所以这里统一切回主线程；
     * 返回值只表示帧本身是否可解析，与窗口是否显示无关。
     */
    @JvmStatic
    fun update(context: Context, json: String): Boolean {
        val parsed = parseRunOverlaySnapshot(json) ?: return false
        val appContext = context.applicationContext
        mainHandler.post { apply(appContext, parsed) }
        return true
    }

    /** 设置页用它显示「悬浮窗权限已授予 / 需要授权」。 */
    @JvmStatic
    fun hasPermission(context: Context): Boolean = Settings.canDrawOverlays(context)

    private fun apply(context: Context, next: RunOverlaySnapshot) {
        snapshot = next
        if (!next.foreground || next.finished || !Settings.canDrawOverlays(context)) {
            detach()
            return
        }
        val windowManager = context.getSystemService(WindowManager::class.java) ?: return
        if (ball == null) attach(context, windowManager)
        render()
    }

    private fun attach(context: Context, windowManager: WindowManager) {
        // Material 的语义色（colorPrimary / colorOnSurface / …）只在带主题的
        // context 上解析得到，应用 context 是裸的。
        val themed = ContextThemeWrapper(context, R.style.Theme_maa_tauri_android)
        themedContext = themed
        manager = windowManager
        // 新一次运行从小球重新长出来，列表也回到任务页。
        activeTab = TAB_TASKS
        contentSignature = null

        val size = dp(themed, BALL_SIZE_DP)
        val params = WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // NOT_TOUCH_MODAL 让球体之外的触摸照常落到下面的目标应用上：
            // 自动化的注入点击只有正好压在小球上才会被这一层吃掉。
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val metrics = themed.resources.displayMetrics
            x = (metrics.widthPixels - size - dp(themed, BALL_MARGIN_DP)).coerceAtLeast(0)
            y = (metrics.heightPixels * 0.35f).roundToInt()
        }
        ballParams = params

        val view = TextView(themed).apply {
            gravity = Gravity.CENTER
            setTextColor(themeColor(themed, MaterialR.attr.colorOnPrimary, Color.WHITE))
            textSize = 12f
            background = rounded(
                fill = themeColor(themed, MaterialR.attr.colorPrimary, fallbackAccent),
                radius = size / 2f,
            )
            isClickable = true
        }
        view.setOnTouchListener(
            DragListener(
                params = params,
                onMove = { windowManager.updateViewLayout(view, params) },
                onDragStart = { hidePanel() },
                onTap = { togglePanel() },
            ),
        )
        ball = view
        runCatching { windowManager.addView(view, params) }.onFailure {
            Log.w(TAG, "Could not add the run overlay ball", it)
            ball = null
        }
    }

    private fun render() {
        val themed = themedContext ?: return
        val state = snapshot ?: return
        ball?.text = ballLabel(state, themed)

        val views = panelViews ?: return
        views.title.text = state.label.ifEmpty { themed.getString(phaseLabelRes(state.phase)) }
        views.fraction.text = if (state.total > 0) {
            themed.getString(R.string.overlay_progress_fraction, state.done, state.total)
        } else {
            ""
        }
        views.fraction.visibility = if (state.total > 0) View.VISIBLE else View.GONE
        views.bar.max = state.total.coerceAtLeast(1)
        views.bar.progress = state.done.coerceIn(0, views.bar.max)
        views.bar.visibility = if (state.total > 0) View.VISIBLE else View.GONE
        views.detail.text = state.status
        views.detail.visibility = if (state.status.isEmpty()) View.GONE else View.VISIBLE

        val onSurfaceVariant = themeColor(themed, MaterialR.attr.colorOnSurfaceVariant, Color.GRAY)
        val primary = themeColor(themed, MaterialR.attr.colorPrimary, fallbackAccent)
        val tasksSelected = activeTab == TAB_TASKS
        views.tabTasks.setTextColor(if (tasksSelected) primary else onSurfaceVariant)
        views.tabTasks.setTypeface(null, if (tasksSelected) Typeface.BOLD else Typeface.NORMAL)
        views.tabLog.setTextColor(if (tasksSelected) onSurfaceVariant else primary)
        views.tabLog.setTypeface(null, if (tasksSelected) Typeface.NORMAL else Typeface.BOLD)
        views.export.visibility = if (tasksSelected) View.GONE else View.VISIBLE
        renderContent(themed, state)
    }

    /**
     * 列表只在内容真的变了才重建：进度帧、状态句帧来得比日志密，重建整个列表
     * 会把用户的滚动位置一并冲掉。
     */
    private fun renderContent(themed: Context, state: RunOverlaySnapshot) {
        val signature = if (activeTab == TAB_LOG) {
            state.log.joinToString("\u0001") { "${it.atUnixMs}/${it.level}/${it.message}" }
        } else {
            "${state.active}\u0001${state.tasks.joinToString("\u0001")}"
        }
        if (signature == contentSignature) return
        contentSignature = signature

        val views = panelViews ?: return
        // 重建会清掉滚动位置：本来贴着底就跟住最新一条，否则尽量回到原来那一段。
        val followTail = !views.scroll.canScrollVertically(1)
        val previousScroll = views.scroll.scrollY
        val container = views.content
        container.removeAllViews()
        if (activeTab == TAB_LOG) {
            if (state.log.isEmpty()) {
                container.addView(contentHint(themed, R.string.overlay_log_empty))
            } else {
                state.log.forEach { container.addView(logRow(themed, it)) }
            }
        } else if (state.tasks.isEmpty()) {
            container.addView(contentHint(themed, R.string.overlay_tasks_empty))
        } else {
            state.tasks.forEachIndexed { index, label ->
                container.addView(taskRow(themed, label, index, state.active))
            }
        }
        views.scroll.post {
            if (followTail) {
                views.scroll.fullScroll(View.FOCUS_DOWN)
            } else {
                views.scroll.scrollTo(0, previousScroll)
            }
        }
    }

    /** 跑过的置灰、正在跑的用主题色加粗、还没到的正常显示。 */
    private fun taskRow(themed: Context, label: String, index: Int, active: Int): TextView {
        val onSurface = themeColor(themed, MaterialR.attr.colorOnSurface, Color.BLACK)
        val onSurfaceVariant = themeColor(themed, MaterialR.attr.colorOnSurfaceVariant, Color.GRAY)
        return rowView(themed).apply {
            text = label.ifEmpty { themed.getString(R.string.overlay_task_unnamed) }
            when {
                index == active -> {
                    setTextColor(themeColor(themed, MaterialR.attr.colorPrimary, fallbackAccent))
                    setTypeface(typeface, Typeface.BOLD)
                }

                index < active -> setTextColor(onSurfaceVariant)
                else -> setTextColor(onSurface)
            }
        }
    }

    private fun logRow(themed: Context, line: RunOverlayLogLine): TextView =
        rowView(themed).apply {
            text = formatLogLine(line)
            setTextColor(
                when (line.level) {
                    "error" -> themeColor(themed, MaterialR.attr.colorError, fallbackAccent)
                    "warn" -> WARNING_ACCENT
                    else -> themeColor(
                        themed,
                        MaterialR.attr.colorOnSurfaceVariant,
                        Color.GRAY,
                    )
                },
            )
        }

    private fun contentHint(themed: Context, res: Int): TextView = rowView(themed).apply {
        text = themed.getString(res)
        setTextColor(themeColor(themed, MaterialR.attr.colorOnSurfaceVariant, Color.GRAY))
    }

    private fun rowView(themed: Context): TextView = TextView(themed).apply {
        textSize = 12f
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
        setPadding(0, dp(themed, 3), 0, dp(themed, 3))
    }

    private fun selectTab(tab: Int) {
        if (activeTab == tab) return
        activeTab = tab
        contentSignature = null
        render()
    }

    private fun togglePanel() {
        if (panel != null) {
            hidePanel()
        } else {
            showPanel()
        }
    }

    private fun showPanel() {
        val themed = themedContext ?: return
        val windowManager = manager ?: return
        val ballLayout = ballParams ?: return
        if (panel != null) return

        val (card, views) = buildPanel(themed)
        val width = dp(themed, CARD_WIDTH_DP)
        val params = WindowManager.LayoutParams(
            width,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START }

        // 贴着小球展开：靠右的球把面板翻到左边，底部就翻到上面。
        val metrics = themed.resources.displayMetrics
        val margin = dp(themed, BALL_MARGIN_DP)
        val size = dp(themed, BALL_SIZE_DP)
        val rightmost = metrics.widthPixels - width - margin
        val panelHeightBudget = dp(themed, PANEL_HEIGHT_BUDGET_DP)
        val bottommost = (metrics.heightPixels - panelHeightBudget).coerceAtLeast(margin)
        params.x = if (ballLayout.x > metrics.widthPixels / 2) {
            (ballLayout.x + size - width).coerceIn(margin, rightmost.coerceAtLeast(margin))
        } else {
            ballLayout.x.coerceIn(margin, rightmost.coerceAtLeast(margin))
        }
        params.y = if (ballLayout.y > metrics.heightPixels / 2) {
            (ballLayout.y - panelHeightBudget).coerceIn(margin, bottommost)
        } else {
            (ballLayout.y + size + margin).coerceIn(margin, bottommost)
        }

        panel = card
        panelViews = views
        runCatching { windowManager.addView(card, params) }.onFailure {
            Log.w(TAG, "Could not add the run overlay panel", it)
            panel = null
            panelViews = null
        }
        render()
    }

    private fun buildPanel(themed: Context): Pair<View, PanelViews> {
        val onSurface = themeColor(themed, MaterialR.attr.colorOnSurface, Color.BLACK)
        val onSurfaceVariant = themeColor(themed, MaterialR.attr.colorOnSurfaceVariant, Color.GRAY)
        val surface = ContextCompat.getColor(themed, R.color.surface)
        val outline = themeColor(themed, MaterialR.attr.colorOutline, fallbackOutline)
        val error = themeColor(themed, MaterialR.attr.colorError, fallbackAccent)
        val onError = themeColor(themed, MaterialR.attr.colorOnError, Color.WHITE)

        val title = TextView(themed).apply {
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(onSurface)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        val collapse = TextView(themed).apply {
            text = themed.getString(R.string.overlay_collapse)
            textSize = 12f
            setTextColor(onSurfaceVariant)
            setPadding(dp(themed, 8), dp(themed, 2), dp(themed, 8), dp(themed, 2))
            isClickable = true
            setOnClickListener { hidePanel() }
        }
        val titleRow = LinearLayout(themed).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(
                title,
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
            )
            addView(
                collapse,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }

        val bar = ProgressBar(themed, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
        }
        val fraction = TextView(themed).apply {
            textSize = 12f
            setTextColor(onSurfaceVariant)
        }
        val detail = TextView(themed).apply {
            textSize = 12f
            setTextColor(onSurface)
            maxLines = 3
            ellipsize = TextUtils.TruncateAt.END
        }

        val tabTasks = tabLabel(themed, R.string.overlay_tab_tasks) { selectTab(TAB_TASKS) }
        val tabLog = tabLabel(themed, R.string.overlay_tab_log) { selectTab(TAB_LOG) }
        val export = tabLabel(themed, R.string.overlay_export) { RuntimeBridge.exportRunLogs() }
        val tabRow = LinearLayout(themed).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(tabTasks)
            addView(
                tabLog,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { marginStart = dp(themed, 12) },
            )
            // 撑开中间的空档，「导出」贴右，和标题行的收起钮对齐。
            addView(View(themed), LinearLayout.LayoutParams(0, 0, 1f))
            addView(export)
        }

        val content = LinearLayout(themed).apply { orientation = LinearLayout.VERTICAL }
        val contentScroll = ScrollView(themed).apply {
            isFillViewport = false
            addView(content)
        }

        val stop = actionButton(
            themed,
            themed.getString(R.string.overlay_stop),
            fill = error,
            textColor = onError,
        ) { RuntimeBridge.requestRunStop() }
        val openApp = actionButton(
            themed,
            themed.getString(R.string.overlay_open_app),
            // M2 主题不一定定义 colorSurfaceVariant，退化成 onSurface 的淡底
            // 而不是等于卡片底色（那样按钮会看不出来）。
            fill = themeColor(
                themed,
                MaterialR.attr.colorSurfaceVariant,
                ColorUtils.setAlphaComponent(onSurface, SUBTLE_FILL_ALPHA),
            ),
            textColor = onSurface,
        ) { bringAppToFront(themed) }
        val actions = LinearLayout(themed).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(
                stop,
                LinearLayout.LayoutParams(0, dp(themed, 36), 1f).apply {
                    marginEnd = dp(themed, 6)
                },
            )
            addView(openApp, LinearLayout.LayoutParams(0, dp(themed, 36), 1f))
        }

        val gap = dp(themed, 8)
        val card = LinearLayout(themed).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(
                dp(themed, CARD_PADDING_DP),
                dp(themed, CARD_PADDING_DP),
                dp(themed, CARD_PADDING_DP),
                dp(themed, CARD_PADDING_DP),
            )
            background = rounded(
                fill = surface,
                radius = dp(themed, CARD_RADIUS_DP).toFloat(),
                strokeColor = outline,
                strokeWidth = dp(themed, 1),
            )
            addView(titleRow)
            addView(
                bar,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(themed, 6),
                ).apply { topMargin = gap },
            )
            addView(
                fraction,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = gap / 2 },
            )
            addView(
                detail,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = gap / 2 },
            )
            addView(
                tabRow,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = gap },
            )
            addView(
                contentScroll,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(themed, CARD_CONTENT_DP),
                ).apply { topMargin = gap / 2 },
            )
            addView(
                actions,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = gap },
            )
        }
        return card to PanelViews(
            title,
            fraction,
            bar,
            detail,
            tabTasks,
            tabLog,
            export,
            contentScroll,
            content,
        )
    }

    private fun tabLabel(themed: Context, res: Int, onClick: () -> Unit): TextView =
        TextView(themed).apply {
            text = themed.getString(res)
            textSize = 12f
            isClickable = true
            setPadding(dp(themed, 2), dp(themed, 2), dp(themed, 2), dp(themed, 2))
            setOnClickListener { onClick() }
        }

    private fun actionButton(
        themed: Context,
        label: String,
        fill: Int,
        textColor: Int,
        onClick: () -> Unit,
    ): TextView = TextView(themed).apply {
        text = label
        textSize = 13f
        gravity = Gravity.CENTER
        setTextColor(textColor)
        background = rounded(fill = fill, radius = dp(themed, 10).toFloat())
        isClickable = true
        setOnClickListener { onClick() }
    }

    private fun hidePanel() {
        val view = panel ?: return
        panel = null
        panelViews = null
        // 面板关着的时候内容还在更新，重新打开必须整块铺一遍。
        contentSignature = null
        runCatching { manager?.removeView(view) }
    }

    private fun detach() {
        hidePanel()
        ball?.let { view -> runCatching { manager?.removeView(view) } }
        ball = null
        ballParams = null
        manager = null
        themedContext = null
        snapshot = null
        activeTab = TAB_TASKS
        contentSignature = null
    }

    private fun bringAppToFront(context: Context) {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        runCatching { context.startActivity(intent) }
            .onFailure { Log.w(TAG, "Could not bring the app to the front", it) }
    }

    private fun rounded(
        fill: Int,
        radius: Float,
        strokeColor: Int? = null,
        strokeWidth: Int = 0,
    ): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radius
        setColor(fill)
        if (strokeColor != null && strokeWidth > 0) setStroke(strokeWidth, strokeColor)
    }

    private fun dp(context: Context, value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            context.resources.displayMetrics,
        ).roundToInt()

    private fun themeColor(context: Context, attr: Int, fallback: Int): Int {
        val value = TypedValue()
        if (!context.theme.resolveAttribute(attr, value, true)) return fallback
        return if (value.resourceId != 0) {
            ContextCompat.getColor(context, value.resourceId)
        } else {
            value.data
        }
    }

    /** 小球拖动：超过阈值算拖动，否则当点击开面板。 */
    private class DragListener(
        private val params: WindowManager.LayoutParams,
        private val onMove: () -> Unit,
        private val onDragStart: () -> Unit,
        private val onTap: () -> Unit,
    ) : View.OnTouchListener {
        private var downX = 0f
        private var downY = 0f
        private var originX = 0
        private var originY = 0
        private var dragging = false

        override fun onTouch(view: View, event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    originX = params.x
                    originY = params.y
                    dragging = false
                }

                MotionEvent.ACTION_MOVE -> {
                    val deltaX = event.rawX - downX
                    val deltaY = event.rawY - downY
                    if (!dragging) {
                        val slop = DRAG_SLOP_DP * view.resources.displayMetrics.density
                        if (abs(deltaX) + abs(deltaY) > slop) {
                            dragging = true
                            onDragStart()
                        }
                    }
                    if (dragging) {
                        val metrics = view.resources.displayMetrics
                        params.x = (originX + deltaX).roundToInt()
                            .coerceIn(0, (metrics.widthPixels - view.width).coerceAtLeast(0))
                        params.y = (originY + deltaY).roundToInt()
                            .coerceIn(0, (metrics.heightPixels - view.height).coerceAtLeast(0))
                        onMove()
                    }
                }

                MotionEvent.ACTION_UP -> {
                    if (!dragging) onTap()
                }
            }
            return true
        }
    }
}
