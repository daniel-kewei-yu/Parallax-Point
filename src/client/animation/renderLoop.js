/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages the rendering loop: updates held object position (both forced perspective
             and rod pickup), updates crosshair hover state, positions the local collision capsule,
             and renders the scene. Called every frame via requestAnimationFrame.
*/

import { CLIENT_CONFIG } from '../clientConfig.js';
import { GameState } from '../clientState.js';
import { ForcedPerspective } from '../mechanics/ForcedPerspective.js';
import { PortalPickup } from '../mechanics/PortalPickup.js';
import * as THREE from 'three';

export function startRenderLoop() {
    function renderLoop() {
        requestAnimationFrame(renderLoop);

        // Update forced perspective held object (E key)
        if (GameState.heldObjectId) {
            ForcedPerspective.updateHeldObject();
        }
        // Update rod pickup held object (Q key, portal gun equipped)
        if (PortalPickup.active) {
            PortalPickup.update();
        }

        ForcedPerspective.updateHover();

        // Position the local collision capsule based on worker state
        if (GameState.physicsPlayer?.capsule && GameState.localPlayerState) {
            const pos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
            const scale = GameState.localPlayerState.scale !== undefined ? GameState.localPlayerState.scale : 1;
            const halfHeight = (CLIENT_CONFIG.PLAYER_HEIGHT / 2) * scale;
            GameState.physicsPlayer.capsule.position.set(pos.x, pos.y + halfHeight, pos.z);
        }

        // Render the scene
        GameState.renderer.render(GameState.scene, GameState.camera);
    }

    renderLoop();
}