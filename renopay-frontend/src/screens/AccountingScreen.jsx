import { useState, useEffect } from "react";
import { AccountingAPI, AnalyticsAPI } from "../lib/api";
import { Card, Btn, Badge } from "../components/ui";
import { fmt } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { PdfPreviewModal } from "../components/PdfPreviewModal";
import { DatePickerInput } from "../components/DatePickerInput";
import { downloadOrSharePdf } from "../lib/download";
import { ShopkeeperHub } from "../components/ShopkeeperHub";

function formatDateStr(d) {
  return d.toISOString().split("T")[0];
}

function SectionDateFilterBar({
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
  onViewPdf,
  onDownloadPdf,
  viewLabel = "View PDF",
  downloadLabel = "Download PDF",
  singleDate = false,
  singleDateLabel = "As-of Date",
  title = "Filter by Date Range",
}) {
  return (
    <div className="bg-surf/80 border border-line rounded-xl p-3 mb-3.5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-textLight flex items-center gap-1.5">
          <span>📅</span> {title}
        </span>
        <span className="text-[10px] text-muted font-mono">
          {singleDate
            ? (from || "Latest Position")
            : (from && to ? `${from} → ${to}` : (from ? `From ${from}` : (to ? `Up to ${to}` : "All Records")))}
        </span>
      </div>

      <div className="flex items-end gap-2">
        {singleDate ? (
          <div className="flex-1">
            <label className="block text-[9px] text-muted font-bold mb-1 uppercase tracking-wider">
              {singleDateLabel}
            </label>
            <DatePickerInput
              value={from || ""}
              onChange={(e) => onFromChange(e.target.value)}
              title={singleDateLabel}
            />
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[9px] text-muted font-bold mb-1 uppercase tracking-wider">
                From Date
              </label>
              <DatePickerInput
                value={from || ""}
                onChange={(e) => onFromChange(e.target.value)}
                title="From Date"
              />
            </div>
            <div>
              <label className="block text-[9px] text-muted font-bold mb-1 uppercase tracking-wider">
                To Date
              </label>
              <DatePickerInput
                value={to || ""}
                onChange={(e) => onToChange(e.target.value)}
                title="To Date"
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onApply}
          title="Apply Date Filter"
          className="h-[34px] px-3.5 rounded-lg bg-accent text-white flex items-center justify-center font-bold text-sm hover:brightness-110 shadow-accentGlow active:scale-95 transition-all shrink-0 cursor-pointer"
        >
          ✓
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2.5 border-t border-line/60">
        <button
          type="button"
          onClick={onViewPdf}
          className="py-2 px-3 rounded-lg text-[11px] font-bold bg-card border border-accent/40 text-accent hover:bg-accent/10 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <span>👁</span>
          <span>{viewLabel}</span>
        </button>
        <button
          type="button"
          onClick={onDownloadPdf}
          className="py-2 px-3 rounded-lg text-[11px] font-bold bg-accent text-white hover:brightness-110 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <span>⬇</span>
          <span>{downloadLabel}</span>
        </button>
      </div>
    </div>
  );
}

export function AccountingScreen({ onBack }) {
  const { profile } = useAuth();
  const [merchantMode, setMerchantMode] = useState("shopkeeper"); // "shopkeeper" | "accounting"

  const [devMode, setDevMode] = useState(false);
  const [activeTab, setActiveTab] = useState("journal");
  const [fullPackOpen, setFullPackOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Date Range state for Full Accounting Pack PDF
  const [datePreset, setDatePreset] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Individual Tab Date Filter states
  const [journalFrom, setJournalFrom] = useState("");
  const [journalTo, setJournalTo] = useState("");

  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");

  const [payeeFrom, setPayeeFrom] = useState("");
  const [payeeTo, setPayeeTo] = useState("");

  const [trialAsOf, setTrialAsOf] = useState("");

  const [pnlFrom, setPnlFrom] = useState("");
  const [pnlTo, setPnlTo] = useState("");

  const [bsAsOf, setBsAsOf] = useState("");

  const [cfFrom, setCfFrom] = useState("");
  const [cfTo, setCfTo] = useState("");

  // PDF Preview Modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("Accounting Report");
  const [previewFilename, setPreviewFilename] = useState("RenoPay_Accounting_Pack.pdf");

  const [journal, setJournal] = useState([]);
  const [coas, setCoas] = useState([]);
  const [selectedCoa, setSelectedCoa] = useState(null);
  const [generalLedger, setGeneralLedger] = useState(null);
  const [payeeLedger, setPayeeLedger] = useState(null);
  const [selectedPayee, setSelectedPayee] = useState("");
  const [trialBalance, setTrialBalance] = useState(null);
  const [pnlData, setPnLData] = useState(null);
  const [balanceSheetData, setBalanceSheetData] = useState(null);
  const [cashFlowData, setCashFlowData] = useState(null);

  // Phase 2 state
  const [gstReport, setGstReport] = useState(null);
  const [runningPayroll, setRunningPayroll] = useState(false);
  const [payrollSuccess, setPayrollSuccess] = useState(false);

  // Phase 3 state
  const [invoices, setInvoices] = useState([]);
  const [newInvoiceCustomer, setNewInvoiceCustomer] = useState("Acme Corp");
  const [newInvoiceAmount, setNewInvoiceAmount] = useState(5000);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [payingInvoice, setPayingInvoice] = useState(null);

  const applyDatePreset = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === "all") {
      setFromDate("");
      setToDate("");
    } else if (preset === "this_month") {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(formatDateStr(first));
      setToDate(formatDateStr(now));
    } else if (preset === "last_30") {
      const past = new Date();
      past.setDate(now.getDate() - 30);
      setFromDate(formatDateStr(past));
      setToDate(formatDateStr(now));
    } else if (preset === "last_month") {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(formatDateStr(first));
      setToDate(formatDateStr(last));
    }
  };

  const fetchJournal = async (f, t) => {
    try {
      const data = await AccountingAPI.getJournal(f || undefined, t || undefined);
      setJournal(data);
    } catch (e) {
      console.error("fetchJournal error:", e);
    }
  };

  const fetchGeneralLedger = async (coaId, f, t) => {
    if (!coaId) return;
    try {
      const data = await AccountingAPI.getLedger(coaId, f || undefined, t || undefined);
      setGeneralLedger(data);
    } catch (e) {
      console.error("fetchGeneralLedger error:", e);
    }
  };

  const fetchPayeeLedger = async (vpa, f, t) => {
    if (!vpa) return;
    try {
      const data = await AccountingAPI.getPayeeLedger(vpa, f || undefined, t || undefined);
      setPayeeLedger(data);
    } catch (e) {
      console.error("fetchPayeeLedger error:", e);
    }
  };

  const fetchTrialBalance = async (asOf) => {
    try {
      const data = await AccountingAPI.getTrialBalance(asOf || undefined);
      setTrialBalance(data);
    } catch (e) {
      console.error("fetchTrialBalance error:", e);
    }
  };

  const fetchPnL = async (f, t) => {
    try {
      const data = await AccountingAPI.getPnL(f || undefined, t || undefined);
      setPnLData(data);
    } catch (e) {
      console.error("fetchPnL error:", e);
    }
  };

  const fetchBalanceSheet = async (asOf) => {
    try {
      const data = await AccountingAPI.getBalanceSheet(asOf || undefined);
      setBalanceSheetData(data);
    } catch (e) {
      console.error("fetchBalanceSheet error:", e);
    }
  };

  const fetchCashFlow = async (f, t) => {
    try {
      const data = await AccountingAPI.getCashFlow(f || undefined, t || undefined);
      setCashFlowData(data);
    } catch (e) {
      console.error("fetchCashFlow error:", e);
    }
  };

  const fetchCompliance = async (f, t) => {
    try {
      const data = await AccountingAPI.getGstReport(f || undefined, t || undefined);
      setGstReport(data);
    } catch (e) {
      console.error("fetchCompliance error:", e);
    }
  };

  useEffect(() => {
    if (devMode) {
      if (activeTab === "journal") {
        fetchJournal(journalFrom, journalTo);
      } else if (activeTab === "general") {
        AccountingAPI.getChartOfAccounts()
          .then((coaData) => {
            setCoas(coaData);
            if (coaData.length > 0) {
              const currentId = selectedCoa || coaData[0].id;
              if (!selectedCoa) setSelectedCoa(currentId);
              fetchGeneralLedger(currentId, ledgerFrom, ledgerTo);
            }
          })
          .catch(console.error);
      } else if (activeTab === "payee" && selectedPayee) {
        fetchPayeeLedger(selectedPayee, payeeFrom, payeeTo);
      } else if (activeTab === "trial") {
        fetchTrialBalance(trialAsOf);
      } else if (activeTab === "pnl") {
        fetchPnL(pnlFrom, pnlTo);
      } else if (activeTab === "balance_sheet") {
        fetchBalanceSheet(bsAsOf);
      } else if (activeTab === "cash_flow") {
        fetchCashFlow(cfFrom, cfTo);
      } else if (activeTab === "compliance") {
        fetchCompliance(complianceFrom, complianceTo);
      } else if (activeTab === "invoices") {
        AccountingAPI.getInvoices().then(setInvoices).catch(console.error);
      }
    }
  }, [devMode, activeTab]);

  useEffect(() => {
    if (activeTab === "general" && selectedCoa) {
      fetchGeneralLedger(selectedCoa, ledgerFrom, ledgerTo);
    }
  }, [selectedCoa]);

  useEffect(() => {
    if (activeTab === "payee" && selectedPayee) {
      fetchPayeeLedger(selectedPayee, payeeFrom, payeeTo);
    }
  }, [selectedPayee]);

  const toggleDevMode = async () => {
    const next = !devMode;
    setDevMode(next);
    try {
      await AccountingAPI.toggleDevMode(next);
    } catch (e) {
      setDevMode(!next);
    }
  };

  // Full Accounting Pack Download
  const handleDownload = async () => {
    setError(""); setSuccess(false); setDownloading(true);
    try {
      const blob = await AnalyticsAPI.downloadReport({
        type: "full_accounting_pack",
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      const filename = `RenoPay_Accounting_Pack${fromDate ? `_${fromDate}` : ""}${toDate ? `_to_${toDate}` : ""}.pdf`;
      await downloadOrSharePdf(blob, filename);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (e) {
      console.error("Download accounting report failed:", e);
      let msg = "Failed to generate report. Try again.";
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const json = JSON.parse(text);
          if (json?.detail) msg = json.detail;
          else if (text) msg = text.slice(0, 150);
        } catch (_) { }
      } else if (e?.response?.data?.detail) {
        msg = e.response.data.detail;
      } else if (e?.message) {
        msg = e.message;
      }
      setError(msg);
    } finally {
      setDownloading(false);
    }
  };

  // Full Accounting Pack View
  const handleViewPdf = async () => {
    setError(""); setSuccess(false); setViewing(true);
    const filename = `RenoPay_Accounting_Pack${fromDate ? `_${fromDate}` : ""}${toDate ? `_to_${toDate}` : ""}.pdf`;
    setPreviewFilename(filename);
    setPreviewTitle("RenoPay Accounting Pack");
    setPreviewBlob(null);
    setPreviewLoading(true);
    setPreviewModalOpen(true);

    try {
      const blob = await AnalyticsAPI.downloadReport({
        type: "full_accounting_pack",
        from: fromDate || undefined,
        to: toDate || undefined,
      });
      setPreviewBlob(blob);
    } catch (e) {
      console.error("View accounting report failed:", e);
      let msg = "Failed to generate report for viewing. Try again.";
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const json = JSON.parse(text);
          if (json?.detail) msg = json.detail;
          else if (text) msg = text.slice(0, 150);
        } catch (_) { }
      } else if (e?.response?.data?.detail) {
        msg = e.response.data.detail;
      } else if (e?.message) {
        msg = e.message;
      }
      setError(msg);
      setPreviewModalOpen(false);
    } finally {
      setPreviewLoading(false);
      setViewing(false);
    }
  };

  // Section PDF View (Journal, General Ledger, Payee Ledger, Trial Balance, Balance Sheet)
  const handleViewSectionPdf = async (type, from, to, title, filename) => {
    setError("");
    setPreviewFilename(filename || `RenoPay_${type}.pdf`);
    setPreviewTitle(title || "Report Preview");
    setPreviewBlob(null);
    setPreviewLoading(true);
    setPreviewModalOpen(true);

    try {
      const blob = await AnalyticsAPI.downloadReport({
        type,
        from: from || undefined,
        to: to || undefined,
      });
      setPreviewBlob(blob);
    } catch (e) {
      console.error("View report failed:", e);
      let msg = "Failed to load report. Try again.";
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const json = JSON.parse(text);
          if (json?.detail) msg = json.detail;
          else if (text) msg = text.slice(0, 150);
        } catch (_) { }
      } else if (e?.response?.data?.detail) {
        msg = e.response.data.detail;
      } else if (e?.message) {
        msg = e.message;
      }
      setError(msg);
      setPreviewModalOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Section PDF Download
  const handleDownloadSectionPdf = async (type, from, to, filename) => {
    setError("");
    try {
      const blob = await AnalyticsAPI.downloadReport({
        type,
        from: from || undefined,
        to: to || undefined,
      });
      const fname = filename || `RenoPay_${type}.pdf`;
      await downloadOrSharePdf(blob, fname);
    } catch (e) {
      console.error("Download report failed:", e);
      let msg = "Failed to download report. Try again.";
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const json = JSON.parse(text);
          if (json?.detail) msg = json.detail;
          else if (text) msg = text.slice(0, 150);
        } catch (_) { }
      } else if (e?.response?.data?.detail) {
        msg = e.response.data.detail;
      } else if (e?.message) {
        msg = e.message;
      }
      setError(msg);
    }
  };

  const runPayroll = async () => {
    setRunningPayroll(true);
    setPayrollSuccess(false);
    try {
      const employees = [
        { name: "John Doe", salary: 500 },
        { name: "Jane Smith", salary: 600 }
      ];
      await AccountingAPI.generatePayroll(employees);
      setPayrollSuccess(true);
      setTimeout(() => setPayrollSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setRunningPayroll(false);
    }
  };

  const handleCreateInvoice = async () => {
    setCreatingInvoice(true);
    try {
      await AccountingAPI.createInvoice(newInvoiceCustomer, newInvoiceAmount);
      const data = await AccountingAPI.getInvoices();
      setInvoices(data);
    } catch (e) {
      console.error(e);
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handlePayInvoice = async (id) => {
    setPayingInvoice(id);
    try {
      await AccountingAPI.payInvoice(id);
      const data = await AccountingAPI.getInvoices();
      setInvoices(data);
    } catch (e) {
      console.error(e);
    } finally {
      setPayingInvoice(null);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-[100px]">
      {/* Header */}
      <div className="pt-[50px] pb-3 px-[22px] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="btn bg-card border border-line text-text rounded-xl px-3.5 py-2.5 text-base" onClick={onBack}>←</button>
          <h2 className="text-[22px] font-extrabold text-textLight">Merchant Hub</h2>
        </div>
        <Badge color="#FF6A1A" size={10}>
          {merchantMode === "shopkeeper" ? "Shopkeeper Mode" : "Accounting Mode"}
        </Badge>
      </div>

      {/* Dual Mode Switcher Bar */}
      <div className="px-[22px] mb-3">
        <div className="bg-surf p-1 rounded-2xl border border-line flex gap-1 shadow-sm">
          <button
            type="button"
            onClick={() => setMerchantMode("shopkeeper")}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              merchantMode === "shopkeeper"
                ? "bg-accent text-white shadow-accentGlow"
                : "text-muted hover:text-textLight hover:bg-card/60"
            }`}
          >
            <span>🏪</span>
            <span>Shopkeeper Mode (दुकानदार)</span>
          </button>
          <button
            type="button"
            onClick={() => setMerchantMode("accounting")}
            className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              merchantMode === "accounting"
                ? "bg-accent text-white shadow-accentGlow"
                : "text-muted hover:text-textLight hover:bg-card/60"
            }`}
          >
            <span>📊</span>
            <span>Accounting (Enterprise)</span>
          </button>
        </div>
      </div>

      {merchantMode === "shopkeeper" ? (
        <div className="px-[22px]">
          <ShopkeeperHub />
        </div>
      ) : (
        <div className="px-[22px] flex flex-col gap-4">

        {/* Dev Mode Toggle Card */}
        <Card className="p-4 flex items-center justify-between dark:bg-gradient-to-r dark:from-[#192926] dark:to-[#2d4a42] bg-surf border border-line">
          <div>
            <h3 className="text-textLight font-bold text-[16px] mb-1">Developer Mode</h3>
            <p className="text-muted text-[11px]">Enable raw double-entry ledger access</p>
          </div>
          <button
            onClick={toggleDevMode}
            className={`w-12 h-6 rounded-full flex items-center transition-colors px-1 ${devMode ? 'bg-accent' : 'bg-line'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${devMode ? 'translate-x-6' : ''}`} />
          </button>
        </Card>

        {!devMode ? (
          <Card className="p-5 text-center mt-4 border-dashed border-2">
            <div className="text-4xl mb-3">🛠</div>
            <h3 className="text-textLight font-bold text-[18px] mb-2">Unlock Accounting Engine</h3>
            <p className="text-muted text-[12px] leading-relaxed">
              Enable Developer Mode to view raw double-entry journal postings, general ledgers, T-accounts, and download full compliance packs.
            </p>
          </Card>
        ) : (
          <>
            {/* Collapsible Full Accounting Pack Option */}
            <Card className="p-3.5 border-line/80 shadow-md">
              <div
                onClick={() => setFullPackOpen(!fullPackOpen)}
                className="flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center text-accent text-lg font-bold shrink-0">
                    📑
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-[13px] font-bold text-textLight">Full Accounting Report</h4>
                      <Badge variant="gold" className="text-[9px] py-0 px-1.5">All-in-One Pack</Badge>
                    </div>
                    <p className="text-muted text-[11px] mt-0.5">
                      Journal, Ledgers, Trial Balance, P&amp;L, Balance Sheet &amp; Cash Flow in one bundle
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-accent font-bold text-[12px] bg-accent/10 px-2.5 py-1.5 rounded-lg shrink-0">
                  <span>{fullPackOpen ? "Hide" : "Open"}</span>
                  <span className={`transform transition-transform text-xs ${fullPackOpen ? "rotate-180" : ""}`}>▾</span>
                </div>
              </div>

              {fullPackOpen && (
                <div className="mt-3.5 pt-3.5 border-t border-line/60 flex flex-col gap-3">
                  {/* Quick Presets */}
                  <div>
                    <label className="block text-[10px] text-muted font-bold mb-1.5 uppercase tracking-wider">
                      Report Period Preset
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[
                        { id: "all", label: "All Time" },
                        { id: "this_month", label: "This Month" },
                        { id: "last_30", label: "Last 30 Days" },
                        { id: "last_month", label: "Last Month" },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyDatePreset(p.id)}
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer truncate ${datePreset === p.id
                            ? "bg-accent text-white border-accent shadow-accentGlow"
                            : "bg-surf text-text border-line hover:border-accent/50"
                            }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Date Range with Calendar Pickers */}
                  <div className="bg-surf/70 p-2.5 rounded-xl border border-line/60">
                    <div className="text-[10px] text-muted font-bold uppercase tracking-wider mb-2">
                      Custom Date Range (IST)
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[9px] text-muted font-bold mb-1 uppercase tracking-wider">
                          From Date
                        </label>
                        <DatePickerInput
                          value={fromDate}
                          onChange={(e) => {
                            setFromDate(e.target.value);
                            setDatePreset("custom");
                          }}
                          title="From Date"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] text-muted font-bold mb-1 uppercase tracking-wider">
                          To Date
                        </label>
                        <DatePickerInput
                          value={toDate}
                          onChange={(e) => {
                            setToDate(e.target.value);
                            setDatePreset("custom");
                          }}
                          title="To Date"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Feedback Messages */}
                  {error && (
                    <div className="text-[11px] text-danger bg-danger/10 border border-danger/30 rounded-lg p-2 flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>{error}</span>
                    </div>
                  )}

                  {success && (
                    <div className="text-[11px] text-teal bg-teal/10 border border-teal/30 rounded-lg p-2 flex items-center gap-1.5">
                      <span>✓</span>
                      <span>Report generated &amp; downloaded successfully!</span>
                    </div>
                  )}

                  {/* Action Buttons: View and Download */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={downloading || viewing}
                      onClick={handleViewPdf}
                      className="py-2.5 px-3 rounded-xl text-[12px] font-bold bg-card border border-accent/40 text-accent hover:bg-accent/10 active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {viewing ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                          <span>Loading…</span>
                        </>
                      ) : (
                        <>
                          <span>👁</span>
                          <span>View Full PDF</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={downloading || viewing}
                      onClick={handleDownload}
                      className="py-2.5 px-3 rounded-xl text-[12px] font-bold bg-accent text-white hover:brightness-110 shadow-accentGlow active:scale-98 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {downloading ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Downloading…</span>
                        </>
                      ) : (
                        <>
                          <span>⬇</span>
                          <span>Download Pack</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {/* Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1 mt-2 no-scrollbar">
              {["journal", "general", "payee", "trial", "pnl", "balance_sheet", "cash_flow", "compliance", "invoices"].map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`whitespace-nowrap px-4 py-2 rounded-xl text-[12px] font-semibold transition-colors cursor-pointer
                    ${activeTab === t ? "bg-accent text-white shadow-accentGlow" : "bg-card text-muted border border-line"}`}
                >
                  {t === "journal" && "Journal"}
                  {t === "general" && "General Ledger"}
                  {t === "payee" && "Payee Ledger"}
                  {t === "trial" && "Trial Balance"}
                  {t === "pnl" && "P&L Statement"}
                  {t === "balance_sheet" && "Balance Sheet"}
                  {t === "cash_flow" && "Cash Flow"}
                  {t === "compliance" && "Compliance"}
                  {t === "invoices" && "Invoices"}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === "journal" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Journal Entries</h3>
                  <Badge variant="teal">Double Entry</Badge>
                </div>

                <SectionDateFilterBar
                  from={journalFrom}
                  to={journalTo}
                  onFromChange={setJournalFrom}
                  onToChange={setJournalTo}
                  onApply={() => fetchJournal(journalFrom, journalTo)}
                  onViewPdf={() => handleViewSectionPdf(
                    "journal",
                    journalFrom,
                    journalTo,
                    "Journal Entries Report",
                    `Journal_Entries_${journalFrom || "all"}_to_${journalTo || "now"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "journal",
                    journalFrom,
                    journalTo,
                    `Journal_Entries_${journalFrom || "all"}_to_${journalTo || "now"}.pdf`
                  )}
                  viewLabel="View Journal PDF"
                  downloadLabel="Download PDF"
                  title="Journal Date Filter"
                />

                <div className="flex flex-col gap-4">
                  {journal.map((j) => (
                    <div key={j.entry_no} className="border border-line rounded-lg overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-mono font-bold text-accent">{j.entry_no}</span>
                        <span className="text-muted">{j.date}</span>
                      </div>
                      <div className="p-3 bg-surf">
                        <p className="text-muted mb-2">{j.narration}</p>
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-muted border-b border-line">
                              <th className="pb-1 font-semibold">Account</th>
                              <th className="pb-1 font-semibold text-right">Debit</th>
                              <th className="pb-1 font-semibold text-right">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {j.lines.map((l, i) => (
                              <tr key={i} className="border-b border-line/50 last:border-none">
                                <td className="py-1.5">{l.account_name}</td>
                                <td className="py-1.5 text-right font-mono text-danger font-semibold">{l.debit ? l.debit : ''}</td>
                                <td className="py-1.5 text-right font-mono text-teal font-semibold">{l.credit ? l.credit : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  {journal.length === 0 && <p className="text-muted text-center text-xs py-4">No entries found for this range.</p>}
                </div>
              </Card>
            )}

            {activeTab === "general" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">General Ledger</h3>
                  <Badge variant="teal">T-Account</Badge>
                </div>

                <select
                  className="w-full bg-surf border border-line rounded-xl p-3 text-sm text-text mb-3 outline-none focus:border-accent"
                  value={selectedCoa || ""}
                  onChange={(e) => setSelectedCoa(e.target.value)}
                >
                  {coas.map(c => (
                    <option key={c.id} value={c.id}>{c.code} - {c.name}</option>
                  ))}
                </select>

                <SectionDateFilterBar
                  from={ledgerFrom}
                  to={ledgerTo}
                  onFromChange={setLedgerFrom}
                  onToChange={setLedgerTo}
                  onApply={() => fetchGeneralLedger(selectedCoa, ledgerFrom, ledgerTo)}
                  onViewPdf={() => handleViewSectionPdf(
                    "general_ledger",
                    ledgerFrom,
                    ledgerTo,
                    "General Ledger Report",
                    `General_Ledger_${ledgerFrom || "all"}_to_${ledgerTo || "now"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "general_ledger",
                    ledgerFrom,
                    ledgerTo,
                    `General_Ledger_${ledgerFrom || "all"}_to_${ledgerTo || "now"}.pdf`
                  )}
                  viewLabel="View Ledger PDF"
                  downloadLabel="Download PDF"
                  title="Ledger Date Filter"
                />

                {generalLedger && (
                  <div className="overflow-x-auto text-[11px]">
                    <table className="w-full text-left whitespace-nowrap">
                      <thead>
                        <tr className="text-muted border-b border-line">
                          <th className="pb-2 font-semibold">Date</th>
                          <th className="pb-2 font-semibold">Narration</th>
                          <th className="pb-2 font-semibold text-right">Debit</th>
                          <th className="pb-2 font-semibold text-right">Credit</th>
                          <th className="pb-2 font-semibold text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generalLedger.lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/50 last:border-none">
                            <td className="py-2 text-muted">{l.date}</td>
                            <td className="py-2 max-w-[120px] truncate pr-2">{l.narration}</td>
                            <td className="py-2 text-right font-mono text-danger">{l.debit ? l.debit : ''}</td>
                            <td className="py-2 text-right font-mono text-teal">{l.credit ? l.credit : ''}</td>
                            <td className="py-2 text-right font-mono font-bold text-text">{l.balance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 pt-3 border-t border-line flex justify-between font-bold text-sm">
                      <span>Closing Balance</span>
                      <span className="font-mono">{generalLedger.closing_balance}</span>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {activeTab === "payee" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Payee Ledger</h3>
                  <Badge variant="teal">VPA Scoped</Badge>
                </div>

                <input
                  type="text"
                  placeholder="Enter Payee VPA (e.g. food@renopay)"
                  className="w-full bg-surf border border-line rounded-xl p-3 text-sm text-text mb-3 outline-none focus:border-accent"
                  value={selectedPayee}
                  onChange={(e) => setSelectedPayee(e.target.value)}
                />

                <SectionDateFilterBar
                  from={payeeFrom}
                  to={payeeTo}
                  onFromChange={setPayeeFrom}
                  onToChange={setPayeeTo}
                  onApply={() => fetchPayeeLedger(selectedPayee, payeeFrom, payeeTo)}
                  onViewPdf={() => handleViewSectionPdf(
                    "payee_ledger",
                    payeeFrom,
                    payeeTo,
                    "Payee Ledger Report",
                    `Payee_Ledger_${payeeFrom || "all"}_to_${payeeTo || "now"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "payee_ledger",
                    payeeFrom,
                    payeeTo,
                    `Payee_Ledger_${payeeFrom || "all"}_to_${payeeTo || "now"}.pdf`
                  )}
                  viewLabel="View Payee PDF"
                  downloadLabel="Download PDF"
                  title="Payee Date Filter"
                />

                {payeeLedger && payeeLedger.lines.length > 0 ? (
                  <div className="overflow-x-auto text-[11px]">
                    <table className="w-full text-left whitespace-nowrap">
                      <thead>
                        <tr className="text-muted border-b border-line">
                          <th className="pb-2 font-semibold">Date</th>
                          <th className="pb-2 font-semibold">Account</th>
                          <th className="pb-2 font-semibold text-right">Debit</th>
                          <th className="pb-2 font-semibold text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payeeLedger.lines.map((l, i) => (
                          <tr key={i} className="border-b border-line/50">
                            <td className="py-2 text-muted">{l.date}</td>
                            <td className="py-2">{l.account_name}</td>
                            <td className="py-2 text-right font-mono text-danger">{l.debit ? l.debit : ''}</td>
                            <td className="py-2 text-right font-mono text-teal">{l.credit ? l.credit : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-3 pt-3 border-t border-line flex justify-between font-bold text-[12px]">
                      <span>Totals</span>
                      <div className="flex gap-4">
                        <span className="font-mono text-danger">{payeeLedger.total_debit}</span>
                        <span className="font-mono text-teal">{payeeLedger.total_credit}</span>
                      </div>
                    </div>
                  </div>
                ) : selectedPayee && (
                  <p className="text-muted text-center text-xs py-4">No transactions found for this payee in selected range.</p>
                )}
              </Card>
            )}

            {activeTab === "trial" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Trial Balance</h3>
                  <Badge variant="teal">Audit Verification</Badge>
                </div>

                <SectionDateFilterBar
                  singleDate={true}
                  singleDateLabel="As-of Date"
                  from={trialAsOf}
                  onFromChange={setTrialAsOf}
                  onApply={() => fetchTrialBalance(trialAsOf)}
                  onViewPdf={() => handleViewSectionPdf(
                    "trial_balance",
                    undefined,
                    trialAsOf,
                    "Trial Balance Report",
                    `Trial_Balance_${trialAsOf || "latest"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "trial_balance",
                    undefined,
                    trialAsOf,
                    `Trial_Balance_${trialAsOf || "latest"}.pdf`
                  )}
                  viewLabel="View Trial Balance PDF"
                  downloadLabel="Download PDF"
                  title="Trial Balance As-Of Filter"
                />

                {trialBalance && (
                  <>
                    {!trialBalance.balanced && (
                      <div className="text-danger bg-danger/10 border border-danger p-2 rounded mb-3 text-xs font-bold text-center">
                        ⚠️ BALANCE MISMATCH
                      </div>
                    )}
                    <div className="overflow-x-auto text-[11px] mt-3">
                      <table className="w-full text-left whitespace-nowrap">
                        <thead>
                          <tr className="text-muted border-b border-line">
                            <th className="pb-2 font-semibold">Code</th>
                            <th className="pb-2 font-semibold">Account Name</th>
                            <th className="pb-2 font-semibold text-right">Debit</th>
                            <th className="pb-2 font-semibold text-right">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(trialBalance.rows || []).map((r, i) => (
                            <tr key={i} className="border-b border-line/50">
                              <td className="py-2 font-mono text-muted">{r.code}</td>
                              <td className="py-2">{r.name}</td>
                              <td className="py-2 text-right font-mono text-danger">{r.debit ? r.debit : ''}</td>
                              <td className="py-2 text-right font-mono text-teal">{r.credit ? r.credit : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="mt-3 pt-3 border-t border-line flex justify-between font-bold text-[12px]">
                        <span>Totals</span>
                        <div className="flex gap-4">
                          <span className="font-mono text-danger">{trialBalance.total_debit}</span>
                          <span className="font-mono text-teal">{trialBalance.total_credit}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </Card>
            )}

            {/* P&L Statement Tab */}
            {activeTab === "pnl" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Profit &amp; Loss Statement</h3>
                    <p className="text-[10px] text-muted">Income Statement &bull; Total Income − Total Expenses = Net Profit/Loss</p>
                  </div>
                  <Badge variant="teal">Double Entry</Badge>
                </div>

                <SectionDateFilterBar
                  from={pnlFrom}
                  to={pnlTo}
                  onFromChange={setPnlFrom}
                  onToChange={setPnlTo}
                  onApply={() => fetchPnL(pnlFrom, pnlTo)}
                  onViewPdf={() => handleViewSectionPdf(
                    "profit_loss",
                    pnlFrom,
                    pnlTo,
                    "Profit & Loss Statement",
                    `Profit_Loss_${pnlFrom || "all"}_to_${pnlTo || "now"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "profit_loss",
                    pnlFrom,
                    pnlTo,
                    `Profit_Loss_${pnlFrom || "all"}_to_${pnlTo || "now"}.pdf`
                  )}
                  viewLabel="View P&amp;L PDF"
                  downloadLabel="Download PDF"
                  title="P&amp;L Date Range Filter"
                />

                {pnlData && (
                  <div className="flex flex-col gap-4 mt-3">
                    {/* Metric Cards */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-card border border-line rounded-xl p-2.5 flex flex-col">
                        <span className="text-[10px] text-muted font-medium">Total Income</span>
                        <span className="text-[13px] font-bold font-mono text-teal mt-0.5">
                          + ₹{pnlData.income.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-card border border-line rounded-xl p-2.5 flex flex-col">
                        <span className="text-[10px] text-muted font-medium">Total Expenses</span>
                        <span className="text-[13px] font-bold font-mono text-danger mt-0.5">
                          - ₹{pnlData.expenses.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className={`rounded-xl p-2.5 flex flex-col border ${pnlData.is_profit ? "bg-teal/10 border-teal/30" : "bg-danger/10 border-danger/30"}`}>
                        <span className="text-[10px] text-muted font-medium">Net {pnlData.is_profit ? "Profit" : "Loss"}</span>
                        <span className={`text-[13px] font-bold font-mono mt-0.5 ${pnlData.is_profit ? "text-teal" : "text-danger"}`}>
                          {pnlData.is_profit ? "+" : "-"} ₹{Math.abs(pnlData.net_profit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* Income Breakdown */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">Income Accounts</span>
                        <span className="font-mono text-teal font-bold">+ ₹{pnlData.income.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted border-b border-line bg-surf/50">
                            <th className="px-3 py-1.5 font-semibold">Code</th>
                            <th className="py-1.5 font-semibold">Category / Account</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pnlData.income.rows.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-center text-muted text-xs">No income recorded in this period</td>
                            </tr>
                          ) : (
                            pnlData.income.rows.map((r, i) => (
                              <tr key={i} className="border-b border-line/50 last:border-none">
                                <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                                <td className="py-2 text-textLight font-medium">{r.name}</td>
                                <td className="px-3 py-2 text-right font-mono text-teal font-bold">
                                  + ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Expense Breakdown */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">Expense Accounts</span>
                        <span className="font-mono text-danger font-bold">- ₹{pnlData.expenses.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted border-b border-line bg-surf/50">
                            <th className="px-3 py-1.5 font-semibold">Code</th>
                            <th className="py-1.5 font-semibold">Category / Account</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pnlData.expenses.rows.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-center text-muted text-xs">No expenses recorded in this period</td>
                            </tr>
                          ) : (
                            pnlData.expenses.rows.map((r, i) => (
                              <tr key={i} className="border-b border-line/50 last:border-none">
                                <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                                <td className="py-2 text-textLight font-medium">{r.name}</td>
                                <td className="px-3 py-2 text-right font-mono text-danger font-bold">
                                  - ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Net Profit Summary Row */}
                    <div className="p-3 rounded-xl bg-card border border-line flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-textLight">Net {pnlData.is_profit ? "Profit" : "Loss"} Result</div>
                        <div className="text-[10px] text-muted">Feeds Retained Earnings on the Balance Sheet</div>
                      </div>
                      <span className={`text-[14px] font-bold font-mono ${pnlData.is_profit ? "text-teal" : "text-danger"}`}>
                        {pnlData.is_profit ? "+" : "-"} ₹{Math.abs(pnlData.net_profit).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Balance Sheet Tab */}
            {activeTab === "balance_sheet" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Balance Sheet</h3>
                    <p className="text-[10px] text-muted">Statement of Financial Position &bull; Assets = Liabilities + Equity</p>
                  </div>
                  <Badge variant={balanceSheetData?.balanced ? "teal" : "danger"}>
                    {balanceSheetData?.balanced ? "Balanced" : "Review"}
                  </Badge>
                </div>

                <SectionDateFilterBar
                  singleDate={true}
                  singleDateLabel="As-of Date"
                  from={bsAsOf}
                  onFromChange={setBsAsOf}
                  onApply={() => fetchBalanceSheet(bsAsOf)}
                  onViewPdf={() => handleViewSectionPdf(
                    "balance_sheet",
                    undefined,
                    bsAsOf,
                    "Balance Sheet Statement",
                    `Balance_Sheet_${bsAsOf || "latest"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "balance_sheet",
                    undefined,
                    bsAsOf,
                    `Balance_Sheet_${bsAsOf || "latest"}.pdf`
                  )}
                  viewLabel="View Balance Sheet PDF"
                  downloadLabel="Download PDF"
                  title="Balance Sheet As-Of Filter"
                />

                {balanceSheetData && (
                  <div className="flex flex-col gap-4 mt-3">
                    {/* Status Pill */}
                    <div className={`p-3 rounded-xl border flex items-center justify-between text-xs ${balanceSheetData.balanced ? "bg-teal/10 border-teal/30 text-teal" : "bg-danger/10 border-danger/30 text-danger"}`}>
                      <div className="flex items-center gap-2">
                        <span>{balanceSheetData.balanced ? "✓" : "⚠️"}</span>
                        <span className="font-bold">
                          {balanceSheetData.balanced
                            ? "Assets = Liabilities + Equity (Balanced Statement)"
                            : "Imbalance detected between Assets and (Liabilities + Equity)"}
                        </span>
                      </div>
                      <span className="font-mono font-bold">
                        ₹{balanceSheetData.total_assets.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Assets */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">Assets (Cash, Digital Wallets, Receivables)</span>
                        <span className="font-mono text-teal font-bold">₹{balanceSheetData.total_assets.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted border-b border-line bg-surf/50">
                            <th className="px-3 py-1.5 font-semibold">Code</th>
                            <th className="py-1.5 font-semibold">Account</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balanceSheetData.assets.rows.map((r, i) => (
                            <tr key={i} className="border-b border-line/50 last:border-none">
                              <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                              <td className="py-2 text-textLight font-medium">{r.name}</td>
                              <td className="px-3 py-2 text-right font-mono text-textLight font-semibold">
                                ₹{r.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Liabilities */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">Liabilities &amp; Obligations</span>
                        <span className="font-mono text-danger font-bold">₹{balanceSheetData.liabilities.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted border-b border-line bg-surf/50">
                            <th className="px-3 py-1.5 font-semibold">Code</th>
                            <th className="py-1.5 font-semibold">Account</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balanceSheetData.liabilities.rows.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-3 py-3 text-center text-muted text-xs">No liabilities or debt outstanding</td>
                            </tr>
                          ) : (
                            balanceSheetData.liabilities.rows.map((r, i) => (
                              <tr key={i} className="border-b border-line/50 last:border-none">
                                <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                                <td className="py-2 text-textLight font-medium">{r.name}</td>
                                <td className="px-3 py-2 text-right font-mono text-textLight font-semibold">
                                  ₹{r.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Equity */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">Owner's Equity &amp; Retained Earnings</span>
                        <span className="font-mono text-accent font-bold">₹{balanceSheetData.equity.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-muted border-b border-line bg-surf/50">
                            <th className="px-3 py-1.5 font-semibold">Code</th>
                            <th className="py-1.5 font-semibold">Account</th>
                            <th className="px-3 py-1.5 font-semibold text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {balanceSheetData.equity.rows.map((r, i) => (
                            <tr key={i} className="border-b border-line/50 last:border-none">
                              <td className="px-3 py-2 font-mono text-muted">{r.code}</td>
                              <td className="py-2 text-textLight font-medium">{r.name}</td>
                              <td className="px-3 py-2 text-right font-mono text-textLight font-semibold">
                                ₹{r.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Total Comparison */}
                    <div className="mt-2 pt-3 border-t border-line flex justify-between items-center font-bold text-xs">
                      <div>
                        <span className="text-muted">Total Liab + Equity: </span>
                        <span className="font-mono text-textLight">
                          ₹{balanceSheetData.total_liabilities_equity.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted">Total Assets: </span>
                        <span className="font-mono text-teal">
                          ₹{balanceSheetData.total_assets.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {/* Cash Flow Statement Tab */}
            {activeTab === "cash_flow" && (
              <Card className="p-4">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Cash Flow Statement</h3>
                    <p className="text-[10px] text-muted">Direct Method &bull; UPI &amp; Digital Cash Reconciled</p>
                  </div>
                  <Badge variant="teal">Direct Method</Badge>
                </div>

                <SectionDateFilterBar
                  from={cfFrom}
                  to={cfTo}
                  onFromChange={setCfFrom}
                  onToChange={setCfTo}
                  onApply={() => fetchCashFlow(cfFrom, cfTo)}
                  onViewPdf={() => handleViewSectionPdf(
                    "cash_flow",
                    cfFrom,
                    cfTo,
                    "Cash Flow Statement",
                    `Cash_Flow_${cfFrom || "all"}_to_${cfTo || "now"}.pdf`
                  )}
                  onDownloadPdf={() => handleDownloadSectionPdf(
                    "cash_flow",
                    cfFrom,
                    cfTo,
                    `Cash_Flow_${cfFrom || "all"}_to_${cfTo || "now"}.pdf`
                  )}
                  viewLabel="View Cash Flow PDF"
                  downloadLabel="Download PDF"
                  title="Cash Flow Date Range Filter"
                />

                {cashFlowData && (
                  <div className="flex flex-col gap-4 mt-3">
                    {/* Metric Cards */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-card border border-line rounded-xl p-2.5 flex flex-col">
                        <span className="text-[10px] text-muted font-medium">Opening Cash</span>
                        <span className="text-[13px] font-bold font-mono text-textLight mt-0.5">
                          ₹{cashFlowData.opening_balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-card border border-line rounded-xl p-2.5 flex flex-col">
                        <span className="text-[10px] text-muted font-medium">Net Change</span>
                        <span className={`text-[13px] font-bold font-mono mt-0.5 ${cashFlowData.net_change >= 0 ? "text-teal" : "text-danger"}`}>
                          {cashFlowData.net_change >= 0 ? "+" : "-"} ₹{Math.abs(cashFlowData.net_change).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="bg-accent/10 border border-accent/30 rounded-xl p-2.5 flex flex-col">
                        <span className="text-[10px] text-accent font-medium">Closing Cash</span>
                        <span className="text-[13px] font-bold font-mono text-accent mt-0.5">
                          ₹{cashFlowData.closing_balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>

                    {/* 1. Operating Activities */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">1. Operating Activities (Sales &amp; Day-to-Day Expenses)</span>
                        <span className={`font-mono font-bold ${cashFlowData.operating.net >= 0 ? "text-teal" : "text-danger"}`}>
                          {cashFlowData.operating.net >= 0 ? "+" : "-"} ₹{Math.abs(cashFlowData.operating.net).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="p-3 bg-surf flex flex-col gap-1.5">
                        {cashFlowData.operating.inflows.map((r, i) => (
                          <div key={`in-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">Inflow: {r.name}</span>
                            <span className="font-mono text-teal font-medium">+ ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.operating.outflows.map((r, i) => (
                          <div key={`out-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">Outflow: {r.name}</span>
                            <span className="font-mono text-danger font-medium">- ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.operating.inflows.length === 0 && cashFlowData.operating.outflows.length === 0 && (
                          <p className="text-muted text-center text-xs py-1">No operating cash movements in period</p>
                        )}
                      </div>
                    </div>

                    {/* 2. Investing Activities */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">2. Investing Activities (Digital Gold &amp; Assets)</span>
                        <span className={`font-mono font-bold ${cashFlowData.investing.net >= 0 ? "text-teal" : "text-danger"}`}>
                          {cashFlowData.investing.net >= 0 ? "+" : "-"} ₹{Math.abs(cashFlowData.investing.net).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="p-3 bg-surf flex flex-col gap-1.5">
                        {cashFlowData.investing.inflows.map((r, i) => (
                          <div key={`in-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">{r.name}</span>
                            <span className="font-mono text-teal font-medium">+ ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.investing.outflows.map((r, i) => (
                          <div key={`out-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">{r.name}</span>
                            <span className="font-mono text-danger font-medium">- ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.investing.inflows.length === 0 && cashFlowData.investing.outflows.length === 0 && (
                          <p className="text-muted text-center text-xs py-1">No investing transactions in period</p>
                        )}
                      </div>
                    </div>

                    {/* 3. Financing Activities */}
                    <div className="border border-line rounded-xl overflow-hidden text-[11px]">
                      <div className="bg-card px-3 py-2 border-b border-line flex justify-between items-center">
                        <span className="font-bold text-textLight">3. Financing Activities (Capital &amp; Loans)</span>
                        <span className={`font-mono font-bold ${cashFlowData.financing.net >= 0 ? "text-teal" : "text-danger"}`}>
                          {cashFlowData.financing.net >= 0 ? "+" : "-"} ₹{Math.abs(cashFlowData.financing.net).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="p-3 bg-surf flex flex-col gap-1.5">
                        {cashFlowData.financing.inflows.map((r, i) => (
                          <div key={`in-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">{r.name}</span>
                            <span className="font-mono text-teal font-medium">+ ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.financing.outflows.map((r, i) => (
                          <div key={`out-${i}`} className="flex justify-between items-center">
                            <span className="text-textLight">{r.name}</span>
                            <span className="font-mono text-danger font-medium">- ₹{r.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ))}
                        {cashFlowData.financing.inflows.length === 0 && cashFlowData.financing.outflows.length === 0 && (
                          <p className="text-muted text-center text-xs py-1">No financing transactions in period</p>
                        )}
                      </div>
                    </div>

                    {/* Closing Reconciliation */}
                    <div className="p-3 rounded-xl bg-card border border-line flex justify-between items-center text-xs">
                      <div>
                        <div className="font-bold text-textLight">Closing Balance Reconciliation</div>
                        <div className="text-[10px] text-muted">
                          Opening (₹{cashFlowData.opening_balance.toFixed(2)}) + Net Cash Movement ({cashFlowData.net_change >= 0 ? "+" : "-"}₹{Math.abs(cashFlowData.net_change).toFixed(2)})
                        </div>
                      </div>
                      <span className="text-[14px] font-bold font-mono text-accent">
                        = ₹{cashFlowData.closing_balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            )}

            {activeTab === "compliance" && (
              <div className="flex flex-col gap-4">
                <Card className="p-4">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-[12px] font-bold text-textLight tracking-wider uppercase">Estimated GST & Balance Sheet</h3>
                    <Badge variant="teal">Compliance</Badge>
                  </div>

                  <SectionDateFilterBar
                    from={complianceFrom}
                    to={complianceTo}
                    onFromChange={setComplianceFrom}
                    onToChange={setComplianceTo}
                    onApply={() => fetchCompliance(complianceFrom, complianceTo)}
                    onViewPdf={() => handleViewSectionPdf(
                      "balance_sheet",
                      complianceFrom,
                      complianceTo,
                      "Balance Sheet & Financials",
                      `Balance_Sheet_${complianceFrom || "all"}_to_${complianceTo || "now"}.pdf`
                    )}
                    onDownloadPdf={() => handleDownloadSectionPdf(
                      "balance_sheet",
                      complianceFrom,
                      complianceTo,
                      `Balance_Sheet_${complianceFrom || "all"}_to_${complianceTo || "now"}.pdf`
                    )}
                    viewLabel="View Balance Sheet PDF"
                    downloadLabel="Download PDF"
                    title="Financials Date Filter"
                  />

                  {gstReport ? (
                    <div className="flex flex-col gap-4">
                      <div className="bg-surf p-3 rounded-xl border border-line">
                        <p className="text-xs text-muted mb-1">Total Output Tax (Sales)</p>
                        <p className="text-lg font-mono font-bold text-teal">₹{gstReport.outward_supplies.total_tax}</p>
                      </div>
                      <div className="bg-surf p-3 rounded-xl border border-line">
                        <p className="text-xs text-muted mb-1">Total Input Tax (Purchases)</p>
                        <p className="text-lg font-mono font-bold text-danger">₹{gstReport.inward_supplies.total_tax}</p>
                      </div>
                      <div className="bg-card p-3 rounded-xl border border-accent/30 shadow-[0_0_15px_rgba(110,90,240,0.1)]">
                        <p className="text-xs text-muted mb-1">Net GST Payable</p>
                        <p className="text-xl font-mono font-bold text-text">₹{gstReport.net_gst_payable}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted text-xs text-center">Loading GST Report...</p>
                  )}
                </Card>

                <Card className="p-4">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider mb-4 uppercase">Run Payroll</h3>
                  <p className="text-xs text-muted mb-4 leading-relaxed">
                    Automatically book salary expenses and credit cash/bank for your employees.
                  </p>
                  <div className="bg-surf rounded-xl border border-line p-3 mb-4">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="font-semibold">John Doe</span>
                      <span className="font-mono text-muted">₹500.00</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="font-semibold">Jane Smith</span>
                      <span className="font-mono text-muted">₹600.00</span>
                    </div>
                  </div>
                  {payrollSuccess && (
                    <p className="text-success text-xs text-center mb-3">✅ Payroll journals booked successfully!</p>
                  )}
                  <Btn onClick={runPayroll} disabled={runningPayroll}>
                    {runningPayroll ? "Running Payroll..." : "Run Payroll Batch"}
                  </Btn>
                </Card>
              </div>
            )}

            {activeTab === "invoices" && (
              <div className="flex flex-col gap-4">
                <Card className="p-4">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider mb-4 uppercase">Create Invoice</h3>
                  <div className="flex flex-col gap-3 mb-4">
                    <input
                      type="text"
                      value={newInvoiceCustomer}
                      onChange={(e) => setNewInvoiceCustomer(e.target.value)}
                      className="bg-surf border border-line rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                      placeholder="Customer Name"
                    />
                    <input
                      type="number"
                      value={newInvoiceAmount}
                      onChange={(e) => setNewInvoiceAmount(e.target.value)}
                      className="bg-surf border border-line rounded-xl px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
                      placeholder="Amount (₹)"
                    />
                  </div>
                  <Btn onClick={handleCreateInvoice} disabled={creatingInvoice}>
                    {creatingInvoice ? "Creating..." : "Create Invoice"}
                  </Btn>
                </Card>

                <Card className="p-4">
                  <h3 className="text-[12px] font-bold text-textLight tracking-wider mb-4 uppercase">Receivables</h3>
                  <div className="flex flex-col gap-3">
                    {invoices.length === 0 ? (
                      <p className="text-muted text-xs text-center">No invoices found.</p>
                    ) : (
                      invoices.map((inv) => (
                        <div key={inv.id} className="bg-surf p-3 rounded-xl border border-line flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className="font-mono font-bold text-accent text-xs">{inv.invoice_no}</span>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${inv.status === 'PAID' ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>
                              {inv.status}
                            </span>
                          </div>
                          <div className="flex justify-between items-end">
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold">{inv.customer_name}</span>
                              <span className="text-muted text-[10px]">{new Date(inv.created_at).toLocaleDateString()}</span>
                            </div>
                            <span className="text-lg font-mono font-bold">₹{inv.amount}</span>
                          </div>
                          {inv.status === 'PENDING' && (
                            <button
                              onClick={() => handlePayInvoice(inv.id)}
                              disabled={payingInvoice === inv.id}
                              className="mt-2 w-full py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-semibold hover:bg-accent/20 transition-colors"
                            >
                              {payingInvoice === inv.id ? "Marking..." : "Mark as Paid"}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* Static Explainer */}
            <Card className="p-4 mt-2">
              <h3 className="text-[12px] font-bold text-textLight tracking-wider mb-4 uppercase">How it works</h3>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">1</div>
                  <div>
                    <p className="text-sm font-semibold text-text">Transaction Sources</p>
                    <p className="text-xs text-muted">UPI, Cards, Bank Transfers</p>
                  </div>
                </div>
                <div className="w-0.5 h-4 bg-line ml-3"></div>
                <div className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">2</div>
                  <div>
                    <p className="text-sm font-semibold text-text">AI Categorization</p>
                    <p className="text-xs text-muted">Maps merchant data to Chart of Accounts</p>
                  </div>
                </div>
                <div className="w-0.5 h-4 bg-line ml-3"></div>
                <div className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">3</div>
                  <div>
                    <p className="text-sm font-semibold text-text">Append-Only Ledger</p>
                    <p className="text-xs text-muted">Double-entry system ensures balanced books</p>
                  </div>
                </div>
                <div className="w-0.5 h-4 bg-line ml-3"></div>
                <div className="flex gap-3 items-start">
                  <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">4</div>
                  <div>
                    <p className="text-sm font-semibold text-text">Reports & Answers</p>
                    <p className="text-xs text-muted">Balance Sheets, Trial Balance, T-Accounts</p>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
      )}

      {/* PDF Preview Modal */}
      <PdfPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        pdfBlob={previewBlob}
        title={previewTitle}
        filename={previewFilename}
        loading={previewLoading}
      />
    </div>
  );
}
