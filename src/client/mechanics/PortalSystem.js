/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages the visual representation of portals on the client.
             Receives portal states from the worker and creates/destroys Three.js meshes.
             Portals are solid, glowing discs with a taller‑than‑wide shape (scale 0.8,1.2,0.8).
             They are double‑sided so they are visible from both directions, and their
             orientation is set by the quaternion received from the worker. For portals on
             horizontal surfaces (floor/ceiling), the taller dimension (Y) is vertical, so
             the portal appears as a circle (since the long axis is not in the plane of the disc).
             This is acceptable because the disc is flat; the visual effect is a glowing circle.
*/

import * as THREE from 'three';
import { GameState } from '../clientState.js';

export const PortalSystem = {
    portalMeshes: new Map(), // portalId -> { mesh, type }

    /**
     * Updates the portal meshes based on the current portal state from the worker.
     * Removes meshes for portals that no longer exist, creates new ones, and updates
     * position, rotation, and colour of existing ones.
     * @param {Array} portals - Array of portal state objects, each containing id, type, position, rotation.
     */
    updatePortals(portals) {
        // Remove portals that are no longer present in the state
        for (const [id, mesh] of this.portalMeshes) {
            if (!portals.some(p => p.id === id)) {
                GameState.scene.remove(mesh);
                this.portalMeshes.delete(id);
            }
        }

        // Create or update each portal
        for (const portal of portals) {
            let mesh = this.portalMeshes.get(portal.id);
            if (!mesh) {
                // Create a solid, glowing disc with a slightly oval shape (taller than wider)
                const geometry = new THREE.CircleGeometry(1.0, 32);
                const material = new THREE.MeshStandardMaterial({
                    color: portal.type === 'blue' ? 0x3399ff : 0xff9933,
                    emissive: portal.type === 'blue' ? 0x004466 : 0x442200,
                    emissiveIntensity: 1.2,
                    metalness: 0.3,
                    roughness: 0.4,
                    side: THREE.DoubleSide,      // Visible from both sides
                    transparent: false
                });
                mesh = new THREE.Mesh(geometry, material);
                // Scale to make portal taller than wider (Y axis stretched, X axis squeezed)
                // This scaling is applied in local coordinates before rotation.
                mesh.scale.set(0.8, 1.2, 0.8);
                mesh.castShadow = false;
                mesh.receiveShadow = false;
                mesh.userData = { isPortal: true, type: portal.type }; // For raycast filtering
                GameState.scene.add(mesh);
                this.portalMeshes.set(portal.id, mesh);
            }

            // Update position and rotation
            const pos = new THREE.Vector3(portal.position[0], portal.position[1], portal.position[2]);
            const quat = new THREE.Quaternion(portal.rotation[0], portal.rotation[1], portal.rotation[2], portal.rotation[3]);

            mesh.position.copy(pos);
            mesh.quaternion.copy(quat);

            // If the portal type changed (should never happen, but handle it), update colour
            if (mesh.userData.type !== portal.type) {
                const newColor = portal.type === 'blue' ? 0x3399ff : 0xff9933;
                const newEmissive = portal.type === 'blue' ? 0x004466 : 0x442200;
                mesh.material.color.setHex(newColor);
                mesh.material.emissive.setHex(newEmissive);
                mesh.userData.type = portal.type;
            }
        }
    },

    /**
     * Removes all portal meshes from the scene and clears the internal map.
     * Called when the client disconnects.
     */
    clear() {
        for (const [id, mesh] of this.portalMeshes) {
            GameState.scene.remove(mesh);
        }
        this.portalMeshes.clear();
    }
};