

const CATEGORIES = {

  '❓ Question': 'Question',

  '💡 Suggestion': 'Suggestion',

  '📢 Feedback': 'Feedback'

};

const MENU = {

  keyboard: [

    [{ text: '❓ Question' }, { text: '💡 Suggestion' }],

    [{ text: '📢 Feedback' }],

    [{ text: '🔄 Start over' }]

  ],

  resize_keyboard: true

};

const RESTART_MENU = {
  keyboard: [
    [{ text: '🔄 Start over' }]
  ],
  resize_keyboard: true
};

const PROGRAM_MENU = {

  keyboard: [

    [{ text: '⏭ Skip' }],

    [{ text: '🔄 Start over' }]

  ],

  resize_keyboard: true

};

const MAX_TEXT = 3500;

const adminIds = env =>

  String(env.ADMIN_USER_IDS || '')

    .split(',')

    .map(s => s.trim())

    .filter(Boolean);

const isAdmin = (env, id) =>

  adminIds(env).includes(String(id));

function buttons(id, blocked = false, answered = false, closed = false) {

  return {

    inline_keyboard: [

      [

        { text: (answered || closed) ? '↩️ Reply again' : '↩️ Reply', callback_data: `a:reply:${id}` },

        { text: closed ? '🔒 Conversation closed' : answered ? '✅ Replied' : '⏳ Awaiting reply', callback_data: `a:status:${id}` }

      ],

      [

        {

          text: blocked ? '🔓 Unblock' : '🚫 Block',

          callback_data: `a:${blocked ? 'unblock' : 'block'}:${id}`

        }

      ]

    ]

  };

}

