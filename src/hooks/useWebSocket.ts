import { useEffect, useRef, useState } from "react";
import type { StateSnapshot } from "../types";

export function useWebSocket() {
  const [snapshot, setSnapshot] = useState<StateSnapshot | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let mounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let messageTimeout: ReturnType<typeof setTimeout>;
    let retries = 0;

    function scheduleMessageTimeout(ws: WebSocket) {
      clearTimeout(messageTimeout);
      messageTimeout = setTimeout(() => {
        console.warn("[ws] No message from server for 60s, reconnecting...");
        ws.close();
      }, 60000);
    }

    function connect() {
      if (!mounted) return;

      wsRef.current?.close();
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) { ws.close(); return; }
        retries = 0;
        scheduleMessageTimeout(ws);
      };

      ws.onmessage = (e) => {
        if (!mounted) return;
        scheduleMessageTimeout(ws);
        try {
          setSnapshot(JSON.parse(e.data));
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        clearTimeout(messageTimeout);
        wsRef.current = null;
        if (!mounted) return;
        retries++;
        const delay = Math.min(1000 * Math.pow(1.5, retries - 1), 10000);
        console.log(`[ws] Reconnecting in ${delay}ms (attempt ${retries})...`);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose fires after this, reconnect handled there
      };
    }

    connect();
    return () => {
      mounted = false;
      clearTimeout(reconnectTimer);
      clearTimeout(messageTimeout);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Fallback: poll /api/state every 10s when WS has no snapshot
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    let active = true;

    function poll() {
      if (!active) return;
      // only poll if we haven't received anything via WS recently
      fetch("/api/state")
        .then((r) => r.json())
        .then((data: StateSnapshot) => {
          if (active) setSnapshot(data);
        })
        .catch(() => {});
    }

    timer = setInterval(poll, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  return snapshot;
}
