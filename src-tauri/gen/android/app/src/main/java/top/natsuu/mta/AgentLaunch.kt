package top.natsuu.mta

import android.os.Parcel
import android.os.ParcelFileDescriptor
import android.os.Parcelable

class AgentLaunch(
    val launchId: String,
    val stdout: ParcelFileDescriptor,
    val stderr: ParcelFileDescriptor,
) : Parcelable {
    override fun describeContents(): Int = 0

    override fun writeToParcel(destination: Parcel, flags: Int) {
        destination.writeString(launchId)
        stdout.writeToParcel(destination, flags)
        stderr.writeToParcel(destination, flags)
    }

    companion object {
        @JvmField
        val CREATOR = object : Parcelable.Creator<AgentLaunch> {
            override fun createFromParcel(source: Parcel): AgentLaunch {
                val launchId = requireNotNull(source.readString()) { "missing agent launch id" }
                val stdout = requireNotNull(ParcelFileDescriptor.CREATOR.createFromParcel(source)) {
                    "missing agent stdout"
                }
                val stderr = requireNotNull(ParcelFileDescriptor.CREATOR.createFromParcel(source)) {
                    "missing agent stderr"
                }
                return AgentLaunch(launchId, stdout, stderr)
            }

            override fun newArray(size: Int): Array<AgentLaunch?> = arrayOfNulls(size)
        }
    }
}
