/*
Author: Daniel Yu
Date: March 15, 2026
Description: Handles connection to the SharedWorker, sending and receiving messages,
             and updating local state based on world_state broadcasts. It also saves
             the local player's state to sessionStorage before page unload and restores
             it when reconnecting. The client uses a timestamp to ignore stale input
             after teleport, ensuring orientation is not overwritten.
*/

import { GameState } from '../clientState.js';
import { updateBlocks } from '../mechanics/blockManager.js';
import { RemotePlayerManager } from '../players/RemotePlayerManager.js';
import { PortalSystem } from '../mechanics/PortalSystem.js';
import * as THREE from 'three';

let lastAppliedYaw = null; // Track the last yaw applied from worker to avoid unnecessary updates

export function connectToWorker() {
    const workerUrl = 'src/worker/physicsSharedWorker.js';
    GameState.worker = new SharedWorker(workerUrl, { type: 'module' });
    GameState.worker.port.start();

    // Save local player state before page unload
    window.addEventListener('beforeunload', () => {
        if (GameState.localPlayerState && GameState.playerId && GameState.firstPersonChar) {
            const stateToSave = {
                playerId: GameState.playerId,
                position: GameState.localPlayerState.position,
                rotation: GameState.rawYaw,
                pitch: GameState.pitch,
                isEquipped: GameState.firstPersonChar.isEquipped,
                inHoldPose: GameState.firstPersonChar.isHoldingPose,
                scale: GameState.localPlayerState.scale,
                velocity: GameState.localPlayerState.velocity,
                onGround: GameState.localPlayerState.onGround,
            };
            sessionStorage.setItem('parallaxPlayerState', JSON.stringify(stateToSave));
        }
        if (GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({ type: 'leave' });
        }
    });

    // Retrieve saved state from sessionStorage (if any)
    let savedState = null;
    const savedStateStr = sessionStorage.getItem('parallaxPlayerState');
    if (savedStateStr) {
        try {
            savedState = JSON.parse(savedStateStr);
        } catch (e) {}
    }

    GameState.worker.port.onmessage = (event) => {
        const msg = event.data;
        if (msg.type === 'player_id') {
            GameState.playerId = msg.id;
            const num = parseInt(msg.id.split('_')[1]) || 1;
            GameState.myAssignedNumber = num;
            document.getElementById('player-id').textContent = `Poopy_${num}`;
            sessionStorage.setItem('parallaxPlayerId', msg.id);
            lastAppliedYaw = null;
        } else if (msg.type === 'world_state') {
            updateBlocks(msg.blocks);
            if (msg.portals) PortalSystem.updatePortals(msg.portals);

            const localPlayer = msg.players.find((p) => p.id === GameState.playerId);
            if (localPlayer) {
                const wasBeingHeld = GameState.isBeingHeld;
                GameState.localPlayerState = localPlayer;
                GameState.isBeingHeld = localPlayer.held || false;

                const newYaw = localPlayer.rotation;
                if (newYaw !== undefined && newYaw !== lastAppliedYaw) {
                    GameState.rawYaw = newYaw;
                    lastAppliedYaw = newYaw;
                    // Force camera orientation immediately
                    if (GameState.firstPersonChar && GameState.camera) {
                        GameState.camera.quaternion.setFromEuler(new THREE.Euler(GameState.pitch, GameState.rawYaw, 0, 'YXZ'));
                    }
                }

                // Pitch is only updated from worker if the player is being held (where orientation is forced)
                if (GameState.isBeingHeld && localPlayer.pitch !== undefined) {
                    GameState.pitch = localPlayer.pitch;
                    if (GameState.firstPersonChar && GameState.camera) {
                        GameState.camera.quaternion.setFromEuler(new THREE.Euler(GameState.pitch, GameState.rawYaw, 0, 'YXZ'));
                    }
                }

                // Sync local player's model scale
                if (localPlayer.scale !== undefined && GameState.firstPersonChar) {
                    GameState.firstPersonChar.setModelScale(localPlayer.scale);
                    if (GameState.physicsPlayer && GameState.physicsPlayer.capsule) {
                        const capsuleScale = Math.max(localPlayer.scale, 0.01);
                        GameState.physicsPlayer.capsule.scale.set(capsuleScale, capsuleScale, capsuleScale);
                    }
                } else if (!GameState.isBeingHeld && GameState.firstPersonChar) {
                    GameState.firstPersonChar.setModelScale(1);
                    if (GameState.physicsPlayer && GameState.physicsPlayer.capsule) {
                        GameState.physicsPlayer.capsule.scale.set(1, 1, 1);
                    }
                }

                // If being held, sync model rotation
                if (GameState.isBeingHeld && localPlayer.heldRot && localPlayer.heldRot.length === 4 && GameState.firstPersonChar) {
                    const quat = new THREE.Quaternion().fromArray(localPlayer.heldRot);
                    GameState.firstPersonChar.setModelRotation(quat);
                    if (GameState.physicsPlayer && GameState.physicsPlayer.capsule) {
                        GameState.physicsPlayer.capsule.quaternion.copy(quat);
                    }
                }

                // If just dropped, reset model rotation
                if (wasBeingHeld && !GameState.isBeingHeld) {
                    if (GameState.firstPersonChar && GameState.firstPersonChar.model) {
                        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, localPlayer.rotation, 0, 'YXZ'));
                        GameState.firstPersonChar.setModelRotation(quat);
                    }
                    if (GameState.physicsPlayer && GameState.physicsPlayer.capsule) {
                        GameState.physicsPlayer.capsule.quaternion.identity();
                    }
                }

                // Equipment and hold pose sync
                if (GameState.firstPersonChar) {
                    const wasEquipped = GameState.firstPersonChar.isEquipped;
                    const isEquippedNow = localPlayer.isEquipped;
                    const inHoldPoseNow = localPlayer.inHoldPose;
                    GameState.firstPersonChar.isEquipped = isEquippedNow;
                    if (isEquippedNow && !wasEquipped) {
                        if (inHoldPoseNow) GameState.firstPersonChar.applyHoldPose();
                        else GameState.firstPersonChar.syncEquip();
                    } else if (!isEquippedNow && wasEquipped) {
                        if (GameState.firstPersonChar.isHoldingPose) {
                            GameState.firstPersonChar.isHoldingPose = false;
                            GameState.firstPersonChar.holdPose = null;
                        }
                    }
                }
            }

            // Update remote players
            for (const p of msg.players) {
                if (p.id !== GameState.playerId) {
                    RemotePlayerManager.updateRemoteAvatar(p.id, p);
                }
            }
            // Remove remote players that have left
            for (const [id, player] of GameState.remotePlayers) {
                if (!msg.players.some((p) => p.id === id)) {
                    RemotePlayerManager.removeAvatar(id);
                }
            }
        }
    };

    // Generate or retrieve a client token for reconnection
    let clientToken = sessionStorage.getItem('parallaxClientToken');
    if (!clientToken) {
        clientToken = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('parallaxClientToken', clientToken);
    }
    const storedPlayerId = sessionStorage.getItem('parallaxPlayerId');
    const joinMessage = { type: 'join', playerId: storedPlayerId, clientToken };
    if (savedState) joinMessage.initialState = savedState;
    GameState.worker.port.postMessage(joinMessage);
}