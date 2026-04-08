import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import { vaultInterceptor } from "./interceptor";
import { getRecentEvents, getAgentEvents } from "./auditLogger";
import { getAgentState, getAllAgents, lockAgent, unlockAgent, updateLimit } from "./vaultClient";
import { startRefillEngine } from "./refillEngine";

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT ?? 3001;

const pendingApprovals = [
  { id: "APR-001", agent_id: "AGT004", reason: "Emergency API access for critical pipeline", amount: 8000000, urgency: "HIGH" },
  { id: "APR-002", agent_id: "AGT002", reason: "Batch inference job — 3x normal spend", amount: 3000000, urgency: "LOW" },
];

// — paid API endpoint that agents hit via x402
app.get("/api/data", vaultInterceptor, (_req, res) => {
  res.json({ data: "Stellar network feed", timestamp: new Date().toISOString() });
});

app.get("/api/agents", async (_req, res) => {
  try {
    const ids = await getAllAgents();
    const states = await Promise.all(
      ids.map(async (id: string) => {
        try {
          const state = await getAgentState(id);
          return { id, ...state };
        } catch {
          return { id, error: "state unavailable" };
        }
      })
    );
    res.json(states);
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: "AGENTS_FETCH_ERROR" });
  }
});

app.get("/api/agents/:id", async (req, res) => {
  try {
    const state = await getAgentState(req.params.id);
    res.json({ id: req.params.id, ...state });
  } catch (err: any) {
    res.status(404).json({ error: err.message, code: "AGENT_NOT_FOUND" });
  }
});

app.post("/api/agents/:id/lock", async (req, res) => {
  try {
    await lockAgent(req.params.id);
    res.json({ success: true, agent_id: req.params.id, status: "locked" });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: "LOCK_ERROR" });
  }
});

app.post("/api/agents/:id/unlock", async (req, res) => {
  try {
    await unlockAgent(req.params.id);
    res.json({ success: true, agent_id: req.params.id, status: "unlocked" });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: "UNLOCK_ERROR" });
  }
});

app.put("/api/agents/:id/limit", async (req, res) => {
  try {
    const { limit } = req.body;
    await updateLimit(req.params.id, limit);
    res.json({ success: true, agent_id: req.params.id, new_limit: limit });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: "LIMIT_UPDATE_ERROR" });
  }
});

app.get("/api/audit", (_req, res) => {
  res.json(getRecentEvents(50));
});

app.get("/api/audit/:agent_id", (req, res) => {
  res.json(getAgentEvents(req.params.agent_id));
});

app.get("/api/approvals", (_req, res) => {
  res.json(pendingApprovals);
});

app.post("/api/approvals/:id/approve", (req, res) => {
  const idx = pendingApprovals.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found", code: "APPROVAL_NOT_FOUND" });
  const [approved] = pendingApprovals.splice(idx, 1);
  res.json({ success: true, approved });
});

app.post("/api/approvals/:id/reject", (req, res) => {
  const idx = pendingApprovals.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found", code: "APPROVAL_NOT_FOUND" });
  const [rejected] = pendingApprovals.splice(idx, 1);
  res.json({ success: true, rejected });
});

app.post("/api/agents/register", async (req, res) => {
  try {
    const { agent_id, wallet, daily_limit, categories, approved_vendors } = req.body;
    if (!agent_id || !wallet || !daily_limit || !categories) {
      return res.status(400).json({ error: "Missing required fields", code: "VALIDATION_ERROR" });
    }

    const contract = new (require("@stellar/stellar-sdk").Contract)(process.env.CONTRACT_ID!);
    const { Keypair, Networks, SorobanRpc, TransactionBuilder, BASE_FEE, nativeToScVal, Address } = require("@stellar/stellar-sdk");
    
    const rpcServer = new SorobanRpc.Server(process.env.STELLAR_RPC_URL!);
    const adminKeypair = Keypair.fromSecret(process.env.ADMIN_SECRET_KEY!);
    const account = await rpcServer.getAccount(adminKeypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE!,
    })
      .addOperation(contract.call(
        "register_agent",
        nativeToScVal(agent_id, { type: "symbol" }),
        new Address(wallet).toScVal(),
        nativeToScVal(BigInt(daily_limit), { type: "i128" }),
        nativeToScVal(categories.map((c: string) => nativeToScVal(c, { type: "symbol" })), { type: "vec" }),
        nativeToScVal(approved_vendors.map((v: string) => new Address(v).toScVal()), { type: "vec" }),
      ))
      .setTimeout(30)
      .build();

    const sim = await rpcServer.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) throw new Error((sim as any).error);
    const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
    prepared.sign(adminKeypair);
    const response = await rpcServer.sendTransaction(prepared);

    res.json({ success: true, agent_id, tx_hash: response.hash });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: "REGISTRATION_ERROR" });
  }
});

app.listen(PORT, () => {
  console.log(`[nexusvault] Backend running on port ${PORT}`);
  startRefillEngine();
});