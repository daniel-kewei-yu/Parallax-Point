/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages animation updates for the local and remote players.
             It runs at a fixed frame rate (approx 60 FPS) and updates the
             FirstPersonCharacter and all remote player animations with the
             time delta since the last update.
*/

import { GameState } from '../clientState.js';
import { RemotePlayerManager } from '../players/RemotePlayerManager.js';

let lastAnimTime = performance.now(); // Timestamp of the last animation update

/**
 * Updates animations for local and remote players based on time delta.
 */
function updateAnimations() {
    const now = performance.now();
    let delta = Math.min((now - lastAnimTime) / 1000, 0.1); // Cap delta to 0.1 seconds
    lastAnimTime = now;

    if (GameState.firstPersonChar) {
        GameState.firstPersonChar.update(delta);
    }

    RemotePlayerManager.updateRemoteAnimations(delta);
}

/**
 * Starts the animation loop using setInterval.
 */
export function startAnimationLoop() {
    setInterval(() => {
        updateAnimations();
    }, 1000 / 60); // Target 60 FPS
}