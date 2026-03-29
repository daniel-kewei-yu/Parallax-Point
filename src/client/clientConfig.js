/*
Author: Daniel Yu
Date: March 15, 2026
Description: Client‑specific configuration. Imports shared constants from gameConstants.js
             and adds client‑only settings like eye offset. Values are used throughout the
             client for player dimensions, movement speed, world size, animation parameters,
             and gun placement.
*/

import * as THREE from 'three';
import {
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    EYE_HEIGHT,
    MOVE_SPEED,
    JUMP_FORCE,
    ROOM_SIZE,
    WALL_HEIGHT,
    WALL_THICKNESS,
    BLOCK_BASE_MASS,
    BROADCAST_INTERVAL,
    BLOCK_BROADCAST_INTERVAL,
    PUSH_COOLDOWN,
    MODEL_SCALE,
    MODEL_ROTATION_OFFSET_YAW,
    CAMERA_SMOOTH_FACTOR,
    GUN_SCALE,
    GUN_POSITION,
    GUN_ROTATION,
    EXTRA_YAW_DEGREES,
    MOVING_SPEED_THRESHOLD,
    MOVING_TIMEOUT
} from '../shared/gameConstants.js';

export const CLIENT_CONFIG = {
    // Player physical dimensions (shared)
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    EYE_HEIGHT,
    // Eye offset relative to head bone (tweaked for model alignment)
    EYE_OFFSET: new THREE.Vector3(0, -0.05, 0.05),

    // Movement (shared)
    MOVE_SPEED,
    JUMP_FORCE,

    // World (shared)
    ROOM_SIZE,
    WALL_HEIGHT,
    WALL_THICKNESS,

    // Blocks (shared)
    BLOCK_BASE_MASS,

    // Networking (shared)
    BROADCAST_INTERVAL,
    BLOCK_BROADCAST_INTERVAL,
    PUSH_COOLDOWN,

    // Model & camera
    MODEL_SCALE,
    // Convert shared yaw offset to a quaternion for model rotation
    MODEL_ROTATION_OFFSET: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, MODEL_ROTATION_OFFSET_YAW, 0)
    ),
    CAMERA_SMOOTH_FACTOR,

    // Portal gun appearance
    GUN_SCALE,
    GUN_POSITION: new THREE.Vector3(GUN_POSITION.x, GUN_POSITION.y, GUN_POSITION.z),
    GUN_ROTATION: new THREE.Euler(GUN_ROTATION.x, GUN_ROTATION.y, GUN_ROTATION.z),

    // Animation thresholds (shared)
    EXTRA_YAW_DEGREES: EXTRA_YAW_DEGREES * Math.PI / 180,   // Convert to radians
    MOVING_SPEED_THRESHOLD,
    MOVING_TIMEOUT,
};