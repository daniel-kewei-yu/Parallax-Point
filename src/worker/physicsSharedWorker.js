/*
Author: Daniel Yu
Date: March 15, 2026
Description: Entry point for the SharedWorker that runs the physics simulation.
             Maintains the Cannon.js world, players, blocks, and portals. Handles
             connection messages (join, leave, input, equip, set_hold_pose, pickup,
             drop, update_held, etc.) and broadcasts the full state to all clients.
             The worker runs a physics loop at a fixed timestep and ensures that
             held objects (via forced perspective or rod) have their physics bodies
             updated in real time to match the client’s visual position.
*/

import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { CONFIG } from './worker_config.js';

// ---------- Global state ----------
export const world = new CANNON.World();
world.gravity.set(0, CONFIG.GRAVITY, 0);
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 100;
world.defaultContactMaterial.restitution = 0.2;

export const blockMaterial = new CANNON.Material('blockMaterial');
export const playerMaterial = new CANNON.Material('playerMaterial');

const blockPlayerContact = new CANNON.ContactMaterial(
    blockMaterial, playerMaterial,
    { friction: 0.05, restitution: 0, contactEquationStiffness: 5e6, contactEquationRelaxation: 4 }
);
world.addContactMaterial(blockPlayerContact);

const blockContact = new CANNON.ContactMaterial(
    blockMaterial, blockMaterial,
    { friction: 0.5, restitution: 0.2 }
);
world.addContactMaterial(blockContact);
world.defaultContactMaterial = blockContact;

export let blocks = new Map();
export let players = new Map();
export let nextPlayerId = 1;
export let ports = new Map();          // MessagePort -> playerId
export let tokenToPlayerId = new Map();

// Portal imports
import { playerPortals, placePortal, clearPlayerPortals, getAllPortals } from './worker_portal.js';
export { playerPortals };

export function generatePlayerId() {
    return 'p_' + (nextPlayerId++);
}

// ---------- Import other modules that depend on the state ----------
import { buildWorld } from './worker_world.js';
import { createInitialWorld } from './worker_block.js';
import { startPhysicsLoop } from './worker_physicsLoop.js';
import { Player } from './worker_player.js';
import { handleInput, handlePickup, handleDrop, handlePickupRod, handleDropRod, updateHeldRod } from './worker_handlers.js';

// ---------- Broadcast function ----------
function broadcastFullState() {
    const blocksState = Array.from(blocks.values(), b => b.getState());
    const playersState = Array.from(players.values(), p => p.getState());
    const portalsState = getAllPortals();
    const message = { type: 'world_state', blocks: blocksState, players: playersState, portals: portalsState };
    for (const [port, playerId] of ports) {
        try {
            port.postMessage(message);
        } catch (e) {
            console.warn('Failed to send to port', e);
        }
    }
}

// ---------- Helper to remove a player ----------
function removePlayer(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    if (player.heldObjectId) {
        const block = blocks.get(player.heldObjectId);
        if (block) {
            block.owner = null;
            block.body.mass = CONFIG.BLOCK_BASE_MASS * Math.pow(block.scale, 3);
            block.body.type = CANNON.Body.DYNAMIC;
            block.body.updateMassProperties();
        }
    }
    players.delete(playerId);
    if (player.clientToken) tokenToPlayerId.delete(player.clientToken);
    clearPlayerPortals(playerId);
    broadcastFullState();
}

// ---------- Initialise ----------
buildWorld();
createInitialWorld();
startPhysicsLoop();

