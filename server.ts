import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import dotenv from 'dotenv';
import multer from 'multer';
import mammoth from 'mammoth';
import nodemailer from 'nodemailer';
import { createRequire } from 'module';
import { analyzeAccountHealth, analyzeMeetingIntelligence, analyzeTender, classifyEmail, createBidDraft, generateReplyDraft, generateStructuredProposal, generateTaskAlerts, improveProposalSection, ocrDocument, prioritizeTask } from './server/ai/geminiService';
import { generateProactiveAlerts, routeIntent } from './server/ai/aiOrchestrator';
const require = createRequire(import.meta.url);

dotenv.config();

// Process-level error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS_ORIGIN.`));
  }
}));
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = Number(process.env.PORT || 3000);

// IMAP Configuration
const imapConfig = {
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: {
    user: 'elvis.wiki@gmail.com',
    pass: process.env.EMAIL_PASSWORD || '',
  },
  logger: false as const,
};

let sessionEmailPassword = process.env.EMAIL_PASSWORD || '';

const upload = multer({ storage: multer.memoryStorage() });

const handleAIRequest = async (res: express.Response, runner: () => Promise<unknown>) => {
  try {
    const result = await runner();
    res.json({ result });
  } catch (error: any) {
    console.error('AI request failed:', error);
    res.status(500).json({
      error: 'AI request failed',
      details: error?.message || 'Unknown AI error'
    });
  }
};

app.post('/api/ai/classify-email', async (req, res) => {
  await handleAIRequest(res, () => classifyEmail(req.body.email, req.body.customPrompt, req.body.config));
});

app.post('/api/ai/analyze-tender', async (req, res) => {
  await handleAIRequest(res, () => analyzeTender(req.body.tenderText, req.body.customPrompt, req.body.config));
});

app.post('/api/ai/create-bid-draft', async (req, res) => {
  await handleAIRequest(res, () => createBidDraft(req.body.tenderAnalysis, req.body.customPrompt, req.body.config));
});

app.post('/api/ai/ocr-document', async (req, res) => {
  await handleAIRequest(res, () => ocrDocument(req.body.base64Data, req.body.mimeType, req.body.config));
});

app.post('/api/ai/analyze-meeting-intelligence', async (req, res) => {
  await handleAIRequest(res, () => analyzeMeetingIntelligence(req.body.notes, req.body.config));
});

app.post('/api/ai/generate-reply-draft', async (req, res) => {
  await handleAIRequest(res, () => generateReplyDraft(req.body.email, req.body.userPrompt, req.body.config));
});

app.post('/api/ai/prioritize-task', async (req, res) => {
  await handleAIRequest(res, () => prioritizeTask(req.body.task, req.body.context, req.body.config));
});

app.post('/api/ai/generate-task-alerts', async (req, res) => {
  await handleAIRequest(res, () => generateTaskAlerts(req.body.tasks, req.body.config));
});

app.post('/api/ai/analyze-account-health', async (req, res) => {
  await handleAIRequest(res, () => analyzeAccountHealth(req.body.account, req.body.interactions, req.body.opportunities, req.body.config));
});

app.post('/api/ai/generate-structured-proposal', async (req, res) => {
  await handleAIRequest(res, () => generateStructuredProposal(req.body.context, req.body.config));
});

app.post('/api/ai/improve-proposal-section', async (req, res) => {
  await handleAIRequest(res, () => improveProposalSection(req.body.sectionContent, req.body.instruction, req.body.config));
});

app.post('/api/ai/route-intent', async (req, res) => {
  await handleAIRequest(res, () => routeIntent(req.body.message, req.body.userContext, req.body.memory));
});

app.post('/api/ai/generate-proactive-alerts', async (req, res) => {
  await handleAIRequest(res, () => generateProactiveAlerts(req.body.userContext, req.body.businessCache));
});

app.get('/api/ai/health', async (_req, res) => {
  const configured = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    configured,
    backend: 'google-genai',
    provider: 'Google API key via App Hosting secret',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/ai/test', async (_req, res) => {
  await handleAIRequest(res, async () => {
    const response = await generateReplyDraft(
      {
        from: 'system@isbim.local',
        subject: 'AI connectivity check',
        body: 'Reply with exactly: AI connection OK'
      },
      'Reply with exactly: AI connection OK',
      { model: 'gemini-3-flash-preview' }
    );

    return {
      ok: response.toLowerCase().includes('ai connection ok'),
      response
    };
  });
});

