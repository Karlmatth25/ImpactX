import { useState, useEffect, useRef, useCallback } from "react";

// ─── STORAGE HELPERS ──────────────────────────────────────────────────────────
const KEYS = {
  exercises: "impactx_exercises",
  motivations: "impactx_motivations",
  tips: "impactx_tips",
  resetAt: "impactx_reset_at",
};

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) { return fallback; }
}

function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

// ─── API ──────────────────────────────────────────────────────────────────────
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

async function callClaude(prompt, useSearch, maxTok) {
  const body = {
    model: MODEL,
    max_tokens: maxTok || 800,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch !== false) {
    body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  // Handle quota error specially
  if (res.status === 429 || res.status === 403) {
    const body2 = await res.json().catch(() => ({}));
    const resetAt = body2 && body2.resetsAt ? body2.resetsAt : null;
    const err = new Error("QUOTA_EXCEEDED");
    err.resetAt = resetAt;
    throw err;
  }

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e && e.error && e.error.message) || ("Erreur " + res.status));
  }

  const data = await res.json();
  const blocks = (data.content || []).slice().reverse();
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === "text" && blocks[i].text && blocks[i].text.trim()) {
      return blocks[i].text;
    }
  }
  return "";
}

// ─── JSON PARSER ──────────────────────────────────────────────────────────────
function safeJSON(raw) {
  if (!raw) throw new Error("Reponse vide");
  let s = raw.replace(/```json/gi, "").replace(/[\u0060]{3}/g, "").trim();
  try { return JSON.parse(s); } catch (_) {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) {}
    try { return JSON.parse(m[0].replace(/,(\s*[}\]])/g, "$1")); } catch (_) {}
  }
  function gs(k) {
    const r = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const x = s.match(r); return x ? x[1] : "";
  }
  function gn(k) {
    const r = new RegExp('"' + k + '"\\s*:\\s*(\\d+)');
    const x = s.match(r); return x ? parseInt(x[1], 10) : 5;
  }
  if (s.indexOf("score_fluidite") !== -1) {
    return { score_fluidite: gn("score_fluidite"), score_vocabulaire: gn("score_vocabulaire"), score_presence: gn("score_presence"), bilan: gs("bilan") || "Bonne tentative.", points_forts: gs("points_forts") || "Continue ainsi.", a_ameliorer: gs("a_ameliorer") || "Pratique encore.", reformulation: gs("reformulation") || "", exercice: gs("exercice") || "Relis a voix haute." };
  }
  if (s.indexOf('"quote"') !== -1) {
    return { quote: gs("quote") || s.slice(0, 180), author: gs("author") || "ImpactX", domain: gs("domain") || "Motivation", action: gs("action") || "Agis maintenant.", color_from: gs("color_from") || "#a78bfa", color_to: gs("color_to") || "#0a0a10" };
  }
  return { cat: gs("cat") || "Exercice", diff: gn("diff") || 2, text: gs("text") || s.slice(0, 280), tip: gs("tip") || "Lis lentement, a voix haute." };
}

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const REGS = {
  standard:   "naturel, fluide, accessible, authentique",
  pro:        "vocabulaire professionnel, termes metier, ton formel mais engageant",
  social:     "ton chaleureux, langage inclusif, connexion humaine",
  leadership: "ton inspirant, phrases d impact, vocabulaire du management",
  commercial: "techniques de vente, creer le desir, appel a l action",
  medias:     "phrases courtes, accroches, ton confiant et articule",
  juridique:  "vocabulaire juridique, argumentation formelle, precision",
  creatif:    "metaphores, storytelling creatif, surprise et originalite",
};

function pEx(c) {
  return [
    "Tu es coach expert en prise de parole. Genere UN exercice oral en francais pour le contexte " + c.label + " (" + c.desc + ").",
    "Registre : " + (REGS[c.id] || "naturel") + ".",
    "Inspire-toi de situations reelles actuelles via internet.",
    "Reponds UNIQUEMENT avec un JSON valide sans texte autour :",
    '{"cat":"' + c.label + '","diff":2,"text":"3 a 5 phrases a lire a voix haute","tip":"conseil specifique"}',
  ].join("\n");
}

function pAnalysis(ctxLabel, refText, spoken) {
  return [
    "Tu es coach expert en prise de parole. Contexte : " + ctxLabel + ".",
    "Texte de reference : " + refText,
    "Ce que la personne a dit : " + spoken,
    "Reponds UNIQUEMENT avec un JSON valide sans texte autour :",
    '{"score_fluidite":7,"score_vocabulaire":6,"score_presence":7,"bilan":"synthese","points_forts":"ce qui marche","a_ameliorer":"axes","reformulation":"version amelioree","exercice":"exercice personnalise"}',
  ].join("\n");
}

function pMot(domLabel) {
  return [
    "Tu es coach de vie expert en motivation. Genere UNE citation motivationnelle puissante en francais pour : " + domLabel + ".",
    "Inspire-toi de citations reelles d auteurs, entrepreneurs, athletes ou philosophes via internet.",
    "Reponds UNIQUEMENT avec un JSON valide sans texte autour :",
    '{"quote":"citation percutante","author":"nom auteur","domain":"' + domLabel + '","action":"action concrete aujourd hui","color_from":"#6366f1","color_to":"#1e1e30"}',
  ].join("\n");
}

function pTip() {
  return [
    "Tu es coach vocal expert. Genere UN conseil pratique original sur la technique vocale en francais.",
    "Cherche sur internet des techniques de grands orateurs reconnus.",
    "Reponds avec du texte simple, 4 a 5 phrases, ton direct et motivant. Pas de JSON.",
  ].join("\n");
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
const CONTEXTS = [
  { id: "standard",   label: "Standard",    icon: "🗣️",  desc: "Langage courant et naturel" },
  { id: "pro",        label: "Pro",          icon: "💼",  desc: "Reunions, presentations" },
  { id: "social",     label: "Social",       icon: "🤝",  desc: "Networking, rencontres" },
  { id: "leadership", label: "Leadership",   icon: "👑",  desc: "Manager, inspirer" },
  { id: "commercial", label: "Commercial",   icon: "📈",  desc: "Vente, pitch, convaincre" },
  { id: "medias",     label: "Medias",       icon: "🎙️", desc: "Interview, podcast" },
  { id: "juridique",  label: "Juridique",    icon: "⚖️",  desc: "Plaidoirie, argumentation" },
  { id: "creatif",    label: "Creatif",      icon: "🎨",  desc: "Pitcher une idee" },
];

const MOT_DOMAINS = [
  { id: "business",   label: "Business",   icon: "🚀", color: "#6366f1" },
  { id: "amour",      label: "Amour",      icon: "❤️", color: "#ec4899" },
  { id: "sport",      label: "Sport",      icon: "⚡", color: "#f59e0b" },
  { id: "argent",     label: "Argent",     icon: "💰", color: "#10b981" },
  { id: "mindset",    label: "Mindset",    icon: "🧠", color: "#8b5cf6" },
  { id: "famille",    label: "Famille",    icon: "🏡", color: "#06b6d4" },
  { id: "spirituel",  label: "Spirituel",  icon: "✨", color: "#a78bfa" },
  { id: "sante",      label: "Sante",      icon: "🌿", color: "#34d399" },
  { id: "creativite", label: "Creativite", icon: "🎭", color: "#fb7185" },
  { id: "resilience", label: "Resilience", icon: "🔥", color: "#f97316" },
  { id: "social",     label: "Social",     icon: "🌍", color: "#22d3ee" },
  { id: "carriere",   label: "Carriere",   icon: "🏆", color: "#eab308" },
];

const DEFAULT_EXERCISES = [
  { cat: "Standard",   diff: 1, context: "standard",   saved: true, text: "Bonjour a tous. Je m appelle Prenom. Aujourd hui je voudrais partager quelque chose qui me tient a coeur. Ce n est pas une grande revelation, simplement une lecon que la vie m a apprise de facon inattendue.", tip: "Parlez naturellement. Remplacez Prenom par votre prenom. Souriez." },
  { cat: "Pro",        diff: 2, context: "pro",         saved: true, text: "Bonjour a toutes et a tous. Je vous presente aujourd hui une initiative qui s inscrit pleinement dans notre feuille de route strategique. Nos indicateurs de performance demontrent une opportunite de croissance significative sur ce segment.", tip: "Articulez chaque terme technique. Marquez une pause apres chaque idee cle." },
  { cat: "Leadership", diff: 3, context: "leadership",  saved: true, text: "Une equipe ne suit pas un titre, elle suit une vision. Ma vision pour ce trimestre est claire : transformer chaque obstacle en levier. Je compte sur chacun d entre vous, non pas parce que c est votre metier, mais parce que vous etes capables de l extraordinaire.", tip: "Voix grave et posee. Regardez alternativement chaque membre imaginaire de l equipe." },
  { cat: "Commercial", diff: 2, context: "commercial",  saved: true, text: "Ce que je vais vous presenter n est pas un produit. C est une solution a un probleme que vous avez peut-etre appris a accepter. Dans les cinq prochaines minutes, je vais vous montrer exactement pourquoi vous ne pouvez plus vous permettre de l ignorer.", tip: "Creez de l urgence des l accroche. Ralentissez sur les mots cles." },
  { cat: "Social",     diff: 1, context: "social",      saved: true, text: "Enchante de vous rencontrer. Je travaille dans un domaine qui me passionne vraiment, et j adore rencontrer des gens qui voient les choses differemment. Qu est-ce qui vous a amene ici ce soir ?", tip: "Ton chaleureux, sourire naturel. Laissez de l espace pour que l autre reponde." },
  { cat: "Medias",     diff: 2, context: "medias",      saved: true, text: "Ce sujet me tient vraiment a coeur parce qu il touche directement la vie de milliers de personnes. Les chiffres parlent d eux-memes, mais derriere chaque statistique, il y a une histoire humaine. Et c est cette histoire que je veux vous raconter.", tip: "Phrases courtes et impactantes. Regardez la camera, pas l animateur." },
  { cat: "Creatif",    diff: 2, context: "creatif",     saved: true, text: "Imaginez un monde ou chaque idee folle devient une opportunite reelle. C est exactement ce que nous construisons. Pas une startup de plus. Un changement de paradigme. Petit par la taille, enorme par l ambition.", tip: "Laissez les metaphores respirer. Pause apres chaque image forte." },
  { cat: "Juridique",  diff: 3, context: "juridique",   saved: true, text: "Mesdames et messieurs, les faits sont etablis et incontestables. Les pieces versees au dossier demontrent avec une clarte absolue que les obligations contractuelles n ont pas ete respectees. Il vous appartient aujourd hui de retablir la justice.", tip: "Ton ferme et pose. Articulez chaque mot. Le silence apres une affirmation forte est votre allie." },
];

const DEFAULT_MOTIVATIONS = [
  { quote: "Le succes n est pas final, l echec n est pas fatal. C est le courage de continuer qui compte.", author: "Winston Churchill", domain: "Business", action: "Identifie une chose que tu remets depuis trop longtemps. Fais-la aujourd hui.", color_from: "#6366f1", color_to: "#1e1e30", saved: true },
  { quote: "Tu n as pas besoin de voir tout l escalier. Fais juste le premier pas.", author: "Martin Luther King", domain: "Mindset", action: "Quel est ton premier pas aujourd hui ? Ecris-le et fais-le dans l heure.", color_from: "#8b5cf6", color_to: "#0a0a10", saved: true },
  { quote: "La douleur est temporaire. Abandonner dure pour toujours.", author: "Lance Armstrong", domain: "Sport", action: "Depasse ta limite de confort aujourd hui, meme de 10%.", color_from: "#f59e0b", color_to: "#0a0a10", saved: true },
  { quote: "Votre temps est limite. Ne le gaspillez pas a vivre la vie de quelqu un d autre.", author: "Steve Jobs", domain: "Carriere", action: "Prends une decision que tu reportes par peur du regard des autres.", color_from: "#eab308", color_to: "#0a0a10", saved: true },
  { quote: "L amour n est pas seulement un sentiment. C est un choix que l on renouvelle chaque jour.", author: "Paulo Coelho", domain: "Amour", action: "Dis a quelqu un d important pour toi ce qu il represente pour toi.", color_from: "#ec4899", color_to: "#0a0a10", saved: true },
];

// ─── GLOBAL CSS ───────────────────────────────────────────────────────────────
const CSS = [
  "@import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@700;900&family=DM+Sans:wght@300;400;600;700&family=DM+Serif+Display:ital@0;1&display=swap');",
  "*{-webkit-tap-highlight-color:transparent;box-sizing:border-box;}",
  "body{margin:0;background:#080810;}",
  "::-webkit-scrollbar{display:none;}",
  "@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(167,139,250,.4)}70%{box-shadow:0 0 0 13px rgba(167,139,250,0)}100%{box-shadow:0 0 0 0 rgba(167,139,250,0)}}",
  "@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}",
  "@keyframes loadbar{0%{width:0;opacity:1}50%{width:76px;opacity:1}100%{width:0;opacity:0}}",
  "@keyframes wave{0%,100%{height:4px}50%{height:19px}}",
  "@keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",
  "@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}",
].join("");

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg: "#080810", surface: "#0e0e1e", surface2: "#181828",
  border: "#1a1a2e", border2: "#252540",
  purple: "#a78bfa", pink: "#f472b6", amber: "#f59e0b",
  green: "#34d399", muted: "#2a2a4a", text: "#e8e6f0", textDim: "#8888aa",
};

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────────
function Skel() {
  return (
    <div>
      {[100, 84, 66].map((w, i) => (
        <div key={i} style={{ height: "10px", borderRadius: "4px", marginBottom: "9px", width: w + "%", background: "linear-gradient(90deg," + C.surface2 + " 25%," + C.border2 + " 50%," + C.surface2 + " 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s ease infinite" }} />
      ))}
    </div>
  );
}

function Spin({ text }) {
  return (
    <div style={{ textAlign: "center", padding: "1.2rem", color: C.muted, fontSize: "0.65rem", letterSpacing: "2px", textTransform: "uppercase" }}>
      {text || "Generation en cours..."}
      <div style={{ width: "36px", height: "2px", background: "linear-gradient(90deg," + C.purple + "," + C.pink + ")", margin: "0.5rem auto 0", animation: "loadbar 1.2s ease infinite" }} />
    </div>
  );
}

function QuotaAlert({ resetAt, onDismiss }) {
  function fmtTime(ts) {
    if (!ts) return "quelques heures";
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return (
    <div style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: "12px", padding: "1rem 1.1rem", marginTop: "0.75rem", animation: "fadein .3s ease" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.5rem", flexShrink: 0 }}>⏳</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: C.purple, marginBottom: "0.3rem" }}>
            Limite de session atteinte
          </div>
          <div style={{ fontSize: "0.72rem", color: C.textDim, lineHeight: 1.6, marginBottom: "0.6rem" }}>
            Ton quota se reinitialise automatiquement a {fmtTime(resetAt)}. En attendant, utilise les contenus sauvegardes ci-dessous — ils fonctionnent sans connexion.
          </div>
          <button onClick={onDismiss} style={{ background: "rgba(167,139,250,0.15)", border: "none", color: C.purple, padding: "0.35rem 0.8rem", borderRadius: "20px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}

function SavedBadge() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", background: "rgba(52,211,153,0.12)", color: C.green, fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", padding: "0.18rem 0.5rem", borderRadius: "20px", marginLeft: "0.4rem" }}>
      ✓ Sauvegarde
    </span>
  );
}

function Pill({ label, val }) {
  const col = val >= 7 ? C.green : val >= 4 ? C.amber : C.pink;
  return (
    <div style={{ background: C.surface2, border: "1px solid " + C.border2, borderRadius: "8px", padding: "0.38rem 0.65rem", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "0.3rem" }}>
      <span style={{ fontFamily: "'Unbounded',sans-serif", fontSize: "0.95rem", color: col }}>{val}/10</span>
      {label}
    </div>
  );
}

function DiffDots({ n }) {
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "0.4rem" }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: i < n ? C.amber : C.border }} />
      ))}
    </div>
  );
}

function Waves({ on }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "3px", height: "26px", margin: "0.3rem 0" }}>
      {Array(8).fill(0).map((_, i) => (
        <div key={i} style={{ width: "3px", background: C.purple, borderRadius: "2px", height: "4px", opacity: on ? 1 : 0.2, animation: on ? ("wave .8s ease " + (i * 0.09) + "s infinite") : "none" }} />
      ))}
    </div>
  );
}

const MicSvg = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
  </svg>
);
const StopSvg = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

// ─── SHARED CARD SHELL ────────────────────────────────────────────────────────
function Card({ children, accent, style }) {
  return (
    <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", padding: "1.2rem", marginBottom: "0.8rem", position: "relative", overflow: "hidden", ...style }}>
      {accent !== false && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg," + C.purple + "," + C.pink + ")" }} />
      )}
      {children}
    </div>
  );
}

const pg    = { padding: "1.2rem 1.2rem 5.5rem" };
const ttl   = { fontFamily: "'Unbounded',sans-serif", fontSize: "1.05rem", fontWeight: 900, letterSpacing: "-0.5px", marginBottom: "0.15rem" };
const sub   = { fontSize: "0.62rem", color: C.muted, marginBottom: "1.1rem", letterSpacing: "1px", textTransform: "uppercase" };
const badge = { display: "inline-block", background: "rgba(167,139,250,0.1)", color: C.purple, fontSize: "0.56rem", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", padding: "0.2rem 0.55rem", borderRadius: "20px", marginBottom: "0.7rem" };
const btnSm = { flex: 1, minWidth: "100px", background: C.surface2, border: "1px solid " + C.border2, color: C.text, padding: "0.58rem 0.5rem", borderRadius: "8px", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", cursor: "pointer" };
const genBtn = { width: "100%", background: "transparent", border: "1px dashed " + C.border2, color: C.purple, padding: "0.82rem", borderRadius: "10px", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer", marginBottom: "0.9rem" };

// ═══ COACH TAB ════════════════════════════════════════════════════════════════
function CoachTab({ preloaded, onClearPreload }) {
  const [ctxId, setCtxId] = useState("standard");
  const [ex, setEx] = useState(DEFAULT_EXERCISES[0]);
  const [genLoad, setGenLoad] = useState(false);
  const [quotaErr, setQuotaErr] = useState(null);
  const [genErr, setGenErr] = useState("");
  const [tx, setTx] = useState("");
  const [rec, setRec] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [anLoad, setAnLoad] = useState(false);
  const [anErr, setAnErr] = useState("");
  const [anQuota, setAnQuota] = useState(null);
  const recRef = useRef(null);

  useEffect(() => {
    if (preloaded) {
      setEx(preloaded);
      setTx("");
      setAnalysis(null);
      setGenErr("");
      setQuotaErr(null);
      onClearPreload();
    }
  }, [preloaded]);

  const ctx = CONTEXTS.find(c => c.id === ctxId) || CONTEXTS[0];

  async function doGen(id) {
    const c = CONTEXTS.find(x => x.id === id) || CONTEXTS[0];
    setGenLoad(true);
    setGenErr("");
    setQuotaErr(null);
    setTx("");
    setAnalysis(null);
    try {
      const raw = await callClaude(pEx(c), true, 600);
      const json = safeJSON(raw);
      json.context = c.id;
      json.saved = true;
      json.ts = Date.now();
      setEx(json);
      // Save to library
      const lib = lsGet(KEYS.exercises, DEFAULT_EXERCISES);
      lsSet(KEYS.exercises, [json, ...lib.slice(0, 49)]);
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") {
        setQuotaErr(e.resetAt);
      } else {
        setGenErr(e.message);
      }
    }
    setGenLoad(false);
  }

  function switchCtx(id) {
    setCtxId(id);
    const s = DEFAULT_EXERCISES.find(x => x.context === id);
    if (s) { setEx(s); setTx(""); setAnalysis(null); setGenErr(""); setQuotaErr(null); }
    else doGen(id);
  }

  function startRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Utilisez Safari sur iPhone ou Chrome pour la reconnaissance vocale."); return; }
    const r = new SR();
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    let fin = "";
    r.onstart = () => setRec(true);
    r.onresult = e => {
      let it = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript + " ";
        else it = e.results[i][0].transcript;
      }
      setTx(fin + it);
    };
    r.onerror = e => { setRec(false); if (e.error === "not-allowed") alert("Autorisez le microphone dans les reglages Safari."); };
    r.onend = () => setRec(false);
    r.start();
    recRef.current = r;
  }

  function stopRec() { if (recRef.current) recRef.current.stop(); setRec(false); }

  async function doAnalyze() {
    setAnLoad(true);
    setAnErr("");
    setAnQuota(null);
    setAnalysis(null);
    try {
      const raw = await callClaude(pAnalysis(ctx.label, ex.text, tx.trim()), false, 900);
      setAnalysis(safeJSON(raw));
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") setAnQuota(e.resetAt);
      else setAnErr(e.message);
    }
    setAnLoad(false);
  }

  const canAnalyze = tx.trim().length > 8 && !anLoad;

  return (
    <div style={pg}>
      <div style={ttl}>Coach Vocal</div>
      <div style={sub}>Contexte adapte · IA + Mode hors-ligne</div>

      {/* Context grid */}
      <Card>
        <div style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: C.muted, marginBottom: "0.7rem" }}>
          Choisissez votre contexte
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0.5rem" }}>
          {CONTEXTS.map(c => (
            <button key={c.id} onClick={() => switchCtx(c.id)}
              style={{ background: ctxId === c.id ? "rgba(167,139,250,0.1)" : C.bg, border: "1px solid " + (ctxId === c.id ? C.purple : C.border), borderRadius: "10px", padding: "0.65rem", cursor: "pointer", textAlign: "left", color: C.text, transition: "all .2s" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.18rem" }}>{c.icon}</div>
              <div style={{ fontSize: "0.65rem", fontWeight: 700 }}>{c.label}</div>
              <div style={{ fontSize: "0.55rem", color: C.muted, marginTop: "2px", lineHeight: 1.4 }}>{c.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Exercise */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.7rem" }}>
          <span style={badge}>{ex.cat || ctx.label}</span>
          {ex.saved && <SavedBadge />}
        </div>
        <DiffDots n={ex.diff || 1} />
        {genLoad ? <Skel /> : <div style={{ fontSize: "0.95rem", lineHeight: 1.75, fontWeight: 300, fontStyle: "italic", marginBottom: "0.7rem" }}>{ex.text}</div>}
        {!genLoad && <div style={{ fontSize: "0.7rem", color: C.amber, fontWeight: 600, lineHeight: 1.5 }}>🗣 {ex.tip}</div>}
        {genErr && (
          <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "0.7rem", fontSize: "0.72rem", color: "#fca5a5", marginTop: "0.6rem" }}>
            ⚠️ {genErr}
            <button onClick={() => doGen(ctxId)} style={{ display: "block", marginTop: "0.4rem", background: "none", border: "1px solid " + C.pink, color: C.pink, padding: "0.3rem 0.7rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.68rem" }}>Reessayer</button>
          </div>
        )}
        {quotaErr && <QuotaAlert resetAt={quotaErr} onDismiss={() => setQuotaErr(null)} />}
        <div style={{ display: "flex", gap: "0.55rem", marginTop: "0.9rem" }}>
          <button style={btnSm} disabled={genLoad} onClick={() => doGen(ctxId)}>
            {genLoad ? "Generation..." : "✦ Nouveau texte IA"}
          </button>
        </div>
      </Card>

      {/* Mic */}
      <div style={{ textAlign: "center", padding: "1.1rem 0 0.55rem" }}>
        <button onClick={rec ? stopRec : startRec}
          style={{ width: "72px", height: "72px", borderRadius: "50%", border: "2px solid " + (rec ? "transparent" : C.purple), background: rec ? "linear-gradient(135deg," + C.purple + "," + C.pink + ")" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 0.6rem", color: rec ? "#fff" : C.purple, animation: rec ? "pulse 1.2s ease infinite" : "none" }}>
          {rec ? <StopSvg /> : <MicSvg />}
        </button>
        <Waves on={rec} />
        <div style={{ fontSize: "0.6rem", letterSpacing: "2px", textTransform: "uppercase", color: rec ? C.pink : C.muted, fontWeight: 700 }}>
          {rec ? "EN ECOUTE — APPUYER POUR ARRETER" : "APPUYER POUR PARLER"}
        </div>
      </div>

      <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "10px", padding: "0.9rem", margin: "0.6rem 0", minHeight: "55px", fontSize: "0.83rem", lineHeight: 1.65, fontStyle: tx ? "italic" : "normal", fontWeight: 300, color: tx ? C.text : C.muted, whiteSpace: "pre-wrap" }}>
        {tx || "Votre discours apparaitra ici apres l enregistrement..."}
      </div>

      <button disabled={!canAnalyze} onClick={doAnalyze}
        style={{ width: "100%", padding: "0.95rem", borderRadius: "10px", fontSize: "0.78rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", cursor: canAnalyze ? "pointer" : "not-allowed", border: "none", background: canAnalyze ? "linear-gradient(135deg," + C.purple + "," + C.pink + ")" : C.surface2, color: canAnalyze ? "#fff" : C.muted, marginTop: "0.4rem" }}>
        {anLoad ? "Analyse en cours..." : "Analyser mon discours"}
      </button>

      {anErr && (
        <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "0.7rem", fontSize: "0.72rem", color: "#fca5a5", marginTop: "0.6rem" }}>
          ⚠️ {anErr}
          <button onClick={doAnalyze} style={{ display: "block", marginTop: "0.4rem", background: "none", border: "1px solid " + C.pink, color: C.pink, padding: "0.3rem 0.7rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.68rem" }}>Reessayer</button>
        </div>
      )}
      {anQuota && <QuotaAlert resetAt={anQuota} onDismiss={() => setAnQuota(null)} />}
      {anLoad && <Spin text="L IA analyse votre discours..." />}

      {analysis && (
        <div style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "12px", padding: "1.2rem", marginTop: "0.9rem", animation: "fadein .4s ease" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.9rem", fontSize: "0.65rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: C.purple }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: C.purple, animation: "pulse 1.5s ease infinite" }} />
            Retour du Coach
          </div>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem", flexWrap: "wrap" }}>
            <Pill label="Fluidite"    val={analysis.score_fluidite    || 5} />
            <Pill label="Vocabulaire" val={analysis.score_vocabulaire || 5} />
            <Pill label="Presence"    val={analysis.score_presence    || 5} />
          </div>
          {[["🎯 Bilan","bilan",false],["✅ Points forts","points_forts",false],["🔧 A ameliorer","a_ameliorer",false],["✏️ Version amelioree","reformulation",true],["🎤 Exercice pour toi","exercice",false]].map(([t,k,it]) => (
            <div key={k} style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: C.amber, marginBottom: "0.22rem" }}>{t}</div>
              <div style={{ fontSize: "0.8rem", lineHeight: 1.75, fontWeight: 300, fontStyle: it ? "italic" : "normal", color: it ? C.textDim : C.text }}>{analysis[k] || "—"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ EXERCISES TAB ════════════════════════════════════════════════════════════
function ExercisesTab({ onLoad }) {
  const [filter, setFilter] = useState("Tous");
  const [lib, setLib] = useState(() => lsGet(KEYS.exercises, DEFAULT_EXERCISES));
  const [loading, setLoading] = useState(false);
  const [quotaErr, setQuotaErr] = useState(null);
  const [err, setErr] = useState("");

  async function doGen() {
    setLoading(true);
    setErr("");
    setQuotaErr(null);
    const pool = filter === "Tous" ? CONTEXTS : CONTEXTS.filter(c => c.label === filter);
    const c = pool[Math.floor(Math.random() * pool.length)];
    try {
      const raw = await callClaude(pEx(c), true, 600);
      const json = safeJSON(raw);
      json.context = c.id;
      json.saved = true;
      json.ts = Date.now();
      const next = [json, ...lib.slice(0, 49)];
      setLib(next);
      lsSet(KEYS.exercises, next);
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") setQuotaErr(e.resetAt);
      else setErr(e.message);
    }
    setLoading(false);
  }

  function del(i) {
    const next = lib.filter((_, idx) => idx !== i);
    setLib(next);
    lsSet(KEYS.exercises, next);
  }

  const shown = filter === "Tous" ? lib : lib.filter(e => e.cat === filter || e.context === filter.toLowerCase());

  return (
    <div style={pg}>
      <div style={ttl}>Bibliotheque</div>
      <div style={sub}>{lib.length} exercice{lib.length > 1 ? "s" : ""} sauvegardes · Illimite · Hors-ligne</div>

      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {["Tous", ...CONTEXTS.map(c => c.label)].map(l => (
          <button key={l} onClick={() => setFilter(l)}
            style={{ background: filter === l ? "rgba(167,139,250,0.1)" : C.surface, border: "1px solid " + (filter === l ? C.purple : C.border), color: filter === l ? C.purple : C.muted, padding: "0.3rem 0.65rem", borderRadius: "20px", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1px", cursor: "pointer", whiteSpace: "nowrap" }}>
            {l}
          </button>
        ))}
      </div>

      <button style={genBtn} disabled={loading} onClick={doGen}>
        {loading ? "Generation IA en cours..." : "✦ Generer et sauvegarder (IA)"}
      </button>
      {err && (
        <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "0.7rem", fontSize: "0.72rem", color: "#fca5a5", marginBottom: "0.75rem" }}>
          ⚠️ {err}
          <button onClick={doGen} style={{ display: "block", marginTop: "0.4rem", background: "none", border: "1px solid " + C.pink, color: C.pink, padding: "0.3rem 0.7rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.68rem" }}>Reessayer</button>
        </div>
      )}
      {quotaErr && <QuotaAlert resetAt={quotaErr} onDismiss={() => setQuotaErr(null)} />}

      {shown.length === 0 && (
        <div style={{ color: C.muted, fontSize: "0.8rem", textAlign: "center", padding: "2rem 1rem" }}>
          Generez votre premier exercice ou attendez le reset du quota.
        </div>
      )}

      {shown.map((ex, i) => {
        const realIdx = lib.indexOf(ex);
        return (
          <div key={i} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "14px", padding: "1.1rem 1.1rem 1.1rem 1.4rem", marginBottom: "0.7rem", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "3px", background: "linear-gradient(180deg," + C.purple + "," + C.pink + ")", borderRadius: "14px 0 0 14px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.4rem" }}>
              <span style={badge}>{ex.cat}</span>
              <SavedBadge />
            </div>
            <div style={{ fontSize: "0.8rem", lineHeight: 1.55, fontWeight: 300, marginBottom: "0.55rem", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{ex.text}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <DiffDots n={ex.diff || 1} />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => del(realIdx)} style={{ background: "none", border: "none", color: C.muted, fontSize: "0.6rem", cursor: "pointer" }}>✕</button>
                <button onClick={() => onLoad(ex)} style={{ background: "none", border: "none", color: C.amber, fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", cursor: "pointer" }}>UTILISER →</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══ MOTIVATION TAB ═══════════════════════════════════════════════════════════
function MotivationTab() {
  const [domId, setDomId] = useState("business");
  const [quote, setQuote] = useState(DEFAULT_MOTIVATIONS[0]);
  const [loading, setLoading] = useState(false);
  const [quotaErr, setQuotaErr] = useState(null);
  const [err, setErr] = useState("");
  const [notif, setNotif] = useState(false);
  const [saved, setSaved] = useState(() => lsGet(KEYS.motivations, DEFAULT_MOTIVATIONS));
  const dom = MOT_DOMAINS.find(d => d.id === domId) || MOT_DOMAINS[0];
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  async function doGen(id) {
    const d = MOT_DOMAINS.find(x => x.id === id) || MOT_DOMAINS[0];
    setLoading(true);
    setErr("");
    setQuotaErr(null);
    try {
      const raw = await callClaude(pMot(d.label), true, 600);
      const q = safeJSON(raw);
      q.saved = true;
      q.ts = Date.now();
      setQuote(q);
      const next = [q, ...saved.slice(0, 29)];
      setSaved(next);
      lsSet(KEYS.motivations, next);
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") setQuotaErr(e.resetAt);
      else setErr(e.message);
    }
    setLoading(false);
  }

  function loadSaved(q) { setQuote(q); setDomId(MOT_DOMAINS.find(d => d.label === q.domain)?.id || "business"); }

  async function askNotif() {
    if (!("Notification" in window)) { alert("Notifications non supportees."); return; }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      setNotif(true);
      new Notification("ImpactX - Motivation du jour", { body: (quote && quote.quote ? quote.quote.slice(0, 100) : "") + "..." });
    }
  }

  function download() {
    if (!quote) return;
    const from = quote.color_from || dom.color;
    const to = quote.color_to || "#080810";
    const q = (quote.quote || "").replace(/"/g, "&quot;");
    const html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><link href='https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@1&family=DM+Sans:wght@400;700&display=swap' rel='stylesheet'><style>*{margin:0;padding:0;box-sizing:border-box}body{width:1080px;height:1080px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg," + from + "," + to + ");font-family:'DM Sans',sans-serif;position:relative}.w{background:rgba(0,0,0,.38);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.1);border-radius:32px;padding:80px;max-width:880px;color:#fff}.ic{font-size:64px;margin-bottom:36px}.q{font-family:'DM Serif Display',serif;font-size:42px;line-height:1.45;font-style:italic;margin-bottom:40px}.au{font-size:20px;font-weight:700;opacity:.65;margin-bottom:6px}.dm{font-size:14px;letter-spacing:3px;text-transform:uppercase;opacity:.35;margin-bottom:40px}.act{font-size:17px;background:rgba(255,255,255,.08);border-radius:12px;padding:18px 22px;border-left:4px solid " + from + "}.br{position:absolute;bottom:44px;right:60px;font-size:13px;letter-spacing:3px;opacity:.22;text-transform:uppercase}</style></head><body><div class='w'><div class='ic'>" + dom.icon + "</div><div class='q'>&ldquo;" + q + "&rdquo;</div><div class='au'>&#8212; " + (quote.author || "ImpactX") + "</div><div class='dm'>" + (quote.domain || dom.label) + "</div>" + (quote.action ? "<div class='act'>Action : " + quote.action + "</div>" : "") + "</div><div class='br'>ImpactX</div></body></html>";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = "impactx-" + domId + "-" + Date.now() + ".html";
    a.click();
  }

  function share() {
    if (navigator.share && quote) navigator.share({ title: "Motivation ImpactX", text: (quote.quote || "") + " — " + (quote.author || "") });
  }

  const from = (quote && quote.color_from) || dom.color;
  const to = (quote && quote.color_to) || "#0a0a10";

  return (
    <div style={pg}>
      <div style={ttl}>Motivation</div>
      <div style={sub}>{today} · {saved.length} citation{saved.length > 1 ? "s" : ""} sauvegardee{saved.length > 1 ? "s" : ""}</div>

      <div onClick={askNotif} style={{ background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.18)", borderRadius: "10px", padding: "0.75rem 0.9rem", display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "1rem", cursor: "pointer" }}>
        <span style={{ fontSize: "1.2rem" }}>🔔</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: C.purple, marginBottom: "2px" }}>{notif ? "✅ Notifications activees" : "Activer la motivation du jour"}</div>
          <div style={{ fontSize: "0.62rem", color: C.muted }}>{notif ? "Vous recevrez votre dose quotidienne." : "Recevez une motivation chaque matin."}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0.5rem", marginBottom: "1.1rem" }}>
        {MOT_DOMAINS.map(d => (
          <button key={d.id} onClick={() => { setDomId(d.id); doGen(d.id); }}
            style={{ background: domId === d.id ? "rgba(167,139,250,0.08)" : C.surface, border: "1px solid " + (domId === d.id ? d.color : C.border), borderRadius: "10px", padding: "0.65rem 0.4rem", cursor: "pointer", textAlign: "center", color: C.text, transition: "all .2s" }}>
            <div style={{ fontSize: "1.25rem", marginBottom: "0.18rem" }}>{d.icon}</div>
            <div style={{ fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: domId === d.id ? d.color : C.muted }}>{d.label}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ background: from + "18", border: "1px solid " + C.border, borderRadius: "16px", padding: "1.5rem", marginBottom: "0.7rem" }}>
          <Spin text="L IA cherche votre motivation..." />
        </div>
      ) : err ? (
        <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "10px", padding: "0.85rem", fontSize: "0.75rem", color: "#fca5a5", marginBottom: "0.75rem" }}>
          ⚠️ {err}
          <button onClick={() => doGen(domId)} style={{ display: "block", marginTop: "0.4rem", background: "none", border: "1px solid " + C.pink, color: C.pink, padding: "0.3rem 0.7rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.68rem" }}>Reessayer</button>
        </div>
      ) : quote ? (
        <div style={{ background: "linear-gradient(135deg," + from + "28," + to + "bb)", border: "1px solid " + from + "30", borderRadius: "16px", padding: "1.5rem", marginBottom: "0.7rem", animation: "fadein .4s ease" }}>
          <div style={{ fontSize: "1.7rem", marginBottom: "0.6rem" }}>{dom.icon}</div>
          <div style={{ fontFamily: "'DM Serif Display',serif", fontSize: "clamp(0.95rem,3.5vw,1.2rem)", lineHeight: 1.65, fontStyle: "italic", marginBottom: "0.9rem", color: "#f0ece4" }}>
            "{quote.quote}"
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.45rem", marginBottom: "0.75rem" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, opacity: 0.7 }}>— {quote.author}</div>
              <div style={{ fontSize: "0.55rem", letterSpacing: "2px", textTransform: "uppercase", opacity: 0.4 }}>{quote.domain}</div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {[["⬇️ Telecharger", download], ["↗️ Partager", share]].map(([lbl, fn]) => (
                <button key={lbl} onClick={fn} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: "0.35rem 0.65rem", borderRadius: "20px", fontSize: "0.6rem", fontWeight: 700, cursor: "pointer" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
          {quote.action && (
            <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "9px", padding: "0.7rem 0.85rem", fontSize: "0.75rem", borderLeft: "3px solid " + from }}>
              <span style={{ fontWeight: 700, color: from }}>💡 Action du jour : </span>{quote.action}
            </div>
          )}
        </div>
      ) : null}

      {quotaErr && <QuotaAlert resetAt={quotaErr} onDismiss={() => setQuotaErr(null)} />}

      <button style={genBtn} disabled={loading} onClick={() => doGen(domId)}>
        {loading ? "Generation..." : "✦ Nouvelle motivation IA"}
      </button>

      {saved.length > 0 && (
        <div>
          <div style={{ ...sub, marginTop: "0.5rem", marginBottom: "0.65rem" }}>Mes citations sauvegardees ({saved.length})</div>
          {saved.map((h, i) => {
            const d = MOT_DOMAINS.find(x => x.label === h.domain) || MOT_DOMAINS[0];
            return (
              <div key={i} onClick={() => loadSaved(h)} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "12px", padding: "1rem 1rem 1rem 1.1rem", marginBottom: "0.6rem", borderLeft: "3px solid " + d.color + "55", cursor: "pointer" }}>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.3rem" }}>
                  <span>{d.icon}</span>
                  <span style={{ fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: d.color }}>{h.domain}</span>
                  <SavedBadge />
                </div>
                <div style={{ fontSize: "0.77rem", fontStyle: "italic", color: C.textDim, lineHeight: 1.6 }}>
                  "{(h.quote || "").slice(0, 120)}{h.quote && h.quote.length > 120 ? "..." : ""}"
                </div>
                <div style={{ fontSize: "0.62rem", color: C.muted, marginTop: "0.3rem" }}>— {h.author}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══ TIPS TAB ═════════════════════════════════════════════════════════════════
function TipsTab() {
  const [aiTips, setAiTips] = useState(() => lsGet(KEYS.tips, []));
  const [loading, setLoading] = useState(false);
  const [quotaErr, setQuotaErr] = useState(null);
  const [err, setErr] = useState("");

  const STATIC_TIPS = [
    { icon: "🎸", title: "LA VOIX ROCK",       body: "Une voix rock n est pas criee, elle est ancree. Parlez depuis le ventre, pas depuis la gorge. Baissez legerement la tete avant de prendre la parole. Visez un registre grave et pose, avec des montees intentionnelles sur les mots forts." },
    { icon: "💼", title: "EN CONTEXTE PRO",    body: "En reunion, commencez toujours par une phrase synthese avant le detail. Utilisez nous pour inclure, je pour les responsabilites. Remplacez les uh, donc, voila par des silences intentionnels." },
    { icon: "🌬️", title: "LE SOUFFLE",         body: "Avant de parler, inspirez 4 secondes, retenez 2 secondes, expirez sur votre phrase. La nervosite coupe le souffle. Posez une main sur le ventre, c est lui qui doit bouger." },
    { icon: "⏸️", title: "LE SILENCE",         body: "Les meilleurs orateurs habitent le silence. Une pause de 2 secondes apres une idee forte la grave dans l esprit de l auditeur. Ne remplissez pas le vide, il travaille pour vous." },
    { icon: "👁️", title: "LE REGARD",          body: "Choisissez une personne reelle, parlez-lui 3-4 secondes, puis passez a une autre. Sur iPhone, regardez la camera frontale, pas l ecran. Le regard cree la connexion." },
    { icon: "🤝", title: "CONTEXTE SOCIAL",    body: "Posez des questions ouvertes. Ecoutez activement. Repetez le prenom de votre interlocuteur 1 a 2 fois dans la conversation pour creer une connexion immmediate." },
    { icon: "🗣️", title: "ARTICULER",          body: "Dites Pa-Ta-Ka-Ra 10 fois en accelerant. Lisez votre texte avec un crayon entre les dents. Retirez-le : vous parlerez instantanement plus clair." },
    { icon: "📱", title: "S ENREGISTRER",      body: "Enregistrez-vous chaque jour, 30 secondes minimum. Recoutez sans vous juger. Notez une seule chose a ameliorer. La video est encore plus efficace." },
  ];

  async function doGenTip() {
    setLoading(true);
    setErr("");
    setQuotaErr(null);
    try {
      const raw = await callClaude(pTip(), true, 400);
      const tip = { icon: "🤖", title: "CONSEIL IA DU " + new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short" }).toUpperCase(), body: raw.trim(), ts: Date.now(), saved: true };
      const next = [tip, ...aiTips.slice(0, 19)];
      setAiTips(next);
      lsSet(KEYS.tips, next);
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") setQuotaErr(e.resetAt);
      else setErr(e.message);
    }
    setLoading(false);
  }

  return (
    <div style={pg}>
      <div style={ttl}>Conseils</div>
      <div style={sub}>Technique vocale · {aiTips.length} conseil{aiTips.length > 1 ? "s" : ""} IA sauvegardes</div>

      {STATIC_TIPS.map((t, i) => (
        <div key={i} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "12px", padding: "1.1rem", marginBottom: "0.65rem" }}>
          <div style={{ fontSize: "1.3rem", marginBottom: "0.38rem" }}>{t.icon}</div>
          <div style={{ fontFamily: "'Unbounded',sans-serif", fontSize: "0.78rem", fontWeight: 900, letterSpacing: "1px", marginBottom: "0.38rem" }}>{t.title}</div>
          <div style={{ fontSize: "0.75rem", lineHeight: 1.75, color: "#777799", fontWeight: 300 }}>{t.body}</div>
        </div>
      ))}

      <button style={genBtn} disabled={loading} onClick={doGenTip}>
        {loading ? "Generation..." : "✦ Conseil IA du moment (sauvegarde)"}
      </button>
      {err && (
        <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "0.7rem", fontSize: "0.72rem", color: "#fca5a5", marginBottom: "0.75rem" }}>
          ⚠️ {err}
          <button onClick={doGenTip} style={{ display: "block", marginTop: "0.4rem", background: "none", border: "1px solid " + C.pink, color: C.pink, padding: "0.3rem 0.7rem", borderRadius: "6px", cursor: "pointer", fontSize: "0.68rem" }}>Reessayer</button>
        </div>
      )}
      {quotaErr && <QuotaAlert resetAt={quotaErr} onDismiss={() => setQuotaErr(null)} />}
      {loading && <Spin text="Recherche des meilleurs conseils..." />}

      {aiTips.length > 0 && (
        <div>
          <div style={{ ...sub, marginTop: "0.5rem", marginBottom: "0.65rem" }}>Mes conseils IA sauvegardes</div>
          {aiTips.map((t, i) => (
            <div key={i} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: "12px", padding: "1.1rem", marginBottom: "0.65rem", borderLeft: "3px solid " + C.purple + "55" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "1.1rem" }}>{t.icon}</span>
                <div style={{ fontFamily: "'Unbounded',sans-serif", fontSize: "0.72rem", fontWeight: 900, letterSpacing: "1px", flex: 1 }}>{t.title}</div>
                <SavedBadge />
              </div>
              <div style={{ fontSize: "0.75rem", lineHeight: 1.75, color: C.textDim, fontWeight: 300 }}>{t.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ ROOT ═════════════════════════════════════════════════════════════════════
const TABS_CFG = [
  { e: "🎙", l: "Coach" },
  { e: "📚", l: "Biblio" },
  { e: "🔥", l: "Motiv" },
  { e: "💡", l: "Conseils" },
];

export default function App() {
  const [tab, setTab] = useState(0);
  const [preloaded, setPreloaded] = useState(null);

  function handleLoad(ex) { setPreloaded(ex); setTab(0); }

  const views = [
    <CoachTab key={preloaded ? preloaded.text : "coach"} preloaded={preloaded} onClearPreload={() => setPreloaded(null)} />,
    <ExercisesTab onLoad={handleLoad} />,
    <MotivationTab />,
    <TipsTab />,
  ];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans',sans-serif", overflowX: "hidden" }}>
        <header style={{ padding: "1.1rem 1.3rem 0.8rem", borderBottom: "1px solid " + C.border, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0b0b1a" }}>
          <div>
            <div style={{ fontFamily: "'Unbounded',sans-serif", fontSize: "clamp(1.4rem,6vw,2rem)", fontWeight: 900, letterSpacing: "-1px", lineHeight: 1, background: "linear-gradient(135deg,#a78bfa 0%,#f472b6 55%,#fb923c 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              ImpactX
            </div>
            <div style={{ fontSize: "0.55rem", letterSpacing: "3px", textTransform: "uppercase", color: C.muted, marginTop: "2px" }}>
              Coach Vocal · IA · Hors-ligne
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.6rem", fontWeight: 700, color: C.green, letterSpacing: "1px" }}>💾 Auto-sauvegarde</div>
            <div style={{ fontSize: "0.55rem", color: C.muted, marginTop: "1px" }}>Tout est conserve localement</div>
          </div>
        </header>

        <div style={{ display: "flex", borderBottom: "1px solid " + C.border, background: "#0b0b1a", overflowX: "auto", scrollbarWidth: "none" }}>
          {TABS_CFG.map((t, i) => (
            <button key={i} onClick={() => setTab(i)}
              style={{ flex: 1, minWidth: "65px", padding: "0.8rem 0.3rem", textAlign: "center", fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: tab === i ? C.purple : C.muted, background: "transparent", border: "none", cursor: "pointer", borderBottom: "2px solid " + (tab === i ? C.purple : "transparent"), transition: "all .2s", whiteSpace: "nowrap" }}>
              {t.e} {t.l}
            </button>
          ))}
        </div>

        {views[tab]}
      </div>
    </>
  );
}
