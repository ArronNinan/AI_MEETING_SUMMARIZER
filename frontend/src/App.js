import { useState, useEffect } from "react";
import "./App.css";
import {
  FaFileAudio,
  FaAlignLeft,
  FaTasks,
  FaSmile,
  FaClock,
  FaFileAlt,
  FaDownload,
  FaMoon,
  FaSun
} from "react-icons/fa";

function App() {
  const [audioFile, setAudioFile] = useState(null);
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [activeFeature, setActiveFeature] = useState("summary");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [darkMode, setDarkMode] = useState(false);

  // 🌙 APPLY DARK MODE TO FULL BODY
  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark");
    } else {
      document.body.classList.remove("dark");
    }
  }, [darkMode]);

  const handleAudioChange = (e) => {
    setAudioFile(e.target.files[0]);
  };

  const downloadText = (content, filename) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const generateSummary = async () => {
    if (!audioFile) return;

    setIsProcessing(true);
    setProgress(10);
    setMessage("Uploading audio...");
    setTranscript("");
    setSummary("");

    const formData = new FormData();
    formData.append("audio", audioFile);

    const uploadRes = await fetch("http://127.0.0.1:5000/upload", {
      method: "POST",
      body: formData
    });

    const uploadData = await uploadRes.json();
    const taskId = uploadData.task_id;

    setMessage("Processing meeting in background...");

    const interval = setInterval(async () => {
      const statusRes = await fetch(
        `http://127.0.0.1:5000/status/${taskId}`
      );
      const statusData = await statusRes.json();

      if (statusData.status === "completed") {
        setTranscript(statusData.result.transcript);
        setSummary(statusData.result.summary);
        setProgress(100);
        setIsProcessing(false);
        setMessage("Processing completed");
        clearInterval(interval);
      } else {
        setProgress((prev) => (prev < 90 ? prev + 10 : prev));
      }
    }, 2000);
  };

  return (
    <div className="page fade-in">

      {/* 🌙 DARK MODE TOGGLE */}
      <div className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
        {darkMode ? <FaSun /> : <FaMoon />}
      </div>

      {/* HERO */}
      <header className="hero">
        <span className="badge">AI Powered</span>
        <h1>AI Meeting Summarizer</h1>
        <p>
          Automatically convert long meeting audio into structured summaries,
          transcripts, and actionable insights.
        </p>
      </header>

      {/* FEATURES */}
      <section className="features">
        <div className={`feature-card ${activeFeature === "summary" ? "active" : ""}`}
          onClick={() => setActiveFeature("summary")}>
          <FaFileAlt size={28} />
          <span>Summary</span>
        </div>

        <div className={`feature-card ${activeFeature === "transcript" ? "active" : ""}`}
          onClick={() => setActiveFeature("transcript")}>
          <FaAlignLeft size={28} />
          <span>Transcript</span>
        </div>

        <div className="feature-card disabled">
          <FaTasks size={28} />
          <span>Action Items</span>
        </div>

        <div className="feature-card disabled">
          <FaSmile size={28} />
          <span>Sentiment</span>
        </div>

        <div className="feature-card disabled">
          <FaClock size={28} />
          <span>Timestamps</span>
        </div>

        <div className="feature-card">
          <FaFileAudio size={28} />
          <span>Audio Input</span>
        </div>
      </section>

      {/* WORKSPACE */}
      <section className="workspace">
        <div className="center">
          <label className="upload-box">
            Upload meeting audio
            <input type="file" accept="audio/*" onChange={handleAudioChange} />
          </label>
        </div>

        <div className="center">
          <button
            className="generate-btn"
            onClick={generateSummary}
            disabled={!audioFile || isProcessing}
          >
            Generate Summary
          </button>
        </div>

        {isProcessing && (
          <div className="progress-box">
            <p>{message}</p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {activeFeature === "summary" && summary && !isProcessing && (
          <div className="output">
            <h3>Meeting Summary</h3>
            <p>{summary}</p>
            <div className="download-row">
              <button
                className="download-btn"
                onClick={() => downloadText(summary, "meeting_summary.txt")}
              >
                <FaDownload /> Download Summary
              </button>
            </div>
          </div>
        )}

        {activeFeature === "transcript" && transcript && !isProcessing && (
          <div className="output">
            <h3>Full Transcript</h3>
            <p>{transcript}</p>
            <div className="download-row">
              <button
                className="download-btn"
                onClick={() => downloadText(transcript, "meeting_transcript.txt")}
              >
                <FaDownload /> Download Transcript
              </button>
            </div>
          </div>
        )}
      </section>

      <footer className="footer">
        <p>AI Meeting Summarizer – Python Full Stack Project</p>
      </footer>
    </div>
  );
}

export default App;