async function api(env, method, payload) {

  const r = await fetch(

    `https\://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,

    {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(payload)

    }

  );

  const x = await r.json();

  if (!r.ok || !x.ok) {

    throw Error(`${method}: ${x.description || r.status}`);

  }

  return x.result;

}

const send = (env, chat_id, text, extra = {}) =>

  api(env, 'sendMessage', { chat_id, text, ...extra });

const welcome = (env, id) =>

  send(

    env,

    id,

    '👋 Welcome to the support desk.\n\nPlease choose a request category:',

    { reply_markup: MENU }

  );

async function addJob(env, type, id) {

  await env.DB.prepare(`

    INSERT OR IGNORE INTO delivery_jobs

      (job_type, message_id, state)

    VALUES (?, ?, 'pending')

  `).bind(type, id).run();

}

async function blocked(env, id) {

  return !!(await env.DB.prepare(`

    SELECT 1 FROM blocked_users

    WHERE telegram_chat_id = ?

  `).bind(String(id)).first());

}

function contentOf(m) {

  if (typeof m.text === 'string') {

    return {

      type: 'text',

      text: m.text.trim(),

      fileId: null

    };

  }

  if (m.photo?.length) {

    return {

      type: 'photo',

      text: m.caption || '',

      fileId: m.photo[m.photo.length - 1].file_id

    };

  }

  for (const type of ['video', 'document', 'voice', 'audio']) {

    if (m[type]) {

      return {

        type,

        text: m.caption || '',

        fileId: m[type].file_id

      };

    }

  }

  return null;

}

async function flood(env, id) {

  const now = Math.floor(Date.now() / 1000);

  const old = await env.DB.prepare(`

    SELECT window_start, message_count, muted_until

    FROM user_rate_limits

    WHERE chat_id = ?

  `).bind(id).first();

  if (old?.muted_until > now) return true;

  const active = old && now - old.window_start < 10;

  const count = active ? old.message_count + 1 : 1;

  const mute = count > 15 ? now + 600 : 0;

  await env.DB.prepare(`

    INSERT INTO user_rate_limits

      (chat_id, window_start, message_count, muted_until)

    VALUES (?, ?, ?, ?)

    ON CONFLICT(chat_id) DO UPDATE SET

      window_start = excluded.window_start,

      message_count = excluded.message_count,

      muted_until = excluded.muted_until

  `).bind(

    id,

    active ? old.window_start : now,

    count,

    mute

  ).run();

  return mute > now;

}


const ACTIVE_MENU = { keyboard: [[{ text: '✅ Close conversation' }]], resize_keyboard: true };
const CLOSE_MENU = {
  keyboard: [[{ text: '✅ Yes, close conversation' }], [{ text: '↩️ No, continue conversation' }]],
  resize_keyboard: true
};
const MESSAGE_PROMPT = '✍️ Please send your message. Text, photos, videos, files, and voice messages are supported.';
const schemaReady = new WeakMap();
async function ensureThreadSchema(env) {
  if (!schemaReady.has(env.DB)) {
    const ready = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS awa_threads (
        request_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0, closed_at TEXT, board_dirty INTEGER NOT NULL DEFAULT 0)`),
      env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS awa_one_active_thread
        ON awa_threads(chat_id) WHERE closed = 0`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS awa_thread_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL,
        role TEXT NOT NULL, source_id INTEGER NOT NULL, content TEXT NOT NULL,
        media_type TEXT, state TEXT NOT NULL DEFAULT 'pending', board_message_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(role, source_id, request_id))`)
    ]).catch(e => { schemaReady.delete(env.DB); throw e; });
    schemaReady.set(env.DB, ready);
  }
  await schemaReady.get(env.DB);
}
async function activeThread(env, chatId) {
  return env.DB.prepare(`SELECT t.*, m.category, m.program_name, m.telegram_message_id FROM awa_threads t
    JOIN messages m ON m.id = t.request_id WHERE t.chat_id = ? AND t.closed = 0`)
    .bind(String(chatId)).first();
}
async function askToClose(env, chatId) {
  await send(env, chatId, 'Would you like to close the conversation?', { reply_markup: CLOSE_MENU });
}
async function closeThread(env, chatId, thread) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE awa_threads SET closed = 1, closed_at = CURRENT_TIMESTAMP,
      board_dirty = 1 WHERE request_id = ?`).bind(thread.request_id),
    env.DB.prepare(`DELETE FROM conversations WHERE chat_id = ?`).bind(String(chatId))
  ]);
  await send(env, chatId, '🔒 Conversation closed.', { reply_markup: MENU });
}

// MEMBER MESSAGES
async function receiveMember(env, m) {

  const id = String(m.chat.id);

  const text = m.text?.trim() || '';

  if (await blocked(env, id) || await flood(env, id)) {

    return;

  }

  await ensureThreadSchema(env);
  const thread = await activeThread(env, id);
  if (thread) {
    // A retried initial update must not become a follow-up event.
    if (Number(thread.telegram_message_id) === m.message_id) return;
    if (text === '✅ Yes, close conversation') {
      await closeThread(env, id, thread);
      return;
    }
    if (text === '✅ Close conversation' || text === '/start' || text === '🔄 Start over') {
      await askToClose(env, id);
      return;
    }
    if (text === '↩️ No, continue conversation') {
      await send(env, id, '💬 You can send your next message.', { reply_markup: CLOSE_MENU });
      return;
    }
    if (CATEGORIES[text]) {
      await send(env, id, 'You have an active conversation. Send a message here or close it.',
        { reply_markup: ACTIVE_MENU });
      return;
    }
    const c = contentOf(m);
    if (!c || (!c.text && !c.fileId) || c.text.length > MAX_TEXT) {
      await send(env, id, 'Please send a valid message within the length limit.', { reply_markup: ACTIVE_MENU });
      return;
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO awa_thread_events
        (request_id, role, source_id, content, media_type)
        VALUES (?, 'user', ?, ?, ?)`).bind(thread.request_id, m.message_id, c.text || `[${c.type}]`, c.type),
      env.DB.prepare(`UPDATE messages SET status = 'Antwort_ausstehend' WHERE id = ?`).bind(thread.request_id),
      env.DB.prepare(`UPDATE awa_threads SET board_dirty = 1 WHERE request_id = ?`).bind(thread.request_id)
    ]);
    await send(env, id, '✅ Your message was added to this conversation.\n\nWould you like to close it?', { reply_markup: CLOSE_MENU });
    return;
  }
  if (text === '✅ Close conversation' || text === '✅ Yes, close conversation') {
    await env.DB.prepare('DELETE FROM conversations WHERE chat_id = ?').bind(id).run();
    await welcome(env, id);
    return;
  }
  if (text === '↩️ No, continue conversation') {
    await welcome(env, id);
    return;
  }
  if (text === '/start' || text === '🔄 Start over') {

    await env.DB.prepare(`

      DELETE FROM conversations WHERE chat_id = ?

    `).bind(id).run();

    await welcome(env, id);

    return;

  }

  if (CATEGORIES[text]) {

    await env.DB.prepare(`

      INSERT INTO conversations

        (chat_id, category, program_name, step)

      VALUES (?, ?, NULL, 'program')

      ON CONFLICT(chat_id) DO UPDATE SET

        category = excluded.category,

        program_name = NULL,

        step = 'program',

        updated_at = CURRENT_TIMESTAMP

    `).bind(id, CATEGORIES[text]).run();

    await send(

      env,

      id,

      '📅 Is your message related to a specific event?\n' +

      'Enter the event name or select Skip.',

      { reply_markup: PROGRAM_MENU }

    );

    return;

  }

  const state = await env.DB.prepare(`

    SELECT category, program_name, step

    FROM conversations

    WHERE chat_id = ?

  `).bind(id).first();

  if (!state?.category) {

    await welcome(env, id);

    return;

  }

  if (state.step === 'program') {

    if (!text) {

      await send(env, id, 'Enter the event name or skip.');

      return;

    }

    const program = text === '⏭ Skip' ? '' : text;

    if (program.length > 120) {

      await send(env, id, 'The event name is too long.');

      return;

    }

    await env.DB.prepare(`

      UPDATE conversations

      SET program_name = ?,

          step = 'message',

          updated_at = CURRENT_TIMESTAMP

      WHERE chat_id = ?

    `).bind(program, id).run();

    await send(

      env,

      id,

      '✍️ Please send your message. Text, photos, videos, files, and voice messages are supported.',

      { reply_markup: ACTIVE_MENU }

    );

    return;

  }

  if (state.step !== 'message') {

    await welcome(env, id);

    return;

  }

  const c = contentOf(m);

  if (!c || (!c.text && !c.fileId)) {

    await send(env, id, 'Please send a valid message.');

    return;

  }

  if (c.text.length > MAX_TEXT) {

    await send(env, id, 'The message is too long.');

    return;

  }

  const prior = await env.DB.prepare(`

    SELECT id FROM messages

    WHERE telegram_chat_id = ?

      AND telegram_message_id = ?

  `).bind(id, m.message_id).first();

  if (prior) {

    await addJob(env, 'board', prior.id);

    await addJob(env, 'ack', prior.id);

    return;

  }

const createMessage = env.DB.prepare(`

  INSERT INTO messages (

    telegram_chat_id,

    telegram_message_id,

    category,

    program_name,

    message_text,

    message_type,

    telegram_file_id,

    status,

    telegram_username,

    telegram_first_name,

    telegram_last_name

  )

  VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)

`).bind(

  id,

  m.message_id,

  state.category,

  state.program_name || '',

  c.text || `[${c.type}]`,

  c.type,

  c.fileId,

  m.from?.username || '',

  m.from?.first_name || '',

  m.from?.last_name || ''

);

