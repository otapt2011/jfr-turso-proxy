// api/turso.js
import { createClient } from '@libsql/client';

let db = null;

function getDb() {
  if (!db) {
    const url = process.env.TURSO_URL;
    const token = process.env.TURSO_TOKEN;
    if (!url || !token) {
      throw new Error('TURSO_URL and TURSO_TOKEN must be set');
    }
    db = createClient({ url, authToken: token });
  }
  return db;
}

// Helper to execute a single SQL statement
async function execute(sql, params) {
  const client = getDb();
  const result = await client.execute({ sql, args: params || {} });
  return {
    rows: result.rows,
    columns: result.columns.map(c => c.name),
    rowsAffected: result.rowsAffected,
    lastInsertRowid: result.lastInsertRowid
  };
}

// Helper to execute a batch of statements (atomic)
async function batch(statements) {
  const client = getDb();
  const batchStmts = statements.map(stmt => ({
    sql: stmt.sql,
    args: stmt.params || {}
  }));
  const results = await client.batch(batchStmts);
  return results.map(r => ({
    rows: r.rows,
    columns: r.columns?.map(c => c.name) || [],
    rowsAffected: r.rowsAffected,
    lastInsertRowid: r.lastInsertRowid
  }));
}

export default async function handler(req, res) {
  // 1. CORS headers (allow your frontend origin)
  const allowedOrigin = process.env.FRONTEND_URL || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 2. Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 4. Authenticate request using the secret header
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.PROXY_SECRET}`;
  if (!authHeader || authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 5. Get client IP and set custom response header
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  res.setHeader('X-Client-IP', clientIP);

  // 6. Parse request body
  const { operation, sql, params, statements } = req.body;

  try {
    let result;
    if (operation === 'batch') {
      if (!statements || !Array.isArray(statements)) {
        return res.status(400).json({ error: 'Missing or invalid statements array for batch' });
      }
      result = await batch(statements);
    } else if (operation === 'execute' || operation === 'query') {
      if (!sql) {
        return res.status(400).json({ error: 'Missing sql field' });
      }
      result = await execute(sql, params);
    } else {
      return res.status(400).json({ error: 'Invalid operation. Use "execute" or "batch".' });
    }

    res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error('Turso proxy error:', err);
    res.status(500).json({ error: err.message });
  }
}
