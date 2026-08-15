import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Peer } from "peerjs";

const SETTINGS = {
    playerSpeed: 16.0,
    acceleration: 120.0,
    deceleration: 100.0,
    gravity: 50.0,
    jumpPower: 16.0,
    playerRadius: 0.5,
    playerHeight: 3.0,
    cameraDistance: 10.0,
    cameraMinDistance: 4.0,
    cameraMaxDistance: 18.0,
    mouseSensitivity: 0.0025,
    cameraMinPitch: -0.7,
    cameraMaxPitch: 1.2,
    bubbleTime: 7000,
    maxChatMessages: 12,
    maxBubbles: 3,
    studsPerUnit: 1.0, // меньше dens = меньше оптическая иллюзия
    netHz: 15
};

const gameData = JSON.parse(localStorage.getItem("ternix_current_game") || "null");
if (!gameData) {
    alert("No game selected");
    window.location.href = "game.html";
}

function getUsername() {
    return localStorage.getItem("ternix_user") ||
           localStorage.getItem("ternix_registered_user") ||
           localStorage.getItem("ternix_creators_user") || "Player";
}

/* ===== Active players counter ===== */
function setActivePlayers(n) {
    try {
        const all = JSON.parse(localStorage.getItem("ternix_published_games") || "[]");
        const idx = all.findIndex(g => g.id === gameData.id);
        if (idx >= 0) {
            all[idx].activePlayers = n;
            localStorage.setItem("ternix_published_games", JSON.stringify(all));
        }
    } catch (e) {}
}

document.getElementById("game-exit").addEventListener("click", () => {
    cleanupNet();
    setActivePlayers(0);
    window.location.href = "game.html";
});

/* ===== THREE setup + fullscreen ===== */
const gameContainer = document.getElementById("game-container");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 45, 100);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
gameContainer.appendChild(renderer.domElement);

function forceLayout() {
    document.documentElement.style.cssText = "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";
    document.body.style.cssText = "margin:0;padding:0;width:100%;height:100%;overflow:hidden;";
    gameContainer.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;";
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
}
forceLayout();

function tryFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
    }
}

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(40, 80, 30);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffffff, 0x657080, 1.2));

/* ===== Materials ===== */
const textureLoader = new THREE.TextureLoader();
let blockTexture = null;
const materialCache = new Map();
const blocks = [];
const blockMeshes = [];
let mapBuilt = false;

function getSolidMaterial(color) {
    const key = "solid_" + color;
    if (materialCache.has(key)) return materialCache.get(key);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    materialCache.set(key, mat);
    return mat;
}

function getShaderMaterial(color, width, depth) {
    if (!blockTexture || !blockTexture.image) return getSolidMaterial(color);
    const repeatX = Math.max(1, width * SETTINGS.studsPerUnit);
    const repeatY = Math.max(1, depth * SETTINGS.studsPerUnit);
    const key = "sh_" + color + "_" + repeatX + "x" + repeatY;
    if (materialCache.has(key)) return materialCache.get(key);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: blockTexture },
            color: { value: new THREE.Color(color) },
            darkFactor: { value: 0.42 },
            repeat: { value: new THREE.Vector2(repeatX, repeatY) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D map;
            uniform vec3 color;
            uniform float darkFactor;
            uniform vec2 repeat;
            varying vec2 vUv;
            void main() {
                vec2 uv = fract(vUv * repeat);
                float mask = texture2D(map, uv).r;
                vec3 finalColor = mix(color * darkFactor, color, mask);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
    });
    materialCache.set(key, mat);
    return mat;
}

