package top.natsuu.mta

import android.app.Application

class MaaApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        RuntimeBridge.attachContext(this)
        AppPreparationManager.start(this)
    }
}
