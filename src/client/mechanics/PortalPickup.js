/*
Author: Daniel Yu
Date: March 15, 2026
Description: Implements the "rod" pickup mechanic for the portal gun.
             When equipped, pressing Q attaches an object to an invisible rigid rod.
             The rod originates from the camera, and the held object is moved along
             the camera direction. Two‑step movement (horizontal then vertical) with
             floor‑ignored horizontal movement ensures smooth sliding, collisions
             with walls and floors, and automatic drop if stretched too far.
*/

import * as THREE from 'three';
import { GameState } from '../clientState.js';
import { RemotePlayerManager } from '../players/RemotePlayerManager.js';
import { CLIENT_CONFIG } from '../clientConfig.js';

export const PortalPickup = {
    active: false,                     // Whether we are currently holding an object
    heldObjectMesh: null,              // The mesh of the held object
    heldObjectId: null,                // Unique ID of the held object
    heldObjectType: null,              // 'block' or 'player'
    heldPlayerId: null,                // If holding a player, their ID
    heldObjectCapsule: null,           // Capsule mesh for held player (collision)
    heldObjectAvatar: null,            // Avatar mesh for held player (visual)
    heldObjectOriginalOffsetY: 0,      // Offset from foot to centre for held player
    fixedDistance: 0,                  // Distance from camera at pickup (world units)
    boundingBox: null,                 // World‑space bounding box of the object
    dynamicRadius: 0,                  // Radius for sweep (half‑extent in movement direction)
    verticalRadius: 0,                 // Half‑extent in Y direction (for floor clamp)
    previousPos: new THREE.Vector3(),  // Last known position (for sweep)
    raycaster: new THREE.Raycaster(),

    /**
     * Computes the bounding box of an object in world space.
     * Used to determine the object's size for collision detection.
     * @param {THREE.Object3D} obj - The object to measure.
     * @returns {THREE.Box3} World‑space bounding box.
     */
    computeWorldBoundingBox(obj) {
        const box = new THREE.Box3().setFromObject(obj);
        return box;
    },

    /**
     * Computes the half‑extent of the object's bounding box along a given direction.
     * This is used to create a dynamic radius for sphere‑sweep tests.
     * @param {THREE.Vector3} direction - Normalized direction vector.
     * @returns {number} Half‑extent (distance from centre to furthest point along direction).
     */
    computeHalfExtent(direction) {
        if (!this.boundingBox) return 0.5;
        const size = this.boundingBox.getSize(new THREE.Vector3());
        return Math.abs(size.x * direction.x) + Math.abs(size.y * direction.y) + Math.abs(size.z * direction.z);
    },

    /**
     * Performs a sphere‑sweep test from start to end, ignoring objects that are below the object's bottom (for horizontal movement).
     * This simulates moving the object's bounding sphere along the path and stops at the first obstacle.
     * @param {THREE.Vector3} start - Start position.
     * @param {THREE.Vector3} end - Desired end position.
     * @param {Set} ignoreSet - Objects to ignore (e.g., the held object itself).
     * @param {boolean} ignoreFloor - If true, ignore hits that are below the object's bottom.
     * @returns {THREE.Vector3|null} New position after collision, or null if no hit.
     */
    sphereSweep(start, end, ignoreSet, ignoreFloor = false) {
        const direction = end.clone().sub(start).normalize();
        const distance = start.distanceTo(end);
        const radius = this.dynamicRadius;
        let current = start.clone();

        const stepSize = Math.min(radius * 0.5, 0.2); // Step size for precision
        let remaining = distance;

        while (remaining > 0) {
            const step = Math.min(stepSize, remaining);
            const candidate = current.clone().add(direction.clone().multiplyScalar(step));
            this.raycaster.ray.origin.copy(current);
            this.raycaster.ray.direction.copy(direction);
            const hits = this.raycaster.intersectObjects(Array.from(GameState.scene.children), true);
            let closestHit = null;
            let closestDist = Infinity;

            for (const hit of hits) {
                if (ignoreSet.has(hit.object)) continue;
                if (hit.object.userData.isLocalPlayerPart) continue;

                // If ignoring floor, skip hits that are below the object's bottom
                if (ignoreFloor) {
                    const bottomY = current.y - this.verticalRadius;
                    if (hit.point.y < bottomY) continue;
                }

                if (hit.distance < closestDist && hit.distance > 0) {
                    closestDist = hit.distance;
                    closestHit = hit;
                }
            }

            if (closestHit && closestDist < step) {
                // Hit obstacle – place object just before it
                const hitPos = current.clone().add(direction.clone().multiplyScalar(Math.max(0, closestDist - radius)));
                return hitPos;
            }

            current = candidate;
            remaining -= step;
        }
        return null; // No obstacle encountered
    },

    /**
     * Picks up an object using the rod mechanic.
     * @param {THREE.Object3D} objectMesh - The mesh of the object to hold.
     * @param {string} objectId - Unique ID of the object.
     * @param {string} objectType - 'block' or 'player'.
     * @param {string} [playerId] - If type is 'player', the player ID.
     */
    startPickup(objectMesh, objectId, objectType, playerId = null) {
        if (this.active) this.drop();

        const cameraPos = GameState.camera.position.clone();
        const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(GameState.camera.quaternion).normalize();

        const objectPos = objectMesh.position.clone();
        const pickupDistance = cameraPos.distanceTo(objectPos);
        this.fixedDistance = pickupDistance;

        this.heldObjectMesh = objectMesh;
        this.heldObjectId = objectId;
        this.heldObjectType = objectType;
        this.heldPlayerId = playerId;

        this.boundingBox = this.computeWorldBoundingBox(objectMesh);
        const size = this.boundingBox.getSize(new THREE.Vector3());
        this.verticalRadius = size.y / 2;
        this.previousPos.copy(objectPos);

        if (objectType === 'player') {
            const player = RemotePlayerManager.remotePlayers.get(playerId);
            if (player) {
                this.heldObjectCapsule = player.capsule;
                this.heldObjectAvatar = player.avatar;
                this.heldObjectOriginalOffsetY = player.offsetY;
                this.verticalRadius = CLIENT_CONFIG.PLAYER_HEIGHT / 2;
            }
        }

        // Tell the worker to make the object kinematic
        if (objectType === 'block' && GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({ type: 'pickup_rod', objectId });
        } else if (objectType === 'player' && GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({ type: 'pickup_player_rod', playerId });
        }

        this.active = true;
        GameState.rodPickupActive = true;
    },

    /**
     * Drops the currently held object, restoring its physics.
     */
    drop() {
        if (!this.active) return;

        if (this.heldObjectType === 'block' && GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({
                type: 'drop_rod',
                objectId: this.heldObjectId,
                position: this.heldObjectMesh.position.toArray(),
                rotation: this.heldObjectMesh.quaternion.toArray(),
                scale: this.heldObjectMesh.scale.x,
            });
        } else if (this.heldObjectType === 'player' && GameState.worker && GameState.playerId) {
            const footPos = this.heldObjectMesh.position.clone();
            if (this.heldObjectAvatar) footPos.sub(new THREE.Vector3(0, this.heldObjectOriginalOffsetY, 0));
            GameState.worker.port.postMessage({
                type: 'drop_player_rod',
                playerId: this.heldPlayerId,
                position: footPos.toArray(),
                rotation: this.heldObjectMesh.quaternion.toArray(),
                scale: this.heldObjectMesh.scale.x,
            });
        }

        this.active = false;
        this.heldObjectMesh = null;
        this.heldObjectId = null;
        this.heldObjectType = null;
        this.heldPlayerId = null;
        this.heldObjectCapsule = null;
        this.heldObjectAvatar = null;
        this.heldObjectOriginalOffsetY = 0;
        this.boundingBox = null;
        GameState.rodPickupActive = false;
    },

    /**
     * Updates the held object's position using two‑step movement with floor‑ignored horizontal sweep.
     * Called every frame from the render loop.
     */
    update() {
        if (!this.active || !this.heldObjectMesh) return;

        // Update bounding box in case the object rotated (though unlikely during hold)
        this.boundingBox = this.computeWorldBoundingBox(this.heldObjectMesh);
        const size = this.boundingBox.getSize(new THREE.Vector3());
        this.verticalRadius = size.y / 2;

        const cameraPos = GameState.camera.position.clone();
        const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(GameState.camera.quaternion).normalize();

        const desiredPos = cameraPos.clone().add(cameraForward.clone().multiplyScalar(this.fixedDistance));

        const ignoreSet = new Set([this.heldObjectMesh]);
        if (this.heldObjectCapsule) ignoreSet.add(this.heldObjectCapsule);
        if (this.heldObjectAvatar) ignoreSet.add(this.heldObjectAvatar);
        if (GameState.physicsPlayer?.capsule) ignoreSet.add(GameState.physicsPlayer.capsule);

        // ---- Step 1: Horizontal movement (ignore floor) ----
        const desiredHoriz = new THREE.Vector3(desiredPos.x, this.previousPos.y, desiredPos.z);
        const horizMove = desiredHoriz.clone().sub(this.previousPos);
        const horizDistance = horizMove.length();

        let horizPos = this.previousPos.clone();
        if (horizDistance > 0.001) {
            const horizDir = horizMove.clone().normalize();
            this.dynamicRadius = this.computeHalfExtent(horizDir);
            const horizEnd = this.previousPos.clone().add(horizDir.clone().multiplyScalar(horizDistance));
            const sweptHoriz = this.sphereSweep(this.previousPos, horizEnd, ignoreSet, true); // ignore floor
            if (sweptHoriz) {
                horizPos = sweptHoriz;
            } else {
                horizPos = horizEnd;
            }
        }

        // ---- Step 2: Vertical movement (respect floor) ----
        const verticalDelta = desiredPos.y - horizPos.y;
        let finalPos = horizPos.clone();

        if (Math.abs(verticalDelta) > 0.001) {
            const verticalDir = new THREE.Vector3(0, Math.sign(verticalDelta), 0);
            const verticalDistance = Math.abs(verticalDelta);
            this.dynamicRadius = this.computeHalfExtent(verticalDir);
            const verticalEnd = horizPos.clone().add(verticalDir.clone().multiplyScalar(verticalDistance));
            const sweptVert = this.sphereSweep(horizPos, verticalEnd, ignoreSet, false); // respect floor
            if (sweptVert) {
                finalPos = sweptVert;
            } else {
                finalPos = verticalEnd;
            }
        }

        // ---- Floor clamp ----
        const floorY = 0.05;
        if (finalPos.y - this.verticalRadius < floorY) {
            finalPos.y = floorY + this.verticalRadius;
        }

        // ---- Player overlap ----
        const playerPos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
        const playerRadius = CLIENT_CONFIG.PLAYER_RADIUS * (GameState.localPlayerState.scale || 1);
        const toPlayer = finalPos.clone().sub(playerPos);
        const distToPlayer = toPlayer.length();
        const minDist = playerRadius + this.verticalRadius;
        if (distToPlayer < minDist) {
            finalPos = playerPos.clone().add(toPlayer.normalize().multiplyScalar(minDist));
        }

        // ---- Stretch drop ----
        const currentDist = cameraPos.distanceTo(finalPos);
        if (currentDist > this.fixedDistance * 2) {
            this.drop();
            return;
        }

        // Apply new position
        this.heldObjectMesh.position.copy(finalPos);
        this.previousPos.copy(finalPos);

        if (this.heldObjectType === 'player' && this.heldObjectAvatar) {
            this.heldObjectAvatar.position.copy(finalPos);
        }

        // Send to worker (for other clients)
        if (GameState.worker && GameState.playerId) {
            if (this.heldObjectType === 'block') {
                GameState.worker.port.postMessage({
                    type: 'update_held_rod',
                    objectId: this.heldObjectId,
                    position: finalPos.toArray(),
                    rotation: this.heldObjectMesh.quaternion.toArray(),
                    scale: this.heldObjectMesh.scale.x,
                });
            } else if (this.heldObjectType === 'player') {
                const footPos = finalPos.clone();
                if (this.heldObjectAvatar) footPos.sub(new THREE.Vector3(0, this.heldObjectOriginalOffsetY, 0));
                GameState.worker.port.postMessage({
                    type: 'update_held_player_rod',
                    playerId: this.heldPlayerId,
                    position: footPos.toArray(),
                    rotation: this.heldObjectMesh.quaternion.toArray(),
                    scale: this.heldObjectMesh.scale.x,
                });
            }
        }
    },

    /**
     * Checks if the player can pick up an object using the rod mechanic.
     * @param {THREE.Object3D} objectMesh - The object to check.
     * @returns {boolean} True if within range and not held by another.
     */
    canPickup(objectMesh) {
        if (!GameState.localPlayerState) return false;
        const cameraPos = GameState.camera.position.clone();
        const objectPos = objectMesh.position.clone();
        const distance = cameraPos.distanceTo(objectPos);
        const playerScale = GameState.localPlayerState.scale || 1;
        const maxPickupDistance = 50 * playerScale;
        return distance <= maxPickupDistance;
    },
};