function createBlock(opts = {}) {
    const { x = 0, y = 1, z = 0, width = 2, height = 2, depth = 2, color = 0x4A9BD0, useTexture = true } = opts;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const wantTex = useTexture !== false;
    const material = wantTex ? getShaderMaterial(color, width, depth) : getSolidMaterial(color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = true;
    mesh.userData = { width, height, depth, color, useTexture: wantTex };
    scene.add(mesh);
    blockMeshes.push(mesh);
    blocks.push({
        minX: x - width / 2, maxX: x + width / 2,
        minY: y - height / 2, maxY: y + height / 2,
        minZ: z - depth / 2, maxZ: z + depth / 2
    });
    return mesh;
}

function buildMap() {
    if (mapBuilt) return;
    mapBuilt = true;
    if (gameData.blocks && gameData.blocks.length) {
        for (const b of gameData.blocks) {
            createBlock({
                x: b.x, y: b.y, z: b.z,
                width: b.width, height: b.height, depth: b.depth,
                color: b.color, useTexture: b.useTexture !== false
            });
        }
    } else {
        createBlock({ x: 0, y: -0.5, z: 0, width: 40, height: 1, depth: 40, color: 0x4DAA58 });
    }
}

function upgradeTextures() {
    for (const mesh of blockMeshes) {
        const d = mesh.userData;
        if (!d || d.useTexture === false) continue;
        mesh.material = getShaderMaterial(d.color, d.width, d.depth);
    }
}

textureLoader.load("./Textures/TernixBlockTextures.png", (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    blockTexture = tex;
    if (!mapBuilt) buildMap();
    else upgradeTextures();
}, undefined, () => { blockTexture = null; buildMap(); });
setTimeout(() => { if (!mapBuilt) buildMap(); }, 2000);

/* ===== Local player ===== */
const player = new THREE.Group();
scene.add(player);
const playerPosition = new THREE.Vector3(0, 2, 8);
const velocity = new THREE.Vector3();
let verticalVelocity = 0;
let onGround = false;
let nameSprite = null;

function createNameTag(group, name, y = 3.2) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256; canvas.height = 64;
    ctx.font = "bold 26px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 4;
    ctx.fillStyle = "#fff";
    ctx.strokeText(name, 128, 32);
    ctx.fillText(name, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.2, 0.55, 1);
    sprite.position.set(0, y, 0);
    sprite.renderOrder = 1000;
    group.add(sprite);
    return sprite;
}

function makeBoxAvatar(group, color) {
    const skin = color || 0xc4a000;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.55), new THREE.MeshLambertMaterial({ color: 0x6a6a6a }));
    torso.position.y = 1.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.85, 0.85), new THREE.MeshLambertMaterial({ color: skin }));
    head.position.y = 2.45;
    const la = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), new THREE.MeshLambertMaterial({ color: skin }));
    la.position.set(-0.75, 1.5, 0);
    const ra = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), new THREE.MeshLambertMaterial({ color: skin }));
    ra.position.set(0.75, 1.5, 0);
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), new THREE.MeshLambertMaterial({ color: skin }));
    ll.position.set(-0.3, 0.6, 0);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.2, 0.45), new THREE.MeshLambertMaterial({ color: skin }));
    rl.position.set(0.3, 0.6, 0);
    [torso, head, la, ra, ll, rl].forEach(m => group.add(m));
}

async function loadLocalCharacter() {
    try {
        const gltf = await new Promise((res, rej) => {
            new GLTFLoader().load("./TernixGuy.glb", res, undefined, rej);
        });
        const root = gltf.scene;
        root.traverse(o => {
            if (o.isMesh) {
                o.frustumCulled = true;
                if (o.material) {
                    const mats = Array.isArray(o.material) ? o.material : [o.material];
                    mats.forEach(m => { if (m.map && !m.map.image) { m.map = null; m.needsUpdate = true; } });
                }
            }
        });
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        if (size.y > 0.01) root.scale.setScalar(SETTINGS.playerHeight / size.y);
        const fb = new THREE.Box3().setFromObject(root);
        const c = new THREE.Vector3();
        fb.getCenter(c);
        root.position.x -= c.x;
        root.position.z -= c.z;
        root.position.y -= fb.min.y;
        player.add(root);
    } catch (e) {
        makeBoxAvatar(player, 0xc4a000);
    }
    nameSprite = createNameTag(player, getUsername());
}
loadLocalCharacter();

/* ===== Remote players ===== */
const remotes = new Map(); // peerId -> { group, targetPos, targetRot, user }

const REMOTE_COLORS = [0x4A9BD0, 0xD94B42, 0xD8BD45, 0x7959A8, 0xD77A3A, 0x4DAA58];

function ensureRemote(peerId, user) {
    if (remotes.has(peerId)) {
        const r = remotes.get(peerId);
        if (user && r.user !== user) r.user = user;
        return r;
    }
    const group = new THREE.Group();
    const color = REMOTE_COLORS[remotes.size % REMOTE_COLORS.length];
    makeBoxAvatar(group, color);
    createNameTag(group, user || "Player");
    scene.add(group);
    const entry = {
        group,
        user: user || "Player",
        targetPos: new THREE.Vector3(0, 2, 0),
        targetRot: 0
    };
    remotes.set(peerId, entry);
    updateHud();
    setActivePlayers(1 + remotes.size);
    return entry;
}

