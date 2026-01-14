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

// Schema configuration
// Enhanced mappings for better detection
const TABLE_MAPPINGS = {
  'sales': {
    table: 'SalesReport_Form_Input',
    synonyms: ['sales', 'sale', 'sold', 'deal', 'deals', 'transaction', 'revenue', 'gross', 'purchase'],
    description: 'Sales data including deals, costs, and dealership information',
    // Specific patterns that indicate this table
    patterns: [
      /sales\s+by\s+/i,
      /sales\s+for\s+/i,
      /deals\s+by\s+/i,
      /count\s+deals/i,
      /count\s+sales/i
    ]
  },
  'inventory': {
    table: 'Common_Group_401_Vehicle_Inventory',
    synonyms: ['inventory', 'stock', 'vehicles', 'available', 'on hand'],
    description: 'Vehicle inventory data'
  },
  'rvac': {
    table: 'SaleWarranty_RVAC_CONTRACTS',
    synonyms: ['rvac', 'warranty', 'contract', 'service contract', 'extended warranty'],
    description: 'RVAC warranty contracts'
  }
};

// Enhanced column mappings with better synonyms
const COLUMN_MAPPINGS = {
  'dealership': {
    column: 'DEALER_LOCATION',
    operator: '=',
    synonyms: ['dealership', 'dealer', 'location', 'store', 'branch', 'by location', 'per location'],
    patterns: [/by\s+location/i, /per\s+location/i, /location\s+wise/i]
  },
  'gross': {
    column: 'TOTAL_COST',
    function: 'SUM',
    synonyms: ['gross', 'total cost', 'revenue', 'amount', 'price', 'cost', 'total', 'total gross'],
    patterns: [/total\s+cost/i, /total\s+gross/i]
  },
  'front_gross': {
    column: 'FRONT_COST',
    function: 'SUM',
    synonyms: ['front gross', 'front cost', 'front', 'front profit', 'front margin'],
    patterns: [/front\s+gross/i, /front\s+cost/i]
  },
  'fi_gross': {
    column: 'FI_COST',
    function: 'SUM',
    synonyms: ['fi gross', 'fi cost', 'finance income', 'fi income', 'finance gross', 'backend gross'],
    patterns: [/fi\s+gross/i, /fi\s+cost/i, /finance\s+income/i]
  },
  'count': {
    column: 'ID',
    function: 'COUNT',
    synonyms: ['count', 'number', 'how many', 'total deals', 'total sales'],
    patterns: [/count/i, /number of/i, /how many/i]
  },
  'month': {
    column: 'MONTH_REPORTED',
    related: 'YEAR_REPORTED',
    synonyms: ['month', 'monthly', 'last month', 'this month', 'mtd', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
    patterns: [/(january|february|march|april|may|june|july|august|september|october|november|december)/i]
  },
  'year': {
    column: 'YEAR_REPORTED',
    synonyms: ['year', 'yearly', 'annual', 'last year', 'this year', 'ytd', 'year to date'],
    patterns: [/\b(20\d{2})\b/, /\b(19\d{2})\b/, /year/i, /ytd/i, /annual/i]
  },
  'quarter': {
    column: 'DATEPART(QUARTER, DATE_REPORTED)',
    synonyms: ['quarter', 'quarterly', 'q1', 'q2', 'q3', 'q4'],
    patterns: [/q[1-4]/i, /quarter/i, /quarterly/i]
  },
  'day': {
    column: 'DATE_REPORTED',
    synonyms: ['day', 'daily', 'today', 'yesterday', 'date', 'specific date', 'day before yesterday'],
    patterns: [/today/i, /yesterday/i, /day before yesterday/i, /\b\w+\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}\b/i, /daily/i]
  },
  'week': {
    column: 'DATE_REPORTED',
    synonyms: ['week', 'weekly', 'this week', 'last week', 'week to date'],
    patterns: [/week/i, /weekly/i]
  }
};

