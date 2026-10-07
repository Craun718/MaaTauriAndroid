package top.natsuu.mta

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.toBitmap
import com.xzakota.hyper.notification.focus.FocusNotification
import com.xzakota.hyper.notification.focus.util.FocusUtils
import com.xzakota.hyper.notification.island.model.TextInfo

enum class RunNotificationBackend { HYPER_ISLAND, VIVO_ATOMIC, LIVE_UPDATE, PLAIN }

object VivoAtomicNotificationCapability {
    private const val SUPERX_FEATURE = "vivo.opt.notification.superx"
    private const val SCENE = "FOCUSMODE"

    fun isAvailable(context: Context): Boolean {
        val appContext = context.applicationContext
        if (!detectRunNotificationVendor().isVivoFamily) return false
        if (!appContext.packageManager.hasSystemFeature(SUPERX_FEATURE)) return false
        return sceneEnabled(appContext, SCENE)
    }

    @SuppressLint("BlockedPrivateApi")
    private fun sceneEnabled(context: Context, scene: String): Boolean = runCatching {
        val method = Class.forName("android.app.NotificationManager")
            .getMethod("getSceneStatus", String::class.java, String::class.java)
        val manager = context.getSystemService(NotificationManager::class.java)
        method.invoke(manager, context.packageName, scene) as? Boolean ?: false
    }.getOrDefault(false)
}

object HyperIslandCapability {
    @Volatile
    private var permissionCache: Pair<Long, Boolean>? = null

    fun isAvailable(context: Context): Boolean {
        if (!islandLikely(context.applicationContext)) return false
        val now = SystemClock.elapsedRealtime()
        permissionCache?.let { (at, granted) ->
            if (now - at < PERMISSION_CACHE_MS) return granted
        }
        val granted = runCatching {
            FocusUtils.hasFocusPermission(context.applicationContext)
        }.getOrDefault(false)
        permissionCache = now to granted
        return granted
    }

    @Synchronized
    private fun islandLikely(context: Context): Boolean {
        if (islandLikelyCache == null) {
            islandLikelyCache = runCatching {
                FocusUtils.getFocusProtocolVersion(context) >= 3 || FocusUtils.isSupportIsland()
            }.getOrDefault(false)
        }
        return islandLikelyCache == true
    }

    private const val PERMISSION_CACHE_MS = 30_000L

    @Volatile
    private var islandLikelyCache: Boolean? = null
}

object RunNotificationFactory {
    const val RUN_CHANNEL_ID = "maa-run"
    const val ISLAND_CHANNEL_ID = "maa-run-island"

    private const val PROGRESS_MAX = 1_000
    private const val ACCENT_LIGHT = 0xFF0F766E.toInt()
    private const val ACCENT_DARK = 0xFF34D399.toInt()
    private const val ONGOING_TIMEOUT_SEC = 86_400
    private const val PIC_APP = "miui.focus.pic_progress_app"
    private const val BUSINESS_PROGRESS = "download_progress"
    private const val PROGRESS_COLOR = "#3482FF"
    private const val PROGRESS_UNREACH = "#33FFFFFF"
    private const val VIVO_SCENE = "FOCUSMODE"

    private val appIcon = object : ThreadLocal<Icon>() {
        override fun initialValue(): Icon? = null
    }

    @Volatile
    private var channelsReady = false

    fun nextVivoChangedRecord(context: Context): Int = VivoSequenceStore.next(context)

    fun ensureChannels(context: Context) {
        if (channelsReady) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                RUN_CHANNEL_ID,
                context.getString(R.string.run_notification_channel),
                // LOW keeps the ongoing run silent without hiding it from the shade.
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        manager.createNotificationChannel(
            NotificationChannel(
                ISLAND_CHANNEL_ID,
                context.getString(R.string.run_notification_island_channel),
                // HyperOS only floats an island from a high-importance channel. The
                // channel itself stays silent; setSilent(true) would suppress the island.
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                setSound(null, null)
                enableVibration(false)
            },
        )
        channelsReady = true
    }

    fun backend(
        context: Context,
        islandReady: Boolean,
        vivoReady: Boolean = false,
        vendor: RunNotificationVendor = detectRunNotificationVendor(),
    ): RunNotificationBackend {
        if (islandReady && HyperIslandCapability.isAvailable(context)) {
            return RunNotificationBackend.HYPER_ISLAND
        }
        if (vivoReady && vendor.isVivoFamily) {
            return RunNotificationBackend.VIVO_ATOMIC
        }
        // HarmonyOS Live View is not reachable from an Android notification. Keep
        // Huawei on the plain foreground notification rather than pretending that
        // the AOSP promoted-ongoing path is that vendor surface.
        if (vendor == RunNotificationVendor.HUAWEI) return RunNotificationBackend.PLAIN
        return if (canRequestPromotedOngoing(context)) {
            RunNotificationBackend.LIVE_UPDATE
        } else {
            RunNotificationBackend.PLAIN
        }
    }

