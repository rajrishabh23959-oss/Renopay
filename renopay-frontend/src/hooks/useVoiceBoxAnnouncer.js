import { useEffect, useRef } from "react";
import { VoiceBoxAPI } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRenoSocket } from "./useRenoSocket";

// Dual-tone RenoPay soundbox chime generator
export function playSoundboxChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now); // D5
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880.00, now + 0.15); // A5
    gain2.gain.setValueAtTime(0.3, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.55);
  } catch (_) {}
}

// Global utterance reference to prevent Chromium garbage collection aborting speech mid-sentence
let activeUtteranceRef = null;

// Browser Text-To-Speech announcement
export function speakAnnouncement(text, langCode = "hi") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume?.();
    }
    playSoundboxChime();

    setTimeout(() => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        activeUtteranceRef = utterance;
        utterance.onend = () => { activeUtteranceRef = null; };
        utterance.onerror = () => { activeUtteranceRef = null; };
        utterance.rate = 0.95;
        utterance.pitch = 1.05;

        const langMap = {
          hi: "hi-IN",
          en: "en-IN",
          mr: "mr-IN",
          bn: "bn-IN",
          ta: "ta-IN",
          te: "te-IN",
          ml: "ml-IN",
          kn: "kn-IN",
          gu: "gu-IN",
          pa: "pa-IN",
          bho: "hi-IN",
          or: "or-IN",
        };
        utterance.lang = langMap[langCode] || "hi-IN";

        const voices = window.speechSynthesis.getVoices?.() || [];
        const match = voices.find((v) => v.lang.replace("_", "-").startsWith(utterance.lang.slice(0, 2)));
        if (match) utterance.voice = match;

        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("TTS speak failed:", err);
      }
    }, 350);
  } catch (err) {
    console.warn("VoiceBox announcement audio error:", err);
  }
}

// Global user gesture audio unlock
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    try {
      window.speechSynthesis?.resume?.();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const dummyCtx = new AudioCtx();
        if (dummyCtx.state === "suspended") dummyCtx.resume?.();
      }
    } catch (_) {}
  };
  ["pointerdown", "touchstart", "click", "keydown"].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });
}

export function useVoiceBoxAnnouncer(onAnnouncement = null) {
  const { profile } = useAuth();
  const announcedRefs = useRef(new Set());
  const isPollingRef = useRef(false);
  const isFirstPollRef = useRef(true);

  // Initialize announced transactions from session storage so repeat announcements don't occur on refresh
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("renopay_announced_txns");
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr)) {
          arr.forEach((id) => announcedRefs.current.add(id));
        }
      }
    } catch (_) {}
  }, []);

  const triggerAnnouncement = (ann) => {
    if (!ann || !ann.text) return;
    if (ann.txn_ref && announcedRefs.current.has(ann.txn_ref)) return;

    if (ann.txn_ref) {
      announcedRefs.current.add(ann.txn_ref);
      try {
        const arr = Array.from(announcedRefs.current).slice(-50);
        sessionStorage.setItem("renopay_announced_txns", JSON.stringify(arr));
      } catch (_) {}
    }

    speakAnnouncement(ann.text, ann.language || "hi");
    if (typeof onAnnouncement === "function") {
      onAnnouncement(ann);
    }
  };

  // 1. Instant WebSocket event listener (when WS is connected)
  useRenoSocket((evt) => {
    if (evt.type === "voicebox_announcement" && evt.data) {
      triggerAnnouncement(evt.data);
    }
  });

  // 2. Continuous Poll fallback (works 100% on Vercel Serverless & mobile browsers)
  useEffect(() => {
    if (!profile) return;

    let mounted = true;
    const poll = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        const res = await VoiceBoxAPI.pollAnnouncements();
        if (!mounted) return;
        if (res?.announcements && Array.isArray(res.announcements)) {
          // If first poll and no prior session history, prime the set with existing transactions older than 30s
          if (isFirstPollRef.current && announcedRefs.current.size === 0) {
            isFirstPollRef.current = false;
            const nowMs = Date.now();
            for (const ann of res.announcements) {
              const annTime = ann.created_at ? new Date(ann.created_at).getTime() : 0;
              // Only announce if transaction was created in the last 30 seconds
              if (nowMs - annTime > 30000) {
                if (ann.txn_ref) announcedRefs.current.add(ann.txn_ref);
              } else {
                triggerAnnouncement(ann);
              }
            }
          } else {
            isFirstPollRef.current = false;
            for (const ann of res.announcements) {
              triggerAnnouncement(ann);
            }
          }
        }
      } catch (_) {
        // Silent poll error
      } finally {
        isPollingRef.current = false;
      }
    };

    // Initial check after 2 seconds
    const initTimer = setTimeout(poll, 2000);
    // Poll every 3.5 seconds
    const interval = setInterval(poll, 3500);

    return () => {
      mounted = false;
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [profile]);
}
