/*
Author: Daniel Yu
Date: March 15, 2026
Description: Entry point for the Parallax-Point client. Initialises Three.js rendering,
             creates the local player model and collision capsule, connects to the physics
             worker, and starts all game loops (input, animation, render, UI updates).
*/

import { CLIENT_CONFIG } from './clientConfig.js';
import { GameState } from './clientState.js';
import { setupRendering } from './rendering/setup.js';
import { buildWorld } from './rendering/worldGeometry.js';
import { connectToWorker } from './network/workerClient.js';
import { RemotePlayerManager } from './players/RemotePlayerManager.js';
import { FirstPersonCharacter } from './players/FirstPersonCharacter.js';
import { setupInput, startInputLoop } from './input/inputHandler.js';
import { startAnimationLoop } from './animation/animationLoop.js';
import { startRenderLoop } from './animation/renderLoop.js';
import { startPlayerCountUpdater } from './ui/uiUpdater.js';
import * as THREE from 'three';

/**
 * Initialises the entire client application.
 */
function init() {
    // 1. Create the Three.js scene, camera, and renderer.
    const { scene, camera, renderer } = setupRendering();
    GameState.scene = scene;
    GameState.camera = camera;
    GameState.renderer = renderer;

    // 2. Build the static world geometry (walls, floor, platforms).
    buildWorld();

    // 3. Create an invisible collision capsule for the local player.
    //    This mesh is only used to visualise the capsule position for debugging;
    //    actual physics happens in the worker.
    const cylinderGeom = new THREE.CylinderGeometry(
        CLIENT_CONFIG.PLAYER_RADIUS,
        CLIENT_CONFIG.PLAYER_RADIUS,
        CLIENT_CONFIG.PLAYER_HEIGHT,
        8
    );
    const cylinderMat = new THREE.MeshPhongMaterial({ transparent: true, opacity: 0 });
    const capsule = new THREE.Mesh(cylinderGeom, cylinderMat);
    capsule.position.y = CLIENT_CONFIG.PLAYER_HEIGHT / 2;
    capsule.userData.isLocalPlayerPart = true;   // Mark for raycast filtering
    GameState.scene.add(capsule);
    GameState.physicsPlayer = { capsule };

    // 4. Create the local player character (model, animations, camera).
    GameState.firstPersonChar = new FirstPersonCharacter(scene);

    // 5. Connect to the physics SharedWorker and initialise remote player manager.
    connectToWorker();
    RemotePlayerManager.init();

    // 6. Set up input handlers and start all game loops.
    setupInput();
    startInputLoop();
    startAnimationLoop();
    startRenderLoop();
    startPlayerCountUpdater();
}

init();