// Brief schema description for the LLM
const SCHEMA_DESCRIPTION = `
Tables:
- SalesReport_Form_Input: ID, LEAD_ID, LAST_NAME, FIRST_NAME, DIVISION, DEALER_LOCATION, STOCK, VEHICLE_TYPE, CAR_STATUS, MAKE_YEAR, MAKE, MODEL, TOTAL_COST, FRONT_COST, FI_COST, LEAD_SOURCE, LEAD_OWNER, CLOSER, DATE_REPORTED, YEAR_REPORTED, MONTH_REPORTED, SOLD_FROM, DATE_FUNDED, DATE_POSTED, DATE_RECEIVED, PBS_DATA, isCarryOver, isDeleted, isCounted, HasLien...
- Common_Group_401_Vehicle_Inventory: ID, vId, VehicleId, StockNumber, VIN, VehicleType, VehicleTrim, VehicleStatus, VehicleMake, VehicleModel, VehicleYear, Inventory, TotalCost, Retail, isHold, isSold, isAvailable, DATE_CREATED, Odometer, Lot, IsCertified, isAvailable, MSR, BaseMSR, InternetPrice, ...
- SaleWarranty_RVAC_CONTRACTS: WarrantyID, SalesRep, DealerLocation, VehicleCondition, FirstName, LastName, StockNumber, VIN, VehicleYear, Make, Model, VehiclePrice, Model_Type, WarantyPlan, WarrantyPrice, YEAR_REPORTED, MONTH_REPORTED, isDeleted, WarrantyCost, ...
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
    model: model || process.env.GROQ_MODEL || "openai/gpt-oss-20b", //model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    messages,
    max_tokens: 800,
    temperature: 0.0
  };
  console.log({payload : payload, apiKey : apiKey, messages : JSON.stringify(messages)});
  const resp = await axios.post(endpoint, payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 60_000
  });
  return resp.data;
}

// Helper function to analyze user prompt
// Enhanced prompt analysis with better date parsing
function analyzeUserPrompt(prompt) {
  const promptLower = prompt.toLowerCase();
  
  // Detect primary table with pattern matching
  let detectedTable = { table: 'SalesReport_Form_Input', confidence: 0.5, key: 'sales' };
  
  for (const [key, config] of Object.entries(TABLE_MAPPINGS)) {
    let confidence = 0;
    
    // Check synonyms
    config.synonyms.forEach(syn => {
      if (promptLower.includes(syn.toLowerCase())) {
        confidence += 0.3;
      }
    });
    
    // Check patterns
    if (config.patterns) {
      config.patterns.forEach(pattern => {
        if (pattern.test(prompt)) {
          confidence += 0.5;
        }
      });
    }
    
    if (confidence > detectedTable.confidence) {
      detectedTable = { 
        table: config.table, 
        confidence,
        key
      };
    }
  }
  
  // Enhanced filter detection with patterns
  const filters = [];
  const aggregates = [];
  
  for (const [key, config] of Object.entries(COLUMN_MAPPINGS)) {
    let detected = false;
    
    // Check patterns first (more specific)
    if (config.patterns) {
      config.patterns.forEach(pattern => {
        const match = prompt.match(pattern);
        if (match) {
          detected = true;
          const value = extractValueFromPrompt(prompt, config.synonyms[0], match[0]);
          
          filters.push({
            column: config.column,
            concept: key,
            value: value,
            isAggregate: !!config.function
          });
          
          if (config.function) {
            aggregates.push({
              column: config.column,
              function: config.function,
              alias: getAggregateAlias(key)
            });
          }
        }
      });
    }
    
    // Check synonyms if not detected by patterns
    if (!detected) {
      for (const syn of config.synonyms) {
        if (promptLower.includes(syn.toLowerCase())) {
          const value = extractValueFromPrompt(prompt, syn);
          
          filters.push({
            column: config.column,
            concept: key,
            value: value,
            isAggregate: !!config.function
          });
          
          if (config.function) {
            aggregates.push({
              column: config.column,
              function: config.function,
              alias: getAggregateAlias(key)
            });
          }
          break;
        }
      }
    }
  }
  
  // Special handling for "count" - check if it's mentioned independently
  if (promptLower.includes('count') && !aggregates.some(a => a.function === 'COUNT')) {
    aggregates.push({
      column: 'ID',
      function: 'COUNT',
      alias: 'TotalDeals'
    });
  }
  
  // Enhanced date/time detection
  const timeRange = detectTimeRangeEnhanced(prompt);
  
  // Check for "table format" - this is a presentation hint, not a filter
  const requiresTableFormat = /table\s+format|tabular|grid|spreadsheet/i.test(prompt);
  
  return {
    table: detectedTable,
    filters: filters.filter(f => !f.isAggregate), // Separate aggregates from filters
    aggregates,
    timeRange,
    presentation: {
      format: requiresTableFormat ? 'table' : 'default',
      groupBy: detectGroupBy(prompt)
    }
  };
}

// Enhanced date detection
function detectTimeRangeEnhanced(prompt) {
  const patterns = [
    { 
      regex: /(\d{4})\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
      type: 'specific_month_year',
      handler: (match) => ({
        year: match[1],
        month: match[2].toLowerCase(),
        sqlCondition: `MONTH_REPORTED = '${match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase()}' AND YEAR_REPORTED = '${match[1]}'`
      })
    },
    { 
      regex: /(last|this|next)\s+month/i,
      type: 'relative_month',
      handler: (match) => {
        const month = match[1].toLowerCase();
        return {
          relative: month,
          sqlCondition: month === 'last' 
            ? `MONTH_REPORTED = DATENAME(MONTH, DATEADD(MONTH, -1, GETDATE())) AND YEAR_REPORTED = YEAR(DATEADD(MONTH, -1, GETDATE()))`
            : `MONTH_REPORTED = DATENAME(MONTH, GETDATE()) AND YEAR_REPORTED = YEAR(GETDATE())`
        };
      }
    },
    { 
      regex: /\b(20\d{2})\b/,
      type: 'specific_year',
      handler: (match) => ({
        year: match[0],
        sqlCondition: `YEAR_REPORTED = '${match[0]}'`
      })
    },
    { 
      regex: /q([1-4])\s+(\d{4})/i,
      type: 'quarter_year',
      handler: (match) => ({
        quarter: match[1],
        year: match[2],
        sqlCondition: `DATEPART(QUARTER, DATE_REPORTED) = ${match[1]} AND YEAR(DATE_REPORTED) = ${match[2]}`
      })
    },
    // Specific date (e.g., "January 9, 2026")
    {
      regex: /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})/i,
      type: 'specific_date',
      handler: (match) => {
        const monthNum = new Date(`${match[1]} 1`).getMonth() + 1;
        const day = parseInt(match[2], 10);
        const year = match[3];
        const dateStr = `${year}-${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        return {
          date: dateStr,
          sqlCondition: `CAST(DATE_REPORTED AS DATE) = '${dateStr}'`
        };
      }
    },
    // Year to date (YTD)
    {
      regex: /(ytd|year to date|this year so far)/i,
      type: 'ytd',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1) AND DATE_REPORTED <= GETDATE()`
      })
    },
    // Month to date (MTD)
    {
      regex: /(mtd|month to date|this month so far)/i,
      type: 'mtd',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND DATE_REPORTED <= GETDATE()`
      })
    },
    // Relative years (last/this/next year)
    {
      regex: /(last|this|next)\s+year/i,
      type: 'relative_year',
      handler: (match) => {
        const rel = match[1].toLowerCase();
        let offset = rel === 'last' ? -1 : rel === 'next' ? 1 : 0;
        return {
          relative: rel,
          sqlCondition: `YEAR_REPORTED = YEAR(DATEADD(YEAR, ${offset}, GETDATE()))`
        };
      }
    },
     // Relative quarters (last/this quarter)
    {
      regex: /(last|this)\s+quarter/i,
      type: 'relative_quarter',
      handler: (match) => {
        const rel = match[1].toLowerCase();
        let offset = rel === 'last' ? -1 : 0;
        return {
          relative: rel,
          sqlCondition: `DATEPART(QUARTER, DATE_REPORTED) = DATEPART(QUARTER, DATEADD(QUARTER, ${offset}, GETDATE())) AND YEAR(DATE_REPORTED) = YEAR(DATEADD(QUARTER, ${offset}, GETDATE()))`
        };
      }
    },
    // Today
    {
      regex: /today/i,
      type: 'today',
      handler: () => ({
        sqlCondition: `CAST(DATE_REPORTED AS DATE) = CAST(GETDATE() AS DATE)`
      })
    },
    // Yesterday
    {
      regex: /yesterday/i,
      type: 'yesterday',
      handler: () => ({
        sqlCondition: `CAST(DATE_REPORTED AS DATE) = CAST(DATEADD(DAY, -1, GETDATE()) AS DATE)`
      })
    },
    // Day before yesterday
    {
      regex: /day before yesterday/i,
      type: 'day_before_yesterday',
      handler: () => ({
        sqlCondition: `CAST(DATE_REPORTED AS DATE) = CAST(DATEADD(DAY, -2, GETDATE()) AS DATE)`
      })
    },
    // This week
    {
      regex: /this week/i,
      type: 'this_week',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEADD(DAY, 1 - DATEPART(WEEKDAY, GETDATE()), CAST(GETDATE() AS DATE)) AND DATE_REPORTED < DATEADD(DAY, 8 - DATEPART(WEEKDAY, GETDATE()), CAST(GETDATE() AS DATE))`
      })
    },
    // Last week
    {
      regex: /last week/i,
      type: 'last_week',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEADD(DAY, 1 - DATEPART(WEEKDAY, DATEADD(DAY, -7, GETDATE())), CAST(DATEADD(DAY, -7, GETDATE()) AS DATE)) AND DATE_REPORTED < DATEADD(DAY, 8 - DATEPART(WEEKDAY, DATEADD(DAY, -7, GETDATE())), CAST(DATEADD(DAY, -7, GETDATE()) AS DATE))`
      })
    },
    // Last 7 days
    {
      regex: /last 7 days|past week/i,
      type: 'last_7_days',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEADD(DAY, -7, GETDATE()) AND DATE_REPORTED < GETDATE()`
      })
    },
    // Last 30 days
    {
      regex: /last 30 days|past month/i,
      type: 'last_30_days',
      handler: () => ({
        sqlCondition: `DATE_REPORTED >= DATEADD(DAY, -30, GETDATE()) AND DATE_REPORTED < GETDATE()`
      })
    },
    // Custom range (e.g., "from January 1 to January 15 2026" - basic parsing)
    {
      regex: /from\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})/i,
      type: 'custom_range',
      handler: (match) => {
        const startMonthNum = new Date(`${match[1]} 1`).getMonth() + 1;
        const startDay = parseInt(match[2], 10);
        const endMonthNum = new Date(`${match[3]} 1`).getMonth() + 1;
        const endDay = parseInt(match[4], 10);
        const year = match[5];
        const startDate = `${year}-${startMonthNum.toString().padStart(2, '0')}-${startDay.toString().padStart(2, '0')}`;
        const endDate = `${year}-${endMonthNum.toString().padStart(2, '0')}-${endDay.toString().padStart(2, '0')}`;
        return {
          start: startDate,
          end: endDate,
          sqlCondition: `CAST(DATE_REPORTED AS DATE) BETWEEN '${startDate}' AND '${endDate}'`
        };
      }
    }
  ];
  
  for (const pattern of patterns) {
    const match = prompt.match(pattern.regex);
    if (match) {
      return pattern.handler(match);
    }
  }
  
  return null;
}

// Helper for aggregate aliases
function getAggregateAlias(concept) {
  const aliases = {
    'count': 'TotalDeals',
    'gross': 'TotalGross',
    'front_gross': 'FrontGross',
    'fi_gross': 'FIGross',
    'total_cost': 'TotalCost'
  };
  return aliases[concept] || concept.charAt(0).toUpperCase() + concept.slice(1);
}

// Helper to detect GROUP BY requirements
function detectGroupBy(prompt) {
  const promptLower = prompt.toLowerCase();
  const groupPatterns = [
    { pattern: /by\s+location/i, column: 'DEALER_LOCATION' },
    { pattern: /by\s+month/i, column: 'MONTH_REPORTED' },
    { pattern: /by\s+year/i, column: 'YEAR_REPORTED' },
    { pattern: /by\s+dealer/i, column: 'DEALER_LOCATION' },
    { pattern: /per\s+location/i, column: 'DEALER_LOCATION' },
    { pattern: /by\s+quarter/i, column: 'DATEPART(QUARTER, DATE_REPORTED)' },
    { pattern: /by\s+week/i, column: 'DATEPART(WEEK, DATE_REPORTED)' },
    { pattern: /by\s+day/i, column: 'CAST(DATE_REPORTED AS DATE)' }
  ];
  
  for (const gp of groupPatterns) {
    if (gp.pattern.test(promptLower)) {
      return gp.column;
    }
  }
  
  // Default group by for "by location" queries
  if (promptLower.includes('by location') || promptLower.includes('per location')) {
    return 'DEALER_LOCATION';
  }
  
  return null;
}


// Helper function to extract values from prompt
function extractValueFromPrompt(prompt, keyword, matchedPattern = null) {
  const promptLower = prompt.toLowerCase();
  const keywordLower = keyword.toLowerCase();
  
  // If we have a matched pattern (like "2025 DECEMBER"), use it
  if (matchedPattern) {
    // Extract the specific value from the pattern
    const yearMatch = matchedPattern.match(/\b(20\d{2})\b/);
    const monthMatch = matchedPattern.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    
    if (keywordLower === 'year' && yearMatch) return yearMatch[0];
    if (keywordLower === 'month' && monthMatch) return monthMatch[0];
  }
  
  // Look for quoted values
  const quotedMatch = prompt.match(/"([^"]+)"|'([^']+)'/);
  if (quotedMatch) return quotedMatch[1] || quotedMatch[2];
  
  // Look for values after keywords
  const idx = promptLower.indexOf(keywordLower);
  if (idx !== -1) {
    const after = prompt.substring(idx + keyword.length);
    const words = after.trim().split(/\s+/);
    
    // Special handling for year
    if (keywordLower.includes('year')) {
      const yearMatch = after.match(/\b(20\d{2})\b/);
      if (yearMatch) return yearMatch[0];
    }
    
    // Special handling for month
    if (keywordLower.includes('month')) {
      const monthMatch = after.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
      if (monthMatch) return monthMatch[0];
    }
    
    // Return next meaningful word(s)
    if (words[0] && !['for', 'in', 'by', 'with', 'and', 'the', 'a', 'an'].includes(words[0].toLowerCase())) {
      return words[0];
    }
    if (words[1]) return words[1];
  }
  
  return null;
}

// Helper function to detect time range
function detectTimeRange(prompt) {
  const promptLower = prompt.toLowerCase();
  
  const timePatterns = [
    { pattern: /last\s+(\d+)\s+months?/, type: 'months_ago' },
    { pattern: /last\s+(\d+)\s+years?/, type: 'years_ago' },
    { pattern: /this\s+month/, type: 'current_month' },
    { pattern: /this\s+year/, type: 'current_year' },
    { pattern: /q(\d)/, type: 'quarter' },
    { pattern: /(\d{4})/, type: 'specific_year' }
  ];
  
  for (const pattern of timePatterns) {
    const match = promptLower.match(pattern.pattern);
    if (match) {
      return { type: pattern.type, value: match[1] || null };
    }
  }
  
  return null;
}

// Helper function for query structure rules
function getQueryStructureRules(tableName) {
  const baseRules = `
   - Use WITH for complex calculations
   - Always use proper JOIN syntax
   - Use WHERE for filtering, HAVING for aggregated filters
   - Include ORDER BY for sorted results
   - Use TOP for limiting results when appropriate`;
   
  if (tableName === 'SalesReport_Form_Input') {
    return baseRules + `
   - Always start with: WHERE isCarryOver = 0 AND isDeleted = 0
   - Add appropriate isCounted conditions based on aggregation`;
  }
  
  if (tableName === 'SaleWarranty_RVAC_CONTRACTS') {
    return baseRules + `
   - Always start with: WHERE isDeleted = 0`;
  }
  
  return baseRules;
}

// SQL validation and cleaning
function validateAndCleanSql(sql, expectedTable) {
  if (!sql) return 'SELECT TOP (0) * FROM SalesReport_Form_Input';
  
  // Remove markdown code blocks
  sql = sql.replace(/```[\w]*\n?/g, '').trim();
  
  // Ensure it's a SELECT query
  if (!sql.toUpperCase().startsWith('SELECT') && 
      !sql.toUpperCase().startsWith('WITH')) {
    return 'SELECT TOP (0) * FROM SalesReport_Form_Input';
  }
  
  // Check for dangerous operations
  const dangerousKeywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE'];
  for (const keyword of dangerousKeywords) {
    if (sql.toUpperCase().includes(` ${keyword} `)) {
      return 'SELECT TOP (0) * FROM SalesReport_Form_Input';
    }
  }
  
  return sql;
}

