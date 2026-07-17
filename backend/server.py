import json
import random
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

# --- 1. LOAD THE ARENA MAP ---
with open("map_data.json", "r") as f:
    map_json = json.load(f)

MAP_DATA = map_json["layers"][0]["data"]
MAP_WIDTH = map_json["width"]
MAP_HEIGHT = map_json["height"]

WALKABLE_ID = 1
SOLID_IDS = {2, 3}

VALID_SPAWNS = []
for y in range(MAP_HEIGHT):
    for x in range(MAP_WIDTH):
        index = (y * MAP_WIDTH) + x
        if MAP_DATA[index] == WALKABLE_ID:
            VALID_SPAWNS.append({"x": x, "y": y})

# --- 2. GAME STATE & CONNECTIONS ---
class GameState:
    def __init__(self):
        self.players = {}
        self.coins = []
        self.player_counter = 1
        self.active_connections = []
        # The pool of available interactive characters
        self.available_sprites = [
            "player1", "player2", "player3", "player4", 
            "agent1", "agent2", "cult_leader", "animal"
        ]

    def get_random_spawn(self):
        return random.choice(VALID_SPAWNS)
        
    async def broadcast_state(self):
        state_data = json.dumps({
            "players": self.players,
            "coins": self.coins
        })
        for connection in self.active_connections:
            try:
                await connection.send_text(state_data)
            except:
                pass

state = GameState()

# --- 3. THE 5-SECOND COIN ENGINE ---
async def spawn_coins_loop():
    while True:
        state.coins = random.sample(VALID_SPAWNS, 3)
        print(f"Server: 3 new coins spawned.")
        await state.broadcast_state()
        await asyncio.sleep(5)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(spawn_coins_loop())
    yield
    task.cancel()

app = FastAPI(lifespan=lifespan)

# --- 4. WEBSOCKET PHYSICS ENGINE ---
def is_valid_move(target_x, target_y):
    if target_x < 0 or target_x >= MAP_WIDTH or target_y < 0 or target_y >= MAP_HEIGHT:
        return False
    index = (target_y * MAP_WIDTH) + target_x
    if MAP_DATA[index] in SOLID_IDS:
        return False
    return True

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, mode: str = "player"):
    await websocket.accept()
    state.active_connections.append(websocket)
    
    player_id = f"Player_{state.player_counter}"
    state.player_counter += 1
    spawn = state.get_random_spawn()
    
    # Character Assignment Logic
    if mode == "observer":
        sprite = "human"
        is_observer = True
    else:
        is_observer = False
        if len(state.available_sprites) > 0:
            sprite = state.available_sprites.pop(0)
        else:
            sprite = "animal" # Fallback if lobby is completely full
            
    state.players[player_id] = {
        "x": spawn["x"],
        "y": spawn["y"],
        "score": 0,
        "sprite": sprite,
        "is_observer": is_observer
    }
    print(f"{player_id} joined as {mode} using {sprite}.")
    await state.broadcast_state()
    
    try:
        while True:
            data = await websocket.receive_text()
            command = json.loads(data)
            
            player = state.players[player_id]
            new_x, new_y = player["x"], player["y"]
            
            if command["action"] == "move":
                if command["direction"] == "up": new_y -= 1
                elif command["direction"] == "down": new_y += 1
                elif command["direction"] == "left": new_x -= 1
                elif command["direction"] == "right": new_x += 1
                
                if is_valid_move(new_x, new_y):
                    player["x"] = new_x
                    player["y"] = new_y
                    
                    # Only interactive players can pick up coins
                    if not player["is_observer"]:
                        player_coord = {"x": new_x, "y": new_y}
                        if player_coord in state.coins:
                            state.coins.remove(player_coord)
                            player["score"] += 1
                            print(f"{player_id} scored! Total: {player['score']}")
                    
                    await state.broadcast_state()

    except WebSocketDisconnect:
        print(f"{player_id} disconnected.")
        # Return character to the pool if they were an active player
        disconnected_sprite = state.players[player_id]["sprite"]
        if not state.players[player_id]["is_observer"] and disconnected_sprite in [
            "player1", "player2", "player3", "player4", 
            "agent1", "agent2", "cult_leader", "animal"
        ]:
            state.available_sprites.append(disconnected_sprite)
            
        del state.players[player_id]
        state.active_connections.remove(websocket)
        await state.broadcast_state()

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)