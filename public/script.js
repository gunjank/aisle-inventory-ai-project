// public/script.js

// ----------------------------------------------------------------------
// 🚨 FIX: Wrap the entire script in DOMContentLoaded to ensure elements exist!
// ----------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {

// NEW: Dynamic URL based on where the client is loaded
    let API_BASE_URL = '';

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // If running locally, use localhost:3000
        API_BASE_URL = 'http://localhost:3000';
    } else {
        // If running on localtunnel or any public URL, use the current host's protocol and port (if any)
        API_BASE_URL = window.location.protocol + '//' + window.location.host;
    }
    
    // Element selection now guaranteed to work because DCL has fired:
    const fileInput = document.getElementById('actualFileInput');
    const sessionInput = document.getElementById('storeSession');
    const statusDiv = document.getElementById('status-message');
    const tbody = document.getElementById('inventory-body');

    // Add event listeners that rely on these elements:
    document.querySelector('button').addEventListener('click', uploadImages);
    sessionInput.addEventListener('change', loadPreviousInventory);

    // Initial load call: This is the critical line that runs on refresh.
    loadPreviousInventory(); 

    // ----------------------------------------------------------------------
    // Core Functions
    // ----------------------------------------------------------------------

    /**
     * Handles the sequential upload of multiple segmented images.
     */
    async function uploadImages() {
        const selectedFiles = fileInput.files;
        const storeSession = sessionInput.value.trim();

        if (selectedFiles.length === 0) {
            statusDiv.textContent = 'Please select one or more image files.';
            statusDiv.style.color = 'red';
            return;
        }
        if (!storeSession) {
            statusDiv.textContent = 'Please enter a Store Session name.';
            statusDiv.style.color = 'red';
            return;
        }

        statusDiv.textContent = `Scanning ${selectedFiles.length} image(s) for session: ${storeSession}... Please wait.`;
        statusDiv.style.color = 'orange';

        const uploadPromises = [];
        
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            
            const uploadPromise = (async () => {
                const formData = new FormData();
                formData.append('aisleImage', file);
                formData.append('storeSession', storeSession);

                try {
                    const response = await fetch(`${API_BASE_URL}/api/upload`, {
                        method: 'POST',
                        body: formData,
                    });
                    
                    const result = await response.json();
                
                    if (!response.ok) {
                        throw new Error(`Error processing file ${i + 1}: ${result.error || result.details}`);
                    }
                    
                    statusDiv.textContent = `Processing image ${i + 1} of ${selectedFiles.length}...`;
                        // --- NEW: Display Performance Metrics ---
                    const metricsDisplay = document.getElementById('metrics-display');
                    const metrics = result.performance;

                    if (metrics) {
                        document.getElementById('total-time').textContent = metrics.totalDuration;
                        document.getElementById('prompt-tokens').textContent = metrics.promptTokens;
                        document.getElementById('completion-tokens').textContent = metrics.completionTokens;
                        document.getElementById('tokens-per-second').textContent = metrics.tokensPerSecond;
                        metricsDisplay.style.display = 'block'; // Show the container
                    }
                    return result; 
                } catch (error) {
                    console.error(`Upload error for file ${file.name}:`, error);
                    throw error; 
                }
            })();
            
            uploadPromises.push(uploadPromise);
        }
        
        try {
            const results = await Promise.all(uploadPromises);
            
            // Call the inventory load function to get the final aggregated result
            await loadPreviousInventory();
            statusDiv.textContent = `✅ All ${selectedFiles.length} scans complete! Inventory aggregated for ${storeSession}.`;
            statusDiv.style.color = 'green';
            await loadPreviousInventory();

        } catch (error) {
            statusDiv.textContent = `🚨 Scan Failed. See console for details. Error: ${error.message}`;
            statusDiv.style.color = 'red';
        }
    }


    /**
     * Fetches and renders inventory data for the current session ID.
     */
    async function loadPreviousInventory() {
        const storeSession = sessionInput.value.trim();

        if (!storeSession) {
            statusDiv.textContent = 'Enter a Store Session ID to load or scan inventory.';
            return;
        }

        statusDiv.textContent = `Loading previous inventory for session: ${storeSession}...`;
        statusDiv.style.color = 'orange';

        try {
            // Note: The /api/inventory/:sessionName endpoint returns the full aggregated array
            const response = await fetch(`${API_BASE_URL}/api/inventory/${storeSession}`);

            if (response.status === 404 || response.status === 500) {
                 statusDiv.textContent = `No previous data found for session: ${storeSession}. Start scanning!`;
                 statusDiv.style.color = 'gray';
                 renderInventory([]); 
                 return;
            }
            
            const inventory = await response.json();
            
            statusDiv.textContent = `Inventory for ${storeSession} loaded successfully.`;
            statusDiv.style.color = 'green';
            
            renderInventory(inventory);
            
        } catch (error) {
            statusDiv.textContent = `🚨 Could not load previous data. Check server logs.`;
            statusDiv.style.color = 'red';
            console.error('Inventory Load Error:', error);
        }
    }


    /**
     * Renders the inventory array to the HTML table.
     * @param {Array} inventory - Array of inventory objects.
     */
    function renderInventory(inventory) {
        tbody.innerHTML = ''; // Clear previous results

        if (inventory.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No items found for this session.</td></tr>';
            return;
        }

        inventory.forEach(item => {
            const row = tbody.insertRow();
            const isLowStock = item.is_below_threshold === 1;

            if (isLowStock) {
                row.className = 'low-stock';
            }

            row.insertCell().textContent = item.product_name;
            row.insertCell().textContent = item.category;
            row.insertCell().textContent = item.quantity;
            row.insertCell().textContent = item.threshold;
            
            const alertCell = row.insertCell();
            alertCell.textContent = isLowStock ? '🚨 LOW' : '✅ OK';
            alertCell.style.color = isLowStock ? 'red' : 'green';
        });
    }


    const ddButton = document.getElementById('dd-button');
    const storeSessionInput = document.getElementById('storeSession'); // Assuming this is your input field ID
    if (ddButton) {
        ddButton.addEventListener('click', async () => {
            const sessionToDelete = storeSessionInput.value.trim(); // <-- NEW: Get the session name
            
            if (!sessionToDelete) {
                alert("Please enter the session name you wish to delete.");
                return;
            }

            if (!confirm(`WARNING: Are you sure you want to delete ALL inventory and metrics data for session: "${sessionToDelete}"?`)) {
                return; // Exit if user cancels
            }

            ddButton.disabled = true;
            ddButton.textContent = '...';

            try {
                // 🚨 FIX: Append the session name to the URL
                const response = await fetch(`${API_BASE_URL}/api/reset-db/${sessionToDelete}`, {
                    method: 'DELETE', 
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Server responded with an error.');
                }

                // After deletion, reload the inventory to show an empty table
                await loadPreviousInventory();
                document.getElementById('status').textContent = `✅ Session "${sessionToDelete}" inventory and metrics fully reset. Table cleared.`;

            } catch (error) {
                console.error('Session Delete Error:', error);
                document.getElementById('status').textContent = `❌ Delete failed: ${error.message}`;
            } finally {
                ddButton.disabled = false;
                ddButton.textContent = 'DD';
            }
        });
    }

}); // End of DOMContentLoaded listener