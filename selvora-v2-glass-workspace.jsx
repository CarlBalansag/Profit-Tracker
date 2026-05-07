import { useState, useEffect } from "react";

const DATA = {
  totalCost: 1005.23, grossProfit: 318.0, netProfit: 322.3,
  saleRevenue: 843.0, cashback: 4.3,
  pipeline: [
    { label: "Purchased", value: 8 }, { label: "Shipped", value: 0 },
    { label: "Delivered", value: 0 }, { label: "Scanned", value: 0 },
    { label: "Paid", value: 0 }, { label: "Listed", value: 0 },
    { label: "Sold", value: 0 }, { label: "Completed", value: 3 },
  ],
  cards: [
    { name: "Chase Freedom Flex", txns: 3, amount: 824.28 },
    { name: "Wells Fargo", txns: 1, amount: 180.95 },
  ],
};

const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function AnimNum({ value, dur = 1400 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const s = performance.now();
    const t = (now) => {
      const p = Math.min((now - s) / dur, 1);
      setV((1 - Math.pow(1 - p, 4)) * value);
      if (p < 1) requestAnimationFrame(t);
    };
    requestAnimationFrame(t);
  }, [value, dur]);
  return <>${fmt(v)}</>;
}

function RadialPipeline({ steps }) {
  const total = steps.reduce((a, s) => a + s.value, 0);
  const cx = 90, cy = 90, r = 72;
  const angleStep = (2 * Math.PI) / steps.length;
  const startAngle = -Math.PI / 2;

  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      {/* Background circle */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r - 18} fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
      
      {/* Connecting lines */}
      {steps.map((_, i) => {
        const a1 = startAngle + i * angleStep;
        const a2 = startAngle + (i + 1) * angleStep;
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const x2 = cx + r * Math.cos(a2);
        const y2 = cy + r * Math.sin(a2);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        );
      })}

      {/* Center text */}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#e8e2d6" fontSize="20"
        fontFamily="'Fraunces', serif" fontWeight="300">{total}</text>
      <text x={cx} y={cx + 10} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8"
        fontFamily="'Geist Mono', monospace" letterSpacing="2">ITEMS</text>

      {/* Nodes */}
      {steps.map((step, i) => {
        const angle = startAngle + i * angleStep;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        const active = step.value > 0;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={active ? 16 : 12}
              fill={active ? "rgba(216,166,90,0.15)" : "rgba(255,255,255,0.03)"}
              stroke={active ? "#d8a65a" : "rgba(255,255,255,0.06)"}
              strokeWidth={active ? 1.5 : 0.5}
              style={{ transition: "all 0.5s ease" }}
            />
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
              fill={active ? "#d8a65a" : "rgba(255,255,255,0.15)"}
              fontSize={active ? "12" : "10"}
              fontFamily="'Geist Mono', monospace" fontWeight={active ? "600" : "300"}>
              {step.value}
            </text>
            {/* Label */}
            <text x={x} y={y + (y > cy ? 24 : -20)} textAnchor="middle"
              fill="rgba(255,255,255,0.2)" fontSize="7"
              fontFamily="'Geist Mono', monospace" letterSpacing="0.5">
              {step.label.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function GlassWorkspace() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [fabOpen, setFabOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const navItems = [
    { id: "dashboard", icon: "◫" },
    { id: "transactions", icon: "⇄" },
    { id: "inventory", icon: "▤" },
    { id: "analytics", icon: "◎" },
    { id: "cash", icon: "◇" },
    { id: "settings", icon: "⚙" },
  ];

  const fabActions = [
    { label: "Add Transaction", icon: "+" },
    { label: "Record Sale", icon: "↗" },
    { label: "Quick Expense", icon: "−" },
  ];

  return (
    <div style={{
      fontFamily: "'Outfit', sans-serif",
      background: "#0f1114",
      color: "#e8e2d6",
      minHeight: "100vh",
      position: "relative",
      overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@200;300;400;500;600;700&family=Outfit:wght@200;300;400;500;600;700&family=Geist+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes glassIn { from { opacity: 0; transform: translateY(24px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes floatUp { from { opacity: 0; transform: translateY(8px) scale(0.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes ambientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .glass {
          background: rgba(255,255,255,0.02);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 20px;
        }
        .glass:hover {
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.08);
        }
        .glass-sm { border-radius: 14px; }
        .pill-nav { transition: all 0.25s ease; }
        .pill-nav:hover { background: rgba(255,255,255,0.06) !important; }
        .fab-btn { transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 0; }
      `}</style>

      {/* Ambient Background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, opacity: 0.4,
        background: "radial-gradient(ellipse at 20% 20%, rgba(216,166,90,0.06) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(90,130,216,0.04) 0%, transparent 50%), radial-gradient(ellipse at 50% 50%, rgba(216,90,130,0.03) 0%, transparent 50%)",
        animation: "ambientShift 20s ease infinite",
        backgroundSize: "200% 200%",
      }} />

      {/* Floating Pill Nav — Left edge */}
      <nav style={{
        position: "fixed", left: 16, top: "50%", transform: "translateY(-50%)",
        zIndex: 100,
        padding: "12px 8px",
        display: "flex", flexDirection: "column", gap: 4,
        alignItems: "center",
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 24,
        animation: "fadeIn 0.6s ease 0.2s both",
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: "linear-gradient(135deg, #d8a65a, #c4873a)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#0f1114",
          marginBottom: 8,
        }}>S</div>

        {navItems.map((item) => (
          <div key={item.id} className="pill-nav" onClick={() => setActiveNav(item.id)} style={{
            width: 38, height: 38, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 17, cursor: "pointer",
            color: activeNav === item.id ? "#d8a65a" : "rgba(255,255,255,0.2)",
            background: activeNav === item.id ? "rgba(216,166,90,0.08)" : "transparent",
          }}>{item.icon}</div>
        ))}
      </nav>

      {/* Main Content Area */}
      <div style={{
        marginLeft: 76, minHeight: "100vh",
        padding: "28px 36px 28px 24px",
        position: "relative", zIndex: 1,
        overflow: "auto",
      }}>
        {/* Top Bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 32,
          animation: "fadeIn 0.5s ease",
        }}>
          <div>
            <h1 style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 30, fontWeight: 300, letterSpacing: "-0.5px",
            }}>
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, Carl
            </h1>
            <div style={{
              fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 4,
              fontFamily: "'Geist Mono', monospace",
            }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            {/* Search */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 16px", borderRadius: 14,
              background: searchFocused ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${searchFocused ? "rgba(216,166,90,0.2)" : "rgba(255,255,255,0.04)"}`,
              transition: "all 0.3s ease",
              width: searchFocused ? 280 : 200,
            }}>
              <span style={{ fontSize: 14, color: "rgba(255,255,255,0.2)" }}>⌕</span>
              <input
                placeholder="Search..."
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                style={{
                  background: "none", border: "none", outline: "none",
                  color: "#e8e2d6", fontSize: 13, fontFamily: "'Outfit', sans-serif",
                  width: "100%",
                }}
              />
              <span style={{
                fontSize: 9, fontFamily: "'Geist Mono', monospace",
                color: "rgba(255,255,255,0.15)", padding: "2px 6px",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5,
              }}>⌘K</span>
            </div>

            {/* Notification bell */}
            <div onClick={() => setNotifOpen(!notifOpen)} style={{
              width: 38, height: 38, borderRadius: 12,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", position: "relative",
              fontSize: 16, color: "rgba(255,255,255,0.3)",
              transition: "all 0.2s ease",
            }}>
              ◌
              <div style={{
                position: "absolute", top: 6, right: 6,
                width: 6, height: 6, borderRadius: "50%",
                background: "#d8a65a",
              }} />
            </div>

            {/* Period */}
            <div style={{
              display: "flex", gap: 2, padding: 3, borderRadius: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              {["7D", "30D", "YTD", "ALL"].map((p) => (
                <button key={p} style={{
                  padding: "6px 14px", borderRadius: 10, fontSize: 11,
                  fontFamily: "'Geist Mono', monospace", fontWeight: 500,
                  background: p === "YTD" ? "rgba(216,166,90,0.12)" : "transparent",
                  color: p === "YTD" ? "#d8a65a" : "rgba(255,255,255,0.2)",
                  border: "none", cursor: "pointer",
                  transition: "all 0.2s ease",
                }}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* STATS — Staggered cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1.8fr 1fr 1fr 1fr 0.8fr",
          gap: 14, marginBottom: 24,
        }}>
          {[
            { label: "Total Cost", value: DATA.totalCost, sub: "4 transactions", size: "lg", delay: 0.05 },
            { label: "Gross Profit", value: DATA.grossProfit, sub: "sold items", delay: 0.1 },
            { label: "Net Profit", value: DATA.netProfit, sub: "sold items", highlight: true, delay: 0.15 },
            { label: "Revenue", value: DATA.saleRevenue, sub: "2 sold", delay: 0.2 },
            { label: "Cashback", value: DATA.cashback, sub: "0.82%", delay: 0.25 },
          ].map((stat, i) => (
            <div key={i} className={`glass ${stat.size === "lg" ? "" : "glass-sm"}`} style={{
              padding: stat.size === "lg" ? "28px" : "22px",
              animation: `glassIn 0.7s cubic-bezier(0.22,1,0.36,1) ${stat.delay}s both`,
              transition: "all 0.3s ease",
              cursor: "default",
              borderColor: stat.highlight ? "rgba(216,166,90,0.12)" : undefined,
            }}>
              <div style={{
                fontSize: 10, fontFamily: "'Geist Mono', monospace",
                color: stat.highlight ? "rgba(216,166,90,0.6)" : "rgba(255,255,255,0.2)",
                letterSpacing: "1.5px", marginBottom: 10, textTransform: "uppercase",
              }}>{stat.label}</div>
              <div style={{
                fontFamily: "'Fraunces', serif",
                fontSize: stat.size === "lg" ? 44 : 26,
                fontWeight: 300, letterSpacing: stat.size === "lg" ? "-2px" : "-0.5px",
                color: stat.highlight ? "#d8a65a" : "#e8e2d6",
                lineHeight: 1,
              }}>
                <AnimNum value={stat.value} dur={1200 + i * 200} />
              </div>
              <div style={{
                fontSize: 10, color: "rgba(255,255,255,0.15)",
                fontFamily: "'Geist Mono', monospace", marginTop: 8,
              }}>{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* MIDDLE ROW — Pipeline + Chart side by side */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr",
          gap: 14, marginBottom: 24,
        }}>
          {/* Radial Pipeline */}
          <div className="glass" style={{
            padding: "24px",
            display: "flex", flexDirection: "column", alignItems: "center",
            animation: "glassIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.3s both",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "'Geist Mono', monospace",
              color: "rgba(255,255,255,0.2)", letterSpacing: "2px",
              marginBottom: 12, alignSelf: "flex-start",
            }}>PIPELINE</div>
            <RadialPipeline steps={DATA.pipeline} />
            <div style={{
              display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "center",
            }}>
              {DATA.pipeline.filter(s => s.value > 0).map((s, i) => (
                <span key={i} style={{
                  padding: "4px 10px", borderRadius: 8,
                  background: "rgba(216,166,90,0.06)",
                  border: "1px solid rgba(216,166,90,0.12)",
                  fontSize: 10, fontFamily: "'Geist Mono', monospace",
                  color: "#d8a65a",
                }}>{s.label}: {s.value}</span>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="glass" style={{
            padding: "28px",
            animation: "glassIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.35s both",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <div style={{
                  fontFamily: "'Fraunces', serif",
                  fontSize: 18, fontWeight: 400,
                }}>Profit & Cost Trend</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                  Cumulative metrics over time
                </div>
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                {[
                  { label: "Cost", color: "rgba(255,255,255,0.35)" },
                  { label: "Gross", color: "#d8a65a" },
                  { label: "Net", color: "#6aaa8e" },
                ].map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 14, height: 2, borderRadius: 1, background: l.color }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "'Geist Mono', monospace" }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <svg viewBox="0 0 640 200" style={{ width: "100%", height: 200 }}>
              <defs>
                <linearGradient id="amberFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#d8a65a" stopOpacity="0.1" />
                  <stop offset="100%" stopColor="#d8a65a" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((i) => (
                <line key={i} x1="30" y1={15 + i * 42} x2="620" y2={15 + i * 42}
                  stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              ))}
              <path d="M30,170 C130,160 230,138 340,108 S500,62 620,38" fill="none"
                stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
              <path d="M30,178 C130,172 230,155 340,135 S500,108 620,90" fill="none"
                stroke="#d8a65a" strokeWidth="2" />
              <path d="M30,178 C130,172 230,155 340,135 S500,108 620,90 L620,195 L30,195 Z"
                fill="url(#amberFill)" />
              <path d="M30,182 C130,178 230,165 340,148 S500,125 620,110" fill="none"
                stroke="#6aaa8e" strokeWidth="1.5" strokeDasharray="5,4" />
              {/* Moving glow dot */}
              <circle r="3" fill="#d8a65a" opacity="0.9">
                <animateMotion dur="5s" repeatCount="indefinite"
                  path="M30,178 C130,172 230,155 340,135 S500,108 620,90" />
              </circle>
              <circle r="8" fill="#d8a65a" opacity="0.15">
                <animateMotion dur="5s" repeatCount="indefinite"
                  path="M30,178 C130,172 230,155 340,135 S500,108 620,90" />
              </circle>
              <text x="30" y="195" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="Geist Mono, monospace">02-26</text>
              <text x="620" y="195" textAnchor="end" fill="rgba(255,255,255,0.1)" fontSize="9" fontFamily="Geist Mono, monospace">03-06</text>
            </svg>
          </div>
        </div>

        {/* BOTTOM ROW — Cards + Quick Stats + Recent */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1.4fr",
          gap: 14,
        }}>
          {/* Payment Cards */}
          <div className="glass" style={{
            padding: "24px",
            animation: "glassIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.4s both",
          }}>
            <div style={{
              fontSize: 10, fontFamily: "'Geist Mono', monospace",
              color: "rgba(255,255,255,0.2)", letterSpacing: "2px", marginBottom: 18,
            }}>PAYMENT CARDS</div>
            {DATA.cards.map((card, i) => (
              <div key={i} style={{
                padding: "18px 16px", borderRadius: 14,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
                marginBottom: 10,
                transition: "all 0.2s ease",
                cursor: "default",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{card.name}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "'Geist Mono', monospace", marginTop: 3 }}>
                      {card.txns} txn{card.txns > 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{
                    fontFamily: "'Fraunces', serif", fontSize: 20,
                    fontWeight: 400, color: "#d8a65a",
                  }}>${fmt(card.amount)}</div>
                </div>
                <div style={{ marginTop: 14, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.03)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    background: `linear-gradient(90deg, ${i === 0 ? "#d8a65a" : "#6aaa8e"}, transparent)`,
                    width: `${(card.amount / 1000) * 100}%`,
                    transition: "width 1.5s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Quick Stats Grid */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
            animation: "glassIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.45s both",
          }}>
            {[
              { label: "Items", value: "11", icon: "▤" },
              { label: "Margin", value: "38%", icon: "↗", highlight: true },
              { label: "Avg Cost", value: "$251", icon: "◇" },
              { label: "ROI", value: "32%", icon: "◎", highlight: true },
            ].map((stat, i) => (
              <div key={i} className="glass glass-sm" style={{
                padding: "20px",
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                borderColor: stat.highlight ? "rgba(216,166,90,0.1)" : undefined,
              }}>
                <div style={{
                  fontSize: 20, color: "rgba(255,255,255,0.08)",
                  marginBottom: 12,
                }}>{stat.icon}</div>
                <div>
                  <div style={{
                    fontFamily: "'Fraunces', serif", fontSize: 28,
                    fontWeight: 400, color: stat.highlight ? "#d8a65a" : "#e8e2d6",
                  }}>{stat.value}</div>
                  <div style={{
                    fontSize: 10, fontFamily: "'Geist Mono', monospace",
                    color: "rgba(255,255,255,0.2)", marginTop: 4, letterSpacing: "1px",
                  }}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Recent Sales */}
          <div className="glass" style={{
            padding: "24px",
            animation: "glassIn 0.7s cubic-bezier(0.22,1,0.36,1) 0.5s both",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{
                fontSize: 10, fontFamily: "'Geist Mono', monospace",
                color: "rgba(255,255,255,0.2)", letterSpacing: "2px",
              }}>RECENT SALES</div>
              <div style={{
                padding: "4px 10px", borderRadius: 8,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.04)",
                fontSize: 10, color: "rgba(255,255,255,0.2)",
                fontFamily: "'Geist Mono', monospace", cursor: "pointer",
              }}>View all →</div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Product", "Cost", "Sale", "Status"].map((h) => (
                    <th key={h} style={{
                      padding: "8px 12px", textAlign: "left",
                      fontSize: 9, color: "rgba(255,255,255,0.12)",
                      fontFamily: "'Geist Mono', monospace",
                      letterSpacing: "1px", fontWeight: 500,
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} style={{
                    padding: "48px 12px", textAlign: "center",
                    fontFamily: "'Fraunces', serif", fontSize: 14,
                    color: "rgba(255,255,255,0.1)", fontStyle: "italic",
                  }}>
                    No sales yet — start flipping!
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Floating Action Button */}
      <div style={{
        position: "fixed", bottom: 24, right: 28, zIndex: 200,
        animation: "glassIn 0.6s ease 0.6s both",
      }}>
        {fabOpen && (
          <div style={{
            position: "absolute", bottom: 56, right: 0,
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {fabActions.map((action, i) => (
              <div key={i} className="fab-btn" style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 18px",
                background: "rgba(15,17,20,0.9)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
                cursor: "pointer",
                animation: `floatUp 0.3s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.06}s both`,
                whiteSpace: "nowrap",
              }}>
                <span style={{ color: "#d8a65a", fontSize: 16, fontWeight: 600 }}>{action.icon}</span>
                <span style={{ fontSize: 13, color: "#e8e2d6" }}>{action.label}</span>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => setFabOpen(!fabOpen)} style={{
          width: 52, height: 52, borderRadius: 16,
          background: fabOpen
            ? "rgba(216,166,90,0.2)"
            : "linear-gradient(135deg, #d8a65a, #c4873a)",
          border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 24, color: fabOpen ? "#d8a65a" : "#0f1114",
          fontWeight: 300,
          transform: fabOpen ? "rotate(45deg)" : "none",
          transition: "all 0.3s cubic-bezier(0.22,1,0.36,1)",
          boxShadow: "0 8px 32px rgba(216,166,90,0.2)",
        }}>+</button>
      </div>
    </div>
  );
}
