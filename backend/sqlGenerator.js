/**
 * sql-generator.js
 *
 * Production-ready generateSqlFromPrompt with:
 *  - schema caching (in-memory + optional Redis)
 *  - live schema sync from SQL Server (INFORMATION_SCHEMA)
 *  - prompt normalization
 *  - SQL validation & safety checks
 *  - pluggable LLM client (callGroqChat or other)
 *
 * Requirements:
 *  - npm install mssql ioredis dotenv
 *  - Provide environment variables (see README below)
 *
 * Note: This module DOES NOT execute generated SQL. Use separate, audited code to run queries.
 */

'use strict';

const mssql = require('mssql');
const Redis = require('ioredis');
const crypto = require('crypto');
const assert = require('assert');

// Load env (optional)
require('dotenv').config();

const DEFAULT_SCHEMA_CACHE_TTL = 60 * 60; // seconds - 1 hour

class SQLGenerator {
  /**
   * @param {Object} opts
   *  - dbConfig: config for mssql package to read INFORMATION_SCHEMA (optional if you won't auto-sync)
   *  - llmClient: async function messages => { choices: [{ message: { content } }] }
   *  - redisConfig: optional ioredis config or connection string
   *  - schemaCacheTTL: seconds
   *  - systemPromptExtra: optional additional system rules
   */
  constructor(opts = {}) {
    assert(opts.llmClient, 'llmClient (callGroqChat-like) is required');

    this.llmClient = opts.llmClient;
    this.dbConfig = opts.dbConfig || null;
    this.schemaCacheTTL = opts.schemaCacheTTL || DEFAULT_SCHEMA_CACHE_TTL;
    this.systemPromptExtra = opts.systemPromptExtra || '';
    this._schema = null;            // in-memory cache
    this._schemaFetchedAt = null;
    this._redis = null;
    if (opts.redisConfig) {
      this._redis = new Redis(opts.redisConfig);
    }
  }

  // Helper: compute cache key for redis
  _schemaCacheKey() {
    // Use hash of db host/instance if available
    const id = (this.dbConfig && this.dbConfig.server) ? `${this.dbConfig.server}:${this.dbConfig.database}` : 'local_schema';
    return `sqlgen:schema:${crypto.createHash('sha256').update(id).digest('hex')}`;
  }

  // Pull schema from cache (redis or memory)
  async _getCachedSchema() {
    // If memory cache fresh enough, return
    if (this._schema && (Date.now() - this._schemaFetchedAt) / 1000 < this.schemaCacheTTL) {
      return this._schema;
    }

    // Try redis if available
    if (this._redis) {
      const key = this._schemaCacheKey();
      const raw = await this._redis.get(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          this._schema = parsed;
          this._schemaFetchedAt = Date.now();
          return this._schema;
        } catch (e) {
          // fallthrough to refresh
        }
      }
    }

    // If we have dbConfig, fetch from DB
    if (this.dbConfig) {
      const schema = await this.refreshSchemaFromDb();
      return schema;
    }