const savedBatch = await env.DB.batch([
  createMessage,
  env.DB.prepare(`INSERT INTO awa_threads(request_id, chat_id)
    VALUES (last_insert_rowid(), ?)`).bind(id)
]);
const saved = savedBatch[0];

const messageId = saved.meta.last_row_id;

  await addJob(env, 'board', messageId);

  await addJob(env, 'ack', messageId);

  // Keep setup state while this single active thread owns the conversation.
}

// BOARD REPLIES
async function receiveBoard(env, m) {

  if (!isAdmin(env, m.from?.id)) return;

  const replyTo = m.reply_to_message?.message_id;

  // Only direct replies to bot messages are accepted.
  if (!replyTo) return;

  let found = await env.DB.prepare(`

    SELECT id FROM messages

    WHERE board_message_id = ?

  `).bind(replyTo).first();

  let requestId = found?.id;

  if (!requestId) {

    found = await env.DB.prepare(`

      SELECT message_id FROM message_media

      WHERE board_message_id = ?

    `).bind(replyTo).first();

    requestId = found?.message_id;

  }

  if (!requestId) {
    const event = await env.DB.prepare(`SELECT request_id FROM awa_thread_events
      WHERE role = 'user' AND board_message_id = ?`).bind(replyTo).first();
    requestId = event?.request_id;
  }

  if (!requestId) return;

  const c = contentOf(m);

  if (!c || (!c.text && !c.fileId) || c.text.length > MAX_TEXT) {

    return;

  }

  // All four statements run in one D1 batch transaction.
  // The UNIQUE constraint prevents duplicate reply sources.
  const statements = [

    env.DB.prepare(`

      INSERT INTO message_replies (

        message_id,

        admin_user_id,

        admin_name,

        reply_text,

        reply_type,

        telegram_file_id

      )

      VALUES (?, ?, ?, ?, ?, ?)

    `).bind(

      requestId,

      String(m.from.id),

      [

     m.from?.first_name,

     m.from?.last_name

     ].filter(Boolean).join(' ') || m.from?.username || '',

      c.text || '',

      c.type,

      c.fileId

    ),

    env.DB.prepare(`

      INSERT INTO reply_sources (

        reply_id,

        board_message_id

      )

      VALUES (last_insert_rowid(), ?)

    `).bind(m.message_id),

    env.DB.prepare(`

      INSERT OR IGNORE INTO delivery_jobs (

        job_type,

        message_id,

        state

      )

      SELECT 'reply', reply_id, 'pending'

      FROM reply_sources

      WHERE board_message_id = ?

    `).bind(m.message_id),

    env.DB.prepare(`

      UPDATE messages
      SET status = CASE WHEN status = 'Erledigt' THEN 'Erledigt' ELSE 'Antwort_ausstehend' END,

          reply_text = ?,

          replied_by = ?

      WHERE id = ?

    `).bind(

      c.text || `[${c.type}]`,

      String(m.from.id),

      requestId

    )

  ];

  try {

    await env.DB.batch(statements);

  } catch (error) {

    const prior = await env.DB.prepare(`

      SELECT reply_id

      FROM reply_sources

      WHERE board_message_id = ?

    `).bind(m.message_id).first();

    if (prior) {

      await addJob(env, 'reply', prior.reply_id);

      return;

    }

    throw error;

  }

}

// ADMIN BUTTONS
async function callback(env, q) {

  const answer = (text, show_alert = false) =>

    api(env, 'answerCallbackQuery', {

      callback_query_id: q.id,

      text,

      show_alert

    });

  if (

    !isAdmin(env, q.from?.id) ||

    String(q.message?.chat?.id) !== String(env.BOARD_CHAT_ID)

  ) {

    await answer('Keine Berechtigung', true);

    return;

  }

  const match = /^a:(reply|status|done|block|unblock):(\d+)$/

    .exec(q.data || '');

  if (!match) {

    await answer('Unbekannte Aktion');

    return;

  }

  const [, action, idString] = match;

  const id = Number(idString);

  const m = await env.DB.prepare(`

    SELECT * FROM messages WHERE id = ?

  `).bind(id).first();

  if (!m) {

    await answer('Nachricht nicht gefunden', true);

    return;

  }

if (action === 'reply') {

  await answer(

    'Reply to this message to respond.',

    true

  );

  return;

}

  // Legacy done buttons are read-only too.
  if (action === 'status' || action === 'done') {
    const details = await buildBoardPostDetails(env, m);
    await answer(details.closed ? '🔒 Conversation closed; replying again is still possible.' : details.answered
      ? '✅ The reply was delivered to the member.'
      : '⏳ No reply has been successfully delivered yet.');
    await updateBoardPost(env, id);
    return;
  }

  if (action === 'block') {

    await env.DB.prepare(`

      INSERT INTO blocked_users (

        telegram_chat_id,

        telegram_username,

        blocked_by

      )

      VALUES (?, ?, ?)

      ON CONFLICT(telegram_chat_id) DO UPDATE SET

        telegram_username = excluded.telegram_username,

        blocked_by = excluded.blocked_by,

        blocked_at = CURRENT_TIMESTAMP

    `).bind(

      m.telegram_chat_id,

      m.telegram_username || '',

      String(q.from.id)

    ).run();

  }

  if (action === 'unblock') {

    await env.DB.prepare(`

      DELETE FROM blocked_users

      WHERE telegram_chat_id = ?

    `).bind(m.telegram_chat_id).run();

  }

  await answer('Erledigt');

  await updateBoardPost(env, id)
    .catch(e => console.error('Markup:', String(e)));

}

