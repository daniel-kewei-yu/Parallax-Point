/*
Author: Daniel Yu
Date: March 15, 2026
Description: Builds the static world geometry: floor, walls, ceiling, grid helper,
             plus additional platforms and walls around the periphery. All meshes are
             added to the scene and receive shadows.
*/

import * as THREE from 'three';
import { GameState } from '../clientState.js';
import { CLIENT_CONFIG } from '../clientConfig.js';

export function buildWorld() {
    // Materials
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.4, metalness: 0.1 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.7 });
    const platformMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6e8e, roughness: 0.5, metalness: 0.2 });

    // Main floor plane
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(CLIENT_CONFIG.ROOM_SIZE * 2, CLIENT_CONFIG.ROOM_SIZE * 2),
        floorMaterial
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    GameState.scene.add(floor);

    /**
     * Helper to create a wall (box) with given dimensions and rotation.
     * @param {number} width - X extent.
     * @param {number} height - Y extent.
     * @param {number} depth - Z extent.
     * @param {THREE.Vector3} pos - Centre position.
     * @param {THREE.Vector3} rot - Euler angles (radians).
     * @returns {THREE.Mesh} The created wall mesh.
     */
    function createWall(width, height, depth, pos, rot) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.rotation.set(rot.x, rot.y, rot.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        GameState.scene.add(mesh);
        return mesh;
    }

    // Outer walls (front, back, left, right)
    createWall(CLIENT_CONFIG.ROOM_SIZE * 2, CLIENT_CONFIG.WALL_HEIGHT, CLIENT_CONFIG.WALL_THICKNESS,
        new THREE.Vector3(0, CLIENT_CONFIG.WALL_HEIGHT / 2, -CLIENT_CONFIG.ROOM_SIZE), new THREE.Vector3(0, 0, 0));
    createWall(CLIENT_CONFIG.ROOM_SIZE * 2, CLIENT_CONFIG.WALL_HEIGHT, CLIENT_CONFIG.WALL_THICKNESS,
        new THREE.Vector3(0, CLIENT_CONFIG.WALL_HEIGHT / 2, CLIENT_CONFIG.ROOM_SIZE), new THREE.Vector3(0, 0, 0));
    createWall(CLIENT_CONFIG.WALL_THICKNESS, CLIENT_CONFIG.WALL_HEIGHT, CLIENT_CONFIG.ROOM_SIZE * 2,
        new THREE.Vector3(-CLIENT_CONFIG.ROOM_SIZE, CLIENT_CONFIG.WALL_HEIGHT / 2, 0), new THREE.Vector3(0, 0, 0));
    createWall(CLIENT_CONFIG.WALL_THICKNESS, CLIENT_CONFIG.WALL_HEIGHT, CLIENT_CONFIG.ROOM_SIZE * 2,
        new THREE.Vector3(CLIENT_CONFIG.ROOM_SIZE, CLIENT_CONFIG.WALL_HEIGHT / 2, 0), new THREE.Vector3(0, 0, 0));

    // High ceiling
    const ceiling = createWall(CLIENT_CONFIG.ROOM_SIZE * 2, CLIENT_CONFIG.WALL_THICKNESS, CLIENT_CONFIG.ROOM_SIZE * 2,
        new THREE.Vector3(0, CLIENT_CONFIG.WALL_HEIGHT, 0), new THREE.Vector3(0, 0, 0));

    // Helper to add a rectangular platform
    function addPlatform(width, height, depth, pos) {
        const platform = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            platformMaterial
        );
        platform.position.set(pos.x, pos.y, pos.z);
        platform.castShadow = true;
        platform.receiveShadow = true;
        GameState.scene.add(platform);
    }

    // Four large platforms around the edges
    const platformHeight = 1;
    const platformY = 3;
    addPlatform(11, platformHeight, 20, { x: -25, y: platformY, z: 0 });
    addPlatform(11, platformHeight, 20, { x: 25, y: platformY, z: 0 });
    addPlatform(20, platformHeight, 11, { x: 0, y: platformY, z: -25 });
    addPlatform(20, platformHeight, 11, { x: 0, y: platformY, z: 25 });

    // Ring walls (16 segments, each 3 units wide, 2 units tall)
    const ringRadius = 31;
    const ringHeight = 5;
    const ringThickness = 2;
    const ringSegments = 16;
    for (let i = 0; i < ringSegments; i++) {
        const angle = (i / ringSegments) * Math.PI * 2;
        const x = Math.cos(angle) * ringRadius;
        const z = Math.sin(angle) * ringRadius;
        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(10, ringHeight, ringThickness),
            wallMaterial
        );
        wall.position.set(x, ringHeight / 2, z);
        wall.lookAt(0, ringHeight / 2, 0);
        wall.castShadow = true;
        wall.receiveShadow = true;
        GameState.scene.add(wall);
    }

    // Pillars at various positions
    const pillarHeight = 6;
    const pillarY = 3;
    const pillarSize = 1.5;
    const pillarPositions = [
        [-10, 0, -20], [10, 0, -20], [-10, 0, 20], [10, 0, 20],
        [-20, 0, -10], [20, 0, -10], [-20, 0, 10], [20, 0, 10]
    ];
    pillarPositions.forEach(pos => {
        const pillar = new THREE.Mesh(
            new THREE.BoxGeometry(pillarSize, pillarHeight, pillarSize),
            platformMaterial
        );
        pillar.position.set(pos[0], pillarY, pos[2]);
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        GameState.scene.add(pillar);
    });

    // Grid helper for reference
    const gridHelper = new THREE.GridHelper(CLIENT_CONFIG.ROOM_SIZE * 2, 40, 0xffaa00, 0x335588);
    gridHelper.position.y = 0.01;
    GameState.scene.add(gridHelper);
}