    // If no DB and nothing cached, fail gracefully to fallback minimal schema from developer's settings
    if (this._schema) return this._schema;
    return null;
  }

  // Refresh schema by querying INFORMATION_SCHEMA (standard approach for SQL Server)
  async refreshSchemaFromDb() {
    if (!this.dbConfig) {
      throw new Error('dbConfig is required to refresh schema from DB');
    }
    const pool = await mssql.connect(this.dbConfig);
    try {
      const res = await pool.request()
        .query(`
          SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_CATALOG = @db
          ORDER BY TABLE_NAME, ORDINAL_POSITION;
        `, { db: { type: mssql.VarChar, value: this.dbConfig.database }});
      const rows = res.recordset;
      const schema = {};
      for (const r of rows) {
        const table = r.TABLE_NAME;
        if (!schema[table]) schema[table] = [];
        schema[table].push({ column: r.COLUMN_NAME, data_type: r.DATA_TYPE });
      }
      // store in memory + redis
      this._schema = schema;
      this._schemaFetchedAt = Date.now();
      if (this._redis) {
        const key = this._schemaCacheKey();
        await this._redis.set(key, JSON.stringify(schema), 'EX', this.schemaCacheTTL);
      }
      return schema;
    } finally {
      pool.close();
    }
  }

  // Normalize user prompt to deterministic text for the LLM
  normalizePrompt(userPrompt) {
    if (!userPrompt || typeof userPrompt !== 'string') return '';
    // Basic cleanup, preserve important tokens/capitalization as needed
    const trimmed = userPrompt.trim();
    // Collapse multiple whitespace to single space
    const normalized = trimmed.replace(/\s+/g, ' ');
    return normalized;
  }

  // Build robust system prompt (inject sanitized schema description)
  buildSystemPrompt(schemaDescription) {
    // Keep the rules deterministic and compact
    const rules = `
You are a helpful assistant that strictly returns a single valid SQL Server SELECT query (no explanation).
The database schema is described as:
${schemaDescription}

Rules:
1. Only return a single T-SQL SELECT or WITH query. Do NOT return DDL/DML or any explanation.
2. Use column and table names exactly as shown above.
3. Map natural language:
   - "dealership" → DEALER_LOCATION (use '=' for comparisons)
   - "gross" or "total cost" → TOTAL_COST
   - VEHICLE_TYPE values: auto, rv, marine
   - CAR_STATUS values: new, used
   - DIVISION values: 401, franchise, 401 retail
4. When querying SalesReport_Form_Input:
   - Always exclude rows where isCarryOver = 1 OR isDeleted = 1.
   - When counting deals, include only rows with isCounted = 1.
   - When aggregating gross, include rows regardless of isCounted.
5. MONTH_REPORTED comparisons must be paired with YEAR_REPORTED; if no year provided, use the current year (server-side).
6. When summing string numerics: use SUM(CAST(REPLACE(REPLACE(ColumnName, ',', ''), ' ', '') AS DECIMAL(13,2)))
7. If the request cannot be answered using available columns, return: SELECT TOP (0) * FROM SalesReport_Form_Input;
${this.systemPromptExtra}
`;
    return rules;
  }

  // Create a short schema description text from the schema object for the LLM
  _renderSchemaDescription(schemaObj) {
    if (!schemaObj) {
      // fallback to the minimal schema the original user used
      return `
Tables:
- SalesReport_Form_Input: ID, LEAD_ID, LAST_NAME, FIRST_NAME, DIVISION, DEALER_LOCATION, STOCK, VEHICLE_TYPE, CAR_STATUS, MAKE_YEAR, MAKE, MODEL, TOTAL_COST, LEAD_SOURCE, LEAD_OWNER, CLOSER, DATE_REPORTED, YEAR_REPORTED, MONTH_REPORTED, SOLD_FROM, DATE_FUNDED, DATE_POSTED, DATE_RECEIVED, PBS_DATA, isCarryOver, isDeleted, isCounted, HasLien
- Common_Group_401_Vehicle_Inventory: ID, vId, VehicleId, StockNumber, VIN, VehicleType, VehicleTrim, VehicleStatus, VehicleMake, VehicleModel, VehicleYear, Inventory, TotalCost, Retail, isHold, isSold, isAvailable, DATE_CREATED, Odometer, Lot, IsCertified
- SalesApp_LogInActivity: LogInActivityID, UserID, Token, LogedIn, LogOut, IpLog, Device, IpLocation, Activity
`;
    }
    // Build a compressed schema text
    let sb = 'Tables:\n';
    for (const table of Object.keys(schemaObj)) {
      const cols = schemaObj[table].map(c => c.column).join(', ');
      sb += `- ${table}: ${cols}\n`;
    }
    return sb;
  }

  // Validate that returned SQL is safe and conforms to simple rules
  validateSqlSafety(sqlText) {
    if (!sqlText || typeof sqlText !== 'string') return false;

    // Remove leading/trailing whitespace
    const s = sqlText.trim();

    // 1) Must start with SELECT or WITH (case-insensitive)
    if (!/^(SELECT|WITH)\b/i.test(s)) return false;

    // 2) Must NOT contain forbidden keywords
    const forbidden = [
      '\\bINSERT\\b', '\\bUPDATE\\b', '\\bDELETE\\b', '\\bDROP\\b', '\\bALTER\\b',
      '\\bCREATE\\b', '\\bTRUNCATE\\b', '\\bEXEC\\b', '\\bEXECUTE\\b', '--', ';--'
    ];
    for (const p of forbidden) {
      if (new RegExp(p, 'i').test(s)) return false;
    }

    // 3) Block xp_cmdshell or sp_ calls (risky)
    if (/\bxp_cmdshell\b/i.test(s) || /\bsp_/i.test(s)) return false;

    // 4) Basic length sanity check
    if (s.length > 20000) return false;

    // Passed checks
    return true;
  }

  // Check whether SQL references columns/tables present in cached schema. If unknown, force fallback.
  async checkSqlAgainstSchema(sqlText) {
    const schema = await this._getCachedSchema();
    if (!schema) {
      // If we don't have a schema, do not reject — rely on other safety
      return true;
    }

    // Extract identifiers: crude approach - capture words that look like identifiers
    const tokens = Array.from(new Set(
      (sqlText.match(/[A-Za-z_][A-Za-z0-9_]+/g) || []).map(t => t.toUpperCase())
    ));

    // Build set of known tokens from schema
    const known = new Set();
    for (const t of Object.keys(schema)) {
      known.add(t.toUpperCase());
      for (const c of schema[t]) known.add(c.column.toUpperCase());
    }

    // If SQL references any TABLE or COLUMN not in known set, be conservative and return false
    // But allow common SQL words (SELECT, SUM, FROM, WHERE, AS, AND, OR, ON, JOIN, GROUP, ORDER, BY, CAST, REPLACE, DECIMAL, WITH, TOP)
    const allowed = new Set(['SELECT','SUM','AVG','MIN','MAX','COUNT','FROM','WHERE','AND','OR','ON','JOIN','LEFT','RIGHT','INNER','OUTER',
      'GROUP','ORDER','BY','AS','CAST','REPLACE','DECIMAL','TOP','WITH','IS','NULL','NOT','IN','BETWEEN','LIKE','CASE','WHEN','THEN','ELSE','END','HAVING','LIMIT','DISTINCT','COALESCE']);
    for (const tk of tokens) {
      if (allowed.has(tk)) continue;
      if (!known.has(tk)) {
        // Unknown identifier; return false
        return false;
      }
    }
    return true;
  }

  // Main function: generate SQL from prompt using the LLM
  async generateSqlFromPrompt(userPrompt, opts = {}) {
    // opts: { enforceSchemaCheck: true/false, preferCachedSchema: true/false }
    const enforceSchemaCheck = (opts.enforceSchemaCheck === undefined) ? true : !!opts.enforceSchemaCheck;

    // 1. Normalize prompt
    const normalizedPrompt = this.normalizePrompt(userPrompt);

    // 2. Get schema description text (from cache or db)
    const schemaObj = await this._getCachedSchema().catch(() => null);
    const schemaDesc = this._renderSchemaDescription(schemaObj);

    // 3. Build system prompt + messages for LLM
    const systemPrompt = this.buildSystemPrompt(schemaDesc);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `User request: "${normalizedPrompt}"\nReturn only the SQL query.` }
    ];

    // 4. Call LLM
    let llmResp;
    try {
      llmResp = await this.llmClient(messages);
    } catch (err) {
      // LLM error -> return safe fallback
      console.error('LLM call failed', err);
      return `SELECT TOP (0) * FROM SalesReport_Form_Input`;
    }

    const sqlText = (llmResp?.choices?.[0]?.message?.content || '').trim();
    if (!sqlText) {
      return `SELECT TOP (0) * FROM SalesReport_Form_Input`;
    }

    // 5. Basic safety validation
    const safe = this.validateSqlSafety(sqlText);
    if (!safe) {
      console.warn('SQL failed safety rules; returning fallback.');
      return `SELECT TOP (0) * FROM SalesReport_Form_Input`;
    }

    // 6. Optional schema-aware validation
    if (enforceSchemaCheck) {
      const matchesSchema = await this.checkSqlAgainstSchema(sqlText);
      if (!matchesSchema) {
        // If LLM used unknown column/table -> fallback per rule 5
        console.warn('SQL references unknown schema elements; returning fallback.');
        return `SELECT TOP (0) * FROM SalesReport_Form_Input`;
      }
    }

    // 7. Return sanitized SQL (trim trailing semicolons)
    return sqlText.replace(/\s*;+\s*$/g, '');
  }

  // Close resources (redis)
  async close() {
    if (this._redis) await this._redis.quit();
  }
}

