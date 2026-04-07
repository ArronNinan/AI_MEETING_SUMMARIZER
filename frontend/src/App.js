import React, { useState, useEffect, useRef } from "react";
import "./App.css";
import {
  FaFileAudio, FaAlignLeft, FaFileAlt, FaDownload,
  FaMoon, FaSun, FaMicrophone, FaStop, FaCircle,
  FaLanguage, FaUsers, FaUserCircle, FaClipboardList,
  FaHistory, FaTrash, FaChevronDown,
  FaFileWord, FaFilePdf, FaTimes, FaExternalLinkAlt, FaArrowDown,
} from "react-icons/fa";

const API   = "http://127.0.0.1:5000";

// ── Token helpers ─────────────────────────────────────
const getToken  = ()    => localStorage.getItem("auth_token") || "";
const setToken  = (t)   => localStorage.setItem("auth_token", t);
const clearToken = ()   => localStorage.removeItem("auth_token");

// Auth header for all requests
const LANGS = [
  {code:"es",label:"Spanish"},{code:"fr",label:"French"},
  {code:"de",label:"German"},{code:"zh",label:"Chinese"},
  {code:"ar",label:"Arabic"},{code:"hi",label:"Hindi"},
  {code:"pt",label:"Portuguese"},{code:"ru",label:"Russian"},
  {code:"ja",label:"Japanese"},{code:"it",label:"Italian"},
  {code:"ko",label:"Korean"},{code:"ml",label:"Malayalam"},
];
const SPK=["#4fffb0","#5ba8ff","#fbbf24","#ff6b6b","#a78bfa","#34d399","#fb923c","#e879f9"];
const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const fmt      = s=>{const m=Math.floor(s/60),r=s%60;return m>0?`${m}m ${r}s`:`${r}s`;};
const pad      = n=>String(n).padStart(2,"0");
const fmtTimer = s=>`${pad(Math.floor(s/60))}:${pad(s%60)}`;
const fmtDate  = iso=>{
  const d=new Date(iso);
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})
    +" · "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
};

const dlText=(txt,name)=>{
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([txt],{type:"text/plain;charset=utf-8"}));
  a.download=name;a.click();
};
const dlDocx=async payload=>{
  try{
    const url=`${API}/download-docx?token=${encodeURIComponent(getToken())}`;
    const res=await fetch(url,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!res.ok){
      const err=await res.json().catch(()=>({error:"Unknown error"}));
      alert("Word doc failed: "+(err.error||res.status)+"\n\nMake sure the backend is running and npm install docx was run in the backend folder.");
      return;
    }
    const a=document.createElement("a");
    a.href=URL.createObjectURL(await res.blob());
    a.download=(payload.filename||"report").replace(/ /g,"_")+".docx";a.click();
  }catch(e){
    alert("Could not reach the backend. Please make sure 'python app.py' is running in Terminal 1.\n\nError: "+e.message);
  }
};
const dlPdf=async payload=>{
  try{
    const url=`${API}/download-pdf?token=${encodeURIComponent(getToken())}`;
    const res=await fetch(url,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!res.ok){
      const err=await res.json().catch(()=>({error:"Unknown error"}));
      alert("PDF failed: "+(err.error||res.status));
      return;
    }
    const a=document.createElement("a");
    a.href=URL.createObjectURL(await res.blob());
    a.download=(payload.filename||"report").replace(/ /g,"_")+".pdf";a.click();
  }catch(e){
    alert("Could not reach the backend for PDF export.\n\nError: "+e.message);
  }
};
const post    =(url,body)=>fetch(`${url}${url.includes('?')?'&':'?'}token=${encodeURIComponent(getToken())}`,{method:"POST",body,credentials:"include"}).then(r=>r.json());
const doPoll=(id,onDone,onTick,onError)=>{
  const iv=setInterval(async()=>{
    try{
      const d=await fetch(`${API}/status/${id}?token=${encodeURIComponent(getToken())}`,{credentials:"include"}).then(r=>r.json());
      if(d.status==="completed"){clearInterval(iv);onDone(d.result,d);}
      else if(d.status==="error"){clearInterval(iv);onError?.(d.error||"Task failed",d);}
      else onTick?.(d);
    }catch(e){
      clearInterval(iv);
      onError?.(String(e?.message||e||"Polling failed"),null);
    }
  },2000);
};

// ── shared UI ─────────────────────────────────────────
const ProgressBox=({msg,pct,startTime})=>{
  const [elapsed,setElapsed]=React.useState(0);
  React.useEffect(()=>{
    if(!startTime)return;
    setElapsed(Math.floor((Date.now()-startTime)/1000));
    const iv=setInterval(()=>setElapsed(Math.floor((Date.now()-startTime)/1000)),1000);
    return()=>clearInterval(iv);
  },[startTime]);
  const fmtElapsed=s=>{
    if(s<60)return `${s}s`;
    const m=Math.floor(s/60),r=s%60;
    return r>0?`${m}m ${r}s`:`${m}m`;
  };
  return(
    <div className="progress-box">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <p className="progress-label">{msg}</p>
        {startTime&&elapsed>0&&(
          <span style={{fontSize:12,fontWeight:600,color:"var(--accent)",fontFamily:"var(--mono)",flexShrink:0}}>
            {fmtElapsed(elapsed)}
          </span>
        )}
      </div>
      <div className="progress-track"><div className="progress-fill" style={{width:`${pct}%`}}/></div>
      {startTime&&elapsed>5&&(
        <p style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--mono)",marginTop:2}}>
          {elapsed<30?"Processing audio…":elapsed<60?"Almost there…":elapsed<120?"Taking a little longer than usual…":"Still working, large file detected…"}
        </p>
      )}
    </div>
  );
};

const UploadRow=({file,onChange,onGo,busy,label})=>(
  <div className="upload-area">
    <label className="upload-box">
      <span className="upload-icon">↑</span>
      <span>{file?file.name:"Click to upload audio file"}</span>
      <input type="file" accept="audio/*" onChange={e=>onChange(e.target.files[0])}/>
    </label>
    {file&&<span className="file-badge">📁 {file.name}</span>}
    <button className="btn-primary" onClick={onGo} disabled={!file||busy}>
      {busy?"Processing…":label}
    </button>
  </div>
);

const AttCards=({list,segList})=>(
  <>
    <p className="section-label">{list.length} speaker{list.length!==1?"s":""} detected</p>
    <div className="att-grid">
      {list.map((a,i)=>(
        <div className="att-card" key={a.id}>
          <div className="att-top">
            <FaUserCircle size={24} style={{color:SPK[i%SPK.length],flexShrink:0}}/>
            <div className="att-info">
              <span className="att-name">{a.id}</span>
              <span className="att-meta">{fmt(a.speaking_time)} · {a.segments} turn{a.segments!==1?"s":""}</span>
            </div>
          </div>
          <div className="att-bar-track">
            <div className="att-bar-fill" style={{
              width:`${Math.round((a.speaking_time/list[0].speaking_time)*100)}%`,
              background:SPK[i%SPK.length]}}/>
          </div>
        </div>
      ))}
    </div>
    {segList.length>0&&<>
      <p className="section-label" style={{marginTop:8}}>Transcript by speaker</p>
      <div className="seg-list">
        {segList.map((s,i)=>{
          const ci=list.findIndex(a=>a.id===s.speaker),c=SPK[ci%SPK.length];
          return(
            <div className="seg-row" key={i}>
              <span className="seg-spk" style={{color:c,borderColor:c+"55",background:c+"12"}}>{s.speaker}</span>
              <p className="seg-txt">{s.text}</p>
              <span className="seg-dur">{s.duration}s</span>
            </div>
          );
        })}
      </div>
    </>}
  </>
);

// ══════════════════════════════════════════════════════
//  APP
// ══════════════════════════════════════════════════════

