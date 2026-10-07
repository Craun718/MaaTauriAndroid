package top.natsuu.mta

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RunNotificationVendorTest {
    @Test
    fun detectsLiveNotificationVendorsFromManufacturer() {
        assertEquals(RunNotificationVendor.OPPO, detectRunNotificationVendor("OPPO"))
        assertEquals(RunNotificationVendor.ONEPLUS, detectRunNotificationVendor("OnePlus"))
        assertEquals(RunNotificationVendor.REALME, detectRunNotificationVendor("realme"))
        assertEquals(RunNotificationVendor.XIAOMI, detectRunNotificationVendor("Redmi"))
        assertEquals(RunNotificationVendor.VIVO, detectRunNotificationVendor("vivo"))
        assertEquals(RunNotificationVendor.IQOO, detectRunNotificationVendor("iQOO"))
        assertEquals(RunNotificationVendor.MEIZU, detectRunNotificationVendor("Meizu"))
        assertEquals(RunNotificationVendor.HONOR, detectRunNotificationVendor("HONOR"))
        assertEquals(RunNotificationVendor.SAMSUNG, detectRunNotificationVendor("samsung"))
        assertEquals(RunNotificationVendor.HUAWEI, detectRunNotificationVendor("HUAWEI"))
    }

    @Test
    fun groupsVivoAndIqooIntoTheAtomicNotificationFamily() {
        assertTrue(RunNotificationVendor.VIVO.isVivoFamily)
        assertTrue(RunNotificationVendor.IQOO.isVivoFamily)
        assertFalse(RunNotificationVendor.XIAOMI.isVivoFamily)
    }

    @Test
    fun parsesFlymeMajorVersionsFromBuildDisplay() {
        assertEquals(11, flymeMajorVersion("Flyme 11.2.0"))
        assertEquals(12, flymeMajorVersion("FlymeOS 12"))
        assertEquals(10, flymeMajorVersion("flyme 10"))
        assertEquals(-1, flymeMajorVersion("Android 15"))
        assertEquals(-1, flymeMajorVersion(null))
    }

    @Test
    fun unknownManufacturersUseTheGenericNotificationPath() {
        assertEquals(RunNotificationVendor.OTHER, detectRunNotificationVendor("Google"))
        assertEquals(RunNotificationVendor.OTHER, detectRunNotificationVendor(" Google "))
    }
}