module.exports = SQLGenerator;

// Need to see for implementation
// example.js
//const SQLGenerator = require('./sql-generator');
//require('dotenv').config();

//// Example simple LLM client wrapper for your callGroqChat function
//async function callGroqChat(messages) {
//  // Replace with your real implementation (Groq/OpenAI/etc)
//  // Should return { choices: [ { message: { content: 'SELECT ...' } } ] }
//  // For testing, we return a trivial response.
//  return {
//    choices: [
//      { message: { content: "SELECT TOP (0) * FROM SalesReport_Form_Input" } }
//    ]
//  };
//}

//(async () => {
//  const gen = new SQLGenerator({
//    dbConfig: {
//      user: process.env.DB_USER,
//      password: process.env.DB_PASS,
//      server: process.env.DB_HOST, // e.g., 'localhost'
//      database: process.env.DB_NAME,
//      options: { encrypt: false, trustServerCertificate: true }
//    },
//    llmClient: callGroqChat,
//    redisConfig: process.env.REDIS_URL, // optional
//    schemaCacheTTL: 3600
//  });

//  // Optionally refresh schema on startup (async)
//  try {
//    await gen.refreshSchemaFromDb();
//    console.log('Schema refreshed from DB');
//  } catch (err) {
//    console.warn('Schema refresh failed (maybe no DB config) - continuing with best effort');
//  }

//  const userPrompt = 'Show total gross by dealership for October 2025';
//  const sql = await gen.generateSqlFromPrompt(userPrompt, { enforceSchemaCheck: true });
//  console.log('Generated SQL:\n', sql);

//  await gen.close();
//})();
