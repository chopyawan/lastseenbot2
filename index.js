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

db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS last_seen (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        last_seen TEXT,
        timestamp INTEGER
    )
    `);
});

client.once('ready', async () => {
    console.log(`🟢 บอทออนไลน์แล้วในชื่อ: ${client.user.tag}`);
    try {
        for (const guild of client.guilds.cache.values()) {
            await guild.members.fetch();
        }
        console.log('✅ โหลดข้อมูลสมาชิกในเซิร์ฟเวอร์สำเร็จ');
    } catch (error) {
        console.error('❌ ไม่สามารถโหลดข้อมูลสมาชิกได้:', error);
    }
});

// บันทึกสถานะออนไลน์/ออฟไลน์
client.on('presenceUpdate', (oldPresence, newPresence) => {
    const user = newPresence?.user || oldPresence?.user;
    if (!user || user.bot) return;

    const thailandTime = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
    const currentStatus = newPresence?.status || 'offline';

    db.run(
        `INSERT OR REPLACE INTO last_seen (user_id, username, last_seen, timestamp) VALUES (?, ?, ?, ?)`,
        [user.id, user.tag, thailandTime, Date.now()],
        (err) => {
            if (err) console.error('❌ บันทึกฐานข้อมูลผิดพลาด:', err.message);
        }
    );

    console.log(`[Presence] ${user.tag} เปลี่ยนสถานะเป็น -> ${currentStatus}`);
});

// ตรวจจับคำสั่งพิมพ์ข้อความ
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // คำสั่ง !online
    if (message.content === '!online') {
        try {
            // บังคับดึงข้อมูลสมาชิกใหม่เพื่อให้ได้สถานะล่าสุดจริง ๆ
            await message.guild.members.fetch({ withPresences: true });

            const onlineMembers = message.guild.members.cache.filter(
                member => member.presence && member.presence.status !== 'offline' && !member.user.bot
            );

            if (onlineMembers.size === 0) {
                return message.reply('🟢 ไม่มีใครออนไลน์อยู่เลยในขณะนี้');
            }

            let result = '🟢 **รายชื่อคนออนไลน์ตอนนี้**\n\n';
            const membersArray = Array.from(onlineMembers.values());
            let processedCount = 0;

            if (membersArray.length === 0) {
                return message.reply('🟢 ไม่มีใครออนไลน์อยู่เลยในขณะนี้');
            }

            membersArray.forEach(member => {
                db.get(
                    'SELECT last_seen FROM last_seen WHERE user_id = ?',
                    [member.user.id],
                    (err, row) => {
                        const statusEmoji = member.presence.status === 'dnd' ? '🔴' : member.presence.status === 'idle' ? '🟡' : '🟢';
                        result += `${statusEmoji} **${member.user.username}** (${member.presence.status})\n`;
                        
                        if (row && row.last_seen) {
                            result += `⏰ อัปเดตล่าสุด: ${row.last_seen}\n\n`;
                        } else {
                            result += `⏰ อัปเดตล่าสุด: กำลังออนไลน์ตอนนี้ (ยังไม่มีประวัติออฟไลน์)\n\n`;
                        }

                        processedCount++;
                        if (processedCount === membersArray.length) {
                            message.reply(result);
                        }
                    }
                );
            });
        } catch (error) {
            console.error(error);
            message.reply('❌ เกิดข้อผิดพลาดในการดึงข้อมูลคนออนไลน์');
        }
    }

    // คำสั่ง !seenall
    if (message.content === '!seenall') {
        db.all(
            `SELECT * FROM last_seen ORDER BY timestamp DESC LIMIT 15`,
            [],
            (err, rows) => {
                if (err) {
                    console.error(err);
                    return message.reply('❌ เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูล');
                }

                if (!rows || rows.length === 0) {
                    return message.reply('📋 ยังไม่มีประวัติการออนไลน์ในระบบ');
                }

                let text = '📋 **ประวัติการออนไลน์ล่าสุด (เรียงจากล่าสุด)**\n\n';
                rows.forEach((row, index) => {
                    text += `${index + 1}. **${row.username.split('#')[0]}**\n⏰ เวลา: ${row.last_seen}\n\n`;
                });

                message.reply(text);
            }
        );
    }
});

client.login(process.env.TOKEN);