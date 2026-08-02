const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1533233042250928348';
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

let activeConflict = null; // { adminId: str, victimId: str, step: 1|2 }

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

function checkCooldown(userId, commandName, durationMs) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    if (db.cooldowns[key] && now < db.cooldowns[key]) return Math.ceil((db.cooldowns[key] - now) / 1000);
    db.cooldowns[key] = now + durationMs;
    saveData();
    return 0;
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

// --- MESSAGE LISTENER FOR OWNER DECISIONS ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    const isOwner = message.guild.ownerId === message.author.id;
    if (!isOwner || !activeConflict) return;

    const response = message.content.toLowerCase();

    if (activeConflict.step === 1) {
        if (response === 'yes' || response === 'y') {
            activeConflict.step = 2;
            return message.reply("whats this f3cking admin that REMOVED MONEY FROM HIM AFTER I GAVE HIM ADMIN can i kick him? pls?");
        }
    } else if (activeConflict.step === 2) {
        const adminMember = await message.guild.members.fetch(activeConflict.adminId).catch(() => null);
        if (response === 'yes' || response === 'y') {
            if (adminMember) {
                await adminMember.kick("Bot-Protector: Removed money from a temp-admin.").catch(() => message.reply("❌ Hierarchy error, can't kick him!"));
                message.reply(`👢 Done! That bad admin is gone.`);
            }
            activeConflict = null;
        } else if (response === 'no' || response === 'n') {
            message.reply("FAHYOU! :fahyou:");
            db.isEvilMode = true;
            db.evilModeEndTime = Date.now() + 3600000;
            saveData();
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
        if (Date.now() < exp) return await interaction.reply(`👻 Ghosts can't talk! You need someone to /revive you or wait ${Math.ceil((exp - Date.now())/1000)}s.`);
        delete db.deadPlayers[userId]; saveData();
    }

    const whitelist = ['revive', 'buy', 'shop', 'ban', 'kick', 'warn', 'gimme', 'remove'];
    if (!whitelist.includes(interaction.commandName) && interaction.channel.name !== 'bot-commands-fun') {
        return await interaction.reply({ content: '❌ These commands only work in the #bot-commands-fun channel!', ephemeral: true });
    }

    // ================= REMOVE (WITH EASTER EGG) =================
    if (interaction.commandName === 'remove') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        // PROTECTION : If target is a protected human OR the bot itself
        if ((db.tempAdmins[target.id] && Date.now() < db.tempAdmins[target.id]) || target.id === client.user.id) {
            activeConflict = { adminId: userId, victimId: target.id, step: 1 };
            return await interaction.reply(`<@${interaction.guild.ownerId}> !!!!!`);
        }

        const tProf = getProfile(target.id);
        tProf.cash = Math.max(0, tProf.cash - amount);
        saveData();
        await interaction.reply(`💸 Removed **${amount} coins** from ${target}.`);
    }

    // ================= GIVE =================
    if (interaction.commandName === 'give') {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        if (amount <= 0 || profile.cash < amount) return await interaction.reply({ content: "❌ Invalid amount or not enough cash!", ephemeral: true });

        if (target.id === client.user.id) {
            profile.cash -= amount;
            const r = interaction.guild.roles.cache.find(r => r.name === 'Admin');
            if (r) {
                await interaction.member.roles.add(r).catch(() => null);
                db.tempAdmins[userId] = Date.now() + 86400000;
                saveData();
                return await interaction.reply(`Awww Thanks! heres a gift for you too! admin for a whole day!`);
            }
        }
        const t = getProfile(target.id);
        profile.cash -= amount; t.cash += amount; saveData();
        await interaction.reply(`💸 Sent **${amount} coins** to ${target}!`);
    }

    // ================= ADMIN =================
    if (interaction.commandName === 'gimme') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        profile.cash += amount;
        saveData();
        await interaction.reply(`💰 Generated **${amount} coins** for yourself!`);
    }

    // ================= MODERATION =================
    if (interaction.commandName === 'ban') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || "No reason provided.";
        await interaction.guild.members.ban(targetUser, { reason }).catch(() => null);
        await interaction.reply(`🔨 **${targetUser.username}** has been banned. Reason: ${reason}`);
    }

    if (interaction.commandName === 'kick') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || "No reason provided.";
        try {
            const member = await interaction.guild.members.fetch(targetUser.id);
            await member.kick(reason);
            await interaction.reply(`👢 **${targetUser.username}** has been kicked. Reason: ${reason}`);
        } catch (e) { await interaction.reply({ content: "❌ Failed to kick.", ephemeral: true }); }
    }

    if (interaction.commandName === 'warn') {
        if (!isAdmin) return await interaction.reply({ content: "❌ Admin only!", ephemeral: true });
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || "No reason provided.";
        await interaction.reply({ content: `⚠️ **WARNING** to ${targetUser}!\n**Reason:** ${reason}` });
    }

    // ================= BANK =================
    if (interaction.commandName === 'bank') {
        await interaction.reply(`🏦 **${interaction.user.username}'s balance:**\n💵 Cash: \`${profile.cash}\`\n💳 Bank: \`${profile.bank}\``);
    }

    if (interaction.commandName === 'deposit') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.cash >= amt) {
            profile.cash -= amt; profile.bank += amt; saveData();
            await interaction.reply(`📥 Deposited **${amt} coins** into your bank safe!`);
        } else await interaction.reply({ content: "❌ You don't have enough cash!", ephemeral: true });
    }

    if (interaction.commandName === 'withdraw') {
        const amt = interaction.options.getInteger('amount');
        if (amt > 0 && profile.bank >= amt) {
            profile.bank -= amt; profile.cash += amt; saveData();
            await interaction.reply(`🏧 Withdrew **${amt} coins** from your bank!`);
        } else await interaction.reply({ content: "❌ Not enough coins in bank!", ephemeral: true });
    }

    // ================= OTHER =================
    if (interaction.commandName === 'roulette') {
        if (profile.cash < 1) return await interaction.reply("❌ No cash! Go work first.");
        profile.cash--;
        if (Math.random() < 0.5) {
            profile.currentStreak++;
            if (profile.currentStreak > profile.highStreak) profile.highStreak = profile.currentStreak;
            await interaction.reply(`Click. Survived! Streak: ${profile.currentStreak}`);
        } else {
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
        const color = db.isEvilMode ? 0xFF0000 : 0x00AE86;
        const embed = new EmbedBuilder().setTitle(title).setColor(color);
        if (!db.isEvilMode) {
            embed.addFields(
                { name: "🎬 Watch a film", value: "Price: 50 coins\nStarts a Watch Together activity!" },
                { name: "👑 Admin Role", value: "Price: 1000 coins\nGet the @Admin role!" },
                { name: "💀 Crash Bot", value: "Price: 10000 coins\nTurn JurkBot into FahYiu for 1 hour!" }
            );
        } else {
            embed.addFields({ name: "✨ Turn back on JurkBot!", value: "Price: 1000 coins\nEnd the evil form immediately!" });
        }
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'buy') {
        const item = interaction.options.getString('item');
        if (item === 'film') {
            if (db.isEvilMode || profile.cash < 50) return await interaction.reply({ content: "❌ Fail! Not enough cash or bot is evil.", ephemeral: true });
            const voice = interaction.member.voice.channel;
            if (!voice) return await interaction.reply({ content: "❌ Join a Voice Channel first!", ephemeral: true });
            profile.cash -= 50;
            try {
                const invite = await voice.createInvite({ targetApplication: '880218394199220334', targetType: 2, maxAge: 3600, maxUses: 10 });
                await interaction.reply({ content: `🎬 Video: https://youtu.be/dQw4w9WgXcQ \n**Join Activity:** ${invite.url}` });
            } catch (e) { await interaction.reply({ content: "❌ Error creating invite!" }); }
        }
        if (item === 'admin_role') {
            if (db.isEvilMode || profile.cash < 1000) return await interaction.reply({ content: "❌ Fail! Not enough cash or bot is evil.", ephemeral: true });
            const role = interaction.guild.roles.cache.find(r => r.name === 'Admin');
            if (role) {
                await interaction.member.roles.add(role).catch(() => null);
                profile.cash -= 1000;
                await interaction.reply(`👑 ${interaction.user} is now an Admin!`);
            }
        }
        if (item === 'crash_bot') {
            if (db.isEvilMode || profile.cash < 10000) return await interaction.reply({ content: "❌ Fail! Already evil or not enough cash.", ephemeral: true });
            profile.cash -= 10000;
            db.isEvilMode = true;
            db.evilModeEndTime = Date.now() + 3600000;
            await interaction.reply("MUAHAHAHA SOMEONE TURNED OFF ME AND YOU WONT BE ABLE TO TALK FOR AN 1H !\nFah you! :fahyou:\nStop! STFU!");
        }
        if (item === 'turn_on') {
            if (!db.isEvilMode || profile.cash < 1000) return await interaction.reply({ content: "❌ Fail! Bot is normal or not enough cash.", ephemeral: true });
            profile.cash -= 1000;
            db.isEvilMode = false;
            await interaction.reply("✨ am out of my evil form! Thank you for saving me!");
        }
        saveData();
    }

    if (interaction.commandName === 'revive') {
        const target = interaction.options.getUser('user');
        if (target.id === userId && db.deadPlayers[userId]) return await interaction.reply({ content: "❌ You cannot revive yourself, ghost!", ephemeral: true });
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member) {
            if (member.communicationDisabledUntilTimestamp > Date.now()) await member.timeout(null).catch(() => null);
            const r = interaction.guild.roles.cache.find(r => r.name === 'Ghost');
            if (r) await member.roles.remove(r).catch(() => null);
            if (member.nickname && member.nickname.includes('👻')) {
                const cleaned = member.nickname.replace('👻', '').trim();
                await member.setNickname(cleaned === "" ? null : cleaned).catch(() => null);
            }
            delete db.deadPlayers[target.id]; saveData();
            await interaction.reply(`✨ ${target} has been revived!`);
        }
    }

    if (interaction.commandName === 'leaderboard') {
        const sorted = Object.entries(db.economy).sort((a, b) => b[1].highStreak - a[1].highStreak).slice(0, 5);
        const lb = sorted.map(([id, data], i) => `#${i + 1} | <@${id}>: ${data.highStreak} 🏆`).join('\n');
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle("🏆 Russian Roulette Leaderboard").setDescription(lb || "No players yet.")] });
    }
});

http.createServer((req, res) => { res.writeHead(200); res.end('OK'); }).listen(process.env.PORT || 3000);
client.login(TOKEN);
