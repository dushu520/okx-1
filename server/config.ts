import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, "../.env");

export interface Config {
  apikey: string;
  secretkey: string;
  passphrase: string;
  wsUrl: string;
  restBase: string;
  demoFlag: string;
  dbPath: string;
  port: number;
  initialBalance: number;
  leverage: number;
  marginPerTrade: number;
  stopLossPct: number;
  takeProfitPullback: number;
}

function loadEnv(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(path)) return result;
  const text = fs.readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim().toLowerCase();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export function getConfig(): Config {
  const creds = loadEnv(ENV_PATH);
  return {
    apikey: creds.apikey ?? "",
    secretkey: creds.secretkey ?? "",
    passphrase: creds.password ?? "",
    wsUrl: "wss://ws.okx.com:443/ws/v5/public",
    restBase: "https://www.okx.com",
    demoFlag: "1",
    dbPath: path.resolve(__dirname, "../trading.db"),
    port: 4056,
    initialBalance: 10000,
    leverage: 5,
    marginPerTrade: 100,
    stopLossPct: 0.1,
    takeProfitPullback: 0.1,
  };
}