    fun build(
        context: Context,
        state: RunProgressSnapshot?,
        backend: RunNotificationBackend,
        firstFloat: Boolean = false,
        vivoChangedRecord: Int = 0,
        firstVivo: Boolean = false,
        finishVivo: Boolean = false,
    ): Notification {
        ensureChannels(context)
        if (backend == RunNotificationBackend.HYPER_ISLAND) {
            val islandState = state ?: RunProgressSnapshot(
                done = 0,
                total = 0,
                label = null,
                status = null,
                indeterminate = true,
            )
            val extras = runCatching { islandExtras(context, islandState, firstFloat) }.getOrNull()
            if (extras != null) {
                return builder(context, islandState, RunNotificationBackend.HYPER_ISLAND)
                    .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                    .addExtras(extras)
                    .build()
            }
        }

        val effectiveBackend = when {
            backend == RunNotificationBackend.HYPER_ISLAND -> RunNotificationBackend.PLAIN
            backend == RunNotificationBackend.VIVO_ATOMIC && state == null -> RunNotificationBackend.PLAIN
            else -> backend
        }
        val builder = builder(context, state, effectiveBackend)
            .setSilent(true)
        if (state != null && state.total > 0) {
            builder
                .setStyle(progressStyle(context, state))
                .setShortCriticalText(
                    context.getString(
                        R.string.run_notification_progress_fraction,
                        state.done,
                        state.total,
                    ),
                )
            if (effectiveBackend == RunNotificationBackend.LIVE_UPDATE) {
                builder.setRequestPromotedOngoing(true)
            }
        }
        if (effectiveBackend == RunNotificationBackend.VIVO_ATOMIC && state != null) {
            builder.addExtras(
                vivoExtras(
                    context = context,
                    state = state,
                    changedRecord = vivoChangedRecord,
                    first = firstVivo,
                    finish = finishVivo,
                ),
            )
        }
        return builder.build()
    }

