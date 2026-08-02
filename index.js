const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildWebhooks
    ]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1533233042250928348';
const GEMINI_API_KEY = 'AQ.Ab8RN6JxoQm3zt3ywsmuR4RkizxwSgYFDSOqq3rH1My-1ufX5wAQ.Ab8RN6JxoQm3zt3ywsmuR4RkizxwSgYFDSOqq3rH1My-1ufX5w';
const DB_PATH = path.join(__dirname, 'database.json');

// --- DATABASE & STATE ---
let db = {
    deadPlayers: {},
    economy: {},
    cooldowns: {},
    tempAdmins: {},
    isEvilMode: false,
    evilModeEndTime: 0
};

let activeConflict = null;

function loadData() {
    if (fs.existsSync(DB_PATH)) {
        try {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            db = { ...db, ...JSON.parse(data) };
        } catch (e) { console.error(e); }
    }
}

function saveData() {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 4), 'utf8'); } catch (e) { console.error(e); }
}

loadData();

function getProfile(userId) {
    if (!db.economy[userId]) {
        db.economy[userId] = { cash: 0, bank: 0, currentStreak: 0, highStreak: 0 };
        saveData();
    }
    return db.economy[userId];
}

const commands = [
    new SlashCommandBuilder().setName('roulette').setDescription('Play Russian Roulette!'),
    new SlashCommandBuilder().setName('daily').setDescription('Claim 10 coins!'),
    new SlashCommandBuilder().setName('work').setDescription('Work for 50 coins!'),
    new SlashCommandBuilder().setName('bank').setDescription('Check balance.'),
    new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins.').addIntegerOption(o => o.setName('amount').setDescription('Amount of coins to deposit').setRequired(true)),
    new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw coins.').addIntegerOption(o => o.setName('amount').setDescription('Amount of coins to withdraw').setRequired(true)),
    new SlashCommandBuilder().setName('give').setDescription('Send coins.').addUserOption(o => o.setName('user').setDescription('User to give coins to').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Amount of coins').setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('View shop.'),
    new SlashCommandBuilder().setName('buy').setDescription('Buy items.').addStringOption(o => o.setName('item').setDescription('Item to buy').setRequired(true).addChoices(
        { name: 'Watch a film (50 coins)', value: 'film' },
        { name: 'Admin Role (1000 coins)', value: 'admin_role' },
        { name: 'Crash Bot (10000 coins)', value: 'crash_bot' },
        { name: 'Turn back on JurkBot! (1000 coins)', value: 'turn_on' }
    )),
    new SlashCommandBuilder().setName('revive').setDescription('Revive a ghost.').addUserOption(o => o.setName('user').setDescription('User to revive').setRequired(true)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Streaks leaderboard.'),
    new SlashCommandBuilder().setName('takecontrol').setDescription('Send a command as another user (Admin only)')
        .addUserOption(o => o.setName('user').setDescription('User to control').setRequired(true))
        .addStringOption(o => o.setName('command').setDescription('Command or text to execute').setRequired(true)),
    new SlashCommandBuilder().setName('mimick').setDescription('Send a message as another user (Admin only)')
        .addUserOption(o => o.setName('user').setDescription('User to mimick').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a user (Admin only)').addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for ban')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick a user (Admin only)').addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for kick')),
    new SlashCommandBuilder().setName('warn').setDescription('Warn a user (Admin only)').addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('Reason for warning')),
    new SlashCommandBuilder().setName('gimme').setDescription('Give yourself coins (Admin only)').addIntegerOption(o => o.setName('amount').setDescription('Amount to generate').setRequired(true)),
    new SlashCommandBuilder().setName('remove').setDescription('Remove coins from a user (Admin only)').addUserOption(o => o.setName('user').setDescription('User target').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Amount to remove').setRequired(true))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} online!`);
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } catch (e) { console.error(e); }
    setInterval(async () => {
        const now = Date.now();
        for (const [uId, exp] of Object.entries(db.tempAdmins)) {
            if (now > exp) {
                const guild = client.guilds.cache.first();
                if (guild) {
                    const m = await guild.members.fetch(uId).catch(() => null);
                    const r = guild.roles.cache.find(r => r.name === 'Admin');
                    if (m && r) await m.roles.remove(r).catch(() => null);
                }
                delete db.tempAdmins[uId]; saveData();
            }
        }
    }, 60000);
});

async function getGeminiResponse(prompt) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.candidates && response.candidates.length > 0) {
                        resolve(response.candidates[0].content.parts[0].text);
                    } else {
                        resolve("❌ Gemini Error: " + (response.error ? response.error.message : "Empty response"));
                    }
                } catch (e) { reject(e); }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(data);
        req.end();
    });
}

