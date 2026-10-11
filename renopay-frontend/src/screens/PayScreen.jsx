import { useState, useEffect, useRef } from "react";
import jsQR from "jsqr";
import { PaymentAPI, AnalyticsAPI } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getDeviceFingerprint } from "../lib/format";
import { Btn, Badge, Card } from "../components/ui";
import { PINPad } from "../components/PINPad";
import { NoteSlider } from "../components/NoteSlider";
import { fmt } from "../lib/format";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { parseUniversalUpiQr } from "./ScanScreen";
import { downloadOrSharePdf } from "../lib/download";
import { scanVideoFrame, decodeQrFromImage } from "../lib/qrScanner";
import { PoweredByUpiBadge } from "../components/UpiBrandBadges";
import { playUpiSonic } from "../lib/upiSonic";

const CATS = [
  { id: "Food", icon: "🍔" }, { id: "Shopping", icon: "🛍️" }, { id: "Transport", icon: "🚗" },
  { id: "Entertainment", icon: "🎬" }, { id: "Bills", icon: "💡" }, { id: "Health", icon: "💊" },
  { id: "Education", icon: "📚" }, { id: "Other", icon: "📦" },
];

export function PayScreen({ onBack, onNavigate, prefillVpa, prefillAmount, prefillNote, prefillName, prefillCategory, prefillApp }) {
  let refreshProfile = null;
  try {
    const auth = useAuth();
    refreshProfile = auth?.refreshProfile;
  } catch {
    // optional / running in isolation test
  }

  const [step, setStep] = useState(prefillVpa ? "amount" : "vpa");
  const [vpa, setVpa] = useState(prefillVpa || "");
  const [resolvedName, setResolvedName] = useState(prefillName || "");
  const [payeeApp, setPayeeApp] = useState(prefillApp || "");
  const [amount, setAmount] = useState(prefillAmount ? String(prefillAmount) : "");
  const [desc, setDesc] = useState(prefillNote || "");
  const [category, setCategory] = useState(prefillCategory || "Other");
  const [useLite, setUseLite] = useState(false);
  const [payMode, setPayMode] = useState("classic");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [suggestedVpas, setSuggestedVpas] = useState([]);
  const [vpaError, setVpaError] = useState("");
  const [isSearchingVpa, setIsSearchingVpa] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState(false);
  const [receiptBlob, setReceiptBlob] = useState(null);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());


  useEffect(() => {
    if (prefillVpa) resolveVpa(prefillVpa, prefillName);
    if (prefillAmount) setAmount(String(prefillAmount));
    if (prefillNote) setDesc(prefillNote);
    if (prefillCategory) setCategory(prefillCategory);
    if (prefillApp) setPayeeApp(prefillApp);
    if (prefillName) setResolvedName(prefillName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillVpa, prefillAmount, prefillNote, prefillCategory, prefillApp, prefillName]);

  const resolveVpa = async (v, hintName = null) => {
    setErr("");
    try {
      const hint = hintName || prefillName;
      const r = hint ? await PaymentAPI.resolveVPA(v, hint) : await PaymentAPI.resolveVPA(v);
      setResolvedName(r?.name || hint || v);
      if (r?.app) setPayeeApp(r.app);
      setVpa(v);
      setStep("amount");
    } catch {
      setErr("Could not verify this UPI address");
    }
  };

  const handleResolveSubmit = (e) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setErr("You are offline. Reconnect to send payments.");
      return;
    }
    if (!vpa.includes("@")) { setErr("Enter valid VPA e.g. name@renopay"); return; }
    resolveVpa(vpa);
  };

  const proceedToAuth = () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setErr("You are offline. Reconnect to send payments.");
      return;
    }
    if (!Number(amount) || Number(amount) <= 0) { setErr("Amount must be > 0"); return; }
    setErr("");
    setIdempotencyKey(crypto.randomUUID()); // fresh key for this attempt
    setStep("pin");
  };

  const handleDownloadReceipt = async () => {
    if (!result?.txn_ref || downloadingReceipt) return;
    setDownloadingReceipt(true);
    setDownloadError("");
    try {
      const blob = await AnalyticsAPI.downloadReport({
        type: "transaction_receipt",
        txn_ref: result.txn_ref,
      });
      await downloadOrSharePdf(blob, `Receipt_${result.txn_ref}.pdf`);
    } catch (e) {
      setDownloadError("Failed to download PDF receipt. Please try again.");
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const handleViewReceipt = async () => {
    if (!result?.txn_ref || viewingReceipt) return;
    setViewingReceipt(true);
    setDownloadError("");
    setReceiptBlob(null);
    setReceiptModalOpen(true);
    try {
      const blob = await AnalyticsAPI.downloadReport({
        type: "transaction_receipt",
        txn_ref: result.txn_ref,
      });
      setReceiptBlob(blob);
    } catch (e) {
      setDownloadError("Failed to open PDF receipt. Please try again.");
      setReceiptModalOpen(false);
    } finally {
      setViewingReceipt(false);
    }
  };

  const executePay = async (pin) => {
    if (loading) return; // Prevent double-clicks
    setLoading(true); setErr("");
    try {
      const payload = {
        to_vpa: vpa, amount: Number(amount), description: desc || "UPI Transfer", pin,
        category, device_fingerprint: getDeviceFingerprint(), use_upi_lite: useLite && Number(amount) <= 500,
        idempotency_key: idempotencyKey,
        receiver_name: resolvedName,
      };
      const res = await PaymentAPI.sendMoney(payload);
      setResult({ success: true, ...res });
      setStep("result");
      playUpiSonic(1); // 1-second UPI Sonic confirmation chime
      if (refreshProfile) {
        try {
          await refreshProfile();
        } catch {
          // ignore background sync error
        }
      }
    } catch (e2) {
      if (!e2.response) {
        setResult({
          success: false,
          error: "Connection interrupted. If money was debited, your bank will update within a few minutes. Please check your transaction history before retrying.",
          isNetworkError: true,
        });
        setStep("result");
        return;
      }
      const detail = e2.response?.data?.detail;
      const code = detail?.code;
      if (code === "pin_not_set") {
        setResult({ success: false, error: "Set your UPI PIN in Profile to send money", isPinNotSet: true });
        setStep("result");
        return;
      }
      if (code === "invalid_pin" || code === "pin_locked") {
        // Wrong PIN: stay on the PIN screen and let them retry, rather
        // than burying the mistake behind a full failure screen.
        setErr(detail.message);
        return;
      }
      setResult({ success: false, error: detail?.message || detail || "Payment failed" });
      setStep("result");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-[140px]">
      <div className="pt-[50px] pb-[18px] px-[22px] flex items-center gap-3">
        <button className="btn bg-card border border-line text-textLight rounded-xl px-3.5 py-2.5 text-base" onClick={onBack}>←</button>
        <h2 className="text-[22px] font-extrabold text-textLight">Send Money</h2>
      </div>

      <div className="px-[22px]">
        {step === "vpa" && (
          <div className="animate-fadeUp">
            {/* Dedicated Manual UPI ID Form */}
            <form onSubmit={handleResolveSubmit}>
              <Card className="p-5 mb-4 border-accent/[.2] shadow-lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-lg">
                    👤
                  </div>
                  <div>
                    <p className="text-textLight text-sm font-bold">Pay to (UPI ID)</p>
                    <p className="text-muted text-[11px]">Enter UPI ID, RenoPay handle, or mobile number</p>
                  </div>
                </div>

                <input
                  placeholder="anyone@renopay"
                  value={vpa}
                  onChange={(e) => setVpa(e.target.value)}
                  autoFocus
                />
                {err && <p className="text-danger text-xs mt-2">{err}</p>}

                <div className="flex items-center gap-2 mt-3 text-xs text-muted flex-wrap">
                  <span className="font-semibold">Quick suggestion:</span>
                  <button
                    type="button"
                    className="text-accent hover:underline cursor-pointer bg-accent/10 px-2 py-0.5 rounded-md border border-accent/20"
                    onClick={() => { setVpa("rishabhraj@renopay"); resolveVpa("rishabhraj@renopay"); }}
                  >
                    rishabhraj@renopay
                  </button>
                  <button
                    type="button"
                    className="text-accent hover:underline cursor-pointer bg-accent/10 px-2 py-0.5 rounded-md border border-accent/20"
                    onClick={() => { setVpa("groceries@paytm"); resolveVpa("groceries@paytm", "City Supermarket"); }}
                  >
                    groceries@paytm
                  </button>
                </div>

                <button
                  type="submit"
                  className="w-full mt-5 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-accent to-[#e0560a] hover:from-accent/90 hover:to-[#e0560a]/90 active:scale-[0.98] text-white font-extrabold text-sm shadow-lg shadow-accent/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <span>Find & Pay →</span>
                </button>
              </Card>
            </form>

            {/* Shortcut to Scanner if user wants camera instead */}
            <div className="p-4 rounded-2xl border border-line bg-card/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📷</span>
                <div>
                  <p className="text-xs font-bold text-textLight">Have a QR Code?</p>
                  <p className="text-[11px] text-muted">Scan camera or upload QR image</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate ? onNavigate("scan", { mode: "camera" }) : onBack()}
                className="px-3.5 py-1.5 rounded-xl bg-accent/15 border border-accent/30 text-accent font-bold text-xs hover:bg-accent/25 transition-all cursor-pointer"
              >
                Open Scanner →
              </button>
            </div>
          </div>
        )}

        {step === "amount" && (
          <div className="animate-fadeUp">
            <Card className="p-4 mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-[13px] bg-accent/[.28] flex items-center justify-center text-xl glow-icon shrink-0">👤</div>
                <div className="min-w-0">
                  <p className="font-bold text-[15px] text-textLight truncate">{resolvedName}</p>
                  <p className="text-muted text-xs font-mono truncate">{vpa}</p>
                </div>
              </div>
              {payeeApp && (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-card border border-line text-textLight shrink-0">
                  {payeeApp}
                </span>
              )}
            </Card>

            {/* ── Payment Mode Toggle: Normal Pay vs Advance Pay ── */}
            <div className="grid grid-cols-2 gap-2 bg-surf/90 p-1.5 rounded-2xl border border-line mb-2">
              <button
                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  payMode === "classic"
                    ? "bg-accent text-white shadow-accentGlow"
                    : "text-muted hover:text-textLight"
                }`}
                onClick={() => setPayMode("classic")}
                type="button"
              >
                <span>⚡</span>
                <span>Normal Pay</span>
              </button>
              <button
                className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
                  payMode === "slider"
                    ? "bg-accent text-white shadow-accentGlow"
                    : "text-muted hover:text-textLight"
                }`}
                onClick={() => setPayMode("slider")}
                type="button"
              >
                <span>🚀</span>
                <span>Advance Pay</span>
              </button>
            </div>
            <p className="text-[10px] text-muted text-center mb-3">
              {payMode === "classic"
                ? "⚡ Normal Pay: Direct amount entry + 6-digit UPI PIN"
                : "🚀 Advance Pay: RenoPay's multi-sensory interactive note slider + UPI PIN"}
            </p>

            {payMode === "classic" ? (
              /* ── Classic Keypad Mode (original) ── */
              <Card className="p-6 mb-4 relative glow-hero">
                <p className="text-muted text-[11px] tracking-wide mb-3 relative z-10 uppercase">Amount</p>
                <div className="flex items-center gap-2.5 relative z-10">
                  <span className="text-[32px] text-accent font-mono">₹</span>
                  <input type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                         className="text-[36px] font-extrabold border-none border-b-2 border-accent rounded-none pl-0 bg-transparent font-mono" />
                </div>
                {Number(amount) > 0 && Number(amount) <= 500 && (
                  <div className="mt-5 pt-4 border-t border-line flex justify-between items-center relative z-10">
                    <div><p className="font-bold text-[13px] text-teal">Use UPI Lite ⚡</p><p className="text-muted text-[10px]">No PIN required</p></div>
                    <button className="btn w-11 h-6 rounded-full relative" style={{ background: useLite ? "#22C55E" : "#5C564F44" }} onClick={() => setUseLite(!useLite)}>
                      <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all" style={{ left: useLite ? 23 : 3 }} />
                    </button>
                  </div>
                )}
                <div className="mt-4 relative z-10">
                  <p className="text-muted text-[11px] tracking-wide mb-2 uppercase">Note</p>
                  <input placeholder="What's this for?" value={desc} onChange={(e) => setDesc(e.target.value)} className="mb-3" />
                  <p className="text-muted text-[11px] tracking-wide mb-2 uppercase font-semibold">Category</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CATS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`btn px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                          category === c.id
                            ? "bg-accent/15 border-accent text-accent shadow-sm"
                            : "bg-surf border-line text-text hover:text-textLight hover:bg-card"
                        }`}
                        onClick={() => setCategory(c.id)}
                      >
                        {c.icon} {c.id}
                      </button>
                    ))}
                  </div>
                </div>
              </Card>
            ) : (
              /* ── Note Slider Mode ── */
              <>
                <NoteSlider
                  onAmountChange={(v) => setAmount(String(v))}
                  recipientName={resolvedName}
                  recipientVpa={vpa}
                />
                <Card className="p-5 mb-4">
                  {Number(amount) > 0 && Number(amount) <= 500 && (
                    <div className="mb-4 pb-4 border-b border-line flex justify-between items-center">
                      <div><p className="font-bold text-[13px] text-teal">Use UPI Lite ⚡</p><p className="text-muted text-[10px]">No PIN required</p></div>
                      <button className="btn w-11 h-6 rounded-full relative" style={{ background: useLite ? "#22C55E" : "#5C564F44" }} onClick={() => setUseLite(!useLite)}>
                        <div className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all" style={{ left: useLite ? 23 : 3 }} />
                      </button>
                    </div>
                  )}
                  <p className="text-muted text-[11px] tracking-wide mb-2 uppercase font-semibold">Note</p>
                  <input placeholder="What's this for?" value={desc} onChange={(e) => setDesc(e.target.value)} className="mb-3" />
                  <p className="text-muted text-[11px] tracking-wide mb-2 uppercase font-semibold">Category</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CATS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`btn px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border ${
                          category === c.id
                            ? "bg-accent/15 border-accent text-accent shadow-sm"
                            : "bg-surf border-line text-text hover:text-textLight hover:bg-card"
                        }`}
                        onClick={() => setCategory(c.id)}
                      >
                        {c.icon} {c.id}
                      </button>
                    ))}
                  </div>
                </Card>
              </>
            )}

            {err && <p className="text-danger text-xs mb-3">{err}</p>}
            <Btn onClick={proceedToAuth}>Continue →</Btn>
            <div className="mt-2.5"><Btn variant="ghost" onClick={() => setStep("vpa")}>← Back</Btn></div>
          </div>
        )}

        {step === "pin" && (
          <div className="animate-fadeUp">
            <Card className="p-[18px] mb-5 text-center border-accent/[.27]">
              <p className="text-muted text-xs">Paying</p>
              <p className="font-mono text-[30px] font-bold text-accent">{fmt(Number(amount))}</p>
              <p className="text-muted text-xs mt-0.5">to {resolvedName} · {vpa}</p>
            </Card>
            {err && <p className="text-danger text-[13px] text-center mb-3">{err}</p>}
            <PINPad onComplete={executePay} label="Enter your UPI PIN" actionLabel="Pay" actionType="pay" />
            {loading && <p className="text-center text-muted text-xs mt-4">Processing...</p>}
          </div>
        )}

        {step === "result" && result && (
          <div className="animate-fadeUp text-center pt-5">
            <div
              className="w-[90px] h-[90px] rounded-full flex items-center justify-center text-4xl mx-auto mb-[18px] animate-heartbeat"
              style={{ background: result.success ? "#22C55E22" : "#ff3d6022", border: `2px solid ${result.success ? "#22C55E" : "#ff3d60"}` }}
            >
              {result.success ? "✓" : "✗"}
            </div>
            <h2 className="text-[26px] font-extrabold" style={{ color: result.success ? "#22C55E" : "#ff3d60" }}>
              {result.success ? "Payment Successful!" : "Payment Failed"}
            </h2>
            {result.success ? (
              <>
                <p className="text-muted mt-2">{fmt(result.amount)} sent to <strong className="text-textLight">{resolvedName}</strong></p>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent/10 border border-accent/20 mt-1.5">
                  <span className="text-[10px] uppercase font-bold text-muted">UPI ID:</span>
                  <span className="font-mono text-xs font-bold text-accent">{vpa}</span>
                </div>
                <p className="font-mono text-muted text-[11px] mt-1">TXN: {result.txn_ref}</p>
                {result.new_balance !== undefined && (
                  <p className="text-accent font-semibold text-sm mt-1.5">
                    Remaining Balance: {fmt(result.new_balance)}
                  </p>
                )}
                {result.round_up > 0 && <div className="mt-2"><Badge color="#FF6A1A">🪙 +{fmt(result.round_up)} rounded up to Digital Gold!</Badge></div>}

                <div className="mt-4 flex flex-col items-center gap-2">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleViewReceipt}
                      disabled={viewingReceipt || downloadingReceipt}
                      className="btn bg-card border border-accent/40 text-accent hover:bg-accent/10 px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      👁 {viewingReceipt ? "Loading..." : "View Receipt"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadReceipt}
                      disabled={downloadingReceipt || viewingReceipt}
                      className="btn bg-accent text-white shadow-accentGlow hover:brightness-110 px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      ⬇ {downloadingReceipt ? "Generating..." : "Download Receipt (PDF)"}
                    </button>
                  </div>
                  {downloadError && <p className="text-danger text-xs mt-1">{downloadError}</p>}
                </div>
              </>
            ) : <p className="text-muted mt-2">{result.error}</p>}
            <div className="mt-7 flex gap-2.5">
              <Btn variant="dark" onClick={onBack} className="flex-1">Home</Btn>
              {result.success && (
                <Btn variant="teal" className="flex-1" onClick={() => { setStep("vpa"); setVpa(""); setAmount(""); setResult(null); }}>
                  Pay Again
                </Btn>
              )}
              {result.isPinNotSet && (
                <Btn variant="teal" className="flex-1" onClick={() => onNavigate("profile")}>Go to Profile</Btn>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Receipt PDF Preview Modal */}
      <PdfPreviewModal
        isOpen={receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
        pdfBlob={receiptBlob}
        title="Payment Receipt"
        filename={`Receipt_${result?.txn_ref || "transaction"}.pdf`}
        loading={viewingReceipt}
      />

      {/* NPCI Mandated "Powered by UPI" Bottom Anchor */}
      <PoweredByUpiBadge isBottomAnchor={true} />
    </div>
  );
}
