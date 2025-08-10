// Discord slash command registration script
// Run this once to register the commands

require('dotenv').config();

const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || 'your-discord-application-id';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'your-discord-bot-token';

if (!process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_BOT_TOKEN) {
  console.error('❌ Missing Discord configuration in .env file');
  console.error('Please add DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN to your .env file');
  process.exit(1);
}

const commands = [
  {
    name: 'lookup',
    description: 'Look up STFC coordinate information',
    options: [
      {
        type: 3, // STRING type
        name: 'coordinates',
        description: 'STFC coordinate link to lookup (e.g., [[ALLY] Player S:73559 X:628.7 Y:43.3])',
        required: true
      }
    ]
  },
  {
    name: 'table',
    description: 'Generate an ASCII table from CSV data',
    options: [
      {
        type: 3, // STRING type
        name: 'csv_data',
        description: 'CSV data or paste multi-line CSV. Use /tablehelp for examples and file upload info.',
        required: false
      },
      {
        type: 11, // ATTACHMENT type
        name: 'csv_file',
        description: 'Upload a .csv file to generate a table',
        required: false
      }
    ]
  },
  {
    name: 'tablehelp',
    description: 'Show help and examples for the /table command'
  }
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;
  
  for (const command of commands) {
    console.log(`Registering command: ${command.name}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('✅ Successfully registered command:', data.name);
      console.log('Command ID:', data.id);
    } else {
      const error = await response.text();
      console.error(`❌ Failed to register command ${command.name}:`, error);
    }
  }
}

// Run the registration
registerCommands().catch(console.error);
