export type AuditAction = "APPROVED" | "BLOCKED";

export interface AuditEvent {
  id: string;
  agent_id: string;
  action: AuditAction;
  amount: number;
  vendor: string;
  category: string;
  reason: string;
  timestamp: string;
  tx_hash: string;
}

const events: AuditEvent[] = [];
let counter = 1;

export function logEvent(data: Omit<AuditEvent, "id" | "timestamp">): AuditEvent {
  const event: AuditEvent = {
    ...data,
    id: `TX-${String(counter++).padStart(5, "0")}`,
    timestamp: new Date().toISOString(),
  };
  events.unshift(event);
  if (events.length > 500) events.pop();
  return event;
}

export function getRecentEvents(limit = 50): AuditEvent[] {
  return events.slice(0, limit);
}

export function getAgentEvents(agent_id: string, limit = 50): AuditEvent[] {
  return events.filter((e) => e.agent_id === agent_id).slice(0, limit);
}