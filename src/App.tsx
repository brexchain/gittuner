/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, CSSProperties } from "react";
import { Mic, MicOff, Volume2, Info, Settings, Zap, CheckCircle2, RefreshCw } from "lucide-react";
import { STANDARD_GUITAR_STRINGS, GuitarString } from "./types";
import { detectGuitarPitch, findClosestGuitarString } from "./utils/audioProcessor";

// Tuning sensitivity presets
interface SmoothingPreset {
  name: string;
  alpha: number;
  description: string;
}

const SMOOTHING_PRESETS: SmoothingPreset[] = [
  { name: "Zackig", alpha: 0.85, description: "Direkte Saiten-Erkennung ohne jede Bremse (etwas zappelig)" },
  { name: "Optimal", alpha: 0.35, description: "Der goldene Mittelweg für glückliche Saitenzupfer" },
  { name: "Träge", alpha: 0.15, description: "Maximale Trägheit gegen zittrige Greifer oder Windböen" },
];

interface Chord {
  name: string;
  frets: (number | "X")[]; // string 6 down to 1 (E A D G H E)
  fingering?: (string | null)[]; // string 6 down to 1 finger markings
  barre?: { fret: number; fromStringIdx: number; toStringIdx: number };
  tags: ("basis" | "7th" | "barre" | "sus" | "dim" | "pentatonic")[];
  multiNotes?: { stringIdx: number; frets: number[]; fingerings?: string[] }[];
}

const COMMON_CHORDS: Chord[] = [
  { name: "C", frets: ["X", 3, 2, 0, 1, 0], fingering: [null, "3", "2", null, "1", null], tags: ["basis"] },
  { name: "A", frets: ["X", 0, 2, 2, 2, 0], fingering: [null, null, "1", "2", "3", null], tags: ["basis"] },
  { name: "G", frets: [3, 2, 0, 0, 0, 3], fingering: ["3", "2", null, null, null, "4"], tags: ["basis"] },
  { name: "E", frets: [0, 2, 2, 1, 0, 0], fingering: [null, "2", "3", "1", null, null], tags: ["basis"] },
  { name: "D", frets: ["X", "X", 0, 2, 3, 2], fingering: [null, null, null, "1", "3", "2"], tags: ["basis"] },
  { name: "Am", frets: ["X", 0, 2, 2, 1, 0], fingering: [null, null, "2", "3", "1", null], tags: ["basis"] },
  { name: "Dm", frets: ["X", "X", 0, 2, 3, 1], fingering: [null, null, null, "2", "3", "1"], tags: ["basis"] },
  { name: "Em", frets: [0, 2, 2, 0, 0, 0], fingering: [null, "2", "3", null, null, null], tags: ["basis"] },
  // Barré-Griffe
  { name: "F", frets: [1, 3, 3, 2, 1, 1], fingering: ["1", "3", "4", "2", "1", "1"], barre: { fret: 1, fromStringIdx: 0, toStringIdx: 5 }, tags: ["barre"] },
  { name: "Fm", frets: [1, 3, 3, 1, 1, 1], fingering: ["1", "3", "4", "1", "1", "1"], barre: { fret: 1, fromStringIdx: 0, toStringIdx: 5 }, tags: ["barre"] },
  { name: "Hm", frets: ["X", 2, 4, 4, 3, 2], fingering: [null, "1", "3", "4", "2", "1"], barre: { fret: 2, fromStringIdx: 1, toStringIdx: 5 }, tags: ["barre"] },
  { name: "C#m", frets: ["X", 4, 6, 6, 5, 4], fingering: [null, "1", "3", "4", "2", "1"], barre: { fret: 4, fromStringIdx: 1, toStringIdx: 5 }, tags: ["barre"] },
  { name: "Gm", frets: [3, 5, 5, 3, 3, 3], fingering: ["1", "3", "4", "1", "1", "1"], barre: { fret: 3, fromStringIdx: 0, toStringIdx: 5 }, tags: ["barre"] },
  { name: "Cm", frets: ["X", 3, 5, 5, 4, 3], fingering: [null, "1", "3", "4", "2", "1"], barre: { fret: 3, fromStringIdx: 1, toStringIdx: 5 }, tags: ["barre"] },
  // 7er Akkorde
  { name: "D7", frets: ["X", "X", 0, 2, 1, 2], fingering: [null, null, null, "2", "1", "3"], tags: ["7th"] },
  { name: "Am7", frets: ["X", 0, 2, 0, 1, 0], fingering: [null, null, "2", null, "1", null], tags: ["7th"] },
  { name: "C7", frets: ["X", 3, 2, 3, 1, 0], fingering: [null, "3", "2", "4", "1", null], tags: ["7th"] },
  { name: "G7", frets: [3, 2, 0, 0, 0, 1], fingering: ["3", "2", null, null, null, "1"], tags: ["7th"] },
  { name: "E7", frets: [0, 2, 0, 1, 0, 0], fingering: [null, "2", null, "1", null, null], tags: ["7th"] },
  { name: "A7", frets: ["X", 0, 2, 0, 2, 0], fingering: [null, null, "1", null, "2", null], tags: ["7th"] },
  // Sus-Akkorde
  { name: "Asus4", frets: ["X", 0, 2, 2, 3, 0], fingering: [null, null, "2", "3", "4", null], tags: ["sus"] },
  { name: "Dsus4", frets: ["X", "X", 0, 2, 3, 3], fingering: [null, null, null, "1", "3", "4"], tags: ["sus"] },
  { name: "Esus4", frets: [0, 2, 2, 2, 0, 0], fingering: [null, "2", "3", "4", null, null], tags: ["sus"] },
  { name: "Asus2", frets: ["X", 0, 2, 2, 0, 0], fingering: [null, null, "2", "3", null, null], tags: ["sus"] },
  { name: "Dsus2", frets: ["X", "X", 0, 2, 3, 0], fingering: [null, null, null, "1", "3", null], tags: ["sus"] },
  { name: "Csus2", frets: ["X", 3, 0, 0, 1, 1], fingering: [null, "3", null, null, "1", "1"], tags: ["sus"] },
  // Dim / Verminderte
  { name: "Adim7", frets: ["X", "X", 1, 2, 1, 2], fingering: [null, null, "1", "3", "2", "4"], tags: ["dim"] },
  { name: "Fdim7", frets: ["X", "X", 0, 1, 0, 1], fingering: [null, null, null, "1", null, "2"], tags: ["dim"] },
  { name: "Edim7", frets: ["X", "X", 2, 3, 2, 3], fingering: [null, null, "1", "3", "2", "4"], tags: ["dim"] },
  { name: "Hdim", frets: ["X", 2, 3, 4, 3, "X"], fingering: [null, "1", "2", "4", "3", null], tags: ["dim"] },
  // Pentatonik-Griffe
  { 
    name: "Am Pent.", 
    frets: [5, 5, 5, 5, 5, 5], 
    tags: ["pentatonic"],
    multiNotes: [
      { stringIdx: 0, frets: [5, 8], fingerings: ["1", "4"] },
      { stringIdx: 1, frets: [5, 7], fingerings: ["1", "3"] },
      { stringIdx: 2, frets: [5, 7], fingerings: ["1", "3"] },
      { stringIdx: 3, frets: [5, 7], fingerings: ["1", "3"] },
      { stringIdx: 4, frets: [5, 8], fingerings: ["1", "4"] },
      { stringIdx: 5, frets: [5, 8], fingerings: ["1", "4"] },
    ]
  },
  { 
    name: "C Pent.", 
    frets: [8, 8, 8, 8, 8, 8], 
    tags: ["pentatonic"],
    multiNotes: [
      { stringIdx: 0, frets: [8, 10], fingerings: ["1", "3"] },
      { stringIdx: 1, frets: [7, 10], fingerings: ["1", "4"] },
      { stringIdx: 2, frets: [7, 10], fingerings: ["1", "4"] },
      { stringIdx: 3, frets: [7, 9], fingerings: ["1", "3"] },
      { stringIdx: 4, frets: [8, 10], fingerings: ["1", "3"] },
      { stringIdx: 5, frets: [8, 10], fingerings: ["1", "3"] },
    ]
  },
  { 
    name: "G Pent.", 
    frets: [3, 3, 3, 3, 3, 3], 
    tags: ["pentatonic"],
    multiNotes: [
      { stringIdx: 0, frets: [3, 5], fingerings: ["1", "3"] },
      { stringIdx: 1, frets: [2, 5], fingerings: ["1", "4"] },
      { stringIdx: 2, frets: [2, 5], fingerings: ["1", "4"] },
      { stringIdx: 3, frets: [2, 4], fingerings: ["1", "3"] },
      { stringIdx: 4, frets: [3, 5], fingerings: ["1", "3"] },
      { stringIdx: 5, frets: [3, 5], fingerings: ["1", "3"] },
    ]
  },
];

