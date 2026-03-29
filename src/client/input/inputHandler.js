/*
Author: Daniel Yu
Date: March 15, 2026
Description: Handles all keyboard and mouse input for the client. It manages pointer lock,
             key states for movement (WASD, Space), and actions: E (forced perspective grab),
             Q (portal gun rod pickup), and F (equip/unequip portal gun). It also processes
             mouse clicks for placing portals: left click for blue, right click for orange.
             Portal placement includes special orientation logic: on horizontal surfaces (floor/ceiling)
             the portal lies flat (local Z = surface normal) and its local Y (the tall axis)
             points toward the player; on vertical surfaces it is flush (Z aligned with surface normal).
             Input is sent to the worker at regular intervals with timestamps to prevent stale
             input from overriding teleport orientation.
*/

import { GameState } from '../clientState.js';
import { ForcedPerspective } from '../mechanics/ForcedPerspective.js';
import { PortalPickup } from '../mechanics/PortalPickup.js';
import { RemotePlayerManager } from '../players/RemotePlayerManager.js';
import * as THREE from 'three';

/**
 * Sets up all event listeners for keyboard, mouse, and pointer lock.
 */
export function setupInput() {
    // ---------- Keyboard down events ----------
    window.addEventListener('keydown', (e) => {
        if (!GameState.controlsLocked) return;   // Only process when pointer is locked
        const key = e.code;
        if (key === 'KeyW') GameState.keyState.w = true;
        if (key === 'KeyA') GameState.keyState.a = true;
        if (key === 'KeyS') GameState.keyState.s = true;
        if (key === 'KeyD') GameState.keyState.d = true;
        if (key === 'Space') {
            GameState.keyState.space = true;
            e.preventDefault();                  // Prevent page scroll
        }
        // E key: forced perspective grab/drop (mutually exclusive with rod pickup)
        if (key === 'KeyE') {
            if (PortalPickup.active) PortalPickup.drop();
            ForcedPerspective.togglePickup();
            e.preventDefault();
        }
        // Q key: rod pickup (only when portal gun is equipped)
        if (key === 'KeyQ') {
            if (GameState.firstPersonChar && GameState.firstPersonChar.isEquipped) {
                if (GameState.heldObjectId) ForcedPerspective.drop();
                toggleRodPickup();
            }
            e.preventDefault();
        }
        // F key: equip/unequip portal gun
        if (key === 'KeyF') {
            if (GameState.firstPersonChar) GameState.firstPersonChar.toggleEquip();
            e.preventDefault();
        }
    });

    // ---------- Keyboard up events ----------
    window.addEventListener('keyup', (e) => {
        const key = e.code;
        if (key === 'KeyW') GameState.keyState.w = false;
        if (key === 'KeyA') GameState.keyState.a = false;
        if (key === 'KeyS') GameState.keyState.s = false;
        if (key === 'KeyD') GameState.keyState.d = false;
        if (key === 'Space') GameState.keyState.space = false;
    });

    // Click on canvas to enter pointer lock (first‑person mode)
    GameState.renderer.domElement.addEventListener('click', () => {
        if (!GameState.controlsLocked) {
            GameState.renderer.domElement.requestPointerLock();
        }
    });

    // Detect when pointer lock state changes
    document.addEventListener('pointerlockchange', () => {
        GameState.controlsLocked = document.pointerLockElement === GameState.renderer.domElement;
    });

    // Mouse movement for camera look (only when controls are locked and not held)
    document.addEventListener('mousemove', (e) => {
        if (GameState.controlsLocked && GameState.firstPersonChar && !GameState.isBeingHeld) {
            GameState.firstPersonChar.handleMouseMove(e.movementX, e.movementY);
        }
    });

    // Mouse clicks for portal placement
    window.addEventListener('mousedown', (e) => {
        if (!GameState.controlsLocked) return;
        if (e.button === 0) {
            placePortal('blue');      // Left click → blue portal
            e.preventDefault();
        } else if (e.button === 2) {
            placePortal('orange');    // Right click → orange portal
            e.preventDefault();
        }
    });

    // Prevent context menu from appearing on right click
    window.addEventListener('contextmenu', (e) => {
        if (GameState.controlsLocked) e.preventDefault();
    });
}

/**
 * Sends the current input state to the worker via the SharedWorker port.
 * Includes a timestamp so the worker can ignore stale input after teleport.
 */
function sendInputToWorker() {
    if (!GameState.worker || !GameState.playerId || !GameState.controlsLocked || GameState.isBeingHeld) return;

    const forward = (GameState.keyState.w ? 1 : 0) - (GameState.keyState.s ? 1 : 0);
    const right = (GameState.keyState.d ? 1 : 0) - (GameState.keyState.a ? 1 : 0);

    const moveYaw = GameState.rawYaw;
    const movePitch = GameState.pitch;
    const timestamp = performance.now(); // milliseconds

    GameState.worker.port.postMessage({
        type: 'input',
        input: {
            move: { forward, right },
            jump: GameState.keyState.space,
            yaw: moveYaw,
            pitch: movePitch,
            timestamp,
        },
    });
    // Reset jump flag after sending to avoid repeated jumps in one key press
    if (GameState.keyState.space) GameState.keyState.space = false;
}

/**
 * Starts the input loop that sends input to the worker at a fixed interval.
 */
