import { useState, useEffect, lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { Nav } from "./components/Nav";
import { AIAssistant } from "./components/AIAssistant";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useVoiceBoxAnnouncer } from "./hooks/useVoiceBoxAnnouncer";

// Immediate core screens loaded synchronously
import { LoginScreen } from "./screens/LoginScreen";
import { HomeScreen } from "./screens/HomeScreen";

// Lazy-loaded on-demand secondary screens (fast startup!)
const PayScreen = lazy(() => import("./screens/PayScreen").then(m => ({ default: m.PayScreen })));
const ScanScreen = lazy(() => import("./screens/ScanScreen").then(m => ({ default: m.ScanScreen })));
const ProfileScreen = lazy(() => import("./screens/ProfileScreen").then(m => ({ default: m.ProfileScreen })));
const HistoryScreen = lazy(() => import("./screens/HistoryScreen").then(m => ({ default: m.HistoryScreen })));
const AddMoneyScreen = lazy(() => import("./screens/AddMoneyScreen").then(m => ({ default: m.AddMoneyScreen })));
const RequestScreen = lazy(() => import("./screens/RequestScreen").then(m => ({ default: m.RequestScreen })));
const SplitScreen = lazy(() => import("./screens/SplitScreen").then(m => ({ default: m.SplitScreen })));
const SubscriptionsScreen = lazy(() => import("./screens/SubscriptionsScreen").then(m => ({ default: m.SubscriptionsScreen })));
const RewardsScreen = lazy(() => import("./screens/RewardsScreen").then(m => ({ default: m.RewardsScreen })));
const SavingsScreen = lazy(() => import("./screens/SavingsScreen").then(m => ({ default: m.SavingsScreen })));
const VaultScreen = lazy(() => import("./screens/VaultScreen").then(m => ({ default: m.VaultScreen })));
const UPILiteScreen = lazy(() => import("./screens/UPILiteScreen").then(m => ({ default: m.UPILiteScreen })));
const ExpensesScreen = lazy(() => import("./screens/ExpensesScreen").then(m => ({ default: m.ExpensesScreen })));
const QRScreen = lazy(() => import("./screens/QRScreen").then(m => ({ default: m.QRScreen })));
const DigitalGoldScreen = lazy(() => import("./screens/DigitalGoldScreen").then(m => ({ default: m.DigitalGoldScreen })));
const LedgerReportScreen = lazy(() => import("./screens/LedgerReportScreen").then(m => ({ default: m.LedgerReportScreen })));
const AccountingScreen = lazy(() => import("./screens/AccountingScreen").then(m => ({ default: m.AccountingScreen })));
const TravelScreen = lazy(() => import("./screens/TravelScreen").then(m => ({ default: m.TravelScreen })));
const LoansScreen = lazy(() => import("./screens/LoansScreen").then(m => ({ default: m.LoansScreen })));
const RechargeScreen = lazy(() => import("./screens/RechargeScreen").then(m => ({ default: m.RechargeScreen })));
const MutualFundsScreen = lazy(() => import("./screens/MutualFundsScreen").then(m => ({ default: m.MutualFundsScreen })));
const GiftCardScreen = lazy(() => import("./screens/GiftCardScreen").then(m => ({ default: m.GiftCardScreen })));

