import { useState, useEffect, useRef, useCallback } from "react";
import { isConnected, requestAccess, getAddress } from "@stellar/freighter-api";
const API = "";

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: "#080810", surface: "#0F0F1A", border: "#1A1A2E", borderH: "#2A2A44",
  accent: "#6366F1", accentH: "#5254CC", success: "#10B981", warning: "#F59E0B",
  danger: "#EF4444", t1: "#F1F5F9", t2: "#94A3B8", t3: "#475569", t4: "#334155",
};

const css = `
  @keyframes nvfade { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
  @keyframes nvglow { 0%,100% { box-shadow:0 0 12px 2px rgba(99,102,241,0.18); } 50% { box-shadow:0 0 28px 6px rgba(99,102,241,0.38); } }
  @keyframes nvping { 0% { transform:scale(1); opacity:0.8; } 100% { transform:scale(2.2); opacity:0; } }
  @keyframes nvflash { 0% { background:rgba(99,102,241,0.13); } 100% { background:transparent; } }
  @keyframes blob1 { 0%,100%{transform:translate(0,0);} 50%{transform:translate(40px,30px);} }
  @keyframes blob2 { 0%,100%{transform:translate(0,0);} 50%{transform:translate(-30px,40px);} }
  @keyframes spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
  * { box-sizing:border-box; margin:0; padding:0; }
  html { scroll-behavior:smooth; }
  body { background:${C.bg}; color:${C.t1}; font-family:'Inter',sans-serif; -webkit-font-smoothing:antialiased; }
  ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:${C.bg}; } ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }
  button { cursor:pointer; border:none; font-family:'Inter',sans-serif; }
  a { color:inherit; text-decoration:none; }
  mono { font-family:'JetBrains Mono',monospace; font-size:12px; font-weight:500; }
`;

// ── Types ─────────────────────────────────────────────────────────────────────
interface AgentState {
  id: string;
  policy: { daily_limit: string; categories: string[]; approved_vendors: string[]; is_locked: boolean; };
  daily_spent: string;
  day_start_epoch: number;
  payment_count: number;
}
interface AuditEvent {
  id: string; agent_id: string; action: "APPROVED" | "BLOCKED";
  amount: number; vendor: string; category: string; reason: string; timestamp: string; tx_hash: string;
}
interface Approval { id: string; agent_id: string; reason: string; amount: number; urgency: "HIGH" | "LOW"; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => `$${(n / 1_000_000).toFixed(2)}`;
const pct = (spent: string, limit: string) => Math.min(100, (Number(spent) / Number(limit)) * 100);
const statusColor = (a: AgentState) => a.policy.is_locked ? C.danger : pct(a.daily_spent, a.policy.daily_limit) >= 80 ? C.warning : C.success;
const statusLabel = (a: AgentState) => a.policy.is_locked ? "BLOCKED" : pct(a.daily_spent, a.policy.daily_limit) >= 80 ? "WARNING" : "ACTIVE";
const agentName: Record<string, string> = { AGT001:"Research Agent", AGT002:"Compute Agent", AGT003:"Storage Agent", AGT004:"Analytics Agent", AGT005:"Inference Agent" };

function useCountUp(target: number, duration = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = 0; const step = target / (duration / 16);
    const id = setInterval(() => { start += step; if (start >= target) { setVal(target); clearInterval(id); } else setVal(Math.floor(start)); }, 16);
    return () => clearInterval(id);
  }, [target]);
  return val;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", flex: 1, minWidth: 0, transition: "border-color 200ms" }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderH)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t3, marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: danger ? C.danger : C.t1, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.t3, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Status Dot ────────────────────────────────────────────────────────────────
function StatusDot({ color }: { color: string }) {
  return (
    <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, animation: "nvping 1.4s ease-out infinite", opacity: 0 }} />
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
    </div>
  );
}

// ── Spend Bar ─────────────────────────────────────────────────────────────────
function SpendBar({ spent, limit }: { spent: string; limit: string }) {
  const p = pct(spent, limit);
  const color = p >= 100 ? C.danger : p >= 80 ? C.warning : C.accent;
  const [width, setWidth] = useState(0);
  useEffect(() => { const t = setTimeout(() => setWidth(p), 100); return () => clearTimeout(t); }, [p]);
  return (
    <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden", width: 80 }}>
      <div style={{ height: "100%", width: `${width}%`, background: color, borderRadius: 2, transition: "width 1s cubic-bezier(0.4,0,0.2,1)" }} />
    </div>
  );
}

