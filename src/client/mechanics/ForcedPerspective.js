/*
Author: Daniel Yu
Date: March 15, 2026
Description: This file implements the forced-perspective grab mechanic. When the player presses E,
             the crosshair changes colour if a grabbable object (block or remote player) is within
             range. Pressing E again picks up the object, which then floats at a fixed distance
             in front of the camera. The object scales and rotates to maintain the illusion of
             being held at arm's length, and it can be placed anywhere by dropping it. The system
             uses raycasts to detect obstacles and adjusts the object's distance accordingly so
             that it does not clip through walls or floors. This mechanic is mutually exclusive
             with the rod pickup (Q) and is only available when the portal gun is not equipped.
*/

import * as THREE from 'three';
import { CLIENT_CONFIG } from '../clientConfig.js';
import { GameState } from '../clientState.js';
import { RemotePlayerManager } from '../players/RemotePlayerManager.js';
import { getYawFromQuaternion } from '../clientUtils.js';

// The ForcedPerspective object contains all functions needed to manage the forced-perspective grab.
// It is exported as a singleton so that other modules can call its methods.
export const ForcedPerspective = {
    /**
     * Computes the half-extents of an object in its local space.
     * Used to determine the size of the held object for collision detection.
     * @param {THREE.Object3D} obj - The object to measure.
     * @returns {THREE.Vector3} Half-extents (x, y, z) in world units.
     */
    computeLocalHalfExtents(obj) {
        const box = new THREE.Box3();                     // Bounding box that will be expanded
        box.makeEmpty();                                 // Start with empty box

        // Traverse all children of the object to collect mesh geometries.
        // This ensures we get the full shape even for complex models.
        obj.traverse(child => {
            if (!child.isMesh || !child.geometry) return; // Skip non‑mesh children
            if (!child.geometry.boundingBox) child.geometry.computeBoundingBox(); // Ensure bounds

            // Compute the transformation from the child's local space to the object's local space.
            const relMatrix = new THREE.Matrix4();
            let cur = child;
            while (cur && cur !== obj) {
                relMatrix.premultiply(cur.matrix);
                cur = cur.parent;
            }

            // Transform the child's bounding box into the object's local space and union it.
            const childBox = child.geometry.boundingBox.clone().applyMatrix4(relMatrix);
            box.union(childBox);
        });

        // If the object has no geometry (should not happen), return a default half-extent.
        if (box.isEmpty()) return new THREE.Vector3(0.5, 0.5, 0.5);
        const size = new THREE.Vector3();
        box.getSize(size);                               // Get the total size of the box
        return size.multiplyScalar(0.5);                 // Return half the size (half-extents)
    },

    /**
     * Computes the screen-space bounding box of an object.
     * Used to determine where the object will be drawn on the screen for collision detection.
     * @param {THREE.Object3D} obj - The object to test.
     * @returns {Object} An object with minX, maxX, minY, maxY in normalized device coordinates (-1 to 1).
     */
    computeScreenBounds(obj) {
        const box = new THREE.Box3().setFromObject(obj); // World-space bounding box
        // The eight corners of the bounding box in world coordinates.
        const corners = [
            new THREE.Vector3(box.min.x, box.min.y, box.min.z),
            new THREE.Vector3(box.max.x, box.min.y, box.min.z),
            new THREE.Vector3(box.min.x, box.max.y, box.min.z),
            new THREE.Vector3(box.max.x, box.max.y, box.min.z),
            new THREE.Vector3(box.min.x, box.min.y, box.max.z),
            new THREE.Vector3(box.max.x, box.min.y, box.max.z),
            new THREE.Vector3(box.min.x, box.max.y, box.max.z),
            new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        let minX = 1, maxX = -1, minY = 1, maxY = -1;   // Initialize extremes
        corners.forEach(world => {
            // Project each corner to screen space (normalized device coordinates)
            const screen = world.clone().project(GameState.camera);
            minX = Math.min(minX, screen.x);
            maxX = Math.max(maxX, screen.x);
            minY = Math.min(minY, screen.y);
            maxY = Math.max(maxY, screen.y);
        });
        return { minX, maxX, minY, maxY };
    },

    /**
     * Updates the position and scale of the currently held object.
     * Called every frame by the render loop. It moves the object along the camera view
     * direction, scales it according to the desired distance, and ensures it does not
     * clip through walls or floors by casting rays from the camera to the desired position.
     */
    updateHeldObject() {
        if (!GameState.heldObjectMesh) return;          // Nothing held

        // When holding a player, we use the capsule (collision representation) as the held mesh,
        // because the avatar may be complex.
        if (GameState.heldObjectType === 'player') {
            GameState.heldObjectMesh = GameState.heldObjectCapsule;
        }

        // Rotate the held object to match the camera rotation, then apply the stored relative rotation.
        // This ensures the object maintains its orientation relative to the camera when picked up.
        GameState.heldObjectMesh.quaternion.copy(GameState.camera.quaternion).multiply(GameState.holdRelativeRotation);

        // Compute the screen-space bounds of the object (used to decide where to cast rays).
        const bounds = this.computeScreenBounds(GameState.heldObjectMesh);
        const width = bounds.maxX - bounds.minX;
        const height = bounds.maxY - bounds.minY;

        // Gather all objects that could block the held object (walls, floors, other players).
        const obstacles = [];
        GameState.scene.traverse(obj => {
            if (obj.isMesh && obj !== GameState.heldObjectMesh) {
                // Skip the player's own capsule if we are holding a player.
                if (GameState.heldObjectType === 'player' && obj === GameState.heldObjectCapsule) return;
                // Include remote player capsules and other meshes (except local player parts).
                if (obj.userData.remoteAvatarCapsule) obstacles.push(obj);
                else if (!obj.userData.isLocalPlayerPart && !obj.userData.remoteAvatar) obstacles.push(obj);
            }
        });

        // Forward direction from the camera (where the object should be placed).
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(GameState.camera.quaternion).normalize();
        // Inverse of the object's current rotation, used to transform the forward direction into local space.
        const invObjQuat = GameState.heldObjectMesh.quaternion.clone().invert();
        const u = forward.clone().applyQuaternion(invObjQuat);

        const halfExtents = GameState.holdLockedHalfExtents ?? new THREE.Vector3(0.5, 0.5, 0.5);
        const distScale = GameState.holdLockedScale / GameState.holdLockedDistance;
        const kVec = halfExtents.clone().multiplyScalar(distScale);

        // Use a grid of rays across the object's screen projection to find the closest obstacle.
        const gridSize = 32;
        const stepX = width / (gridSize - 1);
        const stepY = height / (gridSize - 1);
        let minCandidate = Infinity;

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const ndcX = bounds.minX + i * stepX;      // Normalized device coordinate X
                const ndcY = bounds.minY + j * stepY;      // Normalized device coordinate Y
                const ray = new THREE.Raycaster();
                ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), GameState.camera);
                const intersects = ray.intersectObjects(obstacles);
                if (intersects.length > 0) {
                    const D = GameState.camera.position.distanceTo(intersects[0].point);
                    const r = ray.ray.direction.clone().normalize();
                    const b = r.clone().applyQuaternion(invObjQuat);

                    let L_min = Infinity;
                    for (let axis = 0; axis < 3; axis++) {
                        const bi = b.getComponent(axis);
                        if (Math.abs(bi) < 1e-6) continue;   // Avoid division by zero
                        const ui = u.getComponent(axis);
                        const ki = kVec.getComponent(axis);
                        let Li;
                        if (bi > 0) Li = (ki + ui) / bi;
                        else Li = (ui - ki) / bi;
                        if (Li > 0 && Li < L_min) L_min = Li;
                    }
                    if (L_min !== Infinity) {
                        const candidate = D / L_min;
                        if (candidate < minCandidate) minCandidate = candidate;
                    }
                }
            }
        }

        // If no obstacle hit, place the object far away (no limit).
        if (minCandidate === Infinity) minCandidate = 100.0;

        const epsilon = 0.001;
        let centerDist = minCandidate - epsilon;          // Slight offset to avoid z-fighting
        const minDist = 0.2;                             // Prevent object from going inside the camera
        centerDist = Math.max(minDist, centerDist);

        let newPos = GameState.camera.position.clone().add(forward.clone().multiplyScalar(centerDist));
        const newScale = GameState.holdLockedScale * (centerDist / GameState.holdLockedDistance);

        GameState.heldObjectMesh.position.copy(newPos);
        GameState.heldObjectMesh.scale.set(newScale, newScale, newScale);

        // If holding a player, also update the avatar position and scale.
        if (GameState.heldObjectType === 'player' && GameState.heldObjectAvatar) {
            GameState.heldObjectAvatar.position.copy(newPos);
            GameState.heldObjectAvatar.quaternion.copy(GameState.heldObjectMesh.quaternion);
            const totalScale = CLIENT_CONFIG.MODEL_SCALE * newScale;
            GameState.heldObjectAvatar.scale.set(totalScale, totalScale, totalScale);
        }

        // Send the new position, scale, and rotation to the worker for synchronization.
        if (GameState.worker && GameState.playerId && GameState.heldObjectId) {
            if (GameState.heldObjectType === 'block') {
                GameState.worker.port.postMessage({
                    type: 'update_held',
                    objectId: GameState.heldObjectId,
                    position: newPos.toArray(),
                    scale: newScale,
                    rotation: GameState.heldObjectMesh.quaternion.toArray(),
                });
            } else if (GameState.heldObjectType === 'player') {
                const footPos = newPos.clone().sub(new THREE.Vector3(0, GameState.heldObjectOriginalOffsetY * newScale, 0));
                GameState.worker.port.postMessage({
                    type: 'update_held_player',
                    playerId: GameState.heldPlayerId,
                    position: footPos.toArray(),
                    rotation: GameState.heldObjectMesh.quaternion.toArray(),
                    scale: newScale,
                });
            }
        }
    },

    /**
     * Attempts to pick up an object (block or remote player) under the crosshair.
     * If nothing is under the crosshair, it does nothing.
     * If something is held, it drops it.
     */
    togglePickup() {
        // If already holding an object, drop it.
        if (GameState.heldObjectId) {
            this.drop();
            return;
        }

        // Cast a ray from the camera center.
        GameState.raycaster.setFromCamera(new THREE.Vector2(0, 0), GameState.camera);

        // First, check remote players (their capsules).
        const playerCapsules = Array.from(RemotePlayerManager.remotePlayers.values())
            .map(p => p.capsule)
            .filter(c => c);
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
            if (playerId) {
                this.pickupPlayer(playerId);
                return;
            }
        }

        // Then check blocks.
        intersects = GameState.raycaster.intersectObjects(Array.from(GameState.worldObjects.values()));
        if (intersects.length > 0) {
            const hit = intersects[0].object;
            // Only pick up if the block is not owned by another player.
            if (!hit.userData.owner || hit.userData.owner === GameState.playerId) {
                this.pickupBlock(hit);
            }
            return;
        }
    },

    /**
     * Picks up a block.
     * @param {THREE.Mesh} blockMesh - The block mesh to pick up.
     */
    pickupBlock(blockMesh) {
        GameState.heldObjectMesh = blockMesh;
        GameState.heldObjectId = blockMesh.userData.id;
        GameState.heldObjectType = 'block';

        // Compute the relative rotation between camera and block at pickup.
        const cameraQuat = GameState.camera.quaternion.clone();
        const invCameraQuat = cameraQuat.invert();
        GameState.holdRelativeRotation.copy(invCameraQuat.multiply(blockMesh.quaternion.clone()));

        // Store the block's current scale, distance from camera, and half-extents.
        GameState.holdLockedScale = blockMesh.scale.x;
        GameState.holdLockedDistance = Math.max(GameState.camera.position.distanceTo(blockMesh.position), 0.001);
        GameState.holdLockedHalfExtents = this.computeLocalHalfExtents(blockMesh);

        // Mark the block as owned by the local player.
        blockMesh.userData.owner = GameState.playerId;

        // Tell the worker that we have picked up this block.
        if (GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({
                type: 'pickup',
                objectId: GameState.heldObjectId,
                rotation: blockMesh.quaternion.toArray(),
            });
        }
    },

    /**
     * Picks up a remote player.
     * @param {string} playerId - ID of the player to pick up.
     */
    pickupPlayer(playerId) {
        const player = RemotePlayerManager.remotePlayers.get(playerId);
        if (!player) return;

        // Store references to the player's capsule and avatar.
        GameState.heldObjectCapsule = player.capsule;
        GameState.heldObjectAvatar = player.avatar;
        GameState.heldObjectOriginalOffsetY = player.offsetY;
        GameState.heldObjectId = playerId;
        GameState.heldObjectType = 'player';
        GameState.heldPlayerId = playerId;

        // Use the capsule as the held mesh (for collision and scaling).
        GameState.heldObjectMesh = player.capsule;

        // Keep the avatar visible and make the capsule semi-transparent.
        player.avatar.visible = true;
        player.capsule.material.transparent = true;
        player.capsule.material.opacity = 0;

        // Compute the relative rotation between the camera and the player's avatar.
        const carrierQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(GameState.pitch, GameState.rawYaw, 0, 'YXZ'));
        const invCarrier = carrierQuat.clone().invert();
        GameState.holdRelativeRotation.copy(invCarrier.multiply(player.avatar.quaternion.clone()));

        // Store scale, distance, and half-extents.
        GameState.holdLockedScale = player.capsule.scale.x;
        GameState.holdLockedDistance = Math.max(GameState.camera.position.distanceTo(player.capsule.position), 0.001);
        GameState.holdLockedHalfExtents = this.computeLocalHalfExtents(player.capsule);

        // Notify the worker that we have picked up this player.
        const footPos = player.avatar.position.clone().sub(new THREE.Vector3(0, player.offsetY, 0));
        if (GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({
                type: 'pickup_player',
                playerId: playerId,
                position: footPos.toArray(),
                rotation: player.capsule.quaternion.toArray(),
            });
        }
    },

    /**
     * Drops the currently held object, restoring its physics.
     */
    drop() {
        if (!GameState.heldObjectMesh) return;

        const finalPos = GameState.heldObjectMesh.position.clone();
        const finalScale = GameState.heldObjectMesh.scale.x;
        let finalRot = GameState.heldObjectMesh.quaternion.clone();

        // For players, adjust the final rotation so they stand upright.
        if (GameState.heldObjectType === 'player') {
            GameState.heldObjectCapsule.material.opacity = 0; // Ensure capsule is invisible
            const invModelOffset = CLIENT_CONFIG.MODEL_ROTATION_OFFSET.clone().invert();
            const baseRot = invModelOffset.multiply(finalRot);
            const yaw = getYawFromQuaternion(baseRot);
            finalRot.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
        }

        // Prevent the dropped object from overlapping with the local player.
        if (GameState.heldObjectType === 'block') {
            this.adjustBlockForPlayer(finalPos, finalRot, finalScale);
        } else if (GameState.heldObjectType === 'player') {
            this.adjustPlayerForCollision(finalPos, finalScale);
        }

        // Send the drop command to the worker.
        if (GameState.worker && GameState.playerId) {
            if (GameState.heldObjectType === 'block') {
                GameState.worker.port.postMessage({
                    type: 'drop',
                    objectId: GameState.heldObjectId,
                    position: finalPos.toArray(),
                    scale: finalScale,
                    rotation: finalRot.toArray(),
                });
            } else {
                const yaw = getYawFromQuaternion(finalRot);
                GameState.worker.port.postMessage({
                    type: 'drop_player',
                    playerId: GameState.heldPlayerId,
                    position: finalPos.toArray(),
                    rotation: finalRot.toArray(),
                    scale: finalScale,
                    finalYaw: yaw,
                });
            }
        }

        // Reset all held state variables.
        GameState.heldObjectId = null;
        GameState.heldObjectMesh = null;
        GameState.heldObjectType = null;
        GameState.heldPlayerId = null;
        GameState.heldObjectCapsule = null;
        GameState.heldObjectAvatar = null;
        GameState.heldObjectOriginalOffsetY = 0;
        GameState.holdRelativeRotation.set(0, 0, 0, 1);
        GameState.holdLockedHalfExtents = new THREE.Vector3(0.5, 0.5, 0.5);
        GameState.forcedPerspectiveActive = false;
    },

    /**
     * Adjusts a block's position when dropped to avoid intersecting the local player.
     * @param {THREE.Vector3} targetPos - Desired position.
     * @param {THREE.Quaternion} targetRot - Desired rotation (unused, kept for signature).
     * @param {number} targetScale - Scale factor.
     */
    adjustBlockForPlayer(targetPos, targetRot, targetScale) {
        if (!GameState.localPlayerState) return;
        const playerPos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
        const half = targetScale / 2;                     // Half extent of the block (assuming cube)
        const blockMin = targetPos.clone().sub(new THREE.Vector3(half, half, half));
        const blockMax = targetPos.clone().add(new THREE.Vector3(half, half, half));
        const playerMin = new THREE.Vector3(playerPos.x - CLIENT_CONFIG.PLAYER_RADIUS, playerPos.y, playerPos.z - CLIENT_CONFIG.PLAYER_RADIUS);
        const playerMax = new THREE.Vector3(playerPos.x + CLIENT_CONFIG.PLAYER_RADIUS, playerPos.y + CLIENT_CONFIG.PLAYER_HEIGHT, playerPos.z + CLIENT_CONFIG.PLAYER_RADIUS);

        // Check if block and player overlap.
        if (blockMax.x > playerMin.x && blockMin.x < playerMax.x &&
            blockMax.y > playerMin.y && blockMin.y < playerMax.y &&
            blockMax.z > playerMin.z && blockMin.z < playerMax.z) {
            // Determine the smallest overlap axis and push the block away.
            const overlapX = Math.min(blockMax.x, playerMax.x) - Math.max(blockMin.x, playerMin.x);
            const overlapY = Math.min(blockMax.y, playerMax.y) - Math.max(blockMin.y, playerMin.y);
            const overlapZ = Math.min(blockMax.z, playerMax.z) - Math.max(blockMin.z, playerMin.z);
            if (overlapX < overlapY && overlapX < overlapZ) {
                targetPos.x += (targetPos.x < playerPos.x ? -overlapX : overlapX);
            } else if (overlapY < overlapX && overlapY < overlapZ) {
                targetPos.y += (targetPos.y < playerPos.y ? -overlapY : overlapY);
            } else {
                targetPos.z += (targetPos.z < playerPos.z ? -overlapZ : overlapZ);
            }
        }
    },

    /**
     * Adjusts a player's position when dropped to avoid intersecting the local player.
     * @param {THREE.Vector3} targetPos - Desired foot position.
     * @param {number} targetScale - Scale factor.
     */
    adjustPlayerForCollision(targetPos, targetScale) {
        if (!GameState.localPlayerState) return;
        const playerPos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
        const half = targetScale / 2;                     // Approximate half-extent of the player capsule
        const playerMin = new THREE.Vector3(playerPos.x - CLIENT_CONFIG.PLAYER_RADIUS, playerPos.y, playerPos.z - CLIENT_CONFIG.PLAYER_RADIUS);
        const playerMax = new THREE.Vector3(playerPos.x + CLIENT_CONFIG.PLAYER_RADIUS, playerPos.y + CLIENT_CONFIG.PLAYER_HEIGHT, playerPos.z + CLIENT_CONFIG.PLAYER_RADIUS);
        const heldMin = targetPos.clone().sub(new THREE.Vector3(half, half, half));
        const heldMax = targetPos.clone().add(new THREE.Vector3(half, half, half));

        // If overlap occurs, push away along the smallest overlap axis.
        if (heldMax.x > playerMin.x && heldMin.x < playerMax.x &&
            heldMax.y > playerMin.y && heldMin.y < playerMax.y &&
            heldMax.z > playerMin.z && heldMin.z < playerMax.z) {
            const overlapX = Math.min(heldMax.x, playerMax.x) - Math.max(heldMin.x, playerMin.x);
            const overlapY = Math.min(heldMax.y, playerMax.y) - Math.max(heldMin.y, playerMin.y);
            const overlapZ = Math.min(heldMax.z, playerMax.z) - Math.max(heldMin.z, playerMin.z);
            if (overlapX < overlapY && overlapX < overlapZ) {
                targetPos.x += (targetPos.x < playerPos.x ? -overlapX : overlapX);
            } else if (overlapY < overlapX && overlapY < overlapZ) {
                targetPos.y += (targetPos.y < playerPos.y ? -overlapY : overlapY);
            } else {
                targetPos.z += (targetPos.z < playerPos.z ? -overlapZ : overlapZ);
            }
        }
    },

    /**
     * Updates the crosshair colour based on whether something grabbable is under the reticle.
     * Called every frame by the render loop.
     */
    updateHover() {
        if (!GameState.firstPersonChar?.camera) return;
        // If controls are not locked or we are already holding something, show default crosshair.
        if (!GameState.controlsLocked || GameState.heldObjectId) {
            GameState.crosshair.style.backgroundColor = 'rgba(255,255,255,0.3)';
            GameState.crosshair.style.borderColor = 'rgba(255,255,255,0.8)';
            return;
        }
        // Raycast from the centre of the camera.
        GameState.raycaster.setFromCamera(new THREE.Vector2(0, 0), GameState.camera);

        // First check remote players (their capsules).
        const playerCapsules = Array.from(RemotePlayerManager.remotePlayers.values())
            .map(p => p.capsule)
            .filter(c => c);
        let intersects = GameState.raycaster.intersectObjects(playerCapsules);
        if (intersects.length > 0) {
            GameState.crosshair.style.backgroundColor = 'rgba(0,255,0,0.5)';
            GameState.crosshair.style.borderColor = '#0f0';
            return;
        }

        // Then check blocks.
        intersects = GameState.raycaster.intersectObjects(Array.from(GameState.worldObjects.values()));
        if (intersects.length > 0) {
            const hit = intersects[0].object;
            // If the block is owned by the local player or unowned, show green (grabbable).
            if (!hit.userData.owner || hit.userData.owner === GameState.playerId) {
                GameState.crosshair.style.backgroundColor = 'rgba(0,255,0,0.5)';
                GameState.crosshair.style.borderColor = '#0f0';
                GameState.hoveredObject = hit;
                return;
            } else {
                // Owned by another player – show red (cannot grab).
                GameState.crosshair.style.backgroundColor = 'rgba(255,0,0,0.3)';
                GameState.crosshair.style.borderColor = '#f00';
                return;
            }
        }

        // Default: white crosshair.
        GameState.crosshair.style.backgroundColor = 'rgba(255,255,255,0.3)';
        GameState.crosshair.style.borderColor = 'rgba(255,255,255,0.8)';
    },
};