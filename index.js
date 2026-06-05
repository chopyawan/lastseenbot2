const { Client, GatewayIntentBits } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const db = new sqlite3.Database('./seen.db');

db.run(`
CREATE TABLE IF NOT EXISTS last_seen (
    user_id TEXT PRIMARY KEY,
    username TEXT,
    last_seen TEXT,
    timestamp INTEGER
)
`);

client.once('ready', async () => {

    console.log(`Logged in as ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
        await guild.members.fetch();
    }

    console.log('Members Cached');
});

// บันทึกทุกครั้งที่มีการเปลี่ยนสถานะ
client.on('presenceUpdate', (oldPresence, newPresence) => {

    const user =
        newPresence?.user ||
        oldPresence?.user;

    if (!user) return;

    db.run(
        `INSERT OR REPLACE INTO last_seen
        (user_id, username, last_seen, timestamp)
        VALUES (?, ?, ?, ?)`,
        [
            user.id,
            user.tag,
            new Date().toLocaleString('th-TH'),
            Date.now()
        ]
    );

    console.log(
        `${user.tag} -> ${newPresence?.status || 'offline'}`
    );
});

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    // ==========================
    // !online
    // ==========================
    if (message.content === '!online') {

        const onlineMembers =
            message.guild.members.cache.filter(
                member =>
                    member.presence &&
                    member.presence.status !== 'offline'
            );

        if (onlineMembers.size === 0) {
            return message.reply(
                'ไม่พบข้อมูลคนออนไลน์'
            );
        }

        let result = '🟢 ออนไลน์ตอนนี้\n\n';

        const members =
            Array.from(onlineMembers.values());

        let completed = 0;

        members.forEach(member => {

            db.get(
                'SELECT * FROM last_seen WHERE user_id = ?',
                [member.user.id],
                (err, row) => {

                    result +=
                        `${member.user.tag} (${member.presence.status})\n`;

                    if (row) {
                        result +=
                            `⏰ ล่าสุด ${row.last_seen}\n\n`;
                    } else {
                        result +=
                            `⏰ ไม่มีข้อมูล\n\n`;
                    }

                    completed++;

                    if (completed === members.length) {
                        message.reply(result);
                    }
                }
            );
        });
    }

    // ==========================
    // !seenall
    // ==========================
    if (message.content === '!seenall') {

        db.all(
            `SELECT *
             FROM last_seen
             ORDER BY timestamp DESC
             LIMIT 50`,
            [],
            (err, rows) => {

                if (!rows || rows.length === 0) {
                    return message.reply(
                        'ยังไม่มีข้อมูล'
                    );
                }

                let text =
                    '📋 ออนไลน์ล่าสุด\n\n';

                rows.forEach((row, index) => {

                    text +=
                        `${index + 1}. ${row.username}\n`;

                    text +=
                        `⏰ ${row.last_seen}\n\n`;
                });

                message.reply(text);
            }
        );
    }
});

client.login(process.env.TOKEN);