// ── Network Canvas ────────────────────────────────────────────────────────────
function NetworkGraph({ agents }: { agents: AgentState[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<any[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const r = Math.min(W, H) * 0.32;
    const agentPositions = agents.map((_, i) => ({
      x: cx + r * Math.cos((i / agents.length) * Math.PI * 2 - Math.PI / 2),
      y: cy + r * Math.sin((i / agents.length) * Math.PI * 2 - Math.PI / 2),
    }));

    const spawnParticle = (idx: number) => {
      const a = agents[idx]; if (!a) return;
      particlesRef.current.push({
        x: agentPositions[idx].x, y: agentPositions[idx].y,
        tx: cx, ty: cy, progress: 0,
        speed: 0.008 + Math.random() * 0.006,
        color: statusColor(a),
      });
    };

    const spawnId = setInterval(() => {
      if (agents.length) spawnParticle(Math.floor(Math.random() * agents.length));
    }, 400);

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      agentPositions.forEach((pos, i) => {
        ctx.beginPath(); ctx.moveTo(pos.x, pos.y); ctx.lineTo(cx, cy);
        ctx.strokeStyle = "rgba(99,102,241,0.12)"; ctx.lineWidth = 1; ctx.stroke();
      });
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fillStyle = C.accent; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 9px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("VAULT", cx, cy);
      agents.forEach((a, i) => {
        const pos = agentPositions[i]; const color = statusColor(a);
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = color + "22"; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = color; ctx.font = "7px JetBrains Mono"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(a.id, pos.x, pos.y);
      });
      particlesRef.current = particlesRef.current.filter(p => p.progress < 1);
      particlesRef.current.forEach(p => {
        p.progress = Math.min(1, p.progress + p.speed);
        const t = p.progress;
        const px = p.x + (p.tx - p.x) * t, py = p.y + (p.ty - p.y) * t;
        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = p.color; ctx.globalAlpha = 1 - t * 0.5; ctx.fill(); ctx.globalAlpha = 1;
      });
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { clearInterval(spawnId); cancelAnimationFrame(rafRef.current); };
  }, [agents]);

  return <canvas ref={canvasRef} width={320} height={220} style={{ width: "100%", height: 220 }} />;
}

// ── Live Feed ─────────────────────────────────────────────────────────────────
function LiveFeed({ events }: { events: AuditEvent[] }) {
  const [displayed, setDisplayed] = useState<AuditEvent[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    if (events.length && events[0]?.id !== displayed[0]?.id) {
      setDisplayed(events.slice(0, 12));
      setFlashId(events[0]?.id ?? null);
      setTimeout(() => setFlashId(null), 700);
    }
  }, [events]);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Live Transaction Feed</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.success, animation: "nvping 1.4s ease-out infinite" }} />
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: C.success, letterSpacing: "0.08em" }}>STREAMING</span>
        </div>
      </div>
      <div style={{ overflowY: "auto", maxHeight: 280 }}>
        {displayed.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: C.t3, fontSize: 13 }}>Waiting for transactions...</div>
        )}
        {displayed.map(ev => (
          <div key={ev.id} style={{
            display: "grid", gridTemplateColumns: "100px 80px 80px 1fr 90px 80px",
            gap: 8, padding: "10px 20px", alignItems: "center", fontSize: 12,
            borderLeft: `3px solid ${ev.action === "APPROVED" ? C.success : C.danger}`,
            borderBottom: `1px solid ${C.border}`,
            animation: flashId === ev.id ? "nvflash 700ms ease-out" : "none",
          }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: C.t3 }}>{ev.id}</span>
            <span style={{ color: C.t2 }}>{ev.agent_id}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", color: C.t1 }}>{fmt(ev.amount)}</span>
            <span style={{ color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.category}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: ev.action === "APPROVED" ? C.success : C.danger, background: (ev.action === "APPROVED" ? C.success : C.danger) + "18", padding: "2px 8px", borderRadius: 4, textAlign: "center" }}>{ev.action}</span>
            <span style={{ color: C.t4, fontSize: 11 }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fleet Overview Tab ────────────────────────────────────────────────────────
function FleetTab({ agents, events }: { agents: AgentState[]; events: AuditEvent[] }) {
  const totalSpent = agents.reduce((s, a) => s + Number(a.daily_spent), 0);
  const totalBudget = agents.reduce((s, a) => s + Number(a.policy.daily_limit), 0);
  const blocked = agents.filter(a => a.policy.is_locked).length;
  const totalTx = agents.reduce((s, a) => s + a.payment_count, 0);
  const spentCount = useCountUp(Math.round(totalSpent / 1000));
  const budgetCount = useCountUp(Math.round(totalBudget / 1000));
  const txCount = useCountUp(totalTx);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "nvfade 400ms ease-out" }}>
      <div style={{ display: "flex", gap: 16 }}>
        <StatCard label="Total Spent Today" value={`$${spentCount / 1000}`} sub="across all agents" />
        <StatCard label="Fleet Budget" value={`$${budgetCount / 1000}`} sub="daily allocation" />
        <StatCard label="Blocked Agents" value={String(blocked)} danger={blocked > 0} sub={blocked > 0 ? "requires attention" : "all systems healthy"} />
        <StatCard label="Total Transactions" value={String(txCount)} sub="this session" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, fontSize: 14, fontWeight: 600 }}>Agent Fleet</div>
          {agents.map(a => {
            const p = pct(a.daily_spent, a.policy.daily_limit);
            const color = statusColor(a);
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: `1px solid ${C.border}`, transition: "background 200ms" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <StatusDot color={color} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>{agentName[a.id] ?? a.id}</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.t3 }}>{a.id}</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 4, background: C.accent + "20", color: C.accent }}>
                  {a.policy.categories[0]?.toUpperCase() ?? "—"}
                </div>
                <SpendBar spent={a.daily_spent} limit={a.policy.daily_limit} />
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.t2, textAlign: "right", minWidth: 100 }}>
                  {fmt(Number(a.daily_spent))} / {fmt(Number(a.policy.daily_limit))}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color, minWidth: 56, textAlign: "right" }}>{statusLabel(a)}</div>
              </div>
            );
          })}
          {agents.length === 0 && <div style={{ padding: 32, textAlign: "center", color: C.t3, fontSize: 13 }}>Loading agents...</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.t3, marginBottom: 12, letterSpacing: "0.04em" }}>NETWORK GRAPH</div>
            <NetworkGraph agents={agents} />
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.t3, marginBottom: 14, letterSpacing: "0.04em" }}>BUDGET UTILIZATION</div>
            {[
              { label: "Spent", value: totalSpent, color: C.accent },
              { label: "Remaining", value: Math.max(0, totalBudget - totalSpent), color: C.success },
              { label: "Reserved", value: totalBudget * 0.1, color: C.warning },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.t2, marginBottom: 6 }}>
                  <span>{label}</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{fmt(value)}</span>
                </div>
                <div style={{ height: 6, background: C.border, borderRadius: 3 }}>
                  <div style={{ height: "100%", width: `${Math.min(100, (value / (totalBudget || 1)) * 100)}%`, background: color, borderRadius: 3, transition: "width 1s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <LiveFeed events={events} />
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────
function AuditTab({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = useState<"ALL" | "APPROVED" | "BLOCKED">("ALL");
  const filtered = filter === "ALL" ? events : events.filter(e => e.action === filter);

  return (
    <div style={{ animation: "nvfade 400ms ease-out" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["ALL", "APPROVED", "BLOCKED"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: filter === f ? C.accent : C.surface,
            color: filter === f ? "#fff" : C.t2,
            border: `1px solid ${filter === f ? C.accent : C.border}`,
            transition: "all 150ms",
          }}>{f}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.t3, alignSelf: "center" }}>{filtered.length} events</span>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "100px 80px 1fr 90px 90px 90px", gap: 8, padding: "10px 20px", borderBottom: `1px solid ${C.border}` }}>
          {["TX ID", "AGENT", "VENDOR", "AMOUNT", "STATUS", "TIME"].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: C.t4 }}>{h}</span>
          ))}
        </div>
        {filtered.map((ev, i) => (
          <div key={ev.id} style={{
            display: "grid", gridTemplateColumns: "100px 80px 1fr 90px 90px 90px",
            gap: 8, padding: "12px 20px", alignItems: "center",
            borderBottom: `1px solid ${C.border}`,
            borderLeft: `3px solid ${ev.action === "APPROVED" ? C.success : C.danger}`,
            animation: `nvfade 400ms ease-out ${i * 60}ms both`,
            transition: "background 200ms",
          }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.025)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.t3 }}>{ev.id}</span>
            <span style={{ fontSize: 12, color: C.t2 }}>{ev.agent_id}</span>
            <span style={{ fontSize: 11, color: C.t3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.vendor.slice(0, 16)}...</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: C.t1 }}>{fmt(ev.amount)}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color: ev.action === "APPROVED" ? C.success : C.danger, background: (ev.action === "APPROVED" ? C.success : C.danger) + "18", padding: "2px 8px", borderRadius: 4, textAlign: "center" }}>{ev.action}</span>
            <span style={{ fontSize: 11, color: C.t4 }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: 40, textAlign: "center", color: C.t3, fontSize: 13 }}>No events match this filter</div>}
      </div>
    </div>
  );
}

