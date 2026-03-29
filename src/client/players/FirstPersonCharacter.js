/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages the local player character: loads the GLTF model, sets up animation
             mixers for upper and lower body, handles equipping/unequipping the portal gun,
             positions the model based on physics state, and updates the camera.
*/

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import { CLIENT_CONFIG } from '../clientConfig.js';
import { GameState } from '../clientState.js';
import { getYawQuaternion } from '../clientUtils.js';

export class FirstPersonCharacter {
    /**
     * Creates a new local character.
     * @param {THREE.Scene} scene - The scene to add the model to.
     */
    constructor(scene) {
        this.scene = scene;
        this.model = null;               // The GLTF model (cloned)
        this.headBone = null;            // Bone for head (used to position camera)
        this.rightHandBone = null;       // Bone where gun will attach
        this.gunModel = null;            // Portal gun model
        this.camera = null;              // First‑person camera (created after model loads)
        this.upperMixer = null;          // Animation mixer for upper body
        this.lowerMixer = null;          // Animation mixer for lower body
        this.lowerActions = {};          // Walk/jump/idle actions for lower body
        this.upperLocomotionActions = {};// Walk/jump/idle actions for upper body (when not equipped)
        this.drawAction = null;          // Equip animation action
        this.currentLowerAnim = null;
        this.currentUpperAnim = null;
        this.isEquipped = false;         // Whether portal gun is drawn
        this.isAnimating = false;        // Whether an equip/unequip animation is playing
        this.isHoldingPose = false;      // Whether we are in the equip pose (hold pose)
        this.holdPose = null;            // Map of bone -> original transforms for hold pose

        this.upperBodyBones = [];        // Bones affected by upper body animations
        this.lowerBodyBones = [];        // Bones affected by lower body animations

        this.visualScale = 1;            // Current scale multiplier (from being held)
        this.headToEyeOffset = CLIENT_CONFIG.EYE_OFFSET.clone();
        this.smoothedCamPos = new THREE.Vector3();

        this.modelLoaded = false;
        this.pendingSyncEquip = false;
        this.pendingHoldPose = false;
        this.gunShouldBeVisible = false;

        this.movingTimer = 0;            // Timer for detecting movement (for animations)
        this.footOffset = 0;             // Distance from model origin to foot (at unit scale)

        // Create a temporary camera; will be replaced when model loads.
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        GameState.camera = this.camera;

        // Set a default camera position based on player foot if available (will be updated)
        if (GameState.localPlayerState && GameState.localPlayerState.position) {
            const footPos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
            this.camera.position.set(footPos.x, footPos.y + CLIENT_CONFIG.EYE_HEIGHT, footPos.z);
        } else {
            this.camera.position.set(0, CLIENT_CONFIG.EYE_HEIGHT, 0);
        }
        this.smoothedCamPos.copy(this.camera.position);

        this.loadModel();
        this.loadGun();
    }

    /**
     * Filters an animation clip to keep only tracks for allowed bone names.
     * This is used to separate upper and lower body animations.
     * @param {THREE.AnimationClip} clip - Original clip.
     * @param {string[]} allowedBoneNames - Bone names (normalised) to keep.
     * @returns {THREE.AnimationClip|null} Filtered clip or null if no tracks remain.
     */
    filterAnimationClip(clip, allowedBoneNames) {
        const filteredTracks = clip.tracks.filter(track => {
            const dotIndex = track.name.lastIndexOf('.');
            if (dotIndex === -1) return false;
            const boneName = track.name.substring(0, dotIndex);
            let normalized = boneName.replace(/^(mixamorig:|Armature_|Armature\.)/i, '');
            normalized = normalized.replace(/\d+$/, '');
            return allowedBoneNames.includes(normalized);
        });
        if (filteredTracks.length === 0) return null;
        return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
    }

