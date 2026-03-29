/*
Author: Daniel Yu
Date: March 15, 2026
Description: Unit tests for the client utility functions (getYawQuaternion and getYawFromQuaternion).
             These tests verify that yaw‑to‑quaternion and quaternion‑to‑yaw conversions are correct
             for various angles, ensuring that the camera orientation and model rotation functions
             behave as expected. The tests use the Vitest testing framework.
*/

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getYawFromQuaternion, getYawQuaternion } from '../../src/client/clientUtils.js';

describe('clientUtils', () => {
    /**
     * Tests the getYawQuaternion function.
     * It should produce a quaternion that rotates the forward vector (0,0,-1) to the expected direction.
     */
    describe('getYawQuaternion', () => {
        /**
         * Test case: yaw = 0 (facing north). The forward vector should be (0,0,-1).
         */
        it('should create identity quaternion for yaw = 0', () => {
            const yaw = 0;
            const quat = getYawQuaternion(yaw);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
            expect(forward.x).toBeCloseTo(0);
            expect(forward.z).toBeCloseTo(-1);
        });

        /**
         * Test case: yaw = π/2 (facing east). The forward vector should be (1,0,0).
         */
        it('should rotate forward to east for yaw = 90°', () => {
            const yaw = Math.PI / 2;
            const quat = getYawQuaternion(yaw);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
            expect(forward.x).toBeCloseTo(1);
            expect(forward.z).toBeCloseTo(0);
        });

        /**
         * Test case: yaw = π (facing south). The forward vector should be (0,0,1).
         */
        it('should rotate forward to south for yaw = 180°', () => {
            const yaw = Math.PI;
            const quat = getYawQuaternion(yaw);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
            expect(forward.x).toBeCloseTo(0);
            expect(forward.z).toBeCloseTo(1);
        });

        /**
         * Test case: yaw = -π/2 (facing west). The forward vector should be (-1,0,0).
         */
        it('should rotate forward to west for yaw = -90°', () => {
            const yaw = -Math.PI / 2;
            const quat = getYawQuaternion(yaw);
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
            expect(forward.x).toBeCloseTo(-1);
            expect(forward.z).toBeCloseTo(0);
        });
    });

    /**
     * Tests the getYawFromQuaternion function.
     * It should correctly extract the yaw angle from a quaternion, regardless of the quaternion's
     * internal representation, within a small tolerance.
     */
    describe('getYawFromQuaternion', () => {
        /**
         * Test case: identity quaternion should give yaw = 0.
         */
        it('should return 0 for identity quaternion', () => {
            const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0));
            const yaw = getYawFromQuaternion(quat);
            expect(yaw).toBeCloseTo(0);
        });

        /**
         * Test case: quaternion representing a 90° rotation around Y should give yaw = π/2.
         */
        it('should extract yaw for 90° rotation', () => {
            const yawInput = Math.PI / 2;
            const quat = getYawQuaternion(yawInput);
            const yawOutput = getYawFromQuaternion(quat);
            expect(yawOutput).toBeCloseTo(yawInput);
        });

        /**
         * Test case: quaternion representing a 180° rotation around Y should give yaw = π.
         */
        it('should extract yaw for 180° rotation', () => {
            const yawInput = Math.PI;
            const quat = getYawQuaternion(yawInput);
            const yawOutput = getYawFromQuaternion(quat);
            expect(yawOutput).toBeCloseTo(yawInput);
        });

        /**
         * Test case: quaternion representing a -90° rotation around Y should give yaw = -π/2.
         */
        it('should extract yaw for -90° rotation', () => {
            const yawInput = -Math.PI / 2;
            const quat = getYawQuaternion(yawInput);
            const yawOutput = getYawFromQuaternion(quat);
            expect(yawOutput).toBeCloseTo(yawInput);
        });

        /**
         * Test case: a more complex rotation (e.g., 45°) should also be extracted accurately.
         */
        it('should extract yaw for 45° rotation', () => {
            const yawInput = Math.PI / 4;
            const quat = getYawQuaternion(yawInput);
            const yawOutput = getYawFromQuaternion(quat);
            expect(yawOutput).toBeCloseTo(yawInput);
        });
    });
});