#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// Function to download a file
function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
      }
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Function to extract art_ids from officer data
function extractArtIds() {
  try {
    // Read the TypeScript file as text and extract art_id values
    const officerDataContent = fs.readFileSync('src/officerData.ts', 'utf8');
    
    // Find all art_id values using regex
    const artIdMatches = officerDataContent.match(/"art_id":\s*(\d+)/g);
    
    if (!artIdMatches) {
      console.log('No art_id values found in officer data');
      return [];
    }
    
    // Extract the numeric values and create a unique set
    const artIds = new Set();
    artIdMatches.forEach(match => {
      const id = match.match(/\d+/)[0];
      artIds.add(parseInt(id));
    });
    
    return Array.from(artIds).sort((a, b) => a - b);
  } catch (error) {
    console.error('Error reading officer data:', error);
    return [];
  }
}

// Main function
async function fetchAbilityIcons() {
  console.log('Extracting art_ids from officer data...');
  const artIds = extractArtIds();
  
  if (artIds.length === 0) {
    console.log('No art_ids found. Exiting.');
    return;
  }
  
  console.log(`Found ${artIds.length} unique art_ids:`, artIds.slice(0, 10), artIds.length > 10 ? '...' : '');
  
  // Create abilities directory if it doesn't exist
  const abilitiesDir = 'public/abilities';
  if (!fs.existsSync(abilitiesDir)) {
    fs.mkdirSync(abilitiesDir, { recursive: true });
  }
  
  console.log(`Starting download of ${artIds.length} ability icons...`);
  
  let downloaded = 0;
  let failed = 0;
  
  // Download icons with rate limiting (5 concurrent downloads)
  const batchSize = 5;
  for (let i = 0; i < artIds.length; i += batchSize) {
    const batch = artIds.slice(i, i + batchSize);
    const promises = batch.map(async (artId) => {
      const url = `https://spocks.club/img/abilities/${artId}.png`;
      const filePath = path.join(abilitiesDir, `${artId}.png`);
      
      // Skip if file already exists
      if (fs.existsSync(filePath)) {
        console.log(`Skipping ${artId}.png (already exists)`);
        return;
      }
      
      try {
        await downloadFile(url, filePath);
        downloaded++;
        console.log(`Downloaded ${artId}.png (${downloaded + failed}/${artIds.length})`);
      } catch (error) {
        failed++;
        console.error(`Failed to download ${artId}.png:`, error.message);
      }
    });
    
    await Promise.all(promises);
    
    // Small delay between batches to be respectful to the server
    if (i + batchSize < artIds.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log(`\nDownload complete!`);
  console.log(`Successfully downloaded: ${downloaded}`);
  console.log(`Failed downloads: ${failed}`);
  console.log(`Total art_ids processed: ${artIds.length}`);
  
  if (downloaded > 0) {
    console.log(`Ability icons saved to: ${abilitiesDir}/`);
  }
}

// Run the script
if (require.main === module) {
  fetchAbilityIcons().catch(console.error);
}

module.exports = { extractArtIds, fetchAbilityIcons };
