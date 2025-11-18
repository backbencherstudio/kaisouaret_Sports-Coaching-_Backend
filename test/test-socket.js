// test-socket.js
const { io } = require('socket.io-client');

const BASE = 'http://localhost:4003'; // or 4003
const TOKEN = process.env.SOCKET_TOKEN; // set before running or paste token string here
const conversationId = process.env.CONV_ID; // optional
const recipientUserId = process.env.RECIPIENT_ID; // coach id

// Connect with auth token — this will be available at server via client.handshake.auth.token
const socket = io(BASE, {
  auth: { token: TOKEN },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('connected', socket.id);

  // Join the conversation room (optional)
  socket.emit('joinRoom', { room_id: conversationId }, (ack) => {
    console.log('joinRoom ack', ack);
  });

  // Send a message event (server will forward to recipient)
  const payload = {
    to: recipientUserId,
    data: {
      // server will set sender from authenticated socket; data is the message body
      body: 'Hello via socket!',
      conversation_id: conversationId,
      created_at: new Date().toISOString(),
    },
  };

  console.log('emitting sendMessage', payload);
  socket.emit('sendMessage', payload);
});

socket.on('message', (m) => {
  console.log('message received', m);
});

socket.on('userTyping', (m) => {
  console.log('userTyping', m);
});

socket.on('userStatusChange', (m) => {
  console.log('userStatusChange', m);
});

socket.on('disconnect', () => {
  console.log('disconnected');
});