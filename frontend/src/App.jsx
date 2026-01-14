import React, { useState, useEffect  } from 'react';
import axios from 'axios';
import ChartView from './components/ChartView';

export default function App(){
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [sql, setSql] = useState("");
  const [viz, setViz] = useState("table");
  const [error, setError] = useState("");

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);

   // 🔥 Load chat from localStorage on first render
  useEffect(() => {
    const saved = localStorage.getItem("chat_history");
    if (saved) {
      setMessages(JSON.parse(saved));
    }
  }, []);

  // 🔥 Save on every message update
  useEffect(() => {
    localStorage.setItem("chat_history", JSON.stringify(messages));
  }, [messages]);

   // ===============================
  // STREAMING HANDLER
  // ===============================
  async function streamPost(url, payload, onToken) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let partial = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      partial += chunk;

      onToken(partial);
    }
  }

  // =======================================
  // API detection (same logic you used)
  // =======================================
  const detectApi = (text) => {
    const trimmed = text.trim();

    if (trimmed.includes("\n---")) return "batch";
    if (/^\[.*\]$/.test(trimmed) || trimmed.includes(",") || trimmed.includes("|")) {
      return "data";
    }
    if (trimmed.length > 250) return "text";
    return "general";
  };

  // =======================================
  // SEND HANDLER WITH STREAMING
  // =======================================
  const handleSend = async () => {
    if (!input) return;

    // Add user message
    const userMessage = { sender: "user", text: input };
    setMessages((prev) => [...prev, userMessage]);

    // Determine backend API
    const detected = detectApi(input);

    let apiUrl = (process.env.REACT_APP_API_BASE || "") + "/api/ask";
    let payload = {};

    if (detected === "general") {
      apiUrl = (process.env.REACT_APP_API_BASE || "") + "/api/ask";
      payload = { question: input };
    } else if (detected === "data") {
      apiUrl = (process.env.REACT_APP_API_BASE || "") + "/api/analyze";
      payload = {
        question: "Analyze this data",
        data: input,
        dataType: "auto"
      };
    } else if (detected === "text") {
      apiUrl = (process.env.REACT_APP_API_BASE || "") + "/api/analyze-text";
      payload = { text: input, analysisType: "summarize" };
    } else if (detected === "batch") {
      const items = input.split("\n---").map((q) => q.trim());
      apiUrl = (process.env.REACT_APP_API_BASE || "") + "/api/analyze-batch";
      payload = {
        requests: items.map((q) => ({ type: "general", question: q }))
      };
    }

    // Placeholder bot message for live streaming
    const botIndex = messages.length + 1;
    setMessages((prev) => [...prev, { sender: "bot", text: "" }]);

    // STREAMING MAGIC 🪄
    try {
      await streamPost(apiUrl, payload, (partialChunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[botIndex] = { sender: "bot", text: partialChunk };
          return updated;
        });
      });
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "Error: " + err.message }
      ]);
    }

    setInput("");
  };


  async function handleRun() {
    setError("");
    setLoading(true);
    try {
      const url = (process.env.REACT_APP_API_BASE || "") + "/api/query";
      console.log(url);
      const resp = await axios.post(url, { prompt });
      setSql(resp.data.sql);
      setRows(resp.data.rows || []);
      setViz(resp.data.visualization || "table");
    } catch (e) {
      console.log({ error: e });
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  const FuncExportToExcel = () => {
    console.log(rows);
  if (rows?.length === 0) return;

  // Convert data to CSV format
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','), // header row
    ...rows.map(row => headers.map(header => {
      const value = row[header];
      // Handle values that might contain commas or quotes
      return typeof value === 'string' && (value.includes(',') || value.includes('"')) 
        ? `"${value.replace(/"/g, '""')}"` 
        : value;
    }).join(','))
  ].join('\n');

  // Create and download the file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', 'query_results.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
  async function streamPost(url, payload, onToken) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.body) {
    throw new Error("ReadableStream not supported / No body returned");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Deliver token(s)
    onToken(buffer);
  }
}

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h2>testing AI Model with → SQL</h2>
      <p>Example: "Show count of vehicles by VehicleMake for 2024 as a bar chart"</p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{ width: "100%" }}
      />
      <div style={{ marginTop: 10 }}>
        <button onClick={handleRun} disabled={loading || !prompt}>
          Run
        </button>
        <button
          onClick={FuncExportToExcel}
          disabled={rows?.length === 0}
          style={{ marginLeft: 10 }}
        >
          Export To Excel
        </button>
      </div>
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {sql && (
        <div style={{ marginTop: 10 }}>
          <h4>Generated SQL</h4>
          <pre style={{ background: "#f4f4f4", padding: 10 }}>{sql}</pre>
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <h4>
          Results ({rows?.length}) — Visualization: {viz}
        </h4>
        <ChartView rows={rows} viz={viz} />
      </div>
      <div style={{ width: "100%", maxWidth: 700, margin: "auto", padding: 20 }}>
      <h2>Grok Streaming Chat</h2>

      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: 8,
          padding: 10,
          height: 400,
          overflowY: "auto",
          marginBottom: 10,
          background: "#fafafa"
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              margin: "10px 0",
              textAlign: m.sender === "user" ? "right" : "left"
            }}
          >
            <div
              style={{
                display: "inline-block",
                padding: "10px 12px",
                borderRadius: 8,
                background: m.sender === "user" ? "#d1e7ff" : "#eee",
                maxWidth: "80%",
                whiteSpace: "pre-wrap"
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <textarea
        placeholder="Type something..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 5,
          border: "1px solid #ccc",
          marginBottom: 10
        }}
      />

      <button
        onClick={handleSend}
        style={{
          padding: "10px 15px",
          background: "#007bff",
          color: "#fff",
          border: "none",
          borderRadius: 5,
          cursor: "pointer"
        }}
      >
        Send
      </button>
    </div>
    </div>
  );
}