import {
  quadroArticleCatalog,
  quadroPartCatalog,
  type ColourId,
  type FamilyId,
  type PlateArticle,
} from '@qad/model-core';
import { inAssortment, type Assortment } from './assortment';
import { fitColour, familyColours, type ColourRange } from './colours';

export interface PaletteChoice {
  readonly kind: 'tube' | 'plate' | 'slide';
  readonly familyId: FamilyId;
  readonly colour: ColourId;
  /** Plates only: offer upright places (walls) instead of level ones (floors, steps). */
  readonly upright?: boolean;
}

/**
 * Tube families of the first stage, one entry per family named by its standard
 * variant. The 35 cm tube is by far the most used part and comes first.
 */
const FIRST = 'tube-35cm';
const TUBES = quadroArticleCatalog.entries
  .filter((e) => e.category === 'tube' && e.stage === 'initial' && e.drilling.kind === 'standard')
  .sort((a, b) => Number(b.familyId === FIRST) - Number(a.familyId === FIRST));
/** Plates the geometry catalog can place. */
const PLATES = quadroArticleCatalog.entries.filter(
  (e): e is PlateArticle =>
    e.category === 'plate' && quadroPartCatalog.partTypes.some((t) => t.kind === 'plate' && t.id === e.id),
);
/** Slides the geometry catalog can hang. */
const SLIDES = quadroArticleCatalog.entries.filter(
  (e) => e.category === 'slide' && quadroPartCatalog.partTypes.some((t) => t.kind === 'slide' && t.id === e.id),
);

interface PaletteProps {
  readonly choice: PaletteChoice | undefined;
  readonly range: ColourRange;
  readonly assortment: Assortment;
  readonly onChoose: (choice: PaletteChoice | undefined) => void;
}

const CURVED = new Set(TUBES.filter((t) => t.category === 'tube' && t.shape === 'bent').map((t) => t.familyId));
const HINTS = {
  tube: 'Freien Arm (grau) anklicken; R oder der Drehknopf neigt das Rohr auf einer Winkelkupplung, Esc legt es ab.',
  curved: 'Freien Arm (grau) anklicken; R wählt die Biegerichtung, Esc legt das Rohr ab.',
  plate:
    'Fläche zwischen vier Rohren anklicken; L wechselt zwischen Boden und Wand, R dreht die Flansche, Esc legt die Platte ab.',
  slide:
    'Feld vor einem 35-cm-Querrohr anklicken. Ein Körper braucht zwei Etagen tiefer und drei Felder weiter ein gleiches Querrohr; der Auslauf kommt an dessen untere Kante. Esc legt das Teil ab.',
};

/** Parts to build with. Connectors are chosen automatically and therefore not offered. */
export function Palette({ choice, range, assortment, onChoose }: PaletteProps) {
  const entry = (kind: PaletteChoice['kind'], familyId: FamilyId, name: string) => {
    const active = familyId === choice?.familyId;
    const fallback = quadroArticleCatalog.defaultColours[kind] ?? 'red';
    // Keep a chosen colour when switching between parts of the same kind.
    const colour = choice?.kind === kind ? choice.colour : fallback;
    // The hole panel must not be stood on, so it starts upright; other plates keep the last choice.
    const upright =
      PLATES.find((p) => p.familyId === familyId)?.plate === 'perforated' ||
      (choice?.kind === 'plate' && choice.upright === true);
    return (
      <button
        key={familyId}
        type="button"
        onClick={() =>
          onChoose(
            active
              ? undefined
              : {
                  kind,
                  familyId,
                  colour: fitColour(familyId, colour, range),
                  ...(kind === 'plate' ? { upright } : {}),
                },
          )
        }
        style={{
          textAlign: 'left',
          padding: '6px 8px',
          border: active ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
          borderRadius: 4,
          background: active ? '#e8f0fb' : '#fff',
          color: '#111',
          cursor: 'pointer',
        }}
      >
        {name}
      </button>
    );
  };
  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Rohre</h3>
      <div className="choices">
        {TUBES.filter((t) => inAssortment(t.familyId, assortment)).map((t) => entry('tube', t.familyId, t.name))}
      </div>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Platten</h3>
      <div className="choices">
        {PLATES.filter((p) => inAssortment(p.familyId, assortment)).map((p) => entry('plate', p.familyId, p.name))}
      </div>
      <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>Rutschen</h3>
      <div className="choices">
        {SLIDES.filter((s) => inAssortment(s.familyId, assortment)).map((s) => entry('slide', s.familyId, s.name))}
      </div>
      {choice?.kind === 'plate' ? (
        <div role="radiogroup" aria-label="Lage der Platte" style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {(
            [
              [false, 'Boden', 'Liegende Plätze: Boden, Decke, auch ein schräges Dach (Taste L wechselt)'],
              [true, 'Wand', 'Stehende Plätze: Wände und Setzstufen (Taste L wechselt)'],
            ] as const
          ).map(([upright, label, hint]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={(choice.upright ?? false) === upright}
              title={hint}
              onClick={() => onChoose({ ...choice, upright })}
              style={{
                padding: '4px 10px',
                border: (choice.upright ?? false) === upright ? '2px solid #1f5fbf' : '1px solid #c8cdd3',
                borderRadius: 4,
                background: (choice.upright ?? false) === upright ? '#e8f0fb' : '#fff',
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {choice ? (
        <label style={{ display: 'block', marginTop: 8, fontSize: 14 }}>
          Farbe{' '}
          <select value={choice.colour} onChange={(e) => onChoose({ ...choice, colour: e.target.value })}>
            {familyColours(choice.familyId, range).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p style={{ fontSize: 13, color: '#555' }}>
        {choice
          ? HINTS[choice.kind === 'tube' && CURVED.has(choice.familyId) ? 'curved' : choice.kind]
          : 'Rohr, Platte oder Rutsche wählen, dann im Modell anbauen.'}
      </p>
    </section>
  );
}
