const express = require('express');
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
    res.json({ reply: completion.choices[0].message.content });
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
  <style>
    body {
      font-family: Arial;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #333;
      text-align: center;
    }
    #chat-box {
      background: white;
      border-radius: 10px;
      padding: 20px;
      height: 400px;
      overflow-y: auto;
      margin-bottom: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .message {
      margin: 10px 0;
      padding: 10px;
      border-radius: 5px;
    }
    .user {
      background: #007bff;
      color: white;
      text-align: right;
    }
    .bot {
      background: #e9ecef;
      color: #333;
    }
    #input-area {
      display: flex;
      gap: 10px;
    }
    input {
      flex: 1;
      padding: 15px;
      border: 2px solid #ddd;
      border-radius: 5px;
      font-size: 16px;
    }
    button {
      padding: 15px 30px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background: #0056b3;
    }
    .loading {
      color: #999;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>🤖 Chat with DeepSeek AI</h1>
  <div id="chat-box"></div>
  <div id="input-area">
    <input type="text" id="message" placeholder="Type your message here..." />
    <button onclick="sendMessage()">Send</button>
  </div>

  <script>
    const chatBox = document.getElementById('chat-box');
    const messageInput = document.getElementById('message');

    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });

    async function sendMessage() {
      const message = messageInput.value.trim();
      if (!message) return;

      addMessage('user', message);
      messageInput.value = '';

      const loadingDiv = addMessage('bot', 'Thinking...');
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
        addMessage('bot', 'Error: Could not connect to AI');
      }
    }

    function addMessage(sender, text) {
      const div = document.createElement('div');
      div.className = 'message ' + sender;
      div.textContent = text;
      chatBox.appendChild(div);
      chatBox.scrollTop = chatBox.scrollHeight;
      return div;
    }
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => console.log('Bot running on port ' + PORT));
