package top.natsuu.mta

import org.junit.Assert.assertEquals
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
    fun unknownManufacturersUseTheGenericNotificationPath() {
        assertEquals(RunNotificationVendor.OTHER, detectRunNotificationVendor("Google"))
        assertEquals(RunNotificationVendor.OTHER, detectRunNotificationVendor(" Google "))
    }
}
