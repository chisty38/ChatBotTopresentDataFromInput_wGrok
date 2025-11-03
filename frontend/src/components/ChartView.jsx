import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, ResponsiveContainer, LabelList } from 'recharts';

function inferColumns(rows){
  if(!rows || rows.length===0) return { xKey: null, yKey: null };
  const sample = rows[0];
  const keys = Object.keys(sample);
  
  const dateKey = keys.find(k => /date|month|year/i.test(k));
  const numericKey = keys.find(k => typeof sample[k] === 'number' || /^\d+(\.\d+)?$/.test(String(sample[k])));
  console.log({keys: keys, xKey: dateKey, yKey: numericKey || keys[1] || keys[0]});
  return { xKey: dateKey || keys[0], yKey: numericKey || keys[1] || keys[0] };
}

export default function ChartView({ rows, viz }){
  if(!rows || rows.length===0) return <div>No data to display</div>;
  const { xKey, yKey } = inferColumns(rows);
  if(viz === 'bar' && xKey && yKey){
    const data = rows.map(r => ({ ...r, [yKey]: Number(String(r[yKey]).replace(/[^0-9.-]/g,'')) || 0 }));
    // Format number with commas
  const formatNumber = (value) => value.toLocaleString();
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip formatter={(value) => [formatNumber(value), yKey]} />
        <Bar dataKey={yKey}>{console.log({yKey: yKey})}
          <LabelList dataKey={yKey} position="top" formatter={formatNumber} />
        </Bar>
      </BarChart>
      </ResponsiveContainer>
    );
  }
  console.log({viz: viz});
  if(viz === 'line' && xKey && yKey){
    const data = rows.map(r => ({ ...r, [yKey]: Number(String(r[yKey]).replace(/[^0-9.-]/g,'')) || 0 }));
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={xKey} /><YAxis /><Tooltip /><Line type="monotone" dataKey={yKey} /></LineChart>
      </ResponsiveContainer>
    );
  }

  const cols = Object.keys(rows[0]);
  return (
    <div style={{overflowX:'auto'}}>
      <table border="1" cellPadding="6" style={{borderCollapse:'collapse', width:'100%'}}>
        <thead><tr>{cols.map(c=> <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r,idx)=> <tr key={idx}>{cols.map(c=> <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
