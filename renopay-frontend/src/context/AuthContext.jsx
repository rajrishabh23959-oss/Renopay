import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { AccountAPI, AuthAPI } from "../lib/api";
import { getDeviceFingerprint } from "../lib/format";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Stale-While-Revalidate: Instant startup using cached profile
  const [profile, setProfile] = useState(() => {
    try {
      const cached = localStorage.getItem("renopay_cached_profile");
      const hasToken = !!localStorage.getItem("renopay_access_token");
      if (hasToken && cached) {
        return JSON.parse(cached);
      }
    } catch {
      /* ignore storage read error */
    }
    return null;
  });

  // If token is missing, loading is false. If cached profile exists, loading is false (instant display!)
  const [loading, setLoading] = useState(() => {
    const hasToken = !!localStorage.getItem("renopay_access_token");
    if (!hasToken) return false;
    const hasCached = !!localStorage.getItem("renopay_cached_profile");
    return !hasCached;
  });

  const refreshProfile = useCallback(async () => {
    const hasToken = !!localStorage.getItem("renopay_access_token");
    if (!hasToken) {
      setProfile(null);
      localStorage.removeItem("renopay_cached_profile");
      setLoading(false);
      return null;
    }
    try {
      const p = await AccountAPI.me(getDeviceFingerprint());
      if (p) {
        setProfile(p);
        try {
          localStorage.setItem("renopay_cached_profile", JSON.stringify(p));
        } catch {
          /* ignore storage write error */
        }
      }
      return p;
    } catch (err) {
      // If 401 Unauthorized, token is expired, clear cached profile
      if (err?.response?.status === 401) {
        setProfile(null);
        localStorage.removeItem("renopay_cached_profile");
      }
      // If offline/network issue, retain cached profile so app remains accessible
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProfile();
    const handleRevoked = () => {
      setProfile(null);
      try {
        localStorage.removeItem("renopay_cached_profile");
      } catch {
        /* ignore storage removal error */
      }
    };
    window.addEventListener("renopay:auth-revoked", handleRevoked);
    return () => window.removeEventListener("renopay:auth-revoked", handleRevoked);
  }, [refreshProfile]);

  const login = useCallback(async (phone, pin) => {
    await AuthAPI.login(phone, pin, getDeviceFingerprint(), navigator.userAgent.slice(0, 60));
    return refreshProfile();
  }, [refreshProfile]);

  const loginWithOtp = useCallback(async (email, otp) => {
    await AuthAPI.verifyOtp(email, otp, getDeviceFingerprint(), navigator.userAgent.slice(0, 60));
    return refreshProfile();
  }, [refreshProfile]);

  const register = useCallback(async (formData) => {
    await AuthAPI.register(formData);
    return refreshProfile();
  }, [refreshProfile]);

  const completeRegistration = useCallback(async () => {
    return refreshProfile();
  }, [refreshProfile]);

  const logout = useCallback(async () => {
    await AuthAPI.logout();
    setProfile(null);
    localStorage.removeItem("renopay_cached_profile");
  }, []);

  const value = { profile, loading, login, loginWithOtp, logout, refreshProfile, register, completeRegistration };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
