/*
Author: Daniel Yu
Date: March 15, 2026
Description: Sends the full world state (blocks, players, portals) to all connected clients.
             It is called after every physics step to keep all clients synchronised.
*/

import { ports, players, blocks } from './physicsSharedWorker.js';
import { getAllPortals } from './worker_portal.js';

/**
 * Broadcasts the current state of all blocks, players, and portals to every connected client.
 */
export function broadcastFullState() {
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