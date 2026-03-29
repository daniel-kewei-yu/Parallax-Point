/*
Author: Daniel Yu
Date: March 15, 2026
Description: Defines the Block class for the physics worker. Each block has a
             Cannon.js body with a shape determined by its type (sphere, cylinder,
             pyramid, etc.). The class handles scaling (rebuilding the shape) and
             provides a serializable state for broadcasting. The worker also contains
             the initial world blocks.
*/

import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';
import { world, blockMaterial, blocks } from './physicsSharedWorker.js';
import { CONFIG } from './worker_config.js';

export class Block {
    /**
     * Creates a new block with physics body.
     * @param {number} x - X coordinate.
     * @param {number} y - Y coordinate.
     * @param {number} z - Z coordinate.
     * @param {string} type - Block shape type ('box', 'sphere', etc.).
     * @param {number} color - Hex color.
     * @param {number} [scale=1] - Uniform scale factor.
     * @param {Object} [dimensions=null] - For rectangularPrism: {x, y, z}.
     */
    constructor(x, y, z, type, color, scale = 1, dimensions = null) {
        this.id = Math.random().toString(36).substring(2, 10);
        this.type = type;
        this.color = color;
        this.scale = scale;
        this.dimensions = dimensions;

        this.buildShape();
        this.body = new CANNON.Body({ mass: CONFIG.BLOCK_BASE_MASS * Math.pow(scale, 3), material: blockMaterial });
        this.body.userData = { blockId: this.id };
        this.body.addShape(this.shape);
        this.body.position.set(x, y, z);
        this.body.linearDamping = 0.1;
        this.body.angularDamping = 0.1;
        this.body.ccdSpeedThreshold = 1;
        this.body.ccdRadius = scale * 0.5;
        world.addBody(this.body);

        this.owner = null;           // Player ID who holds this block
        this.heldPos = null;         // Position when held
        this.heldRot = null;         // Rotation when held
        this.heldScale = null;       // Scale when held
    }

    /**
     * Builds the Cannon.js shape based on type, scale, and dimensions.
     */
    buildShape() {
        const scale = this.scale;
        const type = this.type;
        const dimensions = this.dimensions;

        switch (type) {
            case 'sphere':
                this.shape = new CANNON.Sphere(0.5 * scale);
                break;
            case 'cylinder':
                this.shape = new CANNON.Cylinder(0.5 * scale, 0.5 * scale, 1 * scale, 8);
                break;
            case 'triangularPrism':
                this.shape = new CANNON.Cylinder(0.5 * scale, 0.5 * scale, 1 * scale, 3);
                break;
            case 'pyramid':
                this.shape = new CANNON.Cylinder(0, 0.5 * scale, 1 * scale, 4);
                break;
            case 'rectangularPrism':
                if (!dimensions) dimensions = { x: 1, y: 1, z: 1 };
                const w = dimensions.x * scale;
                const h = dimensions.y * scale;
                const d = dimensions.z * scale;
                this.shape = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2));
                break;
            default: // 'box'
                this.shape = new CANNON.Box(new CANNON.Vec3(0.5 * scale, 0.5 * scale, 0.5 * scale));
        }
    }

    /**
     * Changes the block's scale, rebuilding the shape and updating mass.
     * @param {number} newScale - New scale factor.
     */
    setScale(newScale) {
        if (newScale === this.scale) return;
        this.scale = newScale;
        // Remove old shape and add new one
        while (this.body.shapes.length) {
            this.body.removeShape(this.body.shapes[0]);
        }
        this.buildShape();
        this.body.addShape(this.shape);
        this.body.mass = CONFIG.BLOCK_BASE_MASS * Math.pow(newScale, 3);
        this.body.updateMassProperties();
        this.body.ccdRadius = newScale * 0.5;
    }

    /**
     * Returns a serializable state of the block.
     * If the block is held, returns the held position, rotation, and scale.
     * @returns {Object} Block state.
     */
    getState() {
        if (this.owner && this.heldPos && this.heldRot) {
            return {
                id: this.id,
                type: this.type,
                position: this.heldPos,
                rotation: this.heldRot,
                scale: this.heldScale !== null ? this.heldScale : this.scale,
                color: this.color,
                owner: this.owner,
                dimensions: this.dimensions
            };
        }
        return {
            id: this.id,
            type: this.type,
            position: [this.body.position.x, this.body.position.y, this.body.position.z],
            rotation: [this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w],
            scale: this.scale,
            color: this.color,
            owner: this.owner,
            dimensions: this.dimensions
        };
    }
}

/**
 * Creates the initial set of blocks in the world.
 */
export function createInitialWorld() {
    const initialBlocks = [
        { type: 'box', pos: [3, 0.6, 2], color: 0xff5555, scale: 1.0 },
        { type: 'box', pos: [0, 0.5, 5], color: 0x55ff55, scale: 0.8 },
        { type: 'box', pos: [-3, 0.7, -2], color: 0x5555ff, scale: 1.2 },
        { type: 'box', pos: [4, 0.8, -4], color: 0xffdd55, scale: 1.5 },
        { type: 'box', pos: [-4, 0.4, 3], color: 0xff55ff, scale: 0.6 },
        { type: 'box', pos: [1, 0.6, -2], color: 0x55ddff, scale: 1.0 },
        { type: 'box', pos: [-2, 0.7, -1], color: 0xdd55ff, scale: 1.3 },
        { type: 'box', pos: [5, 0.55, 1], color: 0xffaa55, scale: 0.9 },
        { type: 'box', pos: [2, 0.4, 3], color: 0x88aaff, scale: 0.5 },
        { type: 'box', pos: [-3, 0.4, -1], color: 0x88aaff, scale: 0.5 },
        { type: 'box', pos: [0, 0.4, -4], color: 0x88aaff, scale: 0.5 },

        { type: 'sphere', pos: [-2, 1.2, 4], color: 0xffaa88, scale: 0.8 },
        { type: 'sphere', pos: [5, 1.5, -3], color: 0x88ffaa, scale: 1.2 },
        { type: 'sphere', pos: [-5, 1.0, 2], color: 0xaa88ff, scale: 0.6 },

        { type: 'cylinder', pos: [2, 0.8, -5], color: 0xffaa88, scale: 0.9 },
        { type: 'cylinder', pos: [-4, 0.6, 5], color: 0x88ffaa, scale: 1.1 },
        { type: 'cylinder', pos: [6, 0.9, -2], color: 0xaa88ff, scale: 0.7 },

        { type: 'triangularPrism', pos: [-1, 0.7, -4], color: 0xffaa88, scale: 1.0 },
        { type: 'triangularPrism', pos: [3, 0.5, -6], color: 0x88ffaa, scale: 0.8 },
        { type: 'triangularPrism', pos: [-5, 0.6, -1], color: 0xaa88ff, scale: 1.2 },

        { type: 'pyramid', pos: [4, 0.5, 4], color: 0xffaa88, scale: 0.9 },
        { type: 'pyramid', pos: [-3, 0.6, 6], color: 0x88ffaa, scale: 1.1 },
        { type: 'pyramid', pos: [1, 0.4, -6], color: 0xaa88ff, scale: 0.7 },

        { type: 'rectangularPrism', pos: [7, 0.5, 7], color: 0xffaa88, scale: 1.0, dimensions: { x: 0.4, y: 1.8, z: 0.4 } }
    ];

    initialBlocks.forEach(b => {
        const block = new Block(b.pos[0], b.pos[1], b.pos[2], b.type, b.color, b.scale, b.dimensions);
        blocks.set(block.id, block);
    });
}