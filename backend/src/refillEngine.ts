import { logEvent } from "./auditLogger";

const REFILL_INTERVAL_MS = 30_000;
const agentBalances: Record<string, number> = {
  AGT001: 1000000,
  AGT002: 1000000,
  AGT003: 1000000,
  AGT004: 1000000,
  AGT005: 1000000,
};

export function getBalance(agentId: string): number {
  return agentBalances[agentId] ?? 0;
}

export function deductBalance(agentId: string, amount: number): void {
  if (agentBalances[agentId] !== undefined) {
    agentBalances[agentId] = Math.max(0, agentBalances[agentId] - amount);
  }
}

export function startRefillEngine(): void {
  setInterval(() => {
    const threshold = 200000;
    const refillAmount = 1000000;

    for (const [agentId, balance] of Object.entries(agentBalances)) {
      if (balance < threshold) {
        agentBalances[agentId] += refillAmount;
        logEvent({
          agent_id: agentId,
          action: "APPROVED",
          amount: refillAmount,
          vendor: "VAULT-MASTER",
          category: "refill",
          reason: `Auto-refill triggered — balance was ${balance}`,
          tx_hash: `refill-${Date.now()}`,
        });
        console.log(`[refill] ${agentId} topped up — new balance: ${agentBalances[agentId]}`);
      }
    }
  }, REFILL_INTERVAL_MS);

  console.log("[refill] Auto-refill engine started — checking every 30s");
}