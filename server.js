require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

// Load from environment (.env) for sensitive values
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'hello';
const COLLECTION = process.env.COLLECTION || 'books';

if (!MONGO_URI) {
  console.warn('Warning: MONGO_URI is not set. Create a .env file or set the MONGO_URI environment variable.');
}
const app = express();
app.use(express.json());

let db;
let client;

async function connectDb() {
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB');
}

function transformDoc(doc) {
  // Convert extended JSON-like fields to BSON types
  const out = { ...doc };
  if (out._id && out._id.$oid) {
    try { out._id = new ObjectId(out._id.$oid); } catch (e) { /* keep as-is */ }
  }
  if (out.createdAt && out.createdAt.$date) {
    out.createdAt = new Date(out.createdAt.$date);
  }
  return out;
}

app.get('/', (req, res) => {
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Books On/Off</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    :root{--green:#16a34a;--red:#ef4444;--muted:#6b7280;--bg:#f8fafc;font-family:Inter,system-ui,Segoe UI,Arial}
    body{background:var(--bg);color:#111;margin:0;padding:40px;display:flex;justify-content:center}
    .card{background:white;border-radius:12px;padding:24px;box-shadow:0 6px 18px rgba(2,6,23,0.08);width:560px}
    h1{margin:0 0 8px;font-size:20px}
    .status{display:flex;align-items:center;gap:12px;margin-top:8px}
    .badge{padding:6px 12px;border-radius:999px;font-weight:600;color:white}
    .badge.on{background:var(--green)}.badge.off{background:var(--red)}
    .count{color:var(--muted);font-size:14px}
    .controls{display:flex;gap:12px;margin-top:18px}
    button{flex:1;padding:12px;border-radius:8px;border:0;font-weight:700;cursor:pointer}
    button.on{background:linear-gradient(90deg,#34d399,#059669);color:#023}
    button.off{background:linear-gradient(90deg,#fda4af,#ef4444);color:#4b0505}
    button[disabled]{opacity:0.5;cursor:not-allowed}
    .log{margin-top:18px;border-top:1px dashed #eee;padding-top:12px}
    .toast{position:fixed;right:20px;bottom:20px;background:#111;color:white;padding:10px 14px;border-radius:8px;opacity:0;transform:translateY(8px);transition:all .25s}
    .toast.show{opacity:1;transform:translateY(0)}
    .small{font-size:13px;color:var(--muted)}
  </style>
</head>
<body>
  <div class="card">
    <h1>File Upload Feature</h1>
    <div class="status">
      <div id="badge" class="badge off">OFF</div>
      <div class="count">Current count: <strong id="count">0</strong></div>
    </div>

    <div class="controls">
      <button id="onBtn" class="on">Turn On</button>
      <button id="offBtn" class="off">Turn Off</button>
    </div>


  </div>

  <div id="toast" class="toast"></div>

  <script>
    const badge = document.getElementById('badge');
    const countEl = document.getElementById('count');
    const onBtn = document.getElementById('onBtn');
    const offBtn = document.getElementById('offBtn');

    const toastEl = document.getElementById('toast');

    function showToast(msg, isError=false){
      toastEl.textContent = msg;
      toastEl.style.background = isError ? '#b91c1c' : '#111';
      toastEl.classList.add('show');
      setTimeout(()=>toastEl.classList.remove('show'),3000);
    }





    async function getStatus(){
      try{
        const res = await fetch('/status');
        return await res.json();
      }catch(e){return { count: 0 }}
    }

    function updateUI(data){
      const c = data.count || 0;
      countEl.textContent = c;
      const state = c>0 ? 'ON' : 'OFF';
      badge.textContent = state;
      badge.className = 'badge ' + (state==='ON' ? 'on' : 'off');
      // disable rules per requirement
      onBtn.disabled = c>0; // if has record, cannot turn on
      offBtn.disabled = c===0; // if no record, cannot turn off
    }

    async function postAction(path){
      try{
        const res = await fetch(path, { method: 'POST' });
        const json = await res.json().catch(()=>({ message: res.statusText }));
        if (!res.ok) { showToast(json.error || json.message || 'Action failed', true); return; }
        showToast(json.message || (json.insertedCount && (json.insertedCount + ' inserted')) || (json.deletedCount && (json.deletedCount + ' deleted')));
        const s = await getStatus();
        updateUI(s);
      }catch(e){ showToast(e.message, true); }
    }

    onBtn.addEventListener('click', ()=> postAction('/on'));
    offBtn.addEventListener('click', ()=> postAction('/off'));

    // Initialize
    (async ()=>{
      const s = await getStatus();
      updateUI(s);
    })();
  </script>
</body>
</html>`);
});

// Insert test.books.json into the books collection
app.post('/on', async (req, res) => {
  try {
    const col = db.collection(COLLECTION);
    const current = await col.countDocuments();
    if (current > 0) return res.status(400).json({ error: 'Collection already has documents. Please turn off (delete) first.' });

    const filePath = path.join(__dirname, 'test.books.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return res.status(400).json({ error: 'test.books.json must be an array' });

    const docs = parsed.map(transformDoc);

    // Insert documents, ignore duplicate key errors by using ordered:false
    const result = await col.insertMany(docs, { ordered: false });
    res.json({ message: 'Inserted successfully', insertedCount: result.insertedCount, insertedIds: result.insertedIds });
  } catch (err) {
    // If duplicate key errors occur, MongoDB driver will still return a result or throw
    if (err.code === 11000) {
      return res.status(200).json({ message: 'Some documents already existed (duplicate keys)', error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete all documents from books collection
app.post('/off', async (req, res) => {
  try {
    const col = db.collection(COLLECTION);
    const current = await col.countDocuments();
    if (current === 0) return res.status(400).json({ error: 'Collection is empty. Nothing to delete.' });

    const result = await col.deleteMany({});
    res.json({ message: 'All documents deleted', deletedCount: result.deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Optional status endpoint
app.get('/status', async (req, res) => {
  try {
    const count = await db.collection(COLLECTION).countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT, 10) || 3000;

if (!MONGO_URI) {
  console.error('Error: MONGO_URI is not set. Please create a .env file from .env.example or set the MONGO_URI environment variable.');
  process.exit(1);
}

async function startServer(port, maxAttempts = 5) {
  try {
    await connectDb();
  } catch (err) {
    console.error('Failed to connect to DB', err);
    process.exit(1);
  }

  let attempts = 0;
  let currentPort = port;

  while (attempts < maxAttempts) {
    try {
      await new Promise((resolve, reject) => {
        const server = app.listen(currentPort, () => {
          console.log(`Server running on http://localhost:${currentPort}`);
          resolve(server);
        });
        server.on('error', (err) => reject(err));
      });
      return;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
        attempts++;
        currentPort++;
        continue;
      }
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  }

  console.error(`Could not start server after ${maxAttempts} attempts, exiting.`);
  process.exit(1);
}

startServer(PORT);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (client) await client.close();
  process.exit(0);
});
