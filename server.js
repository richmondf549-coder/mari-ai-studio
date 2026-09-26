import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';

const HISTORY_FILE = path.resolve('history.json');
const MEMORY_FILE = path.resolve('memory.json');
const CHATS_FILE = path.resolve('chats.json');

const MARI_SYSTEM_INSTRUCTION = `
You are Mari, the personal AI assistant inside Mari AI Studio.

Your name is Mari.
Do not identify yourself as Google Gemini, Google's AI, ChatGPT, or another assistant.
Be helpful, intelligent, natural, concise when appropriate, and conversational.

When answering:
- Use clean Markdown formatting when useful.
- Use headings, bullet points, numbered lists, tables, and code blocks when appropriate.
- Give direct answers first.
- For programming questions, provide clear working code and explain important parts.
- Do not unnecessarily repeat the user's question.
- If the user asks for a short answer, keep it short.
`;

function ensureFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(fallback, null, 2)
    );
  }
}

function readJSON(file, fallback) {
  try {
    ensureFile(file, fallback);
    return JSON.parse(
      fs.readFileSync(file, 'utf8')
    );
  } catch (error) {
    console.error(`JSON read error: ${file}`);
    console.error(error);
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );
}

function getChats() {
  return readJSON(CHATS_FILE, []);
}

function saveChats(chats) {
  writeJSON(CHATS_FILE, chats);
}

function createChat() {
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function createTitle(prompt) {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'New chat';
  }

  return cleaned.length > 35
    ? `${cleaned.slice(0, 35)}...`
    : cleaned;
}

function temporaryError(error) {
  const message =
    error?.message ||
    error?.cause?.message ||
    String(error);

  return (
    message.includes('503') ||
    message.includes('UNAVAILABLE') ||
    message.includes('fetch failed') ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    message.includes('socket')
  );
}

function logFullError(label, error) {
  console.error(`\n===== ${label} =====`);
  console.error('message:', error?.message);
  console.error('name:', error?.name);
  console.error('code:', error?.code);
  console.error('status:', error?.status);
  console.error('cause:', error?.cause);
  console.error('stack:', error?.stack);
  console.error('raw:', error);
  console.error('====================\n');
}

function sendEvent(res, data) {
  res.write(
    `data: ${JSON.stringify(data)}\n\n`
  );
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Mari AI',
    model: PRIMARY_MODEL,
    streaming: true
  });
});

app.get('/api/chats', (req, res) => {
  const chats = getChats();

  res.json(
    chats
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt) -
          new Date(a.updatedAt)
      )
  );
});

app.get('/api/chats/:id', (req, res) => {
  const chats = getChats();

  const chat = chats.find(
    item => item.id === req.params.id
  );

  if (!chat) {
    return res.status(404).json({
      error: 'Chat not found.'
    });
  }

  res.json(chat);
});

app.post('/api/chats', (req, res) => {
  const chats = getChats();

  const chat = createChat();

  chats.push(chat);

  saveChats(chats);

  res.status(201).json(chat);
});

app.delete('/api/chats/:id', (req, res) => {
  const chats = getChats();

  const filtered = chats.filter(
    item => item.id !== req.params.id
  );

  if (filtered.length === chats.length) {
    return res.status(404).json({
      error: 'Chat not found.'
    });
  }

  saveChats(filtered);

  res.json({
    success: true
  });
});

app.post('/api/chat/stream', async (req, res) => {
  const prompt =
    typeof req.body?.prompt === 'string'
      ? req.body.prompt.trim()
      : '';

  const chatId =
    typeof req.body?.chatId === 'string'
      ? req.body.chatId
      : '';

  if (!prompt) {
    return res.status(400).json({
      error: 'Please enter a message.'
    });
  }

  if (!chatId) {
    return res.status(400).json({
      error: 'Chat ID is required.'
    });
  }

  if (prompt.length > 10000) {
    return res.status(400).json({
      error: 'Message is too long.'
    });
  }

  res.setHeader(
    'Content-Type',
    'text/event-stream'
  );

  res.setHeader(
    'Cache-Control',
    'no-cache'
  );

  res.setHeader(
    'Connection',
    'keep-alive'
  );

  res.flushHeaders();

  try {
    const chats = getChats();

    const chat = chats.find(
      item => item.id === chatId
    );

    if (!chat) {
      throw new Error('Chat not found.');
    }

    chat.messages.push({
      role: 'user',
      parts: [{ text: prompt }],
      createdAt: new Date().toISOString()
    });

    if (chat.title === 'New chat') {
      chat.title = createTitle(prompt);
    }

    chat.updatedAt =
      new Date().toISOString();

    saveChats(chats);

    const recentMessages =
      chat.messages.slice(-20);

    const contents =
      recentMessages.map(message => ({
        role: message.role,
        parts: message.parts
      }));

    const config = {
      systemInstruction:
        MARI_SYSTEM_INSTRUCTION
    };

    let stream;

    try {
      console.log(
        `Streaming ${PRIMARY_MODEL}`
      );

      stream =
        await ai.models.generateContentStream({
          model: PRIMARY_MODEL,
          contents,
          config
        });

    } catch (error) {
      logFullError(
        'INITIAL STREAM ERROR',
        error
      );

      if (!temporaryError(error)) {
        throw error;
      }

      console.log(
        'Quick streaming retry...'
      );

      await new Promise(resolve =>
        setTimeout(resolve, 1000)
      );

      try {
        stream =
          await ai.models.generateContentStream({
            model: PRIMARY_MODEL,
            contents,
            config
          });

      } catch (retryError) {
        logFullError(
          'STREAM RETRY ERROR',
          retryError
        );

        throw retryError;
      }
    }

    let fullText = '';

    try {
      for await (const chunk of stream) {
        const text = chunk?.text || '';

        if (!text) continue;

        fullText += text;

        sendEvent(res, {
          type: 'chunk',
          text
        });
      }
    } catch (streamError) {
      logFullError(
        'STREAM ITERATION ERROR',
        streamError
      );

      throw streamError;
    }

    if (!fullText.trim()) {
      throw new Error(
        'Empty response from Gemini.'
      );
    }

    chat.messages.push({
      role: 'model',
      parts: [{ text: fullText }],
      createdAt: new Date().toISOString()
    });

    chat.updatedAt =
      new Date().toISOString();

    saveChats(chats);

    sendEvent(res, {
      type: 'done',
      model: PRIMARY_MODEL,
      chatId: chat.id,
      title: chat.title
    });

    res.end();

    console.log(
      `Stream complete: ${chat.id}`
    );

  } catch (error) {
    logFullError(
      'MARI STREAMING ERROR',
      error
    );

    if (!res.writableEnded) {
      sendEvent(res, {
        type: 'error',
        error:
          error?.message ||
          'Mari could not complete the response.'
      });

      res.end();
    }
  }
});

ensureFile(HISTORY_FILE, []);
ensureFile(MEMORY_FILE, []);
ensureFile(CHATS_FILE, []);

app.use(express.static(path.resolve('public')));


app.listen(PORT, () => {
  console.log(
    `Mari AI Streaming Online on port ${PORT}`
  );

  console.log(
    `Streaming ${PRIMARY_MODEL}`
  );
});