async function sendAsUser(interaction, user, content) {
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const channel = interaction.channel;
    let webhook = (await channel.fetchWebhooks()).find(wh => wh.name === "JurkBot-Troll");
    if (!webhook) {
        webhook = await channel.createWebhook({ name: "JurkBot-Troll", avatar: client.user.displayAvatarURL() });
    }
    await webhook.send({ content: content, username: member ? member.displayName : user.username, avatarURL: user.displayAvatarURL() });
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.name === 'chatgptmode' && message.mentions.has(client.user)) {
        const prompt = message.content.replace(/<@!?[0-9]+>/g, '').trim();
        if (!prompt) return message.reply("Please provide a message!");
        await message.channel.sendTyping();
        try {
            const response = await getGeminiResponse(prompt);
            return message.reply(response);
        } catch (e) { console.error(e); return message.reply("❌ Failed to contact Gemini."); }
    }

    const isOwner = message.guild.ownerId === message.author.id;
    if (isOwner && activeConflict) {
        const res = message.content.toLowerCase();
        if (activeConflict.step === 1 && (res === 'yes' || res === 'y')) {
            activeConflict.step = 2;
            return message.reply("whats this f3cking admin that REMOVED MONEY FROM HIM AFTER I GAVE HIM ADMIN can i kick him? pls?");
        } else if (activeConflict.step === 2) {
            if (res === 'yes' || res === 'y') {
                const admin = await message.guild.members.fetch(activeConflict.adminId).catch(() => null);
                if (admin) await admin.kick("Bot-Protector").catch(() => null);
                message.reply("👢 Done!");
            } else if (res === 'no' || res === 'n') {
                message.reply("FAHYOU! :fahyou:");
                db.isEvilMode = true; db.evilModeEndTime = Date.now() + 3600000; saveData();
            }
            activeConflict = null;
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const userId = interaction.user.id;
    const profile = getProfile(userId);
    const isOwner = interaction.guild.ownerId === userId;
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || isOwner;

    if (db.isEvilMode && Date.now() > db.evilModeEndTime) {
        db.isEvilMode = false; saveData();
        await interaction.channel.send("✨ am out of my evil form! JurkBot is back to normal.");
    }
    if (db.isEvilMode && !['shop', 'buy'].includes(interaction.commandName)) {
        return await interaction.reply("MUAHAHAHA SOMEONE TURNED OFF ME AND YOU WONT BE ABLE TO TALK FOR AN 1H !\nFah you! :fahyou:\nStop! STFU!");
    }
    if (db.deadPlayers[userId] && interaction.commandName !== 'revive') {
        const exp = db.deadPlayers[userId];
        if (Date.now() < exp) return await interaction.reply(`👻 Ghosts can't talk! Wait ${Math.ceil((exp - Date.now())/1000)}s.`);
        delete db.deadPlayers[userId]; saveData();
    }

    const whitelist = ['revive', 'buy', 'shop', 'ban', 'kick', 'warn', 'gimme', 'remove', 'takecontrol', 'mimick'];
    if (!whitelist.includes(interaction.commandName) && interaction.channel.name !== 'bot-commands-fun') {
        return await interaction.reply({ content: '❌ Use #bot-commands-fun!', ephemeral: true });
    }

    if (interaction.commandName === 'mimick') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const target = interaction.options.getUser('user');
        const msg = interaction.options.getString('message');
        await interaction.reply({ content: "😈 Mimicking...", ephemeral: true });
        await sendAsUser(interaction, target, msg);
    }
    if (interaction.commandName === 'takecontrol') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const target = interaction.options.getUser('user');
        const cmd = interaction.options.getString('command');
        await interaction.reply({ content: `😈 Taking control...`, ephemeral: true });
        await sendAsUser(interaction, target, cmd);
        if (cmd.includes('/bank')) {
            const tProf = getProfile(target.id);
            return interaction.channel.send(`🏦 **${target.username}'s balance:**\n💵 Cash: \`${tProf.cash}\`\n💳 Bank: \`${tProf.bank}\``);
        }
    }
    if (interaction.commandName === 'remove') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if ((db.tempAdmins[target.id] && Date.now() < db.tempAdmins[target.id]) || target.id === client.user.id) {
            activeConflict = { adminId: userId, victimId: target.id, step: 1 };
            return await interaction.reply(`<@${interaction.guild.ownerId}> !!!!!`);
        }
        const tProf = getProfile(target.id);
        tProf.cash = Math.max(0, tProf.cash - amount); saveData();
        await interaction.reply(`💸 Removed **${amount} coins** from ${target}.`);
    }
    if (interaction.commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (amount <= 0 || profile.cash < amount) return await interaction.reply("❌ Invalid amount!");
        if (target.id === client.user.id) {
            profile.cash -= amount;
            const r = interaction.guild.roles.cache.find(r => r.name === 'Admin');
            if (r) {
                await interaction.member.roles.add(r).catch(() => null);
                db.tempAdmins[userId] = Date.now() + 86400000; saveData();
                return await interaction.reply(`Awww Thanks! heres a gift for you too! admin for a whole day!`);
            }
        }
        const t = getProfile(target.id);
        profile.cash -= amount; t.cash += amount; saveData();
        await interaction.reply(`💸 Sent **${amount} coins** to ${target}!`);
    }
    if (interaction.commandName === 'gimme') {
        if (!isAdmin) return await interaction.reply("❌ Admin only!");
        const amt = interaction.options.getInteger('amount');
        profile.cash += amt; saveData(); await interaction.reply(`💰 Generated **${amt} coins**!`);
    }
    if (interaction.commandName === 'bank') {
        await interaction.reply(`🏦 **${interaction.user.username}'s balance:**\n💵 Cash: \`${profile.cash}\`\n💳 Bank: \`${profile.bank}\``);
    }
    if (interaction.commandName === 'deposit') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.cash >= amt) { profile.cash -= amt; profile.bank += amt; saveData(); await interaction.reply(`📥 Deposited ${amt} coins!`); }
        else await interaction.reply({ content: "❌ Not enough cash!", ephemeral: true });
    }
    if (interaction.commandName === 'withdraw') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.bank >= amt) { profile.bank -= amt; profile.cash += amt; saveData(); await interaction.reply(`🏧 Withdrew ${amt} coins!`); }
        else await interaction.reply({ content: "❌ Bank empty!", ephemeral: true });
    }
    if (interaction.commandName === 'roulette') {
        if (profile.cash < 1) return await interaction.reply("❌ No cash!");
        profile.cash--;
        if (Math.random() < 0.5) { profile.currentStreak++; if (profile.currentStreak > profile.highStreak) profile.highStreak = profile.currentStreak; await interaction.reply(`Click. Survived! Streak: ${profile.currentStreak}`); }
        else {
            db.deadPlayers[userId] = Date.now() + 600000;
            await interaction.reply(`**BANG!** ${interaction.user} died and is now a ghost! 👻`);
            try {
                const r = interaction.guild.roles.cache.find(r => r.name === 'Ghost');
                if (r) await interaction.member.roles.add(r).catch(() => null);
                await interaction.member.setNickname(`👻 ${interaction.member.nickname || interaction.user.username}`).catch(() => null);
            } catch (e) {}
        }
        saveData();
    }
    if (interaction.commandName === 'shop') {
        const title = db.isEvilMode ? "🛒 FahYiu Shop" : "🛒 JurkBot Shop";
        const embed = new EmbedBuilder().setTitle(title).setColor(db.isEvilMode ? 0xFF0000 : 0x00AE86);
        if (!db.isEvilMode) embed.addFields({ name: "🎬 Film", value: "50" }, { name: "👑 Admin", value: "1000" }, { name: "💀 Crash", value: "10000" });
        else embed.addFields({ name: "✨ Restore", value: "1000" });
        await interaction.reply({ embeds: [embed] });
    }
    if (interaction.commandName === 'buy') {
        const item = interaction.options.getString('item');
        if (item === 'crash_bot' && profile.cash >= 10000) { profile.cash -= 10000; db.isEvilMode = true; db.evilModeEndTime = Date.now() + 3600000; saveData(); await interaction.reply("MUAHAHAHA!"); }
        if (item === 'turn_on' && db.isEvilMode && profile.cash >= 1000) { profile.cash -= 1000; db.isEvilMode = false; saveData(); await interaction.reply("✨ I'm back!"); }
        if (item === 'film' && !db.isEvilMode && profile.cash >= 50) {
            const v = interaction.member.voice.channel;
            if (v) {
                profile.cash -= 50; const inv = await v.createInvite({ targetApplication: '880218394199220334', targetType: 2 });
                await interaction.reply({ content: `🎬 Video: https://youtu.be/dQw4w9WgXcQ \nInvite: ${inv.url}` });
            } else await interaction.reply({ content: "❌ Join voice!", ephemeral: true });
        }
        if (item === 'admin_role' && !db.isEvilMode && profile.cash >= 1000) {
            const r = interaction.guild.roles.cache.find(r => r.name === 'Admin');
            if (r) { await interaction.member.roles.add(r).catch(() => null); profile.cash -= 1000; await interaction.reply(`👑 Admin role given!`); }
        }
        saveData();
    }
    if (interaction.commandName === 'revive') {
        const target = interaction.options.getUser('user');
        if (target.id === userId && db.deadPlayers[userId]) return await interaction.reply({ content: "❌ Cannot self-revive!", ephemeral: true });
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member) {
            const r = interaction.guild.roles.cache.find(r => r.name === 'Ghost');
            if (r) await member.roles.remove(r).catch(() => null);
            if (member.nickname && member.nickname.includes('👻')) await member.setNickname(member.nickname.replace('👻', '').trim()).catch(() => null);
            delete db.deadPlayers[target.id]; saveData();
            await interaction.reply(`✨ ${target} has been revived!`);
        }
    }
});

http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
client.login(TOKEN);