async function handleUpdate(env, u) {
  await ensureThreadSchema(env);
  // Handle new posts in configured support channels.
  if (u.channel_post) {
    const m = u.channel_post;

    const ALLOWED_CHANNEL_IDS = new Set([
      ...String(env.TEST_CHANNEL_IDS || '').split(',').map(v => v.trim()).filter(Boolean), // Test channels
      ...String(env.PRODUCTION_CHANNEL_IDS || '').split(',').map(v => v.trim()).filter(Boolean) // Production channels
    ]);    
    const SUPPORT_BOT_URL = env.SUPPORT_BOT_URL;
    const SUPPORT_BUTTON_TEXT = 'Contact support';

    // Never modify posts from other channels.
      if (!ALLOWED_CHANNEL_IDS.has(String(m.chat.id))) {
      return;
    }

    const contentType = m.photo
      ? 'photo'
      : m.video
        ? 'video'
        : m.text
          ? 'text'
          : 'other';

    console.log('SUPPORT_CHANNEL_POST', JSON.stringify({
      chat_id: m.chat.id,
      message_id: m.message_id,
      content_type: contentType
    }));

    // Skip posts that already contain the exact support button.
    const buttons = m.reply_markup?.inline_keyboard || [];

    const buttonAlreadyExists = buttons.some(row =>
      row.some(button =>
        button.text === SUPPORT_BUTTON_TEXT &&
        button.url === SUPPORT_BOT_URL
      )
    );

    if (buttonAlreadyExists) {
      console.log('SUPPORT_BUTTON_ALREADY_EXISTS', m.message_id);
      return;
    }

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: SUPPORT_BUTTON_TEXT,
            url: SUPPORT_BOT_URL
          }
        ]
      ]
    };

    try {
      const result = await api(env, 'editMessageReplyMarkup', {
        chat_id: m.chat.id,
        message_id: m.message_id,
        reply_markup: replyMarkup
      });

      // The existing api() helper may return Telegram's
      // JSON response or throw an exception.
      if (result?.ok === false) {
        if (
          String(result.description || '')
            .toLowerCase()
            .includes('message is not modified')
        ) {
          console.log('SUPPORT_BUTTON_UNCHANGED', m.message_id);
          return;
        }

        console.error('SUPPORT_BUTTON_ERROR', JSON.stringify({
          chat_id: m.chat.id,
          message_id: m.message_id,
          error_code: result.error_code,
          description: result.description
        }));

        return;
      }

      console.log('SUPPORT_BUTTON_SUCCESS', JSON.stringify({
        chat_id: m.chat.id,
        message_id: m.message_id
      }));
    } catch (error) {
      console.error('SUPPORT_BUTTON_EXCEPTION', JSON.stringify({
        chat_id: m.chat.id,
        message_id: m.message_id,
        error: String(error?.message || error)
      }));
    }

    return;
  }

  // Preserve the existing callback-query workflow.
  if (u.callback_query) {
    return callback(env, u.callback_query);
  }

  const m = u.message;
  if (!m) return;

  // Preserve the existing board workflow.
  if (String(m.chat.id) === String(env.BOARD_CHAT_ID)) {
    return receiveBoard(env, m);
  }

  // Preserve the existing private support workflow.
  if (m.chat.type === 'private') {
    return receiveMember(env, m);
  }
}

async function buildBoardPostDetails(env, m) {
  const result = await env.DB.prepare(`SELECT r.id, r.admin_name, r.reply_text, r.reply_type
    FROM message_replies r JOIN delivery_jobs j ON j.message_id = r.id AND j.job_type = 'reply'
    WHERE r.message_id = ? AND j.state = 'done' ORDER BY r.id`).bind(m.id).all();
  const replies = result.results || [];
  const events = (await env.DB.prepare(`SELECT * FROM awa_thread_events
    WHERE request_id = ? ORDER BY id`).bind(m.id).all()).results || [];
  const thread = await env.DB.prepare('SELECT closed FROM awa_threads WHERE request_id = ?').bind(m.id).first();
  const closed = !!thread?.closed;
  const replyById = new Map(replies.map(r => [r.id, r]));
  const recorded = new Set(events.filter(e => e.role === 'admin').map(e => e.source_id));
  const timeline = [
    ...replies.filter(r => !recorded.has(r.id)).map(r => ({ role: 'admin', source_id: r.id, content: r.reply_text || `[${r.reply_type}]` })),
    ...events.filter(e => e.role === 'user' || replyById.has(e.source_id))
  ];
  const lastUser = events.filter(e => e.role === 'user').at(-1)?.id || 0;
  const lastAdmin = events.filter(e => e.role === 'admin' && replyById.has(e.source_id)).at(-1)?.id || 0;
  const answered = replies.length > 0 && (lastUser === 0 || lastAdmin > lastUser);
  const status = closed ? '🔒 Conversation closed' : answered ? '✅ Replied' : '⏳ Awaiting reply';
  const name = [m.telegram_first_name, m.telegram_last_name].filter(Boolean).join(' ') || 'Name unavailable';
  const prefix = `📨 Request #${m.id}\n${m.category || 'Message'}\n🎯 Event: ${m.program_name || 'General'}\n` +
    `👤 ${name}\n🆔 ${m.telegram_chat_id}\n🔗 ${m.telegram_username ? '@' + m.telegram_username : 'None'}\n\n` +
    `💬 Original message:\n${String(m.message_text || '').slice(0, 800)}\n\n💬 Follow-up conversation:\n`;
  const suffix = `\n\n📌 Status: ${status}`;
  const visible = [];
  let size = prefix.length + suffix.length + 100;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    const r = e.role === 'admin' ? replyById.get(e.source_id) : null;
    const entry = e.role === 'user'
      ? `👤 Member:\n${e.content}`
      : `👥 ${r?.admin_name || 'Admin team'}:\n${r?.reply_text || e.content || '[Media]'}`;
    if (size + entry.length + 2 > 4096) break;
    visible.unshift({ entry, replyId: r?.id });
    size += entry.length + 2;
  }
  const note = visible.length < timeline.length ? '… Earlier messages are retained in the database and admin group.\n\n' : '';
  return {
    text: prefix + note + (visible.map(e => e.entry).join('\n\n') || 'No follow-up messages yet.') + suffix,
    visibleReplyIds: visible.filter(e => e.replyId).map(e => e.replyId), answered, closed
  };
}

