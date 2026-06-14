/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GuitarString {
  number: number; // 1 to 6
  note: string;   // e.g., "E", "B", "G", "D", "A", "E"
  pitch: string;  // e.g., "E4", "B3", "G3", "D3", "A2", "E2"
  frequency: number; // Hz
}

export const STANDARD_GUITAR_STRINGS: GuitarString[] = [
  { number: 1, note: "E", pitch: "E4", frequency: 329.63 },
  { number: 2, note: "H", pitch: "H3", frequency: 246.94 },
  { number: 3, note: "G", pitch: "G3", frequency: 196.00 },
  { number: 4, note: "D", pitch: "D3", frequency: 146.83 },
  { number: 5, note: "A", pitch: "A2", frequency: 110.00 },
  { number: 6, note: "E", pitch: "E2", frequency: 82.41 },
];

export interface TunerState {
  isListening: boolean;
  permissionGranted: boolean | null; // true, false, or null if not requested yet
  detectedFrequency: number;
  closestString: GuitarString | null;
  centsDifference: number; // -50 to 50
  peakAmplitude: number;
  inTune: boolean;
}
