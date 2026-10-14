

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



function buttons(id, blocked = false) {

  return {

    inline_keyboard: [

      [

        { text: '↩️ Reply', callback_data: `a:reply:${id}` },

        { text: '✅ Mark resolved', callback_data: `a:done:${id}` }

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

    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,

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



// MEMBER MESSAGES
async function receiveMember(env, m) {

  const id = String(m.chat.id);

  const text = m.text?.trim() || '';



  if (await blocked(env, id) || await flood(env, id)) {

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

      '📅 Is your request related to a particular event or program?\n' +

      'Enter an event or program name, or choose Skip.',

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

      await send(env, id, 'Enter an event or program name, or choose Skip.');

      return;

    }



    const program = text === '⏭ Skip' ? '' : text;



    if (program.length > 120) {

      await send(env, id, 'The program name is too long.');

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

      { reply_markup: MENU }

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

    await send(env, id, 'Your message is too long.');

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



const saved = await env.DB.prepare(`

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

).run();



const messageId = saved.meta.last_row_id;



  await addJob(env, 'board', messageId);

  await addJob(env, 'ack', messageId);



  await env.DB.prepare(`

    DELETE FROM conversations WHERE chat_id = ?

  `).bind(id).run();

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

      SET status = CASE WHEN status = 'Resolved' THEN 'Resolved' ELSE 'Awaiting_reply' END,

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

    await answer('Not authorized', true);

    return;

  }



  const match = /^a:(reply|done|block|unblock):(\d+)$/

    .exec(q.data || '');



  if (!match) {

    await answer('Unknown action');

    return;

  }



  const [, action, idString] = match;

  const id = Number(idString);



  const m = await env.DB.prepare(`

    SELECT * FROM messages WHERE id = ?

  `).bind(id).first();



  if (!m) {

    await answer('Ticket not found', true);

    return;

  }



if (action === 'reply') {

  await answer(

    'Reply directly to this ticket message to respond.',

    true

  );

  return;

}



  if (action === 'done') {
    const pending = await env.DB.prepare(`
      SELECT 1 FROM delivery_jobs
      WHERE job_type = 'reply' AND state != 'done'
        AND message_id IN (
          SELECT id FROM message_replies WHERE message_id = ?
        ) LIMIT 1
    `).bind(id).first();
    if (pending) {
      await answer('Some replies have not been delivered yet', true);
      return;
    }
    await env.DB.prepare(`
      UPDATE messages SET status = 'Resolved',
        replied_at = COALESCE(replied_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).bind(id).run();
    try {
      await updateBoardPost(env, id);
      await answer('Done');
    } catch (e) {
      console.error('Board completion edit failed:', id, String(e));
      await answer('Status saved; the group message will be updated later', true);
    }
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



  await answer('Done');



  await api(env, 'editMessageReplyMarkup', {
    chat_id: q.message.chat.id,

    message_id: q.message.message_id,

    reply_markup: buttons(

      id,

      await blocked(env, m.telegram_chat_id)

    )

  }).catch(e => console.error('Markup:', String(e)));

}



async function handleUpdate(env, u) {

  if (u.callback_query) {

    return callback(env, u.callback_query);

  }



  const m = u.message;

  if (!m) return;



  if (String(m.chat.id) === String(env.BOARD_CHAT_ID)) {

    return receiveBoard(env, m);

  }



  if (m.chat.type === 'private') {

    return receiveMember(env, m);

  }

}



async function buildBoardPostDetails(env, m) {
  // Only successfully delivered replies may appear on the board.
  const result = await env.DB.prepare(`
    SELECT r.id, r.admin_name, r.reply_text, r.reply_type
    FROM message_replies r
    INNER JOIN delivery_jobs j
      ON j.message_id = r.id AND j.job_type = 'reply'
    WHERE r.message_id = ? AND j.state = 'done'
    ORDER BY r.id ASC
  `).bind(m.id).all();
  const replies = result.results || [];
  const name = [m.telegram_first_name, m.telegram_last_name]
    .filter(Boolean).join(' ') || 'Name not provided';
  const username = m.telegram_username
    ? '@' + String(m.telegram_username).replace(/^@/, '') : 'none';
  const categoryIcon = {
    'Question': '❓', 'Suggestion': '💡', 'Feedback': '📢'
  }[m.category] || '📨';
  const lastResponder = replies.length
    ? (replies[replies.length - 1].admin_name || 'Unknown') : null;
  const status = m.status === 'Resolved'
    ? '✅ Resolved'
    : replies.length ? '✅ Mark resolved' : '⏳ Awaiting reply';

  const prefix =
    `━━━━━━━━━━━━━━━━━━━━\n📨 New support ticket\n━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${categoryIcon} ${m.category || 'Message'}\n` +
    `🎯 Program: ${m.program_name || 'General'}\n\n` +
    `👤 Name: ${name}\n🔗 Username: ${username}\n` +
    `🆔 Telegram ID: ${m.telegram_chat_id}\n\n` +
    `💬 User message:\n`;
  const section = `\n\n━━━━━━━━━━━━━━━━━━━━\n💬 Support replies:\n\n`;
  const suffix = `\n\n━━━━━━━━━━━━━━━━━━━━\n📌 Status: ${status}` +
    (lastResponder ? `\n👤 Last responder: ${lastResponder}` : '');
  const limit = 4096;
  // Reserve space for the status and reply section even for a long question.
  const maxQuestion = Math.max(0, limit - prefix.length - section.length -
    suffix.length - 110);
  const originalQuestion = String(m.message_text || '');
  const question = originalQuestion.length > maxQuestion
    ? originalQuestion.slice(0, Math.max(0, maxQuestion - 32)) +
      '\n… Full message is stored in the database.'
    : originalQuestion;
  const base = prefix + question + section;
  const available = limit - base.length - suffix.length;
  const visible = [];
  let used = 0;
  // Prefer the latest replies when the post is too long.
  for (let i = replies.length - 1; i >= 0; i--) {
    const r = replies[i];
    const content = r.reply_text || `[${r.reply_type || 'message'}]`;
    const entry = `👤 ${r.admin_name || 'Unknown'}:\n${content}`;
    const needed = entry.length + (visible.length ? 2 : 0);
    if (used + needed + 70 > available) break;
    visible.unshift({ id: r.id, entry });
    used += needed;
  }
  const omitted = replies.length - visible.length;
  const omittedNote = omitted
    ? `⚠️ ${omitted} older replies are stored in the database.\n\n`
    : '';
  const replySection = visible.length
    ? omittedNote + visible.map(r => r.entry).join('\n\n')
    : (omitted ? '⚠️ Replies exceed the Telegram message limit; the full history is stored in the database.'
      : 'No replies yet.');
  const text = base + replySection + suffix;
  if (text.length > limit) {
    // Never silently truncate a reply and then delete its original.
    const fallback = base + '⚠️ Replies are stored in the database.' + suffix;
    return { text: fallback.slice(0, limit), visibleReplyIds: [] };
  }
  return { text, visibleReplyIds: visible.map(r => r.id) };
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

        await blocked(env, m.telegram_chat_id)

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

    const header = await buildBoardPost(env, m);



    const sent = await send(

      env,

      env.BOARD_CHAT_ID,

      header.slice(0, 4096),

      { reply_markup: buttons(m.id) }

    );



    id = sent.message_id;



    await env.DB.prepare(`

      UPDATE messages

      SET board_message_id = ?,

          status = 'Open'

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

      `📬 Support team reply:\n\n` +

      r.reply_text

    );

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

      SET status = 'Answered',

          replied_at = CURRENT_TIMESTAMP

      WHERE id = ?

      AND status != 'Resolved'

    `).bind(id).run();

  } else {

    await env.DB.prepare(`

      UPDATE messages

      SET status = 'Awaiting_reply'

      WHERE id = ?

     AND status != 'Resolved'

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


// DELIVERY QUEUE*



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
            '✅ Your request was recorded and forwarded to the support team.',
            { reply_markup: MENU });
          await env.DB.prepare(`
            UPDATE messages SET acknowledgement_sent_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(m.id).run();
        }
      } else if (job.job_type === 'member') {
        // Compatibility with older v3 jobs.
        if (m.status !== 'Answered' && m.status !== 'Resolved' && m.reply_text) {
          await send(env, m.telegram_chat_id,
            '📬 Support team reply:\n\n' + m.reply_text);
          await env.DB.prepare(`
            UPDATE messages SET status = 'Answered',
              replied_at = CURRENT_TIMESTAMP WHERE id = ?
              AND status != 'Resolved'
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

    LIMIT 20

  `).all();



  for (const job of jobs.results || []) {

    await processJob(env, job);

  }

  // Retry board edits/deletions ONLY; never resend delivered member replies.
  // A short delay avoids hammering Telegram on transient errors.
  const reconciliation = await env.DB.prepare(`
    SELECT id, message_id FROM delivery_jobs
    WHERE job_type = 'reply' AND state = 'done'
      AND last_error LIKE 'board_retry:%'
      AND updated_at < datetime('now', '-5 minutes')
    ORDER BY updated_at ASC LIMIT 10
  `).all();
  for (const job of reconciliation.results || []) {
    await reconcileBoardReply(env, job);
  }

}



// GOOGLE SHEETS
async function syncSheets(env) {

  if (!env.SHEETS_SYNC_URL || !env.SHEETS_SYNC_SECRET) {

    throw Error('Sheets config missing');

  }



  const rows = await env.DB.prepare(`

    SELECT

      id,

      telegram_chat_id,

      telegram_username,

      category,

      program_name,

      message_text,

      message_type,

      status,

      reply_text,

      created_at,

      replied_at,

      board_message_id

    FROM messages

    ORDER BY id DESC

    LIMIT 100

  `).all();



  let synced = 0;

  let failed = 0;



  for (const m of rows.results || []) {

    try {

      const r = await fetch(env.SHEETS_SYNC_URL, {

        method: 'POST',

        headers: {

          'Content-Type': 'text/plain;charset=utf-8'

        },

        body: JSON.stringify({

          secret: env.SHEETS_SYNC_SECRET,

          message_id: String(m.id),

          telegram_chat_id: m.telegram_chat_id,

          telegram_username: m.telegram_username,

          category: m.category,

          program_name: m.program_name,

          message_type: m.message_type,

          message_text: m.message_text,

          status: m.status,

          reply_text: m.reply_text,

          created_at: m.created_at,

          replied_at: m.replied_at,

          board_message_id: m.board_message_id

        }),

        redirect: 'follow'

      });



      const result = await r.json();



      if (!r.ok || result.ok !== true) {

        throw Error(result.error || 'Sheets sync failed');

      }



      synced++;

    } catch (e) {

      failed++;

      console.error('Sheets:', m.id, String(e));

    }

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

        service: 'telegram-support-ticketing-system',

        version: '1.0.0-dev'

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

      await drain(env);



      if (

        env.SHEETS_SYNC_URL &&

        env.SHEETS_SYNC_SECRET

      ) {

        await syncSheets(env);

      }

    })());

  }

};