// ── Policy Editor Tab ─────────────────────────────────────────────────────────
function PolicyTab({ agents, onRefresh }: { agents: AgentState[]; onRefresh: () => void }) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleLock = async (id: string, lock: boolean) => {
    setLoading(id);
    await fetch(`${API}/api/agents/${id}/${lock ? "lock" : "unlock"}`, { method: "POST" });
    await onRefresh(); setLoading(null);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, animation: "nvfade 400ms ease-out" }}>
      {agents.map(a => {
        const color = statusColor(a);
        return (
          <div key={a.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", transition: "border-color 200ms" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = C.borderH)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <StatusDot color={color} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{agentName[a.id] ?? a.id}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.t3 }}>{a.id}</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color, background: color + "18", padding: "3px 8px", borderRadius: 4 }}>{statusLabel(a)}</span>
            </div>
            <div style={{ padding: "12px 20px" }}>
              {[
                { label: "Daily Limit", value: fmt(Number(a.policy.daily_limit)) },
                { label: "Spent Today", value: fmt(Number(a.daily_spent)) },
                { label: "Categories", value: a.policy.categories.join(", ") || "—" },
                { label: "Vendors", value: `${a.policy.approved_vendors.length} approved` },
                { label: "Transactions", value: String(a.payment_count) },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 12, color: C.t3 }}>{label}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: C.t1 }}>{value}</span>
                </div>
              ))}
              <SpendBar spent={a.daily_spent} limit={a.policy.daily_limit} />
            </div>
            <div style={{ padding: "12px 20px", display: "flex", gap: 8 }}>
              <button style={{ flex: 1, padding: "8px", borderRadius: 6, background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600, transition: "all 150ms" }}
                onMouseEnter={e => { e.currentTarget.style.background = C.accentH; e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.transform = "none"; }}>
                Edit Policy
              </button>
              {a.policy.is_locked && (
                <button onClick={() => handleLock(a.id, false)} disabled={loading === a.id} style={{ flex: 1, padding: "8px", borderRadius: 6, background: C.danger + "20", color: C.danger, border: `1px solid ${C.danger}40`, fontSize: 12, fontWeight: 600, transition: "all 150ms" }}>
                  {loading === a.id ? "..." : "Unblock"}
                </button>
              )}
              {!a.policy.is_locked && (
                <button onClick={() => handleLock(a.id, true)} disabled={loading === a.id} style={{ flex: 1, padding: "8px", borderRadius: 6, background: C.warning + "20", color: C.warning, border: `1px solid ${C.warning}40`, fontSize: 12, fontWeight: 600, transition: "all 150ms" }}>
                  {loading === a.id ? "..." : "Lock"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Approvals Tab ─────────────────────────────────────────────────────────────
function ApprovalsTab({ approvals, onAction }: { approvals: Approval[]; onAction: (id: string, action: "approve" | "reject") => void }) {
  const [fading, setFading] = useState<string | null>(null);

  const handle = (id: string, action: "approve" | "reject") => {
    setFading(id);
    setTimeout(() => { onAction(id, action); setFading(null); }, 350);
  };

  return (
    <div style={{ maxWidth: 720, animation: "nvfade 400ms ease-out" }}>
      <div style={{ fontSize: 13, color: C.t3, marginBottom: 20 }}>
        {approvals.length} pending approval{approvals.length !== 1 ? "s" : ""} — override requests from agent fleet
      </div>
      {approvals.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 40px", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 32, marginBottom: 16, color: C.t4 }}>◈</div>
          <div style={{ fontSize: 15, color: C.t3 }}>No pending approvals</div>
        </div>
      )}
      {approvals.map(a => (
        <div key={a.id} style={{
          background: C.surface, border: `1px solid ${C.border}`,
          borderLeft: `4px solid ${a.urgency === "HIGH" ? C.danger : C.warning}`,
          borderRadius: 12, padding: 24, marginBottom: 12,
          transition: "opacity 350ms, transform 350ms",
          opacity: fading === a.id ? 0 : 1,
          transform: fading === a.id ? "translateX(20px)" : "none",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: C.t2, marginBottom: 4 }}>
                <strong style={{ color: C.t1 }}>{a.agent_id}</strong> · Budget Override Request
              </div>
              <div style={{ fontSize: 13, color: C.t3 }}>{a.reason}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 4, background: (a.urgency === "HIGH" ? C.danger : C.warning) + "20", color: a.urgency === "HIGH" ? C.danger : C.warning, flexShrink: 0 }}>{a.urgency}</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 24, fontWeight: 700, color: C.t1, marginBottom: 4 }}>{fmt(a.amount)}</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.t4, marginBottom: 16 }}>{a.id}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => handle(a.id, "approve")} style={{ padding: "8px 20px", borderRadius: 6, background: C.success, color: "#fff", fontSize: 13, fontWeight: 600, transition: "all 150ms" }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "none"}>Approve</button>
            <button onClick={() => handle(a.id, "reject")} style={{ padding: "8px 20px", borderRadius: 6, background: "transparent", color: C.danger, border: `1px solid ${C.danger}40`, fontSize: 13, fontWeight: 600, transition: "all 150ms" }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "none"}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"fleet" | "audit" | "policy" | "approvals">("fleet");
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
const [showRegisterModal, setShowRegisterModal] = useState(false);
const [registering, setRegistering] = useState(false);
const [registerForm, setRegisterForm] = useState({ agent_id: "", daily_limit: "5000000", categories: "data", });
const [registerStatus, setRegisterStatus] = useState<string | null>(null);

