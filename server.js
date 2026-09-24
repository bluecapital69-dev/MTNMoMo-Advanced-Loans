const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // or use global fetch if Node 18+

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (swap for a DB later)
const applications = {};

// ---------- 1) Notify Telegram on new application ----------
app.post('/api/apply', async (req, res) => {
  try {
    const { fullName, phone, idNumber, income, amount, months } = req.body;
    const ref = 'QL-' + Math.floor(100000 + Math.random() * 900000);

    applications[ref] = { ref, fullName, phone, idNumber, income, amount, months, status: 'pending' };

    const text =
      `<b>New loan application</b>\n` +
      `Name:   ${fullName}\n` +
      `Amount: ${amount.toLocaleString('fr-FR')} XAF\n` +
      `Months: ${months}\n` +
      `Phone:  ${phone}\n` +
      `Ref:    <code>${ref}</code>`;

    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve:${ref}` },
            { text: '❌ Decline', callback_data: `decline:${ref}` }
          ]]
        }
      })
    });

    const data = await tgRes.json();
    applications[ref].messageId = data.result?.message_id;

    res.json({ ok: true, ref });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- 2) User polls for decision ----------
app.get('/api/status/:ref', (req, res) => {
  const app_ = applications[req.params.ref];
  if (!app_) return res.status(404).json({ ok: false });
  res.json({ ok: true, status: app_.status });
});

// ---------- 3) Telegram callback (button taps) ----------
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const { data, message, id: cbId } = update.callback_query;
    const [action, ref] = data.split(':');
    const app_ = applications[ref];

    if (app_) {
      app_.status = action === 'approve' ? 'approved' : 'declined';

      const newText =
        `<b>Loan ${action === 'approve' ? 'APPROVED ✅' : 'DECLINED ❌'}</b>\n` +
        `Name:   ${app_.fullName}\n` +
        `Amount: ${app_.amount.toLocaleString('fr-FR')} XAF\n` +
        `Ref:    <code>${ref}</code>`;

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.chat.id,
          message_id: message.message_id,
          text: newText,
          parse_mode: 'HTML'
        })
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cbId, text: `Marked ${app_.status}` })
      });
    }
  }

  res.sendStatus(200);
});

// ---------- 4) Fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
