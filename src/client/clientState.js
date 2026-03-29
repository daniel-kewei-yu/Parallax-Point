/*
Author: Daniel Yu
Date: March 15, 2026
Description: Global state object that holds references to key Three.js objects (scene,
             camera, renderer) and transient state like held objects, input state,
             remote players, and the local player's most recent state from the worker.
*/

import * as THREE from 'three';

export const GameState = {
    // ---------- Rendering ----------
    scene: null,               // Three.js scene
    camera: null,              // Three.js camera (will be replaced by firstPersonChar's camera)
    renderer: null,            // Three.js WebGLRenderer
    clock: new THREE.Clock(),

    // ---------- Player identification ----------
    playerId: null,            // Unique ID assigned by worker (e.g., 'p_5')
    myAssignedNumber: null,    // Numeric part of player ID (for display)
    playerNumbers: new Map(),  // Maps player ID -> number (used for labels)
    nextNumber: 1,

    // ---------- World objects (blocks) ----------
    worldObjects: new Map(),   // id -> Three.js Mesh (for blocks)

    // ---------- Local player ----------
    physicsPlayer: null,       // { capsule: Mesh } – invisible collision representation
    firstPersonChar: null,     // FirstPersonCharacter instance (model, animations)
    controlsLocked: false,     // Whether pointer lock is active

    // ---------- Network ----------
    worker: null,              // SharedWorker instance
    inputInterval: 50,         // ms between sending input messages

    // ---------- Holding mechanics ----------
    isBeingHeld: false,        // Whether the local player is currently held by another player

    // Forced perspective (E) hold
    forcedPerspectiveActive: false,
    heldObjectId: null,        // Id of the object we are holding (block id or player id)
    heldObjectMesh: null,      // Three.js mesh of held object
    heldObjectType: null,      // 'block' or 'player'
    heldPlayerId: null,        // If holding a player, that player's id
    heldObjectCapsule: null,   // If holding a player, their capsule mesh
    heldObjectOriginalOffsetY: 0, // Original offset from foot to capsule centre
    holdRelativeRotation: new THREE.Quaternion(), // Rotation of held object relative to camera
    holdLockedScale: 1.0,
    holdLockedDistance: 0,
    holdLockedHalfExtents: new THREE.Vector3(0.5, 0.5, 0.5),

    // Rod pickup (Q) hold
    rodPickupActive: false,

    // ---------- Raycaster & crosshair ----------
    raycaster: new THREE.Raycaster(),
    crosshair: document.getElementById('crosshair'),
    hoveredObject: null,       // Currently hovered object (for visual feedback)

    // ---------- Remote players ----------
    remotePlayers: new Map(),   // id -> remote player object (from RemotePlayerManager)

    // ---------- Local player state from worker ----------
    localPlayerState: null,    // Most recent state of local player (from worker)

    // ---------- Input state ----------
    keyState: { w: false, a: false, s: false, d: false, space: false },
    rawYaw: 0,                 // Current yaw (radians)
    pitch: 0,                  // Current pitch (radians)
};