function removeRemote(peerId) {
    const r = remotes.get(peerId);
    if (!r) return;
    scene.remove(r.group);
    remotes.delete(peerId);
    updateHud();
    setActivePlayers(1 + remotes.size);
}

function updateRemotes(delta) {
    remotes.forEach((r) => {
        r.group.position.lerp(r.targetPos, Math.min(1, delta * 12));
        let d = r.targetRot - r.group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        r.group.rotation.y += d * Math.min(1, delta * 12);
    });
}

/* ===== Input / physics (same as before) ===== */
const keys = { W: false, A: false, S: false, D: false };
let chatOpen = false;
let spaceHeld = false;

window.addEventListener("keydown", (e) => {
    if (chatOpen) return;
    if (e.code === "KeyW") keys.W = true;
    if (e.code === "KeyA") keys.A = true;
    if (e.code === "KeyS") keys.S = true;
    if (e.code === "KeyD") keys.D = true;
    if (e.code === "Space") {
        e.preventDefault();
        if (!spaceHeld && onGround) {
            verticalVelocity = SETTINGS.jumpPower;
            onGround = false;
            playJumpSound();
        }
        spaceHeld = true;
    }
});
window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") keys.W = false;
    if (e.code === "KeyA") keys.A = false;
    if (e.code === "KeyS") keys.S = false;
    if (e.code === "KeyD") keys.D = false;
    if (e.code === "Space") spaceHeld = false;
});
function clearKeys() {
    keys.W = keys.A = keys.S = keys.D = false;
    spaceHeld = false;
    velocity.x = velocity.z = 0;
}
window.addEventListener("blur", clearKeys);

let jumpSound = null, walkSound = null, walkSoundFailed = false;
try { jumpSound = new Audio("./Sounds/Jump.mp3"); jumpSound.volume = 0.5; } catch (e) {}
try {
    walkSound = new Audio("./Sounds/Walk.mp3");
    walkSound.loop = true; walkSound.volume = 0.18;
    walkSound.addEventListener("error", () => { walkSoundFailed = true; walkSound = null; });
} catch (e) { walkSoundFailed = true; }

function playJumpSound() {
    if (!jumpSound) return;
    jumpSound.currentTime = 0;
    jumpSound.play().catch(() => {});
}
function startWalkSound() {
    if (!walkSound || walkSoundFailed) return;
    if (walkSound.paused) walkSound.play().catch(() => { walkSoundFailed = true; });
}
function stopWalkSound() {
    if (walkSound && !walkSound.paused) { walkSound.pause(); walkSound.currentTime = 0; }
}

let cameraYaw = 0, cameraPitch = 0.25, cameraDistance = SETTINGS.cameraDistance;
let rotatingCamera = false, cameraCurrentYaw = 0, cameraCurrentPitch = 0.25;

renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button === 2) { rotatingCamera = true; e.preventDefault(); }
});
document.addEventListener("mouseup", (e) => { if (e.button === 2) rotatingCamera = false; });
renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("mousemove", (e) => {
    if (!rotatingCamera) return;
    cameraYaw -= e.movementX * SETTINGS.mouseSensitivity;
    cameraPitch -= e.movementY * SETTINGS.mouseSensitivity;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch, SETTINGS.cameraMinPitch, SETTINGS.cameraMaxPitch);
});
renderer.domElement.addEventListener("wheel", (e) => {
    cameraDistance += e.deltaY * 0.01;
    cameraDistance = THREE.MathUtils.clamp(cameraDistance, SETTINGS.cameraMinDistance, SETTINGS.cameraMaxDistance);
    e.preventDefault();
}, { passive: false });