// ── MARQUEE DATA ─────────────────────────────────────
const MARQUEE_ITEMS = [
  "AI Meeting Summarizer","Smart Transcription","Live Translation",
  "Speaker Detection","Word Reports","Action Items","Key Decisions",
  "Meeting Highlights","Real-time Notes","Auto Summarize",
  "AI Meeting Summarizer","Smart Transcription","Live Translation",
  "Speaker Detection","Word Reports","Action Items","Key Decisions",
  "Meeting Highlights","Real-time Notes","Auto Summarize",
];


// ── WHO IT'S FOR ─────────────────────────────────────
const WHO_TABS = [
  {
    id:"owners", label:"Meeting Owners",
    icon:"🗓️",
    title:"Meeting Owners",
    desc:"Running meetings while also taking notes is exhausting. AI Meeting Summarizer handles the note-taking so you can focus entirely on leading the conversation.",
    points:["Captures every word without manual effort","Generates summary the moment meeting ends","Share report with attendees in one click"],
    visual: (
      <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
          <span style={{fontSize:20}}>🗓️</span>
          <span style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>Meeting Notes</span>
          <span style={{marginLeft:"auto",fontSize:10,color:"var(--accent)",fontFamily:"var(--mono)"}}>● Live</span>
        </div>
        {["Q4 roadmap discussion","Budget finalized","Next steps assigned","Follow-up scheduled"].map((t,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i<3?"1px solid var(--border)":"none"}}>
            <span style={{fontSize:12,color:"var(--accent)"}}>✓</span>
            <span style={{fontSize:12,color:"var(--text2)"}}>{t}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id:"managers", label:"Managers & Leaders",
    icon:"📊",
    title:"Managers & Leaders",
    desc:"Stay on top of every team meeting without attending all of them. AI Meeting Summarizer gives you structured summaries, decision logs, and action item lists.",
    points:["Review meeting outcomes at a glance","Track team decisions and commitments","Identify action items and follow up faster"],
    visual: (
      <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
        <div style={{fontSize:11,fontWeight:700,color:"var(--text2)",fontFamily:"var(--mono)",letterSpacing:".08em",marginBottom:12}}>TEAM OVERVIEW</div>
        {[["Decisions Made","4"],["Action Items","7"],["Speakers","3"],["Duration","42m"]].map(([label,val],i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:i<3?"1px solid var(--border)":"none"}}>
            <span style={{fontSize:12,color:"var(--text2)"}}>{label}</span>
            <span style={{fontSize:14,fontWeight:700,color:"var(--accent)",fontFamily:"var(--mono)"}}>{val}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id:"remote", label:"Remote Teams",
    icon:"🌍",
    title:"Remote & Hybrid Teams",
    desc:"Timezone differences mean not everyone can attend live. AI Meeting Summarizer ensures no one misses out — full transcripts and summaries are always available.",
    points:["Full transcript for anyone who couldn't attend","Speaker detection shows who said what","Supports 12 languages for global teams"],
    visual: (
      <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
        <div style={{fontSize:11,fontWeight:700,color:"var(--text2)",fontFamily:"var(--mono)",letterSpacing:".08em",marginBottom:12}}>TRANSLATION</div>
        {[["🇬🇧 English","Hello, let us begin"],["🇪🇸 Spanish","Hola, comencemos"],["🇫🇷 French","Bonjour, commençons"],["🇩🇪 German","Hallo, fangen wir an"]].map(([lang,text],i)=>(
          <div key={i} style={{padding:"6px 0",borderBottom:i<3?"1px solid var(--border)":"none"}}>
            <span style={{fontSize:11,fontWeight:600,color:"var(--text)",marginRight:8}}>{lang}</span>
            <span style={{fontSize:11,color:"var(--text3)",fontStyle:"italic"}}>{text}</span>
          </div>
        ))}
      </div>
    ),
  },
];

function WhoSection() {
  const [active, setActive] = React.useState("owners");
  const tab = WHO_TABS.find(t=>t.id===active);
  return (
    <div className="who-section">
      <div style={{textAlign:"center",marginBottom:28}}>
        <p className="trusted-label" style={{marginBottom:10}}>Use Cases</p>
        <h2 className="landing-h2">Who AI Meeting Summarizer Is For</h2>
      </div>
      <div className="who-tabs">
        {WHO_TABS.map(t=>(
          <button key={t.id} className={`who-tab${active===t.id?" active":""}`} onClick={()=>setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="who-content">
        <div>
          <h3 className="who-title">{tab.title}</h3>
          <p className="who-desc">{tab.desc}</p>
          <ul className="who-points">
            {tab.points.map((p,i)=><li key={i}>{p}</li>)}
          </ul>
        </div>
        <div className="who-visual">
          <div style={{position:"relative",zIndex:1,width:"100%"}}>
            <div style={{fontSize:32,textAlign:"center",marginBottom:16}}>{tab.icon}</div>
            {tab.visual}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── FAQ ───────────────────────────────────────────────
const FAQS = [
  {
    q:"How does AI Meeting Summarizer transcribe meeting audio?",
    a:"AI Meeting Summarizer uses OpenAI Whisper (via faster-whisper) running locally on your machine. It processes your audio file or live microphone input and converts speech to text with high accuracy. No audio is sent to any external server — everything stays on your device.",
  },
  {
    q:"What file formats does AI Meeting Summarizer support?",
    a:"AI Meeting Summarizer supports all common audio formats including MP3, WAV, M4A, and WebM. You can upload pre-recorded meeting files or use your microphone directly for live transcription.",
  },
  {
    q:"How is the meeting summary generated?",
    a:"The summary is generated using an extractive AI model that scores sentences by relevance and frequency. It then identifies key decisions, highlights, action items, and agenda topics from the transcript using keyword analysis.",
  },
  {
    q:"What does the Word report include?",
    a:"The Word document includes a cover page, meeting overview table, executive summary, agenda, discussion topics breakdown, key decision points, key highlights, action items table with owner and status columns, attendee participation table, and the full transcript.",
  },
  {
    q:"Does AI Meeting Summarizer support multiple speakers?",
    a:"Yes. AI Meeting Summarizer uses silence-based speaker diarization to detect speaker turns in your audio. Each speaker is labeled (Participant 1, Participant 2, etc.) with speaking time and number of turns shown in the report.",
  },
  {
    q:"Can I translate the transcript?",
    a:"Yes. The Live Mic feature includes an optional translation toggle that translates your spoken English into 12 languages in real time using the MyMemory translation API. You can also download both the original transcript and the translation together.",
  },
  {
    q:"Is my data private and secure?",
    a:"Yes. AI Meeting Summarizer runs entirely on your local machine. Your audio files and transcripts are processed locally by Whisper and are never uploaded to any cloud service. The only external call is the optional translation API, which only receives the text chunk.",
  },
];

function FaqSection() {
  const [open, setOpen] = React.useState(null);
  return (
    <div className="faq-section">
      <div style={{textAlign:"center",marginBottom:8}}>
        <p className="trusted-label" style={{marginBottom:10}}>FAQ</p>
        <h2 className="landing-h2">Have questions? We have answers.</h2>
      </div>
      <div className="faq-list">
        {FAQS.map((faq,i)=>(
          <div key={i} className={`faq-item${open===i?" open":""}`}>
            <div className="faq-row" onClick={()=>setOpen(open===i?null:i)}>
              <span className="faq-q">{faq.q}</span>
              <div className="faq-toggle">+</div>
            </div>
            {open===i&&<p className="faq-a">{faq.a}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function LandingSections({ onStart }) {
  return (
    <>
      <div className="section-divider"/>

      {/* STATS */}
      <div className="stats-bar">
        {[
          {num:"3x",   label:"Faster than\nmanual notes"},
          {num:"12+",  label:"Supported\nlanguages"},
          {num:"100%", label:"Secure &\nconfidential"},
          {num:"∞",    label:"No length\nlimit"},
        ].map(s=>(
          <div className="stat-item" key={s.num}>
            <div className="stat-num">{s.num}</div>
            <div className="stat-label" style={{whiteSpace:"pre-line"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* MARQUEE */}
      <div className="trusted-wrap">
        <p className="trusted-label">Powered by features including</p>
        <div className="marquee-outer">
          <div className="marquee-track">
            {MARQUEE_ITEMS.map((item,i)=>(
              <div className="marquee-item" key={i}>{item}</div>
            ))}
          </div>
        </div>
      </div>

      {/* WHAT IS */}
      <div className="landing-section">
        <div className="landing-visual">
          <div className="landing-visual-inner">
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:4}}>
              <span style={{fontSize:36}}>🎙️</span>
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <span style={{fontSize:12,fontWeight:700,color:"var(--accent)",fontFamily:"var(--mono)",letterSpacing:".08em"}}>LIVE RECORDING</span>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:"var(--red)",animation:"blink 1s infinite"}}/>
                  <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>00:02:34</span>
                </div>
              </div>
            </div>
            <div className="lv-mockup">
              <div className="lv-mockup-row"><div className="lv-mockup-dot" style={{background:"var(--accent)"}}/><div className="lv-mockup-line accent"/></div>
              <div className="lv-mockup-row"><div className="lv-mockup-dot" style={{background:"var(--text3)"}}/><div className="lv-mockup-line short"/></div>
              <div className="lv-mockup-row"><div className="lv-mockup-dot" style={{background:"var(--accent)"}}/><div className="lv-mockup-line"/></div>
              <div className="lv-mockup-row"><div className="lv-mockup-dot" style={{background:"var(--text3)"}}/><div className="lv-mockup-line shorter"/></div>
            </div>
            <div className="landing-visual-tags">
              {["Transcribe","Summarize","Translate","Export"].map(t=><span className="lv-tag" key={t}>{t}</span>)}
            </div>
          </div>
        </div>
        <div className="landing-text">
          <span className="landing-eyebrow">About This Tool</span>
          <h2 className="landing-h2">What is an AI Meeting Summarizer?</h2>
          <p className="landing-p">An AI Meeting Summarizer converts your meeting recordings into clear, structured notes in seconds. It captures key points, action items, decisions, and speaker breakdowns — so your team stays aligned without anyone having to take manual notes.</p>
          <ul className="landing-bullets">
            <li>Transcribes any audio recording with high accuracy</li>
            <li>Generates concise summaries with key decisions</li>
            <li>Detects and identifies multiple speakers</li>
            <li>Exports a fully formatted Word document report</li>
          </ul>
        </div>
      </div>

      {/* WHY USE */}
      <div className="landing-section reverse">
        <div className="landing-visual">
          <div className="landing-visual-inner">
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
              <span style={{fontSize:32}}>📄</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:2}}>Meeting_Report.docx</div>
                <div style={{fontSize:11,color:"var(--accent)",fontFamily:"var(--mono)"}}>✓ Generated</div>
              </div>
            </div>
            <div className="lv-mockup">
              {[
                {label:"Executive Summary",w:"90%"},
                {label:"Key Decisions",w:"70%"},
                {label:"Action Items",w:"80%"},
                {label:"Attendees",w:"55%"},
              ].map((row,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--mono)",whiteSpace:"nowrap"}}>{row.label}</span>
                  <div style={{flex:1,height:6,borderRadius:3,background:"var(--border-hi)",overflow:"hidden"}}>
                    <div style={{width:row.w,height:"100%",background:"var(--accent-ring)",borderRadius:3}}/>
                  </div>
                </div>
              ))}
            </div>
            <div className="landing-visual-tags">
              {["Summary","Decisions","Highlights","Action Items"].map(t=><span className="lv-tag" key={t}>{t}</span>)}
            </div>
          </div>
        </div>
        <div className="landing-text">
          <span className="landing-eyebrow">Built for Your Team</span>
          <h2 className="landing-h2">Why Use an AI Meeting Summarizer?</h2>
          <p className="landing-p">Stop spending hours rewatching recordings or typing up notes manually. Key ideas and next steps are easy to miss in long or fast-paced meetings. This tool generates detailed summaries so you never lose track of what matters.</p>
          <ul className="landing-bullets">
            <li>Save hours of manual note-taking every week</li>
            <li>Never miss a key decision or action item again</li>
            <li>Share professional Word reports with your team instantly</li>
            <li>Works with any audio file or your microphone in real time</li>
          </ul>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div className="how-section">
        <h2 className="landing-h2">How to Use the AI Meeting Summarizer</h2>
        <p className="how-sub">Getting your meeting summary is quick and easy. Go from raw audio to a structured report in minutes.</p>
        <div className="steps-grid">
          {[
            {num:"1",icon:"📁",title:"Upload Your Meeting Audio",desc:"Choose any audio recording from your device. Supports all common formats — MP3, WAV, M4A, and more."},
            {num:"2",icon:"🤖",title:"Let the AI Transcribe & Summarize",desc:"The AI transcribes the audio, detects speakers, and generates a structured summary with key decisions and action items."},
            {num:"3",icon:"📄",title:"Review, Download & Share",desc:"Review your summary on screen, then download a fully formatted Word document to share with your team instantly."},
          ].map(s=>(
            <div className="step-card" key={s.num}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div className="step-num">{s.num}</div>
                <span className="step-icon">{s.icon}</span>
              </div>
              <div className="step-title">{s.title}</div>
              <div className="step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>


      <div className="section-divider"/>

      {/* BENEFITS */}
      <div className="benefits-section">
        <div style={{textAlign:"center",marginBottom:8}}>
          <p className="trusted-label" style={{marginBottom:10}}>Why AI Meeting Summarizer Works</p>
          <h2 className="landing-h2">Benefits of AI Meeting Summaries</h2>
        </div>
        <div className="benefits-grid">
          {/* Benefit 1 */}
          <div className="benefit-row">
            <div className="benefit-text">
              <h3 className="benefit-title">Stay Focused on the Conversation</h3>
              <p className="benefit-desc">When you use AI Meeting Summarizer, you don't have to split your attention between listening and taking notes. Every word is captured, transcribed, and structured for you — so you can stay fully engaged in the discussion.</p>
              <ul className="benefit-points">
                <li>Zero manual note-taking required during meetings</li>
                <li>Live mic captures everything in real time</li>
                <li>Full transcript generated the moment you stop recording</li>
              </ul>
            </div>
            <div className="benefit-visual">
              <div className="benefit-visual-inner">
                <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <span style={{fontSize:22}}>🎙️</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"var(--text)",fontFamily:"var(--mono)"}}>Live Recording</div>
                      <div style={{display:"flex",alignItems:"center",gap:5,marginTop:3}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:"var(--red)",animation:"blink 1s infinite"}}/>
                        <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>00:04:22 · Recording…</span>
                      </div>
                    </div>
                  </div>
                  {[85,60,90,45,70].map((w,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:i%2===0?"var(--accent)":"var(--blue)",flexShrink:0}}/>
                      <div style={{flex:1,height:8,borderRadius:4,background:"var(--border)",overflow:"hidden"}}>
                        <div style={{width:`${w}%`,height:"100%",background:i%2===0?"var(--accent-ring)":"rgba(91,168,255,0.2)",borderRadius:4}}/>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="benefit-chips">
                  {["Live Transcription","Real-time","No notes needed"].map(t=><span className="benefit-chip" key={t}>{t}</span>)}
                </div>
              </div>
            </div>
          </div>

          {/* Benefit 2 */}
          <div className="benefit-row reverse">
            <div className="benefit-text">
              <h3 className="benefit-title">Improved Team Efficiency</h3>
              <p className="benefit-desc">No important decision or action item slips through the cracks. AI Meeting Summarizer structures your meeting into decisions, highlights, and action items — making follow-ups fast and accountability clear.</p>
              <ul className="benefit-points">
                <li>Key decisions extracted and listed clearly</li>
                <li>Action items identified with owner and status</li>
                <li>Word report ready to share in one click</li>
              </ul>
            </div>
            <div className="benefit-visual">
              <div className="benefit-visual-inner">
                <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <span style={{fontSize:22}}>📄</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:"var(--text)"}}>Meeting_Report.docx</div>
                      <div style={{fontSize:11,color:"var(--accent)",fontFamily:"var(--mono)",marginTop:2}}>✓ Ready to share</div>
                    </div>
                  </div>
                  {[["Executive Summary","92%"],["Key Decisions","78%"],["Action Items","85%"],["Attendees","100%"]].map(([label,pct],i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <span style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--mono)",width:110,flexShrink:0}}>{label}</span>
                      <div style={{flex:1,height:7,borderRadius:4,background:"var(--border)",overflow:"hidden"}}>
                        <div style={{width:pct,height:"100%",background:"var(--accent-ring)",borderRadius:4}}/>
                      </div>
                      <span style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--mono)",width:28,textAlign:"right"}}>{pct}</span>
                    </div>
                  ))}
                </div>
                <div className="benefit-chips">
                  {["Key Decisions","Action Items","Word Report"].map(t=><span className="benefit-chip" key={t}>{t}</span>)}
                </div>
              </div>
            </div>
          </div>

          {/* Benefit 3 */}
          <div className="benefit-row">
            <div className="benefit-text">
              <h3 className="benefit-title">Easier Team Collaboration</h3>
              <p className="benefit-desc">Summaries keep everyone aligned. Whether it's a project update or a client call, sharing a formatted Word report from AI Meeting Summarizer ensures the whole team stays on the same page — no matter who attended.</p>
              <ul className="benefit-points">
                <li>Professional Word document with all sections included</li>
                <li>Speaker breakdown shows who contributed what</li>
                <li>History panel lets you revisit any past report instantly</li>
              </ul>
            </div>
            <div className="benefit-visual">
              <div className="benefit-visual-inner">
                <div style={{width:"100%",background:"var(--surface3)",borderRadius:14,padding:"18px 20px",border:"1px solid var(--border-hi)"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--text2)",fontFamily:"var(--mono)",letterSpacing:".08em",marginBottom:12}}>REPORT HISTORY</div>
                  {[
                    {name:"Q4 Strategy Meeting",date:"Mar 15",type:"Full Report"},
                    {name:"Product Review",date:"Mar 14",type:"Summary"},
                    {name:"Client Call",date:"Mar 12",type:"Full Report"},
                  ].map((r,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<2?"1px solid var(--border)":"none"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:r.type==="Full Report"?"var(--accent)":"var(--blue)",flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:600,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name}</div>
                        <div style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--mono)"}}>{r.date} · {r.type}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="benefit-chips">
                  {["Word Export","Speaker Stats","Report History"].map(t=><span className="benefit-chip" key={t}>{t}</span>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="section-divider"/>

      {/* WHO IT'S FOR */}
      <WhoSection/>

      <div className="section-divider"/>

      {/* FAQ */}
      <FaqSection/>


      <div className="section-divider"/>

      {/* CTA */}
      <div className="cta-section">
        <h2 className="landing-h2">Start Using AI Meeting Summarizer Today</h2>
        <p className="landing-p">Record or upload your next meeting and get a structured summary, full transcript, and professional Word report — all running locally on your machine.</p>
        <button className="cta-btn" onClick={onStart}>
          Start Summarizing Now &nbsp;<FaArrowDown size={14}/>
        </button>
      </div>
    </>
  );
}


// ══════════════════════════════════════
//  LOGIN / REGISTER PAGE
// ══════════════════════════════════════
function AuthPage({ onLogin }) {
  const [mode, setMode]       = useState("login"); // "login" | "register"
  const [username, setUser]   = useState("");
  const [password, setPass]   = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong"); return; }
      if(data.token) setToken(data.token);
      onLogin(data.username);
    } catch (e) {
      setError("Cannot connect to server. Make sure the backend is running.");
    } finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="bg-canvas">
        <div className="bg-orb bg-orb-1"/><div className="bg-orb bg-orb-2"/>
        <div className="bg-orb bg-orb-3"/><div className="bg-orb bg-orb-4"/>
        <div className="bg-grid"/><div className="bg-glow"/>
      </div>
      <div className="auth-card">
        <div className="auth-logo">
          <div className="topbar-brand-dot" style={{width:10,height:10}}/>
          <span>AI Meeting Summarizer</span>
        </div>
        <h1 className="auth-title">{mode === "login" ? "Welcome back" : "Create account"}</h1>
        <p className="auth-sub">
          {mode === "login"
            ? "Sign in to access your reports and history."
            : "Register to start summarizing your meetings."}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input
              className="auth-input"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={e => setUser(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input
              className="auth-input"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPass(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="auth-switch">
          {mode === "login" ? "Don't have an account?" : "Already have an account?"}
          {" "}
          <button
            className="auth-switch-btn"
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          >
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function App(){
  const [authedUser, setAuthedUser] = useState(null);  // null = not checked yet
  const [authChecked, setAuthChecked] = useState(false);
  const [active,setActive]       = useState(null);
  const [darkMode,setDarkMode]   = useState(true);
  const [histOpen,setHistOpen]   = useState(false);
  const [clock,setClock]         = useState(new Date());

  // audio/summary
  const [audioFile,setAudioFile]   = useState(null);
  const [summary,setSummary]       = useState("");
  const [transcript,setTranscript] = useState("");
  const [processing,setProcessing] = useState(false);
  const [procMsg,setProcMsg]       = useState("");
  const [procPct,setProcPct]       = useState(0);
  const [procStart,setProcStart]   = useState(null);

  // live mic
  const [recording,setRecording]     = useState(false);
  const [liveTx,setLiveTx]           = useState("");
  const [liveTl,setLiveTl]           = useState("");
  const [micErr,setMicErr]           = useState("");
  const [duration,setDuration]       = useState(0);
  const [lang,setLang]               = useState("es");
  const [translating,setTranslating] = useState(false);
  const [translateOn,setTranslateOn] = useState(false);
  const [liveStart,setLiveStart]     = useState(null);
  const streamRef=useRef(null),ivRef=useRef(null),timerRef=useRef(null);
  const recorderRef = useRef(null);
  const recorderMimeRef = useRef("audio/webm");
  const chunkQueueRef = useRef([]);
  const chunkBusyRef = useRef(false);
  const audioCtxRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorRef = useRef(null);
  const pcmChunksRef = useRef([]);
  const sampleRateRef = useRef(16000);

  const extFromMime = (mime = "") => {
    const m = String(mime).toLowerCase();
    if (m.includes("ogg")) return "ogg";
    if (m.includes("mp4") || m.includes("mpeg")) return "m4a";
    if (m.includes("wav")) return "wav";
    return "webm";
  };

  const pcmToWavBlob = (samples, sampleRate) => {
    const bytesPerSample = 2;
    const numChannels = 1;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
  };

  const flushPcmChunk = () => {
    const chunks = pcmChunksRef.current;
    if (!chunks.length) return;

    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    pcmChunksRef.current = [];
    if (!totalLen) return;

    const merged = new Float32Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.length;
    }

    // Skip extremely short slices that often produce poor results.
    if (merged.length < sampleRateRef.current * 0.35) return;

    const blob = pcmToWavBlob(merged, sampleRateRef.current);
    chunkQueueRef.current.push(blob);
    if (chunkQueueRef.current.length > 8) {
      chunkQueueRef.current = chunkQueueRef.current.slice(-8);
    }
    flushChunkQueue();
  };

  // full report
  const [repFile,setRepFile]       = useState(null);
  const [repLoading,setRepLoading] = useState(false);
  const [repMsg,setRepMsg]         = useState("");
  const [repPct,setRepPct]         = useState(0);
  const [repStart,setRepStart]     = useState(null);
  const [rep,setRep]               = useState(null);
  const [repTab,setRepTab]         = useState("summary");

  // attendees
  const [diarFile,setDiarFile]   = useState(null);
  const [diarizing,setDiarizing] = useState(false);
  const [diarMsg,setDiarMsg]     = useState("");
  const [diarPct,setDiarPct]     = useState(0);
  const [diarStart,setDiarStart] = useState(null);
  const [segs,setSegs]           = useState([]);
  const [attendees,setAttendees] = useState([]);

  // history
  const [history,setHistory]         = useState([]);
  const [histLoading,setHistLoading] = useState(false);
  const [expandedId,setExpandedId]   = useState(null);
  const [histTab,setHistTab]         = useState("summary");
  const [clearConfirm,setClearConfirm] = useState(false);

  const workspaceRef = useRef(null);
  const drawerRef    = useRef(null);
  const heroRef      = useRef(null);

  // ── clock tick ───────────────────────────────────────
  useEffect(()=>{
    const t=setInterval(()=>setClock(new Date()),1000);
    return()=>clearInterval(t);
  },[]);

  // ── dark mode ────────────────────────────────────────
  // Check if already logged in (session cookie)
  useEffect(()=>{
    // Try session cookie first via /auth/token (re-issues fresh token)
    fetch(`${API}/auth/token`,{credentials:"include"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.token){
          setToken(d.token);          // always overwrite with server token
          setAuthedUser(d.username);
          setAuthChecked(true);
        } else {
          // Fall back to /auth/me with existing token
          fetch(`${API}/auth/me?token=${encodeURIComponent(getToken())}`,{credentials:"include"})
            .then(r=>r.json())
            .then(d2=>{
              if(d2.user){ setAuthedUser(d2.user); if(d2.token) setToken(d2.token); }
              setAuthChecked(true);
            })
            .catch(()=>setAuthChecked(true));
        }
      })
      .catch(()=>setAuthChecked(true));
  },[]);

  const handleLogout = async () => {
    try {
      await fetch(`${API}/auth/logout?token=${encodeURIComponent(getToken())}`,{method:"POST",credentials:"include"});
    } catch(e) {
      console.warn("Logout request failed (backend may be down) — clearing local session anyway");
    }
    clearToken();
    setAuthedUser(null);
    setActive(null);
    setHistOpen(false);
  };

  useEffect(()=>{document.body.classList.toggle("light",!darkMode);},[darkMode]);
  useEffect(()=>()=>stopRec(),[]);

  // ── fetch history when drawer opens ──────────────────
  useEffect(()=>{if(histOpen)fetchHistory();},[histOpen]);

  // ── close drawer on outside click ────────────────────
  useEffect(()=>{
    if(!histOpen)return;
    const handle=e=>{
      if(drawerRef.current&&!drawerRef.current.contains(e.target)){
        // check it's not the history button itself
        if(!e.target.closest(".hist-btn")) setHistOpen(false);
      }
    };
    document.addEventListener("mousedown",handle);
    return()=>document.removeEventListener("mousedown",handle);
  },[histOpen]);

  // ── scroll workspace into view ───────────────────────
  useEffect(()=>{
    if(active&&workspaceRef.current){
      setTimeout(()=>workspaceRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),80);
    }
  },[active]);

  const toggle = id => setActive(prev=>prev===id?null:id);

  // ── clock formatting ─────────────────────────────────
  const dayName  = DAYS[clock.getDay()];
  const dateStr  = `${MONTHS[clock.getMonth()]} ${clock.getDate()}, ${clock.getFullYear()}`;
  const timeStr  = clock.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"});

  // ── history ──────────────────────────────────────────
  const fetchHistory=async()=>{
    setHistLoading(true);
    try{
      const res  = await fetch(`${API}/history?token=${encodeURIComponent(getToken())}`,{credentials:"include"});
      const data = await res.json();
      // Guard: only set if it's actually an array
      setHistory(Array.isArray(data) ? data : []);
    }catch(e){console.error(e);setHistory([]);}
    finally{setHistLoading(false);}
  };
  const deleteEntry=async(id,e)=>{
    e.stopPropagation();
    await fetch(`${API}/history/${id}?token=${encodeURIComponent(getToken())}`,{method:"DELETE",credentials:"include"});
    setHistory(h=>(Array.isArray(h)?h:[]).filter(x=>x.id!==id));
    if(expandedId===id)setExpandedId(null);
  };
  const clearAll=async()=>{
    await fetch(`${API}/history?token=${encodeURIComponent(getToken())}`,{method:"DELETE",credentials:"include"});
    setHistory([]);setExpandedId(null);setClearConfirm(false);
  };
  const restoreReport=entry=>{
    setRep({summary:entry.summary||"",transcript:entry.transcript||"",
            segments:entry.segments||[],attendees:entry.attendees||[],
            filename:entry.filename||"Meeting",date:fmtDate(entry.created_at),time:"",
            agendas:entry.agendas||[],key_decisions:entry.key_decisions||[],
            key_highlights:entry.key_highlights||[],action_items:entry.action_items||[],
            topics:entry.topics||[],stats:entry.stats||{}});
    setRepTab("summary");setActive("report");setHistOpen(false);
  };

  // ── api ───────────────────────────────────────────────
  const genSummary=async file=>{
    if(!file)return;
    setProcessing(true);setProcPct(10);setProcMsg("Uploading…");setSummary("");setTranscript("");setProcStart(Date.now());
    const fd=new FormData();fd.append("audio",file);
    const {task_id}=await post(`${API}/upload`,fd);
    setProcMsg("Processing audio…");
    doPoll(task_id,
      r=>{setSummary(r.summary);setTranscript(r.transcript);setProcPct(100);setProcessing(false);setProcMsg("Done!");setProcStart(null);},
      ()=>setProcPct(p=>Math.min(p+10,90)),
      err=>{setProcessing(false);setProcStart(null);setProcMsg("Failed");alert("Summary failed: "+err);}
    );
  };

  const genDiar=async file=>{
    if(!file)return;
    setDiarizing(true);setDiarPct(10);setDiarMsg("Uploading…");setSegs([]);setAttendees([]);setDiarStart(Date.now());
    const fd=new FormData();fd.append("audio",file);
    const {task_id}=await post(`${API}/diarize`,fd);
    setDiarMsg("Detecting speakers…");
    doPoll(task_id,
      r=>{setSegs(r.segments);setAttendees(r.attendees);setDiarPct(100);setDiarizing(false);setDiarMsg("Done!");setDiarStart(null);},
      ()=>setDiarPct(p=>Math.min(p+8,90)),
      err=>{setDiarizing(false);setDiarStart(null);setDiarMsg("Failed");alert("Speaker detection failed: "+err);}
    );
  };

  const genReport=async()=>{
    if(!repFile)return;
    setRepLoading(true);setRepPct(10);setRepMsg("Uploading…");setRep(null);setRepStart(Date.now());
    const fd=new FormData();fd.append("audio",repFile);
    const fd2=repFile.lastModified?new Date(repFile.lastModified):new Date();
    const meetDate=fd2.toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const meetTime=fd2.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"});
    const {task_id}=await post(`${API}/full-report`,fd);
    setRepMsg("Generating report…");
    doPoll(task_id,
      r=>{setRep({...r,filename:repFile.name.replace(/\.[^/.]+$/,""),date:meetDate,time:meetTime,
                  agendas:r.agendas||[],key_decisions:r.key_decisions||[],
                  key_highlights:r.key_highlights||[],action_items:r.action_items||[],
                  topics:r.topics||[],stats:r.stats||{}});
           setRepPct(100);setRepLoading(false);setRepMsg("Done!");setRepStart(null);},
      d=>{
        setRepPct(p=>Math.min(p+6,90));
        if(d?.stage){
          if(d.stage==="transcribing") setRepMsg("Transcribing audio…");
          else if(d.stage==="finalizing") setRepMsg("Finalizing report…");
        }
      },
      err=>{setRepLoading(false);setRepStart(null);setRepMsg("Failed");alert("Report failed: "+err);}
    );
  };

  const translate=async text=>{
    if(!text.trim()||!translateOn)return;
    setTranslating(true);
    try{
      const d=await fetch(`${API}/translate?token=${encodeURIComponent(getToken())}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,target:lang,source:"en"})}).then(r=>r.json());
      if(d.translated)setLiveTl(p=>(p+" "+d.translated).trim());
    }finally{setTranslating(false);}
  };

  const flushChunkQueue = async () => {
    if (chunkBusyRef.current) return;
    chunkBusyRef.current = true;

    try {
      while (chunkQueueRef.current.length > 0) {
        const blob = chunkQueueRef.current.shift();
        if (!blob || blob.size < 1200) continue;

        const fd = new FormData();
        const ext = extFromMime(blob.type || recorderMimeRef.current);
        fd.append("audio", blob, `chunk.${ext}`);
        fd.append("mime", blob.type || recorderMimeRef.current || "audio/webm");

        try {
          // Pass token as query param — avoids CORS preflight on multipart + Auth header
          const url = `${API}/transcribe-chunk?token=${encodeURIComponent(getToken())}`;
          const res = await fetch(url, { method: "POST", body: fd });

          if (res.status === 401) {
            setMicErr("Session expired. Please sign out and sign back in.");
            stopRec();
            return;
          }
          if (!res.ok) {
            console.error("[chunk] HTTP", res.status);
            continue;
          }

          const d = await res.json();
          if (d.error) {
            console.error("[chunk]", d.error);
            continue;
          }

          if (d.transcript?.trim()) {
            const t = d.transcript.trim();
            setLiveTx(p => (p + " " + t).trim());
            if (translateOn) translate(t);
          }
        } catch (e) {
          console.error("[chunk]", e);
        }
      }
    } finally {
      chunkBusyRef.current = false;
    }
  };

  const startRec=async()=>{
    setMicErr("");setLiveTx("");setLiveTl("");setDuration(0);setLiveStart(new Date());
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current = stream;
      setRecording(true);
      chunkQueueRef.current = [];

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      sampleRateRef.current = ctx.sampleRate || 16000;

      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      pcmChunksRef.current = [];

      processor.onaudioprocess = evt => {
        const input = evt.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      // Emit slightly longer phrase chunks for better recognition accuracy.
      ivRef.current = setInterval(flushPcmChunk, 3200);

      timerRef.current = setInterval(() => setDuration(p => p + 1), 1000);
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (/permission|denied|notallowed/i.test(msg)) {
        setMicErr("Microphone access denied. Please allow microphone permissions.");
      } else {
        setMicErr("Live Mic could not start with the current browser audio settings. Please refresh and try again.");
      }
    }
  };

  const stopRec=()=>{
    clearInterval(ivRef.current);clearInterval(timerRef.current);
    flushPcmChunk();

    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
      processorRef.current.onaudioprocess = null;
    }
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
    }

    processorRef.current = null;
    sourceNodeRef.current = null;
    audioCtxRef.current = null;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    pcmChunksRef.current = [];
    chunkQueueRef.current = [];
    chunkBusyRef.current = false;
    setRecording(false);
  };

  const langLabel=LANGS.find(l=>l.code===lang)?.label;

  const repDocxPayload=r=>({
    filename:r.filename||"Meeting Report",meeting_date:r.date||"",meeting_time:r.time||"",
    summary:r.summary||"",transcript:r.transcript||"",
    segments:r.segments||[],attendees:r.attendees||[],
    agendas:r.agendas||[],key_decisions:r.key_decisions||[],
    key_highlights:r.key_highlights||[],action_items:r.action_items||[],
    topics:r.topics||[],stats:r.stats||{},
  });
  const liveDocxPayload=()=>{
    const d=liveStart||new Date();
    // Build transcript — include translation as a second section if available
    const fullTranscript = translateOn && liveTl
      ? `=== Original (English) ===\n\n${liveTx}\n\n=== Translation (${langLabel}) ===\n\n${liveTl}`
      : liveTx;
    return{
      filename:"Live Meeting — "+d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}),
      meeting_date:d.toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"}),
      meeting_time:d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}),
      summary:liveTx.length>300?liveTx.slice(0,400)+"…":liveTx,
      transcript:fullTranscript,
      segments:[],attendees:[],
      agendas:[],key_decisions:[],key_highlights:[],action_items:[],
      topics:[],stats:{total_words:liveTx.split(" ").filter(Boolean).length}
    };
  };
  const histDocx=entry=>({
    filename:entry.filename||"Meeting",meeting_date:fmtDate(entry.created_at),meeting_time:"",
    summary:entry.summary||"",transcript:entry.transcript||"",
    segments:entry.segments||[],attendees:entry.attendees||[],
    agendas:entry.agendas||[],key_decisions:entry.key_decisions||[],
    key_highlights:entry.key_highlights||[],action_items:entry.action_items||[],
    topics:entry.topics||[],stats:entry.stats||{},
  });

  // ── render ─────────────────────────────────────────
  // While checking session
  if (!authChecked) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100vh",background:"var(--bg)",color:"var(--text2)",
      fontFamily:"var(--mono)",fontSize:13,gap:10}}>
      <div className="topbar-brand-dot"/>Checking session…
    </div>
  );

  // Not logged in — show auth page
  if (!authedUser) return <AuthPage onLogin={u=>setAuthedUser(u)}/>;

  return(
    <>
      {/* ══ TOPBAR ══ */}
      <header className="topbar">
        <div className="topbar-left">
          {/* brand */}
          <div className="topbar-brand">
            <div className="topbar-brand-dot"/>
            AI Meeting Summarizer
          </div>
          <div className="topbar-divider"/>
          {/* live clock */}
          <div className="topbar-datetime">
            <span className="topbar-day">{dayName},</span>
            <span className="topbar-date">{dateStr}</span>
            <span className="topbar-time">{timeStr}</span>
          </div>
        </div>

        <div className="topbar-right">
          {/* user chip */}
          <div className="topbar-user">
            <span className="topbar-user-dot"/>
            <span>{authedUser}</span>
          </div>
          {/* history button */}
          <button
            className={`hist-btn${histOpen?" open":""}`}
            onClick={()=>setHistOpen(o=>!o)}
          >
            <FaHistory size={11}/>
            History
            {history.length>0&&<span style={{
              background:"var(--accent)",color:"#020f07",
              borderRadius:"999px",padding:"1px 6px",
              fontSize:"10px",fontWeight:700,marginLeft:2
            }}>{history.length}</span>}
          </button>
          {/* theme */}
          <button className="topbar-logout" onClick={handleLogout} title="Sign out">
            Sign out
          </button>
          <div className="topbar-theme" onClick={()=>setDarkMode(!darkMode)}>
            {darkMode?<FaSun size={13}/>:<FaMoon size={13}/>}
          </div>
        </div>
      </header>

      {/* ══ HISTORY DRAWER ══ */}
      {histOpen&&(
        <>
          <div className="hist-overlay" onClick={()=>setHistOpen(false)}/>
          <div className="hist-drawer" ref={drawerRef}>
            <div className="hist-drawer-head">
              <div>
                <div className="hist-drawer-title">Report History</div>
                <div className="hist-drawer-count">{history.length} report{history.length!==1?"s":""}</div>
              </div>
              <div className="hist-drawer-actions">
                {history.length>0&&(clearConfirm
                  ?<>
                      <button className="hist-item-btn destructive" onClick={clearAll} title="Confirm clear">✓</button>
                      <button className="hist-item-btn" onClick={()=>setClearConfirm(false)} title="Cancel">✕</button>
                    </>
                  :<button className="hist-item-btn destructive" onClick={()=>setClearConfirm(true)} title="Clear all"><FaTrash size={10}/></button>
                )}
                <div className="hist-drawer-close" onClick={()=>setHistOpen(false)}><FaTimes size={12}/></div>
              </div>
            </div>

            <div className="hist-drawer-body">
              {histLoading&&<ProgressBox msg="Loading…" pct={60}/>}

              {!histLoading&&history.length===0&&(
                <div className="hist-empty-drawer">
                  <FaHistory size={28} style={{opacity:.18}}/>
                  <p>No reports yet.</p>
                  <p>Generate a report and it will appear here.</p>
                </div>
              )}

              {!histLoading&&history.map(entry=>{
                const isOpen=expandedId===entry.id;
                const isFull=entry.type==="full_report";
                return(
                  <div key={entry.id} className={`hist-item${isFull?" full-type":" sum-type"}${isOpen?" open":""}`}>
                    <div className="hist-item-row" onClick={()=>{setExpandedId(isOpen?null:entry.id);setHistTab("summary");}}>
                      <div className="hist-item-strip"/>
                      <div className="hist-item-info">
                        <span className="hist-item-type">{isFull?"Full Report":"Summary"}</span>
                        <span className="hist-item-name">{entry.filename||"Untitled"}</span>
                        <span className="hist-item-meta">{fmtDate(entry.created_at)}</span>
                      </div>
                      <div className="hist-item-btns">
                        {isFull&&(
                          <button className="hist-item-btn" title="Open in Full Report"
                            onClick={e=>{e.stopPropagation();restoreReport(entry);}}>
                            <FaExternalLinkAlt size={11}/>
                          </button>
                        )}
                        <button className="hist-item-btn" title="Download Word"
                          onClick={e=>{e.stopPropagation();dlDocx(histDocx(entry));}}>
                          <FaFileWord size={12}/>
                        </button>
                        <button className="hist-item-btn" title="Download PDF"
                          onClick={e=>{e.stopPropagation();dlPdf(histDocx(entry));}}>
                          <FaFilePdf size={12}/>
                        </button>
                        <button className="hist-item-btn" title="Download TXT"
                          onClick={e=>{e.stopPropagation();dlText(`=== SUMMARY ===\n\n${entry.summary||""}\n\n=== TRANSCRIPT ===\n\n${entry.transcript||""}`,`${entry.filename||"report"}.txt`);}}>
                          <FaDownload size={11}/>
                        </button>
                        <button className="hist-item-btn destructive" title="Delete"
                          onClick={e=>deleteEntry(entry.id,e)}>
                          <FaTrash size={11}/>
                        </button>
                        <FaChevronDown size={10} className="hist-item-chevron"/>
                      </div>
                    </div>

                    {isOpen&&(
                      <div className="hist-item-body">
                        {isFull&&(
                          <div className="report-tabs">
                            {[["summary","Summary"],["transcript","Transcript"],["attendees","Attendees"]].map(([id,lbl])=>(
                              <button key={id} className={`r-tab${histTab===id?" active":""}`} onClick={()=>setHistTab(id)}>{lbl}</button>
                            ))}
                          </div>
                        )}
                        {(!isFull||histTab==="summary")&&(
                          <div className="output-card"><p className="output-label">Summary</p><p className="output-text" style={{fontSize:13,lineHeight:1.75}}>{entry.summary||"—"}</p></div>
                        )}
                        {isFull&&histTab==="transcript"&&(
                          <div className="output-card"><p className="output-label">Transcript</p><p className="output-text" style={{fontSize:13,lineHeight:1.75}}>{entry.transcript||"—"}</p></div>
                        )}
                        {isFull&&histTab==="attendees"&&entry.attendees?.length>0&&(
                          <AttCards list={entry.attendees} segList={entry.segments||[]}/>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ══ MAIN PAGE ══ */}
      <div className="page fade-in">
        <div className="bg-canvas">
          <div className="bg-orb bg-orb-1"/><div className="bg-orb bg-orb-2"/>
          <div className="bg-orb bg-orb-3"/><div className="bg-orb bg-orb-4"/>
          <div className="bg-grid"/><div className="bg-glow"/>
        </div>

        {/* hero */}
        <header className="hero" ref={heroRef}>
          <div className="badge">AI Powered</div>
          <h1>Meeting Summarizer</h1>
          <p>Record, upload, or speak live — get instant summaries, full transcripts, speaker breakdowns, and professional Word reports in seconds.</p>
        </header>

        {/* features */}
        {/* FEATURE MARQUEE */}
        <div className="feat-marquee-wrap" style={{marginBottom:20,marginTop:-10}}>
          <div className="feat-marquee-track">
            {[
              "Live Transcription","Full Meeting Reports","Speaker Detection",
              "Word Document Export","12 Languages","Real-time Translation",
              "Action Items","Key Decisions","Meeting Highlights",
              "Audio Upload","History & Archive","AI Summarization",
              "Live Transcription","Full Meeting Reports","Speaker Detection",
              "Word Document Export","12 Languages","Real-time Translation",
              "Action Items","Key Decisions","Meeting Highlights",
              "Audio Upload","History & Archive","AI Summarization",
            ].map((item,i)=>(
              <div key={i} className={`feat-marquee-item${i%6===0?" accent":""}`}>{item}</div>
            ))}
          </div>
        </div>

        <div className="features-wrap">
          <div className="features-primary">
            {[
              {id:"live",  icon:<FaMicrophone size={24}/>,    label:"Live Mic",
               desc:"Real-time English transcription from your microphone with optional live translation into 12 languages."},
              {id:"report",icon:<FaClipboardList size={24}/>, label:"Full Report",
               desc:"Upload one audio file — get summary, transcript, speaker breakdown, and a formatted Word document."},
            ].map(f=>(
              <div key={f.id} className={`feat-hero${active===f.id?" active":""}`} onClick={()=>toggle(f.id)}>
                <div className="feat-hero-icon">{f.icon}</div>
                <div className="feat-hero-label">{f.label}</div>
                <div className="feat-hero-desc">{f.desc}</div>
                <div className="feat-hero-hint">{active===f.id?"Close":"Open feature"}</div>
              </div>
            ))}
          </div>

          <span className="secondary-label">More tools</span>
          <div className="features-secondary">
            {[
              {id:"summary",    icon:<FaFileAlt size={14}/>,   label:"Summary",     desc:"AI summary from any audio file"},
              {id:"transcript", icon:<FaAlignLeft size={14}/>, label:"Transcript",  desc:"Full word-for-word text output"},
              {id:"attendees",  icon:<FaUsers size={14}/>,     label:"Attendees",   desc:"Speaker detection & stats"},
              {id:"audio",      icon:<FaFileAudio size={14}/>, label:"Summarize & Transcribe", desc:"Upload audio → get full summary and transcript"},
            ].map(f=>(
              <div key={f.id} className={`feat-pill${active===f.id?" active":""}`} onClick={()=>toggle(f.id)}>
                <div className="feat-pill-icon">{f.icon}</div>
                <div className="feat-pill-label">{f.label}</div>
                <div className="feat-pill-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* inline workspace */}
        <div ref={workspaceRef} className={`workspace${active?" open":""}`}>

          {active==="live"&&(
            <div className="panel">
              <div><h2 className="panel-title">Live Transcription</h2><p className="panel-sub">Speak into your microphone. Transcribed every 3 seconds in real time.</p></div>
              <div className="translate-row">
                <label className="toggle-wrap">
                  <input type="checkbox" checked={translateOn} onChange={e=>setTranslateOn(e.target.checked)} disabled={recording}/>
                  <span>Translate to</span>
                </label>
                <div className="lang-wrap">
                  <FaLanguage size={13}/>
                  <select className="lang-select" value={lang} onChange={e=>setLang(e.target.value)} disabled={recording||!translateOn}>
                    {LANGS.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="mic-row">
                {!recording
                  ?<button className="btn-mic start" onClick={startRec}><FaMicrophone size={14}/>Start Recording</button>
                  :<button className="btn-mic stop"  onClick={stopRec}><FaStop size={12}/>Stop</button>
                }
                {recording&&(
                  <div className="rec-status">
                    <FaCircle className="rec-dot" size={8}/><span>{fmtTimer(duration)}</span>
                    {translating&&<span className="badge-translating">Translating</span>}
                  </div>
                )}
              </div>
              {micErr&&<p className="mic-err">{micErr}</p>}
              {(liveTx||recording)&&(
                <div className={`live-grid${!translateOn?" single":""}`}>
                  <div className="output-card">
                    <div className="live-card-head"><h4>English</h4>{recording&&<span className="badge-live">● Live</span>}</div>
                    <p className="output-text">{liveTx||<span className="waiting">Listening…</span>}</p>
                  </div>
                  {translateOn&&(
                    <div className="output-card">
                      <div className="live-card-head"><h4>{langLabel}</h4>{translating&&<span className="badge-translating">Translating</span>}</div>
                      <p className="output-text">{liveTl||<span className="waiting">Waiting…</span>}</p>
                    </div>
                  )}
                </div>
              )}
              {liveTx&&!recording&&(
                <div className="dl-row">
                  <button className="btn-dl" onClick={()=>dlText(liveTx,"transcript.txt")}><FaDownload size={11}/>Transcript TXT</button>
                  {translateOn&&liveTl&&(
                    <>
                      <button className="btn-dl" onClick={()=>dlText(liveTl,`translation_${lang}.txt`)}><FaDownload size={11}/>{langLabel} TXT</button>
                      <button className="btn-dl" onClick={()=>dlText(`=== Original (English) ===\n\n${liveTx}\n\n=== ${langLabel} ===\n\n${liveTl}`,"both.txt")}><FaDownload size={11}/>Both TXT</button>
                    </>
                  )}
                  <button className="btn-dl hi" onClick={()=>dlDocx(liveDocxPayload())}>
                    <FaFileWord size={12}/>Word Report{translateOn&&liveTl?` (EN + ${langLabel})`:""}
                  </button>
                  <button className="btn-dl hi" onClick={()=>dlPdf(liveDocxPayload())}>
                    <FaFilePdf size={12}/>PDF Report{translateOn&&liveTl?` (EN + ${langLabel})`:""}
                  </button>
                </div>
              )}
            </div>
          )}

          {active==="report"&&(
            <div className="panel">
              <div><h2 className="panel-title">Full Meeting Report</h2><p className="panel-sub">One upload — summary, transcript, attendees, and a formatted Word document.</p></div>
              <UploadRow file={repFile} onChange={setRepFile} onGo={genReport} busy={repLoading} label="Generate Report"/>
              {repLoading&&<ProgressBox msg={repMsg} pct={repPct} startTime={repStart}/>}
              {rep&&!repLoading&&(
                <>
                  <div className="meeting-info-strip">
                    <span>📅 {rep.date}</span>
                    {rep.time&&<span>🕐 {rep.time}</span>}
                    <span>📁 {rep.filename}</span>
                    <span>🧠 {rep.llm_used ? "Ollama" : "Fallback"}</span>
                  </div>
                  <div className="report-tabs">
                    {[["summary","Summary"],["transcript","Transcript"],["attendees","Attendees"]].map(([id,lbl])=>(
                      <button key={id} className={`r-tab${repTab===id?" active":""}`} onClick={()=>setRepTab(id)}>{lbl}</button>
                    ))}
                  </div>
                  {repTab==="summary"   &&<div className="output-card"><p className="output-label">Summary</p><p className="output-text">{rep.summary}</p></div>}
                  {repTab==="transcript"&&<div className="output-card"><p className="output-label">Transcript</p><p className="output-text">{rep.transcript}</p></div>}
                  {repTab==="attendees" &&rep.attendees.length>0&&<AttCards list={rep.attendees} segList={rep.segments}/>}
                  <div className="dl-row">
                    <button className="btn-dl" onClick={()=>dlText(`=== SUMMARY ===\n\n${rep.summary}\n\n=== TRANSCRIPT ===\n\n${rep.transcript}`,"report.txt")}><FaDownload size={11}/>TXT</button>
                    <button className="btn-dl hi" onClick={()=>dlDocx(repDocxPayload(rep))}><FaFileWord size={13}/>Download Word Report</button>
                    <button className="btn-dl hi" onClick={()=>dlPdf(repDocxPayload(rep))}><FaFilePdf size={13}/>Download PDF Report</button>
                  </div>
                </>
              )}
            </div>
          )}

          {active==="summary"&&(
            <div className="panel">
              <div><h2 className="panel-title">Meeting Summary</h2><p className="panel-sub">Upload audio to generate a concise AI-powered summary.</p></div>
              <UploadRow file={audioFile} onChange={setAudioFile} onGo={()=>genSummary(audioFile)} busy={processing} label="Generate Summary"/>
              {processing&&<ProgressBox msg={procMsg} pct={procPct} startTime={procStart}/>}
              {summary&&!processing&&(
                <div className="output-card"><p className="output-label">Summary</p><p className="output-text">{summary}</p>
                  <div className="dl-row" style={{marginTop:10}}><button className="btn-dl" onClick={()=>dlText(summary,"summary.txt")}><FaDownload size={11}/>Download</button></div>
                </div>
              )}
            </div>
          )}

          {active==="transcript"&&(
            <div className="panel">
              <div><h2 className="panel-title">Full Transcript</h2><p className="panel-sub">Get a full word-for-word transcript of your meeting audio.</p></div>
              <UploadRow file={audioFile} onChange={setAudioFile} onGo={()=>genSummary(audioFile)} busy={processing} label="Generate Transcript"/>
              {processing&&<ProgressBox msg={procMsg} pct={procPct} startTime={procStart}/>}
              {transcript&&!processing&&(
                <div className="output-card"><p className="output-label">Transcript</p><p className="output-text">{transcript}</p>
                  <div className="dl-row" style={{marginTop:10}}><button className="btn-dl" onClick={()=>dlText(transcript,"transcript.txt")}><FaDownload size={11}/>Download</button></div>
                </div>
              )}
            </div>
          )}

          {active==="attendees"&&(
            <div className="panel">
              <div><h2 className="panel-title">Speaker Detection</h2><p className="panel-sub">Detect speakers and see who talked the most.</p></div>
              <UploadRow file={diarFile} onChange={setDiarFile} onGo={()=>genDiar(diarFile)} busy={diarizing} label="Detect Speakers"/>
              {diarizing&&<ProgressBox msg={diarMsg} pct={diarPct} startTime={diarStart}/>}
              {attendees.length>0&&<><AttCards list={attendees} segList={segs}/>
                <div className="dl-row"><button className="btn-dl" onClick={()=>dlText(segs.map(s=>`[${s.speaker}]: ${s.text}`).join("\n\n"),"speakers.txt")}><FaDownload size={11}/>Download</button></div>
              </>}
            </div>
          )}

          {active==="audio"&&(
            <div className="panel">
              <div><h2 className="panel-title">Summarize & Transcribe</h2><p className="panel-sub">Upload any meeting recording to get a complete summary and word-for-word transcript together.</p></div>
              <UploadRow file={audioFile} onChange={setAudioFile} onGo={()=>genSummary(audioFile)} busy={processing} label="Generate Summary"/>
              {processing&&<ProgressBox msg={procMsg} pct={procPct} startTime={procStart}/>}
              {summary&&!processing&&<div className="output-card"><p className="output-label">Summary</p><p className="output-text">{summary}</p></div>}
            </div>
          )}
        </div>

        {/* ── LANDING SECTIONS ── */}
        <LandingSections onStart={()=>heroRef.current?.scrollIntoView({behavior:"smooth",block:"start"})}/>

        <footer className="footer">
          <div className="footer-about">
            <p className="trusted-label" style={{marginBottom:10,textAlign:"center"}}>About the Project</p>
            <h3 style={{fontSize:16,fontWeight:700,letterSpacing:"-0.01em",color:"var(--text)",marginBottom:10,textAlign:"center"}}>A Python Full-Stack AI Meeting Tool</h3>
            <p style={{fontSize:13,fontWeight:300,color:"var(--text2)",lineHeight:1.75,maxWidth:600,margin:"0 auto 18px",textAlign:"center"}}>
              Built with Python Flask, React, and OpenAI Whisper. Runs fully locally — your audio and data never leave your machine.
              Uses faster-whisper for transcription, extractive AI for summaries, and Node.js to generate professional Word reports.
            </p>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginBottom:28}}>
              {["Python Flask","React","Whisper AI","faster-whisper","Node.js docx","Real-time Mic","Word Reports","Speaker Detection"].map(tag=>(
                <span key={tag} style={{
                  background:"var(--surface2)",border:"1px solid var(--border-hi)",
                  color:"var(--text3)",padding:"4px 12px",borderRadius:"999px",
                  fontSize:"11px",fontWeight:500,fontFamily:"var(--mono)"
                }}>{tag}</span>
              ))}
            </div>
            <p style={{fontSize:12,color:"var(--text3)",fontFamily:"var(--mono)",letterSpacing:".04em",textAlign:"center"}}>
              AI Meeting Summarizer — Python Full Stack Project
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}