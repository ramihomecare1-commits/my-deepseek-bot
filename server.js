const express = require('express');
const { marked } = require('marked');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static('public'));
app.use(express.json());

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.API_KEY
});

app.post('/chat', async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek/deepseek-r1:free',
      messages: [{ role: 'user', content: req.body.message }]
    });
    
    const reply = completion.choices[0].message.content;
    const htmlReply = marked.parse(reply);
    res.json({ reply: htmlReply });
  } catch (error) {
    res.json({ reply: 'Sorry, I had an error. Try again!' });
  }
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>DeepSeek Chat</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: calc(100vh - 40px);
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 25px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .header h1 {
      font-size: 28px;
      margin-bottom: 5px;
    }
    
    .header p {
      opacity: 0.9;
      font-size: 14px;
    }
    
    #chat-box {
      flex: 1;
      padding: 20px;
      overflow-y: auto;
      background: #f8f9fa;
    }
    
    .message {
      margin: 15px 0;
      padding: 15px 20px;
      border-radius: 18px;
      max-width: 80%;
      animation: slideIn 0.3s ease;
      word-wrap: break-word;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .user {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      margin-left: auto;
      border-bottom-right-radius: 4px;
    }
    
    .bot {
      background: white;
      color: #333;
      border: 1px solid #e0e0e0;
      border-bottom-left-radius: 4px;
      line-height: 1.6;
    }
    
    .bot h1, .bot h2, .bot h3 {
      margin-top: 15px;
      margin-bottom: 10px;
      color: #667eea;
    }
    
    .bot h1 { font-size: 24px; }
    .bot h2 { font-size: 20px; }
    .bot h3 { font-size: 18px; }
    
    .bot ul, .bot ol {
      margin-left: 20px;
      margin-bottom: 10px;
    }
    
    .bot li {
      margin: 5px 0;
    }
    
    .bot p {
      margin-bottom: 10px;
    }
    
    .bot strong {
      color: #667eea;
      font-weight: 600;
    }
    
    .bot code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 14px;
    }
    
    .bot pre {
      background: #2d2d2d;
      color: #f8f8f2;
      padding: 15px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 10px 0;
    }
    
    .bot pre code {
      background: none;
      color: inherit;
      padding: 0;
    }
    
    .loading {
      color: #999;
      font-style: italic;
    }
    
    #input-area {
      padding: 20px;
      background: white;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 10px;
    }
    
    input {
      flex: 1;
      padding: 15px 20px;
      border: 2px solid #e0e0e0;
      border-radius: 25px;
      font-size: 16px;
      outline: none;
      transition: border-color 0.3s;
    }
    
    input:focus {
      border-color: #667eea;
    }
    
    button {
      padding: 15px 35px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 25px;
      cursor: pointer;
      font-size: 16px;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    #chat-box::-webkit-scrollbar {
      width: 8px;
    }
    
    #chat-box::-webkit-scrollbar-track {
      background: #f1f1f1;
    }
    
    #chat-box::-webkit-scrollbar-thumb {
      background: #667eea;
      border-radius: 4px;
    }
    
    @media (max-width: 600px) {
      .container {
        height: 100vh;
        border-radius: 0;
      }
      
      .header h1 {
        font-size: 24px;
      }
      
      .message {
        max-width: 90%;
      }
      
      button {
        padding: 15px 25px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 DeepSeek AI Chat</h1>
      <p>Powered by DeepSeek R1 - Ask me anything!</p>
    </div>
    
    <div id="chat-box">
      <div class="message bot">
        <strong>👋 Hello!</strong> I'm powered by DeepSeek R1. How can I help you today?
      </div>
    </div>
    
    <div id="input-area">
      <input 
        type="text" 
        id="message" 
        placeholder="Type your message here..." 
        autocomplete="off"
      />
      <button onclick="sendMessage()" id="sendBtn">Send</button>
    </div>
  </div>

  <script>
    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message');
    const sendBtn = document.getElementById('sendBtn');

    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !sendBtn.disabled) {
        sendMessage();
      }
    });

    async function sendMessage() {
      const message = messageInput.value.trim();
      if (!message) return;

      sendBtn.disabled = true;
      messageInput.disabled = true;

      addMessage('user', message);
      messageInput.value = '';

      const loadingDiv = addMessage('bot', '🤔 Thinking...');
      loadingDiv.classList.add('loading');

      try {
        const response = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        const data = await response.json();
        
        loadingDiv.remove();
        addMessage('bot', data.reply);
      } catch (error) {
        loadingDiv.remove();
        addMessage('bot', '❌ <strong>Error:</strong> Could not connect to AI. Please try again.');
      }

      sendBtn.disabled = false;
      messageInput.disabled = false;
      messageInput.focus();
    }

    function addMessage(sender, text) {
      const div = document.createElement('div');
      div.className = 'message ' + sender;
      
      if (sender === 'bot') {
        div.innerHTML = text;
      } else {
        div.textContent = text;
      }
      
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
      return div;
    }

    messageInput.focus();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log('✅ Bot running on port ' + PORT));
