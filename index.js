const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');

// Get token from Railway environment variables
const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ] 
});

// Database will be stored in Railway's persistent volume
const Database = require('better-sqlite3');
const db = new Database('./data/points.db');

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS points (
        user_id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        last_updated INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS embed_config (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

// Helper functions
function getPoints(userId) {
    const row = db.prepare('SELECT points FROM points WHERE user_id = ?').get(userId);
    return row ? row.points : 0;
}

function setPoints(userId, points) {
    db.prepare(`
        INSERT INTO points (user_id, points, last_updated) 
        VALUES (?, ?, ?) 
        ON CONFLICT(user_id) DO UPDATE SET points = ?, last_updated = ?
    `).run(userId, points, Date.now(), points, Date.now());
}

function addPoints(userId, amount) {
    const current = getPoints(userId);
    setPoints(userId, current + amount);
    return current + amount;
}

function removePoints(userId, amount) {
    const current = getPoints(userId);
    const newAmount = Math.max(0, current - amount);
    setPoints(userId, newAmount);
    return newAmount;
}

function getAllPoints() {
    return db.prepare('SELECT user_id, points FROM points WHERE points > 0 ORDER BY points DESC').all();
}

// Embed settings
function getEmbedSetting(key, defaultValue) {
    const row = db.prepare('SELECT value FROM embed_config WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
}

function setEmbedSetting(key, value) {
    db.prepare(`
        INSERT INTO embed_config (key, value) VALUES (?, ?) 
        ON CONFLICT(key) DO UPDATE SET value = ?
    `).run(key, value, value);
}

client.once('ready', async () => {
    console.log(`✅ ${client.user.tag} is online and ready!`);
    console.log(`📊 Database initialized - Points will never be lost!`);
    
    // Register slash commands globally
    const commands = [
        {
            name: 'addpoints',
            description: '💰 Give points to someone',
            options: [
                { name: 'user', type: 6, description: 'Who to give points to', required: true },
                { name: 'amount', type: 4, description: 'How many points', required: true },
                { name: 'reason', type: 3, description: 'Why?', required: false }
            ]
        },
        {
            name: 'removepoints',
            description: '📉 Take points from someone',
            options: [
                { name: 'user', type: 6, description: 'Who to take from', required: true },
                { name: 'amount', type: 4, description: 'How many points', required: true },
                { name: 'reason', type: 3, description: 'Why?', required: false }
            ]
        },
        {
            name: 'points',
            description: '📊 Check your points or someone elses',
            options: [
                { name: 'user', type: 6, description: 'Who to check (optional)', required: false }
            ]
        },
        {
            name: 'leaderboard',
            description: '🏆 Show top point holders',
            options: [
                { name: 'page', type: 4, description: 'Page number', required: false }
            ]
        },
        {
            name: 'setembed',
            description: '🎨 Customize leaderboard appearance (Admin only)',
            options: [
                { name: 'title', type: 3, description: 'Embed title', required: false },
                { name: 'color', type: 3, description: 'Hex color (like #FF0000)', required: false },
                { name: 'footer', type: 3, description: 'Footer text', required: false },
                { name: 'thumbnail', type: 3, description: 'Image URL for thumbnail', required: false }
            ]
        },
        {
            name: 'resetpoints',
            description: '⚠️ Reset ALL points (Admin only)',
            options: [
                { name: 'confirm', type: 5, description: 'Type true to confirm', required: true }
            ]
        }
    ];
    
    try {
        await client.application.commands.set(commands);
        console.log('📡 Commands registered!');
    } catch (error) {
        console.error('Command registration failed:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    // ADD POINTS
    if (interaction.commandName === 'addpoints') {
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Only admins can add points!', ephemeral: true });
        }
        
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'No reason given';
        
        if (amount <= 0) {
            return interaction.reply({ content: '❌ Amount must be positive!', ephemeral: true });
        }
        
        const newTotal = addPoints(targetUser.id, amount);
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Points Added!')
            .setDescription(`Added **${amount}** points to ${targetUser.username}`)
            .addFields(
                { name: 'Total Points', value: `${newTotal}`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Moderator', value: interaction.user.username, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `User ID: ${targetUser.id}` });
        
        await interaction.reply({ embeds: [embed] });
        
        // Try to DM the user
        try {
            await targetUser.send(`📢 You received **${amount}** points in ${interaction.guild.name}!\nReason: ${reason}\nTotal: ${newTotal} points`);
        } catch(e) {}
    }
    
    // REMOVE POINTS
    if (interaction.commandName === 'removepoints') {
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Only admins can remove points!', ephemeral: true });
        }
        
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'No reason given';
        
        if (amount <= 0) {
            return interaction.reply({ content: '❌ Amount must be positive!', ephemeral: true });
        }
        
        const current = getPoints(targetUser.id);
        if (current === 0) {
            return interaction.reply({ content: '❌ This user has 0 points!', ephemeral: true });
        }
        
        const newTotal = removePoints(targetUser.id, amount);
        
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⚠️ Points Removed')
            .setDescription(`Removed **${amount}** points from ${targetUser.username}`)
            .addFields(
                { name: 'Remaining Points', value: `${newTotal}`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Moderator', value: interaction.user.username, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        try {
            await targetUser.send(`📢 You lost **${amount}** points in ${interaction.guild.name}!\nReason: ${reason}\nRemaining: ${newTotal} points`);
        } catch(e) {}
    }
    
    // CHECK POINTS
    if (interaction.commandName === 'points') {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const userPoints = getPoints(targetUser.id);
        
        // Calculate rank
        const allUsers = getAllPoints();
        let rank = 'N/A';
        for (let i = 0; i < allUsers.length; i++) {
            if (allUsers[i].user_id === targetUser.id) {
                rank = `#${i + 1}`;
                break;
            }
        }
        
        const embed = new EmbedBuilder()
            .setColor('#3498db')
            .setTitle('📊 Point Balance')
            .setThumbnail(targetUser.displayAvatarURL())
            .addFields(
                { name: 'User', value: targetUser.username, inline: true },
                { name: 'Points', value: `${userPoints}`, inline: true },
                { name: 'Rank', value: rank, inline: true },
                { name: 'Message', value: userPoints === 0 ? 'No points yet!' : 'Keep it up! 💪', inline: false }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // LEADERBOARD
    if (interaction.commandName === 'leaderboard') {
        const page = interaction.options.getInteger('page') || 1;
        const itemsPerPage = 10;
        const allPoints = getAllPoints();
        
        if (allPoints.length === 0) {
            return interaction.reply('📊 No points have been given out yet!');
        }
        
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = allPoints.slice(start, end);
        
        let description = '```\n';
        let position = start + 1;
        
        for (const item of pageItems) {
            try {
                const user = await client.users.fetch(item.user_id);
                const name = user.username.length > 20 ? user.username.substring(0, 17) + '...' : user.username;
                description += `${position.toString().padStart(2)}. ${name.padEnd(20)} ${item.points} points\n`;
            } catch {
                description += `${position.toString().padStart(2)}. Unknown User${' '.repeat(12)} ${item.points} points\n`;
            }
            position++;
        }
        
        description += '```';
        
        const title = getEmbedSetting('title', '🏆 Point Leaderboard');
        const color = getEmbedSetting('color', '#FFD700');
        const footer = getEmbedSetting('footer', 'Use /points to check yours');
        const thumbnail = getEmbedSetting('thumbnail', null);
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setFooter({ text: `${footer} • Page ${page}/${Math.ceil(allPoints.length / itemsPerPage)}` })
            .setTimestamp();
        
        if (thumbnail && thumbnail !== 'null') {
            embed.setThumbnail(thumbnail);
        }
        
        await interaction.reply({ embeds: [embed] });
    }
    
    // CUSTOMIZE EMBED
    if (interaction.commandName === 'setembed') {
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Only admins can customize the embed!', ephemeral: true });
        }
        
        const title = interaction.options.getString('title');
        const color = interaction.options.getString('color');
        const footer = interaction.options.getString('footer');
        const thumbnail = interaction.options.getString('thumbnail');
        
        if (title) setEmbedSetting('title', title);
        if (color) setEmbedSetting('color', color);
        if (footer) setEmbedSetting('footer', footer);
        if (thumbnail) setEmbedSetting('thumbnail', thumbnail);
        
        // Preview
        const preview = new EmbedBuilder()
            .setColor(color || getEmbedSetting('color', '#FFD700'))
            .setTitle(title || getEmbedSetting('title', '🏆 Point Leaderboard'))
            .setDescription('✨ Your leaderboard will look like this!')
            .setFooter({ text: footer || getEmbedSetting('footer', 'Use /points to check yours') })
            .setTimestamp();
        
        if (thumbnail) preview.setThumbnail(thumbnail);
        
        await interaction.reply({
            content: '✅ Embed settings updated! Here is a preview:',
            embeds: [preview]
        });
    }
    
    // RESET ALL POINTS (DANGEROUS)
    if (interaction.commandName === 'resetpoints') {
        if (!isAdmin) {
            return interaction.reply({ content: '❌ Only admins can reset points!', ephemeral: true });
        }
        
        const confirm = interaction.options.getBoolean('confirm');
        
        if (!confirm) {
            return interaction.reply({ 
                content: '⚠️ To reset ALL points, use `/resetpoints confirm:true`\nThis action CANNOT be undone!',
                ephemeral: true 
            });
        }
        
        db.prepare('DELETE FROM points').run();
        
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⚠️ Points Reset')
            .setDescription('All points have been reset to 0!')
            .addFields(
                { name: 'Reset by', value: interaction.user.username, inline: true },
                { name: 'Time', value: new Date().toLocaleString(), inline: true }
            )
            .setFooter({ text: 'This action was logged' });
        
        await interaction.reply({ embeds: [embed] });
        
        // Log to console
        console.log(`⚠️ ALL POINTS RESET by ${interaction.user.username} at ${new Date().toISOString()}`);
    }
});

// Auto-save is handled by SQLite (instant)
// Even if bot crashes, all data is safe

process.on('SIGINT', () => {
    console.log('📦 Saving data before shutdown...');
    db.close();
    process.exit();
});

client.login(TOKEN);