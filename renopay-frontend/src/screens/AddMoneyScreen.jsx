import { useState } from "react";
import { PaymentAPI } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Btn, Card } from "../components/ui";
import { fmt } from "../lib/format";

const BANKS = [
  { id: "hdfc", name: "HDFC Bank", icon: "🏦" }, { id: "sbi", name: "State Bank of India", icon: "🏛" },
  { id: "icici", name: "ICICI Bank", icon: "🏢" }, { id: "axis", name: "Axis Bank", icon: "🔵" },
];

export function AddMoneyScreen({ onBack }) {
  let refreshProfile = null;
  try {
    const auth = useAuth();
    refreshProfile = auth?.refreshProfile;
  } catch {
    // ignore
  }

  const [step, setStep] = useState("amount");
  const [amount, setAmount] = useState("");
  const [selBank, setSelBank] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setStep("processing");
    try {
      const res = await PaymentAPI.addMoney(Number(amount), selBank.name);
      setResult(res);
      setStep("done");
      if (refreshProfile) {
        try {
          await refreshProfile();
        } catch {
          // ignore
        }
      }
    } catch {
      setStep("failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-10">
      <div className="pt-[50px] pb-[18px] px-[22px] flex items-center gap-3">
        <button className="btn bg-card border border-line text-textLight rounded-xl px-3.5 py-2.5 text-base" onClick={onBack}>←</button>
        <h2 className="text-[22px] font-extrabold text-textLight">Add Money</h2>
      </div>
      <div className="px-[22px]">
        {step === "amount" && (
          <div className="animate-fadeUp">
            <Card className="p-6 mb-5 border-accent/[.2]">
              <p className="text-muted text-[11px] tracking-wide mb-3 uppercase">Amount to Add</p>
              <div className="flex items-center gap-2.5">
                <span className="text-[32px] text-accent font-mono">₹</span>
                <input type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                       className="text-[36px] font-extrabold border-none border-b-2 border-accent rounded-none pl-0 bg-transparent font-mono" />
              </div>
              <div className="flex gap-2 mt-3.5 flex-wrap">
                {[500, 1000, 2000, 5000].map((v) => (
                  <button key={v} className="btn px-3.5 py-1.5 rounded-full text-xs font-semibold"
                          style={{ background: amount == String(v) ? "#FF6A1A" : "#151210", color: amount == String(v) ? "#fff" : "#5C564F", border: `1px solid ${amount == String(v) ? "#FF6A1A" : "#2A2320"}`, width: "auto" }}
                          onClick={() => setAmount(String(v))}>
                    ₹{v.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>
            </Card>
            {err && <p className="text-danger text-xs mb-3">{err}</p>}
            <Btn onClick={() => { if (!Number(amount) || Number(amount) < 10) { setErr("Min ₹10"); return; } setErr(""); setStep("bank"); }}>
              Select Bank →
            </Btn>
          </div>
        )}

        {step === "bank" && (
          <div className="animate-fadeUp">
            <Card className="p-4 mb-4 border-accent/[.2]">
              <p className="text-muted text-xs">Adding <strong className="text-accent">{fmt(Number(amount))}</strong></p>
            </Card>
            {BANKS.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelBank(b)}
                aria-pressed={selBank?.id === b.id}
                className="w-full text-left p-4 mb-2.5 rounded-[20px] flex items-center gap-3.5 cursor-pointer transition-all"
                style={{ border: `1.5px solid ${selBank?.id === b.id ? "#FF6A1A" : "#2A2320"}`, background: selBank?.id === b.id ? "#FF6A1A0a" : "#151210" }}
              >
                <span className="text-2xl" aria-hidden="true">{b.icon}</span>
                <div className="flex-1"><p className="font-bold text-sm text-textLight">{b.name}</p></div>
                {selBank?.id === b.id && <span className="text-accent text-lg" aria-hidden="true">✓</span>}
              </button>
            ))}
            <div className="mt-3.5 flex flex-col gap-2.5">
              <Btn onClick={submit} disabled={!selBank || submitting}>{submitting ? "Processing..." : `Pay ${fmt(Number(amount))} →`}</Btn>
              <Btn variant="ghost" onClick={() => setStep("amount")}>← Change Amount</Btn>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="animate-fadeUp text-center pt-10" aria-live="polite">
            <div className="w-[90px] h-[90px] rounded-full bg-accent/[.1] border-2 border-accent/[.33] flex items-center justify-center text-4xl mx-auto mb-5">⏳</div>
            <h2 className="text-xl font-extrabold text-accent">Processing...</h2>
            <p className="text-muted mt-2">Connecting to {selBank?.name}</p>
          </div>
        )}

        {step === "done" && result && (
          <div className="animate-fadeUp text-center pt-5" aria-live="polite">
            <div className="w-[90px] h-[90px] rounded-full bg-teal/[.1] border-2 border-teal/[.33] flex items-center justify-center text-4xl mx-auto mb-5 animate-heartbeat">✅</div>
            <h2 className="text-2xl font-extrabold text-teal">Money Added!</h2>
            <p className="text-muted mt-2">{fmt(Number(amount))} via {selBank?.name}</p>
            <Card className="p-4 mt-5 mb-5 text-left border-teal/[.2]">
              <div className="flex justify-between py-1.5 border-b border-line"><span className="text-muted text-xs">Amount</span><span className="text-teal text-xs font-semibold">{fmt(Number(amount))}</span></div>
              <div className="flex justify-between py-1.5"><span className="text-muted text-xs">New Balance</span><span className="text-teal text-xs font-semibold">{fmt(result.new_balance)}</span></div>
            </Card>
            <Btn variant="teal" onClick={onBack}>← Back to Home</Btn>
          </div>
        )}

        {step === "failed" && (
          <div className="animate-fadeUp text-center pt-5" aria-live="assertive">
            <div className="w-[90px] h-[90px] rounded-full bg-danger/[.1] flex items-center justify-center text-4xl mx-auto mb-5">❌</div>
            <h2 className="text-xl font-extrabold text-danger">Payment Failed</h2>
            <p className="text-muted mt-2">Please try again</p>
            <div className="flex gap-2.5 mt-5">
              <Btn variant="dark" onClick={onBack} className="flex-1">Home</Btn>
              <Btn onClick={() => setStep("bank")} className="flex-1">Try Again</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
