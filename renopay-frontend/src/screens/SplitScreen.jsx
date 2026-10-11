import { useState, useEffect } from "react";
import { RequestAPI } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Btn, Badge, Card } from "../components/ui";
import { fmt } from "../lib/format";

const UPI_SUFFIXES = ["@renopay", "@oksbi", "@okhdfcbank", "@paytm", "@okicici"];

const createParticipant = (name = "", vpa = "") => ({
  id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  name,
  vpa,
  isSelf: false,
});

export function SplitScreen({ onBack }) {
  const { profile } = useAuth();
  const [totalBill, setTotalBill] = useState("");
  const [desc, setDesc] = useState("");
  const [sentResult, setSentResult] = useState(null);
  const [err, setErr] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Stable participant list: always starts with Myself + 1 Friend
  const [people, setPeople] = useState(() => [
    {
      id: "self",
      name: profile?.full_name || "Myself",
      vpa: profile?.account?.vpa || "",
      isSelf: true,
    },
    createParticipant("", ""),
  ]);

  // Sync profile details if loaded after initial mount
  useEffect(() => {
    if (profile?.account?.vpa || profile?.full_name) {
      setPeople((prev) =>
        prev.map((p) =>
          p.id === "self"
            ? {
                ...p,
                name: profile.full_name || p.name || "Myself",
                vpa: profile.account?.vpa || p.vpa || "",
              }
            : p
        )
      );
    }
  }, [profile?.account?.vpa, profile?.full_name]);

  const participantCount = people.length || 1;
  const billNum = Number(totalBill);
  const split = totalBill && !isNaN(billNum) && billNum > 0 ? Math.ceil(billNum / participantCount) : 0;

  const addPerson = () => {
    setPeople((p) => [...p, createParticipant("", "")]);
  };

  const removePerson = (id) => {
    setPeople((p) => p.filter((x) => x.id !== id));
  };

  const updatePerson = (id, field, value) => {
    setPeople((p) =>
      p.map((x) => (x.id === id ? { ...x, [field]: value } : x))
    );
  };

  const applyHandle = (id, suffix) => {
    setPeople((p) =>
      p.map((x) => {
        if (x.id !== id) return x;
        const base = x.vpa.includes("@") ? x.vpa.split("@")[0] : x.vpa;
        return { ...x, vpa: `${base}${suffix}` };
      })
    );
  };

  const sendRequests = async () => {
    if (!totalBill || isNaN(billNum) || billNum <= 0) {
      setErr("Please enter a valid total bill amount (e.g. 500)");
      return;
    }

    // Validate each person
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const trimmedName = p.name.trim();
      const trimmedVpa = p.vpa.trim();

      if (!trimmedName) {
        setErr(`Please enter a name for ${p.isSelf ? "yourself" : `Person ${i + 1}`}`);
        return;
      }
      if (!trimmedVpa) {
        setErr(`Please enter a UPI ID or 10-digit mobile number for ${trimmedName}`);
        return;
      }

      if (!trimmedVpa.includes("@")) {
        if (!/^\d{10}$/.test(trimmedVpa)) {
          setErr(
            `Invalid UPI ID for ${trimmedName}. Enter a valid handle (e.g. ${trimmedVpa.toLowerCase()}@oksbi) or 10-digit phone number`
          );
          return;
        }
      }
    }

    // Build payload with normalized VPAs
    const payers = people.map((p) => {
      let cleanVpa = p.vpa.trim().toLowerCase();
      if (!cleanVpa.includes("@") && /^\d{10}$/.test(cleanVpa)) {
        cleanVpa = `${cleanVpa}@renopay`;
      }
      return {
        name: p.name.trim(),
        vpa: cleanVpa,
      };
    });

    setErr("");
    setIsSubmitting(true);

    try {
      const results = await RequestAPI.createSplit(billNum, desc.trim(), payers);
      setSentResult(results);
    } catch (e) {
      const detail = e.response?.data?.detail;
      let message = "Could not create split requests. Please check participant details.";
      if (typeof detail === "string") {
        message = detail;
      } else if (detail?.message) {
        message = detail.message;
      } else if (Array.isArray(detail) && detail[0]?.msg) {
        message = detail[0].msg;
      } else if (e.message) {
        message = e.message;
      }
      setErr(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg pb-[100px]">
      <div className="pt-[50px] pb-[18px] px-[22px] flex items-center gap-3">
        <button
          className="btn bg-card border border-line text-textLight rounded-xl px-3.5 py-2.5 text-base"
          onClick={onBack}
        >
          ←
        </button>
        <div>
          <h2 className="text-[22px] font-extrabold text-textLight">Bill Splitter 🍕</h2>
          <p className="text-muted text-[11px]">Divide expenses & collect instantly</p>
        </div>
      </div>

      <div className="px-[22px]">
        {!sentResult ? (
          <div className="animate-fadeUp">
            <Card className="p-5 mb-4 border-accent/[.2]">
              <p className="text-muted text-[11px] tracking-wide mb-2 uppercase font-semibold">
                Total Bill Amount
              </p>
              <div className="flex items-center gap-2 mb-3.5">
                <span className="text-[28px] text-accent font-bold">₹</span>
                <input
                  type="number"
                  placeholder="0"
                  value={totalBill}
                  onChange={(e) => {
                    setTotalBill(e.target.value);
                    if (err) setErr("");
                  }}
                  className="text-[32px] font-bold border-none border-b-2 border-accent rounded-none pl-0 bg-transparent w-full focus:outline-none"
                />
              </div>
              <input
                placeholder="What's this for? (e.g. Dinner, Trip, Groceries)"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="w-full text-xs py-2 px-3 rounded-lg border border-line bg-card/60"
              />
            </Card>

            {split > 0 && (
              <Card className="p-4 mb-4 text-center border-teal/[.27] bg-teal/[.03]">
                <p className="text-muted text-xs">Each person pays</p>
                <p className="font-mono text-[36px] font-bold text-teal">{fmt(split)}</p>
                <p className="text-muted text-[11px]">
                  {participantCount} people · equal split of {fmt(billNum)}
                </p>
              </Card>
            )}

            <div className="flex items-center justify-between mb-2.5">
              <p className="text-muted text-[11px] tracking-wide font-semibold uppercase">
                Participants ({people.length})
              </p>
              <span className="text-[11px] text-accent/80 font-medium">Equal Share</span>
            </div>

            {people.map((p, i) => (
              <Card key={p.id} className="p-3.5 mb-2.5 border-line/60">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1">
                    <input
                      placeholder={p.isSelf ? "Your Name" : `Person ${i + 1} Name`}
                      value={p.name}
                      onChange={(e) => updatePerson(p.id, "name", e.target.value)}
                      className="w-full py-2.5 px-3 text-[13px] rounded-lg border border-line bg-card focus:border-accent"
                    />
                  </div>
                  {p.isSelf ? (
                    <Badge color="#00C9A7" size={10}>Organizer</Badge>
                  ) : (
                    people.length > 2 && (
                      <button
                        type="button"
                        className="btn px-2.5 py-2.5 rounded-[10px] bg-surf border border-line text-danger hover:bg-danger/10"
                        onClick={() => removePerson(p.id)}
                        title="Remove participant"
                      >
                        ✕
                      </button>
                    )
                  )}
                </div>

                <div className="space-y-1.5">
                  <input
                    placeholder={p.isSelf ? (profile?.account?.vpa || "your@renopay") : "their@upi or 10-digit mobile"}
                    value={p.vpa}
                    onChange={(e) => updatePerson(p.id, "vpa", e.target.value)}
                    className="w-full text-xs py-2 px-3 rounded-lg border border-line bg-card focus:border-accent"
                  />

                  {/* Suffix handle helpers for other participants */}
                  {!p.isSelf && (
                    <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted">Quick Handle:</span>
                      {UPI_SUFFIXES.map((suffix) => (
                        <button
                          key={suffix}
                          type="button"
                          onClick={() => applyHandle(p.id, suffix)}
                          className="text-[10px] text-accent bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5 hover:bg-accent/20 active:scale-95 transition-all"
                        >
                          {suffix}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            ))}

            <button
              type="button"
              className="btn w-full py-[11px] rounded-xl bg-transparent border-[1.5px] border-dashed border-line text-muted text-[13px] hover:text-textLight hover:border-accent/40 mb-4 transition-all"
              onClick={addPerson}
            >
              + Add Another Person
            </button>

            {err && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl p-3 mb-3 animate-fadeUp">
                <p className="text-danger text-xs leading-relaxed font-medium">⚠️ {err}</p>
              </div>
            )}

            <Btn onClick={sendRequests} disabled={!split || isSubmitting}>
              {isSubmitting ? "Sending Split Requests..." : `Send Split Requests (${fmt(split)} each) →`}
            </Btn>
          </div>
        ) : (
          <div className="animate-fadeUp text-center pt-5">
            <div className="w-20 h-20 rounded-full bg-teal/[.13] border-2 border-teal/[.33] flex items-center justify-center text-4xl mx-auto mb-4">
              🍕
            </div>
            <h2 className="text-2xl font-extrabold text-teal">Split Requests Sent!</h2>
            <p className="text-muted mt-1.5 text-[13px]">
              {sentResult.length} payment requests dispatched successfully
            </p>

            <div className="mt-5 text-left">
              {sentResult.map((r) => (
                <Card key={r.id} className="p-3 mb-2 flex justify-between items-center">
                  <div>
                    <p className="text-[13px] font-semibold text-textLight">{r.to_vpa}</p>
                    <p className="text-[11px] text-muted truncate max-w-[200px]">{r.note}</p>
                  </div>
                  <Badge color="#FFA000" size={11}>
                    ⏳ {fmt(r.amount)}
                  </Badge>
                </Card>
              ))}
            </div>

            <div className="mt-6">
              <Btn onClick={onBack}>← Done / Back to Home</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
