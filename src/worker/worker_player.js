/*
Author: Daniel Yu
Date: March 15, 2026
Description: Defines the Player class for the physics worker. Each player has a
             Cannon.js body with a capsule shape (two spheres and a box). The class
             handles movement, jumping, ground detection, scaling, and being held by
             another player. It also stores the player's yaw, pitch, equip state,
             and hold pose for synchronisation.
*/

import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { world, playerMaterial } from './physicsSharedWorker.js';
import { CONFIG } from './worker_config.js';

export class Player {
    /**
     * Creates a new player.
     * @param {string} id - Unique player ID.
     * @param {Object} position - Spawn position {x, y, z}.
     */
    constructor(id, position) {
        this.id = id;
        this.clientToken = null;
        this.scale = 1.0;

        // Create the physics body
        this.body = new CANNON.Body({
            mass: 70,
            material: playerMaterial,
            fixedRotation: true,
            linearDamping: 0,
            angularDamping: 0.1
        });
        this.body.userData = { playerId: this.id };

        // Remove any default shapes and add capsule shapes
        while (this.body.shapes.length) this.body.removeShape(this.body.shapes[0]);

        this.radius = CONFIG.PLAYER_RADIUS;
        this.height = CONFIG.PLAYER_HEIGHT;
        this.buildCollisionShapes(this.radius, this.height);

        this.body.position.set(position.x, position.y, position.z);
        this.body.ccdSpeedThreshold = 0.2;
        this.body.ccdRadius = this.radius * 0.8;

        world.addBody(this.body);

        // State variables
        this.onGround = false;
        this.wasOnGround = false;
        this.canJump = true;
        this.input = { forward: 0, right: 0, jump: false };
        this.yaw = 0;
        this.pitch = 0;
        this.isEquipped = false;
        this.inHoldPose = false;
        this.heldObjectId = null;
        this.velocity = [0, 0, 0];
        this.heldPos = null;
        this.heldRot = null;
        this.held = false;

        this.cameraYaw = 0;
        this.cameraPitch = 0;
        this.jumped = false;

        this.disableCollisionFrames = 0;
        this.lastTeleportTime = 0; // timestamp of last teleport (milliseconds)
    }

    /**
     * Builds the collision shapes for the player: a capsule represented by two spheres and a box.
     * @param {number} radius - Collision radius.
     * @param {number} height - Full height.
     */
    buildCollisionShapes(radius, height) {
        const cylinderHeight = height - radius * 2;

        // Bottom sphere
        const bottomSphere = new CANNON.Sphere(radius);
        this.body.addShape(bottomSphere, new CANNON.Vec3(0, radius, 0));

        // Middle box
        const midBoxHeight = cylinderHeight;
        const midBox = new CANNON.Box(new CANNON.Vec3(radius * 0.95, midBoxHeight / 2, radius * 0.95));
        this.body.addShape(midBox, new CANNON.Vec3(0, radius + midBoxHeight / 2, 0));

        // Top sphere
        const topSphere = new CANNON.Sphere(radius);
        this.body.addShape(topSphere, new CANNON.Vec3(0, height - radius, 0));
    }

    /**
     * Sets the player's scale, rebuilding collision shapes and updating mass.
     * @param {number} newScale - New scale factor.
     */
    setScale(newScale) {
        if (newScale === this.scale) return;
        this.scale = Math.max(newScale, 0.01);
        while (this.body.shapes.length) {
            this.body.removeShape(this.body.shapes[0]);
        }
        const scaledRadius = this.radius * this.scale;
        const scaledHeight = this.height * this.scale;
        this.buildCollisionShapes(scaledRadius, scaledHeight);
        this.body.ccdRadius = scaledRadius * 0.8;
        this.body.mass = 70 * Math.pow(this.scale, 3);
        this.body.updateMassProperties();
    }

    /**
     * Puts the player in held state (by another player) or releases it.
     * @param {boolean} held - Whether the player is being held.
     * @param {Array} pos - Foot position [x,y,z] when held.
     * @param {Array} rot - Rotation quaternion [x,y,z,w] when held.
     * @param {number} cameraYaw - Holder's yaw.
     * @param {number} cameraPitch - Holder's pitch.
     */
    setHeld(held, pos, rot, cameraYaw, cameraPitch) {
        this.held = held;
        if (held) {
            this.body.mass = 0;
            this.body.type = CANNON.Body.KINEMATIC;
            this.body.updateMassProperties();
            this.heldPos = pos;
            this.heldRot = rot;
            this.cameraYaw = cameraYaw || 0;
            this.cameraPitch = cameraPitch || 0;
        } else {
            this.body.mass = 70 * Math.pow(this.scale, 3);
            this.body.type = CANNON.Body.DYNAMIC;
            this.body.updateMassProperties();
            this.heldPos = null;
            this.heldRot = null;
            this.cameraYaw = 0;
            this.cameraPitch = 0;
            this.input.jump = false;
            this.input.forward = 0;
            this.input.right = 0;
        }
    }

