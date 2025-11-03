require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const sql = require('mssql');
//const SQLGenerator = require('./sqlGenerator');


const app = express();
app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '1mb' }));

// SQL Server config via env
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    enableArithAbort: true
  },
  port: parseInt(process.env.DB_PORT, 10)
};

// Brief schema description for the LLM
const SCHEMA_DESCRIPTION = `
Tables:
- SalesReport_Form_Input: ID, LEAD_ID, LAST_NAME, FIRST_NAME, DIVISION, DEALER_LOCATION, STOCK, VEHICLE_TYPE, CAR_STATUS, MAKE_YEAR, MAKE, MODEL, TOTAL_COST, LEAD_SOURCE, LEAD_OWNER, CLOSER, DATE_REPORTED, YEAR_REPORTED, MONTH_REPORTED, SOLD_FROM, DATE_FUNDED, DATE_POSTED, DATE_RECEIVED, PBS_DATA, isCarryOver, isDeleted, isCounted, HasLien...
- Common_Group_401_Vehicle_Inventory: ID, vId, VehicleId, StockNumber, VIN, VehicleType, VehicleTrim, VehicleStatus, VehicleMake, VehicleModel, VehicleYear, Inventory, TotalCost, Retail, isHold, isSold, isAvailable, DATE_CREATED, Odometer, Lot, IsCertified, isAvailable, MSR, BaseMSR, InternetPrice, ...
- SaleWarranty_RVAC_CONTRACTS: WarrantyID, SalesRep, DealerLocation, VehicleCondition, FirstName, LastName, StockNumber, VIN, VehicleYear, Make, Model, VehiclePrice, Model_Type, WarantyPlan, WarrantyPrice, YEAR_REPORTED, MONTH_REPORTED, isDeleted, WarrantyCost
`;

// Very conservative safety: permit only one SELECT/CTE statement (no semicolons, no DDL/DML)
function isSafeSelect(sqlText) {
  if (!sqlText) return false;
  const lowered = sqlText.trim().toLowerCase();

  // Allow trailing semicolon but not multiple statements
  const semicolonCount = (lowered.match(/;/g) || []).length;
  if (semicolonCount > 1 || (semicolonCount === 1 && !lowered.endsWith(';'))) return false;

  if (!(lowered.startsWith('select') || lowered.startsWith('with'))) return false;

  const forbidden = [
    'insert ', 'update ', 'delete ', 'drop ', 'alter ',
    'create ', 'truncate ', 'exec ', 'merge ', 'grant ', 'revoke '
  ];
  for (const kw of forbidden) {
    if (lowered.includes(kw)) return false;
  }
  return true;
}

async function callGroqChat(messages, model) {
  // Groq OpenAI-compatible endpoint
  const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');
  const payload = {
    model: model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    messages,
    max_tokens: 800,
    temperature: 0.0
  };
  const resp = await axios.post(endpoint, payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 60_000
  });
  return resp.data;
}

async function generateSqlFromPrompt(prompt) {
  const system = `You are a helpful assistant that strictly returns a single valid SQL Server SELECT query (no explanation).
The database schema is described as:
${SCHEMA_DESCRIPTION}
Rules:
1. Map following to table
 - "sales" or "sales deal" or "sold" or anything mentioned with "sales" etc → 'SalesReport_Form_Input' table
 - "inventory" or "sales inventory" etc → 'Common_Group_401_Vehicle_Inventory' table
 - "rvac" or "rvac contract" etc → 'SaleWarranty_RVAC_CONTRACTS' table
1. Map natural language fields to these table columns:
   - "dealership" → DEALER_LOCATION and always use equal to compare
   - "gross" or "total cost" → TOTAL_COST
   - VEHICLE_TYPE include "auto", "rv", "marine"
   - CAR_STATUS include "new", "used"
   - Division include "401", "franchise", "401 retail"
   - when compare month as againast MONTH_REPORTED always use month name and make sure YEAR_REPORTED is always with month reported param if year mentioned use that number other wise use current year
   -  when getting data from SalesReport_Form_Input table do not include rows where isCarryOver = 1 and where isDeleted = 1 and when aggregate data for sales and when count deals only make sure isCounted = 1 but for gross aggregate  consider isCounted = 1 and isCounted = 0 both
   -  when getting data from SaleWarranty_RVAC_CONTRACTS table do not include rows where where isDeleted = 1
2. When performing SUM on any numeric column stored as varchar, always clean and cast it:
   SUM(CAST(REPLACE(REPLACE(ColumnName, ',', ''), ' ', '') AS DECIMAL(13,2)))
3. Only use SELECT or WITH statements, never INSERT/UPDATE/DELETE/DROP/ALTER/CREATE.
4. Use table and column names exactly as shown in the schema.
5. If unsure or If the request cannot be answered with available columns, return 'SELECT TOP (0) * FROM SalesReport_Form_Input';
6. Return ONLY the SQL query, no explanation.
7. Return ONLY the SQL query in valid T-SQL format suitable for SQL Server.
8. Do NOT return any explanation or metadata.
`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `User request: "${prompt}"\nReturn only the SQL query.` }
  ];
  const groqResp = await callGroqChat(messages);
  const sqlText = groqResp?.choices?.[0]?.message?.content?.trim();
  return sqlText;
}

app.post('/api/query', async (req, res) => {
    console.log('generateSqlFromPrompt Called ')
  try {
    const { prompt } = req.body;
    
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    // 1) Generate SQL from prompt
    //const sqlQuery = await generateSqlFromPrompt(prompt);
    const sqlQuery = await generateSqlFromPrompt(prompt);
    console.log({prompt: prompt, sqlQuery : sqlQuery});
    if (!sqlQuery){
        
        return res.status(500).json({ error: 'LLM did not return SQL' });
    } 

    // 2) Safety check
    if (!isSafeSelect(sqlQuery)) {
      return res.status(400).json({ error: 'Generated SQL is not allowed by policy.', sql: sqlQuery });
    }

    // 3) Execute safely (uses mssql)
    await sql.connect(dbConfig);
    const result = await sql.query(sqlQuery);

    let chartType = '';

    const chartPatterns = [
        { pattern: /\b(bar\s*chart|barchart|bar\s*graph)\b/i, type: 'bar' },
        { pattern: /\b(line\s*chart|linechart|line\s*graph)\b/i, type: 'line' },
        { pattern: /\b(pie\s*chart|piechart|pie\s*graph)\b/i, type: 'pie' },
        { pattern: /\b(table|tabular|data\s*table)\b/i, type: 'table' }
    ];

    for (const { pattern, type } of chartPatterns) {
        if (pattern.test(prompt)) {
            chartType = type;
            break;
        }
    }

    console.log(`Selected chart type: ${chartType}`);

    // 4) Choose visualization type heuristically
    let viz = chartType;
    if (result.recordset && result.recordset.length > 0) {
      const cols = Object.keys(result.recordset[0]);
      const hasDate = cols.some(c => /date|month|year|time/i.test(c));
      const numericCols = cols.filter(c =>
        typeof result.recordset[0][c] === 'number' ||
        /^\d+(\.\d+)?$/.test(String(result.recordset[0][c]))
      );
      if(viz === ''){
        if (hasDate && numericCols.length >= 1) viz = 'line';
        else if (numericCols.length >= 1 && cols.length <= 3) viz = 'bar';
        else viz = 'table';
      }
      
    }

    res.json({ sql: sqlQuery, rows: result.recordset || [], visualization: viz });
  } catch (err) {
    console.error('Error in /api/query', err.response ? err.response.data : err.message);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server listening on ${port}`));
