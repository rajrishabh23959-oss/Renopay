import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { useAuth } from "../context/AuthContext";
import { GiftCardAPI } from "../lib/api";
import { fmt } from "../lib/format";
import { downloadOrSharePdf } from "../lib/download";
import { Card, Btn, Badge } from "../components/ui";
import { PaymentMethodModal } from "../components/PaymentMethodModal";
import { PdfPreviewModal } from "../components/PdfPreviewModal";

const PRESET_AMOUNTS = [100, 250, 500, 1000, 2000, 5000];

const GREETINGS = [
  "Best Wishes! 🌟",
  "Happy Birthday! 🎂",
  "Congratulations! 🎉",
  "Festival Greetings! 🪔",
  "Thank You! 🙏",
  "Just for You! 💖",
];

export function GiftCardScreen({ onBack, initialClaimCode = "", onScanQr }) {
  const { profile, refreshProfile } = useAuth();
  const [tab, setTab] = useState(initialClaimCode ? "claim" : "create"); // "create" | "claim" | "history"

  // Creation State
  const [amount, setAmount] = useState("500");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("Best Wishes! 🌟");
  const [showPayModal, setShowPayModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdCard, setCreatedCard] = useState(null);

  // Claim State
  const [claimCode, setClaimCode] = useState(initialClaimCode || "");
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [claimError, setClaimError] = useState("");

  // History State
  const [myCards, setMyCards] = useState({ created: [], claimed: [] });
  const [historyFilter, setHistoryFilter] = useState("created");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // PDF Preview State
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [pdfTitle, setPdfTitle] = useState("Gift Card Voucher");
  const [pdfFilename, setPdfFilename] = useState("RenoPay_GiftCard.pdf");
  const [pdfLoading, setPdfLoading] = useState(false);

  // Copy Feedback
  const [copiedCode, setCopiedCode] = useState(false);

  // Dynamic QR Code Data URL
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    if (createdCard?.card_code) {
      const origin =
        typeof window !== "undefined" && window.location.origin
          ? window.location.origin
          : "https://renopay-u72j.vercel.app";
      const claimUrl = `${origin}/?claimCode=${createdCard.card_code}`;
      QRCode.toDataURL(claimUrl, {
        width: 180,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      })
        .then(setQrDataUrl)
        .catch(() => {});
    } else {
      setQrDataUrl("");
    }
  }, [createdCard]);

  useEffect(() => {
    if (initialClaimCode) {
      setTab("claim");
      setClaimCode(initialClaimCode);
    }
  }, [initialClaimCode]);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await GiftCardAPI.myCards();
      setMyCards(data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") {
      fetchHistory();
    }
  }, [tab, fetchHistory]);

  const handleOpenPayModal = (e) => {
    e?.preventDefault();
    const num = Number(amount);
    if (!num || num <= 0) {
      setCreateError("Please enter a valid amount greater than ₹0.");
      return;
    }
    setCreateError("");
    setShowPayModal(true);
  };

  const handleConfirmCreate = async (pin, payMode) => {
    setCreating(true);
    setCreateError("");
    try {
      const res = await GiftCardAPI.create({
        amount: Number(amount),
        pin,
        payment_mode: payMode || "normal",
        recipient_name: recipientName.trim() || undefined,
        message: message.trim() || undefined,
        theme: "emerald",
      });
      setShowPayModal(false);
      setCreatedCard(res);
      await refreshProfile?.();
    } catch (err) {
      let msg = "Failed to create gift card. Please check your PIN and balance.";
      if (err.response?.data) {
        const detail = err.response.data.detail;
        msg = typeof detail === "object" ? detail.message : (detail || msg);
      }
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleClaim = async (e) => {
    e?.preventDefault();
    const code = claimCode.trim().toUpperCase();
    if (!code) {
      setClaimError("Please enter a valid gift card code.");
      return;
    }
    setClaiming(true);
    setClaimError("");
    setClaimResult(null);
    try {
      const res = await GiftCardAPI.claim(code);
      setClaimResult(res);
      setClaimCode("");
      await refreshProfile?.();
    } catch (err) {
      let msg = "Could not claim gift card. Check code and try again.";
      if (err.response?.data) {
        const detail = err.response.data.detail;
        msg = typeof detail === "object" ? detail.message : (detail || msg);
      }
      setClaimError(msg);
    } finally {
      setClaiming(false);
    }
  };

  const handlePasteCode = async () => {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setClaimCode(text.trim().toUpperCase());
        }
      }
    } catch {
      // ignore
    }
  };

  const handleCopy = (code) => {
    try {
      navigator.clipboard?.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleViewPdf = async (card) => {
    setPdfTitle(`Gift Card ${card.card_code}`);
    setPdfFilename(`RenoPay_GiftCard_${card.card_code}.pdf`);
    setPdfBlob(null);
    setPdfLoading(true);
    setPdfModalOpen(true);
    try {
      const blob = await GiftCardAPI.downloadPdf(card.id);
      setPdfBlob(blob);
    } catch (err) {
      let errMsg = "Failed to load PDF preview. Please try again.";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.detail) errMsg = typeof json.detail === "string" ? json.detail : (json.detail.message || errMsg);
        } catch {
          // ignore
        }
      }
      alert(errMsg);
      setPdfModalOpen(false);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadPdf = async (card) => {
    try {
      const blob = await GiftCardAPI.downloadPdf(card.id);
      await downloadOrSharePdf(blob, `RenoPay_GiftCard_${card.card_code}.pdf`);
    } catch (err) {
      let errMsg = "Failed to download PDF voucher.";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          if (json.detail) errMsg = typeof json.detail === "string" ? json.detail : (json.detail.message || errMsg);
        } catch {
          // ignore
        }
      }
      alert(errMsg);
    }
  };

  const senderDisplayName = (profile?.full_name || "RISHABH Raj").trim();

  return (
    <div className="min-h-screen bg-bg pb-[120px]">
      {/* Header */}
      <div className="pt-[50px] pb-[16px] px-[22px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn bg-card border border-line text-textLight rounded-xl px-3.5 py-2.5 text-base cursor-pointer"
            onClick={onBack}
          >
            ←
          </button>
          <div>
            <h2 className="text-[20px] font-extrabold text-textLight">RenoPay Gift Card</h2>
            <p className="text-muted text-[11px]">Send instant digital cash vouchers</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-muted text-[10px] uppercase font-bold tracking-wider">Wallet Balance</p>
          <p className="text-accent font-mono font-extrabold text-sm">
            {fmt(profile?.account?.balance ?? 0)}
          </p>
        </div>
      </div>

      <div className="px-[22px]">
        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-card/70 border border-line rounded-2xl mb-5">
          <button
            type="button"
            className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              tab === "create" ? "bg-accent text-white shadow-md shadow-accent/20" : "text-muted hover:text-textLight"
            }`}
            onClick={() => {
              setTab("create");
              setCreatedCard(null);
            }}
          >
            <span>🎁</span>
            <span>Create</span>
          </button>
          <button
            type="button"
            className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              tab === "claim" ? "bg-accent text-white shadow-md shadow-accent/20" : "text-muted hover:text-textLight"
            }`}
            onClick={() => {
              setTab("claim");
              setClaimResult(null);
            }}
          >
            <span>🎟️</span>
            <span>Claim</span>
          </button>
          <button
            type="button"
            className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              tab === "history" ? "bg-accent text-white shadow-md shadow-accent/20" : "text-muted hover:text-textLight"
            }`}
            onClick={() => setTab("history")}
          >
            <span>📜</span>
            <span>My Cards</span>
          </button>
        </div>

        {/* ---------------- CREATE GIFT CARD ---------------- */}
        {tab === "create" && (
          <div className="animate-fadeUp">
            {!createdCard ? (
              <>
                {/* 1. Recipient Input */}
                <Card className="p-4 mb-4 border-line">
                  <label className="text-xs text-textLight font-bold block mb-1.5">
                    👤 Gift To (Kise dena chahte hain?)
                  </label>
                  <input
                    type="text"
                    placeholder="Enter Recipient Name (e.g. Priya Sharma / Friend)"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    maxLength={60}
                    className="w-full text-sm font-semibold p-2.5 rounded-xl bg-surf border border-line text-textLight placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </Card>

                {/* 2. Amount Selection */}
                <Card className="p-4 mb-4 border-accent/[.2]">
                  <p className="text-muted text-[11px] font-bold uppercase tracking-wide mb-2.5">
                    Select or Enter Amount
                  </p>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl text-accent font-mono font-bold">₹</span>
                    <input
                      type="number"
                      placeholder="500"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="text-2xl font-extrabold font-mono bg-transparent border-none border-b-2 border-accent rounded-none pl-0 w-full focus:outline-none text-textLight"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {PRESET_AMOUNTS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={`py-2 rounded-xl font-bold text-xs border transition-all cursor-pointer ${
                          Number(amount) === p
                            ? "bg-accent/20 border-accent text-accent shadow-sm"
                            : "bg-surf/80 border-line text-muted hover:text-textLight hover:border-accent/40"
                        }`}
                        onClick={() => setAmount(String(p))}
                      >
                        ₹{p}
                      </button>
                    ))}
                  </div>
                </Card>

                {/* 3. Greeting Message */}
                <Card className="p-4 mb-5 border-line">
                  <label className="text-xs text-textLight font-bold block mb-1.5">
                    💌 Greeting Message (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Best Wishes! 🌟"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={100}
                    className="w-full text-xs p-2.5 rounded-xl bg-surf border border-line text-textLight placeholder:text-muted focus:border-accent focus:outline-none mb-2.5"
                  />
                  <div className="flex gap-1.5 flex-wrap">
                    {GREETINGS.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={`text-[10px] px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                          message === g
                            ? "bg-accent/20 border-accent text-accent font-bold"
                            : "bg-surf border-line text-muted hover:text-textLight"
                        }`}
                        onClick={() => setMessage(g)}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </Card>

                {createError && (
                  <p className="text-danger text-xs text-center mb-3">{createError}</p>
                )}

                <Btn onClick={handleOpenPayModal} disabled={creating}>
                  {`Proceed to Pay • ₹${amount || 0}`}
                </Btn>
              </>
            ) : (
              /* Success Creation Screen - Shows the Generated Emerald Luxury Card */
              <div className="animate-fadeUp text-center pt-2">
                <div className="w-[74px] h-[74px] rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-3xl mx-auto mb-3 animate-bounce">
                  🎁
                </div>
                <h3 className="text-2xl font-extrabold text-white">Gift Card Generated!</h3>
                <p className="text-muted text-xs mt-1">
                  ₹{createdCard.amount} pre-funded and ready to download & share
                </p>

                {/* Voucher Card Result in Emerald & Gold (with Scanner on Bottom Left, Recipient in Center, Wax Seal on Right) */}
                <div className="my-5 rounded-[22px] border-2 border-[#c9a44c] p-[3px] shadow-2xl text-left bg-gradient-to-b from-[#092617] via-[#051a10] to-[#020d08]">
                  <div className="border border-[#e0be6c]/60 rounded-[18px] p-4 sm:p-5 relative">
                    {/* Top Row: Brand, Sender & Official Status */}
                    <div className="flex justify-between items-start">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-[#a1d1b5] tracking-widest uppercase">⚡ RENOPAY</span>
                        <span className="text-[9px] font-extrabold text-[#ffd875] tracking-wider uppercase">GIFT CARD</span>
                      </div>

                      <div className="text-center px-1">
                        <div className="text-[9px] font-bold text-[#c9a44c] tracking-[4px] uppercase">
                          F R O M
                        </div>
                        <div className="font-serif text-[18px] sm:text-[20px] font-bold text-[#f5d78a] tracking-wide leading-tight mt-0.5 drop-shadow">
                          {senderDisplayName}
                        </div>
                        <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-[#c9a44c] to-transparent mx-auto mt-1"></div>
                      </div>

                      <div className="text-right">
                        <span className="inline-flex items-center gap-1 text-[9px] font-extrabold text-[#ffd875] bg-[#031c10] border border-[#c9a44c]/60 px-2 py-0.5 rounded-full shadow-sm">
                          ✦ OFFICIAL
                        </span>
                      </div>
                    </div>

                    {/* Middle Row: Gift Card ID & Value */}
                    <div className="my-3 text-center">
                      <div className="text-[9px] font-bold text-[#c9a44c] tracking-[3px] uppercase mb-1">
                        G I F T &nbsp; C A R D &nbsp; I D -
                      </div>
                      <div className="flex items-center justify-between bg-black/70 px-3 py-2 rounded-xl border border-[#c9a44c]/50 my-1.5 shadow-inner">
                        <span className="font-mono text-sm sm:text-base font-black text-[#ffe08a] tracking-wider select-all whitespace-nowrap overflow-x-auto">
                          {createdCard.card_code}
                        </span>
                        <button
                          type="button"
                          className="ml-2 px-2.5 py-1 text-xs font-bold rounded-lg bg-[#c9a44c] text-black hover:bg-[#e0be6c] active:scale-95 transition-all cursor-pointer shrink-0"
                          onClick={() => handleCopy(createdCard.card_code)}
                        >
                          {copiedCode ? "✓ Copied" : "Copy"}
                        </button>
                      </div>

                      <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-black/40 border border-[#c9a44c]/40 mt-1">
                        <span className="text-[10px] text-[#a1d1b5] uppercase font-bold tracking-wider">VALUE:</span>
                        <span className="font-mono text-lg font-extrabold text-[#ffd875]">
                          ₹{createdCard.amount}
                        </span>
                      </div>
                      {createdCard.message && (
                        <p className="text-xs text-[#d1e7dd] italic mt-1.5 font-serif">
                          &ldquo;{createdCard.message}&rdquo;
                        </p>
                      )}
                    </div>

                    {/* Bottom Row: Real Scanner on Left, Recipient in Center, RP Wax Seal on Right */}
                    <div className="flex justify-between items-end pt-3 border-t border-[#c9a44c]/30">
                      {/* Left: Real Scan-able QR Code */}
                      <div className="flex flex-col items-center">
                        <div className="w-[60px] h-[60px] p-0.5 bg-white rounded-lg border-2 border-[#c9a44c] shadow flex items-center justify-center overflow-hidden">
                          {qrDataUrl ? (
                            <img src={qrDataUrl} alt="Claim QR" className="w-full h-full object-contain" />
                          ) : (
                            <div className="w-full h-full bg-white flex items-center justify-center">
                              <div className="w-4 h-4 border-2 border-[#c9a44c] border-t-transparent rounded-full animate-spin"></div>
                            </div>
                          )}
                        </div>
                        <span className="text-[7.5px] font-extrabold text-[#ffd875] tracking-wider mt-1 uppercase whitespace-nowrap">
                          SCAN TO CLAIM
                        </span>
                      </div>

                      {/* Center: Recipient Name */}
                      <div className="text-center px-2 flex-1 min-w-0">
                        <div className="font-serif text-xs font-bold text-[#f5d78a] truncate">
                          TO: <span className="border-b border-[#c9a44c] pb-0.5 text-white">{createdCard.recipient_name || "Valued Bearer"}</span>
                        </div>
                        <div className="text-[8.5px] text-[#a1d1b5] mt-1 whitespace-nowrap">
                          100% Guaranteed Redeemable
                        </div>
                      </div>

                      {/* Right: RP Wax Seal */}
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#f0c36b] via-[#c49233] to-[#7a4f0c] border-2 border-[#fff0c2] shadow flex items-center justify-center font-serif text-base font-black text-[#3d2402]">
                          RP
                        </div>
                        <span className="text-[7.5px] font-bold text-[#c9a44c] mt-1 uppercase tracking-wider">
                          SEAL
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PDF Action Buttons */}
                <div className="flex flex-col gap-2.5 mb-5">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn flex-1 py-3 px-3 rounded-xl bg-card border border-accent/40 text-accent font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-accent/10 transition-all cursor-pointer"
                      onClick={() => handleViewPdf(createdCard)}
                    >
                      <span>👁</span>
                      <span>View PDF Voucher</span>
                    </button>
                    <button
                      type="button"
                      className="btn flex-1 py-3 px-3 rounded-xl bg-accent text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-accent/20 hover:bg-accent/90 transition-all cursor-pointer"
                      onClick={() => handleDownloadPdf(createdCard)}
                    >
                      <span>⬇</span>
                      <span>Download PDF</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="text-muted text-xs hover:text-white py-2 transition-all cursor-pointer"
                    onClick={() => {
                      setCreatedCard(null);
                      setRecipientName("");
                    }}
                  >
                    + Create Another Gift Card
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- STANDARD PAYMENT METHOD MODAL (Normal Pay vs Advance Pay with Note Slider) ---------------- */}
        <PaymentMethodModal
          isOpen={showPayModal}
          onClose={() => {
            setShowPayModal(false);
            setCreateError("");
          }}
          title="Create RenoPay Gift Card"
          subtitle={`Recipient: ${recipientName.trim() || "Bearer Voucher"}`}
          amount={Number(amount) || 0}
          recipient={recipientName.trim() || "RenoPay Gift Card Vault"}
          accountBalance={profile?.account?.balance ?? 0}
          onAddMoney={() => {
            setShowPayModal(false);
            onBack();
          }}
          onConfirm={handleConfirmCreate}
          loading={creating}
          error={createError}
        />

        {/* ---------------- CLAIM GIFT CARD ---------------- */}
        {tab === "claim" && (
          <div className="animate-fadeUp">
            {!claimResult ? (
              <Card className="p-5 border-accent/[.2]">
                <div className="text-center mb-5">
                  <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center text-3xl mx-auto mb-3">
                    🎟️
                  </div>
                  <h3 className="text-lg font-extrabold text-textLight">Claim Gift Card</h3>
                  <p className="text-muted text-xs mt-1">
                    Redeem your voucher code or scan voucher QR for instant wallet credit
                  </p>
                </div>

                <form onSubmit={handleClaim}>
                  <div className="mb-4">
                    <label className="text-[11px] text-muted font-bold block mb-1 uppercase tracking-wider">
                      Gift Card Code
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        placeholder="e.g. RENO-GIFT-A1B2-C3D4"
                        value={claimCode}
                        onChange={(e) => setClaimCode(e.target.value.toUpperCase())}
                        className="w-full pr-20 font-mono uppercase font-bold text-sm tracking-wider"
                      />
                      <button
                        type="button"
                        className="absolute right-2 px-2.5 py-1 text-xs font-semibold rounded-lg bg-surf border border-line text-muted hover:text-textLight cursor-pointer"
                        onClick={handlePasteCode}
                      >
                        Paste
                      </button>
                    </div>
                  </div>

                  {claimError && (
                    <p className="text-danger text-xs text-center mb-3">{claimError}</p>
                  )}

                  <div className="flex flex-col gap-2.5">
                    <Btn type="submit" disabled={claiming}>
                      {claiming ? "Verifying & Claiming..." : "Claim Gift Card"}
                    </Btn>

                    {/* Direct Camera Scanner Trigger */}
                    {onScanQr && (
                      <button
                        type="button"
                        className="py-2.5 rounded-xl border border-line bg-surf/80 text-textLight font-semibold text-xs flex items-center justify-center gap-1.5 hover:border-accent/40 cursor-pointer"
                        onClick={onScanQr}
                      >
                        <span>📷</span>
                        <span>Scan Voucher QR Code</span>
                      </button>
                    )}
                  </div>
                </form>
              </Card>
            ) : (
              /* Claim Success Screen */
              <div className="animate-fadeUp text-center pt-4">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center text-4xl mx-auto mb-4 animate-bounce">
                  ✨
                </div>
                <h3 className="text-2xl font-extrabold text-textLight">Gift Card Claimed!</h3>
                <p className="text-emerald-400 text-sm font-bold mt-1">
                  ₹{claimResult.amount} added to your account!
                </p>

                <div className="my-5 p-4 rounded-xl bg-card border border-line text-left">
                  <div className="flex justify-between items-center text-xs py-1 border-b border-line/60">
                    <span className="text-muted">Voucher Code</span>
                    <span className="font-mono font-bold text-textLight">{claimResult.card_code}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs py-1 border-b border-line/60">
                    <span className="text-muted">Amount Credited</span>
                    <span className="font-mono font-extrabold text-emerald-400">₹{claimResult.amount}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs py-1">
                    <span className="text-muted">Updated Balance</span>
                    <span className="font-mono font-extrabold text-accent">₹{claimResult.new_balance}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Btn variant="dark" onClick={() => onBack()} className="flex-1">
                    Home
                  </Btn>
                  <Btn
                    variant="teal"
                    onClick={() => {
                      setClaimResult(null);
                      setClaimCode("");
                    }}
                    className="flex-1"
                  >
                    Claim Another
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------- MY GIFT CARDS HISTORY ---------------- */}
        {tab === "history" && (
          <div className="animate-fadeUp">
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  historyFilter === "created"
                    ? "bg-accent/20 border-accent text-accent"
                    : "bg-card border-line text-muted"
                }`}
                onClick={() => setHistoryFilter("created")}
              >
                Created by Me ({myCards.created.length})
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  historyFilter === "claimed"
                    ? "bg-accent/20 border-accent text-accent"
                    : "bg-card border-line text-muted"
                }`}
                onClick={() => setHistoryFilter("claimed")}
              >
                Claimed by Me ({myCards.claimed.length})
              </button>
            </div>

            {loadingHistory ? (
              <div className="text-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-accent mx-auto"></div>
                <p className="text-muted text-xs mt-3">Loading gift cards...</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {(historyFilter === "created" ? myCards.created : myCards.claimed).map((c) => (
                  <Card key={c.id} className="p-4 border-line hover:border-accent/30 transition-all">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-mono text-sm font-extrabold text-textLight">{c.card_code}</p>
                        <p className="text-[11px] text-muted mt-0.5">
                          {historyFilter === "created"
                            ? c.recipient_name ? `For ${c.recipient_name}` : "Bearer Voucher"
                            : `Claimed on ${new Date(c.claimed_at || c.created_at).toLocaleDateString()}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-accent text-sm">₹{c.amount}</p>
                        <Badge
                          color={c.status === "active" ? "#F59E0B" : c.status === "claimed" ? "#22C55E" : "#94A3B8"}
                          size={9}
                        >
                          {c.status.toUpperCase()}
                        </Badge>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-line/50 flex justify-between items-center text-xs">
                      <button
                        type="button"
                        className="text-muted hover:text-accent flex items-center gap-1 font-semibold cursor-pointer"
                        onClick={() => handleCopy(c.card_code)}
                      >
                        <span>📋</span>
                        <span>Copy Code</span>
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="text-accent hover:underline font-bold cursor-pointer"
                          onClick={() => handleViewPdf(c)}
                        >
                          👁 View PDF
                        </button>
                        <span className="text-muted">·</span>
                        <button
                          type="button"
                          className="text-accent hover:underline font-bold cursor-pointer"
                          onClick={() => handleDownloadPdf(c)}
                        >
                          ⬇ Download
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}

                {(historyFilter === "created" ? myCards.created : myCards.claimed).length === 0 && (
                  <div className="text-center py-12 text-muted text-xs">
                    No {historyFilter === "created" ? "created" : "claimed"} gift cards found.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* PDF Voucher Preview Modal */}
      <PdfPreviewModal
        isOpen={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        pdfBlob={pdfBlob}
        title={pdfTitle}
        filename={pdfFilename}
        loading={pdfLoading}
      />
    </div>
  );
}
