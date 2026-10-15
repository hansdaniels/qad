import type { ColourId } from '@qad/model-core';

/** Display colours for the catalog's colour keys; approximations, not manufacturer values. */
const COLOURS: Readonly<Record<ColourId, string>> = {
  blue: '#1f5fbf',
  green: '#2e8b3d',
  yellow: '#f2c200',
  red: '#d22b2b',
  'pearl-white': '#efece4',
  'dark-grey': '#4a4d52',
  'dove-blue': '#8fa8c8',
  'moody-blue': '#3d4f7a',
  'may-green': '#9bc46a',
  'emerald-green': '#1f7a5c',
  'bunnys-nose': '#e8a0a8',
  'tawny-port': '#7a2e3a',
  black: '#262626',
  white: '#f5f5f5',
  transparent: '#cfe8ff',
  metallic: '#a8acb0',
};

export function displayColour(colour: ColourId | undefined): string {
  return (colour && COLOURS[colour]) ?? '#888888';
}
