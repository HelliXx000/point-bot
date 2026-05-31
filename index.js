const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');

// Create data folder
const dataDir = './data';
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ] 
});

// Database setup
const Database = require('better-sqlite3');
const db = new Database('./data/points.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS points (
        user_id TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS warnings (
        user_id TEXT,
        reason TEXT,
        date INTEGER,
        warned_by TEXT
    );
`);

// Helper functions
function getPoints(userId) {
    const row = db.prepare('SELECT points FROM points WHERE user_id = ?').get(userId);
    return row ? row.points : 0;
}

function setPoints(userId, points) {
    db.prepare(`
        INSERT INTO points (user_id, points) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET points = ?
    `).run(userId, points, points);
}

function addPoints(userId, amount) {
    const current = getPoints(userId);
    const newAmount = current + amount;
    setPoints(userId, newAmount);
    return newAmount;
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

function addWarning(userId, reason, warnedBy) {
    db.prepare(`
        INSERT INTO warnings (user_id, reason, date, warned_by) 
        VALUES (?, ?, ?, ?)
    `).run(userId, reason, Date.now(), warnedBy);
}

function getWarnings(userId) {
    return db.prepare('SELECT * FROM warnings WHERE user_id = ? ORDER BY date DESC').all(userId);
}

function clearWarnings(userId) {
    db.prepare('DELETE FROM warnings WHERE user_id = ?').run(userId);
}

// Check admin permission
function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

client.once('ready', () => {
    console.log(`${client.user.tag} is online.`);
    
    // Register slash commands (for modern Discord)
    const commands = [
        { name: 'point', description: 'Point management system' },
        { name: 'board', description: 'View point leaderboard' },
        { name: 'setpoint', description: 'Set a users points directly' }
    ];
    
    client.application.commands.set(commands).catch(console.error);
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    
    if (interaction.commandName === 'point') {
        return interaction.reply({ 
            content: 'Use `?point add @user <amount>` or `?point remove @user <amount>`', 
            ephemeral: true 
        });
    }
    
    if (interaction.commandName === 'board') {
        const sorted = getAllPoints();
        
        if (sorted.length === 0) {
            return interaction.reply('No points have been given out yet.');
        }
        
        let description = '```\n';
        for (let i = 0; i < Math.min(sorted.length, 15); i++) {
            const userId = sorted[i].user_id;
            const points = sorted[i].points;
            try {
                const user = await client.users.fetch(userId);
                let name = user.username;
                if (name.length > 20) name = name.substring(0, 17) + '...';
                description += `${(i+1).toString().padStart(2)}. ${name.padEnd(20)} ${points} points\n`;
            } catch {
                description += `${(i+1).toString().padStart(2)}. Unknown User${' '.repeat(12)} ${points} points\n`;
            }
        }
        description += '```';
        
        const embed = new EmbedBuilder()
            .setColor(0x2c2c2c)
            .setTitle('Point Leaderboard')
            .setDescription(description)
            .setFooter({ text: `Total users with points: ${sorted.length}` });
        
        await interaction.reply({ embeds: [embed] });
    }
    
    if (interaction.commandName === 'setpoint') {
        return interaction.reply({ content: 'Use `?point set @user <amount>`', ephemeral: true });
    }
});

