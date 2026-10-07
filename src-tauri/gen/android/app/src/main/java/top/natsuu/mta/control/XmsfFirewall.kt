package top.natsuu.mta.control

import android.annotation.SuppressLint
import android.content.Context
import android.os.IBinder
import java.lang.reflect.Method

/**
 * Applies and rolls back the XMSF network block used by HyperOS focus
 * notifications. The rule lives in system-side netd and survives this process,
 * so every service start and exit performs a bounded repair as well.
 */
class XmsfFirewall(private val context: Context?) {
    private val applied = mutableSetOf<Backend>()
    private var bootRestored = false

    @Synchronized
    fun setNetworkingEnabled(enabled: Boolean): Boolean {
        return if (enabled) restore(full = false) else cut()
    }

    /** Clears any rule left by a previous privileged process instance. */
    @Synchronized
    fun ensureRestored() {
        if (bootRestored) return
        bootRestored = true
        restore(full = true)
    }

    @Synchronized
    fun restoreIfNeeded() {
        restore(full = true)
    }

    private fun cut(): Boolean {
        if (applied.isNotEmpty()) return true
        ensureRestored()
        val uid = resolveUid() ?: return false
        var ok = false
        if (binderApply(uid, deny = true) && currentState() == STATE_DENY) {
            applied += Backend.BINDER
            ok = true
        }
        if (!ok && cmdApply(deny = true)) {
            applied += Backend.CMD
            ok = currentState() == STATE_DENY
        }
        if (!ok) {
            applyIptablesRules(uid, insert = true)
            applied += Backend.IPTABLES
            ok = iptablesHasRule(uid)
        }
        if (!ok) restore(full = false)
        log("cut xmsf uid=$uid ok=$ok via=$applied")
        return ok
    }

    private fun restore(full: Boolean): Boolean {
        val targets = if (full) Backend.entries.toSet() else applied.toSet()
        val uid = resolveUid()
        if (uid == null) {
            applied.clear()
            log("restore skipped: XMSF uid unresolved")
            return targets.isEmpty()
        }
        if (targets.isEmpty() && currentState() != STATE_DENY) return true
        if (Backend.BINDER in targets) binderApply(uid, deny = false)
        if (Backend.CMD in targets) cmdApply(deny = false)
        var iptablesTouched = false
        if (Backend.IPTABLES in targets && (!full || iptablesHasRule(uid))) {
            iptablesClear(uid)
            iptablesTouched = true
        }
        applied.clear()
        val restored = currentState() != STATE_DENY &&
            (!iptablesTouched || !iptablesHasRule(uid))
        log("restore xmsf uid=$uid full=$full restored=$restored")
        return restored
    }

    private fun currentState(): String? = command(
        "cmd",
        "connectivity",
        "get-package-networking-enabled",
        XMSF_PACKAGE,
    )?.lowercase()?.let { state ->
        when {
            state.endsWith(STATE_ALLOW) -> STATE_ALLOW
            state.endsWith(STATE_DENY) -> STATE_DENY
            else -> null
        }
    }

    private fun binderApply(uid: Int, deny: Boolean): Boolean {
        for (backend in SERVICE_BACKENDS) {
            val proxy = serviceProxy(backend) ?: continue
            if (applyFirewallRule(proxy, uid, deny)) return true
        }
        return false
    }

    @SuppressLint("PrivateApi")
    private fun serviceProxy(backend: ServiceBackend): Any? {
        return runCatching {
            val binder = Class.forName("android.os.ServiceManager")
                .getMethod("getService", String::class.java)
                .invoke(null, backend.serviceName) as? IBinder
                ?: return null
            Class.forName(backend.stubClass)
                .getMethod("asInterface", IBinder::class.java)
                .invoke(null, binder)
        }.onFailure { error ->
            log("service proxy ${backend.serviceName} failed: ${error.message}")
        }.getOrNull()
    }

    private fun applyFirewallRule(proxy: Any, uid: Int, deny: Boolean): Boolean {
        val rule = if (deny) RULE_DENY else RULE_DEFAULT
        for (chain in OEM_DENY_CHAINS) {
            if (deny) invoke(proxy, listOf("setFirewallChainEnabled"), chain, true)
            if (invoke(
                    proxy,
                    listOf("setUidFirewallRule", "setFirewallUidRule"),
                    chain,
                    uid,
                    rule,
                )
            ) {
                return true
            }
            if (invoke(
                    proxy,
                    listOf("setUidFirewallRules", "setFirewallUidRules"),
                    chain,
                    intArrayOf(uid),
                    intArrayOf(rule),
                )
            ) {
                return true
            }
        }

        if (invoke(proxy, listOf("setFirewallEnabled"), true)) {
            if (invoke(
                    proxy,
                    listOf("setUidFirewallRule", "setFirewallUidRule"),
                    uid,
                    deny,
                )
            ) {
                return true
            }
            if (invoke(
                    proxy,
                    listOf("setUidFirewallRule", "setFirewallUidRule"),
                    uid,
                    rule,
                )
            ) {
                return true
            }
        }
        return false
    }

