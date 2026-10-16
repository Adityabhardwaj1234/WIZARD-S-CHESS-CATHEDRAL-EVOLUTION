/**
 * 3D Gothic Cathedral Environment, 64-Square Interactive Board,
 * Singleton Geometry Pool (Zero GPU Memory Leaks),
 * 7-Light Studio Sanctuary Rig & High-Contrast Marble/Obsidian Materials,
 * Occlusion-Free Ground-Plane Move Picking, and 3D X-Ray Overlay & Arrow Renderer.
 */

import { FILES, RANKS } from '../game/ChessGame.js';

export function squareToWorld(sqAlg, squareSize = 1.15) {
  const f = sqAlg.charCodeAt(0) - 97;
  const r = 8 - (sqAlg.charCodeAt(1) - 48);
  const x = (f - 3.5) * squareSize;
  const z = (r - 3.5) * squareSize;
  return { x, z, r, f };
}

export class CathedralScene {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.onSquareClick = callbacks.onSquareClick || (() => {});
    this.onSquareHover = callbacks.onSquareHover || (() => {});
    this.onWebGLError = callbacks.onWebGLError || (() => {});

    this.THREE = typeof window !== 'undefined' ? window.THREE : null;
    this.squareSize = 1.15;
    this.boardFlipped = false;
    this.animationsEnabled = true;
    this.reducedMotion = false;
    this.showCoordinates = true;
    this.quality = 'high';
    this.highVisibility = false;
    this.brightness = 1.15;
    this.boardLightLevel = 1.35;

    this.squareMeshes = new Map();
    this.pieceMeshes = new Map();
    this.coordSprites = [];
    this.activeAnimations = [];
    this.shatterParticles = [];
    this.dustPoints = null;
    this.lightShafts = [];
    this.sharedGeometries = null;

    this.selectedSquare = null;
    this.legalMovesList = [];
    this.hoveredSquare = null;
    this.lastMoveSquares = { from: null, to: null };
    this.checkSquare = null;

    // Camera spherical orbit coordinates (improved default elevation & framing)
    this.camSpherical = {
      theta: 0,
      phi: 0.82,
      radius: 12.4,
      targetTheta: 0,
      targetPhi: 0.82,
      targetRadius: 12.4,
      lookAtY: 0.15
    };
    this.isDragging = false;
    this.pointerDownPos = { x: 0, y: 0 };
    this.dragMoved = false;
    this.shakeIntensity = 0;
    this.rafId = null;

