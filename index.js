require('dotenv').config(); // อ่านไฟล์ .env ได้ถูกต้อง
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
        timestamp INTEGER,
        online_since INTEGER
    )
    `);

    // Migration: เพิ่มคอลัมน์ online_since ให้ DB เก่าที่มีอยู่แล้ว
    db.run(`ALTER TABLE last_seen ADD COLUMN online_since INTEGER`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Migration error:', err.message);
        }
    });
});

// ฟังก์ชันแปลงมิลลิวินาที → "X ชั่วโมง Y นาที"
function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return 'ไม่ถึง 1 นาที';
    if (totalMinutes < 60) return `${totalMinutes} นาที`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours} ชั่วโมง ${minutes} นาที` : `${hours} ชั่วโมง`;
}

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
    const oldStatus = oldPresence?.status || 'offline';
    const now = Date.now();

    // ถ้าเพิ่งเปลี่ยนจาก offline มาเป็น online/idle/dnd = เริ่มออนไลน์ใหม่ → รีเซ็ต online_since
    const justCameOnline =
        (oldStatus === 'offline' || !oldPresence) &&
        (currentStatus !== 'offline');

    if (justCameOnline) {
        db.run(
            `INSERT OR REPLACE INTO last_seen (user_id, username, last_seen, timestamp, online_since)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, user.tag, thailandTime, now, now],
            (err) => {
                if (err) console.error('❌ บันทึกฐานข้อมูลผิดพลาด:', err.message);
            }
        );
    } else {
        // อัปเดต last_seen/timestamp ตามปกติ โดยไม่แตะ online_since
        db.run(
            `INSERT INTO last_seen (user_id, username, last_seen, timestamp, online_since)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
                username = excluded.username,
                last_seen = excluded.last_seen,
                timestamp = excluded.timestamp`,
            [user.id, user.tag, thailandTime, now, now],
            (err) => {
                if (err) console.error('❌ บันทึกฐานข้อมูลผิดพลาด:', err.message);
            }
        );
    }

    console.log(`[Presence] ${user.tag}: ${oldStatus} -> ${currentStatus}`);
});

// ฟังก์ชันครอบ db.get เพื่อให้ใช้ async/await
const dbGetAsync = (query, params) => {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // คำสั่ง !online
    if (message.content === '!online') {
        try {
            await message.guild.members.fetch({ withPresences: true });

            const onlineMembers = message.guild.members.cache.filter(
                member => member.presence && member.presence.status !== 'offline' && !member.user.bot
            );

            if (onlineMembers.size === 0) {
                return message.reply('🟢 ไม่มีใครออนไลน์อยู่เลยในขณะนี้');
            }

            let result = '🟢 **รายชื่อคนออนไลน์ตอนนี้**\n\n';
            const membersArray = Array.from(onlineMembers.values());

            for (const member of membersArray) {
                try {
                    const row = await dbGetAsync(
                        'SELECT last_seen, online_since FROM last_seen WHERE user_id = ?',
                        [member.user.id]
                    );

                    const statusEmoji = member.presence.status === 'dnd' ? '🔴'
                        : member.presence.status === 'idle' ? '🟡' : '🟢';

                    let memberText = `${statusEmoji} **${member.user.username}** (${member.presence.status})\n`;

                    if (row?.online_since) {
                        const duration = formatDuration(Date.now() - row.online_since);
                        memberText += `⏱️ ออนไลน์มาแล้ว: ${duration}\n`;
                    } else {
                        memberText += `⏱️ ออนไลน์มาแล้ว: ไม่ทราบ (ยังไม่มีประวัติ)\n`;
                    }

                    if (row?.last_seen) {
                        memberText += `⏰ อัปเดตล่าสุด: ${row.last_seen}\n\n`;
                    } else {
                        memberText += `⏰ อัปเดตล่าสุด: กำลังออนไลน์อยู่\n\n`;
                    }

                    if ((result + memberText).length > 1900) {
                        await message.reply(result);
                        result = '';
                    }

                    result += memberText;
                } catch (dbErr) {
                    console.error('Database fetch error:', dbErr);
                }
            }

            if (result.length > 0) {
                await message.reply(result);
            }

        } catch (error) {
            console.error(error);
            message.reply('❌ เกิดข้อผิดพลาดในการดึงข้อมูลคนออนไลน์');
        }
    }

    // คำสั่ง !seenall (เวอร์ชันปรับปรุงตรรกะเวลาของคนออฟไลน์)
    if (message.content === '!seenall') {
        try {
            await message.guild.members.fetch({ withPresences: true });

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

                    let text = '📋 **รายชื่อคนออนไลน์ล่าสุด**\n\n';

                    rows.forEach((row) => {
                        const member = message.guild.members.cache.get(row.user_id);
                        const currentStatus = member?.presence?.status || 'offline';

                        let statusEmoji = '⚫';
                        let statusText = 'offline';

                        if (currentStatus === 'online') {
                            statusEmoji = '🟢';
                            statusText = 'online';
                        } else if (currentStatus === 'idle') {
                            statusEmoji = '🟡';
                            statusText = 'idle';
                        } else if (currentStatus === 'dnd') {
                            statusEmoji = '🔴';
                            statusText = 'dnd';
                        }

                        const usernameOnly = row.username ? row.username.split('#')[0] : 'ไม่ทราบชื่อ';

                        text += `${statusEmoji} **${usernameOnly}** (${statusText})\n`;
                        text += `⏱️ ออนไลน์ล่าสุดเมื่อ: ${row.last_seen}\n`;

                        // ✅ แก้ไขตรรกะตรงนี้ตามที่คุณต้องการเป๊ะ ๆ
                        let durationText = '';
                        if (currentStatus === 'offline') {
                            // ถ้าออฟไลน์อยู่ ให้เอา (เวลาตอนกดปิดดิส) ลบด้วย (เวลาตอนเริ่มเปิดดิส) = ระยะเวลาที่ออนล่าสุด
                            if (row.timestamp && row.online_since && row.timestamp > row.online_since) {
                                durationText = formatDuration(row.timestamp - row.online_since);
                            } else {
                                durationText = 'ไม่ทราบ (ไม่มีบันทึกช่วงเริ่มต้น)';
                            }
                        } else {
                            // ถ้ายังออนไลน์อยู่ ให้เอา เวลาปัจจุบัน ลบด้วย เวลาตอนเริ่มเปิดดิส
                            durationText = formatDuration(Date.now() - (row.online_since || row.timestamp));
                        }

                        text += `⏰ เวลาออนไลน์: ${durationText}\n\n`;
                    });

                    if (text.length > 2000) {
                        text = text.substring(0, 1950) + '\n...และอื่น ๆ';
                    }

                    message.reply(text);
                }
            );
        } catch (error) {
            console.error(error);
            message.reply('❌ เกิดข้อผิดพลาดในการดึงข้อมูลประวัติ');
        }
    }
});

client.login(process.env.TOKEN);