// NEW: Data Analysis Function

async function generateSqlFromPrompt(prompt) {
  // Detect intent and extract parameters
  const { table, filters, aggregates, timeRange } = analyzeUserPrompt(prompt);
  
  const system = `You are a SQL expert that generates SQL Server SELECT queries based on user requests.

DATABASE SCHEMA:
${SCHEMA_DESCRIPTION}

USER REQUEST ANALYSIS:
- Primary table: ${table.table || 'Not detected'}
- Detected filters: ${JSON.stringify(filters)}
- Aggregates needed: ${aggregates.length > 0 ? aggregates.join(', ') : 'None'}
- Time range: ${timeRange || 'Not specified'}

MAPPING RULES:
1. TABLE MAPPING:
${Object.entries(TABLE_MAPPINGS).map(([key, config]) => 
  `   - "${config.synonyms.join('", "')}" → ${config.table}`
).join('\n')}

2. COLUMN MAPPING:
${Object.entries(COLUMN_MAPPINGS).map(([key, config]) => 
  `   - "${config.synonyms.join('", "')}" → ${config.column}${config.function ? ` (use ${config.function})` : ''}`
).join('\n')}

3. CRITICAL BUSINESS RULES:
   - For SalesReport_Form_Input table:
     * ALWAYS exclude rows where isCarryOver = 1
     * ALWAYS exclude rows where isDeleted = 1
     * When counting deals: include only rows where isCounted = 1
     * When aggregating TOTAL_COST: include both isCounted = 1 and isCounted = 0
   
   - For SaleWarranty_RVAC_CONTRACTS table:
     * ALWAYS exclude rows where isDeleted = 1
   
   - For dealership filtering: ALWAYS use DEALER_LOCATION = 'value' (exact match)
   
   - For month comparisons: 
     * When using MONTH_REPORTED, always include YEAR_REPORTED
     * If year not specified, use current year: YEAR(GETDATE())
     * Use month names (e.g., 'January', not 1)
    
    - For day or date comparisons: 
     * ALWAYS use CAST(DATE_REPORTED AS DATE) for comparisons
     * Handle relative dates like:
       - Today: CAST(GETDATE() AS DATE)
       - Yesterday: DATEADD(DAY, -1, CAST(GETDATE() AS DATE))
       - Day before yesterday: DATEADD(DAY, -2, CAST(GETDATE() AS DATE))
       - This week: >= DATEADD(DAY, 1 - DATEPART(WEEKDAY, GETDATE()), CAST(GETDATE() AS DATE)) AND < DATEADD(DAY, 8 - DATEPART(WEEKDAY, GETDATE()), CAST(GETDATE() AS DATE))
       - Last week: Shift the above by -7 days
       - Last 7 days: >= DATEADD(DAY, -7, GETDATE()) AND < GETDATE()
       - Last 30 days: >= DATEADD(DAY, -30, GETDATE()) AND < GETDATE()
       - YTD: >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1) AND <= GETDATE()
       - MTD: >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1) AND <= GETDATE()
     * For specific dates like "January 9, 2026": Convert to '2026-01-09'
     * For ranges: Use BETWEEN or >= and <=
     * 
4. DATA TYPE HANDLING:
   - Numeric columns stored as VARCHAR (like TOTAL_COST, FRONT_COST, FI_COST):
     SUM(CAST(REPLACE(REPLACE(ColumnName, ',', ''), ' ', '') AS DECIMAL(13,2)))
   - Date comparisons: Use proper date functions, not string comparison

5. QUERY STRUCTURE RULES:
   ${getQueryStructureRules(table.table)}

6. ERROR HANDLING:
   - If ambiguous or insufficient information: return 'SELECT TOP (0) * FROM SalesReport_Form_Input'
   - If table cannot be determined: default to SalesReport_Form_Input
   - Always validate column names exist in the detected table

IMPORTANT: Return ONLY the SQL query. No explanations, no markdown, just valid T-SQL.
`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Generate SQL for: "${prompt}"\nReturn ONLY the SQL query.` }
  ];
  
  const groqResp = await callGroqChat(messages);
  const sqlText = groqResp?.choices?.[0]?.message?.content?.trim();
  
  // Validate SQL before returning
  return validateAndCleanSql(sqlText, table.table);
}

//async function analyzeDataWithGrok(userQuery, data, options = {}) {
//  const {
//    model = null,
//    dataType = 'auto',
//    maxRowsToShow = 10,
//    temperature = 0.1
//  } = options;

//  let dataContext = '';

//  if (data) {
//    if (dataType === 'table' || (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object')) {
//      // Tabular data (array of objects)
//      const headers = Object.keys(data[0]);
//      const sampleRows = data.slice(0, maxRowsToShow);
      
//      dataContext = `TABULAR DATA ANALYSIS:
//- Total rows: ${data.length}
//- Columns: ${headers.join(', ')}
//- Data sample (first ${sampleRows.length} rows):
//`;

//      // Add header row
//      dataContext += headers.join(' | ') + '\n';
//      dataContext += '-'.repeat(headers.join(' | ').length) + '\n';
      
//      // Add data rows
//      sampleRows.forEach(row => {
//        dataContext += headers.map(header => String(row[header] || 'N/A')).join(' | ') + '\n';
//      });

//      if (data.length > maxRowsToShow) {
//        dataContext += `... and ${data.length - maxRowsToShow} more rows\n`;
//      }

//    } else if (typeof data === 'string') {
//      // Text data
//      dataContext = `TEXT DATA ANALYSIS:\n${data}\n`;
//    } else if (Array.isArray(data)) {
//      // Simple array
//      dataContext = `ARRAY DATA ANALYSIS:\n${JSON.stringify(data.slice(0, 20))}`;
//      if (data.length > 20) {
//        dataContext += `\n... and ${data.length - 20} more items`;
//      }
//    } else if (typeof data === 'object') {
//      // Object data
//      dataContext = `OBJECT DATA ANALYSIS:\n${JSON.stringify(data, null, 2)}`;
//    }
//  }

//  const systemPrompt = `You are a data analysis expert. Analyze the provided data and answer the user's question.

//INSTRUCTIONS:
//1. Carefully examine the data structure and content
//2. Provide specific insights, calculations, or summaries based on the data
//3. If performing calculations, show your reasoning
//4. Be factual and precise - reference actual data points
//5. If the question cannot be answered with the available data, explain why
//6. Use clear, structured formatting with bullet points or numbered lists when helpful
//7. Include specific numbers, percentages, or metrics from the data
//8. Focus on actionable insights and patterns

//${dataContext ? 'DATA PROVIDED:\n' + dataContext + '\n' : 'NO DATA PROVIDED - This is a general query.'}

//USER QUESTION: ${userQuery}`;

//  const messages = [
//    { role: 'system', content: systemPrompt }
//  ];

//  // Use a slightly higher temperature for analysis to allow for more creative insights
//  const analysisPayload = {
//    model: model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
//    messages,
//    max_tokens: 1500,
//    temperature: temperature
//  };

//  try {
//    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
//    const apiKey = process.env.GROQ_API_KEY;
//    if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');

//    const resp = await axios.post(endpoint, analysisPayload, {
//      headers: {
//        'Authorization': `Bearer ${apiKey}`,
//        'Content-Type': 'application/json'
//      },
//      timeout: 60_000
//    });

//    return resp.data?.choices?.[0]?.message?.content?.trim() || 'No response from Grok';
//  } catch (error) {
//    console.error('Error analyzing data with Grok:', error);
//    throw new Error(`Failed to analyze data: ${error.message}`);
//  }
//}

// NEW: Simple text analysis function

// Enhanced data analysis function with better context
async function analyzeDataWithGrok(userQuery, data, options = {}) {
  const {
    model = null,
    dataType = 'auto',
    maxRowsToShow = 10,
    temperature = 0.1,
    includeSqlContext = false,
    sqlQuery = null
  } = options;

  let dataContext = '';
  let analysisType = '';

  if (data) {
    // Determine data type and structure
    if (Array.isArray(data) && data.length > 0) {
      if (typeof data[0] === 'object') {
        // Tabular data
        analysisType = 'tabular';
        const headers = Object.keys(data[0]);
        const sampleRows = data.slice(0, maxRowsToShow);
        
        dataContext = `DATA ANALYSIS CONTEXT:
- Analysis Type: Tabular Data
- Total Rows: ${data.length}
- Columns (${headers.length}): ${headers.join(', ')}
- Data Types: ${headers.map(h => `${h}: ${typeof sampleRows[0][h]}`).join(', ')}
`;

        // Add data quality metrics
        const qualityMetrics = {};
        headers.forEach(header => {
          const nonNullCount = data.filter(row => row[header] != null && row[header] !== '').length;
          qualityMetrics[header] = {
            nonNull: nonNullCount,
            nullPercentage: ((data.length - nonNullCount) / data.length * 100).toFixed(1)
          };
        });

        dataContext += `\nDATA QUALITY:\n`;
        Object.entries(qualityMetrics).forEach(([header, metrics]) => {
          dataContext += `- ${header}: ${metrics.nonNull} non-null values (${metrics.nullPercentage}% null)\n`;
        });

        // Sample data
        dataContext += `\nSAMPLE DATA (first ${sampleRows.length} rows):\n`;
        dataContext += '| ' + headers.join(' | ') + ' |\n';
        dataContext += '|' + headers.map(() => '---').join('|') + '|\n';
        
        sampleRows.forEach(row => {
          dataContext += '| ' + headers.map(header => {
            const val = row[header];
            if (val == null) return 'NULL';
            if (typeof val === 'string' && val.length > 50) return val.substring(0, 50) + '...';
            return String(val);
          }).join(' | ') + ' |\n';
        });

        if (data.length > maxRowsToShow) {
          dataContext += `\n... and ${data.length - maxRowsToShow} more rows\n`;
        }

        // Add summary statistics for numeric columns
        const numericColumns = headers.filter(h => 
          sampleRows.some(row => !isNaN(parseFloat(row[h])) && row[h] != null && row[h] !== '')
        );
        
        if (numericColumns.length > 0) {
          dataContext += `\nNUMERIC COLUMNS SUMMARY:\n`;
          numericColumns.forEach(col => {
            const values = data
              .map(row => parseFloat(row[col]))
              .filter(val => !isNaN(val));
            
            if (values.length > 0) {
              const sum = values.reduce((a, b) => a + b, 0);
              const avg = sum / values.length;
              const min = Math.min(...values);
              const max = Math.max(...values);
              
              dataContext += `- ${col}: ${values.length} numeric values, ` +
                `Sum: ${sum.toLocaleString()}, ` +
                `Avg: ${avg.toLocaleString()}, ` +
                `Range: ${min.toLocaleString()} - ${max.toLocaleString()}\n`;
            }
          });
        }

      } else {
        // Simple array
        analysisType = 'array';
        dataContext = `ARRAY DATA ANALYSIS:
- Total Items: ${data.length}
- Sample Items: ${JSON.stringify(data.slice(0, 20))}`;
        
        if (data.length > 20) {
          dataContext += `\n... and ${data.length - 20} more items`;
        }
      }
    } else if (typeof data === 'object' && data !== null) {
      // Object data
      analysisType = 'object';
      dataContext = `OBJECT DATA ANALYSIS:\n${JSON.stringify(data, null, 2)}`;
    } else if (typeof data === 'string') {
      // Text data
      analysisType = 'text';
      dataContext = `TEXT DATA ANALYSIS:\n${data.substring(0, 1000)}`;
      if (data.length > 1000) {
        dataContext += `\n... (${data.length - 1000} more characters)`;
      }
    }
  }

  // Add SQL context if available
  let sqlContext = '';
  if (includeSqlContext && sqlQuery) {
    sqlContext = `\nQUERY CONTEXT:
- Generated SQL: ${sqlQuery}
- This analysis is based on the results of the above query.\n`;
  }

  const systemPrompt = `You are a senior data analyst with expertise in business intelligence and data interpretation.

${dataContext ? `ANALYSIS REQUEST:
User Question: ${userQuery}

DATA PROVIDED:
${dataContext}${sqlContext}

ANALYSIS INSTRUCTIONS:
1. **Examine the data structure and content**:
   - Note the analysis type: ${analysisType || 'unknown'}
   - Review column names, data types, and sample values
   - Identify any data quality issues

2. **Perform relevant analysis**:
   - Calculate specific metrics requested by the user
   - Identify trends, patterns, or anomalies
   - Compare values across different dimensions
   - Calculate percentages, growth rates, or other relevant metrics

3. **Provide structured insights**:
   - Start with a brief executive summary
   - Use bullet points for key findings
   - Include specific numbers and data points
   - Highlight any significant observations
   - Suggest potential actions or next steps if relevant

4. **Formatting guidelines**:
   - Use clear headings and subheadings
   - Bold important metrics or key findings
   - Use tables for comparative data when helpful
   - Keep technical details accessible to non-technical users

5. **If data is insufficient**:
   - Clearly state what's missing
   - Suggest what additional data would be helpful
   - Provide partial insights based on available data

IMPORTANT: Be precise, data-driven, and actionable in your analysis.` 
: `NO DATA PROVIDED - This is a general query about: ${userQuery}

Please provide general guidance or ask for specific data to analyze.`}`;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  const analysisPayload = {
    model: model || process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    messages,
    max_tokens: 2000,
    temperature: temperature,
    stream: false
  };

  try {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');

    const resp = await axios.post(endpoint, analysisPayload, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60_000
    });

    const analysis = resp.data?.choices?.[0]?.message?.content?.trim();
    
    // Format the analysis with better structure
    return formatAnalysisResult(analysis, userQuery, data?.length || 0);
    
  } catch (error) {
    console.error('Error analyzing data with Grok:', error);
    throw new Error(`Failed to analyze data: ${error.message}`);
  }
}