async function buildBoardPost(env, m) {

  return (await buildBoardPostDetails(env, m)).text;

}

async function updateBoardPost(env, requestId) {

  const m = await env.DB.prepare(`

    SELECT *

    FROM messages

    WHERE id = ?

  `).bind(requestId).first();

  if (!m || !m.board_message_id) {

    throw new Error('Board message not found');

  }

  const details = await buildBoardPostDetails(env, m);

  try {

    await api(env, 'editMessageText', {

      chat_id: env.BOARD_CHAT_ID,

      message_id: m.board_message_id,

      text: details.text,

      reply_markup: buttons(

        m.id,

        await blocked(env, m.telegram_chat_id),

        details.answered,

        details.closed

      )

    });

  } catch (error) {

    // Telegram returns this when the post already has identical content.
    if (!String(error).includes('message is not modified')) {

      throw error;

    }

  }

  return details;

}

// BOARD DELIVERY
async function deliverBoard(env, m) {

  let id = m.board_message_id;

  if (!id) {

    const details = await buildBoardPostDetails(env, m);

    const sent = await send(

      env,

      env.BOARD_CHAT_ID,

      details.text.slice(0, 4096),

      { reply_markup: buttons(m.id, await blocked(env, m.telegram_chat_id), details.answered, details.closed) }

    );

    id = sent.message_id;

    await env.DB.prepare(`

      UPDATE messages

      SET board_message_id = ?,

          status = 'Offen'

      WHERE id = ?

    `).bind(id, m.id).run();

  }

  if (m.telegram_file_id) {

    await addJob(env, 'board_media', m.id);

  }

}

async function deliverBoardMedia(env, m) {

  if (!m.telegram_file_id) return;

  if (!m.board_message_id) {

    throw Error('Board header missing');

  }

  const existing = await env.DB.prepare(`

    SELECT id

    FROM message_media

    WHERE message_id = ?

      AND board_message_id IS NOT NULL

  `).bind(m.id).first();

  if (existing) return;

  const sent = await api(env, 'copyMessage', {

    chat_id: env.BOARD_CHAT_ID,

    from_chat_id: m.telegram_chat_id,

    message_id: m.telegram_message_id,

    reply_parameters: {

      message_id: m.board_message_id

    }

  });

  await env.DB.prepare(`

    INSERT INTO message_media (

      message_id,

      media_type,

      telegram_file_id,

      board_message_id

    )

    VALUES (?, ?, ?, ?)

  `).bind(

    m.id,

    m.message_type,

    m.telegram_file_id,

    sent.message_id

  ).run();

}

// MEMBER REPLY DELIVERY
async function deliverReply(env, id) {

  const r = await env.DB.prepare(`

    SELECT r.*,

           m.telegram_chat_id,

           m.id AS request_id

    FROM message_replies r

    JOIN messages m ON m.id = r.message_id

    WHERE r.id = ?

  `).bind(id).first();

  if (!r) throw Error('Reply missing');

  const active = await activeThread(env, r.telegram_chat_id);
  const continuing = active?.request_id === r.request_id;
  const closingText = '\n\nWould you like to close the conversation?';

  if (r.telegram_file_id) {

    const src = await env.DB.prepare(`

      SELECT board_message_id

      FROM reply_sources

      WHERE reply_id = ?

    `).bind(id).first();

    if (!src) throw Error('Reply source missing');

    await api(env, 'copyMessage', {

      chat_id: r.telegram_chat_id,

      from_chat_id: env.BOARD_CHAT_ID,

      message_id: src.board_message_id

    });

  } else {

    await send(

      env,

      r.telegram_chat_id,

      `📬 Reply from the support team:\n\n` +

      r.reply_text + (continuing ? closingText : ''),
      continuing ? { reply_markup: CLOSE_MENU } : {}

    );

  }

  if (continuing && r.telegram_file_id) {
    // A failed prompt must never cause a successfully copied answer to be resent.
    try { await askToClose(env, r.telegram_chat_id); }
    catch (e) { console.error('Close prompt failed:', String(e)); }
  }
  return r.request_id;

}

async function updateReplyStatus(env, id) {

  const x = await env.DB.prepare(`

    SELECT COUNT(*) AS total

    FROM delivery_jobs

    WHERE job_type = 'reply'

      AND state != 'done'

      AND message_id IN (

        SELECT id

        FROM message_replies

        WHERE message_id = ?

      )

  `).bind(id).first();

  if (x.total === 0) {

    await env.DB.prepare(`

      UPDATE messages

      SET status = 'Beantwortet',

          replied_at = CURRENT_TIMESTAMP

      WHERE id = ?

      AND status != 'Erledigt'

    `).bind(id).run();

  } else {

    await env.DB.prepare(`

      UPDATE messages

      SET status = 'Antwort_ausstehend'

      WHERE id = ?

     AND status != 'Erledigt'

    `).bind(id).run();

  }

}

