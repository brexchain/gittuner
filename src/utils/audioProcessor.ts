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
  if (rms < 0.007) {
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
  // d(tau) = sum_{i=0}^{N-tau} (x[i] - x[i+tau])^2
  const diffFunc = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let sum = 0;
    const limit = SIZE - tau;
    for (let i = 0; i < limit; i++) {
      const diff = buffer[i] - buffer[i + tau];
      sum += diff * diff;
    }
    diffFunc[tau] = sum;
  }

  // Step 4: Find local minima of the difference function.
  // The first deep local minimum represents the fundamental period.
  let minVal = Infinity;
  let bestTau = -1;

  // We look for local minima (val valley compared to neighbors)
  for (let tau = minLag + 1; tau < maxLag; tau++) {
    if (diffFunc[tau] < diffFunc[tau - 1] && diffFunc[tau] < diffFunc[tau + 1]) {
      // Find the absolute deepest local minimum within standard guitar bounds
      if (diffFunc[tau] < minVal) {
        minVal = diffFunc[tau];
        bestTau = tau;
      }
    }
  }

  // Fallback: If no strict local minimum is resolved, take the absolute lowest point in range
  if (bestTau === -1) {
    let absoluteMin = Infinity;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (diffFunc[tau] < absoluteMin) {
        absoluteMin = diffFunc[tau];
        bestTau = tau;
      }
    }
  }

  // Step 5: Parabolic Interpolation for Sub-Sample (Cent-Level) Accuracy
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
