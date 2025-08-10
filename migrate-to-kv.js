// Script to migrate CSV data to Cloudflare KV storage
const fs = require('fs');
const path = require('path');

async function migrateToKV() {
  const csvPath = path.join(__dirname, 'system-data.csv');
  
  try {
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    // Skip header line and empty first line
    const dataLines = lines.slice(2);
    
    const systems = dataLines.map(line => {
      const columns = line.split(',');
      if (columns.length >= 6) {
        return {
          systemName: columns[0].trim(),
          systemId: columns[1].trim(), 
          level: columns[2].trim(),
          warpRange: columns[3].trim(),
          warpRangeSH: columns[4].trim(),
          factionId: columns[5].trim()
        };
      }
      return null;
    }).filter(system => system !== null);

    console.log(`Found ${systems.length} systems to migrate`);

    // Generate KV bulk upload file
    const kvData = systems.map(system => ({
      key: `system:${system.systemId}`,
      value: JSON.stringify(system)
    }));

    // Also create an index for all system IDs
    const systemIds = systems.map(s => s.systemId);
    kvData.push({
      key: 'system:index',
      value: JSON.stringify(systemIds)
    });

    // Write the bulk upload file
    const bulkUploadPath = path.join(__dirname, 'kv-bulk-upload.json');
    fs.writeFileSync(bulkUploadPath, JSON.stringify(kvData, null, 2));

    console.log(`✅ Created KV bulk upload file: ${bulkUploadPath}`);
    console.log('📝 Next steps:');
    console.log('1. Create KV namespace: wrangler kv namespace create "SYSTEM_DATA"');
    console.log('2. Create preview namespace: wrangler kv namespace create "SYSTEM_DATA" --preview');
    console.log('3. Update wrangler.jsonc with the namespace IDs');
    console.log('4. Upload data: wrangler kv bulk put --binding SYSTEM_DATA kv-bulk-upload.json');
    console.log(`5. Total entries to upload: ${kvData.length}`);

  } catch (error) {
    console.error('❌ Error migrating data:', error);
  }
}

migrateToKV().catch(console.error);