app.post('/api/tenders/upload', upload.array('files'), async (req: any, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  try {
    const pdf = require('pdf-parse');
    const results = [];
    
    for (const file of req.files) {
      let text = '';
      const buffer = file.buffer;
      const mimetype = file.mimetype;
      const filename = file.originalname.toLowerCase();

      if (mimetype === 'application/pdf' || filename.endsWith('.pdf')) {
        try {
          const data = await pdf(buffer);
          text = data.text;
          
          // If text is very short but there are pages, it's likely a scanned PDF
          if ((!text || text.trim().length < 100) && data.numpages > 0) {
            results.push({
              name: file.originalname,
              type: 'ocr_needed',
              mimeType: mimetype,
              data: buffer.toString('base64')
            });
            continue;
          }
        } catch (pdfErr) {
          console.error(`PDF parse error for ${file.originalname}:`, pdfErr);
          // Fallback to OCR if parsing fails completely
          results.push({
            name: file.originalname,
            type: 'ocr_needed',
            mimeType: mimetype,
            data: buffer.toString('base64')
          });
          continue;
        }
      } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      } else if (mimetype === 'text/plain' || filename.endsWith('.txt')) {
        text = buffer.toString('utf-8');
      } else if (mimetype.startsWith('image/')) {
        // Images always need OCR
        results.push({
          name: file.originalname,
          type: 'ocr_needed',
          mimeType: mimetype,
          data: buffer.toString('base64')
        });
        continue;
      } else {
        console.warn(`Skipping unsupported file type: ${filename}`);
        continue;
      }

      if (text && text.trim().length > 0) {
        results.push({
          name: file.originalname,
          type: 'text',
          content: text
        });
      }
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Could not extract any content from the uploaded documents.' });
    }

    res.json({ results });
  } catch (error: any) {
    console.error('File extraction error:', error);
    res.status(500).json({ error: 'Failed to process files', details: error.message });
  }
});

app.post('/api/config/password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  sessionEmailPassword = password;
  res.json({ success: true });
});

