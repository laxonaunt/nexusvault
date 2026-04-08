import {
  Contract,
  Keypair,
  Networks,
  rpc as SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  Address,
  xdr,
} from "@stellar/stellar-sdk";
import dotenv from "dotenv";
dotenv.config();

const rpc = new SorobanRpc.Server(process.env.STELLAR_RPC_URL!);
const contractId = process.env.CONTRACT_ID!;
const adminKeypair = Keypair.fromSecret(process.env.ADMIN_SECRET_KEY!);
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE!;

const agentSecrets: Record<string, string> = {
  AGT001: process.env.AGT001_SECRET!,
  AGT002: process.env.AGT002_SECRET!,
  AGT003: process.env.AGT003_SECRET!,
  AGT004: process.env.AGT004_SECRET!,
  AGT005: process.env.AGT005_SECRET!,
};

const agentPublics: Record<string, string> = {
  AGT001: process.env.AGT001_PUBLIC!,
  AGT002: process.env.AGT002_PUBLIC!,
  AGT003: process.env.AGT003_PUBLIC!,
  AGT004: process.env.AGT004_PUBLIC!,
  AGT005: process.env.AGT005_PUBLIC!,
};

async function simulateAndRead(method: string, args: xdr.ScVal[]): Promise<any> {
  const contract = new Contract(contractId);
  const account = await rpc.getAccount(adminKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const result = (sim as any).result?.retval;
  return result ? scValToNative(result) : null;
}

export async function getAgentState(agentId: string): Promise<any> {
  return simulateAndRead("get_agent_state", [
    nativeToScVal(agentId, { type: "symbol" }),
  ]);
}

export async function getAllAgents(): Promise<string[]> {
  const result = await simulateAndRead("get_all_agents", []);
  return result ?? [];
}

export async function checkPayment(
  agentId: string,
  amount: number,
  vendor: string,
  category: string
): Promise<boolean> {
  try {
    const result = await simulateAndRead("check_payment", [
      nativeToScVal(agentId, { type: "symbol" }),
      nativeToScVal(BigInt(amount), { type: "i128" }),
      new Address(vendor).toScVal(),
      nativeToScVal(category, { type: "symbol" }),
    ]);
    return result === true;
  } catch {
    return false;
  }
}

export async function lockAgent(agentId: string): Promise<void> {
  await submitAdminTx("lock_agent", [nativeToScVal(agentId, { type: "symbol" })]);
}

export async function unlockAgent(agentId: string): Promise<void> {
  await submitAdminTx("unlock_agent", [nativeToScVal(agentId, { type: "symbol" })]);
}

export async function updateLimit(agentId: string, newLimit: number): Promise<void> {
  await submitAdminTx("update_limit", [
    nativeToScVal(agentId, { type: "symbol" }),
    nativeToScVal(BigInt(newLimit), { type: "i128" }),
  ]);
}

async function submitAdminTx(method: string, args: xdr.ScVal[]): Promise<void> {
  const contract = new Contract(contractId);
  const account = await rpc.getAccount(adminKeypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) throw new Error((sim as any).error);

  const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
  prepared.sign(adminKeypair);
  const response = await rpc.sendTransaction(prepared);

  let status = await rpc.getTransaction(response.hash);
  for (let i = 0; i < 10; i++) {
    if ((status as any).status !== "NOT_FOUND") break;
    await new Promise((r) => setTimeout(r, 1500));
    status = await rpc.getTransaction(response.hash);
  }
}

export { agentPublics, agentSecrets };