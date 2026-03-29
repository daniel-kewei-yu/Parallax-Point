/*
Author: Daniel Yu
Date: March 15, 2026
Description: Utility functions for client‑side calculations: conversion between yaw
             (rotation around Y) and forward direction, and extracting yaw from a quaternion.
*/

import * as THREE from 'three';

/**
 * Creates a quaternion representing a rotation around the Y axis.
 * @param {number} yaw - Rotation angle in radians.
 * @returns {THREE.Quaternion} Quaternion for the given yaw.
 */
export function getYawQuaternion(yaw) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
}

/**
 * Extracts the yaw angle (rotation around Y axis) from a quaternion.
 * @param {THREE.Quaternion} quat - Input quaternion.
 * @returns {number} Yaw angle in radians.
 */
export function getYawFromQuaternion(quat) {
    // Forward direction is the rotated (0,0,-1) vector.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    return Math.atan2(forward.x, forward.z);
}