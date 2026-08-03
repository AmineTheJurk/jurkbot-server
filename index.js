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
const GEMINI_API_KEY = 'AQ.Ab8RN6Lv2LoVHilSo77uA0V5MP_QYP5ce7eD5QoFobNz_hbM5A';
const DB_PATH = path.join(__dirname, 'database.json');

let db = { deadPlayers: {}, economy: {}, cooldowns: {}, tempAdmins: {}, isEvilMode: false, evilModeEndTime: 0 };
let activeConflict = null;

function loadData() {
    if (fs.existsSync(DB_PATH)) {
        try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) }; } catch (e) { console.error(e); }
    }
}
function saveData() {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 4), 'utf8'); } catch (e) { console.error(e); }
}
loadData();

function getProfile(userId) {
    if (!db.economy[userId]) db.economy[userId] = { cash: 0, bank: 0, currentStreak: 0, highStreak: 0 };
    return db.economy[userId];
}

const commands = [
    new SlashCommandBuilder().setName('roulette').setDescription('Play Russian Roulette!'),
    new SlashCommandBuilder().setName('daily').setDescription('Claim 10 coins!'),
    new SlashCommandBuilder().setName('work').setDescription('Work for 50 coins!'),
    new SlashCommandBuilder().setName('bank').setDescription('Check balance.'),
    new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins.').addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
    new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw coins.').addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
    new SlashCommandBuilder().setName('give').setDescription('Send coins.').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('View shop.'),
    new SlashCommandBuilder().setName('buy').setDescription('Buy items.').addStringOption(o => o.setName('item').setDescription('Item').setRequired(true).addChoices(
        { name: 'Watch a film (50 coins)', value: 'film' },
        { name: 'Admin Role (1000 coins)', value: 'admin_role' },
        { name: 'Crash Bot (10000 coins)', value: 'crash_bot' },
        { name: 'Turn back on JurkBot! (1000 coins)', value: 'turn_on' }
    )),
    new SlashCommandBuilder().setName('revive').setDescription('Revive a ghost.').addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Streaks.'),
    new SlashCommandBuilder().setName('takecontrol').setDescription('Control user (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('command').setRequired(true)),
    new SlashCommandBuilder().setName('mimick').setDescription('Mimick user (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('message').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('warn').setDescription('Warn (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('gimme').setDescription('Gimme coins (Admin only)').addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder().setName('remove').setDescription('Remove coins (Admin only)').addUserOption(o => o.setName('user').setRequired(true)).addIntegerOption(o => o.setName('amount').setRequired(true))
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
    return new Promise((resolve) => {
        const data = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
        const options = { hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`, method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const req = https.request(options, (res) => {
            let body = ''; res.on('data', (d) => body += d);
            res.on('end', () => { try { const r = JSON.parse(body); resolve(r.candidates[0].content.parts[0].text); } catch (e) { resolve("❌ Gemini Error"); } });
        });
        req.on('error', () => resolve("❌ Network Error")); req.write(data); req.end();
    });
}

async function sendAsUser(interaction, user, content) {
    const channel = interaction.channel;
    let wh = (await channel.fetchWebhooks()).find(w => w.name === "JurkBot-Troll");
    if (!wh) wh = await channel.createWebhook({ name: "JurkBot-Troll" });
    await wh.send({ content: content, username: user.username, avatarURL: user.displayAvatarURL() });
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (message.channel.name === 'chatgptmode' && message.mentions.has(client.user)) {
        await message.channel.sendTyping();
        const r = await getGeminiResponse(message.content.replace(/<@!?[0-9]+>/g, '').trim());
        return message.reply(r);
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

    if (db.isEvilMode && Date.now() > db.evilModeEndTime) { db.isEvilMode = false; saveData(); }
    if (db.isEvilMode && !['shop', 'buy'].includes(interaction.commandName)) {
        return await interaction.reply("MUAHAHAHA SOMEONE TURNED OFF ME! :fahyou:");
    }
    if (db.deadPlayers[userId] && interaction.commandName !== 'revive') {
        const exp = db.deadPlayers[userId];
        if (Date.now() < exp) return await interaction.reply(`👻 Ghosts can't talk! Wait ${Math.ceil((exp - Date.now())/1000)}s.`);
        delete db.deadPlayers[userId]; saveData();
    }

    if (interaction.commandName === 'mimick' && isAdmin) {
        await sendAsUser(interaction, interaction.options.getUser('user'), interaction.options.getString('message'));
        return await interaction.reply({ content: "😈 Mimicked!", ephemeral: true });
    }
    if (interaction.commandName === 'takecontrol' && isAdmin) {
        const target = interaction.options.getUser('user');
        const cmd = interaction.options.getString('command');
        await sendAsUser(interaction, target, cmd);
        if (cmd.includes('/bank')) {
            const p = getProfile(target.id);
            return await interaction.channel.send(`🏦 **${target.username}'s balance:**\nCash: ${p.cash}\nBank: ${p.bank}`);
        }
        return await interaction.reply({ content: "😈 Controlled!", ephemeral: true });
    }
    if (interaction.commandName === 'bank') {
        return await interaction.reply(`🏦 **${interaction.user.username}'s balance:**\nCash: ${profile.cash}\nBank: ${profile.bank}`);
    }
    if (interaction.commandName === 'roulette') {
        if (profile.cash < 1) return await interaction.reply("❌ No cash!");
        profile.cash--;
        if (Math.random() < 0.5) {
            profile.currentStreak++; if (profile.currentStreak > profile.highStreak) profile.highStreak = profile.currentStreak;
            await interaction.reply(`Click. Survived! Streak: ${profile.currentStreak}`);
        } else {
            db.deadPlayers[userId] = Date.now() + 600000;
            await interaction.reply(`**BANG!** ${interaction.user} died and is now a ghost! 👻`);
            try {
                const r = interaction.guild.roles.cache.find(role => role.name === 'Ghost');
                if (r) await interaction.member.roles.add(r).catch(() => null);
                await interaction.member.setNickname(`👻 ${interaction.member.nickname || interaction.user.username}`).catch(() => null);
            } catch (e) {}
        }
    }
    if (interaction.commandName === 'daily') {
        const key = `${userId}-daily`;
        if (db.cooldowns[key] && Date.now() < db.cooldowns[key]) return await interaction.reply("⏳ Cooldown!");
        profile.cash += 10; db.cooldowns[key] = Date.now() + 14400000;
        await interaction.reply("💰 Generated 10 coins!");
    }
    if (interaction.commandName === 'work') {
        const key = `${userId}-work`;
        if (db.cooldowns[key] && Date.now() < db.cooldowns[key]) return await interaction.reply("⏳ Tired!");
        profile.cash += 50; db.cooldowns[key] = Date.now() + 600000;
        await interaction.reply("⚒️ Generated 50 coins!");
    }
    if (interaction.commandName === 'gimme' && isAdmin) {
        const amt = interaction.options.getInteger('amount');
        profile.cash += amt; await interaction.reply(`💰 Generated ${amt} coins!`);
    }
    if (interaction.commandName === 'remove' && isAdmin) {
        const target = interaction.options.getUser('user');
        if (db.tempAdmins[target.id] || target.id === client.user.id) {
            activeConflict = { adminId: userId, victimId: target.id, step: 1 };
            return await interaction.reply(`<@${interaction.guild.ownerId}> !!!!!`);
        }
        const amt = interaction.options.getInteger('amount');
        const p = getProfile(target.id); p.cash = Math.max(0, p.cash - amt);
        await interaction.reply(`💸 Removed ${amt} coins from ${target.username}.`);
    }
    if (interaction.commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amt = interaction.options.getInteger('amount');
        if (amt <= 0 || profile.cash < amt) return await interaction.reply("❌ Fail!");
        if (target.id === client.user.id) {
            profile.cash -= amt;
            const r = interaction.guild.roles.cache.find(role => role.name === 'Admin');
            if (r) { await interaction.member.roles.add(r).catch(() => null); db.tempAdmins[userId] = Date.now() + 86400000; }
            return await interaction.reply("Awww Thanks! heres a gift for you too! admin for a whole day!");
        }
        profile.cash -= amt; getProfile(target.id).cash += amt;
        await interaction.reply(`💸 Sent ${amt} coins to ${target.username}!`);
    }
    if (interaction.commandName === 'deposit') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.cash >= amt) { profile.cash -= amt; profile.bank += amt; await interaction.reply(`📥 Deposited ${amt} coins!`); }
        else await interaction.reply("❌ No money!");
    }
    if (interaction.commandName === 'withdraw') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.bank >= amt) { profile.bank -= amt; profile.cash += amt; await interaction.reply(`🏧 Withdrew ${amt} coins!`); }
        else await interaction.reply("❌ Bank empty!");
    }
    if (interaction.commandName === 'shop') {
        const title = db.isEvilMode ? "🛒 FahYiu Shop" : "🛒 JurkBot Shop";
        const embed = new EmbedBuilder().setTitle(title).setColor(db.isEvilMode ? 0xFF0000 : 0x00AE86);
        if (!db.isEvilMode) embed.addFields({ name: "🎬 Film", value: "50" }, { name: "👑 Admin", value: "1000" }, { name: "💀 Crash", value: "10000" });
        else embed.addFields({ name: "✨ Restore", value: "1000" });
        return await interaction.reply({ embeds: [embed] });
    }
    if (interaction.commandName === 'buy') {
        const item = interaction.options.getString('item');
        if (item === 'crash_bot' && profile.cash >= 10000) { profile.cash -= 10000; db.isEvilMode = true; db.evilModeEndTime = Date.now() + 3600000; await interaction.reply("MUAHAHAHA!"); }
        else if (item === 'turn_on' && db.isEvilMode && profile.cash >= 1000) { profile.cash -= 1000; db.isEvilMode = false; await interaction.reply("✨ I'm back!"); }
        else if (item === 'film' && profile.cash >= 50) {
            const v = interaction.member.voice.channel;
            if (v) { profile.cash -= 50; const inv = await v.createInvite({ targetApplication: '880218394199220334', targetType: 2 }); await interaction.reply(`🎬 ${inv.url}`); }
            else await interaction.reply("❌ Join voice!");
        }
        else if (item === 'admin_role' && profile.cash >= 1000) {
            const r = interaction.guild.roles.cache.find(role => role.name === 'Admin');
            if (r) { await interaction.member.roles.add(r).catch(() => null); profile.cash -= 1000; await interaction.reply("👑 Admin role given!"); }
        }
        else await interaction.reply("❌ Cannot buy!");
    }
    if (interaction.commandName === 'revive') {
        const target = interaction.options.getUser('user');
        if (target.id === userId && db.deadPlayers[userId]) return await interaction.reply("❌ No self-revive!");
        delete db.deadPlayers[target.id];
        const m = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (m) {
            const r = interaction.guild.roles.cache.find(role => role.name === 'Ghost');
            if (r) await m.roles.remove(r).catch(() => null);
            if (m.nickname && m.nickname.includes('👻')) await m.setNickname(m.nickname.replace('👻', '').trim()).catch(() => null);
        }
        await interaction.reply(`✨ ${target.username} Revived!`);
    }
    if (interaction.commandName === 'leaderboard') {
        const sorted = Object.entries(db.economy).sort((a, b) => b[1].highStreak - a[1].highStreak).slice(0, 5);
        const lb = sorted.map(([id, data], i) => `#${i + 1} | <@${id}>: ${data.highStreak} 🏆`).join('\n');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle("🏆 Leaderboard").setDescription(lb || "None")] });
    }
    saveData();
});

http.createServer((q, r) => { r.writeHead(200); r.end('OK'); }).listen(process.env.PORT || 3000);
client.login(TOKEN);
