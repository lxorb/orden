package so.orden.Orden

object TextSize {
  const val SMALLEST = 0.85f
  const val LARGEST = 2.0f

  fun zoom(scale: Float, follows: Boolean): Int {
    if (!follows || scale.isNaN()) return 100
    return Math.round(scale.coerceIn(SMALLEST, LARGEST) * 100)
  }
}