function collision(x, z, y) {
    const r = SETTINGS.playerRadius, bottom = y, top = y + SETTINGS.playerHeight;
    for (const b of blocks) {
        if (top <= b.minY || bottom >= b.maxY) continue;
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
}
function getFloor(x, z) {
    let floor = -5;
    const r = SETTINGS.playerRadius;
    for (const b of blocks) {
        if (x + r < b.minX || x - r > b.maxX) continue;
        if (z + r < b.minZ || z - r > b.maxZ) continue;
        floor = Math.max(floor, b.maxY);
    }
    return floor;
}

const direction = new THREE.Vector3();
function approach(c, t, a) {
    if (c < t) return Math.min(c + a, t);
    if (c > t) return Math.max(c - a, t);
    return t;
}

function updateMovement(delta) {
    direction.set(0, 0, 0);
    if (keys.W) { direction.x -= Math.sin(cameraYaw); direction.z -= Math.cos(cameraYaw); }
    if (keys.S) { direction.x += Math.sin(cameraYaw); direction.z += Math.cos(cameraYaw); }
    if (keys.A) { direction.x -= Math.cos(cameraYaw); direction.z += Math.sin(cameraYaw); }
    if (keys.D) { direction.x += Math.cos(cameraYaw); direction.z -= Math.sin(cameraYaw); }
    const moving = direction.lengthSq() > 0;
    if (moving) direction.normalize();
    const tx = moving ? direction.x * SETTINGS.playerSpeed : 0;
    const tz = moving ? direction.z * SETTINGS.playerSpeed : 0;
    const accel = moving ? SETTINGS.acceleration : SETTINGS.deceleration;
    velocity.x = approach(velocity.x, tx, accel * delta);
    velocity.z = approach(velocity.z, tz, accel * delta);
    const nx = playerPosition.x + velocity.x * delta;
    if (!collision(nx, playerPosition.z, playerPosition.y)) playerPosition.x = nx; else velocity.x = 0;
    const nz = playerPosition.z + velocity.z * delta;
    if (!collision(playerPosition.x, nz, playerPosition.y)) playerPosition.z = nz; else velocity.z = 0;
    if (moving) {
        const tr = Math.atan2(direction.x, direction.z);
        let d = tr - player.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        player.rotation.y += d * Math.min(1, delta * 18);
        if (onGround) startWalkSound();
    } else stopWalkSound();
}

function updatePhysics(delta) {
    verticalVelocity -= SETTINGS.gravity * delta;
    verticalVelocity = Math.max(verticalVelocity, -35);
    playerPosition.y += verticalVelocity * delta;
    const floor = getFloor(playerPosition.x, playerPosition.z);
    if (playerPosition.y <= floor) {
        playerPosition.y = floor;
        verticalVelocity = 0;
        onGround = true;
    } else onGround = false;
}

function updateCamera(delta) {
    const t = 1 - Math.exp(-18 * delta);
    cameraCurrentYaw = THREE.MathUtils.lerp(cameraCurrentYaw, cameraYaw, t);
    cameraCurrentPitch = THREE.MathUtils.lerp(cameraCurrentPitch, cameraPitch, t);
    const target = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.6, playerPosition.z);
    const hd = Math.cos(cameraCurrentPitch) * cameraDistance;
    const vd = Math.sin(cameraCurrentPitch) * cameraDistance;
    camera.position.set(
        target.x + Math.sin(cameraCurrentYaw) * hd,
        target.y + vd,
        target.z + Math.cos(cameraCurrentYaw) * hd
    );
    camera.lookAt(target);
}

/* ===== Chat ===== */
const chatBar = document.getElementById("chat-bar");
const chatInput = document.getElementById("chat-input");
const chatPlaceholder = document.getElementById("chat-placeholder");
const chatMessages = document.getElementById("chat-messages");

function openChat() {
    if (chatOpen) return;
    chatOpen = true; clearKeys();
    chatBar.classList.add("active");
    chatPlaceholder.style.display = "none";
    chatInput.style.display = "block";
    chatInput.value = "";
    chatInput.focus();
}
function closeChat() {
    chatOpen = false;
    chatBar.classList.remove("active");
    chatInput.style.display = "none";
    chatPlaceholder.style.display = "block";
    chatInput.blur(); clearKeys();
}
chatBar.addEventListener("click", openChat);
window.addEventListener("keydown", (e) => {
    if (e.key === "/" && !chatOpen) { e.preventDefault(); openChat(); }
});
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (msg) sendChat(msg);
        closeChat();
    }
    if (e.key === "Escape") { e.preventDefault(); closeChat(); }
});

