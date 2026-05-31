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

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

client.once('ready', async () => {
    console.log(`${client.user.tag} is online.`);
    
    // Register all slash commands
    const commands = [
        {
            name: 'addpoints',
            description: 'Add points to a member',
            options: [
                { name: 'user', type: 6, description: 'Member to give points to', required: true },
                { name: 'amount', type: 4, description: 'Number of points', required: true }
            ]
        },
        {
            name: 'removepoints',
            description: 'Remove points from a member',
            options: [
                { name: 'user', type: 6, description: 'Member to remove points from', required: true },
                { name: 'amount', type: 4, description: 'Number of points', required: true }
            ]
        },
        {
            name: 'setpoints',
            description: 'Set a members points directly',
            options: [
                { name: 'user', type: 6, description: 'Member to set points for', required: true },
                { name: 'amount', type: 4, description: 'New point total', required: true }
            ]
        },
        {
            name: 'points',
            description: 'Check points of a member',
            options: [
                { name: 'user', type: 6, description: 'Member to check', required: false }
            ]
        },
        {
            name: 'leaderboard',
            description: 'View the point leaderboard',
            options: [
                { name: 'page', type: 4, description: 'Page number', required: false }
            ]
        },
        {
            name: 'ban',
            description: 'Ban a member',
            options: [
                { name: 'user', type: 6, description: 'Member to ban', required: true },
                { name: 'reason', type: 3, description: 'Reason for ban', required: false }
            ]
        },
        {
            name: 'kick',
            description: 'Kick a member',
            options: [
                { name: 'user', type: 6, description: 'Member to kick', required: true },
                { name: 'reason', type: 3, description: 'Reason for kick', required: false }
            ]
        },
        {
            name: 'help',
            description: 'Show all bot commands'
        }
    ];
    
    try {
        await client.application.commands.set(commands);
        console.log('Slash commands registered.');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    // ADD POINTS (slash)
    if (interaction.commandName === 'addpoints') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You need administrator permission for this.', ephemeral: true });
        }
        
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        
        if (amount <= 0) {
            return interaction.reply({ content: 'Amount must be positive.', ephemeral: true });
        }
        
        const newTotal = addPoints(target.id, amount);
        interaction.reply(`Done. Added ${amount} points to ${target.username}. They now have ${newTotal} points.`);
    }
    
    // REMOVE POINTS (slash)
    if (interaction.commandName === 'removepoints') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You need administrator permission for this.', ephemeral: true });
        }
        
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        
        if (amount <= 0) {
            return interaction.reply({ content: 'Amount must be positive.', ephemeral: true });
        }
        
        const current = getPoints(target.id);
        if (current === 0) {
            return interaction.reply({ content: `${target.username} has 0 points. Cannot remove more.`, ephemeral: true });
        }
        
        const newTotal = removePoints(target.id, amount);
        interaction.reply(`Done. Removed ${amount} points from ${target.username}. They now have ${newTotal} points.`);
    }
    
    // SET POINTS (slash)
    if (interaction.commandName === 'setpoints') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You need administrator permission for this.', ephemeral: true });
        }
        
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        
        if (amount < 0) {
            return interaction.reply({ content: 'Amount cannot be negative.', ephemeral: true });
        }
        
        setPoints(target.id, amount);
        interaction.reply(`Done. Set ${target.username}'s points to ${amount}.`);
    }
    
    // CHECK POINTS (slash)
    if (interaction.commandName === 'points') {
        const target = interaction.options.getUser('user') || interaction.user;
        const userPoints = getPoints(target.id);
        
        const sorted = getAllPoints();
        let rank = 'unranked';
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].user_id === target.id) {
                rank = `#${i + 1}`;
                break;
            }
        }
        
        interaction.reply(`${target.username} has ${userPoints} points. Rank: ${rank}`);
    }
    
    // LEADERBOARD (slash)
    if (interaction.commandName === 'leaderboard') {
        const page = interaction.options.getInteger('page') || 1;
        const itemsPerPage = 10;
        const sorted = getAllPoints();
        
        if (sorted.length === 0) {
            return interaction.reply('No points have been given out yet.');
        }
        
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = sorted.slice(start, end);
        
        if (pageItems.length === 0) {
            return interaction.reply({ content: `Page ${page} does not exist.`, ephemeral: true });
        }
        
        let description = '```\n';
        for (let i = 0; i < pageItems.length; i++) {
            const userId = pageItems[i].user_id;
            const points = pageItems[i].points;
            const rank = start + i + 1;
            try {
                const user = await client.users.fetch(userId);
                let name = user.username;
                if (name.length > 20) name = name.substring(0, 17) + '...';
                description += `${rank.toString().padStart(2)}. ${name.padEnd(20)} ${points} points\n`;
            } catch {
                description += `${rank.toString().padStart(2)}. Unknown User${' '.repeat(12)} ${points} points\n`;
            }
        }
        description += '```';
        
        const embed = new EmbedBuilder()
            .setColor(0x2c2c2c)
            .setTitle('Point Leaderboard')
            .setDescription(description)
            .setFooter({ text: `Page ${page} of ${Math.ceil(sorted.length / itemsPerPage)} | Total users: ${sorted.length}` });
        
        interaction.reply({ embeds: [embed] });
    }
    
    // BAN (slash)
    if (interaction.commandName === 'ban') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You need administrator permission for this.', ephemeral: true });
        }
        
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        if (target.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot ban yourself.', ephemeral: true });
        }
        
        const member = interaction.guild.members.cache.get(target.id);
        if (!member || !member.bannable) {
            return interaction.reply({ content: 'I cannot ban this user. They might have higher permissions than me.', ephemeral: true });
        }
        
        try {
            await member.ban({ reason: reason });
            interaction.reply('Done.');
        } catch (error) {
            interaction.reply({ content: 'Failed to ban that user. Check my permissions.', ephemeral: true });
        }
    }
    
    // KICK (slash)
    if (interaction.commandName === 'kick') {
        if (!isAdmin(interaction.member)) {
            return interaction.reply({ content: 'You need administrator permission for this.', ephemeral: true });
        }
        
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        if (target.id === interaction.user.id) {
            return interaction.reply({ content: 'You cannot kick yourself.', ephemeral: true });
        }
        
        const member = interaction.guild.members.cache.get(target.id);
        if (!member || !member.kickable) {
            return interaction.reply({ content: 'I cannot kick this user. They might have higher permissions than me.', ephemeral: true });
        }
        
        try {
            await member.kick(reason);
            interaction.reply('Done.');
        } catch (error) {
            interaction.reply({ content: 'Failed to kick that user. Check my permissions.', ephemeral: true });
        }
    }
    
    // HELP (slash)
    if (interaction.commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x2c2c2c)
            .setTitle('Bot Commands')
            .setDescription('**Prefix: ?**\n**Slash: /**')
            .addFields(
                { name: 'Point Management (Admin)', value: '`?addpoints @user <amount>` or `/addpoints`\n`?removepoints @user <amount>` or `/removepoints`\n`?setpoints @user <amount>` or `/setpoints`', inline: false },
                { name: 'Point Checking', value: '`?points @user` or `/points`\n`?leaderboard` or `/leaderboard`', inline: false },
                { name: 'Moderation (Admin)', value: '`?ban @user <reason>` or `/ban`\n`?kick @user <reason>` or `/kick`', inline: false },
                { name: 'Reply to Ban/Kick', value: 'Reply to someones message with `?ban` or `?kick` to target them.', inline: false }
            )
            .setFooter({ text: 'Point data is permanently saved' });
        
        interaction.reply({ embeds: [helpEmbed] });
    }
});

