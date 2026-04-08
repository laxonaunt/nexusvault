import { Request, Response, NextFunction } from "express";
import { checkPayment } from "./vaultClient";
import { logEvent } from "./auditLogger";

export async function vaultInterceptor(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const agentId = req.headers["x-agent-id"] as string;
  const category = (req.headers["x-payment-category"] as string) ?? "data";
  const vendor = (req.headers["x-vendor-address"] as string) ?? "";
  const amount = parseInt((req.headers["x-payment-amount"] as string) ?? "100", 10);

  if (!agentId) {
    next();
    return;
  }

  try {
    const vendorAddress = vendor || process.env.ADMIN_PUBLIC_KEY!;
    const approved = await checkPayment(agentId, amount, vendorAddress, category);

    if (!approved) {
      logEvent({
        agent_id: agentId,
        action: "BLOCKED",
        amount,
        vendor: vendorAddress,
        category,
        reason: "Policy violation — daily limit, vendor, or category check failed",
        tx_hash: `sim-${Date.now()}`,
      });
      res.status(403).json({
        blocked: true,
        reason: "Policy violation",
        agent_id: agentId,
      });
      return;
    }

    logEvent({
      agent_id: agentId,
      action: "APPROVED",
      amount,
      vendor: vendorAddress,
      category,
      reason: "All policy checks passed",
      tx_hash: `sim-${Date.now()}`,
    });

    next();
  } catch (err: any) {
    logEvent({
      agent_id: agentId,
      action: "BLOCKED",
      amount,
      vendor,
      category,
      reason: `Interceptor error: ${err.message}`,
      tx_hash: `err-${Date.now()}`,
    });
    res.status(500).json({ error: "Interceptor failure", code: "INTERCEPTOR_ERROR" });
  }
}