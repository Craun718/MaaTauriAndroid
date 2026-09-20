package top.natsuu.mta.control

import android.view.MotionEvent

object TouchPointerSequence {
    const val MAX_CONTACTS = 16

    enum class Kind {
        Down,
        Move,
        Up,
    }

    data class Pointer(
        val contact: Int,
        val x: Int,
        val y: Int,
    )

    data class Step(
        val ok: Boolean,
        val action: Int = MotionEvent.ACTION_DOWN,
        val changingContact: Int = -1,
        val pointers: List<Pointer> = emptyList(),
        val cancelFirst: Boolean = false,
        val removeContact: Boolean = false,
    )

    fun plan(
        kind: Kind,
        current: List<Pointer>,
        contact: Int,
        x: Int,
        y: Int,
    ): Step {
        if (contact !in 0..<MAX_CONTACTS) {
            return Step(ok = false)
        }

        val nextPointer = Pointer(contact, x, y)
        return when (kind) {
            Kind.Down -> when {
                current.any { it.contact == contact } -> Step(
                    ok = true,
                    action = MotionEvent.ACTION_DOWN,
                    pointers = listOf(nextPointer),
                    cancelFirst = true,
                )

                current.size >= MAX_CONTACTS -> Step(ok = false)

                else -> {
                    val next = current + nextPointer
                    Step(
                        ok = true,
                        action = if (current.isEmpty()) {
                            MotionEvent.ACTION_DOWN
                        } else {
                            MotionEvent.ACTION_POINTER_DOWN
                        },
                        changingContact = contact,
                        pointers = next,
                    )
                }
            }

            Kind.Move -> {
                val index = current.indexOfFirst { it.contact == contact }
                if (index < 0) return Step(ok = false)
                val next = current.toMutableList()
                next[index] = nextPointer
                Step(
                    ok = true,
                    action = MotionEvent.ACTION_MOVE,
                    changingContact = contact,
                    pointers = next,
                )
            }

            Kind.Up -> {
                val index = current.indexOfFirst { it.contact == contact }
                if (index < 0) return Step(ok = false)
                val next = current.toMutableList()
                next[index] = nextPointer
                Step(
                    ok = true,
                    action = if (current.size == 1) {
                        MotionEvent.ACTION_UP
                    } else {
                        MotionEvent.ACTION_POINTER_UP
                    },
                    changingContact = contact,
                    pointers = next,
                    removeContact = true,
                )
            }
        }
    }
}
