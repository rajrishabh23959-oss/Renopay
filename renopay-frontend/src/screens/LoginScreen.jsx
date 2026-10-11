import { useState, useRef, useEffect } from "react";
import { AuthAPI } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Btn } from "../components/ui";

const sectionCls = "text-accent text-[12px] font-bold tracking-wider mb-2 mt-4 border-b border-line pb-1 uppercase";

export function LoginScreen({ onDone, initialMode = "login", initialMethod = "email" }) {
  const { login, loginWithOtp, register, refreshProfile } = useAuth();
  const [mode, setMode] = useState(initialMode); // "login" | "register"
  const [loginMethod, setLoginMethod] = useState(initialMethod); // "email" | "phone"
  const [otpStep, setOtpStep] = useState("email"); // "email" | "otp"
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [infoMsg, setInfoMsg] = useState("");
  const [showPin, setShowPin] = useState(false);

  // Email OTP state
  const [email, setEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [resendCountdown, setResendCountdown] = useState(0);
  const otpInputRefs = useRef([]);

  // Phone + PIN login form state
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPin, setLoginPin] = useState("");

  // Registration form state
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    email: "",
    pin: "",
    pan: "",
    aadhaar: "",
  });

  // 30-second resend countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const timer = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCountdown]);

  // Autofocus first OTP box when entering OTP step
  useEffect(() => {
    if (otpStep === "otp") {
      otpInputRefs.current[0]?.focus();
    }
  }, [otpStep]);

  // -------------------------------------------------------------
  // Email OTP Flow Handlers
  // -------------------------------------------------------------
  const handleSendOtp = async (e) => {
    e?.preventDefault?.();
    setErr("");
    setInfoMsg("");
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.split("@")[1]?.includes(".")) {
      setErr("Please enter a valid email address");
      return;
    }
    setLoading(true);
    try {
      await AuthAPI.sendOtp(cleanEmail);
      setOtpStep("otp");
      setOtpDigits(["", "", "", "", "", ""]);
      setResendCountdown(30);
      setInfoMsg(`Verification code sent to ${cleanEmail}`);
    } catch (e2) {
      const detail = e2.response?.data?.detail;
      let msg = "Failed to dispatch verification code. Please check your connection.";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d) => d.msg || d.message).join(", ");
      } else if (e2.response?.status === 429) {
        msg = "Too many OTP requests. Please wait before trying again.";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCountdown > 0 || loading) return;
    setErr("");
    setInfoMsg("");
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      await AuthAPI.sendOtp(cleanEmail);
      setResendCountdown(30);
      setOtpDigits(["", "", "", "", "", ""]);
      setInfoMsg(`New verification code sent to ${cleanEmail}`);
      otpInputRefs.current[0]?.focus();
    } catch (e2) {
      const detail = e2.response?.data?.detail;
      let msg = "Failed to resend code.";
      if (typeof detail === "string") {
        msg = detail;
      } else if (e2.response?.status === 429) {
        msg = "Rate limit reached. Please wait before requesting another code.";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (codeOverride) => {
    const code = typeof codeOverride === "string" ? codeOverride : otpDigits.join("");
    if (!code || code.length !== 6) {
      setErr("Please enter the complete 6-digit verification code");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (loginWithOtp) {
        await loginWithOtp(cleanEmail, code);
      } else {
        await AuthAPI.verifyOtp(cleanEmail, code);
        await refreshProfile?.();
      }
      onDone?.();
    } catch (e2) {
      const detail = e2.response?.data?.detail;
      let msg = "Invalid or expired verification code";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d) => d.msg || d.message).join(", ");
      } else if (e2.response?.status === 429) {
        msg = "Too many failed verification attempts. Please request a new code.";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (idx, val) => {
    const cleanDigits = val.replace(/\D/g, "");
    if (cleanDigits.length > 1) {
      // Pasted multiple digits into a single box
      const newDigits = [...otpDigits];
      for (let i = 0; i < 6; i++) {
        newDigits[i] = cleanDigits[i] || "";
      }
      setOtpDigits(newDigits);
      const lastIndex = Math.min(cleanDigits.length - 1, 5);
      otpInputRefs.current[lastIndex]?.focus();
      if (cleanDigits.length >= 6) {
        handleVerifyOtp(cleanDigits.slice(0, 6));
      }
      return;
    }

    const single = cleanDigits.slice(-1);
    const newDigits = [...otpDigits];
    newDigits[idx] = single;
    setOtpDigits(newDigits);

    if (single && idx < 5) {
      otpInputRefs.current[idx + 1]?.focus();
    }

    // Auto-submit on the 6th digit
    if (single && idx === 5) {
      const fullCode = newDigits.join("");
      if (fullCode.length === 6) {
        handleVerifyOtp(fullCode);
      }
    }
  };

  const handleDigitKeyDown = (idx, e) => {
    if (e.key === "Backspace") {
      if (!otpDigits[idx] && idx > 0) {
        otpInputRefs.current[idx - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && idx > 0) {
      e.preventDefault();
      otpInputRefs.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < 5) {
      e.preventDefault();
      otpInputRefs.current[idx + 1]?.focus();
    }
  };

  const handleDigitPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || "";
    }
    setOtpDigits(newDigits);
    const targetFocus = Math.min(pasted.length, 5);
    otpInputRefs.current[targetFocus]?.focus();
    if (pasted.length === 6) {
      handleVerifyOtp(pasted);
    }
  };

  // -------------------------------------------------------------
  // Phone + PIN Flow Handlers
  // -------------------------------------------------------------
  const handleLoginSubmit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    const cleanPhone = loginPhone.replace(/\D/g, "");
    if (!cleanPhone) {
      setErr("Please enter your registered phone number");
      return;
    }
    if (cleanPhone.length < 10) {
      setErr("Please enter a valid 10-digit phone number");
      return;
    }
    if (loginPin.trim() && loginPin.trim().length !== 6) {
      setErr("PIN must be exactly 6 digits (or leave empty if not set)");
      return;
    }
    setLoading(true);
    try {
      await login(cleanPhone, loginPin.trim() || null);
      await refreshProfile?.();
      onDone?.();
    } catch (e2) {
      const detail = e2.response?.data?.detail;
      let msg = "";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d) => d.msg || d.message).join(", ");
      } else if (detail?.message) {
        msg = detail.message;
      } else if (e2.response?.status === 404) {
        msg = "No account found with this number. Please click Register to create your account!";
      } else if (e2.response?.status === 401) {
        msg = "Incorrect PIN. Please try again.";
      } else if (!e2.response) {
        msg = "Unable to connect to RenoPay server. Please check your internet connection.";
      } else {
        msg = "Invalid phone number or PIN";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------
  // Registration Flow Handler
  // -------------------------------------------------------------
  const handleRegSubmit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    const cleanPhone = formData.phone.replace(/\D/g, "");
    if (!formData.fullName.trim() || !cleanPhone || !formData.email.trim()) {
      setErr("Please fill in Full Name, Phone Number, and Email");
      return;
    }
    if (cleanPhone.length < 10 || cleanPhone.length > 15) {
      setErr("Phone number must contain 10 to 15 digits");
      return;
    }
    if (formData.pin && formData.pin.length !== 6) {
      setErr("PIN must be exactly 6 digits");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        full_name: formData.fullName.trim(),
        phone_number: cleanPhone,
        email: formData.email.trim() || null,
        pan_number: formData.pan.trim() || null,
        aadhaar_number: formData.aadhaar.trim() || null,
      };

      if (register) {
        await register(payload);
      } else {
        await AuthAPI.register(payload);
      }

      if (formData.pin && formData.pin.length === 6) {
        try {
          await AuthAPI.setPin(formData.pin, formData.pin);
        } catch {
          // Non-critical PIN setup error
        }
      }

      await refreshProfile?.();
      onDone?.();
    } catch (e2) {
      const detail = e2.response?.data?.detail;
      let msg = "Registration failed. Please check details.";
      if (typeof detail === "string") {
        msg = detail;
      } else if (Array.isArray(detail)) {
        msg = detail.map((d) => d.msg || d.message).join(", ");
      } else if (detail?.message) {
        msg = detail.message;
      } else if (!e2.response) {
        msg = "Unable to connect to RenoPay server. Please check your internet connection.";
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (phone, pin = "123456") => {
    setLoginPhone(phone);
    setLoginPin(pin);
    setErr("");
  };

  const fillDemoEmail = (demoEmail) => {
    setEmail(demoEmail);
    setErr("");
  };

  return (
    <div className="min-h-screen bg-bg px-5 pt-[44px] pb-10 relative flex flex-col items-center">
      {/* Ambient background glow */}
      <div className="glow-hero w-full max-w-[430px] flex flex-col items-center">
        {/* Brand Header */}
        <div className="relative z-10 flex flex-col items-center mb-5 text-center">
          <div className="w-[58px] h-[58px] rounded-full overflow-hidden shadow-accentGlow mb-2.5 bg-accent/20 border-2 border-accent/40 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="RenoPay Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <h2 className="text-[22px] font-black tracking-tight text-textLight">
            Reno<span className="text-accent">Pay</span>
          </h2>
          <p className="text-[12px] text-muted font-medium">
            Mindful Banking & Smart Denomination Wallet
          </p>
        </div>

        {/* Top Segmented Tab Toggle: Log In | Register */}
        <div className="w-full max-w-[390px] bg-card border border-line p-1 rounded-2xl flex gap-1 mb-5 shadow-inner">
          <button
            type="button"
            className={`flex-1 py-2.5 text-center text-[13.5px] font-bold rounded-xl transition-all duration-200 cursor-pointer ${
              mode === "login"
                ? "bg-gradient-to-r from-accent to-[#D9480F] text-white shadow-md"
                : "text-muted hover:text-textLight hover:bg-surf"
            }`}
            onClick={() => {
              setMode("login");
              setErr("");
              setInfoMsg("");
            }}
          >
            🔑 Log In
          </button>
          <button
            type="button"
            className={`flex-1 py-2.5 text-center text-[13.5px] font-bold rounded-xl transition-all duration-200 cursor-pointer ${
              mode === "register"
                ? "bg-gradient-to-r from-accent to-[#D9480F] text-white shadow-md"
                : "text-muted hover:text-textLight hover:bg-surf"
            }`}
            onClick={() => {
              setMode("register");
              setErr("");
              setInfoMsg("");
            }}
          >
            📝 Register
          </button>
        </div>

        {/* Main Card Container */}
        <div className="w-full max-w-[390px]">
          {mode === "login" ? (
            <div className="animate-fadeUp bg-card border border-line rounded-[24px] p-5 shadow-lg">
              {/* Method Switch: Email OTP vs Phone + PIN */}
              <div className="flex bg-surf/80 border border-line rounded-xl p-1 mb-4">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod("email");
                    setErr("");
                    setInfoMsg("");
                  }}
                  className={`flex-1 py-2 text-center text-[12px] font-bold rounded-lg transition cursor-pointer ${
                    loginMethod === "email"
                      ? "bg-accent text-white shadow-sm"
                      : "text-muted hover:text-textLight"
                  }`}
                >
                  ✉️ Email OTP
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod("phone");
                    setErr("");
                    setInfoMsg("");
                  }}
                  className={`flex-1 py-2 text-center text-[12px] font-bold rounded-lg transition cursor-pointer ${
                    loginMethod === "phone"
                      ? "bg-accent text-white shadow-sm"
                      : "text-muted hover:text-textLight"
                  }`}
                >
                  📱 Mobile PIN
                </button>
              </div>

              {/* ----------------- EMAIL OTP FLOW ----------------- */}
              {loginMethod === "email" ? (
                otpStep === "email" ? (
                  // Step 1: Email Address Input
                  <form onSubmit={handleSendOtp}>
                    <div className="mb-4">
                      <h1 className="text-[20px] font-black text-textLight">Instant Email Login</h1>
                      <p className="text-muted text-[12.5px] mt-0.5">
                        We'll send a 6-digit verification code to your inbox
                      </p>
                    </div>

                    <div className="mb-3.5">
                      <label htmlFor="email-otp-input" className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
                        Email Address
                      </label>
                      <input
                        id="email-otp-input"
                        required
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        className="mb-0 text-sm font-medium"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>

                    {/* Quick Demo Fast-Fill */}
                    <div className="mb-4 p-2.5 rounded-xl bg-surf border border-line">
                      <p className="text-[10.5px] text-muted uppercase font-bold tracking-wider mb-2">
                        ⚡ Quick Demo Email:
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fillDemoEmail("rishab@renopay.com")}
                          className="flex-1 py-1.5 px-2 rounded-lg bg-card hover:bg-surf border border-line text-[11.5px] text-textLight font-medium transition cursor-pointer text-left flex items-center gap-1.5"
                        >
                          <span>✉️</span>
                          <div>
                            <div className="font-bold text-accent leading-none">Rishab</div>
                            <div className="text-[9.5px] text-muted">rishab@renopay.com</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => fillDemoEmail("alex@renopay.com")}
                          className="flex-1 py-1.5 px-2 rounded-lg bg-card hover:bg-surf border border-line text-[11.5px] text-textLight font-medium transition cursor-pointer text-left flex items-center gap-1.5"
                        >
                          <span>✉️</span>
                          <div>
                            <div className="font-bold text-accent leading-none">Alex</div>
                            <div className="text-[9.5px] text-muted">alex@renopay.com</div>
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Error Notice */}
                    {err && (
                      <div role="alert" aria-live="polite" className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[12px] font-medium mb-3 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>{err}</span>
                      </div>
                    )}

                    <Btn type="submit" disabled={loading} className="w-full py-3.5 font-bold text-sm">
                      {loading ? "Sending Code..." : "Send Verification Code →"}
                    </Btn>
                  </form>
                ) : (
                  // Step 2: 6-Digit OTP Input
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleVerifyOtp();
                    }}
                  >
                    <div className="mb-4">
                      <div className="flex items-center justify-between">
                        <h1 className="text-[20px] font-black text-textLight">Verify Code</h1>
                        <button
                          type="button"
                          onClick={() => {
                            setOtpStep("email");
                            setErr("");
                            setInfoMsg("");
                          }}
                          className="text-xs text-accent font-semibold hover:underline cursor-pointer"
                        >
                          ← Change Email
                        </button>
                      </div>
                      <p className="text-muted text-[12.5px] mt-0.5">
                        Sent to <span className="text-textLight font-semibold">{email}</span>
                      </p>
                    </div>

                    {infoMsg && (
                      <div className="p-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-[11.5px] font-medium mb-3 flex items-center gap-2">
                        <span>✉️</span>
                        <span>{infoMsg}</span>
                      </div>
                    )}

                    {/* 6 Digit Input Boxes */}
                    <div className="mb-4">
                      <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                        Enter 6-Digit Verification Code
                      </label>
                      <div
                        className="flex gap-2 justify-between"
                        onPaste={handleDigitPaste}
                      >
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={(el) => (otpInputRefs.current[idx] = el)}
                            id={`otp-digit-${idx}`}
                            aria-label={`Digit ${idx + 1} of 6`}
                            type="text"
                            inputMode="numeric"
                            autoComplete={idx === 0 ? "one-time-code" : "off"}
                            pattern="[0-9]*"
                            maxLength={6}
                            value={digit}
                            disabled={loading}
                            onChange={(e) => handleDigitChange(idx, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                            className="w-12 h-14 text-center text-xl font-bold rounded-xl border border-line bg-surf text-textLight focus:border-accent focus:ring-1 focus:ring-accent transition shadow-inner mb-0"
                          />
                        ))}
                      </div>
                    </div>

                    {/* Resend Countdown */}
                    <div className="flex items-center justify-between mb-4 px-1">
                      <span className="text-[11.5px] text-muted">Didn't receive the email?</span>
                      {resendCountdown > 0 ? (
                        <span className="text-[11.5px] text-muted font-semibold">
                          Resend in <span className="text-accent font-bold">{resendCountdown}s</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleResendOtp}
                          disabled={loading}
                          className="text-[11.5px] font-bold text-accent hover:underline cursor-pointer"
                        >
                          Resend Code
                        </button>
                      )}
                    </div>

                    {/* Error Notice */}
                    {err && (
                      <div role="alert" aria-live="polite" className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[12px] font-medium mb-3 flex items-center gap-2">
                        <span>⚠️</span>
                        <span>{err}</span>
                      </div>
                    )}

                    <Btn type="submit" disabled={loading || otpDigits.join("").length !== 6} className="w-full py-3.5 font-bold text-sm">
                      {loading ? "Verifying..." : "Verify & Log In →"}
                    </Btn>
                  </form>
                )
              ) : (
                // ----------------- MOBILE + PIN FLOW -----------------
                <form onSubmit={handleLoginSubmit}>
                  <div className="mb-4">
                    <h1 className="text-[20px] font-black text-textLight">Welcome back</h1>
                    <p className="text-muted text-[12.5px] mt-0.5">
                      Enter your mobile number and PIN to continue
                    </p>
                  </div>

                  {/* Phone Field */}
                  <div className="mb-3.5">
                    <label htmlFor="login-phone-input" className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1.5">
                      Phone Number
                    </label>
                    <input
                      id="login-phone-input"
                      required
                      type="tel"
                      placeholder="Phone Number"
                      className="mb-0 text-sm font-medium"
                      value={loginPhone}
                      onChange={(e) => setLoginPhone(e.target.value)}
                    />
                  </div>

                  {/* PIN Field */}
                  <div className="mb-4">
                    <div className="flex justify-between items-center mb-1.5">
                      <label htmlFor="login-pin-input" className="block text-[11px] font-bold text-muted uppercase tracking-wider">
                        6-digit PIN (optional)
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPin((s) => !s)}
                        className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                      >
                        {showPin ? "Hide" : "Show"}
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="login-pin-input"
                        type={showPin ? "text" : "password"}
                        maxLength={6}
                        placeholder="6-digit PIN (optional)"
                        value={loginPin}
                        onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ""))}
                        className="tracking-[6px] text-base text-center mb-0"
                      />
                    </div>
                  </div>

                  {/* Demo Fast-Fill helper buttons */}
                  <div className="mb-4 p-2.5 rounded-xl bg-surf border border-line">
                    <p className="text-[10.5px] text-muted uppercase font-bold tracking-wider mb-2">
                      ⚡ Quick Demo Login:
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fillDemo("9876543210", "123456")}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-card hover:bg-surf border border-line text-[11.5px] text-textLight font-medium transition cursor-pointer text-left flex items-center gap-1.5"
                      >
                        <span>👤</span>
                        <div>
                          <div className="font-bold text-accent leading-none">Rishab</div>
                          <div className="text-[9.5px] text-muted">9876543210</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => fillDemo("9876543211", "123456")}
                        className="flex-1 py-1.5 px-2 rounded-lg bg-card hover:bg-surf border border-line text-[11.5px] text-textLight font-medium transition cursor-pointer text-left flex items-center gap-1.5"
                      >
                        <span>👤</span>
                        <div>
                          <div className="font-bold text-accent leading-none">Alex</div>
                          <div className="text-[9.5px] text-muted">9876543211</div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Error Message */}
                  {err && (
                    <div role="alert" aria-live="polite" className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[12px] font-medium mb-3 flex items-center gap-2">
                      <span>⚠️</span>
                      <span>{err}</span>
                    </div>
                  )}

                  {/* Submit Button */}
                  <Btn type="submit" disabled={loading} className="w-full py-3.5 font-bold text-sm">
                    {loading ? "Logging in..." : "Log In →"}
                  </Btn>
                </form>
              )}

              <div className="mt-3.5 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setErr("");
                    setInfoMsg("");
                  }}
                  className="text-xs text-muted hover:text-accent font-semibold transition cursor-pointer"
                >
                  New to RenoPay? <span className="text-accent underline">Create an account</span>
                </button>
              </div>
            </div>
          ) : (
            // ----------------- REGISTRATION FORM -----------------
            <form onSubmit={handleRegSubmit} className="animate-fadeUp bg-card border border-line rounded-[24px] p-5 shadow-lg">
              <div className="mb-2">
                <h1 className="text-[20px] font-black text-textLight">Welcome to RenoPay</h1>
                <p className="text-muted text-[12.5px] mt-0.5">
                  Create your account with your details below
                </p>
              </div>

              {/* Section 1 */}
              <h2 className={sectionCls}>1. Personal Information</h2>
              <div className="flex flex-col gap-2.5 mb-2">
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    Full Name <span className="text-accent">*</span>
                  </label>
                  <input
                    required
                    placeholder="Full Name"
                    className="mb-0 text-sm"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    Email Address <span className="text-accent">*</span>
                  </label>
                  <input
                    required
                    type="email"
                    placeholder="Email"
                    className="mb-0 text-sm"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    Phone Number <span className="text-accent">*</span>
                  </label>
                  <input
                    required
                    type="tel"
                    placeholder="Phone Number"
                    className="mb-0 text-sm"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* Section 2 */}
              <h2 className={sectionCls}>2. Identity & Security</h2>
              <div className="flex flex-col gap-2.5 mb-4">
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    Set 6-Digit App PIN (Optional)
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="6-digit PIN (optional)"
                    className="mb-0 text-sm tracking-[4px]"
                    value={formData.pin}
                    onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    PAN Number (Optional Demo)
                  </label>
                  <input
                    placeholder="PAN Number (ABCDE1234F)"
                    className="mb-0 text-sm uppercase"
                    value={formData.pan}
                    onChange={(e) => setFormData({ ...formData, pan: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-muted uppercase tracking-wider mb-1">
                    Aadhaar Number (Optional Demo)
                  </label>
                  <input
                    placeholder="Aadhaar Number"
                    className="mb-0 text-sm"
                    value={formData.aadhaar}
                    onChange={(e) => setFormData({ ...formData, aadhaar: e.target.value })}
                  />
                </div>
              </div>

              {/* Error Display */}
              {err && (
                <div role="alert" aria-live="polite" className="p-2.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-[12px] font-medium mb-3 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{err}</span>
                </div>
              )}

              {/* Submit Button */}
              <Btn type="submit" disabled={loading} className="w-full py-3.5 font-bold text-sm">
                {loading ? "Creating Account..." : "Continue →"}
              </Btn>

              <div className="mt-3.5 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setErr("");
                    setInfoMsg("");
                  }}
                  className="text-xs text-muted hover:text-accent font-semibold transition cursor-pointer"
                >
                  Already have an account? Log in →
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
