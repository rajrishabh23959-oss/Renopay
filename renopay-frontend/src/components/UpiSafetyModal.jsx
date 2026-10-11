import React, { useState, useEffect } from "react";
import bhimLogo from "../assets/bhim-logo-transparent.png";
import { playUpiSonic } from "../lib/upiSonic";
import { useFocusTrap } from "../hooks/useFocusTrap";

/**
 * NPCI Mandated "Do's and Don'ts" Safety Warning Modal.
 * Fully compatible with Day Mode & Night Mode.
 * Features ONLY authentic BHIM logo.
 */
export function UpiSafetyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const modalRef = useFocusTrap(isOpen, () => handleAcknowledge());

  useEffect(() => {
    const acknowledged = localStorage.getItem("renopay_safety_acknowledged");
    if (!acknowledged) {
      setIsOpen(true);
    }
  }, []);

  const handleAcknowledge = () => {
    localStorage.setItem("renopay_safety_acknowledged", "true");
    setIsOpen(false);
    // Play 3-second celebratory onboarding sound chime
    playUpiSonic(3);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upi-safety-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md bg-card border border-line rounded-3xl p-6 shadow-2xl relative overflow-hidden animate-scaleUp"
      >
        {/* Top Glow Accent */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-accent via-teal to-accent" />

        {/* Header - ONLY BHIM LOGO */}
        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex items-center px-2.5 py-1 rounded-xl bg-white border border-line/60 shadow-xs select-none">
            <img src={bhimLogo} alt="BHIM - Bharat Interface for Money" className="h-5 w-auto object-contain" />
          </div>
          <span className="text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-full bg-accent/15 text-accent border border-accent/25">
            Security Advisory
          </span>
        </div>

        <div className="text-center mb-5">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center text-2xl mx-auto mb-2.5 shadow-inner">
            🛡️
          </div>
          <h3 className="text-xl font-extrabold text-textLight">UPI Safety Do's & Don'ts</h3>
          <p className="text-xs text-muted mt-1">Official guidelines by NPCI to keep your money safe</p>
        </div>

        {/* Do's Section */}
        <div className="mb-4 space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-teal flex items-center gap-1.5">
            <span>✅</span> ALWAYS DO (सुरक्षा नियम)
          </p>
          <div className="p-3.5 rounded-2xl bg-teal/10 border border-teal/25 space-y-2.5 text-xs text-textLight">
            <div className="flex items-start gap-2">
              <span className="text-teal font-extrabold shrink-0 text-sm">✔</span>
              <span className="leading-relaxed"><strong>Verify Payee Name:</strong> Always verify the recipient's name on screen before typing your PIN.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-teal font-extrabold shrink-0 text-sm">✔</span>
              <span className="leading-relaxed"><strong>Keep PIN Secret:</strong> Your 4 or 6 digit UPI PIN must never be disclosed to anyone, including bank staff.</span>
            </div>
          </div>
        </div>

        {/* Don'ts Section */}
        <div className="mb-6 space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-danger flex items-center gap-1.5">
            <span>🚫</span> NEVER DO (धोखाधड़ी से बचें)
          </p>
          <div className="p-3.5 rounded-2xl bg-danger/10 border border-danger/25 space-y-2.5 text-xs text-textLight">
            <div className="flex items-start gap-2">
              <span className="text-danger font-extrabold shrink-0 text-sm">✖</span>
              <span className="leading-relaxed"><strong>PIN to Receive Money:</strong> You NEVER need to enter your UPI PIN or scan a QR code to receive money!</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-danger font-extrabold shrink-0 text-sm">✖</span>
              <span className="leading-relaxed"><strong>Remote Screen Sharing:</strong> Never install unknown screen-sharing apps (AnyDesk, TeamViewer) on request.</span>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <button
          type="button"
          onClick={handleAcknowledge}
          className="w-full py-3.5 px-4 rounded-xl font-black text-sm bg-gradient-to-r from-accent to-[#D43D0A] text-white shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer hover:brightness-110"
        >
          <span>I Understand & Agree</span>
          <span>→</span>
        </button>

        <p className="text-center text-[10px] text-muted mt-3">
          Powered by RenoPay & National Payments Corporation of India (NPCI)
        </p>
      </div>
    </div>
  );
}