async function cleanupBoardReply(env, replyId) {

  const r = await env.DB.prepare(`

    SELECT r.message_id, r.telegram_file_id, s.board_message_id

    FROM message_replies r

    LEFT JOIN reply_sources s ON s.reply_id = r.id

    WHERE r.id = ?

  `).bind(replyId).first();

  if (!r) throw Error('Reply not found');

  await env.DB.prepare(`INSERT OR IGNORE INTO awa_thread_events
    (request_id, role, source_id, content, state)
    VALUES (?, 'admin', ?, '', 'done')`).bind(r.message_id, replyId).run();

  // The original media reply must remain accessible: text cannot embed files.
  const details = await updateBoardPost(env, r.message_id);

  if (r.telegram_file_id) return 'board_kept_media';

  if (!details.visibleReplyIds.includes(replyId)) return 'board_kept_overflow';

  if (!r.board_message_id) throw Error('Reply source missing');

  try {

    await api(env, 'deleteMessage', {

      chat_id: env.BOARD_CHAT_ID,

      message_id: r.board_message_id

    });

  } catch (e) {

    const reason = String(e);

    if (reason.includes('message to delete not found')) return 'board_already_deleted';

    if (reason.includes("message can't be deleted") ||

        reason.includes('message cannot be deleted')) return 'board_kept_delete_expired';

    throw e;

  }

  return 'board_cleaned';

}

async function reconcileBoardReply(env, job) {

  try {

    const outcome = await cleanupBoardReply(env, job.message_id);

    await env.DB.prepare(`

      UPDATE delivery_jobs SET last_error = ?, updated_at = CURRENT_TIMESTAMP

      WHERE id = ? AND state = 'done'

    `).bind(outcome, job.id).run();

  } catch (e) {

    // The member has already received this reply. Never resend it here.
    console.error('Board cleanup pending:', job.id, String(e));

    // Keep the delivery as done. Only board reconciliation may be retried.
    try {

      await env.DB.prepare(`

        UPDATE delivery_jobs

        SET last_error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND state = 'done'

      `).bind('board_retry:' + String(e).slice(0, 450), job.id).run();

    } catch (dbError) {

      console.error('Unable to record board retry:', job.id, String(dbError));

    }

  }

}

// DELIVERY QUEUE
async function processJob(env, job) {

  const claimed = await env.DB.prepare(`

    UPDATE delivery_jobs

    SET state = 'sending', attempts = attempts + 1,

        updated_at = CURRENT_TIMESTAMP

    WHERE id = ? AND state = 'pending'

  `).bind(job.id).run();

  if (!claimed.meta.changes) return;

  let requestId = null;

  try {

    if (job.job_type === 'reply') {

      requestId = await deliverReply(env, job.message_id);

    } else {

      const m = await env.DB.prepare(`

        SELECT * FROM messages WHERE id = ?

      `).bind(job.message_id).first();

      if (!m) throw Error('Message missing');

      if (job.job_type === 'board') {

        await deliverBoard(env, m);

      } else if (job.job_type === 'board_media') {

        await deliverBoardMedia(env, m);

      } else if (job.job_type === 'ack') {

        if (!m.acknowledgement_sent_at) {

          await send(env, m.telegram_chat_id,

            '✅ Your message was received and forwarded to the support team.\nWe will reply here.\n\nWould you like to close the conversation?',

            { reply_markup: (await activeThread(env, m.telegram_chat_id))?.request_id === m.id ? CLOSE_MENU : MENU });

          await env.DB.prepare(`

            UPDATE messages SET acknowledgement_sent_at = CURRENT_TIMESTAMP

            WHERE id = ?

          `).bind(m.id).run();

        }

      } else if (job.job_type === 'member') {

        // Compatibility with older v3 jobs.
        if (m.status !== 'Beantwortet' && m.status !== 'Erledigt' && m.reply_text) {

          await send(env, m.telegram_chat_id,

            '📬 Reply from the support team:\n\n' + m.reply_text);

          await env.DB.prepare(`

            UPDATE messages SET status = 'Beantwortet',

              replied_at = CURRENT_TIMESTAMP WHERE id = ?

              AND status != 'Erledigt'

          `).bind(m.id).run();

        }

      } else {

        throw Error('Unknown job type');

      }

    }

    await env.DB.prepare(`

      UPDATE delivery_jobs SET state = 'done', last_error = NULL,

        updated_at = CURRENT_TIMESTAMP WHERE id = ?

    `).bind(job.id).run();

  } catch (e) {

    // Delivery may have reached Telegram even if confirmation was lost.
    // Never automatically resend a job in review.
    console.error('Delivery requires review:', job.id, String(e));

    await env.DB.prepare(`

      UPDATE delivery_jobs SET state = 'review', last_error = ?,

        updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'sending'

    `).bind(String(e).slice(0, 500), job.id).run();

    return;

  }

  // Post-delivery actions must never change a successful delivery into review.
  if (requestId !== null) {

    try {

      await updateReplyStatus(env, requestId);

    } catch (e) {

      console.error('Reply status update failed:', requestId, String(e));

    }

    await reconcileBoardReply(env, job);

  }

}

