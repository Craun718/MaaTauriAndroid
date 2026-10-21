package top.natsuu.mta.control.root

import org.junit.Assert.*
import org.junit.Test

class RootLaunchEnvironmentTest {
    @Test
    fun shellLaunchRepairsOnlyItsRuntimeTreeAndSupportsMissingNsenter() {
        val command = RootLaunchEnvironment.wrap("'launcher' --token='value'", true)
        assertTrue(command.contains("[ ! -L /data/local/tmp/maa-tauri-android ]"))
        assertTrue(command.contains("chown -h 2000:2000"))
        assertTrue(command.contains("nsenter -t 1 -m -- 'launcher' --token='value'"))
        assertTrue(command.contains("else 'launcher' --token='value' >/dev/null 2>&1 & fi"))
    }

    @Test
    fun retainedRootDoesNotRewriteDirectoryOwnership() {
        val command = RootLaunchEnvironment.wrap("launcher", false)
        assertFalse(command.contains("chown"))
        assertTrue(command.contains("nsenter -t 1 -m"))
    }
}