// Handle prefix commands
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('?')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // POINT ADD
    if (command === 'point' && args[0] === 'add') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?point add @user 10`');
        }
        
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('Please provide a valid amount. Example: `?point add @user 10`');
        }
        
        const newTotal = addPoints(target.id, amount);
        message.reply(`Done. Added ${amount} points to ${target.username}. They now have ${newTotal} points.`);
    }
    
    // POINT REMOVE
    else if (command === 'point' && args[0] === 'remove') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?point remove @user 5`');
        }
        
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('Please provide a valid amount. Example: `?point remove @user 5`');
        }
        
        const current = getPoints(target.id);
        if (current === 0) {
            return message.reply(`${target.username} has 0 points. Cannot remove more.`);
        }
        
        const newTotal = removePoints(target.id, amount);
        message.reply(`Done. Removed ${amount} points from ${target.username}. They now have ${newTotal} points.`);
    }
    
    // POINT SET (directly set points)
    else if (command === 'point' && args[0] === 'set') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?point set @user 50`');
        }
        
        const amount = parseInt(args[2]);
        if (isNaN(amount) || amount < 0) {
            return message.reply('Please provide a valid amount. Example: `?point set @user 50`');
        }
        
        setPoints(target.id, amount);
        message.reply(`Done. Set ${target.username}'s points to ${amount}.`);
    }
    
    // POINT CHECK
    else if (command === 'points') {
        const target = message.mentions.users.first() || message.author;
        const userPoints = getPoints(target.id);
        
        const sorted = getAllPoints();
        let rank = 'unranked';
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].user_id === target.id) {
                rank = `#${i + 1}`;
                break;
            }
        }
        
        message.reply(`${target.username} has ${userPoints} points. Rank: ${rank}`);
    }
    
    // LEADERBOARD
    else if (command === 'board' || command === 'leaderboard') {
        const sorted = getAllPoints();
        
        if (sorted.length === 0) {
            return message.reply('No points have been given out yet.');
        }
        
        let description = '```\n';
        for (let i = 0; i < Math.min(sorted.length, 15); i++) {
            const userId = sorted[i].user_id;
            const points = sorted[i].points;
            try {
                const user = await client.users.fetch(userId);
                let name = user.username;
                if (name.length > 20) name = name.substring(0, 17) + '...';
                description += `${(i+1).toString().padStart(2)}. ${name.padEnd(20)} ${points} points\n`;
            } catch {
                description += `${(i+1).toString().padStart(2)}. Unknown User${' '.repeat(12)} ${points} points\n`;
            }
        }
        description += '```';
        
        const embed = new EmbedBuilder()
            .setColor(0x2c2c2c)
            .setTitle('Point Leaderboard')
            .setDescription(description)
            .setFooter({ text: `Total users: ${sorted.length}` });
        
        message.channel.send({ embeds: [embed] });
    }
    
    // BAN COMMAND
    else if (command === 'ban') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        // Check if replying to a message
        let target = message.mentions.users.first();
        
        if (!target && message.reference) {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            target = repliedMsg.author;
        }
        
        if (!target) {
            return message.reply('Please mention someone to ban. Example: `?ban @user` or reply to their message with `?ban`');
        }
        
        if (target.id === message.author.id) {
            return message.reply('You cannot ban yourself.');
        }
        
        const member = message.guild.members.cache.get(target.id);
        if (!member.bannable) {
            return message.reply('I cannot ban this user. They might have higher permissions than me.');
        }
        
        const reason = args.join(' ') || 'No reason provided';
        
        try {
            await member.ban({ reason: reason });
            message.reply('Done.');
        } catch (error) {
            message.reply('Failed to ban that user. Check my permissions.');
            console.error(error);
        }
    }
    
    // KICK COMMAND
    else if (command === 'kick') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        let target = message.mentions.users.first();
        
        if (!target && message.reference) {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            target = repliedMsg.author;
        }
        
        if (!target) {
            return message.reply('Please mention someone to kick. Example: `?kick @user` or reply to their message with `?kick`');
        }
        
        if (target.id === message.author.id) {
            return message.reply('You cannot kick yourself.');
        }
        
        const member = message.guild.members.cache.get(target.id);
        if (!member.kickable) {
            return message.reply('I cannot kick this user. They might have higher permissions than me.');
        }
        
        const reason = args.join(' ') || 'No reason provided';
        
        try {
            await member.kick(reason);
            message.reply('Done.');
        } catch (error) {
            message.reply('Failed to kick that user. Check my permissions.');
            console.error(error);
        }
    }
    
    // HELP COMMAND
    else if (command === 'help') {
        const helpText = `
**Point Bot Commands**

**Point Management (Admin only)**
?point add @user <amount>  - Add points to a user
?point remove @user <amount> - Remove points from a user
?point set @user <amount>  - Set a users points directly

**Point Checking**
?points @user - Check points (or check yourself)
?board - View leaderboard

**Moderation (Admin only)**
?ban @user <reason> - Ban a user
?kick @user <reason> - Kick a user
?warn @user <reason> - Warn a user
?warnings @user - View warnings

**Tip:** You can also reply to a message with ?ban or ?kick to target that person.
        `;
        message.reply(helpText);
    }
    
    // WARN COMMAND
    else if (command === 'warn') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        let target = message.mentions.users.first();
        
        if (!target && message.reference) {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            target = repliedMsg.author;
        }
        
        if (!target) {
            return message.reply('Please mention someone to warn.');
        }
        
        const reason = args.join(' ') || 'No reason provided';
        addWarning(target.id, reason, message.author.tag);
        
        const warnings = getWarnings(target.id);
        message.reply(`Done. Warned ${target.username}. They have ${warnings.length} total warning(s).`);
        
        // DM the user
        try {
            await target.send(`You have been warned in ${message.guild.name} for: ${reason}`);
        } catch(e) {}
    }
    
    // WARNINGS COMMAND
    else if (command === 'warnings') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone to check warnings for.');
        }
        
        const warnings = getWarnings(target.id);
        
        if (warnings.length === 0) {
            return message.reply(`${target.username} has no warnings.`);
        }
        
        let warningList = `**Warnings for ${target.username}:**\n\n`;
        for (let i = 0; i < warnings.length; i++) {
            const w = warnings[i];
            const date = new Date(w.date).toLocaleDateString();
            warningList += `${i+1}. ${w.reason}\n   Date: ${date} | Warned by: ${w.warned_by}\n\n`;
        }
        
        message.reply(warningList);
    }
    
    // CLEAR WARNINGS
    else if (command === 'clearwarnings') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone to clear warnings for.');
        }
        
        clearWarnings(target.id);
        message.reply(`Done. Cleared all warnings for ${target.username}.`);
    }
});

client.login(TOKEN);
