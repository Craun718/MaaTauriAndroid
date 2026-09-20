package top.natsuu.mta.control

import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TouchPointerSequenceTest {
    @Test
    fun plansASingleFingerGesture() {
        val down = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Down,
            emptyList(),
            0,
            10,
            20,
        )

        assertEquals(MotionEvent.ACTION_DOWN, down.action)
        assertEquals(listOf(TouchPointerSequence.Pointer(0, 10, 20)), down.pointers)
        assertFalse(down.removeContact)

        val move = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Move,
            down.pointers,
            0,
            30,
            40,
        )
        assertEquals(MotionEvent.ACTION_MOVE, move.action)
        assertEquals(listOf(TouchPointerSequence.Pointer(0, 30, 40)), move.pointers)

        val up = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Up,
            move.pointers,
            0,
            50,
            60,
        )
        assertEquals(MotionEvent.ACTION_UP, up.action)
        assertTrue(up.removeContact)
    }

    @Test
    fun plansASecondFingerAsPointerDown() {
        val first = listOf(TouchPointerSequence.Pointer(0, 1, 2))
        val step = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Down,
            first,
            1,
            3,
            4,
        )

        assertEquals(MotionEvent.ACTION_POINTER_DOWN, step.action)
        assertEquals(1, step.changingContact)
        assertEquals(
            listOf(
                TouchPointerSequence.Pointer(0, 1, 2),
                TouchPointerSequence.Pointer(1, 3, 4),
            ),
            step.pointers,
        )
    }

    @Test
    fun cancelsBeforeARepeatedDown() {
        val current = listOf(
            TouchPointerSequence.Pointer(0, 1, 2),
            TouchPointerSequence.Pointer(1, 3, 4),
        )
        val step = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Down,
            current,
            0,
            5,
            6,
        )

        assertTrue(step.cancelFirst)
        assertEquals(MotionEvent.ACTION_DOWN, step.action)
        assertEquals(listOf(TouchPointerSequence.Pointer(0, 5, 6)), step.pointers)
    }

    @Test
    fun liftsOneFingerFromAMultiTouchGesture() {
        val current = listOf(
            TouchPointerSequence.Pointer(0, 1, 2),
            TouchPointerSequence.Pointer(1, 3, 4),
        )
        val step = TouchPointerSequence.plan(
            TouchPointerSequence.Kind.Up,
            current,
            1,
            5,
            6,
        )

        assertEquals(MotionEvent.ACTION_POINTER_UP, step.action)
        assertEquals(1, step.changingContact)
        assertTrue(step.removeContact)
    }

    @Test
    fun rejectsUnknownAndInvalidContacts() {
        val current = listOf(TouchPointerSequence.Pointer(0, 1, 2))

        assertFalse(
            TouchPointerSequence.plan(
                TouchPointerSequence.Kind.Move,
                current,
                1,
                3,
                4,
            ).ok,
        )
        assertFalse(
            TouchPointerSequence.plan(
                TouchPointerSequence.Kind.Up,
                current,
                1,
                3,
                4,
            ).ok,
        )
        assertFalse(
            TouchPointerSequence.plan(
                TouchPointerSequence.Kind.Down,
                emptyList(),
                -1,
                0,
                0,
            ).ok,
        )
        assertFalse(
            TouchPointerSequence.plan(
                TouchPointerSequence.Kind.Down,
                emptyList(),
                TouchPointerSequence.MAX_CONTACTS,
                0,
                0,
            ).ok,
        )
    }
}