    /**
     * Loads the player GLTF model.
     */
    loadModel() {
        const loader = new GLTFLoader();
        loader.load(
            'assets/models/thePlayer.glb',
            (gltf) => {
                const model = SkeletonUtils.clone(gltf.scene);
                model.scale.set(CLIENT_CONFIG.MODEL_SCALE, CLIENT_CONFIG.MODEL_SCALE, CLIENT_CONFIG.MODEL_SCALE);
                this.model = model;
                this.scene.add(model);
                model.quaternion.copy(CLIENT_CONFIG.MODEL_ROTATION_OFFSET);

                // Compute foot offset: distance from model origin to lowest point
                const box = new THREE.Box3().setFromObject(model);
                this.footOffset = -box.min.y;

                // Identify bones and separate upper/lower
                const upperBones = [];
                const lowerBones = [];
                model.traverse(child => {
                    if (child.isBone) {
                        const name = child.name.toLowerCase();
                        if (name.includes('head')) this.headBone = child;
                        if (name.includes('right') && name.includes('hand')) this.rightHandBone = child;
                        if (/spine|neck|head|clavicle|arm|hand|shoulder/.test(name)) {
                            upperBones.push(child);
                            this.upperBodyBones.push(child);
                        }
                        if (/hip|thigh|calf|foot|toe|leg|pelvis/.test(name)) {
                            lowerBones.push(child);
                            this.lowerBodyBones.push(child);
                        }
                    }
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        if (child.material) {
                            if (Array.isArray(child.material)) child.material.forEach(m => m.transparent = false);
                            else child.material.transparent = false;
                        }
                        child.userData.isLocalPlayerPart = true;
                    }
                });

                const upperBoneNames = upperBones.map(b => {
                    let n = b.name.replace(/^(mixamorig:|Armature_|Armature\.)/i, '');
                    n = n.replace(/\d+$/, '');
                    return n;
                });
                const lowerBoneNames = lowerBones.map(b => {
                    let n = b.name.replace(/^(mixamorig:|Armature_|Armature\.)/i, '');
                    n = n.replace(/\d+$/, '');
                    return n;
                });

                this.lowerMixer = new THREE.AnimationMixer(model);
                this.upperMixer = new THREE.AnimationMixer(model);

                if (gltf.animations) {
                    const anims = gltf.animations;
                    const walk = anims.find(a => a.name.toLowerCase().includes('walk') || a.name.toLowerCase().includes('crouch'));
                    const jump = anims.find(a => a.name.toLowerCase().includes('jump'));
                    const idle = anims.find(a => a.name.toLowerCase().includes('idle'));
                    const draw = anims.find(a => a.name.toLowerCase().includes('draw') || a.name.toLowerCase().includes('pull') || a.name.toLowerCase().includes('equip'));

                    if (walk) {
                        const lowerWalk = this.filterAnimationClip(walk, lowerBoneNames);
                        if (lowerWalk) this.lowerActions.walk = this.lowerMixer.clipAction(lowerWalk).setLoop(THREE.LoopRepeat);
                        const upperWalk = this.filterAnimationClip(walk, upperBoneNames);
                        if (upperWalk) this.upperLocomotionActions.walk = this.upperMixer.clipAction(upperWalk).setLoop(THREE.LoopRepeat);
                    }
                    if (jump) {
                        const lowerJump = this.filterAnimationClip(jump, lowerBoneNames);
                        if (lowerJump) this.lowerActions.jump = this.lowerMixer.clipAction(lowerJump).setLoop(THREE.LoopRepeat);
                        const upperJump = this.filterAnimationClip(jump, upperBoneNames);
                        if (upperJump) this.upperLocomotionActions.jump = this.upperMixer.clipAction(upperJump).setLoop(THREE.LoopRepeat);
                    }
                    if (idle) {
                        const lowerIdle = this.filterAnimationClip(idle, lowerBoneNames);
                        if (lowerIdle) this.lowerActions.idle = this.lowerMixer.clipAction(lowerIdle).setLoop(THREE.LoopRepeat);
                        const upperIdle = this.filterAnimationClip(idle, upperBoneNames);
                        if (upperIdle) this.upperLocomotionActions.idle = this.upperMixer.clipAction(upperIdle).setLoop(THREE.LoopRepeat);
                    }
                    if (draw) {
                        const filteredDraw = this.filterAnimationClip(draw, upperBoneNames);
                        if (filteredDraw) {
                            this.drawAction = this.upperMixer.clipAction(filteredDraw);
                            this.drawAction.setLoop(THREE.LoopOnce);
                            this.drawAction.clampWhenFinished = true;
                        }
                    }
                }

                // Start idle animations
                if (this.lowerActions.idle) {
                    this.lowerActions.idle.play();
                    this.currentLowerAnim = 'idle';
                }
                if (this.upperLocomotionActions.idle) {
                    this.upperLocomotionActions.idle.play();
                    this.currentUpperAnim = 'idle';
                }

                // Override camera with the real one (already set)
                // Position it using head bone
                const headPos = this.getHeadWorldPosition();
                this.smoothedCamPos.copy(headPos).add(this.headToEyeOffset);
                this.camera.position.copy(this.smoothedCamPos);

                this.modelLoaded = true;
                if (this.pendingSyncEquip) {
                    this.syncEquip();
                    this.pendingSyncEquip = false;
                }
                if (this.pendingHoldPose) {
                    this.applyHoldPose();
                }
                if (this.gunShouldBeVisible && this.gunModel) {
                    this.gunModel.visible = true;
                }
            },
            undefined,
            (error) => this.createFallback()
        );
    }

    /**
     * Loads the portal gun model and attaches it to the right hand bone.
     */
    loadGun() {
        const loader = new GLTFLoader();
        loader.load(
            'assets/models/portalGun.glb',
            (gltf) => {
                const gun = gltf.scene;
                gun.scale.set(CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE);
                gun.visible = false;
                this.gunModel = gun;
                const tryAttach = () => {
                    if (this.rightHandBone) {
                        this.rightHandBone.add(gun);
                        gun.position.copy(CLIENT_CONFIG.GUN_POSITION);
                        gun.rotation.set(CLIENT_CONFIG.GUN_ROTATION.x, CLIENT_CONFIG.GUN_ROTATION.y, CLIENT_CONFIG.GUN_ROTATION.z);
                        gun.traverse((child) => {
                            if (child.isMesh) child.userData.isLocalPlayerPart = true;
                        });
                    } else setTimeout(tryAttach, 100);
                };
                tryAttach();
                if (this.gunShouldBeVisible) {
                    this.gunModel.visible = true;
                }
            }
        );
    }

    /**
     * Gets the world position of the head bone.
     * @returns {THREE.Vector3} Head position in world coordinates.
     */
    getHeadWorldPosition() {
        if (!this.headBone) return new THREE.Vector3(0, 0, 0);
        this.model.updateWorldMatrix(true, true);
        return this.headBone.getWorldPosition(new THREE.Vector3());
    }

    /**
     * Fallback when model fails to load – creates a simple box character.
     */
    createFallback() {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), bodyMat);
        body.position.y = 0.8;
        body.castShadow = true;
        group.add(body);
        const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), headMat);
        head.position.y = 1.6 + 0.3;
        head.castShadow = true;
        group.add(head);
        this.scene.add(group);
        this.model = group;
        this.headBone = group;
        this.rightHandBone = group;
        this.upperBodyBones = [group];
        this.lowerBodyBones = [group];
        this.visualScale = 1;
        this.footOffset = 0;
        this.headToEyeOffset = CLIENT_CONFIG.EYE_OFFSET.clone();
        // Camera already exists; we just set its position
        const headPos = this.getHeadWorldPosition();
        this.smoothedCamPos.copy(headPos).add(this.headToEyeOffset);
        this.camera.position.copy(this.smoothedCamPos);
        this.modelLoaded = true;
        if (this.pendingSyncEquip) {
            this.syncEquip();
            this.pendingSyncEquip = false;
        }
        if (this.pendingHoldPose) {
            this.applyHoldPose();
        }
        if (this.gunShouldBeVisible && this.gunModel) {
            this.gunModel.visible = true;
        }
    }

    /**
     * Sets the rotation of the entire model.
     * @param {THREE.Quaternion} quat - New rotation.
     */
    setModelRotation(quat) {
        if (this.model) this.model.quaternion.copy(quat);
    }

    /**
     * Sets the visual scale of the model (used when held).
     * @param {number} scaleMultiplier - Scale factor.
     */
    setModelScale(scaleMultiplier) {
        if (this.model) {
            this.visualScale = Math.max(scaleMultiplier, 0.01);
            const totalScale = CLIENT_CONFIG.MODEL_SCALE * this.visualScale;
            this.model.scale.set(totalScale, totalScale, totalScale);
        }
    }

    /**
     * Synchronises the equip state with the worker (plays animation, holds pose).
     */
    syncEquip() {
        if (!this.modelLoaded) {
            this.pendingSyncEquip = true;
            return;
        }
        if (!this.isEquipped || this.isHoldingPose || this.isAnimating) return;
        if (this.drawAction) {
            this.isAnimating = false;
            this.drawAction.stop();
            this.drawAction.time = this.drawAction.getClip().duration;
            this.drawAction.play();
            if (this.upperMixer) this.upperMixer.update(0);
            setTimeout(() => {
                this.drawAction.stop();
                this.holdPose = new Map();
                this.upperBodyBones.forEach(bone => {
                    this.holdPose.set(bone, {
                        pos: bone.position.clone(),
                        quat: bone.quaternion.clone(),
                        scale: bone.scale.clone(),
                    });
                });
                this.isHoldingPose = true;
                this.gunShouldBeVisible = true;
                if (this.gunModel) this.gunModel.visible = true;
                // Notify worker that we are now in hold pose
                if (GameState.worker && GameState.playerId) {
                    GameState.worker.port.postMessage({ type: 'set_hold_pose', inHoldPose: true });
                }
            }, 10);
        }
    }

    /**
     * Instantly applies the equipped hold pose without playing the animation.
     * Used when reconnecting while already equipped.
     */
    applyHoldPose() {
        if (!this.modelLoaded) {
            this.pendingHoldPose = true;
            return;
        }
        this.pendingHoldPose = false;
        if (this.isHoldingPose) return;

        // Stop any current upper body animations
        if (this.currentUpperAnim && this.upperLocomotionActions[this.currentUpperAnim]) {
            this.upperLocomotionActions[this.currentUpperAnim].stop();
        }

        // Set draw action to its end time and apply
        const dur = this.drawAction.getClip().duration;
        this.drawAction.time = dur;
        this.drawAction.play();
        this.upperMixer.update(0);

        // Freeze the upper body bones
        this.holdPose = new Map();
        this.upperBodyBones.forEach(bone => {
            this.holdPose.set(bone, {
                pos: bone.position.clone(),
                quat: bone.quaternion.clone(),
                scale: bone.scale.clone(),
            });
        });
        this.isHoldingPose = true;
        this.isEquipped = true;
        this.isAnimating = false;
        this.currentUpperAnim = null;
        this.drawAction.stop();

        // Ensure gun is visible
        this.gunShouldBeVisible = true;
        if (this.gunModel) this.gunModel.visible = true;
    }

    /**
     * Updates the character: animations, model position, camera.
     * @param {number} deltaTime - Time since last update in seconds.
     */
    update(deltaTime) {
        if (!this.model) return;

        // Update animation mixers
        if (this.lowerMixer) this.lowerMixer.update(deltaTime);
        if (this.upperMixer) {
            if (this.isAnimating && (this.currentUpperAnim === 'draw' || this.currentUpperAnim === 'unequip')) {
                this.upperMixer.update(deltaTime);
            } else if (!this.isHoldingPose && !this.isAnimating && this.currentUpperAnim) {
                this.upperMixer.update(deltaTime);
            }
        }

        // Apply hold pose if in that state
        if (this.isHoldingPose && this.holdPose) {
            this.upperBodyBones.forEach(bone => {
                const pose = this.holdPose.get(bone);
                if (pose) {
                    bone.position.copy(pose.pos);
                    bone.quaternion.copy(pose.quat);
                    bone.scale.copy(pose.scale);
                }
            });
        }

        // Position model based on foot position from worker state
        if (GameState.localPlayerState) {
            const footPos = new THREE.Vector3().fromArray(GameState.localPlayerState.position);
            const totalScale = CLIENT_CONFIG.MODEL_SCALE * this.visualScale;
            const scaledFootOffset = this.footOffset * totalScale;
            this.model.position.set(footPos.x, footPos.y + scaledFootOffset, footPos.z);

            // Ensure foot touches ground
            const box = new THREE.Box3().setFromObject(this.model);
            const bottom = box.min.y;
            const diff = bottom - footPos.y;
            if (Math.abs(diff) > 0.001) {
                this.model.position.y -= diff;
            }
        }

        // Rotate model based on yaw (unless being held)
        if (!GameState.isBeingHeld) {
            let displayYaw = GameState.rawYaw;
            if (this.isEquipped && this.isHoldingPose) {
                displayYaw += CLIENT_CONFIG.EXTRA_YAW_DEGREES;
            }
            const yawQuat = getYawQuaternion(displayYaw);
            this.model.quaternion.copy(CLIENT_CONFIG.MODEL_ROTATION_OFFSET.clone().multiply(yawQuat));
        }

        // Update camera position (smooth follow)
        const rawHeadPos = this.getHeadWorldPosition();
        const scaledEyeOffset = this.headToEyeOffset.clone().multiplyScalar(this.visualScale);
        const targetCamPos = rawHeadPos.clone().add(scaledEyeOffset);
        this.smoothedCamPos.x = targetCamPos.x;
        this.smoothedCamPos.z = targetCamPos.z;
        this.smoothedCamPos.y += (targetCamPos.y - this.smoothedCamPos.y) * CLIENT_CONFIG.CAMERA_SMOOTH_FACTOR;
        this.camera.position.copy(this.smoothedCamPos);

        // Camera orientation
        if (GameState.isBeingHeld) {
            if (this.headBone) {
                const headQuat = this.headBone.getWorldQuaternion(new THREE.Quaternion());
                const yaw180 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
                const finalQuat = headQuat.clone().multiply(yaw180);
                this.camera.quaternion.copy(finalQuat);
            }
        } else {
            this.camera.quaternion.setFromEuler(new THREE.Euler(GameState.pitch, GameState.rawYaw, 0, 'YXZ'));
        }

        // Animation selection based on movement
        if (GameState.localPlayerState && !GameState.isBeingHeld) {
            const vel = GameState.localPlayerState.velocity || [0, 0, 0];
            const speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
            const onGround = GameState.localPlayerState.onGround;
            const isRising = vel[1] > 0.5;

            if (speed > CLIENT_CONFIG.MOVING_SPEED_THRESHOLD) this.movingTimer = CLIENT_CONFIG.MOVING_TIMEOUT;
            else if (this.movingTimer > 0) this.movingTimer -= deltaTime;

            const moving = this.movingTimer > 0;

            let targetLower = null;
            if (!onGround) {
                if (isRising) targetLower = 'jump';
                else targetLower = 'idle';
            } else if (moving) {
                targetLower = 'walk';
            } else {
                targetLower = 'idle';
            }

            if (targetLower && this.lowerActions[targetLower] && this.currentLowerAnim !== targetLower) {
                if (this.currentLowerAnim && this.lowerActions[this.currentLowerAnim]) {
                    this.lowerActions[this.currentLowerAnim].fadeOut(0.2);
                }
                this.lowerActions[targetLower].reset().fadeIn(0.2).play();
                this.currentLowerAnim = targetLower;
            }

            // Upper body locomotion when not equipped
            if (!this.isEquipped && !this.isAnimating && !this.isHoldingPose) {
                const targetUpper = targetLower;
                if (targetUpper && this.upperLocomotionActions[targetUpper] && this.currentUpperAnim !== targetUpper) {
                    if (this.currentUpperAnim && this.upperLocomotionActions[this.currentUpperAnim]) {
                        this.upperLocomotionActions[this.currentUpperAnim].fadeOut(0.2);
                    }
                    this.upperLocomotionActions[targetUpper].reset().fadeIn(0.2).play();
                    this.currentUpperAnim = targetUpper;
                }
            }
        }
    }

    /**
     * Equips the portal gun (plays animation and enters hold pose).
     */
    equip() {
        if (this.isEquipped || this.isAnimating) return;
        this.isAnimating = true;
        this.isEquipped = true;
        this.isHoldingPose = false;
        this.gunShouldBeVisible = true;
        if (this.gunModel) this.gunModel.visible = true;

        if (this.drawAction) {
            if (this.currentUpperAnim && this.upperLocomotionActions[this.currentUpperAnim]) {
                this.upperLocomotionActions[this.currentUpperAnim].fadeOut(0.2);
            }
            this.drawAction.reset().play();
            this.currentUpperAnim = 'draw';

            const onFinish = () => {
                if (this.upperMixer) this.upperMixer.update(0);
                this.holdPose = new Map();
                this.upperBodyBones.forEach(bone => {
                    this.holdPose.set(bone, {
                        pos: bone.position.clone(),
                        quat: bone.quaternion.clone(),
                        scale: bone.scale.clone(),
                    });
                });
                this.isHoldingPose = true;
                this.isAnimating = false;
                this.currentUpperAnim = null;
                this.drawAction.stop();

                // Notify worker that we are now in hold pose
                if (GameState.worker && GameState.playerId) {
                    GameState.worker.port.postMessage({ type: 'set_hold_pose', inHoldPose: true });
                }

                this.upperMixer.removeEventListener('finished', onFinish);
            };
            this.upperMixer.addEventListener('finished', onFinish);
        } else {
            this.isAnimating = false;
        }
        if (GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({ type: 'equip', equipped: true });
        }
    }

    /**
     * Unequips the portal gun (plays reverse animation).
     */
    unequip() {
        if (!this.isEquipped || this.isAnimating) return;
        this.isAnimating = true;
        this.isEquipped = false;
        this.isHoldingPose = false;
        this.holdPose = null;
        this.gunShouldBeVisible = false;

        if (this.drawAction) {
            const dur = this.drawAction.getClip().duration;
            this.drawAction.stop();
            this.drawAction.timeScale = -1;
            this.drawAction.time = dur;
            this.drawAction.play();
            this.currentUpperAnim = 'unequip';

            const onFinish = () => {
                this.drawAction.timeScale = 1;
                if (this.gunModel) this.gunModel.visible = false;
                this.isAnimating = false;
                this.currentUpperAnim = null;
                this.drawAction.stop();

                // Notify worker that we have left hold pose
                if (GameState.worker && GameState.playerId) {
                    GameState.worker.port.postMessage({ type: 'set_hold_pose', inHoldPose: false });
                }

                this.upperMixer.removeEventListener('finished', onFinish);
                if (this.currentLowerAnim && this.upperLocomotionActions[this.currentLowerAnim]) {
                    this.upperLocomotionActions[this.currentLowerAnim].reset().fadeIn(0.2).play();
                    this.currentUpperAnim = this.currentLowerAnim;
                }
            };
            this.upperMixer.addEventListener('finished', onFinish);
        } else {
            if (this.gunModel) this.gunModel.visible = false;
            this.isAnimating = false;
        }
        if (GameState.worker && GameState.playerId) {
            GameState.worker.port.postMessage({ type: 'equip', equipped: false });
        }
    }

    /**
     * Toggles equip/unequip state.
     */
    toggleEquip() {
        if (this.isAnimating) return;
        if (this.isEquipped) this.unequip();
        else this.equip();
    }

    /**
     * Handles mouse movement for camera control.
     * @param {number} deltaX - Change in X (pixels).
     * @param {number} deltaY - Change in Y (pixels).
     * @param {number} [sensitivity=0.002] - Mouse sensitivity.
     */
    handleMouseMove(deltaX, deltaY, sensitivity = 0.002) {
        GameState.rawYaw -= deltaX * sensitivity;
        GameState.pitch -= deltaY * sensitivity;
        GameState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, GameState.pitch));
    }

    /**
     * Locks the pointer (enters first‑person mode).
     */
    lock() {
        document.body.requestPointerLock();
    }
}