# AI Inventory Auditor (Universal Vision System)

A high-performance, local vision system for real-time inventory SKU auditing. This system utilizes **Ollama** with **Llava:13b** to transform shelf images into structured, categorized JSON data with a focus on counting accuracy.

---

## 📁 Project Structure

```text
.
├── backend/
│   ├── server.js          # Express API & Ollama pipeline
│   ├── inventory.sqlite   # SQLite Database (Auto-generated, Git-ignored)
├── uploads/               # Temp storage for image processing (Root)
├── public/
│   ├── index.html         # Audit Dashboard
│   ├── script.js          # Frontend Logic
│   └── style.css          # Styling
├── .env                   # Local config (Git-ignored)
├── .gitignore             # Git exclusion rules
├── package.json           # Node dependencies
└── README.md              # Documentation

---

## 🚀 Installation & Setup

### 1. Prerequisite: Setup Ollama
Ensure you have the high-accuracy vision model pulled and ready:
ollama pull llava:13b

### 2. Configure Environment Variables
Create a .env file in the root directory. This keeps your local paths out of the Git repository:
PORT=3000
DATABASE_URL=inventory.sqlite

### 3. Start the AI Server (Optimized)
Run Ollama with persistent memory settings. This ensures the model stays "hot" in GPU/Unified memory, preventing 50-second reload delays:
OLLAMA_KEEP_ALIVE=-1 OLLAMA_CONTEXT_LENGTH=8192 ollama serve

### 4. Run the Application
From the project root:
npm install
node backend/server.js

---

## 🛠️ Core Audit Logic

### 1. Spatial Audit Strategy
To maximize quantity accuracy, the system instructs the model to perform a Spatial Audit:
* Scan Path: Top-left to bottom-right movement.
* Edge Detection: Focuses on physical object boundaries (shadows and stems) to distinguish individual units in clusters.
* Literalism: Uses a temperature: 0.0 setting to force the model to count what is actually visible rather than estimating.

### 2. JSON Stability Defense
The system handles the inherent instability of local LLMs using a "Triple-Defense" layer:
* Prefix Injection: Manually starts the AI response with "[" to force a JSON array.
* Emergency Closure: A backend safety net in server.js that detects truncated responses and manually closes JSON brackets.
* JSON Repair: Automatically fixes syntax errors like trailing commas or missing quotes before database insertion.

---

## 📊 Performance Specs
* Latency: ~1.6s - 2.2s (Post-warmup)
* Inference Speed: ~30-35 tokens/sec
* Precision: Optimized for SKU-level differentiation (e.g., Gala vs. Granny Smith).

---

## 📝 License
Internal Use Only - Inventory Audit Tool 2025.