    if (this.THREE && this.container) {
      this.init();
    }
  }

  init() {
    const THREE = this.THREE;
    try {
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0f131d);
      this.scene.fog = new THREE.FogExp2(0x0f131d, 0.011);

      const w = Math.max(300, this.container.clientWidth || 800);
      const h = Math.max(300, this.container.clientHeight || 600);

      this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 150);
      this.renderer = new THREE.WebGLRenderer({
        antialias: this.quality !== 'low',
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(w, h);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25));
      this.renderer.shadowMap.enabled = this.quality !== 'low';
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (THREE.ACESFilmicToneMapping !== undefined) {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.22;
      }

      this.container.innerHTML = '';
      this.container.appendChild(this.renderer.domElement);

      this.raycaster = new THREE.Raycaster();
      this.pointer = new THREE.Vector2();

      this.initMaterials();
      this.initSharedPieceGeometries();
      this.initLights();
      this.buildCathedralArchitecture();
      this.buildChessBoard();
      this.bindEvents();
      this.animate();
    } catch (err) {
      this.onWebGLError(err);
    }
  }

  createMarbleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8f4ec';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(160, 148, 130, 0.24)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 16; i++) {
      ctx.beginPath();
      let x = (i * 37) % 256;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < 256) {
        y += 16;
        x += Math.sin(y * 0.05 + i) * 9;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new this.THREE.CanvasTexture(canvas);
    tex.wrapS = this.THREE.RepeatWrapping;
    tex.wrapT = this.THREE.RepeatWrapping;
    return tex;
  }

  createObsidianTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#2e364f');
    grad.addColorStop(0.5, '#23293d');
    grad.addColorStop(1, '#38415e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo((i * 29) % 256, 0);
      ctx.lineTo(((i * 29) + 90) % 256, 256);
      ctx.stroke();
    }
    return new this.THREE.CanvasTexture(canvas);
  }

  initMaterials() {
    const THREE = this.THREE;
    const marbleTex = this.createMarbleTexture();
    const obsidianTex = this.createObsidianTexture();

    this.materials = {
      whitePiece: new THREE.MeshStandardMaterial({
        color: 0xfbf8f1,
        map: marbleTex,
        roughness: 0.22,
        metalness: 0.08,
        emissive: 0x1f1b14,
        emissiveIntensity: 0.12
      }),
      whiteAccent: new THREE.MeshStandardMaterial({
        color: 0xe5c158,
        roughness: 0.22,
        metalness: 0.78,
        emissive: 0x3b2d0a,
        emissiveIntensity: 0.28
      }),
      blackPiece: new THREE.MeshStandardMaterial({
        color: 0x323c59,
        map: obsidianTex,
        roughness: 0.14,
        metalness: 0.46,
        emissive: 0x161d2e,
        emissiveIntensity: 0.38
      }),
      blackAccent: new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.18,
        metalness: 0.84,
        emissive: 0x334155,
        emissiveIntensity: 0.45
      }),
      blackPlinthRim: new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.22,
        metalness: 0.85,
        emissive: 0x42330b,
        emissiveIntensity: 0.42
      }),
      lightSquare: new THREE.MeshStandardMaterial({
        color: 0xe2d9c8,
        map: marbleTex,
        roughness: 0.34,
        metalness: 0.04
      }),
      darkSquare: new THREE.MeshStandardMaterial({
        color: 0x222634,
        roughness: 0.32,
        metalness: 0.14
      }),
      boardFrame: new THREE.MeshStandardMaterial({
        color: 0x181b24,
        roughness: 0.4,
        metalness: 0.35
      }),
      goldTrim: new THREE.MeshStandardMaterial({
        color: 0xcfa84c,
        roughness: 0.28,
        metalness: 0.78
      }),
      cathedralStone: new THREE.MeshStandardMaterial({
        color: 0x161a24,
        roughness: 0.76,
        metalness: 0.08
      }),
      cathedralFloor: new THREE.MeshStandardMaterial({
        color: 0x11151f,
        roughness: 0.26,
        metalness: 0.2
      })
    };
  }

  /**
   * Builds all piece BufferGeometries ONCE at startup to eliminate GPU memory leaks on move updates.
   */
  initSharedPieceGeometries() {
    const THREE = this.THREE;
    const v2 = (x, y) => new THREE.Vector2(x, y);

    this.sharedGeometries = {
      plinthDisk: new THREE.CylinderGeometry(0.43, 0.45, 0.04, 24),
      pawnBody: new THREE.LatheGeometry(
        [
          v2(0, 0), v2(0.38, 0), v2(0.38, 0.08), v2(0.31, 0.14),
          v2(0.22, 0.25), v2(0.14, 0.58), v2(0.22, 0.64), v2(0.13, 0.70), v2(0, 0.72)
        ],
        20
      ),
      pawnHead: new THREE.SphereGeometry(0.2, 20, 16),
      pawnRing: new THREE.TorusGeometry(0.19, 0.025, 10, 24),

      rookBody: new THREE.LatheGeometry(
        [
          v2(0, 0), v2(0.42, 0), v2(0.42, 0.1), v2(0.34, 0.18),
          v2(0.26, 0.34), v2(0.24, 0.88), v2(0.32, 0.96), v2(0.32, 1.12), v2(0, 1.12)
        ],
        20
      ),
      rookMerlon: new THREE.BoxGeometry(0.15, 0.16, 0.15),
      rookRing: new THREE.TorusGeometry(0.27, 0.026, 10, 24),

      knightBase: new THREE.LatheGeometry(
        [v2(0, 0), v2(0.42, 0), v2(0.42, 0.1), v2(0.34, 0.18), v2(0.26, 0.35), v2(0, 0.36)],
        20
      ),
      knightNeck: new THREE.BoxGeometry(0.28, 0.65, 0.36),
      knightHead: new THREE.BoxGeometry(0.24, 0.24, 0.46),
      knightMane: new THREE.BoxGeometry(0.08, 0.62, 0.14),
      knightEar: new THREE.ConeGeometry(0.05, 0.16, 6),
      knightRing: new THREE.TorusGeometry(0.28, 0.025, 10, 24),

      bishopBody: new THREE.LatheGeometry(
        [
          v2(0, 0), v2(0.42, 0), v2(0.42, 0.1), v2(0.34, 0.18),
          v2(0.22, 0.42), v2(0.16, 0.78), v2(0.26, 0.98), v2(0.22, 1.18),
          v2(0.1, 1.32), v2(0, 1.35)
        ],
        20
      ),
      bishopFinial: new THREE.SphereGeometry(0.075, 14, 14),
      bishopRing: new THREE.TorusGeometry(0.21, 0.026, 10, 24),

      queenBody: new THREE.LatheGeometry(
        [
          v2(0, 0), v2(0.45, 0), v2(0.45, 0.1), v2(0.36, 0.2),
          v2(0.24, 0.48), v2(0.17, 0.94), v2(0.28, 1.16), v2(0.33, 1.36),
          v2(0.2, 1.44), v2(0, 1.46)
        ],
        24
      ),
      queenPearl: new THREE.SphereGeometry(0.048, 10, 10),
      queenRing: new THREE.TorusGeometry(0.24, 0.028, 10, 24),

      kingBody: new THREE.LatheGeometry(
        [
          v2(0, 0), v2(0.47, 0), v2(0.47, 0.11), v2(0.38, 0.22),
          v2(0.25, 0.52), v2(0.19, 1.02), v2(0.3, 1.24), v2(0.32, 1.46),
          v2(0.18, 1.54), v2(0, 1.56)
        ],
        24
      ),
      kingCrossV: new THREE.BoxGeometry(0.08, 0.3, 0.08),
      kingCrossH: new THREE.BoxGeometry(0.24, 0.08, 0.08),
      kingRing: new THREE.TorusGeometry(0.26, 0.03, 10, 24)
    };
  }

  /**
   * 7-Source Studio Sanctuary Lighting Rig for immediate piece readability
   */
  initLights() {
    const THREE = this.THREE;
    // 1. Broad soft ambient light
    this.ambientLight = new THREE.AmbientLight(0xdbeafe, 0.88);
    this.scene.add(this.ambientLight);

    // 2. Overhead Hemisphere light
    this.hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 0.78);
    this.hemiLight.position.set(0, 28, 0);
    this.scene.add(this.hemiLight);

    // 3. Strong diffused Sanctuary Key Light focused on the 64 squares
    this.keyLight = new THREE.DirectionalLight(0xfff8e7, 1.52);
    this.keyLight.position.set(6, 17, 7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.width = 1024;
    this.keyLight.shadow.mapSize.height = 1024;
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 36;
    const d = 7.2;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.scene.add(this.keyLight);

    // 4. Dedicated Front-South Fill Light so dark pieces never disappear into shadow
    this.frontFillLight = new THREE.DirectionalLight(0xe2e8f0, 0.92);
    this.frontFillLight.position.set(0, 9, 12);
    this.scene.add(this.frontFillLight);

    // 5. Cool Silver-Sapphire Back-Left Rim Light to carve out Obsidian contours
    this.rimBlueLight = new THREE.DirectionalLight(0x93c5fd, 0.95);
    this.rimBlueLight.position.set(-11, 11, -10);
    this.scene.add(this.rimBlueLight);

    // 6. Warm Amber Back-Right Rim Light
    this.rimGoldLight = new THREE.DirectionalLight(0xfde68a, 0.72);
    this.rimGoldLight.position.set(11, 10, -9);
    this.scene.add(this.rimGoldLight);

    // 7. Dynamic impact flash light
    this.impactLight = new THREE.PointLight(0xd4af37, 0, 12);
    this.impactLight.position.set(0, 3, 0);
    this.scene.add(this.impactLight);
  }

  buildCathedralArchitecture() {
    const THREE = this.THREE;
    this.cathedralGroup = new THREE.Group();

    const floorGeo = new THREE.CylinderGeometry(36, 36, 0.4, 48);
    const floorMesh = new THREE.Mesh(floorGeo, this.materials.cathedralFloor);
    floorMesh.position.y = -1.65;
    floorMesh.receiveShadow = true;
    this.cathedralGroup.add(floorMesh);

    const daisStep1 = new THREE.Mesh(
      new THREE.CylinderGeometry(7.8, 8.3, 0.55, 8),
      this.materials.cathedralStone
    );
    daisStep1.position.y = -1.18;
    daisStep1.rotation.y = Math.PI / 8;
    daisStep1.receiveShadow = true;
    this.cathedralGroup.add(daisStep1);

    const daisStep2 = new THREE.Mesh(
      new THREE.CylinderGeometry(6.6, 7.0, 0.55, 8),
      this.materials.cathedralStone
    );
    daisStep2.position.y = -0.65;
    daisStep2.rotation.y = Math.PI / 8;
    daisStep2.receiveShadow = true;
    this.cathedralGroup.add(daisStep2);

    const colPositions = [
      [-12, -12], [12, -12], [-12, -4], [12, -4],
      [-12, 4], [12, 4], [-12, 12], [12, 12]
    ];
    const colGeo = new THREE.CylinderGeometry(0.68, 0.82, 22, 12);
    const baseGeo = new THREE.BoxGeometry(2.1, 1.2, 2.1);
    const capGeo = new THREE.CylinderGeometry(1.1, 0.72, 1.1, 8);

    colPositions.forEach(([cx, cz]) => {
      const colGroup = new THREE.Group();
      const col = new THREE.Mesh(colGeo, this.materials.cathedralStone);
      col.position.y = 9.5;
      colGroup.add(col);

      const base = new THREE.Mesh(baseGeo, this.materials.cathedralStone);
      base.position.y = -0.8;
      colGroup.add(base);

      const cap = new THREE.Mesh(capGeo, this.materials.cathedralStone);
      cap.position.y = 20.2;
      colGroup.add(cap);

      colGroup.position.set(cx, 0, cz);
      this.cathedralGroup.add(colGroup);
    });

    [-12, -4, 4, 12].forEach(zPos => {
      const archGeo = new THREE.TorusGeometry(12, 0.32, 8, 32, Math.PI);
      const archMesh = new THREE.Mesh(archGeo, this.materials.cathedralStone);
      archMesh.position.set(0, 19.8, zPos);
      this.cathedralGroup.add(archMesh);
    });

    const stainedColors = [0x1d4ed8, 0x9f1239, 0xd97706];
    [-6, 0, 6].forEach((xOffset, idx) => {
      const winGeo = new THREE.PlaneGeometry(2.8, 11);
      const winMat = new THREE.MeshBasicMaterial({
        color: stainedColors[idx % stainedColors.length],
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide
      });
      const winMesh = new THREE.Mesh(winGeo, winMat);
      winMesh.position.set(xOffset, 10.5, -22);
      this.cathedralGroup.add(winMesh);
    });

    const roseGeo = new THREE.RingGeometry(1.2, 4.2, 24);
    const roseMat = new THREE.MeshBasicMaterial({
      color: 0xd97706,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide
    });
    const roseMesh = new THREE.Mesh(roseGeo, roseMat);
    roseMesh.position.set(0, 19.5, -21.8);
    this.cathedralGroup.add(roseMesh);

    // Keep subtle moonlight shaft behind the board (z = -9) so it never washes out pieces
    const shaftGeo = new THREE.ConeGeometry(4.2, 22, 16, 1, true);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.032,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const shaft1 = new THREE.Mesh(shaftGeo, shaftMat);
    shaft1.position.set(-4.5, 10.5, -9.5);
    shaft1.rotation.z = -0.22;
    shaft1.rotation.x = 0.16;
    this.cathedralGroup.add(shaft1);
    this.lightShafts.push(shaft1);

    const particleCount = 120;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 18;
      positions[i * 3 + 1] = Math.random() * 9 + 0.6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xe2d5b5,
      size: 0.06,
      transparent: true,
      opacity: 0.38,
      depthWrite: false
    });
    this.dustPoints = new THREE.Points(dustGeo, dustMat);
    this.cathedralGroup.add(this.dustPoints);

    this.scene.add(this.cathedralGroup);
  }

  buildChessBoard() {
    const THREE = this.THREE;
    this.boardGroup = new THREE.Group();

    const boardSpan = this.squareSize * 8;
    const frameGeo = new THREE.BoxGeometry(boardSpan + 1.1, 0.36, boardSpan + 1.1);
    const frameMesh = new THREE.Mesh(frameGeo, this.materials.boardFrame);
    frameMesh.position.y = -0.22;
    frameMesh.receiveShadow = true;
    this.boardGroup.add(frameMesh);

    const trimGeo = new THREE.BoxGeometry(boardSpan + 0.28, 0.38, boardSpan + 0.28);
    const trimMesh = new THREE.Mesh(trimGeo, this.materials.goldTrim);
    trimMesh.position.y = -0.2;
    this.boardGroup.add(trimMesh);

    const sqGeo = new THREE.BoxGeometry(this.squareSize, 0.16, this.squareSize);
    this.squaresGroup = new THREE.Group();
    this.overlaysGroup = new THREE.Group();
    this.xrayGroup = new THREE.Group();
    this.piecesGroup = new THREE.Group();

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sqAlg = FILES[f] + RANKS[r];
        const isLight = (r + f) % 2 === 0;
        const mesh = new THREE.Mesh(
          sqGeo,
          isLight ? this.materials.lightSquare : this.materials.darkSquare
        );
        const { x, z } = squareToWorld(sqAlg, this.squareSize);
        mesh.position.set(x, -0.08, z);
        mesh.receiveShadow = true;
        mesh.userData = { square: sqAlg, isGroundSquare: true };
        this.squaresGroup.add(mesh);
        this.squareMeshes.set(sqAlg, mesh);
      }
    }

    // Hover reticle on ground plane so user always sees the exact square under cursor
    const reticleGeo = new THREE.RingGeometry(0.45, 0.53, 4);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.hoverReticle = new THREE.Mesh(reticleGeo, reticleMat);
    this.hoverReticle.rotation.x = -Math.PI / 2;
    this.hoverReticle.rotation.z = Math.PI / 4;
    this.hoverReticle.position.y = 0.025;
    this.hoverReticle.visible = false;
    this.boardGroup.add(this.hoverReticle);

    this.boardGroup.add(this.squaresGroup);
    this.boardGroup.add(this.overlaysGroup);
    this.boardGroup.add(this.xrayGroup);
    this.boardGroup.add(this.piecesGroup);
    this.scene.add(this.boardGroup);

    this.rebuildCoordinates();
  }

  createTextSprite(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillStyle = '#f3d067';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);

    const tex = new this.THREE.CanvasTexture(canvas);
    const mat = new this.THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false
    });
    const geo = new this.THREE.PlaneGeometry(0.42, 0.42);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  rebuildCoordinates() {
    if (!this.THREE || !this.boardGroup) return;
    for (const s of this.coordSprites) {
      this.boardGroup.remove(s);
      if (s.geometry) s.geometry.dispose();
      if (s.material) {
        if (s.material.map) s.material.map.dispose();
        s.material.dispose();
      }
    }
    this.coordSprites = [];
    if (!this.showCoordinates) return;

    const halfSpan = (this.squareSize * 8) / 2 + 0.34;
    for (let i = 0; i < 8; i++) {
      const fileLabel = FILES[i].toUpperCase();
      const fPos = (i - 3.5) * this.squareSize;
      const fileSprite = this.createTextSprite(fileLabel);
      fileSprite.position.set(fPos, 0.01, this.boardFlipped ? -halfSpan : halfSpan);
      if (this.boardFlipped) fileSprite.rotation.z = Math.PI;
      this.boardGroup.add(fileSprite);
      this.coordSprites.push(fileSprite);

      const rankLabel = RANKS[i];
      const rPos = (i - 3.5) * this.squareSize;
      const rankSprite = this.createTextSprite(rankLabel);
      rankSprite.position.set(this.boardFlipped ? halfSpan : -halfSpan, 0.01, rPos);
      if (this.boardFlipped) rankSprite.rotation.z = Math.PI;
      this.boardGroup.add(rankSprite);
      this.coordSprites.push(rankSprite);
    }
  }

  /**
   * Builds a piece group referencing the shared immutable BufferGeometries.
   * Includes a luminous silver-gold base plinth rim on Obsidian pieces for instant contrast.
   */
  createPieceMesh(type, color, squareAlg) {
    const THREE = this.THREE;
    const G = this.sharedGeometries;
    const group = new THREE.Group();
    const mainMat = color === 'w' ? this.materials.whitePiece : this.materials.blackPiece;
    const accentMat = color === 'w' ? this.materials.whiteAccent : this.materials.blackAccent;
    const plinthMat = color === 'w' ? this.materials.whiteAccent : this.materials.blackPlinthRim;

    // Base plinth contrast ring so dark pieces never blend into dark squares
    const plinth = new THREE.Mesh(G.plinthDisk, plinthMat);
    plinth.position.y = 0.02;
    group.add(plinth);

    if (type === 'p') {
      const body = new THREE.Mesh(G.pawnBody, mainMat);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const head = new THREE.Mesh(G.pawnHead, mainMat);
      head.position.y = 0.88;
      head.castShadow = true;
      group.add(head);

      const ring = new THREE.Mesh(G.pawnRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.64;
      group.add(ring);
    } else if (type === 'r') {
      const body = new THREE.Mesh(G.rookBody, mainMat);
      body.castShadow = true;
      group.add(body);

      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2 + Math.PI / 4;
        const merlon = new THREE.Mesh(G.rookMerlon, mainMat);
        merlon.position.set(Math.cos(angle) * 0.22, 1.18, Math.sin(angle) * 0.22);
        merlon.rotation.y = -angle;
        merlon.castShadow = true;
        group.add(merlon);
      }

      const ring = new THREE.Mesh(G.rookRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.92;
      group.add(ring);
    } else if (type === 'n') {
      const base = new THREE.Mesh(G.knightBase, mainMat);
      base.castShadow = true;
      group.add(base);

      const horseGroup = new THREE.Group();
      const neck = new THREE.Mesh(G.knightNeck, mainMat);
      neck.position.set(0, 0.66, 0.02);
      neck.rotation.x = 0.22;
      neck.castShadow = true;
      horseGroup.add(neck);

      const head = new THREE.Mesh(G.knightHead, mainMat);
      head.position.set(0, 0.98, 0.14);
      head.rotation.x = 0.38;
      head.castShadow = true;
      horseGroup.add(head);

      const mane = new THREE.Mesh(G.knightMane, accentMat);
      mane.position.set(0, 0.74, -0.15);
      mane.rotation.x = 0.18;
      horseGroup.add(mane);

      const earL = new THREE.Mesh(G.knightEar, mainMat);
      earL.position.set(-0.07, 1.16, 0.02);
      const earR = new THREE.Mesh(G.knightEar, mainMat);
      earR.position.set(0.07, 1.16, 0.02);
      horseGroup.add(earL, earR);

      horseGroup.rotation.y = color === 'w' ? Math.PI : 0;
      group.add(horseGroup);

      const ring = new THREE.Mesh(G.knightRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.35;
      group.add(ring);
    } else if (type === 'b') {
      const body = new THREE.Mesh(G.bishopBody, mainMat);
      body.castShadow = true;
      group.add(body);

      const finial = new THREE.Mesh(G.bishopFinial, accentMat);
      finial.position.y = 1.4;
      group.add(finial);

      const ring = new THREE.Mesh(G.bishopRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.82;
      group.add(ring);
    } else if (type === 'q') {
      const body = new THREE.Mesh(G.queenBody, mainMat);
      body.castShadow = true;
      group.add(body);

      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const pearl = new THREE.Mesh(G.queenPearl, accentMat);
        pearl.position.set(Math.cos(angle) * 0.26, 1.44, Math.sin(angle) * 0.26);
        group.add(pearl);
      }

      const ring = new THREE.Mesh(G.queenRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.06;
      group.add(ring);
    } else if (type === 'k') {
      const body = new THREE.Mesh(G.kingBody, mainMat);
      body.castShadow = true;
      group.add(body);

      const crossV = new THREE.Mesh(G.kingCrossV, accentMat);
      crossV.position.y = 1.72;
      const crossH = new THREE.Mesh(G.kingCrossH, accentMat);
      crossH.position.y = 1.76;
      group.add(crossV, crossH);

      const ring = new THREE.Mesh(G.kingRing, accentMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.16;
      group.add(ring);
    }

    const { x, z } = squareToWorld(squareAlg, this.squareSize);
    group.position.set(x, 0, z);
    group.userData = { square: squareAlg, type, color, baseY: 0 };

    group.traverse(child => {
      child.userData = { square: squareAlg, isPiece: true };
    });

    return group;
  }

  syncBoard(game, transitionInfo = null) {
    if (!this.THREE || !this.piecesGroup) return;

    this.activeAnimations = [];
    for (const [, mesh] of this.pieceMeshes.entries()) {
      this.piecesGroup.remove(mesh);
    }
    this.pieceMeshes.clear();

    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r][f];
        if (!cell) continue;
        const mesh = this.createPieceMesh(cell.type, cell.color, cell.square);
        this.piecesGroup.add(mesh);
        this.pieceMeshes.set(cell.square, mesh);
      }
    }

    if (transitionInfo && this.animationsEnabled && !this.reducedMotion) {
      const { from, to, flags, captured, color } = transitionInfo;
      const movedMesh = this.pieceMeshes.get(to);
      if (movedMesh && from && to) {
        const startPos = squareToWorld(from, this.squareSize);
        const endPos = squareToWorld(to, this.squareSize);
        movedMesh.position.set(startPos.x, 0, startPos.z);
        this.activeAnimations.push({
          mesh: movedMesh,
          startX: startPos.x,
          startZ: startPos.z,
          endX: endPos.x,
          endZ: endPos.z,
          arcHeight: captured ? 0.95 : 0.55,
          startTime: performance.now(),
          duration: captured ? 320 : 250
        });
      }

      if (flags === 'k' || flags === 'q') {
        const rankChar = color === 'w' ? '1' : '8';
        const rookFrom = (flags === 'k' ? 'h' : 'a') + rankChar;
        const rookTo = (flags === 'k' ? 'f' : 'd') + rankChar;
        const rookMesh = this.pieceMeshes.get(rookTo);
        if (rookMesh) {
          const rStart = squareToWorld(rookFrom, this.squareSize);
          const rEnd = squareToWorld(rookTo, this.squareSize);
          rookMesh.position.set(rStart.x, 0, rStart.z);
          this.activeAnimations.push({
            mesh: rookMesh,
            startX: rStart.x,
            startZ: rStart.z,
            endX: rEnd.x,
            endZ: rEnd.z,
            arcHeight: 0.45,
            startTime: performance.now(),
            duration: 270
          });
        }
      }

      if (captured) {
        let shatterSq = to;
        if (flags === 'e') {
          const fileChar = to[0];
          const capRank = color === 'w' ? '5' : '4';
          shatterSq = fileChar + capRank;
        }
        const capturedColor = color === 'w' ? 'b' : 'w';
        this.spawnShatterEffect(shatterSq, capturedColor);
      }
    }
  }

  spawnShatterEffect(squareAlg, capturedColor) {
    if (!this.THREE || this.reducedMotion || !this.animationsEnabled) return;
    const THREE = this.THREE;
    const { x, z } = squareToWorld(squareAlg, this.squareSize);
    const mat =
      capturedColor === 'w'
        ? this.materials.whitePiece.clone()
        : this.materials.blackPiece.clone();
    mat.transparent = true;
    mat.opacity = 1.0;

    const shardCount = this.quality === 'low' ? 12 : 24;
    const group = new THREE.Group();
    const shards = [];

    for (let i = 0; i < shardCount; i++) {
      const size = 0.07 + Math.random() * 0.08;
      const geo = new THREE.DodecahedronGeometry(size, 0);
      const mesh = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.5;
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.25,
        0.3 + Math.random() * 0.7,
        z + (Math.random() - 0.5) * 0.25
      );
      group.add(mesh);
      shards.push({
        mesh,
        geo,
        vx: Math.cos(angle) * speed,
        vy: 1.8 + Math.random() * 2.3,
        vz: Math.sin(angle) * speed,
        rx: (Math.random() - 0.5) * 10,
        ry: (Math.random() - 0.5) * 10
      });
    }

    this.scene.add(group);
    this.shatterParticles.push({
      group,
      mat,
      shards,
      startTime: performance.now(),
      lifetime: 780
    });

    this.impactLight.position.set(x, 2.2, z);
    this.impactLight.intensity = 2.4;
    this.shakeIntensity = 0.1;
  }

  clearShatterEffects() {
    for (const p of this.shatterParticles) {
      this.scene.remove(p.group);
      for (const s of p.shards) s.geo.dispose();
      p.mat.dispose();
    }
    this.shatterParticles = [];
  }

  updateHighlights({
    selectedSquare = null,
    legalMoves = [],
    lastMove = null,
    checkSquare = null,
    hintMove = null
  }) {
    if (!this.THREE || !this.overlaysGroup) return;
    const THREE = this.THREE;

    this.selectedSquare = selectedSquare;
    this.legalMovesList = legalMoves || [];
    this.checkSquare = checkSquare;

    while (this.overlaysGroup.children.length > 0) {
      const child = this.overlaysGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const addSquarePad = (sqAlg, colorHex, opacity = 0.45, yHeight = 0.014) => {
      const { x, z } = squareToWorld(sqAlg, this.squareSize);
      const geo = new THREE.PlaneGeometry(this.squareSize * 0.92, this.squareSize * 0.92);
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, yHeight, z);
      mesh.userData = { square: sqAlg, isGroundSquare: true };
      this.overlaysGroup.add(mesh);
    };

    const addRingOverlay = (sqAlg, innerR, outerR, colorHex, opacity = 0.88, yHeight = 0.024) => {
      const { x, z } = squareToWorld(sqAlg, this.squareSize);
      const geo = new THREE.RingGeometry(innerR, outerR, 28);
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, yHeight, z);
      mesh.userData = { square: sqAlg, isGroundSquare: true };
      this.overlaysGroup.add(mesh);
    };

    if (lastMove && lastMove.from && lastMove.to) {
      addSquarePad(lastMove.from, 0xd4af37, 0.25);
      addSquarePad(lastMove.to, 0xd4af37, 0.35);
    }

    if (selectedSquare) {
      addSquarePad(selectedSquare, 0xf59e0b, 0.5);
      addRingOverlay(selectedSquare, 0.42, 0.52, 0xfde68a, 0.95);
    }

    if (checkSquare) {
      addSquarePad(checkSquare, 0xdc2626, 0.58);
      addRingOverlay(checkSquare, 0.38, 0.53, 0xf87171, 0.96);
    }

    if (hintMove && hintMove.from && hintMove.to) {
      addRingOverlay(hintMove.from, 0.36, 0.49, 0x38bdf8, 0.92);
      addRingOverlay(hintMove.to, 0.36, 0.49, 0x38bdf8, 0.92);
    }

    this.applyOcclusionGhosting();
    for (const m of this.legalMovesList) {
      if (m.captured || m.flags === 'e') {
        addRingOverlay(m.to, 0.36, 0.51, 0xef4444, 0.92, 0.028);
      } else {
        const { x, z } = squareToWorld(m.to, this.squareSize);
        const dotGeo = new THREE.CircleGeometry(0.19, 24);
        const dotMat = new THREE.MeshBasicMaterial({
          color: 0xf3d067,
          transparent: true,
          opacity: 0.88,
          depthWrite: false
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.rotation.x = -Math.PI / 2;
        dot.position.set(x, 0.028, z);
        dot.userData = { square: m.to, isGroundSquare: true };
        this.overlaysGroup.add(dot);
      }
    }
  }

  /**
   * Renders 3D X-Ray Tactical Awareness Overlays (Attack Map, Vulnerable Beacons, King Zones, Motifs, and 3D Prediction Arrows)
   */
  updateXRayOverlays(xrayData, layerConfig = {}, predictionArrows = []) {
    if (!this.THREE || !this.xrayGroup) return;
    const THREE = this.THREE;

    while (this.xrayGroup.children.length > 0) {
      const child = this.xrayGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    if (!layerConfig.enabled || !xrayData) return;

    // Layer A: Attack Map Heatmap
    if (layerConfig.attackMap && xrayData.attackMap) {
      for (const [sqAlg, info] of Object.entries(xrayData.attackMap)) {
        if (info.control === 'neutral') continue;
        const { x, z } = squareToWorld(sqAlg, this.squareSize);
        let colorHex = 0xf59e0b; // contested amber
        let opacity = 0.22;
        if (info.control === 'white') {
          colorHex = 0x3b82f6; // sapphire blue for White control
          opacity = Math.min(0.42, 0.14 + info.whiteCount * 0.07);
        } else if (info.control === 'black') {
          colorHex = 0xe11d48; // crimson rose for Black control
          opacity = Math.min(0.42, 0.14 + info.blackCount * 0.07);
        }
        const geo = new THREE.PlaneGeometry(this.squareSize * 0.88, this.squareSize * 0.88);
        const mat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity,
          depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0.016, z);
        this.xrayGroup.add(mesh);
      }
    }

    // Layer B: Vulnerable & Overloaded Pieces
    if (layerConfig.vulnerable && xrayData.vulnerablePieces) {
      for (const vp of xrayData.vulnerablePieces) {
        const { x, z } = squareToWorld(vp.square, this.squareSize);
        const col = vp.severity === 'high' ? 0xef4444 : 0xf59e0b;
        const geo = new THREE.RingGeometry(0.41, 0.54, 24);
        const mat = new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.92,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.032, z);
        this.xrayGroup.add(ring);
      }
    }

    // Layer C: King Safety Zones & Candidate Checks
    if (layerConfig.kingSafety && xrayData.kingSafety) {
      for (const kz of xrayData.kingSafety.exposedKingZones) {
        const { x, z } = squareToWorld(kz.square, this.squareSize);
        const geo = new THREE.RingGeometry(0.32, 0.42, 6);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xdc2626,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
          depthWrite: false
        });
        const hex = new THREE.Mesh(geo, mat);
        hex.rotation.x = -Math.PI / 2;
        hex.position.set(x, 0.03, z);
        this.xrayGroup.add(hex);
      }
    }

    // Layer D: Pins, Forks, Skewers Ray Lines
    if (layerConfig.motifs && xrayData.motifs) {
      for (const motif of xrayData.motifs) {
        for (const tSq of motif.targetSquares || []) {
          this.add3DArrow(motif.attackerSquare, tSq, 0xa855f7, 0.055, 0.14);
        }
      }
    }

    // Layer E: Future Prediction Arrows (Best Move + Opponent Reply)
    if (layerConfig.prediction && Array.isArray(predictionArrows)) {
      for (const arr of predictionArrows) {
        if (arr && arr.from && arr.to) {
          this.add3DArrow(
            arr.from,
            arr.to,
            arr.colorHex || 0xd4af37,
            arr.width || 0.09,
            arr.yOffset || 0.18
          );
        }
      }
    }
  }

  add3DArrow(fromSq, toSq, colorHex = 0xd4af37, shaftRadius = 0.08, yHeight = 0.16) {
    const THREE = this.THREE;
    const p1 = squareToWorld(fromSq, this.squareSize);
    const p2 = squareToWorld(toSq, this.squareSize);
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const totalLen = Math.hypot(dx, dz);
    if (totalLen < 0.1) return;

    const headLen = Math.min(0.36, totalLen * 0.35);
    const shaftLen = Math.max(0.05, totalLen - headLen);
    const angle = Math.atan2(dx, dz);

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.86,
      depthWrite: false
    });

    const shaftGeo = new THREE.CylinderGeometry(shaftRadius * 0.55, shaftRadius * 0.55, shaftLen, 12);
    const shaftMesh = new THREE.Mesh(shaftGeo, mat);
    shaftMesh.rotation.x = Math.PI / 2;
    shaftMesh.rotation.z = -angle;
    shaftMesh.position.set(
      p1.x + (dx * (shaftLen * 0.5)) / totalLen,
      yHeight,
      p1.z + (dz * (shaftLen * 0.5)) / totalLen
    );
    this.xrayGroup.add(shaftMesh);

    const headGeo = new THREE.ConeGeometry(shaftRadius * 1.45, headLen, 14);
    const headMesh = new THREE.Mesh(headGeo, mat);
    headMesh.rotation.x = Math.PI / 2;
    headMesh.rotation.z = -angle;
    headMesh.position.set(
      p1.x + (dx * (shaftLen + headLen * 0.5)) / totalLen,
      yHeight,
      p1.z + (dz * (shaftLen + headLen * 0.5)) / totalLen
    );
    this.xrayGroup.add(headMesh);
  }


  setBoardTheme(themeId = 'cathedral') {
    if (!this.THREE || !this.materials) return;
    if (themeId === 'imperial') {
      this.materials.whitePiece.color.setHex(0xfff9eb);
      this.materials.whiteAccent.color.setHex(0xe8a598);
      this.materials.blackPiece.color.setHex(0x4a1c2a);
      this.materials.blackAccent.color.setHex(0xfcd34d);
      this.materials.lightSquare.color.setHex(0xe8dccb);
      this.materials.darkSquare.color.setHex(0x361923);
    } else if (themeId === 'arcane') {
      this.materials.whitePiece.color.setHex(0xf1f5f9);
      this.materials.whiteAccent.color.setHex(0x38bdf8);
      this.materials.blackPiece.color.setHex(0x133832);
      this.materials.blackAccent.color.setHex(0x6ee7b7);
      this.materials.lightSquare.color.setHex(0xdbe4ee);
      this.materials.darkSquare.color.setHex(0x162e2b);
    } else {
      this.materials.whitePiece.color.setHex(0xfbf8f1);
      this.materials.whiteAccent.color.setHex(0xe5c158);
      this.materials.blackPiece.color.setHex(0x323c59);
      this.materials.blackAccent.color.setHex(0xe2e8f0);
      this.materials.lightSquare.color.setHex(0xe2d9c8);
      this.materials.darkSquare.color.setHex(0x222634);
    }
  }

  /**
   * Dynamic Occlusion Ghosting: fades any piece standing directly in front of a legal
   * destination square (relative to camera orientation) so the destination ring is never hidden.
   */
  applyOcclusionGhosting() {
    if (!this.THREE || !this.pieceMeshes) return;
    // Restore all pieces to opaque shared materials first
    for (const [, pGroup] of this.pieceMeshes.entries()) {
      if (pGroup.userData && pGroup.userData.isGhosted) {
        const col = pGroup.userData.color;
        const origMain = col === 'w' ? this.materials.whitePiece : this.materials.blackPiece;
        pGroup.traverse(ch => {
          if (ch.isMesh && ch.userData && ch.userData.wasGhostedMesh) {
            if (ch.material && ch.material !== origMain) ch.material.dispose();
            ch.material = origMain;
            ch.userData.wasGhostedMesh = false;
          }
        });
        pGroup.userData.isGhosted = false;
      }
    }

    if (!this.selectedSquare || !this.legalMovesList || this.legalMovesList.length === 0) return;

    // Camera looks from +z (rank 1) toward -z (rank 8) when not flipped, or -z toward +z when flipped.
    // A piece on (file, rank + 1) when not flipped (closer to rank 1) can visually overlap a legal target on (file, rank).
    const rankStep = this.boardFlipped ? 1 : -1;
    const occludingSquares = new Set();

    for (const m of this.legalMovesList) {
      if (!m.to || m.to.length !== 2) continue;
      const fChar = m.to[0];
      const rNum = parseInt(m.to[1], 10);
      const frontRank = rNum + rankStep;
      if (frontRank >= 1 && frontRank <= 8) {
        const frontSq = fChar + String(frontRank);
        if (frontSq !== this.selectedSquare) {
          occludingSquares.add(frontSq);
        }
      }
    }

    for (const sq of occludingSquares) {
      const pGroup = this.pieceMeshes.get(sq);
      if (pGroup && pGroup.userData) {
        const col = pGroup.userData.color;
        const baseMat = col === 'w' ? this.materials.whitePiece : this.materials.blackPiece;
        const ghostMat = baseMat.clone();
        ghostMat.transparent = true;
        ghostMat.opacity = 0.36;
        pGroup.traverse(ch => {
          if (ch.isMesh && ch.material === baseMat) {
            ch.material = ghostMat;
            ch.userData.wasGhostedMesh = true;
          }
        });
        pGroup.userData.isGhosted = true;
      }
    }
  }

  setFlipped(flipped) {
    this.boardFlipped = Boolean(flipped);
    this.camSpherical.targetTheta = this.boardFlipped ? Math.PI : 0;
    this.rebuildCoordinates();
  }

  setCameraPreset(preset) {
    const baseTheta = this.boardFlipped ? Math.PI : 0;
    if (preset === 'overhead') {
      this.camSpherical.targetTheta = baseTheta;
      this.camSpherical.targetPhi = 0.22;
      this.camSpherical.targetRadius = 12.2;
    } else if (preset === 'strategic') {
      this.camSpherical.targetTheta = baseTheta;
      this.camSpherical.targetPhi = 0.62;
      this.camSpherical.targetRadius = 11.8;
    } else if (preset === 'cinematic') {
      this.camSpherical.targetTheta = baseTheta + 0.42;
      this.camSpherical.targetPhi = 0.96;
      this.camSpherical.targetRadius = 13.6;
    } else {
      // Standard high-clarity sanctuary angle
      this.camSpherical.targetTheta = baseTheta;
      this.camSpherical.targetPhi = 0.82;
      this.camSpherical.targetRadius = 12.4;
    }
  }

  zoomCamera(deltaRadius) {
    this.camSpherical.targetRadius = Math.max(
      7.2,
      Math.min(19.5, this.camSpherical.targetRadius + deltaRadius)
    );
  }

  setVisualSettings({
    animationsEnabled,
    reducedMotion,
    showCoordinates,
    quality,
    highVisibility,
    brightness,
    boardLight
  }) {
    if (typeof animationsEnabled === 'boolean') this.animationsEnabled = animationsEnabled;
    if (typeof reducedMotion === 'boolean') this.reducedMotion = reducedMotion;
    if (typeof showCoordinates === 'boolean' && showCoordinates !== this.showCoordinates) {
      this.showCoordinates = showCoordinates;
      this.rebuildCoordinates();
    }
    if (quality && quality !== this.quality) {
      this.quality = quality;
    }
    if (typeof highVisibility === 'boolean') {
      this.highVisibility = highVisibility;
    }
    if (typeof brightness === 'number') {
      this.brightness = brightness;
    }
    if (typeof boardLight === 'number') {
      this.boardLightLevel = boardLight;
    }

    // Apply lighting and high-visibility adjustments immediately
    if (this.scene && this.THREE) {
      const hv = this.highVisibility;
      const bScale = (this.brightness || 1.15) * (hv ? 1.25 : 1.0);
      const lScale = (this.boardLightLevel || 1.35) * (hv ? 1.25 : 1.0);

      if (this.ambientLight) this.ambientLight.intensity = 0.88 * bScale;
      if (this.hemiLight) this.hemiLight.intensity = 0.78 * bScale;
      if (this.keyLight) this.keyLight.intensity = 1.52 * lScale;
      if (this.frontFillLight) this.frontFillLight.intensity = 0.92 * lScale;
      if (this.rimBlueLight) this.rimBlueLight.intensity = 0.95 * bScale;

      if (this.scene.fog) {
        this.scene.fog.density = hv ? 0.002 : 0.011;
      }
      if (this.dustPoints) {
        this.dustPoints.visible = !hv && this.quality !== 'low' && !this.reducedMotion;
      }
      for (const s of this.lightShafts) {
        s.visible = !hv && this.quality !== 'low';
      }
    }
  }

  bindEvents() {
    const dom = this.renderer.domElement;

    dom.addEventListener('pointerdown', e => {
      this.isDragging = true;
      this.dragMoved = false;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('pointermove', e => {
      if (this.isDragging) {
        const dx = e.clientX - this.pointerDownPos.x;
        const dy = e.clientY - this.pointerDownPos.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          this.dragMoved = true;
          this.camSpherical.targetTheta -= dx * 0.0065;
          this.camSpherical.targetPhi = Math.max(
            0.22,
            Math.min(1.28, this.camSpherical.targetPhi - dy * 0.0055)
          );
          this.pointerDownPos = { x: e.clientX, y: e.clientY };
        }
      } else if (e.target === dom) {
        this.handlePointerHover(e);
      }
    });

    window.addEventListener('pointerup', e => {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (!this.dragMoved && e.target === dom) {
        this.handleBoardPick(e);
      }
    });

    dom.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        this.zoomCamera(e.deltaY * 0.008);
      },
      { passive: false }
    );

    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = Math.max(280, this.container.clientWidth);
    const h = Math.max(280, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Projects pointer onto the ground board squares to show magnetic hover reticle
   * and trigger X-Ray square inspection.
   */
  handlePointerHover(event) {
    if (!this.renderer || !this.camera || !this.squaresGroup) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const groundHits = this.raycaster.intersectObjects(this.squaresGroup.children, false);
    if (groundHits.length > 0) {
      const sq = groundHits[0].object.userData.square;
      if (sq) {
        const { x, z } = squareToWorld(sq, this.squareSize);
        this.hoverReticle.position.set(x, 0.026, z);
        this.hoverReticle.visible = true;
        if (this.hoveredSquare !== sq) {
          this.hoveredSquare = sq;
          this.onSquareHover(sq);
        }
        return;
      }
    }
    this.hoverReticle.visible = false;
  }

  /**
   * OCCLUSION-FREE TWO-STAGE BOARD PICKING:
   * Stage 1: If a piece is currently selected (`this.selectedSquare`), raycast against the
   *          ground board plane (`this.squaresGroup` + `this.overlaysGroup`) FIRST.
   *          If the ground square under the cursor is a legal destination square for the
   *          selected piece, immediately commit that destination square — tall piece meshes
   *          in front can NEVER block a legal move!
   * Stage 2: Otherwise, check both ground squares and piece meshes to select a piece.
   */
  handleBoardPick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Stage 1: Priority Ground-Plane check for legal destination squares
    if (this.selectedSquare && this.legalMovesList.length > 0) {
      const groundTargets = [
        ...this.squaresGroup.children,
        ...this.overlaysGroup.children
      ];
      const groundHits = this.raycaster.intersectObjects(groundTargets, false);
      if (groundHits.length > 0) {
        const groundSq = groundHits[0].object.userData && groundHits[0].object.userData.square;
        if (groundSq && this.legalMovesList.some(m => m.to === groundSq)) {
          this.onSquareClick(groundSq);
          return;
        }
      }
    }

    // Stage 2: General piece or square selection (preferring ground square when clicked directly)
    const groundHits = this.raycaster.intersectObjects(this.squaresGroup.children, false);
    const pieceHits = this.raycaster.intersectObjects(this.piecesGroup.children, true);

    if (pieceHits.length > 0) {
      let obj = pieceHits[0].object;
      while (obj && (!obj.userData || !obj.userData.square)) {
        obj = obj.parent;
      }
      if (obj && obj.userData && obj.userData.square) {
        const pieceSq = obj.userData.square;
        // If groundHits hit a legal move square behind this piece, prefer the legal move square
        if (groundHits.length > 0) {
          const gSq = groundHits[0].object.userData.square;
          if (gSq && this.legalMovesList.some(m => m.to === gSq)) {
            this.onSquareClick(gSq);
            return;
          }
        }
        this.onSquareClick(pieceSq);
        return;
      }
    }

    if (groundHits.length > 0) {
      const sq = groundHits[0].object.userData.square;
      if (sq) this.onSquareClick(sq);
    }
  }

  animate() {
    this.rafId = requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const dt = 0.016;

    const lerpFactor = this.reducedMotion ? 1.0 : 0.12;
    this.camSpherical.theta += (this.camSpherical.targetTheta - this.camSpherical.theta) * lerpFactor;
    this.camSpherical.phi += (this.camSpherical.targetPhi - this.camSpherical.phi) * lerpFactor;
    this.camSpherical.radius += (this.camSpherical.targetRadius - this.camSpherical.radius) * lerpFactor;

    const r = this.camSpherical.radius;
    const phi = this.camSpherical.phi;
    const theta = this.camSpherical.theta;

    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.002 && !this.reducedMotion) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= 0.85;
    } else {
      this.shakeIntensity = 0;
    }

    this.camera.position.set(
      r * Math.sin(phi) * Math.sin(theta) + shakeX,
      r * Math.cos(phi) + shakeY,
      r * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(0, this.camSpherical.lookAtY, 0);

    if (this.selectedSquare && !this.reducedMotion) {
      const selMesh = this.pieceMeshes.get(this.selectedSquare);
      if (selMesh && this.activeAnimations.length === 0) {
        selMesh.position.y = 0.14 + Math.sin(now * 0.0055) * 0.05;
      }
    }

    for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
      const anim = this.activeAnimations[i];
      const t = Math.min(1, (now - anim.startTime) / anim.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      anim.mesh.position.x = anim.startX + (anim.endX - anim.startX) * ease;
      anim.mesh.position.z = anim.startZ + (anim.endZ - anim.startZ) * ease;
      anim.mesh.position.y = Math.sin(t * Math.PI) * anim.arcHeight;
      if (t >= 1) {
        anim.mesh.position.set(anim.endX, 0, anim.endZ);
        this.activeAnimations.splice(i, 1);
      }
    }

    for (let i = this.shatterParticles.length - 1; i >= 0; i--) {
      const p = this.shatterParticles[i];
      const age = now - p.startTime;
      if (age >= p.lifetime) {
        this.scene.remove(p.group);
        for (const s of p.shards) s.geo.dispose();
        p.mat.dispose();
        this.shatterParticles.splice(i, 1);
        continue;
      }
      p.mat.opacity = 1 - age / p.lifetime;
      for (const s of p.shards) {
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.vy -= 9.2 * dt;
        if (s.mesh.position.y < 0.05) {
          s.mesh.position.y = 0.05;
          s.vy = Math.abs(s.vy) * 0.35;
        }
        s.mesh.rotation.x += s.rx * dt;
        s.mesh.rotation.y += s.ry * dt;
      }
    }

    if (this.impactLight.intensity > 0.01) {
      this.impactLight.intensity *= 0.88;
    } else {
      this.impactLight.intensity = 0;
    }

    if (this.dustPoints && this.dustPoints.visible && !this.reducedMotion) {
      this.dustPoints.rotation.y = now * 0.00004;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.clearShatterEffects();
    if (this.sharedGeometries) {
      for (const g of Object.values(this.sharedGeometries)) {
        if (g && g.dispose) g.dispose();
      }
    }
    if (this.renderer) this.renderer.dispose();
  }
}
