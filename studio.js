import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SETTINGS = {
    flySpeed: 16,
    flyBoost: 2.5,
    playerSpeed: 16.0,
    acceleration: 120.0,
    deceleration: 100.0,
    gravity: 50.0,
    jumpPower: 16.0,
    playerRadius: 0.45,
    playerHeight: 3.0,
    cameraDistance: 10.0,
    mouseSensitivity: 0.0032,
    cameraMinPitch: -1.2,
    cameraMaxPitch: 1.35,
    studsPerUnit: 2.5,
    blockSize: 2
};

const gameContainer = document.getElementById("game-container");
const statusText = document.getElementById("status-text");
const placeTitle = document.getElementById("place-title");
const blocksHeader = document.getElementById("blocks-header");
const propertiesContent = document.getElementById("properties-content");
const btnPlay = document.getElementById("btn-play");
const btnExitPlay = document.getElementById("btn-exit-play");
const saveModal = document.getElementById("save-modal");
const publishModal = document.getElementById("publish-modal");
const saveNameInput = document.getElementById("save-name");
const publishNameInput = document.getElementById("publish-name");
const publishCover = document.getElementById("publish-cover");
const coverPreview = document.getElementById("cover-preview");

let currentTool = "select";
let isPlayMode = false;
let placeName = "Untitled Place";
let selectedBlock = null;
const placedBlocks = [];

const currentUser = localStorage.getItem("ternix_creators_user");
if (!currentUser || localStorage.getItem("ternix_creators_logged") !== "true") {
    window.location.href = "index.html";
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.Fog(0x87CEEB, 50, 140);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);

let camYaw = Math.PI;
let camPitch = -0.35;
camera.position.set(0, 14, 22);
(function initLook() {
    const forward = new THREE.Vector3(
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.sin(camPitch),
        Math.cos(camYaw) * Math.cos(camPitch)
    );
    camera.lookAt(camera.position.clone().add(forward));
})();

const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
    stencil: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.outputColorSpace = THREE.SRGBColorSpace;
gameContainer.appendChild(renderer.domElement);

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(40, 80, 30);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffffff, 0x657080, 1.1));

const textureLoader = new THREE.TextureLoader();
let blockTexture = null;
const materialCache = new Map();

const COLORS = {
    blue: 0x4A9BD0, red: 0xD94B42, green: 0x4DAA58,
    yellow: 0xD8BD45, brown: 0x79513A, grey: 0x929292,
    white: 0xD8D8D8, orange: 0xD77A3A, purple: 0x7959A8, black: 0x282828
};
const colorList = Object.values(COLORS);
let colorIndex = 0;

function getSolidMaterial(color) {
    const key = "solid_" + color;
    if (materialCache.has(key)) return materialCache.get(key);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    materialCache.set(key, mat);
    return mat;
}