    private fun builder(
        context: Context,
        state: RunProgressSnapshot?,
        backend: RunNotificationBackend,
    ): NotificationCompat.Builder {
        val builder = NotificationCompat.Builder(
            context,
            if (
                backend == RunNotificationBackend.HYPER_ISLAND ||
                    backend == RunNotificationBackend.VIVO_ATOMIC
            ) {
                ISLAND_CHANNEL_ID
            } else {
                RUN_CHANNEL_ID
            },
        )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setColor(accentColor(context))
            .setContentTitle(context.getString(R.string.run_notification_title))
            .setContentText(contentText(context, state))
            .setContentIntent(contentIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        if (backend == RunNotificationBackend.HYPER_ISLAND || state != null) {
            val progress = state?.progress ?: 0
            val indeterminate = state == null || state.indeterminate || state.total <= 0
            builder.setProgress(PROGRESS_MAX, progress, indeterminate)
        }
        return builder
    }

    private fun islandExtras(
        context: Context,
        state: RunProgressSnapshot,
        firstFloat: Boolean,
    ): Bundle {
        val appContext = context.applicationContext
        val icon = appIcon.get() ?: loadAppIcon(appContext).also(appIcon::set)
        val percent = if (state.indeterminate || state.total <= 0) {
            null
        } else {
            (state.progress * 100 / PROGRESS_MAX).coerceIn(0, 100)
        }
        val defaultTitle = appContext.getString(R.string.run_notification_title)
        val headline = (state.label ?: defaultTitle).take(40)
        val body = contentText(appContext, state).take(80)
        val status = (state.status ?: defaultTitle).take(18)
        val progressLabel = if (state.total > 0) {
            appContext.getString(R.string.run_notification_progress_fraction, state.done, state.total)
        } else {
            ""
        }
        val aod = percent?.let { "$it%" } ?: "..."

        return FocusNotification.buildV3 {
            val appPicture = createPicture(PIC_APP, icon)
            business = BUSINESS_PROGRESS
            notifyId = RunForegroundService.NOTIFICATION_ID.toString()
            updatable = true
            isShowNotification = true
            reopen = "reopen"
            timeout = (ONGOING_TIMEOUT_SEC / 60).coerceAtLeast(5)
            sequence = FocusSequences.next(appContext)
            aodTitle = aod
            ticker = "$headline $aod".trim().take(40)
            tickerPic = appPicture
            filterWhenNoPermission = false
            showSmallIcon = false
            enableFloat = false
            islandFirstFloat = firstFloat
            hideDeco = false
            if (firstFloat) outEffectSrc = "glow"

            chatInfo {
                title = headline
                content = body
            }
            if (percent != null) {
                multiProgressInfo {
                    progress = percent
                    color = PROGRESS_COLOR
                }
            }
            island {
                islandProperty = 1
                islandTimeout = ONGOING_TIMEOUT_SEC
                dismissIsland = false
                islandOrder = false
                bigIslandArea {
                    imageTextInfoLeft {
                        type = 1
                        picInfo {
                            type = 1
                            pic = appPicture
                        }
                        textInfo {
                            title = (state.label ?: appContext.applicationInfo.loadLabel(
                                appContext.packageManager,
                            ).toString()).take(16)
                            content = progressLabel.take(8)
                            showHighlightColor = true
                        }
                    }
                    textInfo = TextInfo().apply {
                        this.title = status
                        this.content = body.take(32)
                        showHighlightColor = true
                        narrowFont = true
                    }
                }
                smallIslandArea {
                    if (percent == null) {
                        picInfo {
                            type = 1
                            pic = appPicture
                        }
                    } else {
                        combinePicInfo {
                            picInfo {
                                type = 1
                                pic = appPicture
                            }
                            progressInfo {
                                progress = percent
                                colorReach = PROGRESS_COLOR
                                colorUnReach = PROGRESS_UNREACH
                                isCCW = true
                            }
                        }
                    }
                }
            }
        }
    }

    private fun vivoExtras(
        context: Context,
        state: RunProgressSnapshot,
        changedRecord: Int,
        first: Boolean,
        finish: Boolean,
    ): Bundle {
        if (finish) {
            return Bundle().apply {
                putInt("notification.superx.operation", 2)
                putBoolean("notification.superx.showNotify", true)
                putBoolean("notification.superx.sound", false)
            }
        }

        val appContext = context.applicationContext
        val icon = appIcon.get() ?: loadAppIcon(appContext).also(appIcon::set)
        val percent = if (state.indeterminate || state.total <= 0) {
            0
        } else {
            (state.progress * 100 / PROGRESS_MAX).coerceIn(0, 100)
        }
        val title = (state.label ?: appContext.getString(R.string.run_notification_title))
            .take(20)
        val body = contentText(appContext, state).take(40)
        val detail = if (state.total > 0) {
            appContext.getString(
                R.string.run_notification_progress_fraction,
                state.done,
                state.total,
            )
        } else {
            appContext.getString(R.string.run_notification_text)
        }
        val contentIntent = contentIntent(appContext)

        return Bundle().apply {
            putInt("notification.superx.operation", if (first) 0 else 1)
            putBoolean("notification.superx.showNotify", true)
            putBoolean("notification.superx.sound", false)
            putInt("notification.superx.template", 2)
            putString("notification.superx.scene", VIVO_SCENE)
            putInt("notification.superx.changedRecord", changedRecord)
            putInt(
                "notification.superx.displays",
                0x1 or 0x10 or 0x100 or 0x10000,
            )
            putBoolean("notification.superx.islandNotify", true)
            putParcelable("notification.superx.clickResp", contentIntent)

            putBundle(
                "notification.superx.baseInfos",
                Bundle().apply {
                    putParcelable("notification.superx.baseInfos.icon", icon)
                    putCharSequence("notification.superx.baseInfos.title", title)
                    putCharSequence("notification.superx.baseInfos.content", body)
                    putInt("notification.superx.baseInfos.progressState", 0)
                },
            )
            putBundle(
                "notification.superx.infos",
                Bundle().apply {
                    putInt("notification.superx.infos.progress", percent)
                    putParcelableArrayList(
                        "notification.superx.infos.nodeIcon",
                        arrayListOf(icon, icon),
                    )
                },
            )
            putBundle(
                "notification.superx.shortInfos",
                Bundle().apply {
                    putString("notification.superx.shortInfos.describeShort", title)
                    putString("notification.superx.shortInfos.coreInfoShort", detail)
                    putParcelable("notification.superx.shortInfos.image", icon)
                    putParcelable("notification.superx.shortInfos.imageClickResp", contentIntent)
                },
            )
            putBundle(
                "notification.superx.capsule",
                Bundle().apply {
                    putInt("notification.superx.capsule.state", 1)
                    putParcelable("notification.superx.capsule.icon", icon)
                    putCharSequence("notification.superx.capsule.content", "$title $percent%")
                    putInt("notification.superx.capsule.bgColor", accentColor(appContext))
                    putInt("notification.superx.capsule.contentColor", 0xFFFFFFFF.toInt())
                },
            )
            putBundle(
                "notification.superx.island",
                Bundle().apply {
                    putInt("island.superx.leftTemplate", 1)
                    putInt("island.superx.rightTemplate", 2)
                    putBoolean("island.superx.forceShow", true)
                    putBoolean("island.superx.showBarWhenCard", false)
                    putInt("island.superx.click", 0)
                    putParcelable("island.superx.clickResp", contentIntent)
                    putBundle(
                        "island.superx.leftInfo",
                        Bundle().apply {
                            putParcelable("island.superx.leftInfo.icon", icon)
                            putCharSequence("island.superx.leftInfo.content", detail)
                        },
                    )
                    putBundle(
                        "island.superx.rightInfo",
                        Bundle().apply {
                            putInt("island.superx.rightInfo.progressValue", percent)
                            putInt("island.superx.rightInfo.progressState", 0)
                            putInt("island.superx.rightInfo.progressColor", accentColor(appContext))
                            putCharSequence("island.superx.rightInfo.progressContent", body)
                            putParcelable("island.superx.rightInfo.clickResp", contentIntent)
                        },
                    )
                },
            )
        }
    }

    private fun loadAppIcon(context: Context): Icon {
        val drawable = context.applicationInfo.loadIcon(context.packageManager)
        val bitmap = if (drawable is BitmapDrawable) {
            drawable.bitmap
        } else {
            drawable.toBitmap()
        }
        return Icon.createWithBitmap(bitmap)
    }

    private fun progressStyle(
        context: Context,
        state: RunProgressSnapshot,
    ): NotificationCompat.ProgressStyle {
        val style = NotificationCompat.ProgressStyle()
            .setStyledByProgress(true)
            .setProgressIndeterminate(state.indeterminate)
            .addProgressSegment(
                NotificationCompat.ProgressStyle.Segment(PROGRESS_MAX)
                    .setColor(accentColor(context)),
            )
        if (!state.indeterminate) style.setProgress(state.progress)
        return style
    }

    private fun canRequestPromotedOngoing(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 36) return true
        // One UI reports no promoted-notification switch although requests work.
        if (Build.MANUFACTURER.equals("samsung", ignoreCase = true)) return true
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        return manager.canPostPromotedNotifications()
    }

