/*
Author: Daniel Yu
Date: March 15, 2026
Description: Sets up the Three.js scene, camera, renderer, and lighting. Adds ambient,
             directional, and fill lights. Handles window resize events.
*/

import * as THREE from 'three';
import { GameState } from '../clientState.js';

/**
 * Creates and configures the Three.js rendering infrastructure.
 * @returns {Object} Object containing the scene, camera, and renderer.
 */
export function setupRendering() {
    // Create scene with dark blue background and fog for depth
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);

    // Perspective camera: 75° field of view, aspect ratio from window, near/far planes
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 0);  // Start at eye height

    // WebGL renderer with antialiasing
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;               // Enable shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Soft shadows
    document.body.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404060, 1); // Soft ambient fill
    scene.add(ambientLight);

    // Main directional light (simulating sunlight)
    const dirLight = new THREE.DirectionalLight(0xffeedd, 1);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    dirLight.receiveShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    const d = 15;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 25;
    scene.add(dirLight);

    // Fill light from the side to reduce harshness
    const fillLight = new THREE.PointLight(0x4466ff, 1);
    fillLight.position.set(-3, 5, 5);
    scene.add(fillLight);

    // Handle window resize: update camera aspect and renderer size
    window.addEventListener('resize', () => {
        if (GameState.camera) {
            GameState.camera.aspect = window.innerWidth / window.innerHeight;
            GameState.camera.updateProjectionMatrix();
        }
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, renderer };
}