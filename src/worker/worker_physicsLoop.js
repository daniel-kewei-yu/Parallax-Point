/*
Author: Daniel Yu
Date: March 15, 2026
Description: Main physics loop that runs in the SharedWorker. It steps the Cannon.js world,
             updates player input and ground status, and handles portal teleportation.
             Teleportation uses a full quaternion transformation: localise the player's
             velocity and facing direction in the entry portal's local space, flip the Z
             component (the direction through the portal), then transform back using the
             exit portal's orientation. This preserves all components, including vertical
             motion for floor/ceiling portals. Teleport trigger uses a distance check with
             a short cooldown to avoid flickering. The loop runs at a fixed timestep.
*/

import { world, players, blocks } from './physicsSharedWorker.js';
import { playerPortals } from './worker_portal.js';
import { CONFIG } from './worker_config.js';
import { broadcastFullState } from './worker_broadcast.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

// ---------- Global variables for physics stepping ----------
let lastPhysicsTime = performance.now();   // Timestamp of last physics update
let accumulator = 0;                      // Accumulated time for fixed timestep

// Portal trigger parameters
const PORTAL_RADIUS = 1.2;               // Radius of portal disc (units)
const FORWARD_PUSH = 1.2;               // Distance to push player in front of exit portal
const TELEPORT_COOLDOWN = 0.3;           // Seconds to wait before allowing another teleport

// Sets to prevent multiple teleports in the same step
const teleportedThisStep = new Set();
const lastTeleportTime = new Map();       // Body -> last teleport timestamp (ms)

/**
 * Converts a yaw angle (rotation around Y) to a forward direction vector (XZ plane).
 * @param {number} yaw - Angle in radians.
 * @returns {CANNON.Vec3} Forward vector (x,0,z).
 */
function forwardFromYaw(yaw) {
    // The forward vector points along (sin(yaw), 0, -cos(yaw))
    return new CANNON.Vec3(Math.sin(yaw), 0, -Math.cos(yaw));
}

/**
 * Converts a forward direction vector (XZ plane) to a yaw angle.
 * @param {CANNON.Vec3} forward - Normalized forward vector (y must be 0).
 * @returns {number} Yaw angle in radians.
 */
function yawFromForward(forward) {
    // atan2(x, z) gives the rotation around Y
    return Math.atan2(forward.x, forward.z);
}

/**
 * Full quaternion transformation for a vector through a portal pair.
 * Steps:
 *   1. Transform the vector from world space to the entry portal's local coordinates.
 *   2. Flip the Z component (the component normal to the portal surface).
 *   3. Transform the resulting vector back to world space using the exit portal's orientation.
 * @param {CANNON.Vec3} vec - World vector to transform.
 * @param {CANNON.Quaternion} qIn - Rotation of the entry portal (local Z = forward).
 * @param {CANNON.Quaternion} qOut - Rotation of the exit portal.
 * @returns {CANNON.Vec3} Transformed vector.
 */
function transformThroughPortal(vec, qIn, qOut) {
    const localVec = qIn.inverse().vmult(vec);    // Step 1: world → entry local
    localVec.z = -localVec.z;                     // Step 2: flip through the portal
    return qOut.vmult(localVec);                  // Step 3: local → world using exit
}

/**
 * Teleports a body if it is close enough to the portal centre.
 * Uses a cooldown to prevent re‑teleportation flicker.
 * @param {CANNON.Body} body - The body to check (player or block).
 * @param {Object} portal - The portal object (contains .position, .rotation, .type).
 * @param {string} ownerId - ID of the player who owns this portal.
 * @param {number} currentTimeMs - Current time in milliseconds (for cooldown).
 * @returns {boolean} True if the body was teleported.
 */
