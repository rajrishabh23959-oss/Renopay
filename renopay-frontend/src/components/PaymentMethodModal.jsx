import { useState, useRef, useEffect, useMemo } from "react";
import { fmt } from "../lib/format";
import { Btn } from "./ui";
import { useFocusTrap } from "../hooks/useFocusTrap";

import note500Img from "../assets/currency/note_500.webp";
import note200Img from "../assets/currency/note_200.webp";
import note100Img from "../assets/currency/note_100.webp";
import note50Img from "../assets/currency/note_50.webp";
import note20Img from "../assets/currency/note_20.webp";
import note10Img from "../assets/currency/note_10.webp";
import coin5Img from "../assets/currency/coin_5.webp";
import coin2Img from "../assets/currency/coin_2.webp";
import coin1Img from "../assets/currency/coin_1.webp";

const DENOM_IMAGES = {
  500: note500Img,
  200: note200Img,
  100: note100Img,
  50: note50Img,
  20: note20Img,
  10: note10Img,
  5: coin5Img,
  2: coin2Img,
  1: coin1Img,
};

function calculateDenominations(amount) {
  let rem = Math.round(Number(amount) || 0);
  const denoms = [500, 200, 100, 50, 20, 10, 5, 2, 1];
  const breakdown = [];
  for (const d of denoms) {
    if (rem >= d) {
      const count = Math.floor(rem / d);
      rem %= d;
      breakdown.push({ value: d, count, img: DENOM_IMAGES[d] });
    }
  }
  return breakdown;
}

