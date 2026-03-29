/*
Author: Daniel Yu
Date: March 15, 2026
Description: Handlers for worker messages: input, pickup, drop, portal placement,
             and rod pickup. These functions are called from physicsSharedWorker.js
             when a message is received from a client. They update the physics state
             (players, blocks) and trigger a broadcast after changes.
*/

import { players, blocks } from './physicsSharedWorker.js';
import { CONFIG } from './worker_config.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

/**
 * Processes an input message for a player.
 * Updates movement input, jump, yaw, and pitch. Ignores input with timestamp older
 * than the player's last teleport time to prevent overriding teleport orientation.
 * @param {string} playerId - ID of the player.
 * @param {Object} input - Input data (move, jump, yaw, pitch, timestamp).
 */
export function handleInput(playerId, input) {
    const player = players.get(playerId);
    if (!player) return;

    const timestamp = input.timestamp;
    if (timestamp !== undefined && player.lastTeleportTime !== undefined && timestamp < player.lastTeleportTime) {
        return; // stale input, ignore
    }

    if (input.move) {
        player.input.forward = input.move.forward;
        player.input.right = input.move.right;
    }
    if (input.jump) player.input.jump = true;
    if (input.equip !== undefined) player.isEquipped = input.equip;
    if (input.yaw !== undefined) player.yaw = input.yaw;
    if (input.pitch !== undefined) player.pitch = input.pitch;
}

/**
 * Handles a pickup message for a block (forced perspective).
 * Makes the block kinematic and assigns ownership to the player.
 * Also disables collision response so the block does not push other objects.
 * @param {string} playerId - ID of the player doing the pickup.
 * @param {string} objectId - ID of the block to pick up.
 * @param {Array} rotation - Quaternion of the block at pickup moment.
 */
export function handlePickup(playerId, objectId, rotation) {
    const player = players.get(playerId);
    const block = blocks.get(objectId);
    if (player && block && !block.owner) {
        block.owner = player.id;
        player.heldObjectId = block.id;
        block.body.mass = 0;
        block.body.type = CANNON.Body.KINEMATIC;
        block.body.collisionResponse = false; // Prevent pushing other objects
        block.body.updateMassProperties();
        block.heldRot = rotation;
    }
}

/**
 * Handles a drop message for a block (forced perspective).
 * Restores the block's dynamic physics, sets its position, rotation, and scale,
 * and re‑enables collision response.
 * @param {string} playerId - ID of the player dropping the block.
 * @param {Array} position - [x,y,z] foot position for the block.
 * @param {number} scale - New scale of the block.
 * @param {Array} rotation - Quaternion of the block.
 */
export function handleDrop(playerId, position, scale, rotation) {
    const player = players.get(playerId);
    if (player && player.heldObjectId) {
        const block = blocks.get(player.heldObjectId);
        if (block) {
            block.owner = null;
            player.heldObjectId = null;

            block.setScale(scale);

            block.body.type = CANNON.Body.DYNAMIC;
            block.body.mass = CONFIG.BLOCK_BASE_MASS * Math.pow(scale, 3);
            block.body.collisionResponse = true; // Re‑enable collision
            block.body.updateMassProperties();

            block.body.position.set(position[0], position[1], position[2]);
            block.body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
            block.body.velocity.set(0, 0, 0);
            block.body.angularVelocity.set(0, 0, 0);

            player.heldPos = player.heldRot = player.heldScale = null;
            block.heldPos = block.heldRot = block.heldScale = null;
        }
    }
}

/**
 * Updates a held block's state while it is being held (forced perspective).
 * @param {string} playerId - ID of the player.
 * @param {Array} pos - New position.
 * @param {number} scale - New scale.
 * @param {Array} rot - New rotation quaternion.
 */
export function updateHeldObject(playerId, pos, scale, rot) {
    const player = players.get(playerId);
    if (player && player.heldObjectId) {
        const block = blocks.get(player.heldObjectId);
        if (block) {
            block.heldPos = pos;
            block.heldRot = rot;
            block.heldScale = scale;
            player.heldPos = pos;
            player.heldRot = rot;
            player.heldScale = scale;
            // Update body position and rotation for collision (but collisionResponse is false, so it won't push)
            block.body.position.set(pos[0], pos[1], pos[2]);
            block.body.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
        }
    }
}

// ========== Rod handlers ==========

/**
 * Handles a pickup message for a block using the rod mechanic.
 * Makes the block kinematic and disables collision response.
 * @param {string} playerId - ID of the player.
 * @param {string} objectId - ID of the block.
 */
export function handlePickupRod(playerId, objectId) {
    const player = players.get(playerId);
    const block = blocks.get(objectId);
    if (player && block && !block.owner) {
        block.owner = player.id;
        player.heldObjectId = block.id;
        block.body.mass = 0;
        block.body.type = CANNON.Body.KINEMATIC;
        block.body.collisionResponse = false; // Prevent pushing
        block.body.updateMassProperties();
    }
}

/**
 * Handles a drop message for a block using the rod mechanic.
 * Restores dynamic physics and collision response.
 * @param {string} playerId - ID of the player.
 * @param {string} objectId - ID of the block.
 * @param {Array} position - [x,y,z] position.
 * @param {number} scale - Scale.
 * @param {Array} rotation - Quaternion.
 */
export function handleDropRod(playerId, objectId, position, scale, rotation) {
    const player = players.get(playerId);
    if (player && player.heldObjectId === objectId) {
        const block = blocks.get(objectId);
        if (block) {
            block.owner = null;
            player.heldObjectId = null;

            block.setScale(scale);

            block.body.type = CANNON.Body.DYNAMIC;
            block.body.mass = CONFIG.BLOCK_BASE_MASS * Math.pow(scale, 3);
            block.body.collisionResponse = true; // Re‑enable collision
            block.body.updateMassProperties();

            block.body.position.set(position[0], position[1], position[2]);
            block.body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
            block.body.velocity.set(0, 0, 0);
            block.body.angularVelocity.set(0, 0, 0);

            player.heldPos = player.heldRot = player.heldScale = null;
            block.heldPos = block.heldRot = block.heldScale = null;
        }
    }
}

/**
 * Updates a held block's state while held with the rod mechanic.
 * @param {string} playerId - ID of the player.
 * @param {string} objectId - ID of the block.
 * @param {Array} position - New position.
 * @param {Array} rotation - New rotation.
 * @param {number} scale - New scale.
 */
export function updateHeldRod(playerId, objectId, position, rotation, scale) {
    const player = players.get(playerId);
    if (player && player.heldObjectId === objectId) {
        const block = blocks.get(objectId);
        if (block) {
            block.body.position.set(position[0], position[1], position[2]);
            block.body.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
            block.heldPos = position;
            block.heldRot = rotation;
            block.heldScale = scale;
            player.heldPos = position;
            player.heldRot = rotation;
            player.heldScale = scale;
        }
    }
}