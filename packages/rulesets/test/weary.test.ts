import { describe, expect, it } from 'vitest'
import { criticalKind, describeResult, roll } from '@vtt/dice'
import { getPack, activeModifiers, applyRollModifiers, resolveMacro } from '../src/index.js'

const pack = getPack('lotr5e')

/**
 * The Weary rule, from the sheet to the dice.
 *
 * Written separately from the dice package's own tests on purpose: those prove
 * the grammar works, and this proves the rule the GM actually plays reaches it
 * — a tick on a character sheet becoming a floored d20, through the pack, the
 * macro and the expression, with no step computing a number the server cannot
 * check.
 */

/**
 * Rolls a scripted sequence of d20 faces instead of chance.
 *
 * `rollDie` is `floor(rng() * sides) + 1`, so landing on face f means handing
 * back a number in the middle of f's slice.
 */
function scripted(faces: number[]) {
  let at = 0
  return (): number => {
    const face = faces[at % faces.length]!
    at += 1
    return (face - 0.5) / 20
  }
}

describe('Weary, end to end', () => {
  const weary = { weary: true, abilities: { dex: 16 }, skillProficiency: { stealth: 2 }, level: 5 }

  it('builds an expression carrying the floor', () => {
    const active = activeModifiers(pack, weary)
    expect(active.map((m) => m.id)).toEqual(['weary'])
    const base = resolveMacro('1d20 + @total', { total: 9 })
    expect(applyRollModifiers(base, pack.dice, active)).toBe('1d20t3a0+9')
  })

  it('counts a 2 as nothing, and says so in the log', () => {
    const result = roll('1d20t3a0+9', 'normal', scripted([2]))
    expect(result.total).toBe(9)
    expect(describeResult(result)).toMatch(/2->0/)
  })

  it('leaves a 4 alone', () => {
    expect(roll('1d20t3a0+9', 'normal', scripted([4])).total).toBe(13)
  })

  it('applies the floor before keep-highest', () => {
    // Faces 3 and 11: the 3 floors to 0, the 11 is kept.
    expect(roll('2d20kh1t3a0', 'normal', scripted([3, 11])).total).toBe(11)
    // Both floored: nothing to keep but zero.
    expect(roll('2d20kh1t3a0', 'normal', scripted([2, 1])).total).toBe(0)
  })

  it('does not touch a damage die sharing the expression', () => {
    const active = activeModifiers(pack, weary)
    expect(applyRollModifiers('1d20+2d6+3', pack.dice, active)).toBe('1d20t3a0+2d6+3')
  })

  it('still counts a natural 1 as a fumble, whatever it was floored to', () => {
    // The die physically landed on a 1. That it counts as 0 for the total is
    // the Weary rule; it is not the die having shown something else.
    const result = roll('1d20t3a0', 'normal', scripted([1]))
    expect(result.total).toBe(0)
    expect(criticalKind(result)).toBe('failure')
  })

  it('does nothing at all when the character is not Weary', () => {
    const active = activeModifiers(pack, { weary: false })
    expect(active).toEqual([])
    expect(applyRollModifiers('1d20+5', pack.dice, active)).toBe('1d20+5')
  })
})
