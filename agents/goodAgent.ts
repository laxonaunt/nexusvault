import fetch from "node-fetch";

const BACKEND = "http://localhost:3001";
const AGENT_ID = "AGT001";
const CATEGORY = "data";
const AMOUNT = 100;

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function makePayment() {
  try {
    const res = await fetch(`${BACKEND}/api/data`, {
      headers: {
        "X-Agent-Id": AGENT_ID,
        "X-Payment-Category": CATEGORY,
        "X-Payment-Amount": String(AMOUNT),
        "X-Vendor-Address": process.env.VENDOR_ADDRESS ?? "",
      },
    });

    const body = await res.json() as any;

    if (res.status === 200) {
      console.log(green(`✓ [${AGENT_ID}] APPROVED`) + dim(` — $${(AMOUNT / 1_000_000).toFixed(6)} · ${CATEGORY} · ${new Date().toLocaleTimeString()}`));
    } else {
      console.log(red(`✗ [${AGENT_ID}] BLOCKED`) + dim(` — ${body.reason}`));
    }
  } catch (err: any) {
    console.log(red(`✗ [${AGENT_ID}] ERROR — ${err.message}`));
  }
}

console.log(`\x1b[36m[GoodAgent] Starting — payments every 4s\x1b[0m`);
makePayment();
setInterval(makePayment, 4000);