const connectWallet = async () => {
  try {
    const connected = await isConnected();
    if (!connected) { setRegisterStatus("Freighter not installed. Get it at freighter.app"); return; }
    await requestAccess();
    const pubKey = await getAddress();
    setWalletAddress(pubKey.address);
    setRegisterStatus(null);
  } catch (err: any) {
    setRegisterStatus(`Connection failed: ${err.message}`);
  }
};

const handleRegister = async () => {
  if (!walletAddress) { await connectWallet(); return; }
  setRegistering(true); setRegisterStatus(null);
  try {
    const res = await fetch("/api/agents/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: registerForm.agent_id,
        wallet: walletAddress,
        daily_limit: parseInt(registerForm.daily_limit),
        categories: registerForm.categories.split(",").map(s => s.trim()),
        approved_vendors: [walletAddress],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setRegisterStatus(`Agent ${registerForm.agent_id} registered on-chain`);
    setShowRegisterModal(false);
    fetchAll();
  } catch (err: any) {
    setRegisterStatus(`Failed: ${err.message}`);
  } finally { setRegistering(false); }
};

  const fetchAll = useCallback(async () => {
    try {
      const [a, e, ap] = await Promise.all([
        fetch(`${API}/api/agents`).then(r => r.json()),
        fetch(`${API}/api/audit`).then(r => r.json()),
        fetch(`${API}/api/approvals`).then(r => r.json()),
      ]);
      setAgents(Array.isArray(a) ? a : []);
      setEvents(Array.isArray(e) ? e : []);
      setApprovals(Array.isArray(ap) ? ap : []);
    } catch {}
  }, []);

  useEffect(() => { fetchAll(); const id = setInterval(fetchAll, 3500); return () => clearInterval(id); }, []);

  const handleApprovalAction = async (id: string, action: "approve" | "reject") => {
    await fetch(`${API}/api/approvals/${id}/${action}`, { method: "POST" });
    fetchAll();
  };

  const navItems = [
    { key: "fleet", icon: "▦", label: "Fleet Overview" },
    { key: "audit", icon: "≡", label: "Audit Log" },
    { key: "policy", icon: "⊡", label: "Policy Editor" },
    { key: "approvals", icon: "◈", label: "Approvals", badge: approvals.length },
  ] as const;

  return (
    <div style={{ display: "flex", height: "100vh", background: C.bg, overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", padding: "20px 0" }}>
        <div style={{ padding: "0 20px 24px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, animation: "nvglow 3s ease infinite", borderRadius: 8, padding: "8px 10px", background: C.bg }}>
            <span style={{ fontSize: 18, color: C.accent }}>⬡</span>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>NexusVault</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: C.t4, letterSpacing: "0.08em", paddingLeft: 10 }}>STELLAR TESTNET</div>
        </div>
        <button onClick={onBack} style={{ margin: "16px 16px 8px", padding: "6px 12px", background: "transparent", color: C.t3, fontSize: 12, borderRadius: 6, border: `1px solid ${C.border}`, textAlign: "left", transition: "all 150ms" }}
          onMouseEnter={e => { e.currentTarget.style.color = C.t1; e.currentTarget.style.borderColor = C.borderH; }}
          onMouseLeave={e => { e.currentTarget.style.color = C.t3; e.currentTarget.style.borderColor = C.border; }}>
          ← Back to Home
        </button>
        <nav style={{ flex: 1, padding: "8px 12px" }}>
          {navItems.map(item => (
            <button key={item.key} onClick={() => setTab(item.key)} style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, marginBottom: 2,
              background: tab === item.key ? C.accent + "20" : "transparent",
              color: tab === item.key ? C.accent : C.t2,
              fontSize: 13, fontWeight: tab === item.key ? 600 : 400, textAlign: "left",
              transition: "all 150ms", position: "relative",
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              {item.label}
              {"badge" in item && item.badge > 0 && (
                <span style={{ marginLeft: "auto", background: C.danger, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>{item.badge}</span>
              )}
            </button>
          ))}
        </nav>
        <div style={{ margin: "0 12px", padding: "12px", background: C.bg, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.success }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.success, letterSpacing: "0.04em" }}>NETWORK HEALTHY</span>
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: C.t4 }}>~5s settlement · Testnet</div>
        </div>
      </div>
      {/* Main */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 28px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, background: C.surface, flexShrink: 0 }}>
  <div>
    <div style={{ fontSize: 16, fontWeight: 700 }}>{navItems.find(n => n.key === tab)?.label}</div>
    <div style={{ fontSize: 12, color: C.t3 }}>{new Date().toLocaleDateString()} · {agents.length} agents monitored</div>
  </div>
  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
    {walletAddress
      ? <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.success }}>{walletAddress.slice(0,6)}...{walletAddress.slice(-4)} ✓</span>
      : <button onClick={connectWallet} style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: 12, fontWeight: 600 }}>Connect Freighter</button>
    }
    <button onClick={() => setShowRegisterModal(true)} style={{ padding: "7px 16px", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 12, fontWeight: 600 }}>
      + Register Agent
    </button>
  </div>
