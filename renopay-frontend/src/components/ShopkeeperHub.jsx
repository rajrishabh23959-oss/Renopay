import { useState, useEffect, useRef } from "react";
import { VoiceBoxAPI, KhatabookAPI } from "../lib/api";
import { Card, Btn, Badge } from "./ui";
import { fmt } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useRenoSocket } from "../hooks/useRenoSocket";
import { PdfPreviewModal } from "./PdfPreviewModal";
import { downloadOrSharePdf } from "../lib/download";

// Web Audio soundbox chime generator
function playSoundboxChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
    gain2.gain.setValueAtTime(0.28, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.55);
  } catch (e) {
    console.warn("Audio chime error:", e);
  }
}

// Fallback supported languages with regional scripts
const AVAILABLE_LANGUAGES = [
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "en", label: "English" },
  { code: "ta", label: "தமிழ் (Tamil)" },
  { code: "te", label: "తెలుగు (Telugu)" },
  { code: "ml", label: "മലയാളം (Malayalam)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "bn", label: "বাংলা (Bengali)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { code: "bho", label: "भोजपुरी (Bhojpuri)" },
  { code: "or", label: "ଓଡ଼ିଆ (Odia)" },
];

// Browser speech synthesis helper
function speakAnnouncement(text, langCode = "hi") {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    playSoundboxChime();
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
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

      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((v) => v.lang.startsWith(utterance.lang.slice(0, 2)));
      if (match) utterance.voice = match;

      window.speechSynthesis.speak(utterance);
    }, 400);
  } catch (e) {
    console.warn("TTS error:", e);
  }
}

