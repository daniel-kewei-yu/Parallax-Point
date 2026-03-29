/*
Author: Daniel Yu
Date: March 15, 2026
Description: Configuration for the physics worker (Cannon.js). Imports shared constants
             from gameConstants.js to stay in sync with the client. Defines timestep and
             interval for the physics loop.
*/

import {
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    MOVE_SPEED,
    JUMP_FORCE,
    ROOM_SIZE,
    WALL_HEIGHT,
    WALL_THICKNESS,
    BLOCK_BASE_MASS,
    GRAVITY
} from '../shared/gameConstants.js';

export const CONFIG = {
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    MOVE_SPEED,
    JUMP_FORCE,
    ROOM_SIZE,
    WALL_HEIGHT,
    WALL_THICKNESS,
    BLOCK_BASE_MASS,
    GRAVITY,
    FIXED_TIMESTEP: 1 / 60,          // 60 steps per second
    PHYSICS_INTERVAL_MS: 1000 / 60,   // 60 Hz
};