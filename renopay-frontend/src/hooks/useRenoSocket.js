import { useEffect, useRef, useCallback } from "react";

/**
 * Connects to the backend's /ws endpoint and calls `onEvent({type, data})`
 * for every push. Auto-reconnects with backoff if the connection drops
 * (mobile networks flap constantly — a payments app can't just give up).
 */
export function useRenoSocket(onEvent) {
  const wsRef = useRef(null);
  const retryDelay = useRef(1000);
  const failureCount = useRef(0);
  const handlerRef = useRef(onEvent);
  const timeoutRef = useRef(null);
  handlerRef.current = onEvent;

  const connect = useCallback(() => {
    const token = localStorage.getItem("renopay_access_token");
    if (!token) return;

    const isNativeApp =
      typeof window !== "undefined" &&
      (window.Capacitor?.isNativePlatform?.() ||
        window.location.protocol === "capacitor:" ||
        window.location.protocol === "file:" ||
        (window.location.hostname === "localhost" && !window.location.port));

    const isVercelHost =
      typeof window !== "undefined" &&
      (window.location.hostname.endsWith(".vercel.app") ||
        (isNativeApp && "renopay-u72j.vercel.app".endsWith(".vercel.app")));

    // Vercel serverless functions do not host persistent WebSockets without an external VITE_WS_URL gateway
    if (!import.meta.env.VITE_WS_URL && isVercelHost) {
      return;
    }

    if (failureCount.current >= 3) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const defaultHost = isNativeApp ? "renopay-u72j.vercel.app" : window.location.host;
    const wsUrl = import.meta.env.VITE_WS_URL || `${isNativeApp ? "wss:" : protocol}//${defaultHost}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        failureCount.current = 0;
        retryDelay.current = 1000;
        ws.send(JSON.stringify({ type: "auth", token }));
      };
      ws.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          handlerRef.current?.(parsed);
        } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => {
        failureCount.current += 1;
        if (failureCount.current < 3) {
          timeoutRef.current = setTimeout(connect, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 30000);
        }
      };
      ws.onerror = () => {
        ws.close();
      };
    } catch {
      failureCount.current += 1;
    }
  }, []);

  useEffect(() => {
    connect();
    const handleOnline = () => {
      failureCount.current = 0;
      retryDelay.current = 1000;
      connect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