async function drain(env) {
  await ensureThreadSchema(env);


  await env.DB.prepare(`

    UPDATE delivery_jobs

    SET state = 'review',

        last_error = 'Uncertain delivery; manual review required',

        updated_at = CURRENT_TIMESTAMP

    WHERE state = 'sending'

      AND updated_at < datetime('now', '-5 minutes')

  `).run();

  const jobs = await env.DB.prepare(`

    SELECT id, job_type, message_id

    FROM delivery_jobs

    WHERE state = 'pending'

    ORDER BY id

    LIMIT 2

  `).all();

  for (const job of jobs.results || []) {

    await processJob(env, job);

  }

  await drainThreadEvents(env);

  // Retry board edits/deletions ONLY; never resend delivered member replies.
  // A short delay avoids hammering Telegram on transient errors.
  const reconciliation = await env.DB.prepare(`

    SELECT id, message_id FROM delivery_jobs

    WHERE job_type = 'reply' AND state = 'done'

      AND last_error LIKE 'board_retry:%'

      AND updated_at < datetime('now', '-5 minutes')

    ORDER BY updated_at ASC LIMIT 1

  `).all();

  for (const job of reconciliation.results || []) {

    await reconcileBoardReply(env, job);

  }

}

async function drainThreadEvents(env) {
  await env.DB.prepare(`UPDATE awa_thread_events SET state = 'review'
    WHERE state = 'sending' AND created_at < datetime('now', '-5 minutes')`).run();
  const events = (await env.DB.prepare(`SELECT e.*, m.telegram_chat_id, m.board_message_id AS header_id
    FROM awa_thread_events e JOIN messages m ON m.id = e.request_id
    WHERE e.role = 'user' AND e.state = 'pending' AND m.board_message_id IS NOT NULL
    ORDER BY e.id LIMIT 2`).all()).results || [];
  for (const e of events) {
    const claim = await env.DB.prepare(`UPDATE awa_thread_events SET state = 'sending'
      WHERE id = ? AND state = 'pending'`).bind(e.id).run();
    if (!claim.meta.changes) continue;
    try {
      const copied = await api(env, 'copyMessage', {
        chat_id: env.BOARD_CHAT_ID, from_chat_id: e.telegram_chat_id, message_id: e.source_id,
        reply_parameters: { message_id: e.header_id }
      });
      await env.DB.prepare(`UPDATE awa_thread_events SET state = 'done', board_message_id = ?
        WHERE id = ?`).bind(copied.message_id, e.id).run();
    } catch (error) {
      console.error('Followup delivery requires review:', e.id, String(error));
      await env.DB.prepare(`UPDATE awa_thread_events SET state = 'review' WHERE id = ?`).bind(e.id).run();
    }
  }
  const dirty = (await env.DB.prepare(`SELECT t.request_id FROM awa_threads t
    JOIN messages m ON m.id = t.request_id WHERE t.board_dirty = 1
    AND m.board_message_id IS NOT NULL LIMIT 2`).all()).results || [];
  for (const t of dirty) {
    // Clear before rendering so a concurrent new message can mark it dirty again.
    await env.DB.prepare('UPDATE awa_threads SET board_dirty = 0 WHERE request_id = ?').bind(t.request_id).run();
    try { await updateBoardPost(env, t.request_id); }
    catch (e) {
      await env.DB.prepare('UPDATE awa_threads SET board_dirty = 1 WHERE request_id = ?').bind(t.request_id).run();
      console.error('Thread board update pending:', t.request_id, String(e));
    }
  }
}

