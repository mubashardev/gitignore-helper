const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUT_FILE = path.join(__dirname, '../out/extension.js');
const INTEGRITY_FILE = path.join(__dirname, '../integrity.json');

function generateIntegrity() {
    console.log('Generating integrity hash...');

    if (!fs.existsSync(OUT_FILE)) {
        console.error('Error: out/extension.js not found. Make sure to compile first.');
        process.exit(1);
    }

    try {
        const content = fs.readFileSync(OUT_FILE);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        const integrity = {
            hash: hash,
            timestamp: new Date().toISOString()
        };

        fs.writeFileSync(INTEGRITY_FILE, JSON.stringify(integrity, null, 2));
        console.log(`Integrity file generated at ${INTEGRITY_FILE}`);
        console.log(`Hash: ${hash}`);
    } catch (error) {
        console.error('Failed to generate integrity file:', error);
        process.exit(1);
    }
}

generateIntegrity();
