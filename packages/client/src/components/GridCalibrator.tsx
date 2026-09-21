/**
 * Lining a map up to the grid.
 *
 * Nobody knows their map is 63.4 pixels to the square, so asking for that
 * number — which is what the sidebar used to do — is asking the wrong
 * question. Anyone can drag a box around squares they can already see, so the
 * tool measures instead: drag a box, say how many squares it covers, and the
 * size and offset fall out of it.
 */

/** What either route — a dragged box or a reading off the map — produces. */
export interface GridCandidate {
  size: number
  offsetX: number
  offsetY: number
  /** Only a measured box reports how far from square its cells came out. */
  skew?: number
}

interface Props {
  /** True when this came from a box the GM drew, rather than from the map. */
  measured: boolean
  /** Set when the grid was read off the map, 0 to 1. */
  confidence: number | null
  across: number
  down: number
  solution: GridCandidate | null
  unitsPerSquare: number
  unitLabel: string
  canDetect: boolean
  detecting: 'idle' | 'working' | 'nothing'
  onDetect: () => void
  onAcross: (value: number) => void
  onDown: (value: number) => void
  onUnits: (value: number) => void
  onApply: () => void
  onCancel: () => void
}

export function GridCalibrator({
  measured,
  confidence,
  across,
  down,
  solution,
  unitsPerSquare,
  unitLabel,
  canDetect,
  detecting,
  onDetect,
  onAcross,
  onDown,
  onUnits,
  onApply,
  onCancel,
}: Props) {
  // Map art is never perfect, but a box dragged across the wrong number of
  // squares shows up as cells that are not square.
  const badlySkewed = measured && solution?.skew !== undefined && solution.skew > 0.06

  return (
    <div className="calibrator" role="dialog" aria-label="Line the map up to the grid">
      {measured ? (
        <>
          <p className="calibrator__lead">That box covers</p>
          <div className="calibrator__counts">
            <Stepper label="across" value={across} onChange={onAcross} />
            <span className="calibrator__times">×</span>
            <Stepper label="down" value={down} onChange={onDown} />
            <span className="calibrator__unit">squares</span>
          </div>
        </>
      ) : (
        <p className="calibrator__lead">
          Read off the map
          {confidence !== null ? (
            <span className={`calibrator__confidence${confidence < 0.45 ? ' calibrator__confidence--low' : ''}`}>
              {Math.round(confidence * 100)}% sure
            </span>
          ) : null}
        </p>
      )}

      {solution ? (
        <dl className="calibrator__readout">
          <div>
            <dt>Square</dt>
            <dd>{solution.size.toFixed(1)} px</dd>
          </div>
          <div>
            <dt>Offset</dt>
            <dd>
              {solution.offsetX.toFixed(1)}, {solution.offsetY.toFixed(1)}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="calibrator__warning">That box is too small to measure. Drag a bigger one.</p>
      )}

      {badlySkewed ? (
        <p className="calibrator__warning">
          Those cells come out {Math.round((solution?.skew ?? 0) * 100)}% off square — check the counts above, or redraw
          the box on the map’s own lines.
        </p>
      ) : null}

      <label className="calibrator__scale">
        <span>One square is</span>
        <input
          className="input input--tiny"
          type="number"
          min={0}
          step="any"
          value={unitsPerSquare}
          onChange={(event) => onUnits(Number(event.target.value))}
        />
        <span>{unitLabel}</span>
      </label>

      {confidence !== null && confidence < 0.45 ? (
        <p className="calibrator__warning">
          The lines on this map are faint or broken, so check the blue grid against the art before applying.
        </p>
      ) : null}

      <div className="calibrator__actions">
        {canDetect ? (
          <button type="button" className="button button--small" disabled={detecting === 'working'} onClick={onDetect}>
            {detecting === 'working' ? 'Looking…' : 'Find the grid'}
          </button>
        ) : null}
        <button type="button" className="button button--small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button--primary button--small" disabled={!solution} onClick={onApply}>
          Apply grid
        </button>
      </div>

      <p className="calibrator__hint">
        {detecting === 'nothing'
          ? 'No grid found on this map. Drag a box instead.'
          : 'Drag another box to measure it by hand.'}
      </p>
    </div>
  )
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <span className="stepper">
      <button
        type="button"
        className="stepper__button"
        aria-label={`One fewer square ${label}`}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        −
      </button>
      <input
        className="stepper__value"
        type="number"
        min={1}
        max={200}
        aria-label={`Squares ${label}`}
        value={value}
        onChange={(event) => onChange(Math.max(1, Math.min(200, Math.round(Number(event.target.value) || 1))))}
      />
      <button
        type="button"
        className="stepper__button"
        aria-label={`One more square ${label}`}
        onClick={() => onChange(Math.min(200, value + 1))}
      >
        +
      </button>
    </span>
  )
}