// Format analysis result for better readability
function formatAnalysisResult(analysis, userQuery, dataSize) {
  const timestamp = new Date().toLocaleString();
  
  return `# Data Analysis Report

**Query**: ${userQuery}
**Analysis Time**: ${timestamp}
**Data Points Analyzed**: ${dataSize.toLocaleString()}

---

${analysis}

---

*Analysis generated by AI. Verify critical business decisions with actual data.*`;
}

// Example usage function
async function processUserQuery(userInput) {
  console.log(`Processing query: "${userInput}"`);
  
  try {
    // Step 1: Generate SQL
    const sql = await generateSqlFromPrompt(userInput);
    console.log('Generated SQL:', sql);
    
    // Step 2: Execute SQL (pseudo-code - implement your DB connection)
    // const data = await executeSqlQuery(sql);
    
    // Step 3: Analyze results
    // const analysis = await analyzeDataWithGrok(
    //   userInput, 
    //   data, 
    //   { 
    //     includeSqlContext: true, 
    //     sqlQuery: sql 
    //   }
    // );
    
    // return { sql, analysis };
    return { sql };
    
  } catch (error) {
    console.error('Error processing query:', error);
    return { 
      sql: 'SELECT TOP (0) * FROM SalesReport_Form_Input',
      error: error.message 
    };
  }
}

