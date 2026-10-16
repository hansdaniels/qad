import { expect, test } from 'vite-plus/test';
import { fitColour, familyColours } from './colours';

test('classic offers the four original colours, modern the others', () => {
  const ids = (range: 'both' | 'classic' | 'modern') => familyColours('tube-35cm', range).map((c) => c.id);
  expect(ids('classic').sort()).toEqual(['blue', 'green', 'red', 'yellow']);
  expect(ids('modern')).toHaveLength(ids('both').length - 4);
  expect(ids('modern').some((c) => ids('classic').includes(c))).toBe(false);
});

test('a colour outside the range falls back to the default or the first offered', () => {
  expect(fitColour('tube-35cm', 'green', 'classic')).toBe('green');
  expect(fitColour('tube-35cm', 'pearl-white', 'classic')).toBe('red');
  expect(fitColour('tube-35cm', 'red', 'modern')).toBe(familyColours('tube-35cm', 'modern')[0]?.id);
});