export function startInputLoop() {
    setInterval(() => {
        sendInputToWorker();
    }, GameState.inputInterval);
}

/**
 * Toggles the rod pickup (Q) mechanic: drops if active, otherwise picks up an object under the crosshair.
 */
function toggleRodPickup() {
    if (PortalPickup.active) {
        PortalPickup.drop();
        return;
    }

    // Raycast from camera centre
    GameState.raycaster.setFromCamera(new THREE.Vector2(0, 0), GameState.camera);
    // First check remote players (their collision capsules)
    const playerCapsules = Array.from(RemotePlayerManager.remotePlayers.values())
        .map(p => p.capsule).filter(c => c);
    let intersects = GameState.raycaster.intersectObjects(playerCapsules);
    if (intersects.length > 0) {
        const hitCapsule = intersects[0].object;
        let playerId = null;
        for (const [id, player] of RemotePlayerManager.remotePlayers) {
            if (player.capsule === hitCapsule) {
                playerId = id;
                break;
            }
        }
        if (playerId && PortalPickup.canPickup(hitCapsule)) {
            PortalPickup.startPickup(hitCapsule, playerId, 'player', playerId);
        }
        return;
    }

    // Then check blocks
    intersects = GameState.raycaster.intersectObjects(Array.from(GameState.worldObjects.values()));
    if (intersects.length > 0) {
        const hit = intersects[0].object;
        // Only pick up if not owned by another player
        if ((!hit.userData.owner || hit.userData.owner === GameState.playerId) && PortalPickup.canPickup(hit)) {
            PortalPickup.startPickup(hit, hit.userData.id, 'block');
        }
        return;
    }
}

/**
 * Places a portal of the given type (blue/orange) on the surface under the crosshair.
 * Orientation:
 *   - On horizontal surfaces (floor/ceiling): portal lies flat (local Z = surface normal),
 *     and its local Y (the tall axis after scaling) points toward the player.
 *   - On vertical surfaces: portal is flush (local Z = surface normal).
 * @param {string} type - 'blue' or 'orange'
 */
function placePortal(type) {
    if (!GameState.firstPersonChar || !GameState.firstPersonChar.isEquipped) return;

    // Raycast from camera centre to find the surface
    GameState.raycaster.setFromCamera(new THREE.Vector2(0, 0), GameState.camera);
    const allObjects = [];
    GameState.scene.traverse(obj => {
        if (obj.isMesh && !obj.userData.isLocalPlayerPart && !obj.userData.remoteAvatar) {
            // Skip portal meshes (so we hit the wall behind)
            if (obj.userData.isPortal) return;
            // Skip objects currently held (so we don't place a portal on them)
            if (GameState.heldObjectId && obj === GameState.heldObjectMesh) return;
            if (PortalPickup.active && obj === PortalPickup.heldObjectMesh) return;
            allObjects.push(obj);
        }
    });
    const hits = GameState.raycaster.intersectObjects(allObjects);
    if (hits.length === 0) return;

    const hit = hits[0];
    const hitPoint = hit.point;
    const hitNormal = hit.face.normal.clone();
    // Transform the normal from object space to world space
    hitNormal.applyQuaternion(hit.object.quaternion);
    hitNormal.normalize();

    // Determine if the surface is nearly horizontal (floor or ceiling)
    const isHorizontal = Math.abs(hitNormal.y) > 0.9;

    let quat;
    if (isHorizontal) {
        // For horizontal surfaces, we want the portal to lie flat on the surface.
        // Local Z = surface normal (points up/down, making the disc lie flat).
        // Local Y should point toward the player (projected onto the surface plane),
        // so that the portal's taller dimension (Y after scaling) faces the player.
        const up = hitNormal.clone();                       // surface normal (Z axis of portal)
        // Compute direction from hit point to camera, projected onto the plane perpendicular to up.
        const toCamera = GameState.camera.position.clone().sub(hitPoint);
        const projected = toCamera.clone().sub(up.clone().multiplyScalar(toCamera.dot(up))).normalize();
        // If the camera is exactly above, fallback to world X.
        let forwardDir = projected;
        if (forwardDir.length() < 0.001) forwardDir.set(1, 0, 0);

        // Build rotation matrix: local Z = up, local Y = forwardDir,
        // local X = cross(Y, Z) (right vector, ensuring orthonormal axes).
        const yAxis = forwardDir.clone();
        const zAxis = up.clone();
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        const matrix = new THREE.Matrix4();
        matrix.set(
            xAxis.x, yAxis.x, zAxis.x, 0,
            xAxis.y, yAxis.y, zAxis.y, 0,
            xAxis.z, yAxis.z, zAxis.z, 0,
            0, 0, 0, 1
        );
        quat = new THREE.Quaternion().setFromRotationMatrix(matrix);
    } else {
        // For vertical surfaces, align the portal's forward (Z) with the surface normal.
        quat = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            hitNormal
        );
    }

    // Slight offset to prevent z‑fighting with the wall/floor
    const offsetPos = hitPoint.clone().add(hitNormal.clone().multiplyScalar(0.05));

    if (GameState.worker && GameState.playerId) {
        GameState.worker.port.postMessage({
            type: 'place_portal',
            portalType: type,
            position: [offsetPos.x, offsetPos.y, offsetPos.z],
            rotation: [quat.x, quat.y, quat.z, quat.w]
        });
    }
}