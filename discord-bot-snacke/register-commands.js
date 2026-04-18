// Register slash commands to a guild (instant) or globally (slow propagation).
// Run once after changing commands:  node register-commands.js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Global SnakeCoin stats (players, games, $SNAKE distributed)'),

  new SlashCommandBuilder()
    .setName('topscore')
    .setDescription('Show the leaderboard')
    .addStringOption(opt =>
      opt.setName('period')
        .setDescription('Time period')
        .setRequired(false)
        .addChoices(
          { name: 'Day',      value: 'day'  },
          { name: 'Week',     value: 'week' },
          { name: 'All-Time', value: 'all'  },
        )
    ),

  new SlashCommandBuilder()
    .setName('wallet')
    .setDescription('Check a wallet\'s rank and stats')
    .addStringOption(opt =>
      opt.setName('address').setDescription('Polygon wallet address').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link a wallet to your Discord account (for Snake Hodler role)')
    .addStringOption(opt =>
      opt.setName('address').setDescription('Polygon wallet address you own').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Get the link to play SnakeCoin'),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('⏳ Registering commands...');
    if (process.env.DISCORD_GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} commands to guild ${process.env.DISCORD_GUILD_ID}`);
    } else {
      await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Registered ${commands.length} commands globally (may take ~1h to propagate)`);
    }
  } catch (err) {
    console.error('❌ Register failed:', err);
    process.exit(1);
  }
})();