// Handle prefix commands
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('?')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // ADD POINTS (prefix)
    if (command === 'addpoints') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?addpoints @user 10`');
        }
        
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('Please provide a valid amount. Example: `?addpoints @user 10`');
        }
        
        const newTotal = addPoints(target.id, amount);
        message.reply(`Done. Added ${amount} points to ${target.username}. They now have ${newTotal} points.`);
    }
    
    // REMOVE POINTS (prefix)
    else if (command === 'removepoints') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?removepoints @user 5`');
        }
        
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount <= 0) {
            return message.reply('Please provide a valid amount. Example: `?removepoints @user 5`');
        }
        
        const current = getPoints(target.id);
        if (current === 0) {
            return message.reply(`${target.username} has 0 points. Cannot remove more.`);
        }
        
        const newTotal = removePoints(target.id, amount);
        message.reply(`Done. Removed ${amount} points from ${target.username}. They now have ${newTotal} points.`);
    }
    
    // SET POINTS (prefix)
    else if (command === 'setpoints') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
        const target = message.mentions.users.first();
        if (!target) {
            return message.reply('Please mention someone. Example: `?setpoints @user 50`');
        }
        
        const amount = parseInt(args[1]);
        if (isNaN(amount) || amount < 0) {
            return message.reply('Please provide a valid amount. Example: `?setpoints @user 50`');
        }
        
        setPoints(target.id, amount);
        message.reply(`Done. Set ${target.username}'s points to ${amount}.`);
    }
    
    // CHECK POINTS (prefix)
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
    
    // LEADERBOARD (prefix)
    else if (command === 'leaderboard' || command === 'lb') {
        const page = parseInt(args[0]) || 1;
        const itemsPerPage = 10;
        const sorted = getAllPoints();
        
        if (sorted.length === 0) {
            return message.reply('No points have been given out yet.');
        }
        
        const start = (page - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const pageItems = sorted.slice(start, end);
        
        if (pageItems.length === 0) {
            return message.reply(`Page ${page} does not exist.`);
        }
        
        let description = '```\n';
        for (let i = 0; i < pageItems.length; i++) {
            const userId = pageItems[i].user_id;
            const points = pageItems[i].points;
            const rank = start + i + 1;
            try {
                const user = await client.users.fetch(userId);
                let name = user.username;
                if (name.length > 20) name = name.substring(0, 17) + '...';
                description += `${rank.toString().padStart(2)}. ${name.padEnd(20)} ${points} points\n`;
            } catch {
                description += `${rank.toString().padStart(2)}. Unknown User${' '.repeat(12)} ${points} points\n`;
            }
        }
        description += '```';
        
        const embed = new EmbedBuilder()
            .setColor(0x2c2c2c)
            .setTitle('Point Leaderboard')
            .setDescription(description)
            .setFooter({ text: `Page ${page} of ${Math.ceil(sorted.length / itemsPerPage)} | Total users: ${sorted.length}` });
        
        message.channel.send({ embeds: [embed] });
    }
    
    // BAN (prefix)
    else if (command === 'ban') {
        if (!isAdmin(message.member)) {
            return message.reply('You need administrator permission for this.');
        }
        
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
        if (!member || !member.bannable) {
            return message.reply('I cannot ban this user. They might have higher permissions than me.');
        }
        
        const reason = args.join(' ') || 'No reason provided';
        
        try {
            await member.ban({ reason: reason });
            message.reply('Done.');
        } catch (error) {
            message.reply('Failed to ban that user. Check my permissions.');
        }
    }
    
    // KICK (prefix)
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
        if (!member || !member.kickable) {
            return message.reply('I cannot kick this user. They might have higher permissions than me.');
        }
        
        const reason = args.join(' ') || 'No reason provided';
        
        try {
            await member.kick(reason);
            message.reply('Done.');
        } catch (error) {
            message.reply('Failed to kick that user. Check my permissions.');
        }
    }
    
    // HELP (prefix)
    else if (command === 'help') {
        const helpText = `
**Bot Commands**

**Point Management (Admin)**
?addpoints @user <amount> - Add points
?removepoints @user <amount> - Remove points
?setpoints @user <amount> - Set exact points

**Point Checking**
?points @user - Check points
?leaderboard - View leaderboard

**Moderation (Admin)**
?ban @user <reason> - Ban a user
?kick @user <reason> - Kick a user

**Tip:** Reply to someones message with ?ban or ?kick to target them.

**Slash commands also available:** /addpoints, /removepoints, /setpoints, /points, /leaderboard, /ban, /kick, /help
        `;
        message.reply(helpText);
    }
});

client.login(TOKEN);
