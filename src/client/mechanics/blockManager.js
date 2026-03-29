/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages the visual representation of blocks on the client.
             Receives block states from the worker and creates/updates/deletes
             Three.js meshes accordingly. It skips blocks that are currently held
             by the local player (either via forced perspective or rod pickup) to
             avoid visual flickering. The block geometry is chosen based on the
             block type (sphere, cylinder, pyramid, etc.) and dimensions.
*/

import * as THREE from 'three';
import { GameState } from '../clientState.js';
import { PortalPickup } from './PortalPickup.js';

/**
 * Updates the scene to match the current block states from the worker.
 * @param {Array} blocksState - Array of block state objects (id, type, position, etc.)
 */
export function updateBlocks(blocksState) {
    // Remove blocks that no longer exist
    for (const [id, mesh] of GameState.worldObjects) {
        if (!blocksState.some((b) => b.id === id)) {
            GameState.scene.remove(mesh);
            GameState.worldObjects.delete(id);
        }
    }

    // Update existing or create new blocks
    for (const b of blocksState) {
        // Skip if this block is currently held by the local player via forced perspective or rod pickup
        if (GameState.heldObjectId === b.id || (PortalPickup.active && PortalPickup.heldObjectId === b.id)) {
            continue;
        }

        let mesh = GameState.worldObjects.get(b.id);
        if (!mesh) {
            // Create geometry based on block type
            let geometry;
            switch (b.type) {
                case 'sphere':
                    geometry = new THREE.SphereGeometry(0.5, 32, 32);
                    break;
                case 'cylinder':
                    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
                    break;
                case 'triangularPrism':
                    geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 3);
                    break;
                case 'pyramid':
                    geometry = new THREE.ConeGeometry(0.5, 1, 4);
                    break;
                case 'rectangularPrism':
                    if (b.dimensions) {
                        geometry = new THREE.BoxGeometry(b.dimensions.x, b.dimensions.y, b.dimensions.z);
                    } else {
                        geometry = new THREE.BoxGeometry(1, 1, 1);
                    }
                    break;
                default: // 'box'
                    geometry = new THREE.BoxGeometry(1, 1, 1);
            }
            const material = new THREE.MeshStandardMaterial({ color: b.color });
            mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { id: b.id, owner: b.owner, type: b.type, dimensions: b.dimensions };
            GameState.scene.add(mesh);
            GameState.worldObjects.set(b.id, mesh);
        }
        // Update transform and appearance
        mesh.position.fromArray(b.position);
        mesh.quaternion.fromArray(b.rotation);
        mesh.scale.set(b.scale, b.scale, b.scale);
        mesh.userData.owner = b.owner;
        if (mesh.material) mesh.material.color.setHex(b.color);
    }
}