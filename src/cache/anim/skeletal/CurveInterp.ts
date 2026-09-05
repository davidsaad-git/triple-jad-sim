// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Curve evaluation: cubic hermite / weighted bezier segments between keys,
// and the five extrapolation modes outside the key range. Mirrors the
// client's obfuscated float math step for step (hence the varN names).

import type { Curve } from './Curve'
import { CurveInterpType } from './SkeletalTypes'

const ULP = 1.1920929e-7
const ULP2 = 2 * ULP
const FLOAT_MAX = 3.4028234663852886e38

export function interpolateCurve(curve: Curve, t: number): number {
  const points = curve.points
  if (!points || points.length === 0) {
    return 0
  }
  if (t < curve.startTick) {
    if (curve.startInterpType === CurveInterpType.Constant) {
      return points[0]!.y
    }
    return extrapolateCurve(curve, t, true)
  } else if (t > curve.endTick) {
    if (curve.endInterpType === CurveInterpType.Constant) {
      return points[points.length - 1]!.y
    }
    return extrapolateCurve(curve, t, false)
  } else if (curve.noInterp) {
    return points[0]!.y
  }
  const point = curve.getCurvePoint(t)
  if (!point) {
    return 0
  }
  let bool0 = false
  let bool1 = false

  if (point.field4 === 0 && point.field5 === 0) {
    bool0 = true
  } else if (point.field4 === FLOAT_MAX && point.field5 === FLOAT_MAX) {
    bool1 = true
  } else if (!point.next) {
    bool0 = true
  } else if (curve.pointIndexUpdated) {
    const next = point.next
    const var5 = point.x
    const var9 = point.y
    const var6 = point.field4 * 0.33333334 + var5
    const var10 = point.field5 * 0.33333334 + var9
    const var8 = next.x
    const var12 = next.y
    const var7 = var8 - next.field2 * 0.33333334
    const var11 = var12 - next.field3 * 0.33333334
    if (curve.bool) {
      let var15 = var10
      let var16 = var11
      const var17 = var8 - var5
      if (var17 !== 0) {
        const var18 = var6 - var5
        const var19 = var7 - var5
        const var29: [number, number] = [var18 / var17, var19 / var17]
        curve.interpBool = var29[0] === 0.33333334 && var29[1] === 0.6666667
        const var21 = var29[0]
        const var22 = var29[1]
        if (var29[0] < 0) {
          var29[0] = 0
        }
        if (var29[1] > 1) {
          var29[1] = 1
        }
        if (var29[0] > 1 || var29[1] < -1) {
          clampTangents(var29)
        }
        if (var29[0] !== var21) {
          if (var21 !== 0) {
            var15 = ((var10 - var9) * var29[0]) / var21 + var9
          }
        }
        if (var22 !== var29[1]) {
          if (var22 !== 1) {
            var16 = var12 - ((1 - var29[1]) * (var12 - var11)) / (1 - var22)
          }
        }

        curve.interpV0 = var5
        curve.interpV1 = var8
        const var23 = var29[0]
        const var24 = var29[1]
        let var25 = var23 - 0
        let var26 = var24 - var23
        let var27 = 1 - var24
        let var28 = var26 - var25
        curve.interpV5 = var27 - var26 - var28
        curve.interpV4 = var28 + var28 + var28
        curve.interpV3 = var25 + var25 + var25
        curve.interpV2 = 0
        var25 = var15 - var9
        var26 = var16 - var15
        var27 = var12 - var16
        var28 = var26 - var25
        curve.interpV9 = var27 - var26 - var28
        curve.interpV8 = var28 + var28 + var28
        curve.interpV7 = var25 + var25 + var25
        curve.interpV6 = var9
      }
    } else {
      curve.interpV0 = var5
      const var13 = var8 - var5
      const var14 = var12 - var9
      let var15 = var6 - var5
      let var16 = 0
      let var17 = 0
      if (var15 !== 0) {
        var16 = (var10 - var9) / var15
      }
      var15 = var8 - var7
      if (var15 !== 0) {
        var17 = (var12 - var11) / var15
      }
      const var18 = 1 / (var13 * var13)
      const var19 = var16 * var13
      const var20 = var17 * var13
      curve.interpV2 = (var18 * (var19 + var20 - var14 - var14)) / var13
      curve.interpV3 = var18 * (var14 + var14 + var14 - var19 - var19 - var20)
      curve.interpV4 = var16
      curve.interpV5 = var9
    }
    curve.pointIndexUpdated = false
  }

  if (bool0) {
    return point.y
  } else if (bool1) {
    if (point.x !== t && point.next) {
      return point.next.y
    }
    return point.y
  } else if (curve.bool) {
    return evalWeighted(curve, t)
  }
  const var6 = t - curve.interpV0
  return curve.interpV5 + var6 * ((var6 * curve.interpV2 + curve.interpV3) * var6 + curve.interpV4)
}

