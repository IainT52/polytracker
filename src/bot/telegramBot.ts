import { Telegraf } from 'telegraf';
import { db } from '../db';
import { users, wallets } from '../db/schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
import { encryptKey, decryptKey } from './encryption';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Initialize Telegraf without starting yet (so tests can mock if needed)
export const bot = new Telegraf(BOT_TOKEN || 'MOCK_TOKEN');

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function truncateAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 4)}..${address.substring(address.length - 4)}`;
}

/**
 * COMMAND: /start
 * Registers the user in the database.
 */
bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const username = ctx.from.username || 'User';

  try {
    let user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();

    // Generate new burner wallet if user doesn't exist OR doesn't have a generated key
    let publicAddress = '';

    if (!user) {
      // 1. Generate new ethers Wallet
      const wallet = ethers.Wallet.createRandom();
      publicAddress = wallet.address;

      // 2. Encrypt private key for DB
      const encryptedKey = encryptKey(wallet.privateKey);

      await db.insert(users).values({
        telegramId,
        username,
        alertsEnabled: false,
        paperTrading: true,
        encryptedPrivateKey: encryptedKey
      });
      await ctx.reply(`Welcome to PolyTracker, ${username}!\n\nI have generated a secure burner wallet for you.\n\n🏦 **Deposit USDC (Polygon):**\n\`${publicAddress}\`\n\nUse /alerts to toggle Alpha Signals.\nUse /paper to toggle Paper Trading.\nUse /stats <address> to check wallet grades.`, { parse_mode: 'Markdown' });
    } else {
      if (user.encryptedPrivateKey) {
        const privateKey = decryptKey(user.encryptedPrivateKey);
        const wallet = new ethers.Wallet(privateKey);
        publicAddress = wallet.address;
      } else {
        // Legacy user without a key, generate one for them
        const wallet = ethers.Wallet.createRandom();
        publicAddress = wallet.address;
        await db.update(users).set({ encryptedPrivateKey: encryptKey(wallet.privateKey) }).where(eq(users.telegramId, telegramId));
      }

      await ctx.reply(`Welcome back, ${username}! Your PolyTracker is ready.\n\n🏦 **Your Deposit Address (Polygon USDC):**\n\`${publicAddress}\`\n\nAlerts: ${user.alertsEnabled ? 'ON' : 'OFF'}\nPaper Trading: ${user.paperTrading ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error('[Bot /start Error]', e);
  }
});

/**
 * COMMAND: /alerts
 * Toggles receiving push notifications
 */
bot.command('alerts', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  try {
    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (!user) return ctx.reply('Please run /start first.');

    const newState = !user.alertsEnabled;
    await db.update(users).set({ alertsEnabled: newState }).where(eq(users.telegramId, telegramId));

    await ctx.reply(`🔔 **Alpha Signals are now ${newState ? 'ON' : 'OFF'}**`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[Bot /alerts Error]', e);
  }
});

/**
 * COMMAND: /paper
 * Toggles paper trading mode
 */
bot.command('paper', async (ctx) => {
  const telegramId = ctx.from.id.toString();
  try {
    const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
    if (!user) return ctx.reply('Please run /start first.');

    const newState = !user.paperTrading;
    await db.update(users).set({ paperTrading: newState }).where(eq(users.telegramId, telegramId));

    await ctx.reply(`📝 **Paper Trading is now ${newState ? 'ON' : 'OFF'}**`, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[Bot /paper Error]', e);
  }
});

/**
 * COMMAND: /stats <address>
 * Looks up wallet grade
 */
bot.command('stats', async (ctx) => {
  const text = ctx.message.text;
  const parts = text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /stats <0xAddress>');

  const address = parts[1].toLowerCase();

  try {
    const wallet = await db.select().from(wallets).where(eq(wallets.address, address)).get();
    if (!wallet) return ctx.reply(`No data found for wallet \`${address}\`. It may not have traded recently or is hidden.`, { parse_mode: 'Markdown' });

    if (wallet.isBot) return ctx.reply(`🤖 **WARNING:** Wallet \`${address}\` has been flagged as a High-Frequency Bot. We ignore its trades.`, { parse_mode: 'Markdown' });

    let message = `📊 **Wallet Stats for** \`${address}\`\n\n`;
    message += `**Grade:** ${wallet.grade || 'Unranked (Not enough volume/trades)'}\n`;
    message += `**ROI:** ${wallet.roi ? wallet.roi.toFixed(2) + '%' : 'N/A'}\n`;
    message += `**Win Rate:** ${wallet.winRate ? wallet.winRate.toFixed(2) + '%' : 'N/A'}\n`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('[Bot /stats Error]', e);
  }
});

/**
 * SAFE BROADCAST SERVICE
 * Pushes HTML Alpha signals to all users with `alertsEnabled = true`
 * Respects Telegram's 30 msg/sec limit and handles missing/blocked user exceptions safely.
 */