    private fun contentText(context: Context, state: RunProgressSnapshot?): String {
        if (state == null) return context.getString(R.string.run_notification_text)
        if (!state.status.isNullOrBlank()) return state.status
        if (!state.label.isNullOrBlank() && state.total > 0) {
            return context.getString(
                R.string.run_notification_task_progress,
                state.label,
                state.done,
                state.total,
            )
        }
        return context.getString(R.string.run_notification_text)
    }

    private fun contentIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE,
    )

    private fun accentColor(context: Context): Int {
        val night = (context.resources.configuration.uiMode and
            Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        return if (night) ACCENT_DARK else ACCENT_LIGHT
    }
}

private object FocusSequences {
    private const val PERSIST_STEP_MS = 30_000L
    private const val PREFS_NAME = "live_focus_seq"
    private const val KEY = "seq_${RunForegroundService.NOTIFICATION_ID}"

    private var last: Long? = null

    @Synchronized
    fun next(context: Context): Long {
        val prefs = context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val previous = last ?: prefs.getLong(KEY, 0L)
        val now = System.currentTimeMillis()
        val sequence = maxOf(previous + 1L, now)
        last = sequence
        if (sequence - prefs.getLong(KEY, 0L) >= PERSIST_STEP_MS) {
            prefs.edit().putLong(KEY, sequence).apply()
        }
        return sequence
    }
}

private object VivoSequenceStore {
    private const val PREFS_NAME = "vivo_superx_seq"
    private const val KEY = "run_${RunForegroundService.NOTIFICATION_ID}"

    @Synchronized
    fun next(context: Context): Int {
        val preferences = context.applicationContext
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val current = preferences.getInt(KEY, 0)
        val next = if (current >= Int.MAX_VALUE) 1 else current + 1
        preferences.edit().putInt(KEY, next).apply()
        return next
    }
}