export function extrapolateCurve(curve: Curve, t: number, isStart: boolean): number {
  const points = curve.points
  if (!points || points.length === 0) {
    return 0
  }
  const first = points[0]!
  const last = points[points.length - 1]!
  const var4 = first.x
  const var5 = last.x
  const var6 = var5 - var4
  if (var6 === 0) {
    return first.y
  }

  let var7: number
  if (t > var5) {
    var7 = (t - var5) / var6
  } else {
    var7 = (t - var4) / var6
  }

  let var8 = var7 | 0
  let var10 = Math.abs(var7 - var8)
  let var11 = var10 * var6
  var8 = Math.abs(1 + var8)
  const var12 = var8 / 2
  const var14 = var12 | 0
  var10 = var12 - var14
  if (isStart) {
    if (curve.startInterpType === CurveInterpType.Oscillate) {
      if (var10 !== 0) {
        var11 += var4
      } else {
        var11 = var5 - var11
      }
    } else if (
      curve.startInterpType === CurveInterpType.Cycle ||
      curve.startInterpType === CurveInterpType.CycleOffset
    ) {
      var11 = var5 - var11
    } else if (curve.startInterpType === CurveInterpType.Linear) {
      var11 = var4 - t
      const var16 = first.field2
      const var17 = first.field3
      let output = first.y
      if (var16 !== 0) {
        output -= (var11 * var17) / var16
      }
      return output
    }
  } else {
    if (curve.endInterpType === CurveInterpType.Oscillate) {
      if (var10 !== 0) {
        var11 = var5 - var11
      } else {
        var11 += var4
      }
    } else if (
      curve.endInterpType === CurveInterpType.Cycle ||
      curve.endInterpType === CurveInterpType.CycleOffset
    ) {
      var11 += var4
    } else if (curve.endInterpType === CurveInterpType.Linear) {
      var11 = t - var5
      const var16 = last.field4
      const var17 = last.field5
      let output = last.y
      if (var16 !== 0) {
        output += (var17 * var11) / var16
      }
      return output
    }
  }
  let output = interpolateCurve(curve, var11)
  if (isStart && curve.startInterpType === CurveInterpType.CycleOffset) {
    const var18 = last.y - first.y
    output = output - var18 * var8
  } else if (!isStart && curve.endInterpType === CurveInterpType.CycleOffset) {
    const var18 = last.y - first.y
    output = output + var18 * var8
  }
  return output
}

