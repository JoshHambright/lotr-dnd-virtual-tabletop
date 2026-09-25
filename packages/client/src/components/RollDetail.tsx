/**
 * The faces of a roll, written out.
 *
 * Showing every die — including the ones advantage threw away and the ones a
 * condition counted as something else, struck through rather than omitted — is
 * what makes the log worth trusting. A total on its own is a claim; the dice
 * behind it are evidence.
 */

import type { RollResult } from '@vtt/dice'

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
                  {/*
                    A floored die shows the face it landed on, struck through,
                    ahead of what it counted as. The total is only believable if
                    the log can show the number the rule took away.
                  */}
                  {die.treatedFrom !== undefined ? (
                    <>
                      <s className="roll-detail__treated">{die.treatedFrom}</s>
                      <span className="roll-detail__dropped">→</span>
                    </>
                  ) : null}
                  {die.kept ? (
                    <span className={die.value === term.sides ? 'roll-detail__max' : undefined}>{die.value}</span>
                  ) : (
                    <s className="roll-detail__dropped">{die.value}</s>
                  )}
                  {die.rerolledFrom !== undefined ? (
                    <span className="roll-detail__dropped"> ←{die.rerolledFrom}</span>
                  ) : null}
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
