export type Rgb = [number, number, number];
export type Scale = Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, Rgb>;

export const SHADES: number[];
export const AA_TEXT: number;
export function normalizeHex(input: unknown): string | null;
export function hexToRgb(hex: string): Rgb | null;
export function rgbToHex(rgb: number[]): string;
export function luminance(rgb: number[]): number;
export function contrastRatio(a: string | number[], b: string | number[]): number;
export function rgbToOklch(rgb: number[]): [number, number, number];
export function oklchToRgb(lch: [number, number, number]): Rgb;
export function generateScale(hex: string): Scale | null;
export function scaleToCssVars(family: string, scale: Scale | null): Record<string, string>;
export function dominantColors(rgba: ArrayLike<number>, count?: number): string[];