// ---------- Connection handling ----------
self.onconnect = (event) => {
    const port = event.ports[0];
    port.onmessage = (msg) => {
        const data = msg.data;
        if (data.type === 'join') {
            const clientToken = data.clientToken;
            let playerId = data.playerId;
            let existingPlayerId = tokenToPlayerId.get(clientToken);

            if (existingPlayerId && players.has(existingPlayerId)) {
                playerId = existingPlayerId;
                ports.set(port, playerId);
                port.postMessage({ type: 'player_id', id: playerId });
                broadcastFullState();
                return;
            }
            if (playerId && players.has(playerId) && !players.get(playerId).clientToken) {
                const player = players.get(playerId);
                player.clientToken = clientToken;
                tokenToPlayerId.set(clientToken, playerId);
                ports.set(port, playerId);
                port.postMessage({ type: 'player_id', id: playerId });
                broadcastFullState();
                return;
            }
            if (playerId && !players.has(playerId) && data.initialState) {
                const init = data.initialState;
                if (init.playerId === playerId && playerId.startsWith('p_') && /^p_\d+$/.test(playerId)) {
                    const numericPart = parseInt(playerId.substring(2));
                    if (!isNaN(numericPart) && numericPart >= nextPlayerId) nextPlayerId = numericPart + 1;
                    const player = new Player(playerId, { x: init.position[0], y: init.position[1], z: init.position[2] });
                    player.yaw = init.rotation;
                    player.pitch = init.pitch;
                    player.isEquipped = init.isEquipped;
                    player.inHoldPose = init.inHoldPose;
                    if (init.scale !== undefined) player.setScale(init.scale);
                    if (init.velocity) player.velocity = init.velocity;
                    if (init.onGround !== undefined) player.onGround = init.onGround;
                    player.clientToken = clientToken;
                    players.set(playerId, player);
                    tokenToPlayerId.set(clientToken, playerId);
                    ports.set(port, playerId);
                    port.postMessage({ type: 'player_id', id: playerId });
                    broadcastFullState();
                    return;
                }
            }
            playerId = generatePlayerId();
            const spawnPos = { x: 0, y: 2, z: 0 };
            const player = new Player(playerId, spawnPos);
            player.clientToken = clientToken;
            players.set(playerId, player);
            tokenToPlayerId.set(clientToken, playerId);
            ports.set(port, playerId);
            port.postMessage({ type: 'player_id', id: playerId });
            broadcastFullState();
        }
        else if (data.type === 'leave') {
            const playerId = ports.get(port);
            if (playerId) {
                removePlayer(playerId);
                ports.delete(port);
            }
        }
        else if (data.type === 'input') {
            const playerId = ports.get(port);
            if (playerId) handleInput(playerId, data.input);
        }
        else if (data.type === 'equip') {
            const playerId = ports.get(port);
            if (playerId) {
                const player = players.get(playerId);
                if (player) {
                    player.isEquipped = data.equipped;
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'set_hold_pose') {
            const playerId = ports.get(port);
            if (playerId) {
                const player = players.get(playerId);
                if (player) {
                    player.inHoldPose = data.inHoldPose;
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'pickup') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                handlePickup(playerId, data.objectId, data.rotation);
                broadcastFullState();
            }
        }
        else if (data.type === 'drop') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                handleDrop(playerId, data.position, data.scale, data.rotation);
                broadcastFullState();
            }
        }
        else if (data.type === 'update_held') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                const player = players.get(playerId);
                const block = blocks.get(data.objectId);
                if (player && block && block.owner === playerId) {
                    // Update the block's visual state (for broadcast)
                    block.heldPos = data.position;
                    block.heldRot = data.rotation;
                    block.heldScale = data.scale;
                    player.heldPos = data.position;
                    player.heldRot = data.rotation;
                    player.heldScale = data.scale;
                    // ** CRITICAL: Update the block's physics body position and rotation **
                    // Without this, the physics body would remain at the pickup location,
                    // causing a ghost collision. Since the block is kinematic, we set its body
                    // directly to the new position and rotation.
                    block.body.position.set(data.position[0], data.position[1], data.position[2]);
                    block.body.quaternion.set(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                }
            }
        }
        else if (data.type === 'pickup_player') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && !targetPlayer.held) {
                    targetPlayer.setHeld(true, data.position, data.rotation, data.cameraYaw, data.cameraPitch);
                    if (data.scale !== undefined) targetPlayer.setScale(data.scale);
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'drop_player') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && targetPlayer.held) {
                    targetPlayer.setHeld(false);
                    targetPlayer.body.position.set(data.position[0], data.position[1], data.position[2]);
                    targetPlayer.body.quaternion.set(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                    targetPlayer.body.velocity.set(0, 0, 0);
                    targetPlayer.body.angularVelocity.set(0, 0, 0);
                    if (data.finalYaw !== undefined) targetPlayer.yaw = data.finalYaw;
                    if (data.scale !== undefined) targetPlayer.setScale(data.scale);
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'update_held_player') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && targetPlayer.held) {
                    targetPlayer.heldPos = data.position;
                    targetPlayer.heldRot = data.rotation;
                    if (data.scale !== undefined) {
                        targetPlayer.heldScale = data.scale;
                        targetPlayer.setScale(data.scale);
                    }
                    // ** Also update the player's body position and rotation for collision **
                    // This ensures the held player's physics body moves with the visual.
                    targetPlayer.body.position.set(data.position[0], data.position[1], data.position[2]);
                    targetPlayer.body.quaternion.set(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                }
            }
        }
        // ========== Portal Messages ==========
        else if (data.type === 'place_portal') {
            const playerId = ports.get(port);
            if (playerId && data.portalType) {
                const pos = new CANNON.Vec3(data.position[0], data.position[1], data.position[2]);
                const rot = new CANNON.Quaternion(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                placePortal(playerId, data.portalType, pos, rot);
                broadcastFullState();
            }
        }
        else if (data.type === 'remove_portal') {
            // Not used, but kept for completeness
        }
        else if (data.type === 'clear_portals') {
            const playerId = ports.get(port);
            if (playerId) {
                clearPlayerPortals(playerId);
                broadcastFullState();
            }
        }
        // ========== Rod Handlers ==========
        else if (data.type === 'pickup_rod') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                handlePickupRod(playerId, data.objectId);
                broadcastFullState();
            }
        }
        else if (data.type === 'drop_rod') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                handleDropRod(playerId, data.objectId, data.position, data.scale, data.rotation);
                broadcastFullState();
            }
        }
        else if (data.type === 'update_held_rod') {
            const playerId = ports.get(port);
            if (playerId && data.objectId) {
                updateHeldRod(playerId, data.objectId, data.position, data.rotation, data.scale);
            }
        }
        else if (data.type === 'pickup_player_rod') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && !targetPlayer.held) {
                    targetPlayer.setHeld(true, null, null, 0, 0);
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'drop_player_rod') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && targetPlayer.held) {
                    targetPlayer.setHeld(false);
                    targetPlayer.body.position.set(data.position[0], data.position[1], data.position[2]);
                    targetPlayer.body.quaternion.set(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                    targetPlayer.body.velocity.set(0, 0, 0);
                    targetPlayer.body.angularVelocity.set(0, 0, 0);
                    if (data.finalYaw !== undefined) targetPlayer.yaw = data.finalYaw;
                    if (data.scale !== undefined) targetPlayer.setScale(data.scale);
                    broadcastFullState();
                }
            }
        }
        else if (data.type === 'update_held_player_rod') {
            const playerId = ports.get(port);
            if (playerId && data.playerId) {
                const targetPlayer = players.get(data.playerId);
                if (targetPlayer && targetPlayer.held) {
                    targetPlayer.heldPos = data.position;
                    targetPlayer.heldRot = data.rotation;
                    if (data.scale !== undefined) {
                        targetPlayer.heldScale = data.scale;
                        targetPlayer.setScale(data.scale);
                    }
                    targetPlayer.body.position.set(data.position[0], data.position[1], data.position[2]);
                    targetPlayer.body.quaternion.set(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3]);
                }
            }
        }
    };
    port.onclose = () => {
        const playerId = ports.get(port);
        if (playerId) {
            removePlayer(playerId);
            ports.delete(port);
        }
    };
};