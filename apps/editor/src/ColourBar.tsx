import type { ColourId } from '@qad/model-core';
import { displayColour, type ColourOption } from './colours';

interface ColourBarProps {
  readonly colours: readonly ColourOption[];
  /** The colour of what the bar acts on, if it has one. */
  readonly active: ColourId | undefined;
  /** What a click colours, for the tooltip. */
  readonly target: string;
  readonly onPick: (colour: ColourId) => void;
}

const SWATCH = 22;

/** One swatch per colour on offer; a click colours the selection or the next part, C and Shift+C step through. */
export function ColourBar({ colours, active, target, onPick }: ColourBarProps) {
  return (
    <div role="radiogroup" aria-label="Farbe" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {colours.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={c.id === active}
          aria-label={c.name}
          title={`${c.name}: ${target} (C und Umschalt+C wechseln)`}
          onClick={() => onPick(c.id)}
          style={{
            width: SWATCH,
            height: SWATCH,
            padding: 0,
            borderRadius: SWATCH / 2,
            background: displayColour(c.id),
            border: '1px solid rgba(0,0,0,0.35)',
            outline: c.id === active ? '2px solid #1f5fbf' : 'none',
            outlineOffset: 2,
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  );
}
