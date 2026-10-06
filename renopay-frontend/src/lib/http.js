import axios from "axios";

const isNativeApp =
  typeof window !== "undefined" &&
  (window.Capacitor?.isNativePlatform?.() ||
    window.location.protocol === "capacitor:" ||
    window.location.protocol === "file:" ||
    (window.location.hostname === "localhost" && !window.location.port));

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (isNativeApp ? "https://renopay-u72j.vercel.app/api" : "/api");

export const http = axios.create({ baseURL: BASE_URL, timeout: 15000 });

// Safe storage access to prevent crashes in private browsing or quota limits
const memoryStorage = {};

function safeGet(key) {
  try {
    return localStorage.getItem(key) ?? memoryStorage[key] ?? null;
  } catch {
    return memoryStorage[key] ?? null;
  }
}

function safeSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {
    memoryStorage[key] = val;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
  delete memoryStorage[key];
}

function getTokens() {
  return {
    access: safeGet("renopay_access_token"),
    refresh: safeGet("renopay_refresh_token"),
  };
}

export function setTokens({ access_token, refresh_token }) {
  safeSet("renopay_access_token", access_token);
  safeSet("renopay_refresh_token", refresh_token);
}

export function clearTokens() {
  safeRemove("renopay_access_token");
  safeRemove("renopay_refresh_token");
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("renopay:auth-revoked"));
    } catch {}
  }
}

http.interceptors.request.use((config) => {
  const { access } = getTokens();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  return config;
});

// On a 401, try exactly once to refresh the access token using the
// refresh token, then replay the original request. If the refresh
// itself fails, clear tokens and let the app's route guard redirect
// to login — no infinite retry loops.
let refreshPromise = null;

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthError =
      error.response?.status === 401 ||
      (error.response?.status === 403 &&
        (error.response?.data?.detail === "Not authenticated" ||
          error.response?.data?.detail === "Invalid or expired token"));

    if (isAuthError && !original._retried) {
      original._retried = true;
      const { refresh } = getTokens();
      if (!refresh) {
        clearTokens();
        return Promise.reject(error);
      }
      try {
        refreshPromise ??= axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refresh });
        const { data } = await refreshPromise;
        refreshPromise = null;
        setTokens(data);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return http(original);
      } catch (refreshError) {
        refreshPromise = null;
        clearTokens();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);