</div>
        <div style={{ padding: 28, flex: 1 }}>
          {tab === "fleet" && <FleetTab agents={agents} events={events} />}
          {tab === "audit" && <AuditTab events={events} />}
          {tab === "policy" && <PolicyTab agents={agents} onRefresh={fetchAll} />}
          {tab === "approvals" && <ApprovalsTab approvals={approvals} onAction={handleApprovalAction} />}
        </div>
      </div>
      {showRegisterModal && (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
    onClick={e => { if (e.target === e.currentTarget) setShowRegisterModal(false); }}>
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: 440, animation: "nvfade 300ms ease-out" }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Register New Agent</div>
      <div style={{ fontSize: 13, color: C.t3, marginBottom: 24 }}>Writes directly to the Soroban vault contract on Stellar testnet.</div>

      {!walletAddress && (
        <button onClick={connectWallet} style={{ width: "100%", padding: "10px", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          Connect Freighter Wallet First
        </button>
      )}

      {walletAddress && (
        <div style={{ background: C.bg, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.success }}>
          ✓ {walletAddress.slice(0,12)}...{walletAddress.slice(-8)}
        </div>
      )}

      {[
        { label: "Agent ID", key: "agent_id", placeholder: "AGT006" },
        { label: "Daily Limit (stroops)", key: "daily_limit", placeholder: "5000000" },
        { label: "Categories (comma separated)", key: "categories", placeholder: "data,compute" },
      ].map(({ label, key, placeholder }) => (
        <div key={key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.t3, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
          <input
            value={registerForm[key as keyof typeof registerForm]}
            onChange={e => setRegisterForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 7, background: C.bg, border: `1px solid ${C.border}`, color: C.t1, fontSize: 13, fontFamily: "'JetBrains Mono',monospace", outline: "none" }}
          />
        </div>
      ))}

      {registerStatus && (
        <div style={{ padding: "8px 12px", borderRadius: 7, background: registerStatus.includes("registered") ? C.success + "18" : C.danger + "18", color: registerStatus.includes("registered") ? C.success : C.danger, fontSize: 12, marginBottom: 14 }}>
          {registerStatus}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={handleRegister} disabled={registering || !walletAddress} style={{ flex: 1, padding: "10px", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, opacity: registering ? 0.6 : 1 }}>
          {registering ? "Registering on-chain..." : "Register Agent"}
        </button>
        <button onClick={() => setShowRegisterModal(false)} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.t2, fontSize: 13 }}>Cancel</button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}

// ── Landing Page ───────────────────────────────────────────────────────────────
function Landing({ onLaunch }: { onLaunch: () => void }) {
  const stats = [
    { num: "92%", desc: "of enterprises say agent costs exceeded expectations", src: "IDC, 2025" },
    { num: "68%", desc: "hit major budget overruns on first agent deployments", src: "Greyhound CIO Pulse, 2025" },
    { num: "$1.3T", desc: "projected agentic AI spend by 2029", src: "IDC" },
    { num: "1 in 5", desc: "companies have mature agent governance today", src: "Industry Research" },
  ];
  const steps = [
    { n: "01", title: "Agent Requests Payment", desc: "An AI agent makes an x402 HTTP request to a paid API endpoint" },
    { n: "02", title: "NexusVault Intercepts", desc: "Our middleware catches the payment before it reaches Stellar" },
    { n: "03", title: "Soroban Policy Check", desc: "The on-chain vault contract verifies all spending rules instantly" },
    { n: "04", title: "Settle or Block", desc: "Approved payments settle in 5 seconds. Violations are rejected before they touch the chain." },
  ];
  const features = [
    { title: "$0.00001 per tx", desc: "The only chain where per-micropayment policy checks are economically viable" },
    { title: "5s Settlement", desc: "Synchronous with x402's HTTP round-trip. No async lag." },
    { title: "99.99% Uptime", desc: "Zero extended outages across 20.6 billion operations" },
    { title: "Native Stablecoins", desc: "USDC, PYUSD as first-class citizens on Stellar" },
    { title: "Soroban Contracts", desc: "Programmable spending limits via OpenZeppelin on mainnet today" },
    { title: "On-chain Audit Trail", desc: "Every approved and blocked payment anchored immutably on Stellar" },
  ];

  return (
    <div style={{ background: C.bg, color: C.t1, minHeight: "100vh" }}>
      {/* Navbar */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(8,8,16,0.92)", borderBottom: `1px solid rgba(255,255,255,0.06)`, backdropFilter: "blur(12px)", padding: "0 48px", display: "flex", alignItems: "center", height: 60 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20, color: C.accent }}>⬡</span>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>NexusVault</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <a href="https://github.com/laxonaunt/nexusvault" target="_blank" style={{ padding: "7px 16px", borderRadius: 7, border: `1px solid ${C.border}`, color: C.t2, fontSize: 13, transition: "all 150ms" }}>GitHub</a>
          <button onClick={onLaunch} style={{ padding: "7px 20px", borderRadius: 7, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 600, transition: "all 150ms" }}
            onMouseEnter={e => e.currentTarget.style.background = C.accentH}
            onMouseLeave={e => e.currentTarget.style.background = C.accent}>Launch App</button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: 900, margin: "0 auto", textAlign: "center", padding: "140px 48px 120px", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
          <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: `${C.accent}08`, top: "10%", left: "20%", animation: "blob1 12s ease-in-out infinite", filter: "blur(60px)" }} />
          <div style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: `${C.accent}06`, top: "30%", right: "15%", animation: "blob2 16s ease-in-out infinite", filter: "blur(60px)" }} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginBottom: 24 }}>Built for the Stellar Agent Economy</div>
        <h1 style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.08, marginBottom: 28, color: C.t1 }}>
          The Treasury Layer for<br />
          <span style={{ background: `linear-gradient(135deg, ${C.accent}, #818CF8)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Autonomous Agents</span>
        </h1>
        <p style={{ fontSize: 18, color: C.t2, maxWidth: 560, margin: "0 auto 40px", lineHeight: 1.6 }}>
          AI agents can now buy, sell and transact autonomously via x402 on Stellar. NexusVault ensures they never go rogue — blocking non-compliant payments before they settle, not after.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 40 }}>
          <button onClick={onLaunch} style={{ padding: "12px 28px", borderRadius: 8, background: C.accent, color: "#fff", fontSize: 14, fontWeight: 600, transition: "all 150ms" }}
            onMouseEnter={e => { e.currentTarget.style.background = C.accentH; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.transform = "none"; }}>Launch App</button>
          <a href="https://github.com/laxonaunt/nexusvault" target="_blank" style={{ padding: "12px 28px", borderRadius: 8, border: `1px solid ${C.border}`, color: C.t2, fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", transition: "all 150ms" }}>View on GitHub</a>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
          {["Built on Stellar", "x402 Native", "Testnet Live"].map(t => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.t3 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.success }} />
              {t}
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "80px 48px" }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", marginBottom: 12, color: C.t1 }}>The Agent Economy Has No Guardrails</h2>
        <p style={{ textAlign: "center", color: C.t2, fontSize: 15, marginBottom: 56 }}>Every existing solution shows you the damage after it happens. NexusVault stops it before settlement.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {stats.map(s => (
            <div key={s.num} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 28, transition: "border-color 200ms" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.borderH}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ fontSize: 40, fontWeight: 700, color: C.accent, letterSpacing: "-0.02em", marginBottom: 10 }}>{s.num}</div>
              <div style={{ fontSize: 14, color: C.t2, lineHeight: 1.5, marginBottom: 8 }}>{s.desc}</div>
              <div style={{ fontSize: 11, color: C.t4 }}>{s.src}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "80px 48px" }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", marginBottom: 56, color: C.t1 }}>Enforcement at the Settlement Layer</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {steps.map((s, i) => (
            <div key={s.n} style={{ position: "relative" }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, height: "100%", transition: "border-color 200ms" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = C.borderH}
                onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: C.accent, marginBottom: 12, fontWeight: 700 }}>{s.n}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>{s.desc}</div>
              </div>
              {i < 3 && <div style={{ position: "absolute", right: -10, top: "50%", transform: "translateY(-50%)", color: C.t4, fontSize: 16, zIndex: 1 }}>›</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Why Stellar */}
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "80px 48px" }}>
        <h2 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", textAlign: "center", marginBottom: 56, color: C.t1 }}>Built on the Only Chain Where This Works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {features.map(f => (
            <div key={f.title} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, transition: "border-color 200ms" }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.borderH}
              onMouseLeave={e => e.currentTarget.style.borderColor = C.border}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.t1, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: C.t2, lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "32px 48px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto" }}>
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ color: C.accent }}>⬡</span>
    <span style={{ fontWeight: 700, fontSize: 14 }}>NexusVault</span>
  </div>
  <span style={{ fontSize: 12, color: C.t4 }}>On-chain treasury enforcement for AI agent fleets</span>
  <div style={{ display: "flex", gap: 16 }}>
    <a href="https://x.com/nexus_vault_" target="_blank" style={{ fontSize: 12, color: C.t3, transition: "color 150ms" }}
      onMouseEnter={e => e.currentTarget.style.color = C.t1}
      onMouseLeave={e => e.currentTarget.style.color = C.t3}>Twitter →</a>
    <a href="https://github.com/laxonaunt/nexusvault" target="_blank" style={{ fontSize: 12, color: C.t3, transition: "color 150ms" }}
      onMouseEnter={e => e.currentTarget.style.color = C.t1}
      onMouseLeave={e => e.currentTarget.style.color = C.t3}>GitHub →</a>
  </div>
</footer>
    </div>
  );
}

// ── App Root ───────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState<"home" | "app">("home");
  return (
    <>
      <style>{css}</style>
      {page === "home" ? <Landing onLaunch={() => setPage("app")} /> : <Dashboard onBack={() => setPage("home")} />}
    </>
  );
}