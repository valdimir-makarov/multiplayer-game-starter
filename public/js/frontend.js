const canvas = document.querySelector("canvas");
const c = canvas.getContext("2d");
const socket = io();

canvas.width = innerWidth;
canvas.height = innerHeight;

let cursorX = canvas.width / 2;
let cursorY = canvas.height / 2;
let draggingPlayer = null; // Define the draggingPlayer variable here

const players = {}; // To store all players' data
const peerConnections = {}; // To store WebRTC peer connections
function showPopup(message) {
  const popup = document.createElement("div");
  popup.textContent = message;
  popup.style.position = "absolute";
  popup.style.top = "50%";
  popup.style.left = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
  popup.style.color = "white";
  popup.style.padding = "20px";
  popup.style.borderRadius = "8px";
  popup.style.zIndex = "1000";
  popup.style.fontFamily = "sans-serif";
  popup.style.textAlign = "center";
  
  document.body.appendChild(popup);

  // Remove the popup after 3 seconds
  setTimeout(() => {
    document.body.removeChild(popup);
  }, 3000);
}
// Player class to manage player rendering
class Player {
  constructor(x, y, r, color) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = color;
  }

  draw() {
    c.beginPath();
    c.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    c.fillStyle = this.color;
    c.fill();
    c.closePath();
  }

  isPointInside(mouseX, mouseY) {
    const dx = mouseX - this.x;
    const dy = mouseY - this.y;
    return Math.sqrt(dx * dx + dy * dy) < this.r;
  }
}

// Test players to check proximity distance
players['player1'] = new Player(100, 100, 10, 'red');
players['player2'] = new Player(120, 100, 10, 'blue'); // Within range of player1
players['player3'] = new Player(200, 200, 10, 'green'); // Out of range

// Calculate distance between two players
function calculateDistance(player1, player2) {
  const dx = player1.x - player2.x;
  const dy = player1.y - player2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Check proximity between players and initiate calls if necessary
function checkProximity() {
  const playerIds = Object.keys(players);

  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const player1 = players[playerIds[i]];
      const player2 = players[playerIds[j]];
      const distance = calculateDistance(player1, player2);

      if (distance <= 50) {
        console.log(`Proximity detected between ${playerIds[i]} and ${playerIds[j]}`);
        socket.emit("proximityDetected", {
          player1Id: playerIds[i],
          player2Id: playerIds[j],
        });
      }
    }
  }
}
socket.on("connectionSuccess", ({ player1Id, player2Id }) => {
  const message = `Connection successful between Player ${player1Id} and Player ${player2Id}!`;
  showPopup(message);
});
// Listen to updated players from the backend
socket.on("backendPlayers", (backendPlayers) => {
  console.log("Backend Players Received:", backendPlayers);

  // Remove players no longer in the backend
  for (const id in players) {
    if (!backendPlayers[id]) {
      delete players[id];
      if (peerConnections[id]) {
        peerConnections[id].close();
        delete peerConnections[id];
      }
    }
  }

  // Add new players or update existing ones
  for (const id in backendPlayers) {
    const playerData = backendPlayers[id];
    if (!players[id]) {
      players[id] = new Player(playerData.x, playerData.y, playerData.r, playerData.color);
    } else {
      players[id].x = playerData.x;
      players[id].y = playerData.y;
    }
  }
});

// Handle mouse down event to detect player dragging
canvas.addEventListener("mousedown", (event) => {
  const canvasRect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - canvasRect.left;
  const mouseY = event.clientY - canvasRect.top;

  for (const id in players) {
    if (players[id].isPointInside(mouseX, mouseY)) {
      draggingPlayer = id;
      break;
    }
  }
});

// Handle mouse move to update dragged player's position
canvas.addEventListener("mousemove", (event) => {
  if (draggingPlayer) {
    const canvasRect = canvas.getBoundingClientRect();
    players[draggingPlayer].x = event.clientX - canvasRect.left;
    players[draggingPlayer].y = event.clientY - canvasRect.top;

    socket.emit("updatePosition", {
      id: draggingPlayer,
      x: players[draggingPlayer].x,
      y: players[draggingPlayer].y,
    });
  }
});

// Handle mouse up to stop dragging
canvas.addEventListener("mouseup", () => {
  draggingPlayer = null;
});

// Handle WebRTC signaling
socket.on("signal", ({ from, signalData }) => {
  const peerConnection = peerConnections[from];

  if (signalData.sdp) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(signalData.sdp))
      .then(() => {
        if (signalData.sdp.type === "offer") {
          return peerConnection.createAnswer();
        }
      })
      .then((answer) => {
        if (answer) {
          return peerConnection.setLocalDescription(answer);
        }
      })
      .then(() => {
        if (peerConnection.localDescription) {
          socket.emit("signal", {
            to: from,
            from: socket.id,
            signalData: { sdp: peerConnection.localDescription },
          });
        }
      })
      .catch((error) => {
        console.error("Error handling SDP:", error);
      });
  } else if (signalData.candidate) {
    peerConnection.addIceCandidate(new RTCIceCandidate(signalData.candidate))
      .catch((error) => {
        console.error("Error adding ICE candidate:", error);
      });
  }
});

// Handle proximity detection and initiate calls
socket.on("proximityDetected", ({ player1Id, player2Id }) => {
  if (!peerConnections[player2Id]) {
    const peerConnection = new RTCPeerConnection();

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", {
          to: player2Id,
          from: socket.id,
          signalData: { candidate: event.candidate },
        });
      }
    };

    peerConnection.ontrack = (event) => {
      const remoteAudio = document.getElementById("remoteAudio");
      remoteAudio.srcObject = event.streams[0];
    };

    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
      })
      .catch((error) => {
        console.error("Error accessing media devices:", error);
      });

    peerConnections[player2Id] = peerConnection;

    peerConnection.createOffer()
      .then((offer) => {
        return peerConnection.setLocalDescription(offer);
      })
      .then(() => {
        socket.emit("signal", {
          to: player2Id,
          from: socket.id,
          signalData: { sdp: peerConnection.localDescription },
        });
      })
      .catch((error) => {
        console.error("Error creating offer:", error);
      });
  }
});

// Animation loop to render all players
function animate() {
  requestAnimationFrame(animate);
  c.fillStyle = "rgba(0, 0, 0, 0.1)";
  c.fillRect(0, 0, canvas.width, canvas.height);

  for (const id in players) {
    players[id].draw();
  }

  checkProximity();
}

animate();