function clampTangents(v: [number, number]): void {
  v[1] = 1 - v[1]
  if (v[0] < 0) {
    v[0] = 0
  }
  if (v[1] < 0) {
    v[1] = 0
  }
  if (v[0] > 1 || v[1] > 1) {
    const var1 = 1 + v[0] * (v[0] - 2 + v[1]) + (v[1] - 2) * v[1]
    if (var1 + ULP > 0) {
      if (ULP + v[0] < 1.3333334) {
        const var2 = v[0] - 2
        const var3 = v[0] - 1
        const var4 = Math.sqrt(var2 * var2 - 4 * var3 * var3)
        const var5 = 0.5 * (var4 + -var2)
        if (v[1] + ULP > var5) {
          v[1] = var5 - ULP
        } else {
          const var6 = (-var2 - var4) * 0.5
          if (v[1] < var6 + ULP) {
            v[1] = var6 + ULP
          }
        }
      } else {
        v[0] = 1.3333334 - ULP
        v[1] = 0.33333334 - ULP
      }
    }
  }
  v[1] = 1 - v[1]
}

const rootsInput = new Float32Array(4)
const rootsOutput = new Float32Array(5)

/** Weighted-tangent bezier: solve the x-polynomial for the parameter, then evaluate y. */
function evalWeighted(curve: Curve, t: number): number {
  let v0: number
  if (curve.interpV0 === t) {
    v0 = 0
  } else if (t === curve.interpV1) {
    v0 = 1
  } else {
    v0 = (t - curve.interpV0) / (curve.interpV1 - curve.interpV0)
  }

  let v1: number
  if (curve.interpBool) {
    v1 = v0
  } else {
    rootsInput[3] = curve.interpV5
    rootsInput[2] = curve.interpV4
    rootsInput[1] = curve.interpV3
    rootsInput[0] = curve.interpV2 - v0
    rootsOutput.fill(0)
    const n = findRoots(rootsInput, 3, 0, true, 1, true, rootsOutput)
    v1 = n === 1 ? rootsOutput[0]! : 0
  }
  return v1 * (curve.interpV7 + v1 * (v1 * curve.interpV9 + curve.interpV8)) + curve.interpV6
}

/** Horner evaluation of `values[0..lastIndex]` at `x`. */
function evalPoly(values: Float32Array, lastIndex: number, x: number): number {
  let output = values[lastIndex]!
  for (let i = lastIndex - 1; i >= 0; i--) {
    output = output * x + values[i]!
  }
  return output
}

/**
 * Real roots of a polynomial within [var2, var4] (bracketing on the roots of
 * the derivative, Brent-style refinement). Returns the root count, or -1
 * when the polynomial is degenerate.
 */
