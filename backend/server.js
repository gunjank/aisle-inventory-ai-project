// backend/server.js
const express = require('express');
const multer = require('multer');
const { default: fetch } = require('node-fetch'); 
const sqlite = require('better-sqlite3');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const winston = require('winston'); 
const sharp = require('sharp');
const { jsonrepair } = require('jsonrepair');
require('dotenv').config();

// **SECURITY PACKAGES**
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');

const app = express();
app.set('trust proxy', 1);

// --- PATH ADJUSTMENTS (Crucial for subfolder structure) ---
const PUBLIC_PATH = path.join(__dirname, '..', 'public');
const UPLOADS_PATH = path.join(__dirname, '..', 'uploads');
const dbName = process.env.DATABASE_URL || 'inventory.sqlite';
const DB_PATH = path.join(__dirname, dbName);

// Ensure uploads folder exists in the root
if (!fs.existsSync(UPLOADS_PATH)) {
    fs.mkdirSync(UPLOADS_PATH, { recursive: true });
}

// Update multer to use the correct uploads path
const upload = multer({ dest: UPLOADS_PATH }); 
const DB = new sqlite(DB_PATH);
const PORT = process.env.PORT||3000; 

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// --- RATE LIMITING ---
const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 100,
    standardHeaders: true, 
    legacyHeaders: false
});

const uploadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 10, 
    standardHeaders: true, 
    legacyHeaders: false
});

app.use(apiLimiter);

// --- WINSTON LOGGER (Saving to backend/app.log) ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console({ format: winston.format.simple() }),
        new winston.transports.File({ filename: path.join(__dirname, 'app.log') }),
    ],
});

// --- 1. Database Setup ---
function setupDatabase() {
    DB.prepare(`
        CREATE TABLE IF NOT EXISTS inventory (
            store_session TEXT NOT NULL,
            product_name TEXT NOT NULL,
            image_hash TEXT NOT NULL,  
            category TEXT,
            quantity INTEGER NOT NULL,
            threshold INTEGER DEFAULT 10,
            PRIMARY KEY (store_session, product_name, image_hash)
        )
    `).run();
    
    DB.prepare(`
        CREATE TABLE IF NOT EXISTS metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            store_session TEXT NOT NULL,
            image_hash TEXT NOT NULL,
            request_duration_ms INTEGER,
            ollama_duration_s REAL,
            completion_tokens INTEGER,
            processed_items INTEGER,
            status_code INTEGER,
            error_details TEXT
        )
    `).run();
    
    logger.info('Database connected, inventory and metrics tables ready.');
}
setupDatabase();