export function ShopkeeperHub() {
  const { profile } = useAuth();

  // Voice Box state
  const [voicebox, setVoicebox] = useState(null);
  const [vbLoading, setVbLoading] = useState(true);
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [changeLangModalOpen, setChangeLangModalOpen] = useState(false);
  const [selectedLang, setSelectedLang] = useState("hi");
  const [vbBusy, setVbBusy] = useState(false);
  const [testPlaying, setTestPlaying] = useState(false);

  // Available languages list with dependable fallback
  const languagesList = (voicebox?.available_languages && voicebox.available_languages.length > 0)
    ? voicebox.available_languages
    : AVAILABLE_LANGUAGES;
  const settlementVpa = voicebox?.target_settlement_vpa || "rishabhraj1368@renopay";

  // Khatabook state
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [loadingKhata, setLoadingKhata] = useState(true);

  // Modals
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustUpi, setNewCustUpi] = useState("");
  const [newCustEmail, setNewCustEmail] = useState("");
  const [custBusy, setCustBusy] = useState(false);

  // Selected Customer Drawer/Modal
  const [selectedCust, setSelectedCust] = useState(null);
  const [custDetails, setCustDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Entry Form modal
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [entryType, setEntryType] = useState("gave"); // "gave" | "received"
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDesc, setEntryDesc] = useState("");
  const [entryMode, setEntryMode] = useState("cash");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [entryBusy, setEntryBusy] = useState(false);

  // Saathi AI Voice mic entry state
  const [isListening, setIsListening] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [voiceParsed, setVoiceParsed] = useState(null);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [voiceParsing, setVoiceParsing] = useState(false);

  // PDF Preview Modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewTitle, setPreviewTitle] = useState("Report");
  const [previewFilename, setPreviewFilename] = useState("Report.pdf");
  const [pdfLoading, setPdfLoading] = useState(false);

  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. Load Voice Box status
  const loadVoicebox = async () => {
    try {
      const data = await VoiceBoxAPI.getStatus();
      setVoicebox(data);
      setSelectedLang(data.language || "hi");
    } catch (e) {
      console.error("loadVoicebox error:", e);
    } finally {
      setVbLoading(false);
    }
  };

  // 2. Load Khatabook summary & customers
  const loadKhatabook = async () => {
    try {
      const [sum, custs] = await Promise.all([
        KhatabookAPI.getSummary(),
        KhatabookAPI.getCustomers(search, filterType === "all" ? null : filterType),
      ]);
      setSummary(sum);
      setCustomers(custs.customers || []);
    } catch (e) {
      console.error("loadKhatabook error:", e);
    } finally {
      setLoadingKhata(false);
    }
  };

  useEffect(() => {
    loadVoicebox();
    loadKhatabook();
  }, []);

  useEffect(() => {
    loadKhatabook();
  }, [search, filterType]);

  // Load customer details when selected
  const loadCustomerDetails = async (cId) => {
    setLoadingDetails(true);
    try {
      const data = await KhatabookAPI.getCustomerDetails(cId);
      setCustDetails(data);
    } catch (e) {
      showToast("Could not load customer ledger", "error");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleSelectCustomer = (c) => {
    setSelectedCust(c);
    loadCustomerDetails(c.id);
  };

  // Real-time WebSocket triggers for Voice Box
  useRenoSocket((evt) => {
    if (evt.type === "voicebox_announcement") {
      const { text, language } = evt.data;
      speakAnnouncement(text, language || voicebox?.language || "hi");
      showToast(`📢 Voice Box: ${text}`, "info");
      loadVoicebox();
      loadKhatabook();
    }
    if (evt.type === "balance_update" && evt.data.reason === "credit") {
      loadKhatabook();
    }
  });

  // Activate Voice Box (₹200)
  const handleActivateVb = async () => {
    setVbBusy(true);
    try {
      const res = await VoiceBoxAPI.activate(selectedLang);
      showToast(res.message);
      setActivateModalOpen(false);
      await loadVoicebox();
      speakAnnouncement(res.sample_announcement, selectedLang);
    } catch (e) {
      showToast(e.response?.data?.detail || "Voice Box activation failed", "error");
    } finally {
      setVbBusy(false);
    }
  };

  // Change Language (₹100)
  const handleChangeLang = async () => {
    setVbBusy(true);
    try {
      const res = await VoiceBoxAPI.changeLanguage(selectedLang);
      showToast(res.message);
      setChangeLangModalOpen(false);
      await loadVoicebox();
      speakAnnouncement(res.sample_announcement, selectedLang);
    } catch (e) {
      showToast(e.response?.data?.detail || "Language change failed", "error");
    } finally {
      setVbBusy(false);
    }
  };

  // Renew Voice Box (₹200)
  const handleRenewVb = async () => {
    setVbBusy(true);
    try {
      const res = await VoiceBoxAPI.renew();
      showToast(res.message);
      await loadVoicebox();
    } catch (e) {
      showToast(e.response?.data?.detail || "Renewal failed", "error");
    } finally {
      setVbBusy(false);
    }
  };

  // Test Announcement trigger
  const handleTestAnnouncement = async () => {
    setTestPlaying(true);
    try {
      const res = await VoiceBoxAPI.sampleAnnouncement("rishabh", 100, voicebox?.language || "hi");
      speakAnnouncement(res.text, res.language);
    } catch (e) {
      speakAnnouncement("RenoPay par rishabh se 100 rupaye prapt hue.", "hi");
    } finally {
      setTimeout(() => setTestPlaying(false), 2000);
    }
  };

  // Add Customer
  const handleCreateCustomer = async (e) => {
    e?.preventDefault();
    if (!newCustName.trim() || !newCustPhone.trim()) {
      showToast("Name and phone number are required", "error");
      return;
    }
    setCustBusy(true);
    try {
      await KhatabookAPI.createCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        upi_id: newCustUpi.trim() || null,
        email: newCustEmail.trim() || null,
      });
      showToast("Customer added successfully!");
      setAddCustomerOpen(false);
      setNewCustName("");
      setNewCustPhone("");
      setNewCustUpi("");
      setNewCustEmail("");
      loadKhatabook();
    } catch (err) {
      showToast(err.response?.data?.detail || "Failed to add customer", "error");
    } finally {
      setCustBusy(false);
    }
  };

  // Add Ledger Entry
  const handleAddEntry = async (e) => {
    e?.preventDefault();
    const amt = parseFloat(entryAmount);
    if (!amt || amt <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setEntryBusy(true);
    try {
      await KhatabookAPI.addEntry(selectedCust.id, {
        entry_type: entryType,
        amount: amt,
        items_description: entryDesc.trim() || null,
        entry_date: entryDate,
        payment_mode: entryMode,
      });
      showToast(entryType === "gave" ? "Udhar added successfully!" : "Payment recorded successfully!");
      setEntryModalOpen(false);
      setEntryAmount("");
      setEntryDesc("");
      loadCustomerDetails(selectedCust.id);
      loadKhatabook();
    } catch (err) {
      showToast(err.response?.data?.detail || "Failed to add entry", "error");
    } finally {
      setEntryBusy(false);
    }
  };

  // 1-Tap RenoPay Payment Request
  const handleRequestPayment = async () => {
    if (!selectedCust) return;
    try {
      const res = await KhatabookAPI.requestPayment(selectedCust.id);
      showToast(res.message);
    } catch (err) {
      showToast(err.response?.data?.detail || "Failed to send payment request", "error");
    }
  };

  // Saathi AI Voice Entry Mic action
  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceModalOpen(true);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = voicebox?.language === "en" ? "en-IN" : "hi-IN";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      setIsListening(true);
      setVoiceText("");
      setVoiceParsed(null);
      setVoiceModalOpen(true);

      recognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        setVoiceText(transcript);
        setIsListening(false);
        handleParseVoice(transcript);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (e) {
      setIsListening(false);
      setVoiceModalOpen(true);
    }
  };

  const handleParseVoice = async (transcriptText) => {
    const text = transcriptText || voiceText;
    if (!text || !text.trim()) return;
    setVoiceParsing(true);
    try {
      const res = await KhatabookAPI.parseVoiceEntry(text.trim(), false);
      setVoiceParsed(res);
    } catch (e) {
      showToast("Voice parsing failed. Please type manually.", "error");
    } finally {
      setVoiceParsing(false);
    }
  };

  const handleConfirmVoiceEntry = async () => {
    if (!voiceParsed?.matched_customer || !voiceParsed?.parsed?.amount) {
      showToast("Please select a customer and amount", "error");
      return;
    }
    setVoiceParsing(true);
    try {
      await KhatabookAPI.addEntry(voiceParsed.matched_customer.id, {
        entry_type: voiceParsed.parsed.entry_type,
        amount: voiceParsed.parsed.amount,
        items_description: voiceParsed.parsed.items_description,
        entry_date: new Date().toISOString().split("T")[0],
        payment_mode: voiceParsed.parsed.entry_type === "gave" ? "cash" : "renopay_upi",
      });
      showToast("Voice entry saved to Khatabook!");
      setVoiceModalOpen(false);
      setVoiceText("");
      setVoiceParsed(null);
      loadKhatabook();
      if (selectedCust && selectedCust.id === voiceParsed.matched_customer.id) {
        loadCustomerDetails(selectedCust.id);
      }
    } catch (e) {
      showToast("Failed to save entry", "error");
    } finally {
      setVoiceParsing(false);
    }
  };

  // PDF View & Download handlers
  const handleViewCustomerPdf = async () => {
    if (!selectedCust) return;
    setPdfLoading(true);
    try {
      const blob = await KhatabookAPI.getCustomerPdf(selectedCust.id);
      setPreviewBlob(blob);
      setPreviewTitle(`${selectedCust.name} Statement`);
      setPreviewFilename(`Khata_${selectedCust.name.replace(/\s+/g, "_")}.pdf`);
      setPreviewOpen(true);
    } catch (e) {
      showToast("Failed to generate PDF", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadCustomerPdf = async () => {
    if (!selectedCust) return;
    setPdfLoading(true);
    try {
      const blob = await KhatabookAPI.getCustomerPdf(selectedCust.id);
      await downloadOrSharePdf(blob, `Khata_${selectedCust.name.replace(/\s+/g, "_")}.pdf`, `${selectedCust.name} Statement`);
      showToast("PDF downloaded!");
    } catch (e) {
      showToast("Download failed", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleViewMonthlySalesPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await KhatabookAPI.getMonthlySalesPdf();
      setPreviewBlob(blob);
      setPreviewTitle("Monthly Business Report");
      setPreviewFilename("RenoPay_Monthly_Sales_Report.pdf");
      setPreviewOpen(true);
    } catch (e) {
      showToast("Failed to generate PDF", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadMonthlySalesPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await KhatabookAPI.getMonthlySalesPdf();
      await downloadOrSharePdf(blob, "RenoPay_Monthly_Sales_Report.pdf", "Monthly Business Report");
      showToast("Monthly Report downloaded!");
    } catch (e) {
      showToast("Download failed", "error");
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-12 animate-fadeUp">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-2.5 rounded-xl text-xs font-bold shadow-lg transition-all border ${
            toast.type === "error"
              ? "bg-red-900/90 text-red-100 border-red-500/50"
              : toast.type === "info"
              ? "bg-blue-900/90 text-blue-100 border-blue-500/50"
              : "bg-emerald-900/90 text-emerald-100 border-emerald-500/50"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── 1. TOP HEADER: FULL MONTH SALES & BUSINESS HISAB ──────────────── */}
      <Card className="p-4 bg-gradient-to-br from-card to-surf border-accent/30 relative overflow-hidden shadow-sm">
        <div className="flex justify-between items-start mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏪</span>
              <h2 className="text-base font-extrabold text-textLight">Shopkeeper Mode (दुकानदार)</h2>
            </div>
            <p className="text-[11px] text-muted mt-0.5">
              Full Month Sales &amp; Bahi-Khata Ledger &bull; {summary?.month_label || "This Month"}
            </p>
          </div>
          <Badge color="#FF6A1A" size={10}>Shopkeeper</Badge>
        </div>

        {/* 4 Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 my-2.5">
          <div className="bg-bg/60 border border-line rounded-xl p-2.5">
            <span className="text-[9.5px] uppercase font-bold text-muted tracking-wider block">Monthly Sales (बिक्री)</span>
            <span className="text-base font-extrabold text-textLight font-mono">
              ₹{fmt(summary?.monthly_sales ?? 0)}
            </span>
          </div>
          <div className="bg-bg/60 border border-line rounded-xl p-2.5">
            <span className="text-[9.5px] uppercase font-bold text-muted tracking-wider block">Collected (जमा)</span>
            <span className="text-base font-extrabold text-emerald-400 font-mono">
              ₹{fmt(summary?.monthly_collections ?? 0)}
            </span>
          </div>
          <div className="bg-bg/60 border border-line rounded-xl p-2.5">
            <span className="text-[9.5px] uppercase font-bold text-muted tracking-wider block">You Will Get (उधार बाकी)</span>
            <span className="text-base font-extrabold text-red-400 font-mono">
              ₹{fmt(summary?.total_you_will_get ?? 0)}
            </span>
          </div>
          <div className="bg-bg/60 border border-line rounded-xl p-2.5">
            <span className="text-[9.5px] uppercase font-bold text-muted tracking-wider block">You Will Give (एडवांस)</span>
            <span className="text-base font-extrabold text-blue-400 font-mono">
              ₹{fmt(summary?.total_you_will_give ?? 0)}
            </span>
          </div>
        </div>

        {/* View & Download Monthly Sales PDF Bar */}
        <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-line/60">
          <button
            type="button"
            onClick={handleViewMonthlySalesPdf}
            disabled={pdfLoading}
            className="py-2 px-3 rounded-lg text-[11px] font-bold bg-card border border-accent/40 text-accent hover:bg-accent/10 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
          >
            <span>👁</span>
            <span>View Month PDF</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadMonthlySalesPdf}
            disabled={pdfLoading}
            className="py-2 px-3 rounded-lg text-[11px] font-bold bg-accent text-white hover:brightness-110 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <span>⬇</span>
            <span>Download Month PDF</span>
          </button>
        </div>
      </Card>

      {/* ── 2. PILLAR A: SMART VOICE BOX (आवाज बॉक्स) ────────────────────── */}
      <Card className="p-4 border-accent/30 bg-surf/80 relative">
        <div className="flex justify-between items-start mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/20 flex items-center justify-center text-lg">
              🔊
            </div>
            <div>
              <h3 className="text-sm font-bold text-textLight">Smart Voice Box (आवाज बॉक्स)</h3>
              <p className="text-[10px] text-muted">Instant payment announcements in phone speaker</p>
            </div>
          </div>
          {voicebox?.is_active ? (
            <Badge color="#22C55E" size={9}>Active &bull; {voicebox.days_remaining}d left</Badge>
          ) : (
            <Badge color="#94A3B8" size={9}>Inactive</Badge>
          )}
        </div>

        {voicebox?.is_active ? (
          <div className="space-y-3 mt-3">
            {/* Visual Speaker & Language Details */}
            <div className="bg-bg/80 border border-line rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[9.5px] uppercase font-bold text-muted block">Voice Language</span>
                <span className="text-xs font-bold text-accent">{voicebox.language_label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleTestAnnouncement}
                  disabled={testPlaying}
                  className="py-1.5 px-3 rounded-lg text-[10.5px] font-bold bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 transition-all flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  <span>{testPlaying ? "🔊 Playing..." : "▶ Test Voice"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChangeLangModalOpen(true)}
                  className="py-1.5 px-2.5 rounded-lg text-[10.5px] font-bold bg-card border border-line text-textLight hover:bg-surf transition-all cursor-pointer"
                >
                  Change (₹100)
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10.5px] text-muted px-1">
              <span>Settlement: <strong className="text-textLight font-mono">{settlementVpa}</strong></span>
              <button
                type="button"
                onClick={handleRenewVb}
                disabled={vbBusy}
                className="text-accent font-bold hover:underline cursor-pointer"
              >
                Renew (₹200 / 6mo)
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 bg-bg/80 border border-dashed border-accent/40 rounded-xl p-3.5 text-center">
            <p className="text-xs text-textLight font-semibold mb-1">
              Activate Voice Box for ₹200 for 6 months!
            </p>
            <p className="text-[10px] text-muted mb-3 leading-relaxed">
              Whenever a customer pays, hear loud spoken announcements: <br/>
              <em>"RenoPay par rishabh se ₹100 prapt hue!"</em>
            </p>
            <button
              type="button"
              onClick={() => setActivateModalOpen(true)}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-accent text-white shadow-accentGlow hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              Activate Voice Box &bull; ₹200 (6 Months)
            </button>
          </div>
        )}
      </Card>

      {/* ── 3. PILLAR B: DIGITAL KHATABOOK (डिजिटल बही-खाता) ────────────────── */}
      <Card className="p-4 border-line bg-card">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📖</span>
            <div>
              <h3 className="text-sm font-bold text-textLight">Digital Khatabook</h3>
              <p className="text-[10px] text-muted">{customers.length} Onboarded Customers</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Saathi Voice Entry Mic Button */}
            <button
              type="button"
              onClick={startVoiceInput}
              title="Speak to add entry with Saathi AI"
              className="py-1.5 px-3 rounded-xl bg-accent text-white font-bold text-[11px] flex items-center gap-1.5 shadow-accentGlow hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              <span className="animate-pulse">🎙</span>
              <span>बोलकर एंट्री</span>
            </button>

            {/* Add Customer Button */}
            <button
              type="button"
              onClick={() => setAddCustomerOpen(true)}
              className="py-1.5 px-2.5 rounded-xl bg-surf border border-line text-textLight font-bold text-[11px] hover:border-accent transition-all cursor-pointer"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="space-y-2 mb-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search by customer name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight placeholder:text-muted focus:outline-none focus:border-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex gap-1.5">
            {[
              { id: "all", label: "All" },
              { id: "due", label: "Udhar Due (लेंगे)" },
              { id: "advance", label: "Advance (देंगे)" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterType(f.id)}
                className={`py-1 px-2.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  filterType === f.id
                    ? "bg-accent text-white"
                    : "bg-surf text-muted hover:text-textLight"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Customer List */}
        <div className="divide-y divide-line/60 max-h-[360px] overflow-y-auto pr-1">
          {customers.length > 0 ? (
            customers.map((c) => (
              <div
                key={c.id}
                onClick={() => handleSelectCustomer(c)}
                className="py-2.5 px-2 flex items-center justify-between hover:bg-surf/80 rounded-xl cursor-pointer transition-all active:scale-[0.99]"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-accent/15 border border-accent/30 flex items-center justify-center font-bold text-xs text-accent uppercase">
                    {c.name.slice(0, 2)}
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-textLight">{c.name}</h4>
                    <p className="text-[10px] text-muted">{c.phone}</p>
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`text-xs font-extrabold font-mono block ${
                      c.net_balance > 0
                        ? "text-red-400"
                        : c.net_balance < 0
                        ? "text-emerald-400"
                        : "text-muted"
                    }`}
                  >
                    ₹{fmt(Math.abs(c.net_balance))}
                  </span>
                  <span className="text-[9px] text-muted uppercase font-bold">
                    {c.net_balance > 0 ? "Due" : c.net_balance < 0 ? "Advance" : "Clear"}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-muted text-xs">
              No customers found. Click <strong>+ Add</strong> or <strong>बोलकर एंट्री</strong> to start!
            </div>
          )}
        </div>
      </Card>

      {/* ── 4. CUSTOMER LEDGER MODAL / DRAWER ─────────────────────────────── */}
      {selectedCust && (
        <div className="fixed inset-0 z-[150] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-card border border-line rounded-t-3xl sm:rounded-3xl w-full max-w-[420px] max-h-[90vh] flex flex-col overflow-hidden animate-slideUp shadow-2xl">
            {/* Header */}
            <div className="p-4 border-b border-line bg-surf flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center font-bold text-sm text-accent uppercase">
                  {selectedCust.name.slice(0, 2)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-textLight">{selectedCust.name}</h3>
                  <p className="text-[10px] text-muted">{selectedCust.phone} &bull; {selectedCust.upi_id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCust(null)}
                className="w-7 h-7 rounded-full bg-bg border border-line flex items-center justify-center text-muted text-xs hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Net Balance & Quick Actions */}
            <div className="p-3.5 bg-gradient-to-r from-bg to-surf border-b border-line">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <span className="text-[9.5px] uppercase font-bold text-muted block">Net Outstanding</span>
                  <span
                    className={`text-lg font-extrabold font-mono ${
                      (custDetails?.customer?.net_balance ?? selectedCust.net_balance) > 0
                        ? "text-red-400"
                        : "text-emerald-400"
                    }`}
                  >
                    ₹{fmt(Math.abs(custDetails?.customer?.net_balance ?? selectedCust.net_balance))}
                  </span>
                  <span className="text-[9.5px] font-bold text-muted ml-1">
                    {(custDetails?.customer?.net_balance ?? selectedCust.net_balance) > 0
                      ? "(Aapko lene hain)"
                      : "(Advance jama)"}
                  </span>
                </div>

                {/* 1-Tap RenoPay Payment Request */}
                <button
                  type="button"
                  onClick={handleRequestPayment}
                  className="py-1.5 px-3 rounded-xl bg-accent text-white font-bold text-[11px] shadow-sm hover:brightness-110 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <span>⚡ Request on RenoPay</span>
                </button>
              </div>

              {/* PDF Actions */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleViewCustomerPdf}
                  disabled={pdfLoading}
                  className="py-1.5 px-2.5 rounded-lg text-[10.5px] font-bold bg-card border border-accent/30 text-accent flex items-center justify-center gap-1 cursor-pointer hover:bg-accent/10"
                >
                  <span>👁 View PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCustomerPdf}
                  disabled={pdfLoading}
                  className="py-1.5 px-2.5 rounded-lg text-[10.5px] font-bold bg-card border border-line text-textLight flex items-center justify-center gap-1 cursor-pointer hover:bg-surf"
                >
                  <span>⬇ Download PDF</span>
                </button>
              </div>
            </div>

            {/* Entries List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[300px]">
              {loadingDetails ? (
                <div className="text-center py-6 text-xs text-muted">Loading transactions...</div>
              ) : custDetails?.entries?.length > 0 ? (
                custDetails.entries.map((e) => (
                  <div
                    key={e.id}
                    className="p-2.5 rounded-xl bg-bg border border-line flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                          e.entry_type === "gave" ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                        }`}>
                          {e.entry_type === "gave" ? "Diye (उधार)" : "Liye (जमा)"}
                        </span>
                        <span className="text-[10px] text-muted font-mono">{e.entry_date}</span>
                      </div>
                      <p className="text-[11px] text-textLight mt-1 font-medium">
                        {e.items_description || "General entry"}
                      </p>
                      {e.payment_mode && (
                        <span className="text-[9px] text-muted uppercase tracking-wider block mt-0.5">
                          Mode: {e.payment_mode}
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-mono font-bold text-sm ${
                        e.entry_type === "gave" ? "text-red-400" : "text-emerald-400"
                      }`}
                    >
                      {e.entry_type === "gave" ? "+" : "-"}₹{fmt(e.amount)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-xs text-muted">
                  No ledger entries yet. Add one below!
                </div>
              )}
            </div>

            {/* Bottom 2 Big Buttons: Diye (Udhar) & Liye (Jama) */}
            <div className="p-3 border-t border-line bg-surf grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setEntryType("gave");
                  setEntryModalOpen(true);
                }}
                className="py-2.5 rounded-xl font-bold text-xs bg-red-500 text-white shadow-sm hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>- Maine Diye (उधार)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryType("received");
                  setEntryModalOpen(true);
                }}
                className="py-2.5 rounded-xl font-bold text-xs bg-emerald-500 text-white shadow-sm hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>+ Maine Liye (जमा)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. RECORD ENTRY MODAL (Maine Diye / Maine Liye) ───────────────── */}
      {entryModalOpen && (
        <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-line rounded-2xl w-full max-w-[360px] p-4 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-textLight">
                {entryType === "gave" ? "Maine Diye (उधार दें)" : "Maine Liye (रुपये प्राप्त)"}
              </h3>
              <button
                type="button"
                onClick={() => setEntryModalOpen(false)}
                className="text-muted hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddEntry} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Amount (रुपये)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-bold text-sm">₹</span>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="0.00"
                    value={entryAmount}
                    onChange={(e) => setEntryAmount(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl pl-8 pr-3 py-2 text-sm font-mono text-textLight focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Items / Bill Note (सामान / विवरण)</label>
                <input
                  type="text"
                  placeholder="e.g. 2kg chawal, tel, biscuit..."
                  value={entryDesc}
                  onChange={(e) => setEntryDesc(e.target.value)}
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-2 py-1.5 text-xs text-textLight focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-muted block mb-1">Mode</label>
                  <select
                    value={entryMode}
                    onChange={(e) => setEntryMode(e.target.value)}
                    className="w-full bg-surf border border-line rounded-xl px-2 py-1.5 text-xs text-textLight focus:outline-none focus:border-accent"
                  >
                    <option value="cash">Cash</option>
                    <option value="renopay_upi">RenoPay UPI</option>
                    <option value="bank">Bank Transfer</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={entryBusy}
                className={`w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-sm transition-all cursor-pointer ${
                  entryType === "gave" ? "bg-red-500 hover:bg-red-600" : "bg-emerald-500 hover:bg-emerald-600"
                }`}
              >
                {entryBusy ? "Saving..." : "Save Entry"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── 6. SAATHI AI VOICE MIC ENTRY MODAL ────────────────────────────── */}
      {voiceModalOpen && (
        <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-accent/40 rounded-2xl w-full max-w-[380px] p-4 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎙</span>
                <h3 className="text-sm font-bold text-textLight">Saathi AI Voice Khata Entry</h3>
              </div>
              <button
                type="button"
                onClick={() => setVoiceModalOpen(false)}
                className="text-muted hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="text-center py-3">
              <div
                className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center text-2xl mb-2 transition-all ${
                  isListening
                    ? "bg-accent text-white animate-pulse shadow-accentGlow"
                    : "bg-surf border border-line text-accent"
                }`}
              >
                🎙
              </div>
              <p className="text-xs font-bold text-textLight">
                {isListening ? "Listening... बोलिए (Speak in Hindi/English)" : "Speak or Type Khata Entry"}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                Example: <em>"Ramesh ko 200 rupaye diye 2 kilo chawal ke liye"</em>
              </p>
            </div>

            <div className="space-y-2 mt-2">
              <textarea
                rows={2}
                placeholder="Or type here e.g. Ramesh ko 200 diye..."
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                className="w-full bg-surf border border-line rounded-xl p-2.5 text-xs text-textLight focus:outline-none focus:border-accent"
              />

              <button
                type="button"
                onClick={() => handleParseVoice()}
                disabled={voiceParsing || !voiceText.trim()}
                className="w-full py-2 rounded-xl text-xs font-bold bg-surf border border-line text-textLight hover:border-accent transition-all cursor-pointer"
              >
                {voiceParsing ? "Parsing with Saathi..." : "⚡ Parse Entry"}
              </button>

              {voiceParsed && (
                <div className="bg-bg/80 border border-accent/30 rounded-xl p-3 text-xs space-y-1.5 animate-fadeIn">
                  <div className="flex justify-between">
                    <span className="text-muted">Type:</span>
                    <span className="font-bold text-accent">{voiceParsed.parsed?.entry_type_label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Customer:</span>
                    <span className="font-bold text-textLight">
                      {voiceParsed.matched_customer ? voiceParsed.matched_customer.name : voiceParsed.parsed?.customer_name || "Unknown"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Amount:</span>
                    <span className="font-mono font-bold text-emerald-400">₹{voiceParsed.parsed?.amount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Note:</span>
                    <span className="text-textLight">{voiceParsed.parsed?.items_description}</span>
                  </div>

                  {voiceParsed.matched_customer ? (
                    <button
                      type="button"
                      onClick={handleConfirmVoiceEntry}
                      disabled={voiceParsing}
                      className="w-full mt-2 py-2 rounded-xl text-xs font-bold bg-accent text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
                    >
                      Confirm &amp; Add to Khata
                    </button>
                  ) : (
                    <p className="text-[10px] text-red-400 mt-1">
                      Customer not found in Khata. Please add customer first.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 7. ADD CUSTOMER MODAL ─────────────────────────────────────────── */}
      {addCustomerOpen && (
        <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-line rounded-2xl w-full max-w-[360px] p-4 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-textLight">Onboard Customer (ग्राहक जोड़ें)</h3>
              <button
                type="button"
                onClick={() => setAddCustomerOpen(false)}
                className="text-muted hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Customer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Phone Number (10 digits) *</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs font-mono text-textLight focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">UPI ID (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210@upi or name@renopay"
                  value={newCustUpi}
                  onChange={(e) => setNewCustUpi(e.target.value)}
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs font-mono text-textLight focus:outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Email (Optional)</label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={newCustEmail}
                  onChange={(e) => setNewCustEmail(e.target.value)}
                  className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight focus:outline-none focus:border-accent"
                />
              </div>

              <button
                type="submit"
                disabled={custBusy}
                className="w-full py-2.5 rounded-xl font-bold text-xs bg-accent text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
              >
                {custBusy ? "Saving..." : "Add to Khatabook"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── 8. ACTIVATE VOICE BOX MODAL (₹200) ────────────────────────────── */}
      {activateModalOpen && (
        <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-accent/40 rounded-2xl w-full max-w-[360px] p-4 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-textLight">Activate Voice Box</h3>
              <button
                type="button"
                onClick={() => setActivateModalOpen(false)}
                className="text-muted hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-surf/80 border border-line rounded-xl p-3 mb-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Subscription Fee:</span>
                <span className="font-bold text-accent font-mono">₹200 (6 Months)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Settlement Destination:</span>
                <span className="font-bold text-accent font-mono">{settlementVpa}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[10px] uppercase font-bold text-muted block mb-1.5">
                Choose Announcement Language (भाषा चुनें)
              </label>
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight focus:outline-none focus:border-accent font-medium cursor-pointer"
              >
                {languagesList.map((l) => (
                  <option key={l.code} value={l.code} className="bg-card text-textLight py-1">
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleActivateVb}
              disabled={vbBusy}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-accent text-white shadow-accentGlow hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              {vbBusy ? "Processing Payment..." : "Pay ₹200 & Activate"}
            </button>
          </div>
        </div>
      )}

      {/* ── 9. CHANGE VOICE LANGUAGE MODAL (₹100) ─────────────────────────── */}
      {changeLangModalOpen && (
        <div className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-line rounded-2xl w-full max-w-[360px] p-4 animate-scaleUp shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-sm font-bold text-textLight">Switch Regional Voice</h3>
              <button
                type="button"
                onClick={() => setChangeLangModalOpen(false)}
                className="text-muted hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-surf/80 border border-line rounded-xl p-3 mb-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Language Switch Fee:</span>
                <span className="font-bold text-accent font-mono">₹100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Settlement Account:</span>
                <span className="font-bold text-accent font-mono">{settlementVpa}</span>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-[10px] uppercase font-bold text-muted block mb-1.5">
                Select New Language
              </label>
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="w-full bg-surf border border-line rounded-xl px-3 py-2 text-xs text-textLight focus:outline-none focus:border-accent font-medium cursor-pointer"
              >
                {languagesList.map((l) => (
                  <option key={l.code} value={l.code} className="bg-card text-textLight py-1">
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleChangeLang}
              disabled={vbBusy}
              className="w-full py-2.5 rounded-xl font-bold text-xs bg-accent text-white shadow-sm hover:brightness-110 active:scale-95 transition-all cursor-pointer"
            >
              {vbBusy ? "Processing..." : "Pay ₹100 & Change Language"}
            </button>
          </div>
        </div>
      )}

      {/* ── 10. PDF PREVIEW MODAL ─────────────────────────────────────────── */}
      <PdfPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        pdfBlob={previewBlob}
        title={previewTitle}
        filename={previewFilename}
        isLoading={pdfLoading}
      />
    </div>
  );
}
