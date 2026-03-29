/*
Author: Daniel Yu
Date: March 15, 2026
Description: Manages remote players: creates and updates avatars for other players in the scene.
             It loads the player GLTF model and portal gun model, creates animation mixers for
             upper and lower body, and handles equip/unequip animations. The class also processes
             remote player state updates from the worker and synchronises position, rotation,
             scale, and animation state. It includes a fallback for when the model fails to load.
*/

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import { CLIENT_CONFIG } from '../clientConfig.js';
import { GameState } from '../clientState.js';
import { getYawQuaternion } from '../clientUtils.js';

export const RemotePlayerManager = {
    remotePlayers: GameState.remotePlayers,
    playerModel: null,
    gunModel: null,
    playerModelLoaded: false,
    gunModelLoaded: false,
    loader: new GLTFLoader(),
    pendingAvatarCreations: [],          // Queue for avatars waiting for model load
    pendingEquipStates: new Map(),       // Map playerId -> { equipped, inHoldPose }
    remoteLocomotionTracks: null,       // Cached animation tracks for remote players

    /**
     * Normalises a bone name by removing common prefixes like "mixamorig:" and trailing numbers.
     * This allows matching bone names across different rigs.
     * @param {string} name - Original bone name.
     * @returns {string} Normalised name.
     */
    normalizeBoneName(name) {
        let normalized = name.replace(/^(mixamorig:|Armature_|Armature\.)/i, '');
        normalized = normalized.replace(/\d+$/, '');
        return normalized;
    },

    /**
     * Filters an animation clip to keep only tracks for allowed bone names.
     * Used to separate upper and lower body animations.
     * @param {THREE.AnimationClip} clip - Original clip.
     * @param {string[]} allowedBoneNames - Bone names to keep.
     * @returns {THREE.AnimationClip|null} Filtered clip.
     */
    filterAnimationClip(clip, allowedBoneNames) {
        const filteredTracks = clip.tracks.filter(track => {
            const dotIndex = track.name.lastIndexOf('.');
            if (dotIndex === -1) return false;
            const boneName = track.name.substring(0, dotIndex);
            const normalizedBone = this.normalizeBoneName(boneName);
            return allowedBoneNames.includes(normalizedBone);
        });
        if (filteredTracks.length === 0) return null;
        return new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
    },

    /**
     * Initialises the remote player manager by loading models.
     */
    init() {
        this.loadPlayerModel();
        this.loadGunModel();
    },

    /**
     * Loads the player GLTF model for remote avatars.
     */
    loadPlayerModel() {
        this.loader.load(
            'assets/models/thePlayer.glb',
            (gltf) => {
                this.playerModel = gltf;
                if (gltf.animations) this.prepareRemoteAnimationTracks();
                this.playerModelLoaded = true;
                this.processPendingCreations();
                if (this.gunModelLoaded) this.attachGunToRemotePlayers();
            },
            undefined,
            (error) => {
                console.error('Failed to load remote player model:', error);
                this.playerModelLoaded = true;
                this.processPendingCreations();  // Fallback: use capsules
            }
        );
    },

    /**
     * Loads the portal gun model for remote players.
     */
    loadGunModel() {
        this.loader.load(
            'assets/models/portalGun.glb',
            (gltf) => {
                this.gunModel = gltf;
                this.gunModelLoaded = true;
                if (this.playerModelLoaded) this.attachGunToRemotePlayers();
            },
            undefined,
            (error) => console.error('Failed to load gun model for remote players:', error)
        );
    },

    /**
     * Processes any pending avatar creations after the model loads.
     */
    processPendingCreations() {
        this.pendingAvatarCreations.forEach(({ playerId, state }) => this.createRemoteAvatar(playerId, state));
        this.pendingAvatarCreations = [];
        this.pendingEquipStates.forEach(({ equipped, inHoldPose }, playerId) => {
            this.setRemoteEquipState(playerId, equipped, false, inHoldPose);
        });
        this.pendingEquipStates.clear();
    },

    /**
     * Prepares animation track maps for remote players (for future use).
     */
    prepareRemoteAnimationTracks() {
        if (!this.playerModel?.animations) return;
        const anims = this.playerModel.animations;
        const findAnim = (keywords) => anims.find(a => keywords.some(k => a.name.toLowerCase().includes(k)));
        const walkClip = findAnim(['walk', 'crouch']);
        const jumpClip = findAnim(['jump']);
        const idleClip = findAnim(['idle']);

        this.remoteLocomotionTracks = {};
        const processClip = (clip, name) => {
            if (!clip) return;
            const boneTracks = new Map();
            for (const track of clip.tracks) {
                const dotIndex = track.name.lastIndexOf('.');
                if (dotIndex === -1) continue;
                const boneName = track.name.substring(0, dotIndex);
                const property = track.name.substring(dotIndex + 1);
                const normalized = this.normalizeBoneName(boneName);
                if (!boneTracks.has(normalized)) boneTracks.set(normalized, {});
                const data = boneTracks.get(normalized);
                if (property === 'position') data.pos = track;
                else if (property === 'quaternion') data.quat = track;
                else if (property === 'scale') data.scale = track;
            }
            this.remoteLocomotionTracks[name] = boneTracks;
        };
        processClip(walkClip, 'walk');
        processClip(jumpClip, 'jump');
        processClip(idleClip, 'idle');
    },

    /**
     * Updates lower body animation mixer for a remote player (unused, kept for future).
     * @param {Object} player - Remote player object.
     * @param {number} deltaTime - Time since last update.
     */
    applyLocomotionToLowerBody(player, deltaTime) {
        if (!player.lowerMixer) return;
        player.lowerMixer.update(deltaTime);
    },

    /**
     * Attaches the gun model to all existing remote players.
     */
    attachGunToRemotePlayers() {
        if (!this.gunModel) return;
        for (const [_, player] of this.remotePlayers) {
            if (!player.gun && player.avatar) {
                let rightHand = null;
                player.avatar.traverse(child => {
                    if (child.isBone && child.name.toLowerCase().includes('right') && child.name.toLowerCase().includes('hand'))
                        rightHand = child;
                });
                if (!rightHand) rightHand = player.avatar;
                const gun = SkeletonUtils.clone(this.gunModel.scene);
                gun.scale.set(CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE);
                gun.visible = player.isEquipped;
                rightHand.add(gun);
                gun.position.copy(CLIENT_CONFIG.GUN_POSITION);
                gun.rotation.set(CLIENT_CONFIG.GUN_ROTATION.x, CLIENT_CONFIG.GUN_ROTATION.y, CLIENT_CONFIG.GUN_ROTATION.z);
                gun.traverse(child => { if (child.isMesh) child.userData.remoteAvatar = true; });
                player.gun = gun;
            }
        }
    },

    /**
     * Creates a remote avatar for a player. Uses a full GLTF model if available,
     * otherwise falls back to an invisible cylinder.
     * @param {string} playerId - Player ID.
     * @param {Object} state - Player state from worker.
     * @returns {THREE.Object3D|null} The avatar model or null if fallback.
     */
    createRemoteAvatar(playerId, state) {
        if (!this.playerModelLoaded) {
            this.pendingAvatarCreations.push({ playerId, state });
            return null;
        }

        if (!this.playerModel) {
            // Fallback: invisible cylinder (collision representation)
            const pos = (state.held && state.heldPos) ? new THREE.Vector3().fromArray(state.heldPos) : new THREE.Vector3().fromArray(state.position);
            const cylinder = new THREE.Mesh(
                new THREE.CylinderGeometry(CLIENT_CONFIG.PLAYER_RADIUS, CLIENT_CONFIG.PLAYER_RADIUS, CLIENT_CONFIG.PLAYER_HEIGHT, 8),
                new THREE.MeshPhongMaterial({ transparent: true, opacity: 0 })
            );
            cylinder.position.set(pos.x, pos.y + CLIENT_CONFIG.PLAYER_HEIGHT / 2, pos.z);
            cylinder.userData.remoteAvatarCapsule = true;
            GameState.scene.add(cylinder);
            const player = {
                avatar: null, capsule: cylinder, offsetY: 0,
                lowerMixer: null, upperMixer: null,
                lowerActions: {}, upperLocomotionActions: {}, drawAction: null,
                isEquipped: state.isEquipped, isHoldingPose: false, holdPose: null,
                upperBodyBones: [], lowerBodyBones: [],
                currentLowerAnim: null, currentUpperAnim: null,
                lastPos: pos.clone(), lastTime: performance.now(),
                lastSpeed: 0, lastOnGround: true, movingTimer: 0,
                held: state.held || false, scale: state.scale || 1, gun: null, isAnimating: false,
            };
            this.remotePlayers.set(playerId, player);
            return cylinder;
        }

        // Full avatar with model
        this.removeAvatar(playerId);

        const pos = (state.held && state.heldPos) ? new THREE.Vector3().fromArray(state.heldPos) : new THREE.Vector3().fromArray(state.position);
        const targetScale = state.scale !== undefined ? Math.max(state.scale, 0.01) : 1;

        const clonedScene = SkeletonUtils.clone(this.playerModel.scene);
        const totalScale = CLIENT_CONFIG.MODEL_SCALE * targetScale;
        clonedScene.scale.set(totalScale, totalScale, totalScale);
        const box = new THREE.Box3().setFromObject(clonedScene);
        const offsetY = -box.min.y;
        clonedScene.position.set(pos.x, pos.y + offsetY, pos.z);
        clonedScene.quaternion.copy(CLIENT_CONFIG.MODEL_ROTATION_OFFSET);
        clonedScene.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.transparent = false);
                    else child.material.transparent = false;
                }
                child.userData.remoteAvatar = true;
            }
        });
        GameState.scene.add(clonedScene);

        let rightHand = null;
        clonedScene.traverse(child => {
            if (child.isBone && child.name.toLowerCase().includes('right') && child.name.toLowerCase().includes('hand'))
                rightHand = child;
        });
        if (!rightHand) rightHand = clonedScene;

        let gun = null;
        if (this.gunModelLoaded && this.gunModel) {
            gun = SkeletonUtils.clone(this.gunModel.scene);
            gun.scale.set(CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE, CLIENT_CONFIG.GUN_SCALE);
            gun.visible = state.isEquipped;
            rightHand.add(gun);
            gun.position.copy(CLIENT_CONFIG.GUN_POSITION);
            gun.rotation.set(CLIENT_CONFIG.GUN_ROTATION.x, CLIENT_CONFIG.GUN_ROTATION.y, CLIENT_CONFIG.GUN_ROTATION.z);
            gun.traverse(child => { if (child.isMesh) child.userData.remoteAvatar = true; });
        }

        const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(CLIENT_CONFIG.PLAYER_RADIUS, CLIENT_CONFIG.PLAYER_RADIUS, CLIENT_CONFIG.PLAYER_HEIGHT, 8),
            new THREE.MeshPhongMaterial({ transparent: true, opacity: 0 })
        );
        cylinder.position.set(pos.x, pos.y + CLIENT_CONFIG.PLAYER_HEIGHT / 2, pos.z);
        cylinder.userData.remoteAvatarCapsule = true;
        GameState.scene.add(cylinder);

        // Separate bones into upper and lower for animation mixing
        const upperBones = [], lowerBones = [];
        clonedScene.traverse(child => {
            if (!child.isBone) return;
            const name = child.name.toLowerCase();
            if (/spine|neck|head|clavicle|arm|hand|shoulder/.test(name)) upperBones.push(child);
            if (/hip|thigh|calf|foot|toe|leg|pelvis/.test(name)) lowerBones.push(child);
        });

        const upperBoneNames = upperBones.map(b => this.normalizeBoneName(b.name));
        const lowerBoneNames = lowerBones.map(b => this.normalizeBoneName(b.name));

        const lowerMixer = new THREE.AnimationMixer(clonedScene);
        const upperMixer = new THREE.AnimationMixer(clonedScene);

        let lowerActions = {};
        let upperLocomotionActions = {};
        let drawAction = null;

        if (this.playerModel.animations) {
            const anims = this.playerModel.animations;
            const walk = anims.find(a => a.name.toLowerCase().includes('walk') || a.name.toLowerCase().includes('crouch'));
            const jump = anims.find(a => a.name.toLowerCase().includes('jump'));
            const idle = anims.find(a => a.name.toLowerCase().includes('idle'));
            const draw = anims.find(a => a.name.toLowerCase().includes('draw') || a.name.toLowerCase().includes('pull') || a.name.toLowerCase().includes('equip'));

            if (walk) {
                const lowerWalk = this.filterAnimationClip(walk, lowerBoneNames);
                if (lowerWalk) lowerActions.walk = lowerMixer.clipAction(lowerWalk).setLoop(THREE.LoopRepeat);
                const upperWalk = this.filterAnimationClip(walk, upperBoneNames);
                if (upperWalk) upperLocomotionActions.walk = upperMixer.clipAction(upperWalk).setLoop(THREE.LoopRepeat);
            }
            if (jump) {
                const lowerJump = this.filterAnimationClip(jump, lowerBoneNames);
                if (lowerJump) lowerActions.jump = lowerMixer.clipAction(lowerJump).setLoop(THREE.LoopRepeat);
                const upperJump = this.filterAnimationClip(jump, upperBoneNames);
                if (upperJump) upperLocomotionActions.jump = upperMixer.clipAction(upperJump).setLoop(THREE.LoopRepeat);
            }
            if (idle) {
                const lowerIdle = this.filterAnimationClip(idle, lowerBoneNames);
                if (lowerIdle) lowerActions.idle = lowerMixer.clipAction(lowerIdle).setLoop(THREE.LoopRepeat);
                const upperIdle = this.filterAnimationClip(idle, upperBoneNames);
                if (upperIdle) upperLocomotionActions.idle = upperMixer.clipAction(upperIdle).setLoop(THREE.LoopRepeat);
            }
            if (draw) {
                const filteredDraw = this.filterAnimationClip(draw, upperBoneNames);
                if (filteredDraw) {
                    drawAction = upperMixer.clipAction(filteredDraw);
                    drawAction.setLoop(THREE.LoopOnce);
                    drawAction.clampWhenFinished = true;
                }
            }
        }

        const player = {
            avatar: clonedScene, capsule: cylinder, offsetY,
            lowerMixer, upperMixer,
            lowerActions, upperLocomotionActions, drawAction,
            isEquipped: state.isEquipped,
            inHoldPose: state.inHoldPose || false,
            isHoldingPose: false,
            holdPose: null,
            upperBodyBones: upperBones, lowerBodyBones: lowerBones,
            currentLowerAnim: null, currentUpperAnim: null,
            lastPos: pos.clone(), lastTime: performance.now(),
            lastSpeed: 0, lastOnGround: true, movingTimer: 0,
            held: state.held || false, scale: targetScale, gun: gun, isAnimating: false,
        };

        // Start idle animations
        if (lowerActions.idle) {
            lowerActions.idle.play();
            player.currentLowerAnim = 'idle';
        }
        if (upperLocomotionActions.idle) {
            upperLocomotionActions.idle.play();
            player.currentUpperAnim = 'idle';
        }

        this.remotePlayers.set(playerId, player);

        // Handle equip state with hold pose
        if (state.isEquipped) {
            if (state.inHoldPose) {
                this.applyRemoteHoldPose(player);
            } else {
                this.setRemoteEquipState(playerId, true, true);
            }
        } else if (this.pendingEquipStates.has(playerId)) {
            const { equipped, inHoldPose } = this.pendingEquipStates.get(playerId);
            this.setRemoteEquipState(playerId, equipped, false, inHoldPose);
            this.pendingEquipStates.delete(playerId);
        }

        return clonedScene;
    },

    /**
     * Instantly applies the equipped hold pose to a remote player (no animation).
     * @param {Object} player - Remote player object.
     */
    applyRemoteHoldPose(player) {
        if (!player.drawAction) return;
        if (player.isHoldingPose) return;

        // Stop any playing upper body animations
        if (player.currentUpperAnim && player.upperLocomotionActions[player.currentUpperAnim]) {
            player.upperLocomotionActions[player.currentUpperAnim].stop();
        }

        const dur = player.drawAction.getClip().duration;
        player.drawAction.time = dur;
        player.drawAction.play();
        player.upperMixer.update(0);

        // Freeze bones
        player.holdPose = new Map();
        player.upperBodyBones.forEach(bone => {
            player.holdPose.set(bone, {
                pos: bone.position.clone(),
                quat: bone.quaternion.clone(),
                scale: bone.scale.clone(),
            });
        });
        player.isHoldingPose = true;
        player.isAnimating = false;
        player.currentUpperAnim = null;
        player.drawAction.stop();

        if (player.gun) player.gun.visible = true;
    },

    /**
     * Updates a remote player's avatar based on state from the worker.
     * @param {string} playerId - Player ID.
     * @param {Object} state - Latest state.
     */
    updateRemoteAvatar(playerId, state) {
        const isHeldByUs = (GameState.heldObjectType === 'player' && GameState.heldPlayerId === playerId);

        let player = this.remotePlayers.get(playerId);
        if (!player) {
            this.createRemoteAvatar(playerId, state);
            player = this.remotePlayers.get(playerId);
            if (!player) return;
        }

        if (!player.avatar && this.playerModelLoaded && this.playerModel) {
            this.removeAvatar(playerId);
            this.createRemoteAvatar(playerId, state);
            player = this.remotePlayers.get(playerId);
            if (!player) return;
        }

        const wasHeld = player.held;
        if (wasHeld && !state.held) {
            player.isHoldingPose = false;
            player.holdPose = null;
        }

        let pos;
        if (state.held && state.heldPos && Array.isArray(state.heldPos) && state.heldPos.length >= 3) {
            pos = new THREE.Vector3().fromArray(state.heldPos);
        } else if (state.position && Array.isArray(state.position) && state.position.length >= 3) {
            pos = new THREE.Vector3().fromArray(state.position);
        } else {
            console.warn(`Remote player ${playerId} has invalid position data, skipping update`);
            return;
        }

        const targetScale = state.scale !== undefined ? Math.max(state.scale, 0.01) : 1;

        // Update position and rotation if not held by us
        if (!isHeldByUs && player.avatar) {
            const scaledOffset = player.offsetY * targetScale;
            player.avatar.position.set(pos.x, pos.y + scaledOffset, pos.z);
            if (state.held && state.heldRot && Array.isArray(state.heldRot) && state.heldRot.length >= 4) {
                player.avatar.quaternion.fromArray(state.heldRot);
            } else if (!state.held) {
                let yaw = state.rotation;
                if (player.isHoldingPose) yaw += CLIENT_CONFIG.EXTRA_YAW_DEGREES;
                player.avatar.quaternion.copy(CLIENT_CONFIG.MODEL_ROTATION_OFFSET.clone().multiply(getYawQuaternion(yaw)));
            }

            // Foot alignment
            const box = new THREE.Box3().setFromObject(player.avatar);
            const bottom = box.min.y;
            const diff = bottom - pos.y;
            if (Math.abs(diff) > 0.001) {
                player.avatar.position.y -= diff;
            }
        }

        // Update capsule
        if (player.capsule) {
            const halfHeight = (CLIENT_CONFIG.PLAYER_HEIGHT / 2) * targetScale;
            player.capsule.position.set(pos.x, pos.y + halfHeight, pos.z);
            player.capsule.scale.set(targetScale, targetScale, targetScale);
            if (player.avatar && !isHeldByUs) {
                player.capsule.quaternion.copy(player.avatar.quaternion);
            }
            player.capsule.visible = true;
        }

        if (player.avatar && !isHeldByUs) {
            const totalScale = CLIENT_CONFIG.MODEL_SCALE * targetScale;
            player.avatar.scale.set(totalScale, totalScale, totalScale);
        }

        player.held = state.held || false;
        player.scale = targetScale;

        // Equip state with hold pose
        const wasEquipped = player.isEquipped;
        const isEquippedNow = state.isEquipped;
        const inHoldPoseNow = state.inHoldPose;

        if (wasEquipped !== isEquippedNow) {
            this.setRemoteEquipState(playerId, isEquippedNow, true, inHoldPoseNow);
        } else if (isEquippedNow && !player.isHoldingPose && inHoldPoseNow) {
            this.applyRemoteHoldPose(player);
        } else if (!isEquippedNow && player.isHoldingPose) {
            // Force exit hold pose if state says not in hold pose
            player.isHoldingPose = false;
            player.holdPose = null;
            if (player.drawAction) player.drawAction.stop();
            // Restart upper locomotion based on current lower anim
            if (player.currentLowerAnim && player.upperLocomotionActions[player.currentLowerAnim]) {
                player.upperLocomotionActions[player.currentLowerAnim].reset().play();
                player.currentUpperAnim = player.currentLowerAnim;
            }
            if (player.gun) player.gun.visible = false;
        } else if (!isEquippedNow && !player.isAnimating && player.gun) {
            player.gun.visible = false;
        }

        player.isEquipped = isEquippedNow;
        player.inHoldPose = inHoldPoseNow;

        // Determine target lower body animation
        let targetLowerAnim = null;
        if (!state.held) {
            const vel = state.velocity || [0, 0, 0];
            const speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
            const now = performance.now();
            const dt = Math.min(0.1, (now - player.lastTime) / 1000);
            player.lastTime = now;

            if (speed > CLIENT_CONFIG.MOVING_SPEED_THRESHOLD) player.movingTimer = CLIENT_CONFIG.MOVING_TIMEOUT;
            else if (player.movingTimer > 0) player.movingTimer -= dt;

            const moving = player.movingTimer > 0;
            const onGround = state.onGround;
            const isRising = vel[1] > 0.5;

            if (!onGround) {
                if (isRising) targetLowerAnim = 'jump';
                else targetLowerAnim = 'idle';
            } else if (moving) {
                targetLowerAnim = 'walk';
            } else {
                targetLowerAnim = 'idle';
            }
        } else {
            targetLowerAnim = 'idle';
        }

        // Update lower body animation
        if (targetLowerAnim && player.lowerActions[targetLowerAnim] && player.currentLowerAnim !== targetLowerAnim) {
            if (player.currentLowerAnim && player.lowerActions[player.currentLowerAnim]) {
                player.lowerActions[player.currentLowerAnim].fadeOut(0.2);
            }
            player.lowerActions[targetLowerAnim].reset().fadeIn(0.2).play();
            player.currentLowerAnim = targetLowerAnim;
        }

        // Upper body locomotion if not equipped, not animating, and not in hold pose
        if (!player.isEquipped && !player.isAnimating && !player.isHoldingPose) {
            const targetUpperAnim = targetLowerAnim;
            if (targetUpperAnim && player.upperLocomotionActions[targetUpperAnim] && player.currentUpperAnim !== targetUpperAnim) {
                if (player.currentUpperAnim && player.upperLocomotionActions[player.currentUpperAnim]) {
                    player.upperLocomotionActions[player.currentUpperAnim].fadeOut(0.2);
                }
                player.upperLocomotionActions[targetUpperAnim].reset().fadeIn(0.2).play();
                player.currentUpperAnim = targetUpperAnim;
            }
        }

        player.lastPos.copy(pos);
    },

    /**
     * Sets the equip state for a remote player (with optional animation).
     * @param {string} playerId - Player ID.
     * @param {boolean} equipped - New equip state.
     * @param {boolean} playAnimation - Whether to play the equip/unequip animation.
     * @param {boolean} inHoldPose - Whether the player should already be in the hold pose.
     */
    setRemoteEquipState(playerId, equipped, playAnimation = true, inHoldPose = false) {
        const player = this.remotePlayers.get(playerId);
        if (!player) {
            this.pendingEquipStates.set(playerId, { equipped, inHoldPose });
            return;
        }
        if (player.isEquipped === equipped && player.inHoldPose === inHoldPose) return;
        player.isEquipped = equipped;
        player.inHoldPose = inHoldPose;

        const drawAction = player.drawAction;
        const upperLocomotion = player.upperLocomotionActions;

        if (!drawAction) {
            if (player.gun) player.gun.visible = equipped;
            return;
        }

        if (equipped) {
            if (playAnimation && !inHoldPose) {
                if (player.currentUpperAnim && upperLocomotion[player.currentUpperAnim]) {
                    upperLocomotion[player.currentUpperAnim].fadeOut(0.2);
                }
                player.isAnimating = true;
                drawAction.reset().play();
                player.currentUpperAnim = 'draw';

                const onFinish = () => {
                    if (player.upperMixer) player.upperMixer.update(0);
                    player.holdPose = new Map();
                    player.upperBodyBones.forEach(bone => {
                        player.holdPose.set(bone, {
                            pos: bone.position.clone(),
                            quat: bone.quaternion.clone(),
                            scale: bone.scale.clone(),
                        });
                    });
                    player.isHoldingPose = true;
                    player.isAnimating = false;
                    player.currentUpperAnim = null;
                    drawAction.stop();
                    player.upperMixer.removeEventListener('finished', onFinish);
                };
                player.upperMixer.addEventListener('finished', onFinish);
                if (player.gun) player.gun.visible = true;
            } else {
                // Direct hold pose (no animation)
                this.applyRemoteHoldPose(player);
            }
        } else {
            if (playAnimation) {
                player.isAnimating = true;
                const dur = drawAction.getClip().duration;
                drawAction.stop();
                drawAction.timeScale = -1;
                drawAction.time = dur;
                drawAction.play();
                player.currentUpperAnim = 'unequip';
                player.isHoldingPose = false;
                player.holdPose = null;

                const onFinish = () => {
                    drawAction.timeScale = 1;
                    if (player.gun) player.gun.visible = false;
                    player.isAnimating = false;
                    player.currentUpperAnim = null;
                    drawAction.stop();
                    player.upperMixer.removeEventListener('finished', onFinish);
                    if (player.currentLowerAnim && upperLocomotion[player.currentLowerAnim]) {
                        upperLocomotion[player.currentLowerAnim].reset().fadeIn(0.2).play();
                        player.currentUpperAnim = player.currentLowerAnim;
                    }
                };
                player.upperMixer.addEventListener('finished', onFinish);
            } else {
                player.isAnimating = false;
                player.isHoldingPose = false;
                player.holdPose = null;
                if (player.gun) player.gun.visible = false;
                drawAction.stop();
                player.currentUpperAnim = null;
                if (player.currentLowerAnim && upperLocomotion[player.currentLowerAnim]) {
                    upperLocomotion[player.currentLowerAnim].reset().play();
                    player.currentUpperAnim = player.currentLowerAnim;
                }
            }
        }
    },

    /**
     * Updates remote player animations (called every frame).
     * @param {number} deltaTime - Time since last update.
     */
    updateRemoteAnimations(deltaTime) {
        for (const player of this.remotePlayers.values()) {
            if (player.lowerMixer) player.lowerMixer.update(deltaTime);
            if (player.upperMixer) {
                if (player.isAnimating && (player.currentUpperAnim === 'draw' || player.currentUpperAnim === 'unequip')) {
                    player.upperMixer.update(deltaTime);
                } else if (!player.isHoldingPose && !player.isAnimating && player.currentUpperAnim) {
                    player.upperMixer.update(deltaTime);
                }
            }
            if (player.isHoldingPose && player.holdPose) {
                player.upperBodyBones.forEach(bone => {
                    const pose = player.holdPose.get(bone);
                    if (pose) {
                        bone.position.copy(pose.pos);
                        bone.quaternion.copy(pose.quat);
                        bone.scale.copy(pose.scale);
                    }
                });
            }
        }
    },

    /**
     * Removes a remote avatar from the scene.
     * @param {string} playerId - Player ID.
     */
    removeAvatar(playerId) {
        const player = this.remotePlayers.get(playerId);
        if (player) {
            if (player.avatar) GameState.scene.remove(player.avatar);
            GameState.scene.remove(player.capsule);
            if (player.lowerMixer) player.lowerMixer.stopAllAction();
            if (player.upperMixer) player.upperMixer.stopAllAction();
            this.remotePlayers.delete(playerId);
        }
    },
};