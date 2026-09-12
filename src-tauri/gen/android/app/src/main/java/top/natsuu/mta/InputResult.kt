package top.natsuu.mta

import android.os.Parcel
import android.os.Parcelable

data class InputResult(
    val code: Int,
    val message: String,
) : Parcelable {
    constructor(parcel: Parcel) : this(parcel.readInt(), parcel.readString().orEmpty())

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeInt(code)
        parcel.writeString(message)
    }

    override fun describeContents(): Int = 0

    companion object CREATOR : Parcelable.Creator<InputResult> {
        override fun createFromParcel(parcel: Parcel): InputResult = InputResult(parcel)
        override fun newArray(size: Int): Array<InputResult?> = arrayOfNulls(size)

        fun messageFor(code: Int): String = when (code) {
            CODE_OK -> "Input accepted"
            CODE_INVALID_CONTACT -> "Contact id is invalid"
            CODE_UNKNOWN_CONTACT -> "Contact is not part of the active gesture"
            CODE_NO_ACTIVE_CONTACT -> "Gesture has no active contacts"
            CODE_INJECTION_FAILED -> "Android rejected input injection"
            CODE_UNSUPPORTED_METHOD -> "Input method is not supported"
            CODE_COMMAND_FAILED -> "A privileged shell command failed"
            else -> "Input command failed with result $code"
        }

        const val CODE_OK = 0
        const val CODE_INVALID_CONTACT = -1
        const val CODE_UNKNOWN_CONTACT = -2
        const val CODE_NO_ACTIVE_CONTACT = -3
        const val CODE_INJECTION_FAILED = -4
        const val CODE_UNSUPPORTED_METHOD = -5
        const val CODE_COMMAND_FAILED = -6
    }
}