async function analyzeTextWithGrok(text, analysisType = 'summarize', options = {}) {
  const prompts = {
    summarize: "Please provide a concise summary of the following text:",
    analyze: "Analyze the following text and identify key points, themes, and insights:",
    extract: "Extract the main facts and important information from the following text:",
    sentiment: "Analyze the sentiment and tone of the following text:"
  };

  const userQuery = `${prompts[analysisType] || prompts.summarize}\n\n${text}`;
  
  return await analyzeDataWithGrok(userQuery, null, options);
}

// NEW: General query function (no data analysis)
async function askGrokGeneral(query, options = {}) {
  return await analyzeDataWithGrok(query, null, {
    temperature: 0.3,
    ...options
  });
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

// 1. General query endpoint
app.post('/api/ask', async (req, res) => {
  try {
    const { question, model, temperature } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Question is required'
      });
    }

    const result = await askGrokGeneral(question, {
      model,
      temperature: temperature || 0.3
    });

    res.json({
      success: true,
      question,
      answer: result,
      type: 'general',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in /api/ask:', error);
    res.status(500).json({
      error: 'Failed to process question',
      details: error.message
    });
  }
});

// 2. Data analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { 
      question, 
      data, 
      dataType = 'auto',
      model, 
      temperature = 0.1,
      maxRowsToShow = 10 
    } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Question is required'
      });
    }

    if (!data) {
      return res.status(400).json({
        error: 'Data is required for analysis'
      });
    }

    const result = await analyzeDataWithGrok(question, data, {
      model,
      dataType,
      temperature,
      maxRowsToShow
    });

    res.json({
      success: true,
      question,
      dataType: typeof data,
      dataSample: Array.isArray(data) ? data.slice(0, 3) : data,
      answer: result,
      type: 'data_analysis',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in /api/analyze:', error);
    res.status(500).json({
      error: 'Failed to analyze data',
      details: error.message
    });
  }
});

