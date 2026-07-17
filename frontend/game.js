// --- DEPLOYMENT CONFIG ---
// When deploying your backend to Render, change this line to your secure wss:// URL!
// Example: const WS_URL = "wss://coin-arena-backend.onrender.com/ws";
const WS_URL = "ws://localhost:8000/ws"; 

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreDisplay = document.getElementById("scoreDisplay");

const TILE_SIZE = 32;
const VIEW_TILES_W = 11; 
const VIEW_TILES_H = 15; 
let MAP_WIDTH = 20; 
let MAP_HEIGHT = 20;

canvas.width = VIEW_TILES_W * TILE_SIZE;
canvas.height = VIEW_TILES_H * TILE_SIZE;

// 1. Dynamic Graphic Loader
const imgTileset = new Image(); imgTileset.src = "assets/tileset.png";
const imgCoin = new Image(); imgCoin.src = "assets/coin.png";

// Load all character sprites into a dictionary
const spriteNames = [
    "player1", "player2", "player3", "player4", 
    "agent1", "agent2", "cult_leader", "animal", "human"
];
const characterSprites = {};
spriteNames.forEach(name => {
    characterSprites[name] = new Image();
    characterSprites[name].src = `assets/${name}.png`;
});

let mapData = [];
let players = {};
let coins = [];
let myPlayerId = null;
let ws = null; // WebSocket is null until user joins

// 2. Load the Static Map
fetch('map_data.json')
    .then(response => response.json())
    .then(data => {
        mapData = data.layers[0].data;
        MAP_WIDTH = data.width;   
        MAP_HEIGHT = data.height; 
        drawEngine(); 
    });

// 3. Lobby Flow & Server Connection
document.getElementById("joinBtn").addEventListener("click", () => {
    const mode = document.getElementById("modeSelect").value;
    
    // Hide Lobby, Show Game
    document.getElementById("lobbyUI").style.display = "none";
    document.getElementById("gameUI").style.display = "flex";

    // Connect to server with chosen mode
    ws = new WebSocket(`${WS_URL}?mode=${mode}`);

    ws.onmessage = (event) => {
        const serverState = JSON.parse(event.data);
        players = serverState.players;
        coins = serverState.coins;
        
        if (!myPlayerId) {
            const keys = Object.keys(players);
            myPlayerId = keys[keys.length - 1]; 
        }
        
        if (players[myPlayerId]) {
            if (players[myPlayerId].is_observer) {
                scoreDisplay.innerText = "OBSERVING";
            } else {
                scoreDisplay.innerText = players[myPlayerId].score;
            }
        }
        drawEngine();
    };
});

// 4. Input Capture
window.addEventListener("keydown", (e) => {
    if(!ws || ws.readyState !== WebSocket.OPEN) return;
    let dir = null;
    if (e.key === "w" || e.key === "ArrowUp") dir = "up";
    if (e.key === "s" || e.key === "ArrowDown") dir = "down";
    if (e.key === "a" || e.key === "ArrowLeft") dir = "left";
    if (e.key === "d" || e.key === "ArrowRight") dir = "right";
    if (dir) ws.send(JSON.stringify({ action: "move", direction: dir }));
});

let touchStartX = 0, touchStartY = 0;
const SWIPE_THRESHOLD = 30; 

canvas.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
});

canvas.addEventListener("touchmove", (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !touchStartX || !touchStartY) return;

    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    let dx = touchEndX - touchStartX;
    let dy = touchEndY - touchStartY;

    if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
        let dir = null;
        if (Math.abs(dx) > Math.abs(dy)) {
            dir = dx > 0 ? "right" : "left";
        } else {
            dir = dy > 0 ? "down" : "up";
        }
        ws.send(JSON.stringify({ action: "move", direction: dir }));
        touchStartX = touchEndX;
        touchStartY = touchEndY;
    }
});

// 5. THE CAMERA VIEWPORT ENGINE
function drawEngine() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mapData.length === 0 || !myPlayerId || !players[myPlayerId]) return;

    const myPlayer = players[myPlayerId];
    let camX = myPlayer.x - Math.floor(VIEW_TILES_W / 2);
    let camY = myPlayer.y - Math.floor(VIEW_TILES_H / 2);
    camX = Math.max(0, Math.min(camX, MAP_WIDTH - VIEW_TILES_W));
    camY = Math.max(0, Math.min(camY, MAP_HEIGHT - VIEW_TILES_H));

    for (let y = camY; y < camY + VIEW_TILES_H; y++) {
        for (let x = camX; x < camX + VIEW_TILES_W; x++) {
            if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
                const tileId = mapData[(y * MAP_WIDTH) + x];
                let sourceX = 0, sourceY = 0;
                
                if (tileId === 1) { sourceX = 0; sourceY = 0; }
                else if (tileId === 2) { sourceX = 32; sourceY = 0; }
                else if (tileId === 3) { sourceX = 0; sourceY = 32; }

                const screenX = (x - camX) * TILE_SIZE;
                const screenY = (y - camY) * TILE_SIZE;
                ctx.drawImage(imgTileset, sourceX, sourceY, TILE_SIZE, TILE_SIZE, screenX, screenY, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    coins.forEach(coin => {
        if (coin.x >= camX && coin.x < camX + VIEW_TILES_W && coin.y >= camY && coin.y < camY + VIEW_TILES_H) {
            const screenX = (coin.x - camX) * TILE_SIZE;
            const screenY = (coin.y - camY) * TILE_SIZE;
            ctx.drawImage(imgCoin, screenX, screenY, TILE_SIZE, TILE_SIZE);
        }
    });

    Object.values(players).forEach(player => {
        if (player.x >= camX && player.x < camX + VIEW_TILES_W && player.y >= camY && player.y < camY + VIEW_TILES_H) {
            const screenX = (player.x - camX) * TILE_SIZE;
            const screenY = (player.y - camY) * TILE_SIZE;
            
            // Draw the specific sprite assigned by the server
            const spriteImg = characterSprites[player.sprite];
            if(spriteImg) {
                ctx.drawImage(spriteImg, screenX, screenY, TILE_SIZE, TILE_SIZE);
            }
        }
    });
}