// --- 2. Endpoint for Image Processing ---
app.post('/api/upload', uploadLimiter, upload.single('aisleImage'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    const startTime = Date.now();
    const storeSession = req.body.storeSession || 'default';
    
    try {
        console.log(`\n--- New Scan Started: ${storeSession} ---`);
        
        const originalImgBuffer = await fsp.readFile(req.file.path);
        // const imgBuffer = await sharp(originalImgBuffer).resize(1280).jpeg({ quality: 80 }).toBuffer();
        const imgBuffer = await sharp(originalImgBuffer)
            .resize(1920, 1920, { fit: 'inside' }) 
            .jpeg({ quality: 100 }) // No compression artifacts
            .toBuffer();
        const imageHash = crypto.createHash('sha256').update(imgBuffer).digest('hex');
        const imgBase64 = imgBuffer.toString('base64');
        // 1. The Prompt (Restored to your high-detail version)
        const promptMessage = `**TASK: PRECISE SKU AUDIT.** Analyze the image as a professional inventory auditor.

                **INVENTORY RULES:**
                1. **MANDATORY CATEGORIES:** You MUST assign every item to one of these: [Produce, Beverages, Snacks, Dairy, Pantry, Household, Frozen, Bakery, Meat]. NEVER use "Uncategorized".
                2. **QUANTITY ACCURACY:** Do not guess. If 5 items are visible, the count is 5. If items are in a case, 1 case = 1 unit.
                3. **NO SUMMARY ROWS:** Do not include "Total" rows. List only specific varieties.
                4. **IDENTIFICATION:** Be specific. Use "Green Granny Smith Apple" or "Red Gala Apple" instead of just "Apple".

                **JSON FORMATTING RULES:**
                - Output MUST be a valid JSON array.
                - No preamble or conversational text.
                - Ensure the JSON is never truncated; finish every object and close the array with ']'.

                **EXAMPLE OUTPUT STRUCTURE:**
                [
                {"product_name": "Product A", "category": "Snacks", "quantity": 3},
                {"product_name": "Product B", "category": "Produce", "quantity": 5}
                ]

                [ASSISTANT]
                [
                {"product_name": "`;

        const ollamaPayload = {
            model: "llava:13b", 
            prompt: promptMessage,
            images: [imgBase64],
            stream: false,
            options: { 
                temperature: 0.0,      // Keep it literal
                num_ctx: 8192,
                num_predict: 1024,
                repeat_penalty: 1.1,   // Lowered: Prevents loops but allows JSON keys
                seed: 42               // Fixed: Stops it from inventing "Yellow Fuji"
            }
        };


        // 2. Call Ollama
        const ollamaResponse = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ollamaPayload)
        });

        const data = await ollamaResponse.json();
        let jsonText = data.response.trim();

        // --- CONSOLE LOGS RESTORED ---
        console.log("🤖 AI RAW OUTPUT:");
        console.log(jsonText); 

        // 3. Repair & Parse
        if (jsonText.startsWith('[') && !jsonText.endsWith(']')) {
            const lastClosingBrace = jsonText.lastIndexOf('}');
            jsonText = jsonText.substring(0, lastClosingBrace + 1) + ']';
        }
        
        const itemArray = JSON.parse(jsonrepair(jsonText));
        const items = Array.isArray(itemArray) ? itemArray : [itemArray];

        // 4. Save to DB (Ensuring no items are skipped)
        const insertStmt = DB.prepare(`
            INSERT INTO inventory (store_session, product_name, image_hash, category, quantity) 
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(store_session, product_name, image_hash) DO UPDATE SET 
                quantity = excluded.quantity, 
                category = excluded.category 
        `);

        const runTx = DB.transaction((itemsToSave) => {
            let count = 0;
            for (const item of itemsToSave) {
                if (item.product_name) {
                    insertStmt.run(
                        storeSession, 
                        item.product_name.trim(), 
                        imageHash, 
                        item.category || 'Produce', 
                        parseInt(item.quantity) || 0
                    );
                    count++;
                }
            }
            return count;
        });

        const savedCount = runTx(items);
        console.log(`✅ Saved ${savedCount} distinct items to database.`);

        // 5. Return Full Session Inventory
        const inventory = DB.prepare(`
            SELECT product_name, category, SUM(quantity) AS quantity 
            FROM inventory 
            WHERE store_session = ? 
            GROUP BY product_name, category
        `).all(storeSession);

        res.json({ inventory, performance: (Date.now() - startTime) / 1000 + 's' });

    } catch (error) {
        console.error("❌ UPLOAD ERROR:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        if (req.file && fs.existsSync(req.file.path)) { await fsp.unlink(req.file.path); }
    }
});

// --- 3. Data Retrieval Routes ---

app.get('/api/inventory/:sessionName', (req, res) => {
    try {
        const inventory = DB.prepare(`
            SELECT product_name, category, SUM(quantity) AS quantity, MAX(threshold) AS threshold
            FROM inventory WHERE store_session = ? GROUP BY product_name, category
        `).all(req.params.sessionName);
        res.json(inventory);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/metrics', (req, res) => {
    const metrics = DB.prepare(`SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 50`).all();
    res.json(metrics);
});

app.delete('/api/reset-db/:sessionName', (req, res) => {
    DB.prepare(`DELETE FROM inventory WHERE store_session = ?`).run(req.params.sessionName);
    res.json({ success: true });
});

// --- 4. Static Assets & SPA Routing (Path-Fix) ---
app.use(express.static(PUBLIC_PATH));

// This Regex Literal (/.*/) is the "Bulletproof" fix for PathError
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Server live: http://localhost:${PORT}`);
    console.log(`📂 DB: ${DB_PATH}`);
});