export function PaymentMethodModal({
  isOpen,
  onClose,
  title = "Confirm Payment",
  subtitle,
  amount = 0,
  recipient,
  accountBalance = 0,
  onAddMoney,
  onConfirm,
  loading = false,
  error = "",
}) {
  const [payMode, setPayMode] = useState("normal"); // "normal" | "advance"
  const [pin, setPin] = useState("");
  const [slideProgress, setSlideProgress] = useState(0); // 0 to 100
  const [isSliding, setIsSliding] = useState(false);
  const [isSlideComplete, setIsSlideComplete] = useState(false);
  const sliderTrackRef = useRef(null);
  const modalRef = useFocusTrap(isOpen, onClose);

  const numAmount = Number(amount) || 0;
  const hasInsufficientBalance = accountBalance < numAmount;
  const breakdowns = useMemo(() => calculateDenominations(numAmount), [numAmount]);

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setPin("");
      setSlideProgress(0);
      setIsSlideComplete(false);
      setPayMode("normal");
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const updateSlideFromClientX = (clientX) => {
    if (!sliderTrackRef.current) return;
    const rect = sliderTrackRef.current.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const progress = Math.min(100, Math.max(0, (offsetX / rect.width) * 100));
    setSlideProgress(progress);

    if (progress >= 85 && !isSlideComplete) {
      setIsSlideComplete(true);
      setSlideProgress(100);
      try {
        navigator.vibrate?.([40, 60, 40]);
      } catch {}
    }
  };

  const handlePointerDown = (e) => {
    if (isSlideComplete || loading) return;
    setIsSliding(true);
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
    updateSlideFromClientX(clientX);
  };

  useEffect(() => {
    const handlePointerMove = (e) => {
      if (!isSliding) return;
      const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
      updateSlideFromClientX(clientX);
    };
    const handlePointerUp = () => {
      if (!isSliding) return;
      setIsSliding(false);
      if (slideProgress < 85) {
        setSlideProgress(0);
        setIsSlideComplete(false);
      }
    };

    if (isSliding) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("touchmove", handlePointerMove, { passive: false });
      window.addEventListener("touchend", handlePointerUp);
    }
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("touchmove", handlePointerMove);
      window.removeEventListener("touchend", handlePointerUp);
    };
  }, [isSliding, slideProgress]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (hasInsufficientBalance || loading) return;
    if (pin.length !== 6) return;
    if (payMode === "advance" && !isSlideComplete) return;
    onConfirm(pin, payMode);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-sm bg-card border border-line rounded-3xl p-4 sm:p-5 shadow-2xl relative my-auto max-h-[92vh] overflow-y-auto scrollbar-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3 pb-2 border-b border-line">
          <div className="min-w-0 pr-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-accent">RenoPay Checkout</span>
            <h3 id="checkout-modal-title" className="text-base font-extrabold text-textLight leading-snug truncate">{title}</h3>
            {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="w-7 h-7 rounded-full bg-surf flex items-center justify-center text-muted hover:text-white cursor-pointer text-xs shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Amount Summary */}
        <div className="bg-surf/80 rounded-2xl p-3 border border-line mb-3 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <p className="text-[10px] uppercase font-bold text-muted">Amount Payable</p>
            {recipient && <p className="text-xs font-semibold text-textLight truncate">{recipient}</p>}
          </div>
          <div className="text-right shrink-0">
            <span className="text-xl font-mono font-extrabold text-accent">{fmt(numAmount)}</span>
          </div>
        </div>

        {/* Balance Warning if insufficient */}
        {hasInsufficientBalance ? (
          <div className="p-3 rounded-2xl bg-danger/10 border border-danger/30 text-danger text-xs font-semibold mb-3">
            <div className="flex items-center gap-1.5 mb-1 font-bold">
              <span>⚠️</span>
              <span>Insufficient Balance</span>
            </div>
            <p className="text-[11px] text-muted">
              RenoPay Balance: <strong className="text-textLight font-mono">{fmt(accountBalance)}</strong>. Required: <strong className="text-accent font-mono">{fmt(numAmount)}</strong>.
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onAddMoney?.();
              }}
              className="mt-2.5 w-full py-2 px-3 rounded-xl bg-accent text-white font-bold text-xs flex items-center justify-center gap-1 shadow-sm hover:brightness-110 active:scale-95 cursor-pointer"
            >
              + Add Money to Account →
            </button>
          </div>
        ) : (
          <>
            {/* Mode Selection: Normal Pay vs Advance Pay */}
            <div className="mb-3">
              <label className="text-[10px] uppercase font-bold text-muted block mb-1.5">Select Payment Mode</label>
              <div className="grid grid-cols-2 gap-1.5 bg-surf/90 p-1 rounded-2xl border border-line">
                <button
                  type="button"
                  onClick={() => setPayMode("normal")}
                  className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    payMode === "normal"
                      ? "bg-accent text-white shadow-accentGlow"
                      : "text-muted hover:text-textLight"
                  }`}
                >
                  <span>⚡</span>
                  <span>Normal Pay</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode("advance")}
                  className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    payMode === "advance"
                      ? "bg-accent text-white shadow-accentGlow"
                      : "text-muted hover:text-textLight"
                  }`}
                >
                  <span>🚀</span>
                  <span>Advance Pay</span>
                </button>
              </div>
              <p className="text-[10px] text-muted mt-1 text-center">
                {payMode === "normal"
                  ? "⚡ Direct 6-digit UPI PIN verification"
                  : "🚀 Slide note across to authenticate + UPI PIN"}
              </p>
            </div>

            {/* Advance Pay Note Slider Experience */}
            {payMode === "advance" && (
              <div className="bg-surf/70 rounded-2xl p-3 border border-line mb-3 animate-fade-in">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-muted">Currency Denomination Stack</span>
                  <span className="text-[10px] font-mono text-accent font-bold">Total: {fmt(numAmount)}</span>
                </div>

                {/* Stack of realistic notes/coins */}
                <div className="flex gap-2 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none">
                  {breakdowns.map((b) => (
                    <div
                      key={b.value}
                      className="shrink-0 flex flex-col items-center bg-card border border-line rounded-xl p-1.5 relative shadow-sm"
                      style={{ minWidth: b.value >= 10 ? 68 : 48 }}
                    >
                      <img
                        src={b.img}
                        alt={`₹${b.value}`}
                        className="h-8 object-contain drop-shadow"
                      />
                      <span className="text-[9px] font-mono font-bold text-textLight mt-1">
                        {b.count}x ₹{b.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Interactive Slider Track */}
                <div className="mt-2.5">
                  <div className="flex justify-between items-center text-[10px] mb-1 font-bold">
                    <span className="text-muted">Slide to Verify Cash Note:</span>
                    <span className={isSlideComplete ? "text-emerald-400 font-extrabold" : "text-accent"}>
                      {isSlideComplete ? "✓ Verified & Ready" : `${Math.round(slideProgress)}%`}
                    </span>
                  </div>

                  <div
                    ref={sliderTrackRef}
                    onPointerDown={handlePointerDown}
                    style={{ touchAction: "none" }}
                    className={`relative h-11 rounded-2xl border transition-all select-none flex items-center px-1 cursor-grab active:cursor-grabbing ${
                      isSlideComplete
                        ? "bg-emerald-500/20 border-emerald-500/50"
                        : "bg-bg/90 border-accent/40 hover:border-accent"
                    }`}
                  >
                    {/* Progress fill */}
                    <div
                      className="absolute inset-y-0 left-0 rounded-2xl bg-gradient-to-r from-accent/20 to-accent/40 transition-[width] duration-75 pointer-events-none"
                      style={{ width: `${slideProgress}%` }}
                    />

                    {/* Draggable Note Thumb */}
                    <div
                      className={`relative z-10 w-9 h-9 rounded-xl flex items-center justify-center shadow-lg border text-base transition-transform duration-75 select-none ${
                        isSlideComplete
                          ? "bg-emerald-500 border-emerald-300 text-white"
                          : "bg-card border-accent text-accent"
                      }`}
                      style={{
                        transform: `translateX(${(slideProgress / 100) * (sliderTrackRef.current ? Math.max(0, sliderTrackRef.current.clientWidth - 44) : 180)}px)`,
                      }}
                    >
                      {isSlideComplete ? "✓" : "💵"}
                    </div>

                    {/* Hint text */}
                    {!isSlideComplete && (
                      <span className="absolute right-3 text-[10px] font-bold text-muted pointer-events-none">
                        Slide right ➔
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* UPI PIN Input */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1 text-center">
                  Enter 6-Digit UPI PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={pin}
                  autoFocus
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="w-full bg-bg border border-accent/40 rounded-2xl px-3 py-2.5 text-center text-xl tracking-[10px] font-mono text-textLight font-bold outline-none focus:border-accent shadow-inner transition-colors"
                />
              </div>

              {error && (
                <p className="text-danger text-xs font-semibold bg-danger/10 border border-danger/30 p-2 rounded-xl text-center">
                  {error}
                </p>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Btn
                  variant="dark"
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 py-3 text-xs font-bold"
                >
                  Cancel
                </Btn>
                <Btn
                  variant="primary"
                  type="submit"
                  disabled={loading || pin.length !== 6 || (payMode === "advance" && !isSlideComplete)}
                  className="flex-1 py-3 font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-accentGlow"
                >
                  {loading ? (
                    "Processing..."
                  ) : payMode === "advance" && !isSlideComplete ? (
                    "Slide Note to Pay"
                  ) : (
                    `Pay ${fmt(numAmount)}`
                  )}
                </Btn>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted pt-0.5">
                <span>🔒</span>
                <span>Protected by RenoPay SentinAI & NPCI 256-bit</span>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
