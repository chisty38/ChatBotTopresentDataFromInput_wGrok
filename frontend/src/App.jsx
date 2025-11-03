import React, { useState } from 'react';
import axios from 'axios';
import ChartView from './components/ChartView';

export default function App(){
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [sql, setSql] = useState("");
  const [viz, setViz] = useState("table");
  const [error, setError] = useState("");

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
    </div>
  );
}