function AppShell() {
  const { profile, loading } = useAuth();
  const [screen, setScreen] = useState("home");
  const [tab, setTab] = useState("home");
  const [payPrefill, setPayPrefill] = useState(null);
  const [travelPrefillTab, setTravelPrefillTab] = useState("train");
  const [rechargePrefillTab, setRechargePrefillTab] = useState("mobile");
  const [loansPrefillTab, setLoansPrefillTab] = useState("personal");
  const [scanInitialMode, setScanInitialMode] = useState("camera");
  const [giftCardPrefillCode, setGiftCardPrefillCode] = useState("");
  const [voiceToast, setVoiceToast] = useState(null);

  // Global Voice Box announcement listener & audio announcer
  useVoiceBoxAnnouncer((ann) => {
    if (ann?.text) {
      setVoiceToast(ann.text);
      setTimeout(() => setVoiceToast(null), 6000);
    }
  });

  // Universal Deep Link & QR Code Scanner detection (?claimCode=RENO-GIFT-...)
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        const code =
          urlParams.get("claimCode") ||
          urlParams.get("giftCode") ||
          urlParams.get("giftcard") ||
          urlParams.get("code");
        if (code && code.trim()) {
          const cleanCode = code.trim().toUpperCase();
          setGiftCardPrefillCode(cleanCode);
          setScreen("giftcard");
          setTab("home");
        }
      }
    } catch (_) {}
  }, []);

  const go = (s, data) => {
    if (["home", "pay", "expenses", "history", "profile", "accounting"].includes(s)) setTab(s);
    setPayPrefill(s === "pay" ? data ?? null : null);
    if (s === "scan") {
      setScanInitialMode(typeof data === "string" ? data : data?.mode || "camera");
    }
    if (s === "giftcard") {
      setGiftCardPrefillCode(typeof data === "string" ? data : data?.claimCode || "");
    }
    if (s === "travel") {
      setTravelPrefillTab(typeof data === "string" ? data : data?.tab || "train");
    }
    if (s === "recharge") {
      setRechargePrefillTab(typeof data === "string" ? data : data?.tab || "mobile");
    }
    if (s === "loans") {
      setLoansPrefillTab(typeof data === "string" ? data : data?.tab || "personal");
    }
    setScreen(s);
  };

  if (loading) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-muted text-sm">Loading...</div>;
  }

  if (!profile) {
    return (
      <LoginScreen
        onDone={() => {
          if (giftCardPrefillCode) {
            setScreen("giftcard");
          } else {
            setScreen("home");
            setTab("home");
          }
        }}
      />
    );
  }

  return (
    <div className="max-w-[430px] mx-auto relative">
      <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-muted text-xs animate-pulse">Loading screen...</div>}>
        {screen === "home"          && <HomeScreen onNavigate={go} />}
        {screen === "pay"           && (
          <PayScreen
            onBack={() => go("home")}
            onNavigate={go}
            prefillVpa={payPrefill?.vpa || (typeof payPrefill === "string" ? payPrefill : "")}
            prefillAmount={payPrefill?.amount}
            prefillNote={payPrefill?.note}
            prefillName={payPrefill?.name}
            prefillCategory={payPrefill?.category}
            prefillApp={payPrefill?.app}
          />
        )}
        {screen === "expenses"      && <ExpensesScreen onBack={() => go("home")} />}
        {screen === "history"       && <HistoryScreen onBack={() => go("home")} />}
        {screen === "giftcard"      && (
          <GiftCardScreen
            onBack={() => go("home")}
            initialClaimCode={giftCardPrefillCode}
            onScanQr={() => go("scan")}
          />
        )}
        {screen === "addmoney"      && <AddMoneyScreen onBack={() => go("home")} />}
        {screen === "qr"            && <QRScreen onBack={() => go("home")} />}
        {screen === "scan"          && (
          <ScanScreen
            onBack={() => go("home")}
            initialMode={scanInitialMode}
            onSuccess={(data) => {
              if (data?.type === "giftcard") {
                go("giftcard", { claimCode: data.code });
              } else {
                go("pay", typeof data === "string" ? { vpa: data } : data);
              }
            }}
          />
        )}

        {screen === "profile"       && <ProfileScreen onBack={() => go("home")} onLoggedOut={() => go("login")} />}
        {screen === "requests"      && <RequestScreen onBack={() => go("home")} />}
        {screen === "split"         && <SplitScreen onBack={() => go("home")} />}
        {screen === "subscriptions" && <SubscriptionsScreen onBack={() => go("home")} />}
        {screen === "upilite"       && <UPILiteScreen onBack={() => go("home")} />}
        {screen === "rewards"       && <RewardsScreen onBack={() => go("home")} />}
        {screen === "savings"       && <SavingsScreen onBack={() => go("home")} onNavigate={go} />}
        {screen === "vaults"        && <VaultScreen onBack={() => go("home")} />}
        {screen === "gold"          && <DigitalGoldScreen onBack={() => go("home")} />}
        {screen === "ledger"        && <LedgerReportScreen onBack={() => go("home")} />}
        {screen === "accounting"    && <AccountingScreen onBack={() => go("home")} />}
        {screen === "travel"        && (
          <TravelScreen
            onBack={() => go("home")}
            onNavigate={go}
            initialTab={travelPrefillTab}
          />
        )}
        {screen === "loans"         && (
          <LoansScreen
            onBack={() => go("home")}
            onNavigate={go}
            initialTab={loansPrefillTab}
          />
        )}
        {screen === "recharge"      && (
          <RechargeScreen
            onBack={() => go("home")}
            onNavigate={go}
            initialTab={rechargePrefillTab}
          />
        )}
        {screen === "invest"        && (
          <MutualFundsScreen
            onBack={() => go("home")}
            onNavigate={go}
          />
        )}
      </Suspense>
      {voiceToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-[90%] w-full bg-card/95 border-2 border-accent text-white px-4 py-3 rounded-2xl shadow-accentGlow flex items-center gap-3 animate-slideDown">
          <span className="text-2xl animate-bounce">📢</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase font-bold tracking-wider text-accent">RenoPay Smart Voice Box</p>
            <p className="text-xs font-bold text-textLight truncate">{voiceToast}</p>
          </div>
          <button
            type="button"
            onClick={() => setVoiceToast(null)}
            className="text-muted hover:text-white text-xs cursor-pointer p-1"
          >
            ✕
          </button>
        </div>
      )}
      <AIAssistant currentScreen={screen} onNavigate={go} />
      <Nav active={tab} onNavigate={go} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
