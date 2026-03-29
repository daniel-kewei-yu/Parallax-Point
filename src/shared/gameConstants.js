/*
Author: Daniel Yu
Date: March 15, 2026
Description: Centralised constants shared by both client and worker.
             This eliminates duplication and ensures consistency between
             rendering and physics. Values are used for player dimensions,
             movement, world size, block properties, animation, and gun appearance.
*/

// ---------- Player physical properties ----------
export const PLAYER_RADIUS = 0.4;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.6;

// ---------- Movement & physics ----------
export const MOVE_SPEED = 4.0;
export const JUMP_FORCE = 6.0;
export const GRAVITY = -9.82;

// ---------- World dimensions ----------
export const ROOM_SIZE = 100;
export const WALL_HEIGHT = 40;
export const WALL_THICKNESS = 0.5;

// ---------- Block properties ----------
export const BLOCK_BASE_MASS = 50;

// ---------- Networking & timing ----------
export const BROADCAST_INTERVAL = 30;          // ms (reference)
export const BLOCK_BROADCAST_INTERVAL = 30;
export const PUSH_COOLDOWN = 100;
export const INPUT_INTERVAL = 50;              // ms between sending input messages

// ---------- Animation & model ----------
export const MODEL_SCALE = 0.0105;
// Model rotation offset (190° around Y) as Euler angles (radians)
export const MODEL_ROTATION_OFFSET_YAW = (190 * Math.PI) / 180;
export const CAMERA_SMOOTH_FACTOR = 0.1;

// ---------- Gun (portal gun) appearance ----------
export const GUN_SCALE = 0.35;
export const GUN_POSITION = { x: 10, y: 30, z: 0 };
export const GUN_ROTATION = {
    x: -(10 * Math.PI) / 180,
    y: -(10 * Math.PI) / 180,
    z: 0
};

// ---------- Animation timing ----------
export const MOVING_SPEED_THRESHOLD = 0.2;
export const MOVING_TIMEOUT = 0.3;             // seconds
export const EXTRA_YAW_DEGREES = 25;            // additional yaw when holding gun