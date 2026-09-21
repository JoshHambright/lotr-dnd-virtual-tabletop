/**
 * The faces of a roll, written out.
 *
 * Showing every die — including the ones advantage threw away, struck through
 * rather than omitted — is what makes the log worth trusting. A total on its
 * own is a claim; the dice behind it are evidence.
 */

import type { RollResult } from '../../shared/dice.js'

export function RollDetail({ result }: { result: RollResult }) {
  return (
    <span className="roll-detail">
      {result.terms.map((term, index) => {
        const operator = index === 0 ? (term.sign === -1 ? '−' : '') : term.sign === -1 ? ' − ' : ' + '

        if (term.kind === 'const') {
          return (
            <span key={index}>
              {operator}
              {term.value}
            </span>
          )
        }

        return (
          <span key={index}>
            {operator}
            {term.notation}{' '}
            <span className="roll-detail__faces">
              [
              {term.rolls.map((die, position) => (
                <span key={position}>
                  {position > 0 ? ', ' : ''}
                  {die.kept ? (
                    <span className={die.value === term.sides ? 'roll-detail__max' : undefined}>{die.value}</span>
                  ) : (
                    <s className="roll-detail__dropped">{die.value}</s>
                  )}
                  {die.rerolledFrom !== undefined ? <span className="roll-detail__dropped"> ←{die.rerolledFrom}</span> : null}
                </span>
              ))}
              ]
            </span>
          </span>
        )
      })}
    </span>
  )
}
