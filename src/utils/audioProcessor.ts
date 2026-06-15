/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GuitarString, STANDARD_GUITAR_STRINGS } from "../types";

/**
 * Detects the fundamental pitch frequency of a guitar signal in an audio buffer.
 * It uses a stabilized difference function (YIN-like AMDF) optimized for standard
 * guitar frequency ranges (approx 70 Hz to 360 Hz).
 * 
 * @param buffer - Time domain data from the audio analyzer
 * @param sampleRate - The actual context audio sample rate (typically 44100 or 48000 Hz)
 * @returns Detected frequency in Hz, or -1 if no stable pitch is detected.
 */
export function detectGuitarPitch(buffer: Float32Array, sampleRate: number): number {
  const SIZE = buffer.length;

  // Step 1: Calculate Root Mean Square (RMS) amplitude/power.
  // Pro guitarists want high dynamic response, but we must ignore silent room rumbles
  let sumSq = 0;
  for (let i = 0; i < SIZE; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSq / SIZE);
  
  // Cutoff threshold to ignore background noise
  if (rms < 0.012) {
    return -1;
  }

  // Step 2: Define frequency bounds for standard 6-string guitar
  // E2 (82.41 Hz) with a margin down to 70 Hz for flat-tuning support.
  // E4 (329.63 Hz) with a margin up to 380 Hz for sharp-tuning and high string pitch.
  const minFreq = 70;
  const maxFreq = 385;

  // Map frequency bounds to lag ranges (in samples)
  // Lag = sampleRate / frequency
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxLag = Math.min(SIZE - 2, Math.ceil(sampleRate / minFreq));

  // Step 3: Compute Difference Function
  // Compute from 1 to maxLag for Cumulative Mean Normalized Difference Function
  const diffFunc = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    const limit = SIZE - tau;
    for (let i = 0; i < limit; i++) {
      const diff = buffer[i] - buffer[i + tau];
      sum += diff * diff;
    }
    diffFunc[tau] = sum;
  }

  // Step 4: Compute Cumulative Mean Normalized Difference Function (YIN Step 2)
  const cmndf = new Float32Array(maxLag + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diffFunc[tau];
    cmndf[tau] = runningSum > 0 ? diffFunc[tau] / (runningSum / tau) : 1;
  }

  // Step 5: Find the first local minimum below the absolute threshold (YIN Step 3)
  // This helps to bypass pitch-halving/doubling sub-harmonics since we search from minLag upwards (high frequency to low frequency)
  const threshold = 0.15;
  let bestTau = -1;
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
      if (cmndf[tau] < threshold) {
        bestTau = tau;
        break;
      }
    }
  }

  // Fallback 1: If no local minimum falls below the threshold, choose the absolute deepest local minimum of the normalization
  if (bestTau === -1) {
    let minVal = Infinity;
    for (let tau = minLag + 1; tau < maxLag; tau++) {
      if (cmndf[tau] < cmndf[tau - 1] && cmndf[tau] < cmndf[tau + 1]) {
        if (cmndf[tau] < minVal) {
          minVal = cmndf[tau];
          bestTau = tau;
        }
      }
    }
  }

  // Fallback 2: If still no local minimum is resolved, choose the absolute lowest value in range
  if (bestTau === -1) {
    let absoluteMin = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < absoluteMin) {
        absoluteMin = cmndf[tau];
        bestTau = tau;
      }
    }
  }

  // Step 6: Parabolic Interpolation for Sub-Sample (Cent-Level) Accuracy
  // Real guitarists need high accuracy. Interpolation lets us estimate correct period between samples.
  if (bestTau > minLag && bestTau < maxLag) {
    const alpha = diffFunc[bestTau - 1];
    const beta = diffFunc[bestTau];
    const gamma = diffFunc[bestTau + 1];
    
    const denominator = alpha - 2 * beta + gamma;
    let delta = 0;
    if (Math.abs(denominator) > 1e-6) {
      delta = (alpha - gamma) / (2 * denominator);
    }
    
    const preciseTau = bestTau + delta;
    const detectedFreq = sampleRate / preciseTau;
    
    if (detectedFreq >= minFreq && detectedFreq <= maxFreq) {
      return detectedFreq;
    }
  }

  return -1;
}

/**
 * Given a detected frequency, returns the closest standard guitar string
 * and the cents offset from it.
 */
export function findClosestGuitarString(frequency: number): {
  closestString: GuitarString;
  centsDiff: number;
} {
  let closestString = STANDARD_GUITAR_STRINGS[0];
  let minAbsCents = Infinity;
  let finalCentsDiff = 0;

  for (const str of STANDARD_GUITAR_STRINGS) {
    // Standard cents formula: cents = 1200 * log2(f / f0)
    const centsDiff = 1200 * Math.log2(frequency / str.frequency);
    if (Math.abs(centsDiff) < minAbsCents) {
      minAbsCents = Math.abs(centsDiff);
      closestString = str;
      finalCentsDiff = centsDiff;
    }
  }

  return {
    closestString,
    centsDiff: finalCentsDiff,
  };
}

export interface ChromaticNoteInfo {
  note: string;       // "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"
  octave: number;     // e.g., 2, 3, 4
  frequency: number;  // frequency of the perfect pitch
  centsDiff: number;  // cents deviance from the perfect pitch
  midi: number;
}

export function findClosestChromaticNote(frequency: number): ChromaticNoteInfo {
  // standard formula based on A4 = 440Hz
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  // perfect frequency
  const perfFreq = 440 * Math.pow(2, (midi - 69) / 12);
  const centsDiff = 1200 * Math.log2(frequency / perfFreq);
  
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "H"];
  
  // To avoid index out of bounds on extremely low frequencies
  const positiveMidi = Math.max(0, midi);
  const noteName = noteNames[positiveMidi % 12];
  const octave = Math.floor(positiveMidi / 12) - 1;
  
  return {
    note: noteName,
    octave,
    frequency: perfFreq,
    centsDiff,
    midi: positiveMidi
  };
}

