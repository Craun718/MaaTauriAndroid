package top.natsuu.ttflow

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
    }
}