    private fun invoke(proxy: Any, names: List<String>, vararg args: Any): Boolean {
        val methods = proxy.javaClass.methods
            .filter { it.name in names && it.parameterCount == args.size }
        for (method in methods) {
            val adapted = runCatching { adaptArgs(method, args) }.getOrNull() ?: continue
            val ok = runCatching { method.invoke(proxy, *adapted) }.isSuccess
            if (ok) return true
        }
        return false
    }

    private fun adaptArgs(method: Method, args: Array<out Any>): Array<Any> =
        Array(args.size) { index ->
            when (method.parameterTypes[index]) {
                Int::class.javaPrimitiveType -> (args[index] as Number).toInt()
                Boolean::class.javaPrimitiveType ->
                    if (args[index] is Boolean) {
                        args[index]
                    } else {
                        (args[index] as Number).toInt() != 0
                    }

                else -> args[index]
            }
        }

    private fun cmdApply(deny: Boolean): Boolean {
        if (deny && command("cmd", "connectivity", "set-chain3-enabled", "true") == null) {
            return false
        }
        return command(
            "cmd",
            "connectivity",
            "set-package-networking-enabled",
            if (deny) "false" else "true",
            XMSF_PACKAGE,
        ) != null
    }

    private fun iptablesHasRule(uid: Int): Boolean =
        command("iptables", "-w", "-C", "OUTPUT", *iptablesRuleSuffix(uid)) != null

    private fun iptablesClear(uid: Int) {
        for (binary in IPTABLES_BINARIES) {
            for (chain in IPTABLES_CHAINS) {
                var guard = 0
                while (guard++ < IPTABLES_MAX_DELETES) {
                    if (command(binary, "-w", "-C", chain, *iptablesRuleSuffix(uid)) == null) break
                    command(binary, "-w", "-D", chain, *iptablesRuleSuffix(uid))
                }
            }
        }
    }

    private fun applyIptablesRules(uid: Int, insert: Boolean) {
        val flag = if (insert) "-I" else "-D"
        for (binary in IPTABLES_BINARIES) {
            for (chain in IPTABLES_CHAINS) {
                command(binary, "-w", flag, chain, *iptablesRuleSuffix(uid))
            }
        }
    }

    private fun iptablesRuleSuffix(uid: Int): Array<String> = arrayOf(
        "-m",
        "owner",
        "--uid-owner",
        uid.toString(),
        "-m",
        "comment",
        "--comment",
        COMMENT,
        "-j",
        "REJECT",
    )

    private fun resolveUid(): Int? = runCatching {
        context?.packageManager?.getApplicationInfo(XMSF_PACKAGE, 0)?.uid
    }.onFailure { error ->
        log("resolve XMSF uid failed: ${error.message}")
    }.getOrNull()

    private fun command(vararg args: String): String? = runCatching {
        val process = ProcessBuilder(*args).redirectErrorStream(true).start()
        val output = process.inputStream.bufferedReader().readText().trim()
        val status = process.waitFor()
        if (status == 0) output else null
    }.getOrNull()

    private fun log(message: String) {
        android.util.Log.i(TAG, message)
    }

    private enum class Backend { BINDER, CMD, IPTABLES }

    private data class ServiceBackend(val serviceName: String, val stubClass: String)

    private companion object {
        private const val TAG = "MaaTauriAndroidControl"
        private const val XMSF_PACKAGE = "com.xiaomi.xmsf"
        private const val COMMENT = "maa_xmsf_cut"
        private const val RULE_DEFAULT = 0
        private const val RULE_DENY = 2
        private const val STATE_ALLOW = "allow"
        private const val STATE_DENY = "deny"
        private const val IPTABLES_MAX_DELETES = 8
        private val OEM_DENY_CHAINS = intArrayOf(9, 8, 7)
        private val SERVICE_BACKENDS = arrayOf(
            ServiceBackend("connectivity", "android.net.IConnectivityManager\$Stub"),
            ServiceBackend("network_management", "android.os.INetworkManagementService\$Stub"),
        )
        private val IPTABLES_BINARIES = listOf("iptables", "ip6tables")
        private val IPTABLES_CHAINS = listOf("OUTPUT", "INPUT")
    }
}
