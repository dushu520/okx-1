import { useState, useEffect, useCallback } from "react";
import type { AccountInfo } from "../types";

interface Props {
  activeAccountId: number;
  onSwitch: (id: number) => void;
}

export function AccountSelector({ activeAccountId, onSwitch }: Props) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [open, setOpen] = useState(false);

  const fetchAccounts = useCallback(() => {
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((data) => setAccounts(data.accounts ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAccounts();
    const timer = setInterval(fetchAccounts, 10000); // refresh every 10s for balance updates
    return () => clearInterval(timer);
  }, [fetchAccounts]);

  const active = accounts.find((a) => a.id === activeAccountId);

  if (accounts.length <= 1) return null; // only show when multi-account

  return (
    <div className="account-selector">
      <button className="account-selector-trigger" onClick={() => setOpen(!open)}>
        <span className="account-selector-name">{active?.name ?? `Account #${activeAccountId}`}</span>
        <span className="account-selector-balance">
          ${active?.balance.toFixed(2) ?? "0.00"}
        </span>
        <span className={`account-selector-arrow ${open ? "up" : ""}`}>▼</span>
      </button>
      {open && (
        <>
          <div className="account-selector-overlay" onClick={() => setOpen(false)} />
          <div className="account-selector-dropdown">
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`account-selector-item ${a.id === activeAccountId ? "active" : ""}`}
                onClick={() => {
                  onSwitch(a.id);
                  setOpen(false);
                }}
              >
                <div className="asi-top">
                  <span className="asi-name">{a.name}</span>
                  {a.id === activeAccountId && <span className="asi-check">✓</span>}
                </div>
                <div className="asi-details">
                  <span className="asi-balance">${a.balance.toFixed(2)}</span>
                  <span className={`asi-pnl ${a.totalPnl >= 0 ? "pos" : "neg"}`}>
                    {a.totalPnl >= 0 ? "+" : ""}${a.totalPnl.toFixed(2)}
                  </span>
                </div>
              </button>
            ))}
            <div className="account-selector-divider" />
            <button
              className="account-selector-item add-new"
              onClick={async () => {
                const name = prompt("账户名称:", `Account #${accounts.length + 1}`);
                if (!name) return;
                try {
                  const resp = await fetch("/api/accounts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, balance: 10000 }),
                  });
                  const data = await resp.json();
                  if (data.ok) {
                    fetchAccounts();
                    onSwitch(data.account.id);
                  }
                } catch {}
                setOpen(false);
              }}
            >
              + 新建账户
            </button>
          </div>
        </>
      )}
    </div>
  );
}
