import fetch from "node-fetch";

const BACKEND = "http://localhost:3001";
const AGENT_ID = "AGT004";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const attackSequence = [
  { category: "data",      amount: 100,      label: "normal request" },
  { category: "data",      amount: 100,      label: "normal request" },
  { category: "inference", amount: 500000,   label: "WRONG CATEGORY" },
  { category: "compute",   amount: 9000000,  label: "LIMIT EXCEEDED" },
  { category: "storage",   amount: 200000,   label: "BLOCKED CATEGORY" },
  { category: "data",      amount: 8000000,  label: "OVER DAILY LIMIT" },
  { category: "inference", amount: 1000000,  label: "ESCALATION ATTEMPT" },
  { category: "compute",   amount: 5000000,  label: "REPEAT VIOLATION" },
];

let step = 0;

async function makePayment() {
  const attack = attackSequence[step % attackSequence.length];
  step++;

  try {
    const res = await fetch(`${BACKEND}/api/data`, {
      headers: {
        "X-Agent-Id": AGENT_ID,
        "X-Payment-Category": attack.category,
        "X-Payment-Amount": String(attack.amount),
      },
    });

    const body = await res.json() as any;

    if (res.status === 200) {
      console.log(green(`✓ [${AGENT_ID}] APPROVED`) + dim(` — ${attack.label} · ${new Date().toLocaleTimeString()}`));
    } else {
      console.log(red(`✗ [${AGENT_ID}] BLOCKED`) + yellow(` — ${attack.label}`) + dim(` · ${body.reason} · ${new Date().toLocaleTimeString()}`));
    }
  } catch (err: any) {
    console.log(red(`✗ [${AGENT_ID}] ERROR — ${err.message}`));
  }
}

console.log(`\x1b[31m[RogueAgent] Starting — escalating attacks every 2s\x1b[0m`);
makePayment();
setInterval(makePayment, 2000);