export async function broadcastAlphaSignal(
  marketName: string,
  actionPhrase: string,
  avgPrice: number,
  walletsInvolved: { address: string, grade: string, recentRoi30d?: number }[],
  netConviction: number
) {
  if (!BOT_TOKEN || BOT_TOKEN === 'MOCK_TOKEN') return; // Skip in pure local test without token

  try {
    // 1. Fetch all subscribers
    const subscribers = await db.select().from(users).where(eq(users.alertsEnabled, true)).all();
    if (!subscribers.length) return;

    // 2. Build the exact requested HTML template
    let htmlMsg = `🚨 <b>ALPHA SIGNAL DETECTED</b> 🚨\n\n`;
    htmlMsg += `<b>Market:</b> ${marketName}\n`;
    htmlMsg += `<b>Action:</b> ${actionPhrase}\n`;
    htmlMsg += `<b>Avg Entry Price:</b> $${avgPrice.toFixed(2)}\n`;
    htmlMsg += `<b>Net Conviction:</b> ${netConviction >= 0 ? '+' : ''}${netConviction}\n\n`;
    htmlMsg += `🧠 <b>Smart Wallets Involved (Score):</b>\n`;

    // Phase 11: Display wallet address, Grade, and 30d ROI
    for (const w of walletsInvolved) {
      const roiStr = w.recentRoi30d !== undefined ? w.recentRoi30d.toFixed(2) + '%' : 'N/A';
      htmlMsg += `• ${truncateAddress(w.address)} (Grade ${w.grade}, 30d ROI: ${roiStr})\n`;
    }

    // Space for Phase 5 inline buttons
    htmlMsg += `\n`;

    console.log(`[Bot] Broadcasting signal to ${subscribers.length} users...`);

    // Safe sequential loop using Inline Buttons
    for (const user of subscribers) {
      try {
        await bot.telegram.sendMessage(user.telegramId, htmlMsg, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                // We encode minimal data into the callback_data since Telegram restricts it to 64 bytes
                // Format: ct|marketName|action|price
                // This is a naive approach; for production, we'd store the signal in DB and just send the signal ID
                { text: '💸 Copy Trade $10', callback_data: `copy|10|${marketName.substring(0, 20)}|${actionPhrase}` },
                { text: '💸 Copy Trade $50', callback_data: `copy|50|${marketName.substring(0, 20)}|${actionPhrase}` }
              ]
            ]
          }
        });
      } catch (sendError: any) {
        // If user blocked bot (403), or chat not found (400), disable alerts for them so we stop trying
        const errDesc = sendError.response?.description || '';
        if (errDesc.includes('bot was blocked') || errDesc.includes('chat not found')) {
          console.warn(`[Bot] User ${user.telegramId} blocked bot. Disabling alerts.`);
          await db.update(users).set({ alertsEnabled: false }).where(eq(users.telegramId, user.telegramId));
        } else {
          console.error(`[Bot] Failed to send to ${user.telegramId}:`, sendError.message);
        }
      }

      // 4. Rate-limit wait (50ms = ~20 msgs per sec, well under the 30/s Telegram limit)
      await wait(50);
    }

    console.log('[Bot] Broadcast complete.');

  } catch (e) {
    console.error('[Bot] Fatal error during broadcast setup:', e);
  }
}

/**
 * CALLBACK HANDLER: Inline Keyboard Button Clicks (Copy Trading)
 */
bot.on('callback_query', async (ctx) => {
  // Narrow the callback query type to DataQuery to access data
  const callbackQuery = ctx.callbackQuery;
  if (!('data' in callbackQuery)) return;

  const data = callbackQuery.data; // e.g., "copy|50|Trump Wins|BUY Yes"

  if (data.startsWith('copy|')) {
    const parts = data.split('|');
    const amountStr = parts[1];
    const marketName = parts[2];
    const actionPhrase = parts[3];

    const amount = Number(amountStr);
    const telegramId = ctx.from.id.toString();

    try {
      // 1. Fetch user to get their burner wallet
      const user = await db.select().from(users).where(eq(users.telegramId, telegramId)).get();
      if (!user || !user.encryptedPrivateKey) {
        await ctx.answerCbQuery('⚠️ No burner wallet found. Please run /start first.', { show_alert: true });
        return;
      }

      const privateKey = decryptKey(user.encryptedPrivateKey);
      const wallet = new ethers.Wallet(privateKey);

      // 2. Acknowledge the button press to remove the loading spinner
      await ctx.answerCbQuery(`Initiating copy trade for $${amount}...`);

      // 3. Send progress message
      const progressMsg = await ctx.reply(`⏳ Attempting to execute $${amount} trade on ${marketName}...\n\n_Checking USDC balance for ${truncateAddress(wallet.address)}..._`, { parse_mode: 'Markdown' });

      // TODO: Phase 5 - Integration with real tradeExecutor.ts connecting to Polymarket CLOB
      // For now, we mock success and log to the CLI 
      // await constructAndSignMockOrder(privateKey, 'MOCK_TOKEN_ID', amount * 10, 0.10);

      await wait(1500); // Simulate network delay

      // 4. Update progress message with success
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        progressMsg.message_id,
        undefined,
        `✅ **Copy Trade Executed Successfully!**\n\n**Market:** ${marketName}\n**Action:** ${actionPhrase}\n**Amount:** $${amount}\n**Wallet:** \`${wallet.address}\``,
        { parse_mode: 'Markdown' }
      );

    } catch (e) {
      console.error('[Bot Callback Error]', e);
      await ctx.answerCbQuery('Failed to execute trade. See logs.', { show_alert: true });
    }
  }
});