    /**
     * Updates the player's physics (velocity, jump) for a given timestep.
     * @param {number} dt - Delta time in seconds.
     */
    updatePhysics(dt) {
        if (this.held) return;

        const forwardInput = this.input.forward;
        const rightInput = this.input.right;
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        const dx = rightInput * cos + (-forwardInput) * sin;
        const dz = -rightInput * sin + (-forwardInput) * cos;
        let moveDir = new CANNON.Vec3(dx, 0, dz);
        if (moveDir.length() > 0.01) moveDir.normalize();
        const vel = this.body.velocity;
        const speedScale = this.scale;
        vel.x = moveDir.x * CONFIG.MOVE_SPEED * speedScale;
        vel.z = moveDir.z * CONFIG.MOVE_SPEED * speedScale;

        if (this.input.jump && this.onGround && this.canJump) {
            vel.y = CONFIG.JUMP_FORCE * speedScale;
            this.input.jump = false;
            this.canJump = false;
            this.clearContacts();
            this.body.collisionResponse = false;
            this.disableCollisionFrames = 2;
            this.jumped = true;
        } else if (this.input.jump && !this.onGround) {
            this.input.jump = false;
        }

        this.velocity = [vel.x, vel.y, vel.z];
    }

    /**
     * Updates the player's ground status using raycasts in a 5x5 grid under the player.
     */
    updateGroundStatus() {
        if (this.held) {
            this.onGround = false;
            return;
        }
        this.wasOnGround = this.onGround;
        this.onGround = false;

        const radius = this.radius * this.scale;
        const halfExtent = radius * 0.8; // footprint radius
        const gridSize = 5;               // 5x5 grid
        const step = (halfExtent * 2) / (gridSize - 1);
        const startX = -halfExtent;
        const startZ = -halfExtent;

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const x = startX + i * step;
                const z = startZ + j * step;
                const start = new CANNON.Vec3(this.body.position.x + x, this.body.position.y + 0.05, this.body.position.z + z);
                const end = new CANNON.Vec3(this.body.position.x + x, this.body.position.y - 0.5 * this.scale, this.body.position.z + z);
                const result = new CANNON.RaycastResult();
                world.raycastClosest(start, end, {}, result);
                if (result.hasHit && result.body !== this.body) {
                    const hitDistance = start.y - result.hitPointWorld.y;
                    if (hitDistance < 0.25 * this.scale) {
                        this.onGround = true;
                        break;
                    }
                }
            }
            if (this.onGround) break;
        }

        if (this.onGround && !this.wasOnGround) {
            this.canJump = true;
        }
    }

    /**
     * Clears contacts that involve this player (used after jump to avoid sticky collisions).
     */
    clearContacts() {
        world.contacts = world.contacts.filter(contact => {
            return contact.bi !== this.body && contact.bj !== this.body;
        });
    }

    /**
     * Called after each physics step to handle temporary collision disable.
     */
    postStep() {
        if (this.held) return;
        if (this.disableCollisionFrames > 0) {
            this.disableCollisionFrames--;
            if (this.disableCollisionFrames === 0) {
                this.body.collisionResponse = true;
            }
        }
    }

    /**
     * Returns a serializable state of the player.
     * @returns {Object} Player state.
     */
    getState() {
        const state = {
            id: this.id,
            position: this.held ? this.heldPos : [this.body.position.x, this.body.position.y, this.body.position.z],
            rotation: this.yaw,
            pitch: this.pitch,
            onGround: this.onGround,
            isEquipped: this.isEquipped,
            inHoldPose: this.inHoldPose,
            heldObjectId: this.heldObjectId,
            velocity: this.velocity,
            heldPos: this.heldPos,
            heldRot: this.heldRot,
            held: this.held,
            cameraYaw: this.cameraYaw,
            cameraPitch: this.cameraPitch,
            scale: this.scale,
            jumped: this.jumped,
        };
        this.jumped = false;
        return state;
    }
}