function getBlockMaterial(color, width, depth) {
    if (!blockTexture || !blockTexture.image) {
        return getSolidMaterial(color);
    }
    const repeatX = width * SETTINGS.studsPerUnit;
    const repeatY = depth * SETTINGS.studsPerUnit;
    const key = color + "_" + repeatX + "x" + repeatY;
    if (materialCache.has(key)) return materialCache.get(key);

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: blockTexture },
            color: { value: new THREE.Color(color) },
            darkFactor: { value: 0.38 },
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
                vec4 tex = texture2D(map, uv);
                float mask = tex.r;
                vec3 bright = color;
                vec3 dark = color * darkFactor;
                vec3 finalColor = mix(dark, bright, mask);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `
    });
    materialCache.set(key, mat);
    return mat;
}

function createBlockMesh({ x = 0, y = 1, z = 0, width = 2, height = 2, depth = 2, color = COLORS.blue } = {}) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = getBlockMaterial(color, width, depth);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = true;
    mesh.userData = { width, height, depth, color, isBlock: true, x, y, z };
    return mesh;
}

blockTexture = textureLoader.load(
    "../Textures/TernixBlockTextures.png",
    (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        blockTexture = tex;
        materialCache.forEach((mat) => {
            if (mat.uniforms && mat.uniforms.map) {
                mat.uniforms.map.value = tex;
                mat.needsUpdate = true;
            }
        });
        console.log("Texture loaded");
    },
    undefined,
    () => {
        console.warn("Texture missing — solid colors");
        blockTexture = null;
    }
);

function createBasePlatform() {
    const mesh = createBlockMesh({
        x: 0, y: -0.5, z: 0,
        width: 40, height: 1, depth: 40,
        color: COLORS.green
    });
    mesh.userData.isBase = true;
    scene.add(mesh);
    placedBlocks.push({
        mesh,
        data: { x: 0, y: -0.5, z: 0, width: 40, height: 1, depth: 40, color: COLORS.green, isBase: true }
    });
}
createBasePlatform();

let isRightMouse = false;
let isDraggingBlock = false;
const flyKeys = { W: false, A: false, S: false, D: false, Space: false, Shift: false };

const player = new THREE.Group();
scene.add(player);
player.visible = false;

const playerPosition = new THREE.Vector3(0, 1, 6);
const velocity = new THREE.Vector3();
let verticalVelocity = 0;
let onGround = false;

let character = null;
let mixer = null;
let walkAction = null;
let jumpAction = null;
let fallAction = null;

function setupCharacter(root) {
    character = root;
    character.traverse((obj) => {
        if (obj.isMesh) {
            obj.frustumCulled = true;
            obj.castShadow = false;
            obj.receiveShadow = false;
            if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach((m) => {
                    if (m.map && !m.map.image) { m.map = null; m.needsUpdate = true; }
                    if (m.normalMap && !m.normalMap.image) { m.normalMap = null; m.needsUpdate = true; }
                    if (m.emissiveMap && !m.emissiveMap.image) { m.emissiveMap = null; m.needsUpdate = true; }
                });
            }
        }
    });
    const box = new THREE.Box3().setFromObject(character);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) character.scale.setScalar(SETTINGS.playerHeight / size.y);
    const fixedBox = new THREE.Box3().setFromObject(character);
    const center = new THREE.Vector3();
    fixedBox.getCenter(center);
    character.position.x -= center.x;
    character.position.z -= center.z;
    character.position.y -= fixedBox.min.y;
    player.add(character);
}

const gltfLoader = new GLTFLoader();

gltfLoader.load(
    "../TernixGuy.glb",
    (gltf) => {
        setupCharacter(gltf.scene);
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(character);
            for (const clip of gltf.animations) {
                const name = clip.name.toLowerCase();
                const action = mixer.clipAction(clip);
                if (name.includes("walk") || name.includes("run")) walkAction = action;
                if (name.includes("jump")) jumpAction = action;
                if (name.includes("fall")) fallAction = action;
            }
        }
        loadExternalAnimations();
    },
    undefined,
    () => {
        const body = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1.4, 0.65),
            new THREE.MeshLambertMaterial({ color: 0xffffff })
        );
        body.position.y = 0.7;
        player.add(body);
        const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 0.85, 0.85),
            new THREE.MeshLambertMaterial({ color: 0xe2bd91 })
        );
        head.position.y = 1.8;
        player.add(head);
    }
);

function loadExternalAnimations() {
    if (!character) return;
    if (!mixer) mixer = new THREE.AnimationMixer(character);

    const tryLoad = (path, assign) => {
        gltfLoader.load(path, (gltf) => {
            if (!gltf.animations || !gltf.animations.length) return;
            const clip = gltf.animations[0];
            try {
                const action = mixer.clipAction(clip);
                assign(action);
                console.log("Loaded animation:", path);
            } catch (e) {
                console.warn("Anim retarget failed:", path, e);
            }
        }, undefined, () => {
            console.warn("Anim missing:", path);
        });
    };

    tryLoad("../Animation/WalkAnimation.glb", (a) => { walkAction = a; });
    tryLoad("../Animation/JumpAnimation.glb", (a) => { jumpAction = a; });
    tryLoad("../Animation/FallAnimation.glb", (a) => { fallAction = a; });
}

function getColliders() {
    return placedBlocks.map(b => {
        const d = b.data;
        return {
            minX: d.x - d.width / 2, maxX: d.x + d.width / 2,
            minY: d.y - d.height / 2, maxY: d.y + d.height / 2,
            minZ: d.z - d.depth / 2, maxZ: d.z + d.depth / 2
        };
    });
}

function collision(x, z, y) {
    const r = SETTINGS.playerRadius;
    const bottom = y;
    const top = y + SETTINGS.playerHeight;
    for (const block of getColliders()) {
        if (top <= block.minY || bottom >= block.maxY) continue;
        const cx = Math.max(block.minX, Math.min(x, block.maxX));
        const cz = Math.max(block.minZ, Math.min(z, block.maxZ));
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r) return true;
    }
    return false;
}

function getFloor(x, z) {
    let floor = -10;
    const r = SETTINGS.playerRadius;
    for (const block of getColliders()) {
        if (x + r < block.minX || x - r > block.maxX) continue;
        if (z + r < block.minZ || z - r > block.maxZ) continue;
        floor = Math.max(floor, block.maxY);
    }
    return floor;
}

document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        if (isPlayMode) return;
        document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTool = btn.dataset.tool;
        statusText.textContent = "Tool: " + currentTool;
        selectedBlock = null;

        if (currentTool === "world") {
            statusText.textContent = "World: sky #87CEEB, fog on";
            propertiesContent.innerHTML = `
                <div style="margin-bottom:6px;"><b>World</b></div>
                <div>Sky: #87CEEB</div>
                <div>Fog: 50 → 140</div>
                <div style="margin-top:8px;color:#666;">More world settings later</div>
            `;
            return;
        }
        updateProperties();
    });
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function getMouseNDC(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function onViewportClick(event) {
    if (isPlayMode || event.button !== 0) return;
    if (currentTool === "world") {
        statusText.textContent = "World tool — see Properties panel";
        return;
    }

    getMouseNDC(event);
    raycaster.setFromCamera(mouse, camera);
    const meshes = placedBlocks.map(b => b.mesh);
    const hits = raycaster.intersectObjects(meshes, false);

    if (currentTool === "block") placeBlock(hits);
    else if (currentTool === "delete") {
        if (hits.length > 0) {
            if (hits[0].object.userData.isBase) {
                statusText.textContent = "Cannot delete base platform";
                return;
            }
            removeBlock(hits[0].object);
        }
    } else if (currentTool === "select" || currentTool === "move") {
        selectedBlock = hits.length > 0 ? hits[0].object : null;
        updateProperties();
        if (selectedBlock && currentTool === "move" && !selectedBlock.userData.isBase) {
            isDraggingBlock = true;
            statusText.textContent = "Dragging — move mouse, wheel = height, release to place";
        } else {
            statusText.textContent = selectedBlock ? "Block selected" : "Nothing selected";
        }
    }
}

function placeBlock(hits) {
    let pos = new THREE.Vector3(0, 1, 0);
    if (hits.length > 0) {
        const hit = hits[0];
        const point = hit.point.clone();
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        pos.copy(point).add(normal.multiplyScalar(SETTINGS.blockSize / 2));
    } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const target = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, target)) pos.copy(target);
    }
    const s = SETTINGS.blockSize;
    pos.x = Math.round(pos.x / s) * s;
    pos.y = Math.max(1, Math.round(pos.y / s) * s);
    pos.z = Math.round(pos.z / s) * s;

    const color = colorList[colorIndex % colorList.length];
    colorIndex++;
    const mesh = createBlockMesh({ x: pos.x, y: pos.y, z: pos.z, width: s, height: s, depth: s, color });
    scene.add(mesh);
    placedBlocks.push({
        mesh,
        data: { x: pos.x, y: pos.y, z: pos.z, width: s, height: s, depth: s, color, isBase: false, useTexture: true }
    });
    mesh.userData.useTexture = true;
    updateExplorer();
    statusText.textContent = `Placed at (${pos.x}, ${pos.y}, ${pos.z})`;
}

function removeBlock(mesh) {
    const idx = placedBlocks.findIndex(b => b.mesh === mesh);
    if (idx === -1) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    placedBlocks.splice(idx, 1);
    if (selectedBlock === mesh) selectedBlock = null;
    updateExplorer();
    updateProperties();
    statusText.textContent = "Block deleted";
}

function updateExplorer() {
    const list = placedBlocks.filter(b => !b.data.isBase);
    blocksHeader.textContent = "Blocks (" + list.length + ")";
    const tree = document.getElementById("explorer-tree");
    if (!tree) return;
    tree.querySelectorAll(".block-item").forEach(el => el.remove());
    list.forEach((b, i) => {
        const el = document.createElement("div");
        el.className = "tree-item indent block-item";
        el.textContent = "Block " + (i + 1) + " (" + b.data.width + "x" + b.data.height + "x" + b.data.depth + ")";
        el.onclick = () => {
            selectedBlock = b.mesh;
            currentTool = "select";
            document.querySelectorAll(".tool-btn").forEach(btn => {
                btn.classList.toggle("active", btn.dataset.tool === "select");
            });
            updateProperties();
            statusText.textContent = "Selected Block " + (i + 1);
        };
        tree.appendChild(el);
    });
}

function updateProperties() {
    if (!selectedBlock) {
        propertiesContent.innerHTML = '<div style="padding:6px;color:#666;">Select an object</div>';
        return;
    }
    const d = selectedBlock.userData;
    const useTex = d.useTexture !== false;
    propertiesContent.innerHTML = `
        <div style="margin-bottom:6px;"><b>Block</b></div>
        <div>X: ${Number(d.x).toFixed(1)} Y: ${Number(d.y).toFixed(1)} Z: ${Number(d.z).toFixed(1)}</div>
        <div style="margin:6px 0;">Size: ${d.width} x ${d.height} x ${d.depth}</div>
        <div style="margin:4px 0;">
            <button type="button" id="btn-bigger" style="padding:2px 8px;margin-right:4px;">Bigger</button>
            <button type="button" id="btn-smaller" style="padding:2px 8px;">Smaller</button>
        </div>
        <div style="margin:6px 0;">
            Texture:
            <button type="button" id="btn-tex-on" style="padding:2px 6px;">On</button>
            <button type="button" id="btn-tex-off" style="padding:2px 6px;">Off</button>
            <span style="font-size:10px;">(${useTex ? "on" : "off"})</span>
        </div>
    `;
    const bigger = document.getElementById("btn-bigger");
    const smaller = document.getElementById("btn-smaller");
    if (bigger) bigger.onclick = () => resizeSelected(1);
    if (smaller) smaller.onclick = () => resizeSelected(-1);
    const ton = document.getElementById("btn-tex-on");
    const toff = document.getElementById("btn-tex-off");
    if (ton) ton.onclick = () => setSelectedTexture(true);
    if (toff) toff.onclick = () => setSelectedTexture(false);
}

function resizeSelected(dir) {
    if (!selectedBlock || selectedBlock.userData.isBase) return;
    const d = selectedBlock.userData;
    const step = SETTINGS.blockSize;
    let w = d.width + dir * step;
    let h = d.height + dir * step;
    let dep = d.depth + dir * step;
    w = Math.max(step, Math.min(40, w));
    h = Math.max(step, Math.min(40, h));
    dep = Math.max(step, Math.min(40, dep));
    const x = d.x, y = d.y, z = d.z, color = d.color;
    const useTexture = d.useTexture !== false;
    removeBlock(selectedBlock);
    const mesh = createBlockMesh({ x, y, z, width: w, height: h, depth: dep, color });
    mesh.userData.useTexture = useTexture;
    if (!useTexture) applySolidMaterial(mesh, color);
    scene.add(mesh);
    const data = { x, y, z, width: w, height: h, depth: dep, color, isBase: false, useTexture };
    placedBlocks.push({ mesh, data });
    mesh.userData = { ...mesh.userData, ...data };
    selectedBlock = mesh;
    updateExplorer();
    updateProperties();
    statusText.textContent = "Resized block";
}

function applySolidMaterial(mesh, color) {
    mesh.material = getSolidMaterial(color);
}

function setSelectedTexture(on) {
    if (!selectedBlock || selectedBlock.userData.isBase) return;
    const d = selectedBlock.userData;
    d.useTexture = on;
    const entry = placedBlocks.find(b => b.mesh === selectedBlock);
    if (entry) entry.data.useTexture = on;
    if (on) {
        selectedBlock.material = getBlockMaterial(d.color, d.width, d.depth);
    } else {
        applySolidMaterial(selectedBlock, d.color);
    }
    updateProperties();
    statusText.textContent = on ? "Texture on" : "Texture off (solid)";
}

renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
        isRightMouse = true;
        e.preventDefault();
    }
});
document.addEventListener("mouseup", (e) => {
    if (e.button === 2) isRightMouse = false;
});
window.addEventListener("blur", () => {
    isRightMouse = false;
    flyKeys.W = flyKeys.A = flyKeys.S = flyKeys.D = flyKeys.Space = flyKeys.Shift = false;
});
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        isRightMouse = false;
        flyKeys.W = flyKeys.A = flyKeys.S = flyKeys.D = flyKeys.Space = flyKeys.Shift = false;
    }
});
renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());
renderer.domElement.addEventListener("click", onViewportClick);

document.addEventListener("mousemove", (e) => {
    if (!isRightMouse) return;
    camYaw -= e.movementX * SETTINGS.mouseSensitivity;
    camPitch -= e.movementY * SETTINGS.mouseSensitivity;
    camPitch = THREE.MathUtils.clamp(camPitch, SETTINGS.cameraMinPitch, SETTINGS.cameraMaxPitch);
});

window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "KeyW") flyKeys.W = true;
    if (e.code === "KeyA") flyKeys.A = true;
    if (e.code === "KeyS") flyKeys.S = true;
    if (e.code === "KeyD") flyKeys.D = true;
    if (e.code === "Space") { flyKeys.Space = true; e.preventDefault(); }
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") flyKeys.Shift = true;
    if (!isPlayMode) {
        if (e.code === "Digit1") setTool("select");
        if (e.code === "Digit2") setTool("block");
        if (e.code === "Digit3") setTool("delete");
        if (e.code === "Digit4") setTool("move");
        if (e.code === "Digit5") setTool("world");
    }
});
window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") flyKeys.W = false;
    if (e.code === "KeyA") flyKeys.A = false;
    if (e.code === "KeyS") flyKeys.S = false;
    if (e.code === "KeyD") flyKeys.D = false;
    if (e.code === "Space") flyKeys.Space = false;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") flyKeys.Shift = false;
});

function setTool(name) {
    currentTool = name;
    document.querySelectorAll(".tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === name));
    statusText.textContent = "Tool: " + name;
    if (name === "world") {
        selectedBlock = null;
        propertiesContent.innerHTML = `
            <div style="margin-bottom:6px;"><b>World</b></div>
            <div>Sky: #87CEEB</div>
            <div>Fog: 50 → 140</div>
            <div style="margin-top:8px;color:#666;">More world settings later</div>
        `;
    }
}

document.addEventListener("mousemove", (e) => {
    if (!isDraggingBlock || !selectedBlock || isPlayMode) return;
    if (selectedBlock.userData.isBase) return;
    getMouseNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -selectedBlock.position.y);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, hit)) {
        const s = SETTINGS.blockSize;
        let x = Math.round(hit.x / s) * s;
        let z = Math.round(hit.z / s) * s;
        selectedBlock.position.x = x;
        selectedBlock.position.z = z;
        selectedBlock.userData.x = x;
        selectedBlock.userData.z = z;
        const entry = placedBlocks.find(b => b.mesh === selectedBlock);
        if (entry) {
            entry.data.x = x;
            entry.data.z = z;
        }
    }
});

document.addEventListener("mouseup", (e) => {
    if (e.button === 0 && isDraggingBlock) {
        isDraggingBlock = false;
        updateProperties();
        updateExplorer();
        statusText.textContent = "Moved block";
    }
});

renderer.domElement.addEventListener("wheel", (e) => {
    if (!isDraggingBlock || !selectedBlock || isPlayMode) return;
    if (selectedBlock.userData.isBase) return;
    e.preventDefault();
    const s = SETTINGS.blockSize;
    let y = selectedBlock.position.y - Math.sign(e.deltaY) * s;
    y = Math.max(1, Math.round(y / s) * s);
    selectedBlock.position.y = y;
    selectedBlock.userData.y = y;
    const entry = placedBlocks.find(b => b.mesh === selectedBlock);
    if (entry) entry.data.y = y;
}, { passive: false });

btnPlay.addEventListener("click", enterPlayMode);
btnExitPlay.addEventListener("click", exitPlayMode);

function enterPlayMode() {
    isPlayMode = true;
    btnPlay.style.display = "none";
    btnExitPlay.style.display = "inline-block";
    player.visible = true;
    playerPosition.set(0, 2, 6);
    velocity.set(0, 0, 0);
    verticalVelocity = 0;
    flyKeys.W = flyKeys.A = flyKeys.S = flyKeys.D = flyKeys.Space = false;
    statusText.textContent = "PLAY MODE - WASD + Space | Right-click camera";
}

function exitPlayMode() {
    isPlayMode = false;
    btnPlay.style.display = "inline-block";
    btnExitPlay.style.display = "none";
    player.visible = false;
    flyKeys.W = flyKeys.A = flyKeys.S = flyKeys.D = flyKeys.Space = false;
    if (walkAction) walkAction.stop();
    if (jumpAction) jumpAction.stop();
    if (fallAction) fallAction.stop();
    statusText.textContent = "Back to build mode";
}

function exitStudio() {
    window.location.href = "index.html";
}
document.getElementById("menu-exit").addEventListener("click", exitStudio);
document.getElementById("btn-close-studio").addEventListener("click", exitStudio);

document.getElementById("menu-save").addEventListener("click", () => {
    saveNameInput.value = placeName === "Untitled Place" ? "" : placeName;
    saveModal.classList.add("show");
});
document.getElementById("save-cancel").addEventListener("click", () => saveModal.classList.remove("show"));
document.getElementById("save-confirm").addEventListener("click", () => {
    const name = saveNameInput.value.trim() || "Untitled Place";
    placeName = name;
    placeTitle.textContent = "Ternix Creators - " + name;
    savePlaceToStorage(name);
    saveModal.classList.remove("show");
    statusText.textContent = "Saved: " + name;
});

document.getElementById("menu-publish").addEventListener("click", () => {
    publishNameInput.value = placeName === "Untitled Place" ? "" : placeName;
    coverPreview.innerHTML = "No image selected";
    publishCover.value = "";
    coverDataUrl = null;
    publishModal.classList.add("show");
});
document.getElementById("publish-cancel").addEventListener("click", () => publishModal.classList.remove("show"));

let coverDataUrl = null;
publishCover.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        coverDataUrl = ev.target.result;
        coverPreview.innerHTML = '<img src="' + coverDataUrl + '" alt="cover">';
    };
    reader.readAsDataURL(file);
});

document.getElementById("publish-confirm").addEventListener("click", () => {
    const name = publishNameInput.value.trim();
    if (!name) {
        alert("Please enter a game title");
        return;
    }

    const author = localStorage.getItem("ternix_creators_user");
    if (!author) {
        alert("You must be logged in to publish");
        window.location.href = "index.html";
        return;
    }

    placeName = name;
    placeTitle.textContent = "Ternix Creators - " + name;
    savePlaceToStorage(name);

    let games = [];
    try {
        games = JSON.parse(localStorage.getItem("ternix_published_games") || "[]");
        if (!Array.isArray(games)) games = [];
    } catch (e) {
        games = [];
    }

    games = games.filter(g => g.author !== author);

    const gameData = {
        id: "game_" + author + "_" + Date.now(),
        title: name,
        author: author,
        cover: coverDataUrl || null,
        blocks: placedBlocks.map(b => ({ ...b.data })),
        created: new Date().toISOString(),
        visits: 0
    };
    games.unshift(gameData);
    localStorage.setItem("ternix_published_games", JSON.stringify(games));

    publishModal.classList.remove("show");
    statusText.textContent = "Published: " + name + " by " + author;
    alert('Game "' + name + '" published as ' + author + '!\nOpen Ternix hub to see it.');
});

function savePlaceToStorage(name) {
    const user = localStorage.getItem("ternix_creators_user");
    if (!user) return;
    const data = {
        name,
        blocks: placedBlocks.map(b => ({ ...b.data })),
        savedAt: Date.now(),
        owner: user
    };
    localStorage.setItem("ternix_place_" + user, JSON.stringify(data));
}

function loadPlaceFromStorage() {
    const user = localStorage.getItem("ternix_creators_user");
    if (!user) return;
    const raw = localStorage.getItem("ternix_place_" + user);
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        placeName = data.name || "Untitled Place";
        placeTitle.textContent = "Ternix Creators - " + placeName;
        for (let i = placedBlocks.length - 1; i >= 0; i--) {
            const b = placedBlocks[i];
            if (b.data.isBase) continue;
            scene.remove(b.mesh);
            b.mesh.geometry.dispose();
            placedBlocks.splice(i, 1);
        }
        for (const d of (data.blocks || [])) {
            if (d.isBase) continue;
            const mesh = createBlockMesh(d);
            mesh.userData.useTexture = d.useTexture !== false;
            if (d.useTexture === false) applySolidMaterial(mesh, d.color);
            scene.add(mesh);
            placedBlocks.push({ mesh, data: { ...d } });
        }
        updateExplorer();
        statusText.textContent = "Loaded place: " + placeName;
    } catch (err) {
        console.warn("Failed to load place", err);
    }
}
loadPlaceFromStorage();

function updateFly(delta) {
    const speed = SETTINGS.flySpeed * (flyKeys.Shift ? SETTINGS.flyBoost : 1);
    const forward = new THREE.Vector3(
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.sin(camPitch),
        Math.cos(camYaw) * Math.cos(camPitch)
    ).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (flyKeys.W) move.add(forward);
    if (flyKeys.S) move.sub(forward);
    if (flyKeys.A) move.sub(right);
    if (flyKeys.D) move.add(right);
    if (flyKeys.Space) move.y += 1;
    if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * delta);
        camera.position.add(move);
    }
    camera.lookAt(camera.position.clone().add(forward));
}

function approach(current, target, amount) {
    if (current < target) return Math.min(current + amount, target);
    if (current > target) return Math.max(current - amount, target);
    return target;
}

function updatePlayMovement(delta) {
    const direction = new THREE.Vector3();
    if (flyKeys.W) direction.z -= 1;
    if (flyKeys.S) direction.z += 1;
    if (flyKeys.A) direction.x -= 1;
    if (flyKeys.D) direction.x += 1;
    const moving = direction.lengthSq() > 0;
    if (moving) {
        direction.normalize();
        direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw);
    }
    const targetX = moving ? direction.x * SETTINGS.playerSpeed : 0;
    const targetZ = moving ? direction.z * SETTINGS.playerSpeed : 0;
    const accel = moving ? SETTINGS.acceleration : SETTINGS.deceleration;
    velocity.x = approach(velocity.x, targetX, accel * delta);
    velocity.z = approach(velocity.z, targetZ, accel * delta);

    const nextX = playerPosition.x + velocity.x * delta;
    if (!collision(nextX, playerPosition.z, playerPosition.y)) playerPosition.x = nextX;
    else velocity.x = 0;

    const nextZ = playerPosition.z + velocity.z * delta;
    if (!collision(playerPosition.x, nextZ, playerPosition.y)) playerPosition.z = nextZ;
    else velocity.z = 0;

    if (moving) {
        const targetRot = Math.atan2(direction.x, direction.z);
        let diff = targetRot - player.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        player.rotation.y += diff * Math.min(1, delta * 18);
    }
    if (flyKeys.Space && onGround) {
        verticalVelocity = SETTINGS.jumpPower;
        onGround = false;
        if (jumpAction) jumpAction.reset().setLoop(THREE.LoopOnce).play();
    }
}

function updatePlayPhysics(delta) {
    verticalVelocity -= SETTINGS.gravity * delta;
    verticalVelocity = Math.max(verticalVelocity, -35);
    playerPosition.y += verticalVelocity * delta;
    const floor = getFloor(playerPosition.x, playerPosition.z);
    if (playerPosition.y <= floor) {
        playerPosition.y = floor;
        verticalVelocity = 0;
        onGround = true;
    } else {
        onGround = false;
    }
}

function updatePlayCamera() {
    const target = new THREE.Vector3(playerPosition.x, playerPosition.y + 1.6, playerPosition.z);
    const horiz = Math.cos(camPitch) * SETTINGS.cameraDistance;
    const vert = Math.sin(camPitch) * SETTINGS.cameraDistance;
    camera.position.set(
        target.x + Math.sin(camYaw) * horiz,
        target.y + vert,
        target.z + Math.cos(camYaw) * horiz
    );
    camera.lookAt(target);
}

function updateAnims() {
    if (!mixer) return;
    const moving = velocity.lengthSq() > 0.1;
    if (walkAction) {
        if (moving && onGround) {
            if (!walkAction.isRunning()) walkAction.reset().play();
        } else {
            walkAction.stop();
        }
    }
    if (fallAction) {
        if (!onGround && verticalVelocity < -2) {
            if (!fallAction.isRunning()) fallAction.reset().play();
        } else if (onGround) {
            fallAction.stop();
        }
    }
}

function resize() {
    const w = gameContainer.clientWidth;
    const h = gameContainer.clientHeight;
    if (w < 1 || h < 1) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
function loop() {
    requestAnimationFrame(loop);
    const delta = Math.min(clock.getDelta(), 0.05);
    if (isPlayMode) {
        updatePlayMovement(delta);
        updatePlayPhysics(delta);
        player.position.copy(playerPosition);
        updatePlayCamera();
        if (mixer) mixer.update(delta);
        updateAnims();
    } else {
        updateFly(delta);
    }
    renderer.render(scene, camera);
}
loop();

function resizeCursorImage(imgUrl, callback) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imgUrl;
    img.onload = function () {
        const c = document.createElement("canvas");
        c.width = 90;
        c.height = 90;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, 90, 90);
        callback(c.toDataURL("image/png"));
    };
    img.onerror = function () {
        img.removeAttribute("crossOrigin");
        img.src = imgUrl;
    };
}

window.addEventListener("DOMContentLoaded", () => {
    resizeCursorImage("../cursor/Ternix 3 cursor.png", (url3) => {
        resizeCursorImage("../cursor/Ternix 1 cursor.png", (urlDef) => {
            const s = document.createElement("style");
            s.innerHTML = `
                * { cursor: url('${urlDef}') 0 0, auto !important; }
                a, a *, button, button *, input, select, textarea, img,
                .tool-btn, .menu-item, .dropdown-item {
                    cursor: url('${url3}') 0 0, pointer !important;
                }
            `;
            document.head.appendChild(s);
        });
    });
});