export default function App() {
  // Audio state references
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // States
  const [permissionState, setPermissionState] = useState<"not-requested" | "granted" | "denied">("not-requested");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [bypassPermissionOverlay, setBypassPermissionOverlay] = useState<boolean>(false);

  // Live tuning state (throttled/smoothed)
  const [tuningData, setTuningData] = useState<{
    frequency: number;
    closestString: GuitarString | null;
    centsDiff: number;
    hasSignal: boolean;
    rmsValue: number;
  }>({
    frequency: 0,
    closestString: null,
    centsDiff: 0,
    hasSignal: false,
    rmsValue: 0,
  });

  // Settings states
  const [selectedPreset, setSelectedPreset] = useState<SmoothingPreset>(SMOOTHING_PRESETS[1]); // Standard
  const [targetStringLock, setTargetStringLock] = useState<number | null>(null); // null = auto detect
  const [displayMode, setDisplayMode] = useState<"soundhole" | "led-bar">("soundhole");
  const [selectedChord, setSelectedChord] = useState<Chord>(COMMON_CHORDS[0]);
  const [chordFilter, setChordFilter] = useState<"all" | "basis" | "7th" | "barre" | "sus" | "dim" | "pentatonic">("all");

  // Interactive "afterglow" state for the last strummed note / tuning delta
  const [lastStrum, setLastStrum] = useState<{
    cents: number;
    closestString: GuitarString;
    timestamp: number;
  } | null>(null);

  // Smoothing filters state trackers
  const lastFreqRef = useRef<number>(-1);
  const lastCentsRef = useRef<number>(0);
  const alphaRef = useRef<number>(0.35);

  // Sync alpha setting
  useEffect(() => {
    alphaRef.current = selectedPreset.alpha;
  }, [selectedPreset]);

  // Audio synthesis reference trackers
  const activeOscillatorRef = useRef<OscillatorNode | null>(null);
  const activeGainRef = useRef<GainNode | null>(null);
  const playTimeoutRef = useRef<number | null>(null);
  const [playingStringNum, setPlayingStringNum] = useState<number | null>(null);

  // Mobile screensaver / sleep-timer state (configured to exactly 99 seconds)
  const [isDimmed, setIsDimmed] = useState<boolean>(false);
  const wakeLockRef = useRef<any>(null);
  const lastActiveRef2 = useRef<number>(Date.now());

  // Request Wake Lock to keep screen awake on mobile device
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        // Ignored safe fallback
      }
    }
  };

  // Releasable reference to Wake Lock
  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {}
    }
  };

  // Resets the inactivity countdown timer
  const resetInactivityTimer = () => {
    lastActiveRef2.current = Date.now();
    if (isDimmed) {
      setIsDimmed(false);
      requestWakeLock();
    }
  };

  // Automatically reset the idle state whenever active guitar signal is detected
  useEffect(() => {
    if (tuningData.hasSignal) {
      lastActiveRef2.current = Date.now();
      if (isDimmed) {
        setIsDimmed(false);
        requestWakeLock();
      }
    }
  }, [tuningData.hasSignal, isDimmed]);

  // Combined master interval checking for 99s sleep/dim behavior + Wake Lock binders
  useEffect(() => {
    requestWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
        lastActiveRef2.current = Date.now();
      } else {
        releaseWakeLock();
      }
    };

    const handleInteraction = () => {
      resetInactivityTimer();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('click', handleInteraction);
    document.addEventListener('touchstart', handleInteraction, { passive: true });
    document.addEventListener('mousemove', handleInteraction, { passive: true });
    document.addEventListener('keydown', handleInteraction);

    // Track active/inactive elapsed time in milliseconds (99 seconds limit)
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastActiveRef2.current;
      if (elapsed >= 99000) {
        if (!isDimmed) {
          setIsDimmed(true);
          releaseWakeLock();
        }
      }
    }, 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      document.removeEventListener('mousemove', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
      clearInterval(checkInterval);
      releaseWakeLock();
    };
  }, [isDimmed]);

  const stopReferencePitch = () => {
    if (playTimeoutRef.current) {
      clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    if (activeGainRef.current && audioCtxRef.current) {
      try {
        const now = audioCtxRef.current.currentTime;
        activeGainRef.current.gain.cancelScheduledValues(now);
        activeGainRef.current.gain.setValueAtTime(activeGainRef.current.gain.value, now);
        // Exponential ramp to 0 to avoid audio clicks/pops
        activeGainRef.current.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        
        const osc = activeOscillatorRef.current;
        setTimeout(() => {
          try {
            osc?.stop();
            osc?.disconnect();
          } catch (e) {}
        }, 120);
      } catch (e) {}
      activeOscillatorRef.current = null;
      activeGainRef.current = null;
    }
    setPlayingStringNum(null);
  };

  const playReferencePitch = (freq: number, stringNum: number) => {
    // If we're already playing this string, toggle it off
    if (playingStringNum === stringNum) {
      stopReferencePitch();
      return;
    }

    // Stop active sound playback
    stopReferencePitch();

    try {
      let audioCtx = audioCtxRef.current;
      if (!audioCtx || audioCtx.state === "closed") {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtxClass();
        audioCtxRef.current = audioCtx;
      }

      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      // Triangle waves yield a warm, plucky wooden acoustic reference tone
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

      // Create a nice pluck-and-fade envelope (avoid harsh steady waveforms)
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.22, audioCtx.currentTime + 0.08); // onset pluck
      gainNode.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 3.0); // smooth decay

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();

      activeOscillatorRef.current = osc;
      activeGainRef.current = gainNode;
      setPlayingStringNum(stringNum);

      // Automatic sound termination offset
      playTimeoutRef.current = window.setTimeout(() => {
        stopReferencePitch();
      }, 3000);

    } catch (err) {
      console.error("Synthesizer failed:", err);
    }
  };

  const playChord = (chord: Chord) => {
    try {
      let audioCtx = audioCtxRef.current;
      if (!audioCtx || audioCtx.state === "closed") {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        audioCtx = new AudioCtxClass();
        audioCtxRef.current = audioCtx;
      }

      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      // Stop any single active reference tone
      stopReferencePitch();

      const stringsCopy = [...STANDARD_GUITAR_STRINGS].reverse(); // from String 6 to 1

      if (chord.multiNotes) {
        // Play as a beautiful rising scale run!
        let noteCounter = 0;
        chord.multiNotes.forEach((mNotes) => {
          const str = stringsCopy[mNotes.stringIdx];
          mNotes.frets.forEach((fret) => {
            const freq = str.frequency * Math.pow(2, fret / 12);
            const staggerSeconds = 0.22 * noteCounter; // Melodic scale stagger (220ms per note)
            const playTime = audioCtx!.currentTime + staggerSeconds;

            const osc = audioCtx!.createOscillator();
            const gainNode = audioCtx!.createGain();

            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, playTime);

            gainNode.gain.setValueAtTime(0, audioCtx!.currentTime);
            gainNode.gain.setValueAtTime(0, playTime);
            gainNode.gain.linearRampToValueAtTime(0.18, playTime + 0.04);
            gainNode.gain.exponentialRampToValueAtTime(0.005, playTime + 1.2); // slightly shorter decay for fast runs

            osc.connect(gainNode);
            gainNode.connect(audioCtx!.destination);

            osc.start(playTime);
            osc.stop(playTime + 1.4);
            noteCounter++;
          });
        });
      } else {
        // Standard chord strum
        stringsCopy.forEach((str, index) => {
          const fret = chord.frets[index];
          if (fret === "X") return;

          // Calculate frequency
          const freq = str.frequency * Math.pow(2, Number(fret) / 12);
          const staggerSeconds = 0.055 * index; // beautiful, relaxed strum cadence

          const playTime = audioCtx!.currentTime + staggerSeconds;

          const osc = audioCtx!.createOscillator();
          const gainNode = audioCtx!.createGain();

          // Let's use clean "triangle" oscillators for warm resonance
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, playTime);

          gainNode.gain.setValueAtTime(0, audioCtx!.currentTime);
          gainNode.gain.setValueAtTime(0, playTime);
          gainNode.gain.linearRampToValueAtTime(0.18, playTime + 0.06); // pluck onset
          gainNode.gain.exponentialRampToValueAtTime(0.005, playTime + 2.5); // long organic acoustic sustain

          osc.connect(gainNode);
          gainNode.connect(audioCtx!.destination);

          osc.start(playTime);

          // Schedule stopping to conserve resources
          osc.stop(playTime + 2.8);
        });
      }
    } catch (err) {
      console.error("Failed to synthesize strum:", err);
    }
  };

  // Request microphone on component mount automatically (user request)
  useEffect(() => {
    startTuningEngine("auto");
    return () => {
      stopTuningEngine();
      stopReferencePitch();
    };
  }, []);

  // Stop everything
  const stopTuningEngine = () => {
    stopReferencePitch();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setIsListening(false);
  };

  // Start the Audio API and detect pitches
  const startTuningEngine = async (triggerType: "auto" | "manual" | any = "manual") => {
    // Reset state first
    setErrorMsg("");
    stopTuningEngine();

    try {
      // 1. Get user media stream
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Dein Browser unterstützt keinen Mikrofonzugriff in diesem Kontext (z. B. wegen Sicherheits-Einschränkungen im iFrame). Du kannst die App trotzdem im manuellen Modus nutzen!");
      }

      // We disable autoGainControl, noiseSuppression, and echoCancellation for instruments.
      // Filtering algorithms designed for speech completely mangle the raw harmonic contents
      // of string strikes. Disabling them is essential for pro accuracy.
      const constraints = {
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setPermissionState("granted");
      setBypassPermissionOverlay(false);

      // 2. Initialize Web Audio Context
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;

      // 3. Create Analyser Node
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048; // Excellent time resolution for guitar standard tuning range
      analyserRef.current = analyser;

      // 4. Bind source
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      setIsListening(true);

      // Start processing samples
      const buffer = new Float32Array(analyser.fftSize);
      
      const processTick = () => {
        if (!analyserRef.current) return;
        
        if (typeof analyserRef.current.getFloat32TimeDomainData === "function") {
          analyserRef.current.getFloat32TimeDomainData(buffer);
        } else if (typeof analyserRef.current.getByteTimeDomainData === "function") {
          const byteBuffer = new Uint8Array(buffer.length);
          analyserRef.current.getByteTimeDomainData(byteBuffer);
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = (byteBuffer[i] - 128) / 128;
          }
        } else {
          // Absolute fallback if no time domain function is available
          buffer.fill(0);
        }

        // Calculate root mean square of signal strength
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);

        const freq = detectGuitarPitch(buffer, audioCtx.sampleRate);

        if (freq > 0 && rms > 0.007) {
          // Identify closest string or use manual lock
          let closestStr: GuitarString;
          let cents: number;

          if (targetStringLock !== null) {
            const lockedStr = STANDARD_GUITAR_STRINGS.find(s => s.number === targetStringLock);
            if (lockedStr) {
              closestStr = lockedStr;
              cents = 1200 * Math.log2(freq / lockedStr.frequency);
            } else {
              const res = findClosestGuitarString(freq);
              closestStr = res.closestString;
              cents = res.centsDiff;
            }
          } else {
            const res = findClosestGuitarString(freq);
            closestStr = res.closestString;
            cents = res.centsDiff;
          }

          // Apply specialized exponential smoothing (EMA) for rock-solid visual feedback
          const alpha = alphaRef.current;
          let finalFreq = freq;
          let finalCents = cents;

          // Only smooth if we are targeting the same pitch vicinity, preventing transition lag
          if (lastFreqRef.current > 0 && Math.abs(freq - lastFreqRef.current) < 20) {
            finalFreq = lastFreqRef.current * (1 - alpha) + freq * alpha;
          }
          lastFreqRef.current = finalFreq;

          if (Math.abs(cents - lastCentsRef.current) < 30) {
            finalCents = lastCentsRef.current * (1 - alpha) + cents * alpha;
          }
          lastCentsRef.current = finalCents;

          setTuningData({
            frequency: finalFreq,
            closestString: closestStr,
            centsDiff: finalCents,
            hasSignal: true,
            rmsValue: rms,
          });
          setLastStrum({
            cents: finalCents,
            closestString: closestStr,
            timestamp: Date.now(),
          });
        } else {
          // No stable pitch detected or amplitude is below noise threshold
          setTuningData((prev) => ({
            ...prev,
            hasSignal: false,
            rmsValue: rms,
          }));
          
          // Gently let the last frequency decay to avoid visual jumping
          lastFreqRef.current = -1;
        }

        animationFrameRef.current = requestAnimationFrame(processTick);
      };

      animationFrameRef.current = requestAnimationFrame(processTick);

    } catch (err: any) {
      console.warn("Microphone access denied or audio issue", err);
      setPermissionState("denied");
      
      let friendlyError = "Lausch-Erlaubnis verweigert! Bitte gib uns das Mikrofon im Browser frei, sonst können wir deine Saiten-Vibrationen nicht erschnüffeln.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError" || err.message?.toLowerCase().includes("denied")) {
        friendlyError = "Mikrofonzugriff blockiert! Bitte aktiviere den Zugriff in deinen Browsereinstellungen für diese Website, um das Stimmgerät voll zu nutzen. Oder wechsle in den unten angebotenen manuellen Modus.";
      } else if (err.message) {
        friendlyError = err.message;
      }
      
      setErrorMsg(friendlyError);

      // Always automatically bypass the fullscreen blocker overlay on any error/denial,
      // so the user can immediately use manual mode, reference string generator, and chord library!
      setBypassPermissionOverlay(true);
    }
  };

  const { frequency, closestString, centsDiff, hasSignal } = tuningData;
  const isInTune = hasSignal && Math.abs(centsDiff) <= 3; // Absolute master precision: within 3 cents

  // Normalized translation offset for standard needle UI (-50 cents to +50 cents mapping to 0% to 100%)
  const clampedCents = Math.max(-50, Math.min(50, centsDiff));
  const needlePercentage = ((clampedCents + 50) / 100) * 100;

  // Chord starting fret and category filtering calculations
  const allFretsList: number[] = [];
  selectedChord.frets.forEach((f) => {
    if (typeof f === "number" && f > 0) allFretsList.push(f);
  });
  if (selectedChord.multiNotes) {
    selectedChord.multiNotes.forEach((m) => {
      m.frets.forEach((f) => {
        if (f > 0) allFretsList.push(f);
      });
    });
  }
  const maxFret = allFretsList.length > 0 ? Math.max(...allFretsList) : 0;
  const startFret = maxFret > 5 ? Math.min(...allFretsList) : 1;
  const showNut = startFret === 1;
  const filteredChords = chordFilter === "all" 
    ? COMMON_CHORDS 
    : COMMON_CHORDS.filter(c => c.tags.includes(chordFilter));

  // Helper to render the LED segment metric (Horizontal Tuning Bar)
  const renderHorizontalTuningBar = () => {
    const totalTiles = 29;
    const activeIdx = hasSignal ? Math.round(((clampedCents + 50) / 100) * (totalTiles - 1)) : -1;

    // Calculate last strum afterglow index & opacity
    let lastStrumIdx = -1;
    let lastStrumOpacity = 0;
    let isLastStrumInTune = false;

    if (lastStrum) {
      const elapsed = Date.now() - lastStrum.timestamp;
      lastStrumOpacity = Math.max(0, Math.min(1, 1 - (elapsed - 1000) / 3000));
      
      if (lastStrumOpacity > 0) {
        const lastClampedCents = Math.max(-50, Math.min(50, lastStrum.cents));
        lastStrumIdx = Math.round(((lastClampedCents + 50) / 100) * (totalTiles - 1));
        isLastStrumInTune = Math.abs(lastStrum.cents) <= 3;
      }
    }

    return (
      <div className="relative h-20 flex flex-col justify-end w-full max-w-xl mx-auto px-1 animate-fade-in">
        {/* Scale Labels */}
        <div className="w-full flex justify-between text-[9px] font-mono text-white/40 tracking-tighter uppercase px-1 mb-1.5">
          <span>-50 Cent (Schlaff)</span>
          <span>-25</span>
          <span className={`transition-all duration-300 font-bold ${
            hasSignal && isInTune ? "text-green-400 font-black shadow-sm" : "text-white/60"
          }`}>
            Passt!
          </span>
          <span>+25</span>
          <span>+50 Cent (Stramm)</span>
        </div>
        
        {/* Interactive Bar Grid container - Styled as vertical LED segments */}
        <div className="w-full h-10 bg-[#0A0A0A] rounded-md flex items-center justify-between gap-[3px] px-2 border border-white/10 relative">
          {Array.from({ length: totalTiles }).map((_, i) => {
            const isActive = hasSignal && activeIdx === i;
            const distance = hasSignal ? Math.abs(i - activeIdx) : -1;
            const isNear = distance === 1;

            const isLastStrumActive = !hasSignal && lastStrumIdx === i && lastStrumOpacity > 0;
            const isLastStrumNear = !hasSignal && Math.abs(i - lastStrumIdx) === 1 && lastStrumOpacity > 0;

            // Determine base LED scale colors (dim state)
            let baseColor = "bg-red-500/10";
            if (i >= 13 && i <= 15) {
              baseColor = "bg-green-500/15";
            } else if ((i >= 11 && i <= 12) || (i >= 16 && i <= 17)) {
              baseColor = "bg-yellow-500/10";
            }

            // Determine brightly lit active state colors
            let litColor = "bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.85)]";
            if (i >= 13 && i <= 15) {
              litColor = "bg-green-400 shadow-[0_0_16px_rgba(34,197,94,0.95)]";
            } else if ((i >= 11 && i <= 12) || (i >= 16 && i <= 17)) {
              litColor = "bg-yellow-400 shadow-[0_0_14px_rgba(234,179,8,0.9)]";
            }

            // Assign segment heights
            let heightClass = "h-[45%]";
            if (i === 14) {
              heightClass = "h-[75%]"; // absolute center tick is taller
            } else if (i === 0 || i === 28) {
              heightClass = "h-[65%]"; // outer boundary ticks are moderately tall
            } else if (i === 7 || i === 21) {
              heightClass = "h-[55%]"; // intermediate ticks
            }

            // Apply active glow and sizing modifications
            let finalStyle = baseColor;
            let inlineStyle: CSSProperties = {};

            if (isActive) {
              finalStyle = litColor;
              heightClass = "h-[90%]";
            } else if (isNear) {
              let nearColor = "bg-red-500/40";
              if (i >= 13 && i <= 15) {
                nearColor = "bg-green-500/40";
              } else if ((i >= 11 && i <= 12) || (i >= 16 && i <= 17)) {
                nearColor = "bg-yellow-500/40";
              }
              finalStyle = nearColor;
              heightClass = "h-[70%]";
            } else if (isLastStrumActive) {
              let afterglowColor = isLastStrumInTune 
                ? "bg-green-400/90 shadow-[0_0_16px_rgba(34,197,94,0.8)] border border-green-300" 
                : "bg-red-500/90 shadow-[0_0_12px_rgba(239,68,68,0.7)] border border-red-300";
              if ((lastStrumIdx >= 11 && lastStrumIdx <= 12) || (lastStrumIdx >= 16 && lastStrumIdx <= 17)) {
                afterglowColor = "bg-yellow-400/90 shadow-[0_0_14px_rgba(234,179,8,0.7)] border border-yellow-300";
              }
              finalStyle = afterglowColor;
              heightClass = "h-[90%]";
              inlineStyle = { opacity: lastStrumOpacity };
            } else if (isLastStrumNear) {
              let afterglowNearColor = isLastStrumInTune 
                ? "bg-green-500/40" 
                : "bg-red-500/40";
              if ((lastStrumIdx >= 11 && lastStrumIdx <= 12) || (lastStrumIdx >= 16 && lastStrumIdx <= 17)) {
                afterglowNearColor = "bg-yellow-500/40";
              }
              finalStyle = afterglowNearColor;
              heightClass = "h-[70%]";
              inlineStyle = { opacity: lastStrumOpacity };
            }

            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-all duration-75 ease-out ${finalStyle} ${heightClass}`}
                style={inlineStyle}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F5] flex flex-col justify-between font-sans transition-colors duration-300 relative overflow-hidden select-none">
      
      {bypassPermissionOverlay && permissionState !== "granted" && (
        <div id="manual-mode-banner" className="bg-amber-950/30 border-b border-amber-500/20 px-6 sm:px-10 py-3 text-[11px] sm:text-xs text-amber-300 font-mono flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in z-20">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span>
              <strong>Manueller Referenz-Modus:</strong> Stimmgerät lauscht gerade nicht (Blockiert oder Stumm). Benutze die Saiten unten oder die Akkord-Bibliothek zum Stimmen!
            </span>
          </div>
          <button
            onClick={() => {
              setBypassPermissionOverlay(false);
              startTuningEngine();
            }}
            className="px-3 py-1 bg-amber-500 text-black font-extrabold uppercase rounded text-[9px] hover:bg-amber-400 active:scale-95 transition-all cursor-pointer self-end sm:self-auto"
          >
            Mikrofon aktivieren 🎤
          </button>
        </div>
      )}

      {/* Design Header: Status Bar Layout */}
      <header className="flex justify-between items-center px-6 sm:px-10 py-6 sm:py-8 border-b border-white/10 relative z-10 bg-[#0A0A0A]">
        {/* Device Status Segment */}
        <button 
          id="mic-head-toggle-btn"
          onClick={isListening ? stopTuningEngine : startTuningEngine}
          className="flex flex-col text-left group transition-all"
        >
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1 group-hover:text-white/60">
            Lauscher-Zustand
          </span>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
              isListening 
                ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse" 
                : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
            }`} />
            <span className="text-xs sm:text-sm font-semibold tracking-tight hover:underline">
              {isListening ? "MUKKE-OHR SPERRANGELWEIT OFFEN! 🎤" : "STILLE IM KARTON / MIKRO AUS 🤐"}
            </span>
          </div>
        </button>
        
        {/* Reference Segment */}
        <div className="hidden sm:flex flex-col text-center">
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1">Kammerton</span>
          <div className="text-sm font-mono tracking-wider font-semibold text-white/90">A4 = 440.0 Hz (Wie immer)</div>
        </div>

        {/* Lock / Automatic Mode Segment */}
        <div className="text-right flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1">Stimm-Zustand</span>
          <div className="text-xs sm:text-sm font-semibold tracking-tight text-white/90 uppercase">
            {targetStringLock !== null ? `NUR SAITE ${targetStringLock} IM VISIER 🎯` : "AUTOMATISCHER SAITEN-RIECHER 🐕"}
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center relative px-4 py-8 sm:py-16">
        {/* Inline CSS animations for physically realistic string vibration */}
        <style>{`
          @keyframes vibrateStringAnimation {
            0% { transform: translate(0, 0); }
            20% { transform: translate(-1.2px, 0.4px); }
            40% { transform: translate(1.2px, -0.4px); }
            60% { transform: translate(-0.8px, -0.2px); }
            80% { transform: translate(0.8px, 0.2px); }
            100% { transform: translate(0, 0); }
          }
          .animate-string-vibrate {
            animation: vibrateStringAnimation 0.08s infinite linear;
          }
        `}</style>

        {/* Elegant Vertical Acoustic Guitar Body Underlay */}
        <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center overflow-visible">
          <svg 
            viewBox="0 0 600 850" 
            className="w-[720px] sm:w-[940px] md:w-[1080px] h-auto max-w-[170vw] opacity-80 select-none animate-fade-in transition-all duration-300"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Sunburst Gradient */}
              <radialGradient id="guitar-sunburst" cx="300" cy="425" r="300" fx="300" fy="425" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#ffb300" stopOpacity="0.85" />
                <stop offset="30%" stopColor="#f57c00" stopOpacity="0.8" />
                <stop offset="55%" stopColor="#d84315" stopOpacity="0.7" />
                <stop offset="82%" stopColor="#3e2723" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0d0d0d" stopOpacity="0.95" />
              </radialGradient>

              {/* Fingerboard Texture */}
              <linearGradient id="fingerboard-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1a120b" />
                <stop offset="50%" stopColor="#2e2114" />
                <stop offset="100%" stopColor="#1a120b" />
              </linearGradient>

              {/* Pickguard/Schlagschutz Shape Gradient */}
              <linearGradient id="pickguard-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2b0e02" />
                <stop offset="100%" stopColor="#080301" />
              </linearGradient>

              {/* Bridge Wood Gradient */}
              <linearGradient id="bridge-wood" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3E2723" />
                <stop offset="100%" stopColor="#1A0C06" />
              </linearGradient>
            </defs>

            {/* Fretboard & Neck (standing vertically up) */}
            <rect x="272" y="0" width="56" height="282" fill="url(#fingerboard-grad)" rx="1" />
            
            {/* Silver NICKEL frets on neck */}
            {Array.from({ length: 14 }).map((_, i) => {
              const fretY = 282 - (i * 18);
              return (
                <g key={i}>
                  <line x1="272" y1={fretY} x2="328" y2={fretY} stroke="#8a8a8a" strokeWidth="1" opacity="0.5" />
                  {/* Pearl Dot Inlays on fret 3, 5, 7, 9, 12 */}
                  {[3, 5, 7, 9].includes(i + 1) && (
                    <circle cx="300" cy={fretY - 9} r="2.5" fill="#eaeaea" opacity="0.8" />
                  )}
                  {i + 1 === 12 && (
                    <>
                      <circle cx="293" cy={fretY - 9} r="2" fill="#eaeaea" opacity="0.8" />
                      <circle cx="307" cy={fretY - 9} r="2" fill="#eaeaea" opacity="0.8" />
                    </>
                  )}
                </g>
              );
            })}

            {/* Wood Grain Sunburst Guitar Front Face Plate */}
            <path 
              d="M 300 280 
                 C 245 280, 160 286, 142 360 
                 C 125 430, 175 480, 195 505 
                 C 165 545, 85 600, 85 695 
                 C 85 795, 175 850, 300 850 
                 C 425 850, 515 795, 515 695 
                 C 515 600, 435 545, 405 505 
                 C 425 480, 475 430, 458 360 
                 C 440 286, 355 280, 300 280 Z" 
              fill="url(#guitar-sunburst)"
              stroke="#432111"
              strokeWidth="8"
              className="drop-shadow-[0_15px_30px_rgba(0,0,0,0.9)]"
            />

            {/* Outer binding decoration */}
            <path 
              d="M 300 283 
                 C 246 283, 162 289, 145 361 
                 C 128 431, 176 481, 196 506 
                 C 166 546, 88 601, 88 696 
                 C 88 792, 177 847, 300 847 
                 C 423 847, 512 792, 512 696 
                 C 512 601, 434 546, 404 506 
                 C 424 501, 472 481, 455 361 
                 C 438 289, 354 283, 300 283 Z" 
              fill="none"
              stroke="#fffef2"
              strokeWidth="1.5"
              opacity="0.2"
            />

            {/* Classic Tortoiseshell Custom Pickguard */}
            <path
              d="M 300 425
                 A 75 75 0 0 1 353 478
                 L 395 478
                 C 415 478, 440 520, 420 550
                 C 400 580, 335 520, 320 495
                 Z"
              fill="url(#pickguard-grad)"
              opacity="0.75"
              className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)]"
            />

            {/* Wooden Soundhole Outer Rosette Binding (underlays actual rosette interface card) */}
            <circle cx="300" cy="425" r="77" fill="none" stroke="#2B1408" strokeWidth="6" opacity="0.6" />
            <circle cx="300" cy="425" r="75" fill="none" stroke="#ffb300" strokeWidth="2" opacity="0.4" />
            <circle cx="300" cy="425" r="69" fill="#000000" opacity="0.1" />

            {/* Rosewood Bridge on lower bout */}
            <g transform="translate(0, 390)" className="drop-shadow-[0_4px_10px_rgba(0,0,0,0.7)]">
              {/* Bridge body wings */}
              <path 
                d="M 190 318
                   C 220 316, 225 310, 245 310
                   L 355 310
                   C 375 310, 380 316, 410 318
                   C 420 322, 420 326, 410 329
                   C 380 331, 375 328, 355 328
                   L 245 328
                   C 225 328, 220 331, 190 329
                   C 180 326, 180 322, 190 318 Z" 
                fill="url(#bridge-wood)"
                stroke="#150a04"
                strokeWidth="1.5"
              />
              
              {/* Bone saddle */}
              <rect x="238" y="316" width="124" height="3" fill="#faf9f2" rx="0.5" className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]" />
              
              {/* Pin slots with dot details */}
              {Array.from({ length: 6 }).map((_, idx) => {
                const pinX = 250 + idx * 20;
                return (
                  <g key={idx}>
                    <circle cx={pinX} cy="323" r="3" fill="#1b120f" stroke="#0e0806" strokeWidth="0.5" />
                    <circle cx={pinX} cy="323" r="1" fill="#ffffff" opacity="0.85" />
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        
        {/* Centered Pitch Indicator Line (Static Backdrop Overlay only for standard display) */}
        {displayMode === "led-bar" && (
          <div className="absolute inset-x-0 inset-y-0 pointer-events-none flex justify-center z-0">
            <div className="h-full w-[1.5px] bg-white/10 relative">
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all duration-500 ${
                hasSignal && isInTune 
                  ? "bg-green-400 shadow-[0_0_25px_#22c55e,0_0_10px_#22c55e]" 
                  : "bg-white/40 shadow-[0_0_15px_rgba(255,255,255,0.2)]"
              }`} />
            </div>
          </div>
        )}

        {/* Display Mode Rocker Switch */}
        <div className="relative z-20 flex justify-center mb-6">
          <div className="flex bg-neutral-900/80 p-1 rounded-full border border-white/10 shadow-2xl">
            <button
              id="view-toggle-soundhole"
              onClick={() => setDisplayMode("soundhole")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-bold transition-all uppercase tracking-wider cursor-pointer select-none ${
                displayMode === "soundhole"
                  ? "bg-amber-600 text-white shadow-md shadow-amber-900/40"
                  : "text-white/40 hover:text-white/75"
              }`}
            >
              <span>🎸 Akustik-Schallloch</span>
            </button>
            <button
              id="view-toggle-led"
              onClick={() => setDisplayMode("led-bar")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] font-bold transition-all uppercase tracking-wider cursor-pointer select-none ${
                displayMode === "led-bar"
                  ? "bg-white/10 text-white shadow-md"
                  : "text-white/40 hover:text-white/75"
              }`}
            >
              <span>📊 Studio-Balken</span>
            </button>
          </div>
        </div>

        {displayMode === "soundhole" ? (
          /* ==================== ACOUSTIC SOUNDHOLE CALIBRATOR ==================== */
          <div className="relative z-10 flex flex-col items-center justify-center w-full my-auto">
            {/* The Rosette Body container */}
            <div className="relative z-10 w-64 h-64 sm:w-[290px] sm:h-[290px] md:w-[325px] md:h-[325px] rounded-full p-[10px] bg-gradient-to-br from-[#8C5230] via-[#5C3218] to-[#2B1408] shadow-[0_20px_50px_rgba(0,0,0,0.85),inset_0_2px_12px_rgba(255,255,255,0.15)] border border-[#8C5230]/40 flex items-center justify-center select-none transition-all">
              
              {/* Wooden Inlaid Concentric Rosette Rings */}
              <div className="absolute inset-4 rounded-full border-4 border-double border-yellow-600/35 pointer-events-none" />
              <div className="absolute inset-7 rounded-full border border-yellow-700/20 pointer-events-none" />
              <div className="absolute inset-[3px] rounded-full border border-black/40 pointer-events-none" />

              {/* Black Soundhole Deep interior cavity */}
              <div className="w-full h-full rounded-full bg-[#030303] relative overflow-hidden flex flex-col items-center justify-center shadow-[inset_0_10px_35px_rgba(0,0,0,0.96)] border-2 border-neutral-950">
                
                {/* 6 Acoustic Steel Strings overlay vertically */}
                <div className="absolute inset-x-0 top-0 bottom-0 flex justify-between px-10 sm:px-14 md:px-16 pointer-events-none z-10">
                  {(() => {
                    const stringPositions = [
                      { num: 6, label: "E", thickness: "w-[4.2px] sm:w-[5px]" },
                      { num: 5, label: "A", thickness: "w-[3.3px] sm:w-[3.9px]" },
                      { num: 4, label: "D", thickness: "w-[2.6px] sm:w-[3.1px]" },
                      { num: 3, label: "G", thickness: "w-[2.0px] sm:w-[2.4px]" },
                      { num: 2, label: "H", thickness: "w-[1.4px] sm:w-[1.7px]" },
                      { num: 1, label: "E", thickness: "w-[0.9px] sm:w-[1.1px]" }
                    ];

                    return [...stringPositions].reverse().map((str) => {
                      const isDetected = hasSignal && closestString?.number === str.num;
                      
                      // Check if manual audio bummton is playing this string
                      const isBrummtonActive = playingStringNum === str.num;

                      const shouldVibrate = isDetected || isBrummtonActive;
                      
                      let stringColor = "bg-gradient-to-r from-zinc-500 via-zinc-400 to-zinc-600 shadow-[1px_0_1px_rgba(0,0,0,0.4)]";
                      if (shouldVibrate) {
                        stringColor = "bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-500 shadow-[0_0_10px_rgb(234,179,8),0_0_2px_white]";
                      }

                      return (
                        <div key={str.num} className="h-full flex flex-col items-center relative opacity-80">
                          {/* Label at top background */}
                          <div className={`absolute top-4 sm:top-5 font-mono text-[9px] font-bold ${isDetected ? "text-yellow-400 font-extrabold" : "text-white/10"}`}>
                            {str.label}
                          </div>

                          <div 
                            className={`h-full ${str.thickness} ${stringColor} transition-all duration-300 ${shouldVibrate ? "animate-string-vibrate" : ""}`} 
                          />
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Subdued content center: Detected Note displayed like a glowing wood burned stamp */}
                <div className="relative z-20 flex flex-col items-center justify-center text-center select-none pointer-events-none mix-blend-screen">
                  {hasSignal && closestString ? (
                    <div className="flex flex-col items-center">
                      <span className={`text-[85px] sm:text-[105px] md:text-[115px] font-black tracking-tighter leading-none select-none transition-all duration-300 ${
                        isInTune 
                          ? "text-green-400 drop-shadow-[0_0_25px_rgba(34,197,94,0.45)]" 
                          : "text-white/90 drop-shadow-[0_4px_10px_rgba(0,0,0,0.85)]"
                      }`}>
                        {closestString.note}
                        <span className="text-xl sm:text-2xl font-light text-white/40 align-super select-none ml-0.5">
                          {closestString.pitch.replace(closestString.note, "")}
                        </span>
                      </span>
                      <span className={`text-[9px] font-mono tracking-[0.25em] font-bold uppercase -mt-2 ${isInTune ? "text-green-400" : "text-yellow-500/80"}`}>
                        {isInTune ? "STIMMT PERFEKT!" : `${centsDiff > 0 ? "ZU STRAMM" : "ZU SCHLAFF"}`}
                      </span>
                    </div>
                  ) : playingStringNum !== null ? (
                    (() => {
                      const playingStr = STANDARD_GUITAR_STRINGS.find(s => s.number === playingStringNum);
                      return playingStr ? (
                        <div className="flex flex-col items-center justify-center">
                          <span className="text-[85px] sm:text-[105px] font-black tracking-tighter text-green-400/90 leading-none drop-shadow-[0_0_20px_rgba(34,197,94,0.35)]">
                            {playingStr.note}
                            <span className="text-xl font-light text-green-400/50 align-super ml-0.5">
                              {playingStr.pitch.replace(playingStr.note, "")}
                            </span>
                          </span>
                          <span className="text-[8px] font-mono tracking-widest text-green-400/70 uppercase font-bold -mt-2">
                            BRUMMTON REFERENZ
                          </span>
                        </div>
                      ) : null;
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4">
                      <span className="text-[30px] sm:text-[36px] font-black text-white/10 uppercase italic tracking-wider leading-none select-none">
                        ZUPFEN! 🎸
                      </span>
                      <span className="text-[8px] font-mono tracking-[0.2em] text-white/20 uppercase font-bold mt-1">
                        {isListening ? "HÖRE ZU..." : "STILL"}
                      </span>
                    </div>
                  )}
                </div>

                {/* SVG Overlay: Curved Calibration Grid & Swing Needle Pointer */}
                <svg viewBox="0 0 240 240" className="absolute inset-0 w-full h-full pointer-events-none z-30">
                  {/* Anchor/Pivot points cap near the lower quadrant */}
                  <circle cx="120" cy="180" r="13" className="fill-[#1A1513] stroke-amber-600/80 stroke-2" />
                  <circle cx="120" cy="180" r="5.5" className="fill-amber-500" />

                  {/* Tick Gauge Elements */}
                  {(() => {
                    const elements = [];
                    // From -50 to +50 cents, steps of 5 cents
                    for (let c = -50; c <= 50; c += 5) {
                      const tickAngle = c * 1.35; // maps from -67.5 to +67.5 deg
                      const angleRad = ((90 - tickAngle) * Math.PI) / 180;
                      
                      // Outer radius 122
                      const x1 = 120 + 122 * Math.cos(angleRad);
                      const y1 = 180 - 122 * Math.sin(angleRad);
                      
                      // Inner radius: Much longer ticks for high visibility
                      const isCenter = c === 0;
                      const isMajor = c % 10 === 0;
                      
                      // Center tick is 20px long, major is 15px, minor is 10px
                      const innerRadius = isCenter ? 102 : (isMajor ? 107 : 112);
                      const x2 = 120 + innerRadius * Math.cos(angleRad);
                      const y2 = 180 - innerRadius * Math.sin(angleRad);
                      
                      // Thickness & default opacities scaled up for much clearer presence (Griffs / Balken)
                      let strokeWidthClass = isCenter ? "stroke-[4px]" : (isMajor ? "stroke-[3px]" : "stroke-[2.2px]");
                      
                      // Color categorization - highly visible default colors
                      let tickColorClass = `stroke-red-500/50 ${strokeWidthClass}`;
                      if (isCenter) {
                        tickColorClass = `stroke-green-400 stroke-[4.5px] opacity-80`;
                      } else if (Math.abs(c) <= 3) {
                        tickColorClass = `stroke-green-400/70 ${strokeWidthClass}`;
                      } else if (Math.abs(c) <= 15) {
                        tickColorClass = `stroke-yellow-400/60 ${strokeWidthClass}`;
                      }
                      
                      // Highlight active tick if needle is close - super ultra thick glow
                      const isLit = hasSignal && Math.abs(clampedCents - c) <= 2.5;
                      if (isLit) {
                        if (Math.abs(c) <= 3) {
                          tickColorClass = "stroke-green-400 stroke-[5.5px] drop-shadow-[0_0_12px_#22c55e]";
                        } else if (Math.abs(c) <= 15) {
                          tickColorClass = "stroke-yellow-400 stroke-[5px] drop-shadow-[0_0_10px_#eab308]";
                        } else {
                          tickColorClass = "stroke-red-500 stroke-[5px] drop-shadow-[0_0_10px_#ef4444]";
                        }
                      }
                      
                      elements.push(
                        <line
                          key={c}
                          x1={x1}
                          y1={y1}
                          x2={x2}
                          y2={y2}
                          className={`transition-all duration-75 ease-out ${tickColorClass}`}
                        />
                      );
                    }
                    return elements;
                  })()}

                  {/* Glowing perfect target line in center */}
                  <line 
                    x1="120" 
                    y1="46" 
                    x2="120" 
                    y2="66" 
                    className={`transition-all duration-300 ${
                      hasSignal && isInTune 
                        ? "stroke-green-400 stroke-[5px] drop-shadow-[0_0_12px_#22c55e]" 
                        : "stroke-white/40 stroke-[2.5px]"
                    }`} 
                  />

                  {/* Sweep-Hand Needle Pointer */}
                  {(() => {
                    const needleAngle = hasSignal ? clampedCents * 1.35 : 0;
                    const angleRad = ((90 - needleAngle) * Math.PI) / 180;
                    const len = 112;
                    const targetX = 120 + len * Math.cos(angleRad);
                    const targetY = 180 - len * Math.sin(angleRad);

                    let needleColor = "stroke-amber-400";
                    let glowFilter = "drop-shadow(0 0 6px rgba(245,158,11,0.65))";
                    let beadColor = "#f59e0b";

                    if (hasSignal) {
                      if (isInTune) {
                        needleColor = "stroke-green-400";
                        glowFilter = "drop-shadow(0 0 15px #22c55e) drop-shadow(0 0 5px #22c55e)";
                        beadColor = "#22c55e";
                      } else if (Math.abs(centsDiff) <= 15) {
                        needleColor = "stroke-yellow-400";
                        glowFilter = "drop-shadow(0 0 12px #eab308) drop-shadow(0 0 4px #eab308)";
                        beadColor = "#eab308";
                      } else {
                        needleColor = "stroke-red-500";
                        glowFilter = "drop-shadow(0 0 12px #ef4444) drop-shadow(0 0 4px #ef4444)";
                        beadColor = "#ef4444";
                      }
                    } else {
                      // Quiet state: needle is much more clear/visible (opaque and styled with a crisp color)
                      needleColor = "stroke-white/35";
                      glowFilter = "drop-shadow(0 2px 4px rgba(0,0,0,0.5))";
                      beadColor = "rgba(255,255,255,0.45)";
                    }

                    return (
                      <g style={{ filter: glowFilter }} className="transition-all duration-150 ease-out">
                        {/* Needle line body - Upgraded to stroke-[6px] for bold presence */}
                        <line 
                          x1="120" 
                          y1="180" 
                          x2={targetX} 
                          y2={targetY} 
                          className="stroke-[6px] rounded-full transition-all duration-100 ease-out"
                          stroke={needleColor}
                          strokeLinecap="round"
                        />
                        
                        {/* Highlights core overlay for realistic gloss */}
                        <line 
                          x1="120" 
                          y1="180" 
                          x2={targetX} 
                          y2={targetY} 
                          className="stroke-[1.5px] opacity-80 transition-all duration-100 ease-out"
                          stroke="#ffffff"
                          strokeLinecap="round"
                        />

                        {/* Large glowing needle head bubble bead */}
                        <circle 
                          cx={targetX} 
                          cy={targetY} 
                          r="6.5" 
                          fill={beadColor} 
                          className="stroke-white/35 stroke-[1px] transition-all duration-150"
                        />
                      </g>
                    );
                  })()}
                </svg>

              </div>
            </div>

            {/* Subtitle feedback under the wooden gauge */}
            <div className="mt-6 flex gap-6 text-center text-xs font-mono select-none">
              <div>
                <span className="text-white/30 block text-[9px] uppercase tracking-wider mb-0.5 font-bold">Hz-Frequenz</span>
                <span className={`text-base font-bold tracking-wider transition-colors ${isInTune ? "text-green-400 shadow-sm" : "text-white/80"}`}>
                  {hasSignal ? `${frequency.toFixed(2)} Hz` : "---"}
                </span>
              </div>
              <div className="w-[1px] bg-white/10 self-stretch" />
              <div>
                <span className="text-white/30 block text-[9px] uppercase tracking-wider mb-0.5 font-bold">Stimm-Abweich</span>
                <span className={`text-base font-bold tracking-wider transition-colors ${isInTune ? "text-green-400" : Math.abs(centsDiff) <= 15 ? "text-yellow-400" : "text-red-400"}`}>
                  {hasSignal ? `${centsDiff > 0 ? "+" : ""}${centsDiff.toFixed(1)} Cent` : "---"}
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* ==================== THE TRADITIONAL HUGE NOTE INDICATOR CONTAINER ==================== */
          <div className="relative z-10 flex flex-col items-center justify-between text-center min-h-[300px] sm:min-h-[380px] md:min-h-[440px] w-full max-w-xl overflow-hidden animate-fade-in gap-5">
            <div className="flex-1 flex flex-col items-center justify-center w-full">
              {hasSignal && closestString ? (
                <div className="flex flex-col items-center justify-center w-full h-full">
                  {/* Massive Bold Character Wrapper with custom fixed heights to prevent jumps */}
                  <div className="h-[140px] sm:h-[190px] md:h-[240px] flex items-center justify-center relative w-full">
                    <div 
                      id="huge-note-indicator" 
                      className={`text-[120px] sm:text-[180px] md:text-[220px] leading-none font-black tracking-tighter transition-all duration-150 ${
                        isInTune 
                          ? "text-green-400 drop-shadow-[0_0_35px_rgba(34,197,94,0.25)]" 
                          : "text-white"
                      }`}
                    >
                      {closestString.note}
                      <span className="text-2xl sm:text-3xl md:text-4xl align-top font-light text-white/35 ml-1 inline-block">
                        {closestString.pitch.replace(closestString.note, "")}
                      </span>
                    </div>
                  </div>
                </div>
              ) : playingStringNum !== null ? (
                (() => {
                  const playingStr = STANDARD_GUITAR_STRINGS.find(s => s.number === playingStringNum);
                  return playingStr ? (
                    <div className="flex flex-col items-center justify-center w-full h-full">
                      {/* Massive Bold Character */}
                      <div className="h-[140px] sm:h-[190px] md:h-[240px] flex items-center justify-center relative w-full">
                        <div className="text-[120px] sm:text-[180px] md:text-[220px] leading-none font-black tracking-tighter text-green-400 drop-shadow-[0_0_35px_rgba(34,197,94,0.25)]">
                          {playingStr.note}
                          <span className="text-2xl sm:text-3xl md:text-4xl align-top font-light text-white/35 ml-1 inline-block">
                            {playingStr.pitch.replace(playingStr.note, "")}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null;
                })()
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-full animate-pulse-slow">
                  {/* Massive Standby Text Wrapper */}
                  <div className="h-[140px] sm:h-[190px] md:h-[240px] flex items-center justify-center relative w-full">
                    <div className="text-[42px] sm:text-[64px] md:text-[80px] leading-none font-black tracking-tight text-white/20 uppercase italic transition-all duration-300">
                      ZUPF MAL AN! 🎸
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Embedded Active Metric: Horizontal Tuning Bar */}
            {renderHorizontalTuningBar()}
          </div>
        )}
      </main>

      {/* Footer Interface Sector: Dial + Selector + Drawer Settings */}
      <section className="w-full max-w-3xl mx-auto px-6 sm:px-10 pb-8 sm:pb-12 relative z-10">
        
        {/* Swapped-in: HZ + CENTS DETAILS DASHBOARD CARD */}
        <div id="calibration-details-dashboard" className="bg-neutral-900/40 border border-white/5 rounded-2xl p-4 sm:p-5 flex justify-around items-center text-center font-mono select-none shadow-lg">
          <div className="flex-1 flex flex-col items-center">
            <span className="text-white/25 block text-[9px] uppercase tracking-[0.2em] mb-1.5 font-bold">HZ-FREQUENZ 📊</span>
            <span id="live-hertz-frequency" className={`text-base sm:text-lg font-bold tracking-widest uppercase transition-colors ${
              hasSignal && isInTune ? "text-green-500" : "text-white/80"
            }`}>
              {hasSignal 
                ? `${frequency.toFixed(2)} Hz` 
                : playingStringNum !== null 
                  ? `${STANDARD_GUITAR_STRINGS.find(s => s.number === playingStringNum)?.frequency.toFixed(2)} Hz` 
                  : "---"
              }
            </span>
          </div>

          <div className="w-[1px] bg-white/10 self-stretch my-1" />

          <div className="flex-1 flex flex-col items-center">
            <span className="text-white/25 block text-[9px] uppercase tracking-[0.2em] mb-1.5 font-bold">ABWEICHUNG 🎯</span>
            <span id="live-cents-deviation" className={`text-xs sm:text-sm font-sans font-extrabold tracking-wider transition-colors uppercase ${
              hasSignal 
                ? isInTune 
                  ? "text-green-400" 
                  : Math.abs(centsDiff) <= 15 
                    ? "text-yellow-400" 
                    : "text-red-400" 
                : "text-white/30"
            }`}>
              {hasSignal 
                ? centsDiff === 0 
                  ? "STIMMT PERFEKT! 🤘" 
                  : `${Math.abs(centsDiff).toFixed(1)} Cent ${centsDiff > 0 ? "zu stramm" : "zu schlaff"}`
                : playingStringNum !== null 
                  ? "REFERENZTON" 
                  : isListening 
                    ? "HÖRE ZU..." 
                    : "STUMM"
              }
            </span>
          </div>
        </div>

        {/* ==================== INTERACTIVE CHORD DISPLAY ==================== */}
        <div id="chord-display-container" className="mt-8 bg-neutral-900/40 border border-white/5 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row items-stretch gap-6 justify-between shadow-xl">
          <div className="flex-1 flex flex-col w-full justify-between">
            <div>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h4 className="text-xs uppercase tracking-[0.2em] text-white/40 font-bold flex items-center gap-1.5">
                    <Zap size={11} className="text-amber-500" />
                    <span>Akkord-Bibliothek 📖</span>
                  </h4>
                  <p className="text-[10px] text-white/20 mt-0.5 font-mono">
                    Wähle einen Akkord aus, um das Griffbild anzuzeigen und anzuschlagen
                  </p>
                </div>
                <button 
                  id="play-strum-chord"
                  onClick={() => playChord(selectedChord)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold tracking-wider uppercase transition-all shadow-md shadow-amber-900/30 cursor-pointer"
                >
                  <Volume2 size={11} />
                  <span>Anschlagen 🔊</span>
                </button>
              </div>

              {/* Categorization Tabs */}
              <div className="flex flex-wrap gap-1 bg-black/40 p-1 rounded-lg border border-white/5 mb-3">
                {[
                  { id: "all", label: "Alle" },
                  { id: "basis", label: "Grund" },
                  { id: "7th", label: "7er" },
                  { id: "barre", label: "Barré" },
                  { id: "sus", label: "Sus-Akkorde" },
                  { id: "dim", label: "Dim / Verm." },
                  { id: "pentatonic", label: "Pentatonik (Scale)" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setChordFilter(tab.id as any)}
                    className={`text-[10px] font-mono py-1 px-2.5 rounded transition-all select-none cursor-pointer ${
                      chordFilter === tab.id
                        ? "bg-white/10 text-amber-400 font-bold"
                        : "text-white/45 hover:text-white/80"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Grid of Chord Buttons */}
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 w-full">
                {filteredChords.map((chord) => {
                  const isCurrent = selectedChord.name === chord.name;
                  return (
                    <button
                      id={`chord-btn-${chord.name.toLowerCase().replace(" ", "-").replace("#", "sharp")}`}
                      key={chord.name}
                      onClick={() => {
                        setSelectedChord(chord);
                        playChord(chord); // Automatically strum on select for great UX
                      }}
                      className={`text-[11px] font-bold uppercase py-1.5 rounded-lg border transition-all text-center cursor-pointer select-none ${
                        isCurrent
                          ? "bg-amber-600/20 border-amber-500 text-amber-400 font-black shadow-inner shadow-amber-950/40"
                          : "border-white/5 bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {chord.name}
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="mt-4 flex flex-wrap gap-2 text-[10px] items-center text-white/35 font-mono">
              <span className="font-bold uppercase tracking-wider text-white/50">Details:</span>
              <span>{selectedChord.multiNotes ? "Tonleiter Töne (Saiten frets):" : "Saiten (von links nach rechts):"}</span>
              <span className="bg-white/5 px-2 py-0.5 rounded text-white/60 border border-white/10">
                {selectedChord.multiNotes ? (
                  selectedChord.multiNotes.map((m) => {
                    const stringLabels = ["E/6", "A/5", "D/4", "G/3", "H/2", "E/1"];
                    return `${stringLabels[m.stringIdx]}:${m.frets.join(",")}`;
                  }).join(" | ")
                ) : (
                  selectedChord.frets.map((f, i) => {
                    const stringLabels = ["E/6", "A/5", "D/4", "G/3", "H/2", "E/1"];
                    return `${stringLabels[i]}:${f}`;
                  }).join(" | ")
                )}
              </span>
            </div>
          </div>

          {/* SVG Fretboard Chord Diagram */}
          <div id="chord-fretboard-graphic" className="shrink-0 flex items-center justify-center p-2.5 bg-black/60 rounded-xl border border-white/10 shadow-inner w-[160px] h-[155px]">
            <svg viewBox="0 0 140 135" className="w-full h-full text-white/80 font-sans pointer-events-none">
              {/* String names above the frets */}
              {(() => {
                const notes = ["E2", "A2", "D3", "G3", "H3", "E4"];
                return notes.map((note, i) => (
                  <text
                    key={i}
                    x={20 + i * 20}
                    y={11}
                    textAnchor="middle"
                    className="font-mono text-[8.5px] fill-white/30 font-bold"
                  >
                    {note}
                  </text>
                ));
              })()}

              {/* Fretboard Grid Lines */}
              {/* Vertical Strings */}
              {Array.from({ length: 6 }).map((_, i) => (
                <line
                  key={`string-${i}`}
                  x1={20 + i * 20}
                  y1={25}
                  x2={20 + i * 20}
                  y2={125}
                  className="stroke-zinc-600"
                  strokeWidth="1.2"
                />
              ))}

              {/* Nut (Thickened Fret 0 line) or top single fret boundary */}
              {showNut ? (
                <line
                  x1={18}
                  y1={25}
                  x2={122}
                  y2={25}
                  className="stroke-amber-400"
                  strokeWidth="3.5"
                />
              ) : (
                <line
                  x1={20}
                  y1={25}
                  x2={120}
                  y2={25}
                  className="stroke-zinc-700"
                  strokeWidth="1.5"
                />
              )}

              {/* Horizontal Frets 1 to 5 */}
              {Array.from({ length: 5 }).map((_, i) => (
                <line
                  key={`fret-${i}`}
                  x1={20}
                  y1={25 + (i + 1) * 20}
                  x2={120}
                  y2={25 + (i + 1) * 20}
                  className="stroke-zinc-700"
                  strokeWidth="1"
                />
              ))}

              {/* Fret number labels on the left margin */}
              {Array.from({ length: 5 }).map((_, i) => (
                <text
                  key={`fret-label-${i}`}
                  x={8}
                  y={35 + i * 20}
                  textAnchor="middle"
                  className="font-mono text-[7.5px] fill-white/20 font-bold"
                >
                  {startFret + i}
                </text>
              ))}

              {/* Transparent background guide for Barré chord block (Fingers) */}
              {selectedChord.barre && (() => {
                const { fret, fromStringIdx, toStringIdx } = selectedChord.barre;
                const relativeFret = fret - startFret + 1;
                const yPos = 25 + (relativeFret - 0.5) * 20;
                const x1 = 20 + fromStringIdx * 20;
                const w = (toStringIdx - fromStringIdx) * 20;
                return (
                  <rect
                    key="barre-indicator"
                    x={x1 - 4}
                    y={yPos - 5}
                    width={w + 8}
                    height={10}
                    rx={5}
                    className="fill-amber-500/70 stroke-amber-400/40 stroke-1"
                  />
                );
              })()}

               {/* Open, Pressed or Muted Indicators */}
              {selectedChord.multiNotes ? (
                selectedChord.multiNotes.flatMap((mNotes) => {
                  const stringIdx = mNotes.stringIdx;
                  const xPos = 20 + stringIdx * 20;

                  return mNotes.frets.map((fret, noteIdx) => {
                    const relativeFret = fret - startFret + 1;
                    const yPos = 25 + (relativeFret - 0.5) * 20;
                    const fingeringNum = mNotes.fingerings?.[noteIdx] || null;

                    return (
                      <g key={`scale-${stringIdx}-${fret}`}>
                        <circle
                          cx={xPos}
                          cy={yPos}
                          r="6.5"
                          className="fill-amber-500 stroke-white/20 stroke-[1]"
                        />
                        {fingeringNum && (
                          <text
                            x={xPos}
                            y={yPos + 2.5}
                            textAnchor="middle"
                            className="font-sans text-[8px] font-black fill-black"
                          >
                            {fingeringNum}
                          </text>
                        )}
                      </g>
                    );
                  });
                })
              ) : (
                selectedChord.frets.map((fret, i) => {
                  const xPos = 20 + i * 20;

                  // Case 1: Muted string 'X'
                  if (fret === "X") {
                    return (
                      <g key={`muted-${i}`}>
                        <line x1={xPos - 3} y1={15} x2={xPos + 3} y2={21} className="stroke-red-500/80 stroke-2" />
                        <line x1={xPos + 3} y1={15} x2={xPos - 3} y2={21} className="stroke-red-500/80 stroke-2" />
                      </g>
                    );
                  }

                  // Case 2: Open string '0' (draw a small circle at the top)
                  if (fret === 0) {
                    return (
                      <circle
                        key={`open-${i}`}
                        cx={xPos}
                        cy={18}
                        r="3.5"
                        className="fill-none stroke-green-400 stroke-[1.5]"
                      />
                    );
                  }

                  // Case 3: Fingering/pressed fret (with starting fret calculation offsets)
                  const relativeFret = Number(fret) - startFret + 1;
                  const yPos = 25 + (relativeFret - 0.5) * 20;
                  const fingeringNum = selectedChord.fingering?.[i] || null;

                  // If is part of a barre chord and is on the barre fret, we can draw a ring highlights, or skip background as it already has rect
                  const isPartOfBarreFret = selectedChord.barre && 
                    fret === selectedChord.barre.fret && 
                    i >= selectedChord.barre.fromStringIdx && 
                    i <= selectedChord.barre.toStringIdx;

                  return (
                    <g key={`pressed-${i}`}>
                      {/* Circle backing (only needed if not drawn as a solid rectangle, or to give solid look for text overlay) */}
                      <circle
                        cx={xPos}
                        cy={yPos}
                        r="6.5"
                        className={`${isPartOfBarreFret ? "fill-amber-400 stroke-zinc-900 stroke-[1]" : "fill-amber-500 stroke-white/20 stroke-[1]"}`}
                      />
                      {fingeringNum && (
                        <text
                          x={xPos}
                          y={yPos + 2.5}
                          textAnchor="middle"
                          className="font-sans text-[8px] font-black fill-black"
                        >
                          {fingeringNum}
                        </text>
                      )}
                    </g>
                  );
                })
              )}
            </svg>
          </div>
        </div>

        {/* String Selector Rail */}
        <div id="string-tuner-dock" className="mt-8 grid grid-cols-6 gap-3 border-t border-white/10 pt-8">
          {[...STANDARD_GUITAR_STRINGS].reverse().map((str) => {
            const isActive = hasSignal && closestString?.number === str.number;
            const isLocked = targetStringLock === str.number;
            const isPlaying = playingStringNum === str.number;
            
            return (
              <button
                id={`string-selector-${str.number}`}
                key={str.number}
                onClick={() => {
                  if (targetStringLock === str.number) {
                    setTargetStringLock(null); // release
                    stopReferencePitch(); // stop playback
                  } else {
                    setTargetStringLock(str.number); // enforce lock Focus parameter
                    playReferencePitch(str.frequency, str.number); // synthesize play pitch sound
                  }
                }}
                className={`flex flex-col items-center gap-2 group transition-all duration-200 select-none pb-1 ${
                  isActive || isLocked || isPlaying
                    ? "text-white opacity-100" 
                    : "opacity-30 hover:opacity-75 grayscale"
                }`}
              >
                <div className="flex items-center gap-1 h-5 justify-center">
                  <span className="text-xs sm:text-sm font-black tracking-tight font-sans">
                    {str.pitch}
                  </span>
                  {isPlaying && (
                    <Volume2 size={11} className="text-green-400 animate-pulse shrink-0" />
                  )}
                </div>
                
                {/* Visual Accent representation string bar */}
                <div className={`w-full h-1.5 rounded-full transition-all duration-300 ${
                  isPlaying
                    ? "bg-green-400 shadow-[0_0_12px_#22c55e,0_0_4px_white] animate-pulse"
                    : isActive 
                      ? isInTune 
                        ? "bg-green-400 shadow-[0_0_10px_rgba(34,197,94,0.8)]" 
                        : "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]"
                      : isLocked 
                        ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" 
                        : "bg-white/10 group-hover:bg-white/20"
                }`} />

                {/* String number context underlay */}
                <span className="text-[9px] font-mono text-white/30 lowercase">
                  Saite {str.number}
                </span>
              </button>
            );
          })}
        </div>

        {/* Optional Release filter button when manual focus lock on a single string is enabled */}
        {targetStringLock !== null && (
          <div className="flex justify-center mt-4">
            <button
               id="clear-neck-filter"
               onClick={() => setTargetStringLock(null)}
               className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 border border-white/10 rounded-full text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <span>Saiten-Fokus für Saite {targetStringLock} wegschmeißen</span>
              <RefreshCw size={9} />
            </button>
          </div>
        )}

        {/* Compact Settings Panel: Response Speed Configurator */}
        <div className="mt-8 pt-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-left">
            <h5 className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">
              Nadel-Zappel-Bremse 🎛️
            </h5>
            <p className="text-[10px] text-white/20 mt-0.5 leading-relaxed font-mono">
              Wie nervös soll der Zeiger herumspringen?
            </p>
          </div>

          <div className="flex gap-2 bg-white/5 p-1 rounded border border-white/5">
            {SMOOTHING_PRESETS.map((preset) => (
              <button
                id={`preset-speed-${preset.name.toLowerCase()}`}
                key={preset.name}
                onClick={() => setSelectedPreset(preset)}
                className={`text-[10px] font-mono uppercase tracking-wider py-1 px-3 rounded transition-all ${
                  selectedPreset.name === preset.name
                    ? "bg-white text-black font-bold"
                    : "text-white/60 hover:text-white hover:bg-white/5"
                }`}
                title={preset.description}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

      </section>

      {/* Gorgeous Privacy and Device Permissions Overlay if loading or denied */}
      {permissionState !== "granted" && !bypassPermissionOverlay && (
        <div id="mic-fallback-overlay" className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-[#141414] border border-white/10 p-8 sm:p-12 rounded-3xl max-w-md text-center shadow-2xl relative">
            
            {/* Status indicator badge */}
            <div className="absolute top-4 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-950/20 border border-red-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[8px] font-mono text-red-400 uppercase tracking-widest">Verriegelt 🔒</span>
            </div>

            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-6 sm:mb-8 text-black shadow-lg">
              <Mic size={28} className="sm:size-36" />
            </div>

            <h2 className="text-2xl sm:text-3xl font-black mb-3 tracking-tight text-white italic uppercase">
              Lauscher anwerfen! 🎤
            </h2>
            
            <p className="text-white/60 text-xs sm:text-sm mb-6 sm:mb-8 leading-relaxed">
              Dieses hochmoderne Tuning-Monster rechnet deine Saiten-Frequenzen ganz diskret und blitzschnell direkt im Browser aus. Gib uns die Erlaubnis, sonst hören wir deinen fabelhaften Krach nicht!
            </p>

            {errorMsg ? (
              <p className="mb-6 p-3 bg-red-950/20 border border-red-500/20 rounded-lg text-red-300 text-xs text-left font-mono leading-relaxed">
                {errorMsg}
              </p>
            ) : null}

            <div className="flex flex-col gap-3">
              <button 
                id="grant-mic-permission-action"
                onClick={startTuningEngine}
                className="w-full py-3.5 bg-white text-black font-bold text-xs sm:text-sm tracking-widest uppercase rounded-full hover:bg-gray-100 active:scale-[0.98] transition-all cursor-pointer shadow-md"
              >
                Lauscher anknipsen! 🔥
              </button>

              <button 
                id="bypass-mic-permission-action"
                onClick={() => setBypassPermissionOverlay(true)}
                className="w-full py-3 bg-white/5 text-white/80 font-bold text-xs tracking-widest uppercase rounded-full border border-white/15 hover:bg-white/10 active:scale-[0.98] transition-all cursor-pointer shadow-sm"
              >
                Manueller Modus & Akkorde 🎸
              </button>
            </div>

            <div className="mt-5 text-[9px] uppercase tracking-widest text-[#F5F5F5]/30 font-mono">
              Datenschutz ist Ehrensache • Kein Spionage-Server lauscht mit
            </div>
          </div>
        </div>
      )}

      {/* Elegantly Polished Custom Screensaver Overlay (99s Inactivity) */}
      {isDimmed && (
        <div 
          id="app-screensaver-overlay" 
          onClick={resetInactivityTimer}
          onTouchStart={resetInactivityTimer}
          className="fixed inset-0 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center z-[100] cursor-pointer animate-fade-in select-none"
        >
          <div className="text-center p-6 max-w-sm flex flex-col items-center">
            {/* Pulsating Ambient Tuner Icon */}
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-full flex items-center justify-center mb-6 animate-pulse text-amber-400">
              <Zap size={28} />
            </div>
            
            <h2 className="text-xl font-bold text-white mb-2 tracking-tight uppercase italic">
              Bildschirmschoner aktiv 💤
            </h2>
            <p className="text-white/40 text-xs mb-8 leading-relaxed font-mono">
              (Inaktivität von 99 Sekunden überschritten)
            </p>
            
            <span className="px-5 py-2.5 bg-amber-500 text-black font-extrabold uppercase text-xs tracking-widest rounded-full shadow-lg shadow-amber-950/40 hover:bg-amber-400 transition-all">
              Tippen zum Fortfahren 🎸
            </span>
          </div>
        </div>
      )}

    </div>
  );
}