function addChatHistory(text) {
    const el = document.createElement("div");
    el.className = "chat-history-message";
    el.textContent = text;
    chatMessages.appendChild(el);
    while (chatMessages.children.length > SETTINGS.maxChatMessages) {
        chatMessages.firstElementChild.remove();
    }
}

function sendChat(message) {
    const user = myName;
    addChatHistory(user + ": " + message);
    createBubble(player, message);
    netSend({ t: "chat", user, text: message });
}

/* bubbles local only for self; remote chat shows history + bubble on remote */
const activeBubbles = new Map(); // group -> entries[]

function createBubble(parentGroup, message) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = 26;
    ctx.font = font + "px Arial";
    const padding = 8, maxWidth = 360;
    const words = message.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxWidth) { if (line) lines.push(line); line = w; }
        else line = test;
    }
    if (line) lines.push(line);
    const lineHeight = 30;
    let width = 0;
    for (const l of lines) width = Math.max(width, ctx.measureText(l).width);
    width += padding * 2;
    const height = lines.length * lineHeight + padding * 2;
    const tailH = 12;
    canvas.width = width + 6;
    canvas.height = height + tailH + 4;
    ctx.font = font + "px Arial";
    roundRect(ctx, 3, 3, canvas.width - 6, height, 8);
    ctx.fillStyle = "#F2F2F2"; ctx.fill();
    ctx.strokeStyle = "rgba(30,30,30,0.7)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const startY = 3 + height / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, startY + i * lineHeight));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const scale = 0.009;
    const worldH = canvas.height * scale;
    sprite.scale.set(canvas.width * scale, worldH, 1);
    sprite.position.set(0, 3.6, 0);
    sprite.renderOrder = 999;
    parentGroup.add(sprite);
    setTimeout(() => {
        if (sprite.parent) sprite.parent.remove(sprite);
        texture.dispose(); mat.dispose();
    }, SETTINGS.bubbleTime);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/* ===== MULTIPLAYER (PeerJS) ===== */
let peer = null;
let isHost = false;
const connections = new Map(); // peerId -> DataConnection
let myPeerId = null;
let myName = getUsername();
let roomCode = null;
let netReady = false;
let lastNetSend = 0;

const mpOverlay = document.getElementById("mp-overlay");
const mpStatus = document.getElementById("mp-status");
const mpRoomCodeEl = document.getElementById("mp-room-code");
const mpHud = document.getElementById("mp-hud");

function updateHud() {
    if (!netReady) {
        mpHud.textContent = "Solo";
        return;
    }
    const n = 1 + remotes.size;
    mpHud.textContent = (isHost ? "Host" : "Client") + " · Room " + (roomCode || "?") + " · Players: " + n;
}

function setStatus(t) { mpStatus.textContent = t; }

function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

function netSend(obj, exceptId = null) {
    const data = JSON.stringify(obj);
    if (isHost) {
        connections.forEach((conn, id) => {
            if (id === exceptId) return;
            if (conn.open) conn.send(data);
        });
    } else {
        connections.forEach((conn) => {
            if (conn.open) conn.send(data);
        });
    }
}

function handleNetMessage(fromId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.t) return;

    if (msg.t === "hello") {
        ensureRemote(fromId, msg.user);
        if (isHost) {
            // tell new client about others
            remotes.forEach((r, id) => {
                if (id === fromId) return;
                const conn = connections.get(fromId);
                if (conn && conn.open) {
                    conn.send(JSON.stringify({
                        t: "state", id, user: r.user,
                        x: r.targetPos.x, y: r.targetPos.y, z: r.targetPos.z, ry: r.targetRot
                    }));
                }
            });
            // send host state
            const conn = connections.get(fromId);
            if (conn && conn.open) {
                conn.send(JSON.stringify({
                    t: "state", id: myPeerId, user: myName,
                    x: playerPosition.x, y: playerPosition.y, z: playerPosition.z, ry: player.rotation.y
                }));
            }
        }
    } else if (msg.t === "state") {
        const id = msg.id || fromId;
        if (id === myPeerId) return;
        const r = ensureRemote(id, msg.user);
        r.targetPos.set(msg.x, msg.y, msg.z);
        r.targetRot = msg.ry || 0;
        if (isHost && msg.id === undefined) {
            // relay client state to others with id
            netSend({ t: "state", id: fromId, user: msg.user, x: msg.x, y: msg.y, z: msg.z, ry: msg.ry }, fromId);
        }
    } else if (msg.t === "chat") {
        addChatHistory(msg.user + ": " + msg.text);
        const r = remotes.get(fromId) || (msg.id ? remotes.get(msg.id) : null);
        if (r) createBubble(r.group, msg.text);
        if (isHost) netSend({ t: "chat", user: msg.user, text: msg.text, id: fromId }, fromId);
    } else if (msg.t === "bye") {
        removeRemote(fromId);
        if (isHost) netSend({ t: "bye", id: fromId }, fromId);
    }
}