// 3. Text analysis endpoint
app.post('/api/analyze-text', async (req, res) => {
  try {
    const { 
      text, 
      analysisType = 'summarize',
      model, 
      temperature = 0.1 
    } = req.body;

    if (!text) {
      return res.status(400).json({
        error: 'Text is required'
      });
    }

    const result = await analyzeTextWithGrok(text, analysisType, {
      model,
      temperature
    });

    res.json({
      success: true,
      analysisType,
      textLength: text.length,
      textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      analysis: result,
      type: 'text_analysis',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in /api/analyze-text:', error);
    res.status(500).json({
      error: 'Failed to analyze text',
      details: error.message
    });
  }
});

// 4. Batch analysis endpoint
app.post('/api/analyze-batch', async (req, res) => {
  try {
    const { requests } = req.body;

    if (!Array.isArray(requests) || requests.length === 0) {
      return res.status(400).json({
        error: 'Requests array is required'
      });
    }

    if (requests.length > 5) {
      return res.status(400).json({
        error: 'Maximum 5 requests allowed per batch'
      });
    }

    const results = [];
    for (const [index, request] of requests.entries()) {
      try {
        let result;
        if (request.type === 'general') {
          result = await askGrokGeneral(request.question, {
            model: request.model,
            temperature: request.temperature || 0.3
          });
        } else if (request.type === 'data') {
          result = await analyzeDataWithGrok(request.question, request.data, {
            model: request.model,
            dataType: request.dataType,
            temperature: request.temperature || 0.1
          });
        } else if (request.type === 'text') {
          result = await analyzeTextWithGrok(request.text, request.analysisType, {
            model: request.model,
            temperature: request.temperature || 0.1
          });
        }

        results.push({
          index,
          success: true,
          result
        });
      } catch (error) {
        results.push({
          index,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      total: requests.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in /api/analyze-batch:', error);
    res.status(500).json({
      error: 'Failed to process batch requests',
      details: error.message
    });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server listening on ${port}`));