function findRoots(
  var0: Float32Array,
  var1: number,
  var2: number,
  var3: boolean,
  var4: number,
  var5: boolean,
  var6: Float32Array,
): number {
  let var7 = 0
  for (let i = 0; i < var1 + 1; i++) {
    var7 += Math.abs(var0[i]!)
  }
  const var44 = (Math.abs(var2) + Math.abs(var4)) * (var1 + 1) * ULP
  if (var7 <= var44) {
    return -1
  }
  const var9 = new Float32Array(var1 + 1)
  for (let i = 0; i < var1 + 1; i++) {
    var9[i] = (1 / var7) * var0[i]!
  }
  while (Math.abs(var9[var1]!) < var44) {
    var1--
  }

  let status = 0
  if (var1 === 0) {
    return status
  } else if (var1 === 1) {
    var6[0] = -var9[0]! / var9[1]!
    const var42 = var3 ? var2 < var6[0]! + var44 : var2 < var6[0]! - var44
    const var43 = var5 ? var4 > var6[0]! - var44 : var4 > var6[0]! + var44
    status = var42 && var43 ? 1 : 0
    if (status > 0) {
      if (var3 && var6[0]! < var2) {
        var6[0] = var2
      } else if (var5 && var6[0]! > var4) {
        var6[0] = var4
      }
    }
    return status
  }

  const poly = var9
  const degree = var1
  const var12 = new Float32Array(var1 + 1)
  for (let var13 = 1; var13 <= var1; var13++) {
    var12[var13 - 1] = var13 * var9[var13]!
  }

  const var41 = new Float32Array(var1 + 1)
  const recursiveStatus = findRoots(var12, var1 - 1, var2, false, var4, false, var41)
  if (recursiveStatus === -1) {
    return 0
  }

  let var15 = false
  let var17 = 0
  let var18 = 0
  let var19 = 0

  for (let s = 0; s <= recursiveStatus; s++) {
    if (status > var1) {
      return status
    }

    let var16: number
    if (s === 0) {
      var16 = var2
      var18 = evalPoly(var9, var1, var2)
      if (Math.abs(var18) <= var44 && var3) {
        var6[status++] = var2
      }
    } else {
      var16 = var19
      var18 = var17
    }

    if (recursiveStatus === s) {
      var19 = var4
      var15 = false
    } else {
      var19 = var41[s]!
    }

    var17 = evalPoly(var9, var1, var19)
    if (var15) {
      var15 = false
    } else if (Math.abs(var17) < var44) {
      if (recursiveStatus !== s || var5) {
        var6[status++] = var19
        var15 = true
      }
    } else if ((var18 < 0 && var17 > 0) || (var18 > 0 && var17 < 0)) {
      const var22 = status++
      let var24 = var16
      let var25 = var19
      let var26 = evalPoly(poly, degree, var16)
      let var23: number
      if (Math.abs(var26) < ULP) {
        var23 = var16
      } else {
        let var27 = evalPoly(poly, degree, var19)
        if (Math.abs(var27) < ULP) {
          var23 = var19
        } else {
          let var28 = 0
          let var29 = 0
          let var30 = 0
          let var35 = 0
          let var36 = true
          let var37 = false

          do {
            var37 = false
            if (var36) {
              var28 = var24
              var35 = var26
              var29 = var25 - var24
              var30 = var29
              var36 = false
            }

            if (Math.abs(var35) < Math.abs(var27)) {
              var24 = var25
              var25 = var28
              var28 = var24
              var26 = var27
              var27 = var35
              var35 = var26
            }

            const var38 = ULP2 * Math.abs(var25) + 0
            const var39 = 0.5 * (var28 - var25)
            const var40 = Math.abs(var39) > var38 && var27 !== 0
            if (var40) {
              if (Math.abs(var30) < var38 || Math.abs(var26) <= Math.abs(var27)) {
                var29 = var39
                var30 = var39
              } else {
                let var34 = var27 / var26
                let var31: number
                let var32: number
                if (var24 === var28) {
                  var31 = var39 * 2 * var34
                  var32 = 1 - var34
                } else {
                  var32 = var26 / var35
                  const var33 = var27 / var35
                  var31 = var34 * (var39 * 2 * var32 * (var32 - var33) - (var33 - 1) * (var25 - var24))
                  var32 = (var33 - 1) * (var32 - 1) * (var34 - 1)
                }

                if (var31 > 0) {
                  var32 = -var32
                } else {
                  var31 = -var31
                }

                var34 = var30
                var30 = var29
                if (2 * var31 < 3 * var39 * var32 - Math.abs(var32 * var38) && var31 < Math.abs(var32 * var34 * 0.5)) {
                  var29 = var31 / var32
                } else {
                  var29 = var39
                  var30 = var39
                }
              }

              var24 = var25
              var26 = var27
              if (Math.abs(var29) > var38) {
                var25 += var29
              } else if (var39 > 0) {
                var25 += var38
              } else {
                var25 -= var38
              }

              var27 = evalPoly(poly, degree, var25)
              if (var27 * (var35 / Math.abs(var35)) > 0) {
                var36 = true
                var37 = true
              } else {
                var37 = true
              }
            }
          } while (var37)

          var23 = var25
        }
      }

      var6[var22] = var23
      if (status > 1 && var6[status - 2]! >= var6[status - 1]! - var44) {
        var6[status - 2] = 0.5 * (var6[status - 2]! + var6[status - 1]!)
        status--
      }
    }
  }
  return status
}
