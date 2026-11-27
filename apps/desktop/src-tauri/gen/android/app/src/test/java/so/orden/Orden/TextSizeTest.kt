package so.orden.Orden

import org.junit.Assert.assertEquals
import org.junit.Test

class TextSizeTest {
  @Test
  fun anAppThatFollowsThePhoneDrawsItsTextAtThePhonesScale() {
    assertEquals(100, TextSize.zoom(1.0f, true))
    assertEquals(130, TextSize.zoom(1.3f, true))
    assertEquals(200, TextSize.zoom(2.0f, true))
    assertEquals(85, TextSize.zoom(0.85f, true))
  }

  @Test
  fun theScaleStaysWithinWhatTheScreensAreCheckedAt() {
    assertEquals(200, TextSize.zoom(3.0f, true))
    assertEquals(85, TextSize.zoom(0.5f, true))
    assertEquals(100, TextSize.zoom(Float.NaN, true))
  }

  @Test
  fun theWholeOrdenKeepsItsTextAsItWas() {
    assertEquals(100, TextSize.zoom(2.0f, false))
    assertEquals(100, TextSize.zoom(0.85f, false))
  }
}
