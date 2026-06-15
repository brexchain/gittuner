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

  // Request microphone on component mount automatically (user request)
  useEffect(() => {
    startTuningEngine();
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
  const startTuningEngine = async () => {
    // Reset state first
    setErrorMsg("");
    stopTuningEngine();

    try {
      // 1. Get user media stream
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
      console.error("Microphone access denied or audio issue", err);
      setPermissionState("denied");
      setErrorMsg("Lausch-Erlaubnis verweigert! Bitte gib uns das Mikrofon im Browser frei, sonst können wir deine Saiten-Vibrationen nicht erschnüffeln.");
    }
  };

  const { frequency, closestString, centsDiff, hasSignal } = tuningData;
  const isInTune = hasSignal && Math.abs(centsDiff) <= 3; // Absolute master precision: within 3 cents

  // Normalized translation offset for standard needle UI (-50 cents to +50 cents mapping to 0% to 100%)
  const clampedCents = Math.max(-50, Math.min(50, centsDiff));
  const needlePercentage = ((clampedCents + 50) / 100) * 100;

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#F5F5F5] flex flex-col justify-between font-sans transition-colors duration-300 relative overflow-hidden select-none">
      
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

      {/* Main Pitch display Canvas */}
      <main className="flex-1 flex flex-col items-center justify-center relative px-4 py-8 sm:py-16">
        
        {/* Centered Pitch Indicator Line (Static Backdrop Overlay) */}
        <div className="absolute inset-x-0 inset-y-0 pointer-events-none flex justify-center z-0">
          <div className="h-full w-[1.5px] bg-white/10 relative">
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all duration-500 ${
              hasSignal && isInTune 
                ? "bg-green-400 shadow-[0_0_25px_#22c55e,0_0_10px_#22c55e]" 
                : "bg-white/40 shadow-[0_0_15px_rgba(255,255,255,0.2)]"
            }`} />
          </div>
        </div>

        {/* Huge Note Indicator Container */}
        <div className="relative z-10 flex flex-col items-center justify-center text-center h-[240px] sm:h-[330px] md:h-[385px] w-full overflow-hidden">
          {hasSignal && closestString ? (
            <div className="flex flex-col items-center justify-center w-full h-full">
              {/* Massive Bold Character Wrapper with custom fixed heights to prevent jumps */}
              <div className="h-[140px] sm:h-[210px] md:h-[260px] flex items-center justify-center relative w-full">
                <div 
                  id="huge-note-indicator" 
                  className={`text-[150px] sm:text-[230px] md:text-[280px] leading-none font-black tracking-tighter transition-all duration-150 ${
                    isInTune 
                      ? "text-green-400 drop-shadow-[0_0_35px_rgba(34,197,94,0.25)]" 
                      : "text-white"
                  }`}
                >
                  {closestString.note}
                  <span className="text-3xl sm:text-4xl md:text-5xl align-top font-light text-white/35 ml-1 inline-block">
                    {closestString.pitch.replace(closestString.note, "")}
                  </span>
                </div>
              </div>

              {/* Stabilized frequency display in centered row */}
              <div className="h-[28px] flex items-center justify-center w-full mt-2 sm:mt-4">
                <div id="live-hertz-frequency" className={`text-lg sm:text-xl font-mono tracking-widest font-bold uppercase transition-colors ${
                  isInTune ? "text-green-500" : "text-white/60"
                }`}>
                  {frequency.toFixed(2)} HZ
                </div>
              </div>

              {/* Realtime cents offset display feedback in centered row */}
              <div className="h-[32px] flex items-center justify-center w-full mt-2 sm:mt-3">
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40 font-bold">
                  {centsDiff === 0 
                    ? "PASST PERFEKT! ROCK ON! 🤘" 
                    : `${Math.abs(centsDiff).toFixed(1)} CENT ${centsDiff > 0 ? "ZU STRAMM (LOCKERN!) 🥵" : "ZU SCHLAFF (SPANNEN!) 🥶"}`
                  }
                </div>
              </div>
            </div>
          ) : playingStringNum !== null ? (
            (() => {
              const playingStr = STANDARD_GUITAR_STRINGS.find(s => s.number === playingStringNum);
              return playingStr ? (
                <div className="flex flex-col items-center justify-center w-full h-full">
                  {/* Status indicator active badge row */}
                  <div className="h-[24px] flex items-center justify-center w-full mb-2 sm:mb-4">
                    <div className="px-2.5 py-1 rounded bg-white/5 border border-white/10 font-mono text-[10px] text-green-400 tracking-wider uppercase flex items-center gap-1.5 animate-pulse">
                      <Volume2 size={11} />
                      <span>Acoustischer Brummton Aktiv 📢</span>
                    </div>
                  </div>

                  {/* Massive Bold Character */}
                  <div className="h-[140px] sm:h-[210px] md:h-[260px] flex items-center justify-center relative w-full">
                    <div className="text-[150px] sm:text-[230px] md:text-[280px] leading-none font-black tracking-tighter text-green-400 drop-shadow-[0_0_35px_rgba(34,197,94,0.25)]">
                      {playingStr.note}
                      <span className="text-3xl sm:text-4xl md:text-5xl align-top font-light text-white/35 ml-1 inline-block">
                        {playingStr.pitch.replace(playingStr.note, "")}
                      </span>
                    </div>
                  </div>

                  {/* Frequency display row */}
                  <div className="h-[28px] flex items-center justify-center w-full mt-2 sm:mt-4">
                    <div className="-mt-1 sm:-mt-3 text-lg sm:text-xl font-mono tracking-widest font-bold uppercase text-green-500">
                      {playingStr.frequency.toFixed(2)} HZ
                    </div>
                  </div>

                  {/* Description subtitle row */}
                  <div className="h-[32px] flex items-center justify-center w-full mt-2 sm:mt-3">
                    <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40 font-bold">
                      KÜNSTLICHER BRUMMTON-REFERENZWERT
                    </div>
                  </div>
                </div>
              ) : null;
            })()
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full">
              {/* Spacing empty block to match State 2 header */}
              <div className="h-[24px] w-full mb-2 sm:mb-4" />

              {/* Massive Standby Text Wrapper */}
              <div className="h-[140px] sm:h-[210px] md:h-[260px] flex items-center justify-center relative w-full">
                <div className="text-[55px] sm:text-[85px] md:text-[100px] leading-none font-black tracking-tight text-white/20 uppercase italic transition-all duration-300">
                  ZUPF MAL AN! 🎸
                </div>
              </div>

              {/* Status Subtitle Wrapper */}
              <div className="h-[28px] flex items-center justify-center w-full mt-2 sm:mt-4">
                <div className="text-xs sm:text-sm font-mono tracking-[0.25em] text-white/30 uppercase font-semibold">
                  {isListening ? "Warte auf heftige Saiten-Vibrations..." : "Stimmgerät pennt grad"}
                </div>
              </div>

              {/* Bottom empty spacing block to align vertical height exactly */}
              <div className="h-[32px] w-full mt-2 sm:mt-3" />
            </div>
          )}
        </div>
      </main>

      {/* Footer Interface Sector: Dial + Selector + Drawer Settings */}
      <section className="w-full max-w-3xl mx-auto px-6 sm:px-10 pb-8 sm:pb-12 relative z-10">
        
        {/* Horizontal Tuning Bar (Pro-grade calibration meter) */}
        <div className="relative h-24 flex flex-col justify-end">
          {/* Scale Labels */}
          <div className="w-full flex justify-between text-[10px] font-mono text-white/40 tracking-tighter uppercase px-1 mb-2">
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
          <div className="w-full h-12 bg-[#0A0A0A] rounded-md flex items-center justify-between gap-[3px] px-2 border border-white/10 relative">
            {(() => {
              const totalTiles = 29;
              const activeIdx = hasSignal ? Math.round(((clampedCents + 50) / 100) * (totalTiles - 1)) : -1;

              // Calculate last strum afterglow index & opacity
              let lastStrumIdx = -1;
              let lastStrumOpacity = 0;
              let isLastStrumInTune = false;

              if (lastStrum) {
                const elapsed = Date.now() - lastStrum.timestamp;
                // Perfect decay: remain bright for 1 second, then fade out linearly over 3 seconds
                lastStrumOpacity = Math.max(0, Math.min(1, 1 - (elapsed - 1000) / 3000));
                
                if (lastStrumOpacity > 0) {
                  const lastClampedCents = Math.max(-50, Math.min(50, lastStrum.cents));
                  lastStrumIdx = Math.round(((lastClampedCents + 50) / 100) * (totalTiles - 1));
                  isLastStrumInTune = Math.abs(lastStrum.cents) <= 3;
                }
              }

              return Array.from({ length: totalTiles }).map((_, i) => {
                const isActive = hasSignal && activeIdx === i;
                const distance = hasSignal ? Math.abs(i - activeIdx) : -1;
                const isNear = distance === 1;

                // Is this tile illuminated by the last-strum afterglow ghost effect?
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
                  heightClass = "h-[90%]"; // extend active column
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
                  // Elegant glowing afterglow shadow representation
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
              });
            })()}
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
      {permissionState !== "granted" && (
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

            <button 
              id="grant-mic-permission-action"
              onClick={startTuningEngine}
              className="w-full py-3.5 sm:py-4 bg-white text-black font-bold text-xs sm:text-sm tracking-widest uppercase rounded-full hover:bg-gray-100 active:scale-[0.98] transition-all cursor-pointer shadow-md"
            >
              Lauscher anknipsen! 🔥
            </button>

            <div className="mt-5 text-[9px] uppercase tracking-widest text-[#F5F5F5]/30 font-mono">
              Datenschutz ist Ehrensache • Kein Spionage-Server lauscht mit
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