// GOOGLE SHEETS
// Send up to 100 recent records in one HTTP request rather than one request per record.
async function syncSheets(env) {
  if (!env.SHEETS_SYNC_URL || !env.SHEETS_SYNC_SECRET) throw Error('Sheets config missing');
  await ensureThreadSchema(env);
  const rows = await env.DB.prepare(`SELECT id, telegram_chat_id, telegram_username,
    telegram_first_name, telegram_last_name, category, program_name,
    message_text, message_type, status, reply_text, created_at, replied_at,
    board_message_id FROM messages ORDER BY id DESC LIMIT 100`).all();
  const base = rows.results || [];
  const ids = base.map(m => Number(m.id));
  let events = [], replies = [], threads = [];
  if (ids.length) {
    const slots = ids.map(() => '?').join(',');
    const params = ids;
    events = (await env.DB.prepare(`SELECT request_id, role, content, created_at, id
      FROM awa_thread_events WHERE request_id IN (${slots}) ORDER BY created_at, id`)
      .bind(...params).all()).results || [];
    replies = (await env.DB.prepare(`SELECT message_id, reply_text, created_at, id
      FROM message_replies WHERE message_id IN (${slots}) ORDER BY created_at, id`)
      .bind(...params).all()).results || [];
    threads = (await env.DB.prepare(`SELECT request_id, closed, closed_at
      FROM awa_threads WHERE request_id IN (${slots})`).bind(...params).all()).results || [];
  }
  const group = (records, key) => {
    const map = new Map();
    for (const record of records) {
      const id = String(record[key]);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(record);
    }
    return map;
  };
  const eventMap = group(events, 'request_id');
  const replyMap = group(replies, 'message_id');
  const threadMap = new Map(threads.map(t => [String(t.request_id), t]));
  const transcript = entries => entries.map(e =>
    `[${e.created_at || ''}] ${e.content || ''}`).join('\n');
  const messages = base.map(m => {
    const id = String(m.id);
    const ev = eventMap.get(id) || [];
    const rep = replyMap.get(id) || [];
    const userEvents = ev.filter(e => e.role === 'user');
    const boardEvents = ev.filter(e => e.role === 'admin');
    const thread = threadMap.get(id);
    const answerItems = rep.map(r => ({created_at:r.created_at, content:r.reply_text || '[media]'}));
    // Thread events for admin replies are references to message_replies; avoid duplicates.
    if (!answerItems.length) answerItems.push(...boardEvents);
    const activity = [m.created_at, m.replied_at, ...ev.map(e => e.created_at),
      ...rep.map(r => r.created_at), thread?.closed_at].filter(Boolean).sort().at(-1) || '';
    return {
      message_id: id, telegram_chat_id: m.telegram_chat_id,
      telegram_user_id: m.telegram_chat_id, // Private Telegram chat only.
      telegram_username: m.telegram_username,
      telegram_first_name: m.telegram_first_name,
      telegram_last_name: m.telegram_last_name,
      category: m.category, program_name: m.program_name,
      message_type: m.message_type, message_text: m.message_text,
      status: m.status, reply_text: m.reply_text,
      created_at: m.created_at, replied_at: m.replied_at,
      board_message_id: m.board_message_id,
      message_history: transcript([{created_at:m.created_at, content:m.message_text || '[media]'}, ...userEvents]),
      reply_history: transcript(answerItems),
      conversation_status: thread ? (thread.closed ? 'Geschlossen' : 'Offen') : 'Unbekannt',
      last_activity: activity
    };
  });

  if (!messages.length) return { synced: 0, failed: 0 };

  const response = await fetch(env.SHEETS_SYNC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      secret: env.SHEETS_SYNC_SECRET,
      messages
    }),
    redirect: 'follow'
  });

  const body = await response.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw Error(`Sheets returned non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok || result.ok !== true) {
    throw Error(`Sheets batch failed: ${String(result.error || response.status).slice(0, 300)}`);
  }

  const synced = Number(result.synced);
  const failed = Number(result.failed);
  if (!Number.isInteger(synced) || !Number.isInteger(failed) ||
      synced < 0 || failed < 0 || synced + failed !== messages.length) {
    throw Error('Sheets returned invalid batch counts');
  }

  return { synced, failed };
}

// CLOUDFLARE WORKER
export default {

  async fetch(request, env, ctx) {

    const path = new URL(request.url).pathname;

    if (path === '/health' && request.method === 'GET') {

      return Response.json({

        ok: true,

        service: 'awa-support-bot',

        version: '4.7.0-dialogue'

      });

    }

    if (path === '/db-check' && request.method === 'GET') {

      try {

        const r = await env.DB.prepare(`

          SELECT COUNT(*) AS total FROM messages

        `).first();

        return Response.json({

          ok: true,

          database: 'connected',

          messages: r.total

        });

      } catch {

        return Response.json(

          { ok: false },

          { status: 500 }

        );

      }

    }

    if (

      path === '/sync-sheets' &&

      request.method === 'POST'

    ) {

      if (

        !env.SHEETS_SYNC_SECRET ||

        request.headers.get('X-Sync-Secret') !==

          env.SHEETS_SYNC_SECRET

      ) {

        return new Response('Forbidden', { status: 403 });

      }

      try {

        return Response.json({

          ok: true,

          ...await syncSheets(env)

        });

      } catch (e) {

        console.error('Sync:', String(e));

        return Response.json(

          { ok: false },

          { status: 500 }

        );

      }

    }

    if (

      path !== '/telegram' ||

      request.method !== 'POST'

    ) {

      return new Response('Not found', { status: 404 });

    }

    if (

      !env.DB ||

      !env.BOT_TOKEN ||

      !env.TELEGRAM_WEBHOOK_SECRET ||

      !env.BOARD_CHAT_ID ||

      !env.ADMIN_USER_IDS

    ) {

      return new Response(

        'Not configured',

        { status: 503 }

      );

    }

    if (

      request.headers.get(

        'X-Telegram-Bot-Api-Secret-Token'

      ) !== env.TELEGRAM_WEBHOOK_SECRET

    ) {

      return new Response(

        'Forbidden',

        { status: 403 }

      );

    }

    let u;

    try {

      u = await request.json();

    } catch {

      return new Response(

        'Invalid JSON',

        { status: 400 }

      );

    }

    if (!Number.isSafeInteger(u.update_id)) {

      return new Response(

        'Invalid update',

        { status: 400 }

      );

    }

    try {

      const seen = await env.DB.prepare(`

        SELECT 1

        FROM processed_updates

        WHERE update_id = ?

      `).bind(u.update_id).first();

      if (!seen) {

        await handleUpdate(env, u);

        await env.DB.prepare(`

          INSERT OR IGNORE INTO processed_updates

            (update_id)

          VALUES (?)

        `).bind(u.update_id).run();

      }

      ctx.waitUntil(drain(env));

      return new Response('ok');

    } catch (e) {

      console.error('Webhook:', String(e));

      return new Response(

        'Retry',

        { status: 500 }

      );

    }

  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      // Preserve Telegram queue processing on every scheduled invocation.
      try {
        await drain(env);
      } catch (error) {
        console.error('DRAIN_ERROR', String(error));
      }

      // With a one-minute Cron trigger, sync once every five UTC minutes.
      if (new Date(event.scheduledTime).getUTCMinutes() % 5 !== 0) return;

      try {
        const result = await syncSheets(env);
        console.log('SHEETS_SYNC_RESULT', JSON.stringify(result));
        if (result.failed > 0) {
          console.error('SHEETS_SYNC_PARTIAL_FAILURE', JSON.stringify(result));
        }
      } catch (error) {
        console.error('SHEETS_SYNC_ERROR', String(error));
      }
    })());
  }
};