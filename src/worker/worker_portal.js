/*
Author: Daniel Yu
Date: March 15, 2026
Description: Defines the portal data structures and functions used in the SharedWorker.
             Portals are stored per player (each player has their own blue and orange portal).
             The module provides functions to place, remove, and clear portals, as well as
             to retrieve all portal states for broadcasting. The worker uses these functions
             when it receives portal placement messages from clients.
*/

import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

// Map from playerId to an object containing blue and orange portals.
// Example: playerPortals.get('p_5') = { blue: Portal, orange: Portal }
export const playerPortals = new Map();

let nextPortalId = 1;   // Simple counter for unique portal IDs

/**
 * Represents a single portal.
 */
export class Portal {
    /**
     * Creates a new portal.
     * @param {string} id - Unique portal ID (e.g., 'portal_7').
     * @param {string} type - 'blue' or 'orange'.
     * @param {CANNON.Vec3} position - World position of the portal centre.
     * @param {CANNON.Quaternion} rotation - Orientation of the portal; its local Z points into the room.
     */
    constructor(id, type, position, rotation) {
        this.id = id;
        this.type = type;
        this.position = position;
        this.rotation = rotation;
        this.active = true;
    }

    /**
     * Returns a serializable representation of the portal for network broadcast.
     * @returns {Object} Portal state with id, type, position, rotation, active.
     */
    getState() {
        return {
            id: this.id,
            type: this.type,
            position: [this.position.x, this.position.y, this.position.z],
            rotation: [this.rotation.x, this.rotation.y, this.rotation.z, this.rotation.w],
            active: this.active
        };
    }
}

/**
 * Generates a new unique portal ID.
 * @returns {string} e.g., 'portal_7'
 */
export function generatePortalId() {
    return 'portal_' + (nextPortalId++);
}

/**
 * Places or moves a portal of a given type for a specific player.
 * If a portal of that type already exists for the player, it is replaced.
 * @param {string} playerId - The player who owns the portal.
 * @param {string} type - 'blue' or 'orange'.
 * @param {CANNON.Vec3} position - World position.
 * @param {CANNON.Quaternion} rotation - Orientation (local Z into the room).
 * @returns {Portal} The newly created portal.
 */
export function placePortal(playerId, type, position, rotation) {
    let portals = playerPortals.get(playerId);
    if (!portals) {
        portals = { blue: null, orange: null };
        playerPortals.set(playerId, portals);
    }

    const id = generatePortalId();
    const portal = new Portal(id, type, position, rotation);
    portals[type] = portal;
    return portal;
}

/**
 * Removes a portal by its ID. Scans all players' portals to find it.
 * @param {string} id - Portal ID.
 */
export function removePortal(id) {
    for (const [playerId, portals] of playerPortals) {
        if (portals.blue && portals.blue.id === id) {
            portals.blue = null;
            // If both portals are null, delete the player's entry
            if (!portals.blue && !portals.orange) playerPortals.delete(playerId);
            return;
        }
        if (portals.orange && portals.orange.id === id) {
            portals.orange = null;
            if (!portals.blue && !portals.orange) playerPortals.delete(playerId);
            return;
        }
    }
}

/**
 * Clears all portals belonging to a specific player.
 * @param {string} playerId
 */
export function clearPlayerPortals(playerId) {
    playerPortals.delete(playerId);
}

/**
 * Returns an array of all portal states for all players.
 * Used for broadcasting the full world state.
 * @returns {Array} List of portal state objects.
 */
export function getAllPortals() {
    const all = [];
    for (const [playerId, portals] of playerPortals) {
        if (portals.blue) all.push(portals.blue.getState());
        if (portals.orange) all.push(portals.orange.getState());
    }
    return all;
}