function teleportIfInside(body, portal, ownerId, currentTimeMs) {
    // Cooldown check: do not teleport if last teleport was less than TELEPORT_COOLDOWN seconds ago
    const lastTime = lastTeleportTime.get(body);
    if (lastTime && (currentTimeMs - lastTime) < TELEPORT_COOLDOWN * 1000) return false;

    // Compute the combined trigger radius: body's radius + portal's radius
    const radius = (body.userData?.playerId) ? CONFIG.PLAYER_RADIUS : (body.shapes[0]?.radius || 0.5);
    const bodyPos = body.position;
    const portalPos = portal.position;

    const distance = bodyPos.distanceTo(portalPos);
    if (distance < radius + PORTAL_RADIUS) {
        if (teleportedThisStep.has(body)) return false;

        // Get the player's portals
        const portals = playerPortals.get(ownerId);
        if (!portals) return false;

        // Find the other portal (opposite colour)
        const otherPortal = (portal.type === 'blue') ? portals.orange : portals.blue;
        if (!otherPortal) return false;

        // --- Compute new position ---
        // Entry portal's forward direction (local Z) points into the room
        const entryForward = new CANNON.Vec3(0, 0, 1);
        portal.rotation.vmult(entryForward, entryForward);
        // Decompose offset into normal and tangential components
        const offsetVec = bodyPos.vsub(portalPos);
        const signedDist = offsetVec.dot(entryForward);
        const tangential = offsetVec.vsub(entryForward.scale(signedDist));

        // Exit portal's forward direction
        const exitForward = new CANNON.Vec3(0, 0, 1);
        otherPortal.rotation.vmult(exitForward, exitForward);
        // New position = exit portal centre + forward push + tangential offset
        const newPos = otherPortal.position.clone()
            .vadd(exitForward.scale(FORWARD_PUSH))
            .vadd(tangential);
        body.position.copy(newPos);

        // Mark as teleported this step and update cooldown
        teleportedThisStep.add(body);
        lastTeleportTime.set(body, currentTimeMs);

        // --- Transform orientation and velocity ---
        if (body.userData?.playerId) {
            const player = players.get(body.userData.playerId);
            if (player && !player.held) {
                // Transform facing direction
                const forwardWorld = forwardFromYaw(player.yaw);
                const newForward = transformThroughPortal(forwardWorld, portal.rotation, otherPortal.rotation);
                newForward.normalize();
                player.yaw = yawFromForward(newForward);
                // Transform velocity
                const newVel = transformThroughPortal(body.velocity, portal.rotation, otherPortal.rotation);
                body.velocity.copy(newVel);
                player.lastTeleportTime = currentTimeMs;
            }
        } else if (body.userData?.blockId) {
            // Transform block velocity (no orientation needed)
            const newVel = transformThroughPortal(body.velocity, portal.rotation, otherPortal.rotation);
            body.velocity.copy(newVel);
        }
        return true;
    }
    return false;
}

/**
 * Main physics loop, called at a fixed interval (60 Hz). It steps the world,
 * updates players, and checks for portal teleportation.
 */
function physicsLoop() {
    const now = performance.now();
    let delta = (now - lastPhysicsTime) / 1000;   // Time since last frame (seconds)
    lastPhysicsTime = now;
    if (delta > 0.2) delta = 0.2;                 // Cap delta to avoid large jumps
    accumulator += delta;

    // Perform as many fixed‑timestep updates as needed
    while (accumulator >= CONFIG.FIXED_TIMESTEP) {
        // 1. Update player physics (velocity based on input)
        for (const player of players.values()) {
            if (!player.held) player.updatePhysics(CONFIG.FIXED_TIMESTEP);
        }

        // 2. Step the world
        world.step(CONFIG.FIXED_TIMESTEP);

        // 3. Post‑step updates (collision response, ground status)
        for (const player of players.values()) if (!player.held) player.postStep();
        for (const player of players.values()) if (!player.held) player.updateGroundStatus();

        // 4. Clear teleport set for new frame
        teleportedThisStep.clear();

        // 5. Check teleportation for each player's portals
        const currentTimeMs = performance.now();
        for (const [ownerId, portals] of playerPortals) {
            if (portals.blue) {
                for (const player of players.values()) {
                    if (!player.held && player.body && teleportIfInside(player.body, portals.blue, ownerId, currentTimeMs)) break;
                }
                for (const block of blocks.values()) {
                    if (!block.owner && block.body && teleportIfInside(block.body, portals.blue, ownerId, currentTimeMs)) break;
                }
            }
            if (portals.orange) {
                for (const player of players.values()) {
                    if (!player.held && player.body && teleportIfInside(player.body, portals.orange, ownerId, currentTimeMs)) break;
                }
                for (const block of blocks.values()) {
                    if (!block.owner && block.body && teleportIfInside(block.body, portals.orange, ownerId, currentTimeMs)) break;
                }
            }
        }

        accumulator -= CONFIG.FIXED_TIMESTEP;
    }

    // After all steps, broadcast the new state to all clients
    broadcastFullState();
}

/**
 * Starts the physics loop using setInterval.
 */
export function startPhysicsLoop() {
    setInterval(physicsLoop, CONFIG.PHYSICS_INTERVAL_MS);
}