function setupConnection(conn) {
    const id = conn.peer;
    connections.set(id, conn);
    conn.on("data", (raw) => handleNetMessage(id, raw));
    conn.on("close", () => {
        connections.delete(id);
        removeRemote(id);
        if (isHost) netSend({ t: "bye", id });
    });
    conn.on("open", () => {
        conn.send(JSON.stringify({ t: "hello", user: myName }));
        setStatus("Connected: " + (1 + connections.size) + " link(s)");
        netReady = true;
        updateHud();
        setActivePlayers(1 + remotes.size);
    });
}

function startAsHost() {
    const code = randomCode();
    roomCode = code;
    isHost = true;
    setStatus("Connecting to PeerJS...");
    peer = new Peer("ternix-" + code, { debug: 1 });
    peer.on("open", (id) => {
        myPeerId = id;
        netReady = true;
        mpRoomCodeEl.style.display = "block";
        mpRoomCodeEl.textContent = code;
        setStatus("Room created! Share code: " + code);
        updateHud();
        setActivePlayers(1);
        mpOverlay.style.display = "none";
        tryFullscreen();
    });
    peer.on("connection", (conn) => {
        setupConnection(conn);
    });
    peer.on("error", (err) => {
        setStatus("Error: " + err.type + " — try another code / Solo");
        console.warn(err);
    });
}

function startAsClient(code) {
    code = code.trim().toUpperCase();
    if (code.length < 4) {
        setStatus("Enter a valid room code");
        return;
    }
    roomCode = code;
    isHost = false;
    setStatus("Joining " + code + "...");
    peer = new Peer({ debug: 1 });
    peer.on("open", (id) => {
        myPeerId = id;
        const conn = peer.connect("ternix-" + code, { reliable: true });
        setupConnection(conn);
        conn.on("open", () => {
            setStatus("Joined room " + code);
            mpOverlay.style.display = "none";
            netReady = true;
            updateHud();
            tryFullscreen();
        });
    });
    peer.on("error", (err) => {
        setStatus("Error: " + err.type + " — check code / host online");
        console.warn(err);
    });
}

function startSolo() {
    netReady = false;
    mpOverlay.style.display = "none";
    setActivePlayers(1);
    updateHud();
    tryFullscreen();
}

function cleanupNet() {
    try {
        netSend({ t: "bye", user: myName });
        connections.forEach(c => c.close());
        if (peer) peer.destroy();
    } catch (e) {}
    setActivePlayers(0);
}

document.getElementById("mp-host").onclick = () => {
    const n = document.getElementById("mp-name").value.trim();
    if (n) myName = n;
    startAsHost();
};
document.getElementById("mp-join").onclick = () => {
    const n = document.getElementById("mp-name").value.trim();
    if (n) myName = n;
    startAsClient(document.getElementById("mp-join-code").value);
};
document.getElementById("mp-solo").onclick = () => startSolo();

window.addEventListener("beforeunload", cleanupNet);

function netTick(time) {
    if (!netReady || connections.size === 0) return;
    if (time - lastNetSend < 1000 / SETTINGS.netHz) return;
    lastNetSend = time;
    netSend({
        t: "state",
        user: myName,
        x: playerPosition.x,
        y: playerPosition.y,
        z: playerPosition.z,
        ry: player.rotation.y
    });
}

/* ===== Loop ===== */
const clock = new THREE.Clock();
function gameLoop(time) {
    requestAnimationFrame(gameLoop);
    const delta = Math.min(clock.getDelta(), 0.05);
    updateMovement(delta);
    updatePhysics(delta);
    player.position.copy(playerPosition);
    updateCamera(delta);
    updateRemotes(delta);
    netTick(time || performance.now());
    renderer.render(scene, camera);
}
gameLoop();

window.addEventListener("resize", () => {
    forceLayout();
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(1);
});