app.post('/api/emails/send', async (req, res) => {
  const { connection, message } = req.body;

  if (!connection || !connection.user || !connection.password || !connection.host) {
    return res.status(400).json({ error: 'Invalid Connection Config' });
  }

  if (!message || !message.to || !message.subject || !message.body) {
    return res.status(400).json({ error: 'Missing message details (to, subject, body)' });
  }

  // Common SMTP hosts based on IMAP hosts
  let smtpHost = connection.host.replace('imap.', 'smtp.');
  if (connection.host === 'imap.gmail.com') smtpHost = 'smtp.gmail.com';
  if (connection.host === 'outlook.office365.com') smtpHost = 'smtp.office365.com';
  
  const transporter = nodemailer.createTransport({
    host: connection.smtpHost || smtpHost,
    port: connection.smtpPort || 465,
    secure: connection.smtpPort === 465 || connection.smtpPort === undefined,
    auth: {
      user: connection.user,
      pass: connection.password,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  try {
    const info = await transporter.sendMail({
      from: `"${connection.name || connection.user}" <${connection.user}>`,
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: message.html || undefined,
    });

    console.log(`Email sent: ${info.messageId} from ${connection.user}`);
    res.json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    console.error('SMTP Send Error:', error);
    res.status(500).json({ error: 'Failed to send email', details: error.message });
  }
});

app.post('/api/emails/folders', async (req, res) => {
  const { connection } = req.body;
  
  if (!connection || !connection.user || !connection.password || !connection.host) {
    return res.status(400).json({ error: 'Invalid Connection Config' });
  }

  const client = new ImapFlow({
    host: connection.host,
    port: connection.port || 993,
    secure: connection.secure !== undefined ? connection.secure : true,
    auth: {
      user: connection.user,
      pass: connection.password,
    },
    logger: false,
    tls: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    const folders = await client.list();
    await client.logout();
    res.json({ folders: folders.map(f => ({ path: f.path, name: f.name, delimiter: f.delimiter })) });
  } catch (err: any) {
    console.error('IMAP List Folders Error:', err);
    try { await client.logout(); } catch (e) {}
    res.status(500).json({ error: 'Failed to fetch folders', details: err.message });
  }
});

app.post('/api/emails/sync', async (req, res) => {
  const { connection } = req.body;
  const mailboxPath = req.body.mailbox || 'INBOX';
  
  if (!connection || !connection.user || !connection.password || !connection.host) {
    return res.status(400).json({ 
      error: 'Invalid Connection Config', 
      details: 'Please provide host, user, and password in the connection object.' 
    });
  }

  const currentPassword = connection.password.trim();
  const host = connection.host.trim();
  const user = connection.user.trim();
  const port = connection.port || 993;
  const secure = connection.secure !== undefined ? connection.secure : true;
  const days = req.body.days || 7; // Default to 7 days if not provided

  console.log(`Attempting IMAP connection for: ${user} at ${host}:${port} (Password length: ${currentPassword.length}, Days: ${days})`);
  
  const client = new ImapFlow({
    host: host,
    port: port,
    secure: secure,
    auth: {
      user: user,
      pass: currentPassword,
      loginMethod: 'LOGIN' // Force LOGIN method
    },
    clientInfo: {
      name: 'Outlook', // Mimic a well-known client as some servers are picky
      version: '16.0'
    },
    logger: false,
    qresync: false,
    disableCompression: true,
    greetingTimeout: 30000,
    connectionTimeout: 30000,
    tls: {
      servername: host,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  });

  // Handle background errors to prevent unhandled rejections
  client.on('error', err => {
    console.error(`IMAP Client Error (${user}):`, err);
  });

  const maxRetries = 2;
  let attempt = 0;
  let connected = false;

  while (attempt <= maxRetries && !connected) {
    try {
      console.log(`Connecting to IMAP ${user} (Attempt ${attempt + 1})...`);
      await client.connect();
      connected = true;
    } catch (connErr: any) {
      attempt++;
      console.error(`Status 401: IMAP attempt ${attempt} for ${user} failed: ${connErr.message}`);
      
      // Specifically catch authentication failures
      if (connErr.authenticationFailed || attempt > maxRetries) {
        try { await client.logout(); } catch (e) {}
        let responseMessage = 'Authentication Failed: ' + connErr.message;
        
        // Add helpful hints for known tricky providers
        if (host.includes('qq.com') || host.includes('163.com')) {
          responseMessage += '. For QQ/Exmail/NetEase, please ensure you are using an "Authorization Code" or "App Password" instead of your regular password, and that IMAP service is enabled in your webmail settings.';
        }
        
        return res.status(401).json({ 
          error: 'Authentication Failed', 
          details: responseMessage
        });
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  try {
    let lock;
    try {
      lock = await client.getMailboxLock(mailboxPath);
    } catch (lockErr) {
      console.error(`Failed to get mailbox lock for ${mailboxPath}:`, lockErr);
      try { await client.logout(); } catch (e) {}
      return res.status(500).json({ 
        error: 'Mailbox Lock Failed', 
        details: `Could not lock the ${mailboxPath}.` 
      });
    }

    const emails = [];

    try {
      let mailbox = await client.mailboxOpen(mailboxPath, { readOnly: true });
      const total = mailbox.exists;
      console.log(`Mailbox opened for ${user}. Total messages: ${total}`);

      if (total > 0) {
        // Use search to find emails within the specified days
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        
        console.log(`Searching for messages since ${sinceDate.toISOString()} for ${user}...`);
        
        const uids = await client.search({ since: sinceDate });
        const uidsCount = uids ? uids.length : 0;
        console.log(`Found ${uidsCount} messages in specified date range for ${user}`);

        if (uids && uids.length > 0) {
          const fetchOptions = { 
            source: true,
            uid: true,
            size: true
          };

          for await (let message of client.fetch(uids, fetchOptions)) {
            try {
              if (message.size > 10 * 1024 * 1024) continue;
              const parsed = await simpleParser(message.source);
            
            const fromText = Array.isArray(parsed.from) 
              ? (parsed.from as any[]).map(f => f.text).join(', ') 
              : (parsed.from as any)?.text || '';

            const attachments = (parsed.attachments || []).map(att => ({
              filename: att.filename,
              contentType: att.contentType,
              size: att.size,
              content: att.contentType.startsWith('text/') || att.contentType === 'application/json' || att.contentType === 'text/csv' 
                ? att.content.toString('utf-8').substring(0, 50000)
                : null
            }));

            emails.push({
              uid: `${user}_${message.uid}`, // Unique ID per user/message
              subject: parsed.subject || '(No Subject)',
              from: fromText,
              to: Array.isArray(parsed.to) ? (parsed.to as any[]).map(t => t.text).join(', ') : (parsed.to as any)?.text || '',
              body: (parsed.text || '').substring(0, 100000),
              receivedAt: parsed.date?.toISOString() || new Date().toISOString(),
              account: user,
              attachments
            });
          } catch (parseErr) {
            console.error(`Failed to parse message ${message.uid} for ${user}:`, parseErr);
          }
        }
      }
    }
  } finally {
      if (lock) {
        try { lock.release(); } catch (e) {}
      }
    }

    await client.logout();
    res.json({ emails: emails.reverse() });
  } catch (err: any) {
    console.error('IMAP Error Detail:', err);
    try { await client.logout(); } catch (e) {}
    res.status(500).json({ error: 'Failed to sync emails', details: err.message });
  }
});

app.get('/api/emails/sync', async (req, res) => {
  // Backwards compatibility or error message
  res.status(405).json({ error: 'Method Not Allowed', details: 'Please use POST /api/emails/sync with connection payload.' });
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Global Error Handler:', err);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Started successfully`);
    console.log(`[SERVER] Running on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] NODE_ENV: ${process.env.NODE_ENV}`);
  });
}

startServer();
