const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, { pingInterval: 2000, pingTimeout: 5000 });

// Serve static files
app.use(express.static('public'));

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// Store players and WebRTC connections
const players = {};
const peerConnections = {};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Generate random color
  function getRandomColor() {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 100);
    const l = Math.floor(Math.random() * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  // Create a new player
  players[socket.id] = {
    x: 500 * Math.random(),
    y: 500 * Math.random(),
    r: 10,
    color: getRandomColor(),
  };

  // Emit updated players list to all clients
  io.emit('backendPlayers', players);

  // Handle proximity detection
  socket.on('proximityDetected', ({ player1Id, player2Id }) => {
    io.to(player1Id).emit('initiateCall', player2Id);
    io.to(player2Id).emit('initiateCall', player1Id);
    io.emit("callConnected", { player1Id, player2Id });
  });

  socket.on("updatePosition", ({ id, x, y }) => {
    if (players[id]) {
      players[id].x = x;
      players[id].y = y;
  
      // Broadcast updated position to all clients
      io.emit("backendPlayers", players);
    }
  });
  // Handle WebRTC signaling
  const connections = {};

  // Handle WebRTC signaling
  socket.on("signal", ({ to, from, signalData }) => {
    socket.to(to).emit("signal", { from, signalData });
  
    // When the SDP offer/answer is successfully exchanged, mark the connection as established
    if (signalData.sdp && signalData.sdp.type === "answer") {
      if (!connections[from]) connections[from] = {};
      if (!connections[to]) connections[to] = {};
  
      connections[from][to] = true;
      connections[to][from] = true;
  
      // Emit connection success to both players
      io.to(from).emit("connectionSuccess", { player1Id: from, player2Id: to });
      io.to(to).emit("connectionSuccess", { player1Id: from, player2Id: to });
    }
  });

  // Handle player disconnection
  socket.on('playerDisconnected', (playerId) => {
    if (peerConnections[playerId]) {
      peerConnections[playerId].close();
      delete peerConnections[playerId];
    }
  });

  // Handle socket disconnection
  socket.on('disconnect', (reason) => {
    console.log(`User ${socket.id} disconnected: ${reason}`);

    // Remove the player immediately
    if (players[socket.id]) {
      delete players[socket.id];
      io.emit('backendPlayers', players); // Notify all clients
    }

    // Clean up WebRTC connections
    if (peerConnections[socket.id]) {
      peerConnections[socket.id].close();
      delete peerConnections[socket.id];
    }
  });
});

// Start the server
server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});