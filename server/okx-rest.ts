import { createHmac } from "crypto";
import { getConfig } from "./config.js";

const cfg = getConfig();

function sign(timestamp: string, method: string, path: string, body = ""): string {
  const message = timestamp + method + path + body;
  return createHmac("sha256", cfg.secretkey).update(message).digest("base64");
}

function headers(method: string, path: string, body = ""): Record<string, string> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/\.\d{3}Z$/, "") + "." + String(now.getMilliseconds()).padStart(3, "0") + "Z";
  return {
    "OK-ACCESS-KEY": cfg.apikey,
    "OK-ACCESS-SIGN": sign(timestamp, method, path, body),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": cfg.passphrase,
    "x-simulated-trading": cfg.demoFlag,
    "Content-Type": "application/json",
  };
}

export async function fetchAccountBalance(): Promise<{ eq: number; availBal: number } | null> {
  const path = "/api/v5/account/balance";
  const url = cfg.restBase + path;
  try {
    const resp = await fetch(url, { headers: headers("GET", path), signal: AbortSignal.timeout(8000) });
    const data: any = await resp.json();
    if (data.code === "0" && data.data?.[0]?.details) {
      for (const d of data.data[0].details) {
        if (d.ccy === "USDT") {
          return { eq: parseFloat(d.eq) || 0, availBal: parseFloat(d.availBal) || 0 };
        }
      }
    }
  } catch (e) {
    console.warn(`[okx-rest] fetch balance failed: ${e}`);
  }
  return null;
}
