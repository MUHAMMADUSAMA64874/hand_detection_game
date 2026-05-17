import { FaceDetector, FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import "./styles.css";

let WIDTH = 1280;
let HEIGHT = 720;
const GAME_SECONDS = 60;
const START_LIVES = 3;
const GRAVITY = 0.42;
const OBJECT_RADIUS = 34;
const OBJECT_SCALE = 0.66;
const SWIPE_RADIUS = 62;
const TRAIL_LENGTH = 50;
const POINTER_DEAD_ZONE = 9;
const SPAWN_INTERVAL_MS = 310;
const MIN_SPAWN_INTERVAL_MS = 190;
const COMMAND_HOLD_MS = 520;
const COMMAND_COOLDOWN_MS = 1300;
const SURPRISE_SIZE = 220;
const START_COUNTDOWN_MS = 3000;
const PALM_MIN_SIZE = 170;
const PALM_MAX_SIZE = 390;
const FRUITS = ["apple", "orange", "watermelon"];
const FRUIT_POINTS = {
  apple: 10,
  orange: 20,
  watermelon: 30,
};

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const video = document.querySelector("#camera");
const panel = document.querySelector("#permission-panel");
const startButton = document.querySelector("#start-button");
const continueButton = document.querySelector("#continue-button");
const statusLabel = document.querySelector("#status");
const playsCountLabel = document.querySelector("#plays-count");

function isMobilePortrait() {
  return window.innerWidth <= 760 || window.innerHeight > window.innerWidth;
}

function configureCanvasSize() {
  if (isMobilePortrait()) {
    WIDTH = 720;
    HEIGHT = 1280;
  } else {
    WIDTH = 1280;
    HEIGHT = 720;
  }
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
}

const assetNames = {
  background: "background.png",
  bomb: "bomb.png",
  apple: "fruit_apple.png",
  appleLeft: "fruit_apple_left.png",
  appleRight: "fruit_apple_right.png",
  orange: "svg/fruit_orange.svg",
  orangeLeft: "fruit_orange_left.png",
  orangeRight: "fruit_orange_right.png",
  watermelon: "fruit_watermelon.png",
  watermelonLeft: "fruit_watermelon_left.png",
  watermelonRight: "fruit_watermelon_right.png",
};

const soundNames = {
  music: "mixkit-game-level-music-689.wav",
  start: "success.wav",
  slice: "slice.mp3",
  bomb: "bomb.mp3",
  score: "score.wav",
  fail: "fail.mp3",
};

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load asset: ${name}`));
    image.src = `/assets/${name}`;
  });
}

async function loadAssets() {
  const entries = await Promise.all(
    Object.entries(assetNames).map(async ([key, name]) => [key, await loadImage(name)]),
  );
  return Object.fromEntries(entries);
}

function makeSounds() {
  return Object.fromEntries(
    Object.entries(soundNames).map(([key, name]) => {
      const audio = new Audio(`/assets/${name}`);
      audio.preload = "auto";
      audio.loop = key === "music";
      audio.volume = key === "music" ? 0.16 : key === "bomb" ? 0.72 : 0.48;
      return [key, audio];
    }),
  );
}

async function unlockSounds(sounds) {
  await Promise.allSettled(
    Object.values(sounds).map(async (sound) => {
      const previousMuted = sound.muted;
      sound.muted = true;
      try {
        await sound.play();
        sound.pause();
        sound.currentTime = 0;
      } finally {
        sound.muted = previousMuted;
      }
    }),
  );
}

function playSound(sounds, key) {
  const sound = sounds[key];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function playMusic(sounds) {
  const music = sounds.music;
  if (!music || !music.paused) return;
  music.currentTime = 0;
  music.play().catch(() => {});
}

function stopMusic(sounds) {
  const music = sounds.music;
  if (!music) return;
  music.pause();
  music.currentTime = 0;
}

function getLocalPlayCount() {
  return Number.parseInt(localStorage.getItem("handFocusPlayCount") || "0", 10);
}

function setLocalPlayCount(count) {
  localStorage.setItem("handFocusPlayCount", String(count));
  if (playsCountLabel) playsCountLabel.textContent = `${count}`;
}

function stopCamera() {
  const stream = video.srcObject;
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  video.srcObject = null;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

class Particle {
  constructor(x, y, vx, vy, life, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.color = color;
    this.age = 0;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += GRAVITY * 0.5;
    this.age += 1;
  }

  draw(target) {
    if (this.age >= this.life) return;
    const alpha = 1 - this.age / this.life;
    target.save();
    target.globalAlpha = alpha;
    target.fillStyle = this.color;
    target.beginPath();
    target.arc(this.x, this.y, Math.max(1, 5 * alpha), 0, Math.PI * 2);
    target.fill();
    target.restore();
  }

  get dead() {
    return this.age >= this.life;
  }
}

class FlyingObject {
  constructor(kind, assets) {
    this.kind = kind;
    this.assets = assets;
    const mobile = isMobilePortrait();
    this.x = rand(mobile ? 70 : 100, WIDTH - (mobile ? 70 : 100));
    this.y = HEIGHT + (mobile ? 38 : 52);
    this.vx = rand(mobile ? -5 : -4, mobile ? 5 : 4);
    this.vy = mobile ? rand(-38, -30) : rand(-20, -15);
    this.rot = rand(-0.09, 0.09);
    this.angle = rand(-0.4, 0.4);
    this.splitAngle = 0;
    this.splitRot = rand(-0.11, 0.11);
    this.state = "whole";
    this.parts = [];
    this.left = { x: this.x, y: this.y };
    this.right = { x: this.x, y: this.y };
    this.lvx = this.vx - rand(2, 4);
    this.rvx = this.vx + rand(2, 4);
    this.lvy = this.vy + rand(-1, 1);
    this.rvy = this.vy + rand(-1, 1);
  }

  get sprite() {
    return this.kind === "bomb" ? this.assets.bomb : this.assets[this.kind];
  }

  update() {
    if (this.state === "whole") {
      this.x += this.vx;
      this.y += this.vy;
      this.vy += GRAVITY;
      this.angle += this.rot;
      if (this.x < OBJECT_RADIUS || this.x > WIDTH - OBJECT_RADIUS) this.vx *= -0.8;
      if (this.y - OBJECT_RADIUS > HEIGHT) this.state = "dead";
    }

    if (this.state === "split") {
      this.left.x += this.lvx;
      this.left.y += this.lvy;
      this.right.x += this.rvx;
      this.right.y += this.rvy;
      this.lvy += GRAVITY;
      this.rvy += GRAVITY;
      this.splitAngle += this.splitRot;
      if (this.left.y > HEIGHT + 100 && this.right.y > HEIGHT + 100) this.state = "dead";
    }

    this.parts = this.parts.filter((particle) => {
      particle.update();
      return !particle.dead;
    });
  }

  hit(points) {
    return this.state === "whole" && points.some((point) => Math.hypot(this.x - point.x, this.y - point.y) < SWIPE_RADIUS);
  }

  slice() {
    if (this.state !== "whole") return false;
    this.state = "split";
    this.left = { x: this.x - 6, y: this.y };
    this.right = { x: this.x + 6, y: this.y };
    const colors = {
      apple: "#ff4f65",
      orange: "#ffb23e",
      watermelon: "#66ec88",
      bomb: "#ff733c",
    };
    const count = this.kind === "bomb" ? 24 : 16;
    const life = this.kind === "bomb" ? 55 : 30;
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(2, 7);
      this.parts.push(new Particle(this.x, this.y, Math.cos(angle) * speed, Math.sin(angle) * speed, life, colors[this.kind]));
    }
    return true;
  }

  drawSprite(target, image, center, angle, scale = 1) {
    target.save();
    target.translate(center.x, center.y);
    target.rotate(angle);
    target.drawImage(image, (-image.width * scale) / 2, (-image.height * scale) / 2, image.width * scale, image.height * scale);
    target.restore();
  }

  draw(target) {
    if (this.state === "whole") {
      this.drawSprite(target, this.sprite, { x: this.x, y: this.y }, this.angle, OBJECT_SCALE);
    }

    if (this.state === "split" && this.kind !== "bomb") {
      this.drawSprite(target, this.assets[`${this.kind}Left`], this.left, this.splitAngle, OBJECT_SCALE);
      this.drawSprite(target, this.assets[`${this.kind}Right`], this.right, -this.splitAngle, OBJECT_SCALE);
    }

    for (const particle of this.parts) particle.draw(target);
  }
}

class Game {
  constructor(assets, sounds) {
    this.assets = assets;
    this.sounds = sounds;
    this.level = 1;
    this.lastCommandAt = -Infinity;
    this.pendingCommand = null;
    this.pendingSince = 0;
    this.prepareToStart();
  }

  resetState() {
    this.score = 0;
    this.lives = START_LIVES;
    this.objects = [];
    this.trail = [];
    this.pointer = null;
    this.lastRaw = null;
    this.lastSpawn = 0;
    this.gameOver = false;
    this.finalized = false;
    this.pendingCommand = null;
    this.pendingSince = 0;
    this.countdownStartedAt = null;
    this.countdownValue = null;
  }

  prepareToStart() {
    stopMusic(this.sounds);
    this.resetState();
    this.waitingToStart = true;
    this.startTime = null;
  }

  startRound(now) {
    this.resetState();
    this.waitingToStart = false;
    this.startTime = now;
    this.lastSpawn = now;
    playSound(this.sounds, "start");
    playMusic(this.sounds);
  }

  get spawnInterval() {
    return Math.max(MIN_SPAWN_INTERVAL_MS, SPAWN_INTERVAL_MS - (this.level - 1) * 28);
  }

  restartLevel(now) {
    this.startRound(now);
  }

  applyGesture(gesture, now) {
    if (!gesture || gesture === "slice") {
      this.pendingCommand = null;
      this.pendingSince = 0;
      return null;
    }

    if (this.pendingCommand !== gesture) {
      this.pendingCommand = gesture;
      this.pendingSince = now;
      return gesture;
    }

    if (now - this.lastCommandAt < COMMAND_COOLDOWN_MS || now - this.pendingSince < COMMAND_HOLD_MS) {
      return gesture;
    }

    this.lastCommandAt = now;
    this.pendingCommand = null;
    this.pendingSince = 0;
    return gesture;
  }

  updatePointer(raw, now) {
    if (!raw) {
      this.pointer = null;
      this.lastRaw = null;
      return null;
    }

    if (!this.pointer) {
      this.pointer = { ...raw };
      this.lastRaw = { ...raw };
      this.lastPointerAt = now;
      return this.pointer;
    }

    const travel = distance(raw, this.lastRaw);
    const deadZone = isMobilePortrait() ? 3 : POINTER_DEAD_ZONE;
    if (travel < deadZone) return this.pointer;
    const alpha = isMobilePortrait()
      ? travel > 80
        ? 0.94
        : travel > 22
          ? 0.82
          : 0.62
      : travel > 120
        ? 0.92
        : travel > 42
          ? 0.74
          : 0.38;
    this.pointer = {
      x: this.pointer.x * (1 - alpha) + raw.x * alpha,
      y: this.pointer.y * (1 - alpha) + raw.y * alpha,
    };
    this.lastRaw = { ...raw };
    return this.pointer;
  }

  appendSwipe(point) {
    if (!point) return;
    const prev = this.trail.at(-1);
    if (!prev) {
      this.trail.push({ ...point });
      return;
    }
    const dx = point.x - prev.x;
    const dy = point.y - prev.y;
    const steps = Math.max(1, Math.floor(Math.max(Math.abs(dx), Math.abs(dy)) / 10));
    for (let s = 1; s <= steps; s += 1) {
      this.trail.push({ x: prev.x + (dx * s) / steps, y: prev.y + (dy * s) / steps });
    }
    if (this.trail.length > TRAIL_LENGTH) this.trail.splice(0, this.trail.length - TRAIL_LENGTH);
  }

  update(rawPoint, gesture, now, handBox) {
    const commandGesture = this.applyGesture(gesture, now);
    const point = this.updatePointer(rawPoint, now);
    if (this.waitingToStart) {
      this.trail.length = 0;
      const canCountDown = gesture === "restart" && handBox?.distanceState === "good";
      if (!canCountDown) {
        this.countdownStartedAt = null;
        this.countdownValue = null;
        return GAME_SECONDS;
      }
      if (this.countdownStartedAt === null) this.countdownStartedAt = now;
      const elapsed = now - this.countdownStartedAt;
      this.countdownValue = Math.max(1, 3 - Math.floor(elapsed / 1000));
      if (elapsed >= START_COUNTDOWN_MS) {
        this.startRound(now);
      }
      return GAME_SECONDS;
    }

    const canSlice = !commandGesture || commandGesture === "slice";
    if (point && !this.gameOver && canSlice) this.appendSwipe(point);
    if (!point) this.trail.length = 0;
    if (!canSlice) this.trail.length = 0;

    const timeLeft = Math.max(0, GAME_SECONDS - Math.floor((now - this.startTime) / 1000));
    if (!this.gameOver) {
      if (now - this.lastSpawn > this.spawnInterval) {
        const isBomb = Math.random() < 0.14 + this.level * 0.025;
        this.objects.push(new FlyingObject(isBomb ? "bomb" : FRUITS[Math.floor(Math.random() * FRUITS.length)], this.assets));
        this.lastSpawn = now;
      }

      const recent = this.trail.slice(-16);
      for (const object of this.objects) {
        object.update();
        if (recent.length && object.hit(recent) && object.slice()) {
          if (object.kind === "bomb") {
            this.lives = Math.max(0, this.lives - 1);
            playSound(this.sounds, "bomb");
          } else {
            this.score += FRUIT_POINTS[object.kind] ?? 10;
            playSound(this.sounds, "slice");
            playSound(this.sounds, "score");
          }
        }
      }

      if (timeLeft === 0 || this.lives <= 0) {
        this.gameOver = true;
        stopMusic(this.sounds);
        playSound(this.sounds, "fail");
      }
    } else {
      for (const object of this.objects) object.update();
    }

    this.objects = this.objects.filter((object) => object.state !== "dead" || object.parts.length > 0);
    return timeLeft;
  }
}

function drawMirroredVideo() {
  if (!video.srcObject || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    ctx.fillStyle = "#020405";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }
  ctx.save();
  ctx.translate(WIDTH, 0);
  ctx.scale(-1, 1);
  ctx.filter = "saturate(1.08) contrast(1.04)";
  ctx.drawImage(video, 0, 0, WIDTH, HEIGHT);
  ctx.restore();
  ctx.filter = "none";
}

function drawBackground(assets) {
  ctx.drawImage(assets.background, 0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawSensorOnlyStage() {
  ctx.fillStyle = "#020305";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawHandLandmarks(landmarks, distanceState = "good") {
  if (!landmarks) return;
  ctx.save();
  const mobile = isMobilePortrait();
  const good = distanceState === "good";
  ctx.strokeStyle = good ? "rgba(110, 255, 180, 0.92)" : "rgba(255, 95, 99, 0.94)";
  ctx.fillStyle = good ? "#fff7a6" : "#ffb0b2";
  ctx.shadowColor = good ? "rgba(110, 255, 180, 0.42)" : "rgba(255, 95, 99, 0.48)";
  ctx.shadowBlur = mobile ? 5 : 8;
  ctx.lineWidth = mobile ? 2 : 3;
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [5, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [9, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [13, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [0, 17],
  ];
  for (const [start, end] of connections) {
    const a = landmarks[start];
    const b = landmarks[end];
    ctx.beginPath();
    ctx.moveTo((1 - a.x) * WIDTH, a.y * HEIGHT);
    ctx.lineTo((1 - b.x) * WIDTH, b.y * HEIGHT);
    ctx.stroke();
  }
  for (const landmark of landmarks) {
    ctx.beginPath();
    ctx.arc((1 - landmark.x) * WIDTH, landmark.y * HEIGHT, mobile ? 2.8 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function handBoxFromLandmarks(landmarks) {
  if (!landmarks) return null;
  const xs = landmarks.map((landmark) => (1 - landmark.x) * WIDTH);
  const ys = landmarks.map((landmark) => landmark.y * HEIGHT);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  const size = Math.max(width, height);
  return {
    x: minX,
    y: minY,
    width,
    height,
    size,
    distanceState: size > PALM_MAX_SIZE ? "too-close" : size < PALM_MIN_SIZE ? "too-far" : "good",
  };
}

function drawStartCalibration(game, handBox, gesture) {
  ctx.save();
  const mobile = isMobilePortrait();
  const hasPalm = gesture === "restart";
  const state = hasPalm ? handBox?.distanceState : null;
  const good = state === "good";
  const tooClose = state === "too-close";
  const color = good ? "#73ff95" : "#ff5f63";
  const label = good
    ? `Starting in ${game.countdownValue ?? 3}`
    : !hasPalm
    ? "Show an open palm"
    : tooClose
      ? "Move your hand back"
      : state === "too-far"
        ? "Move your hand closer"
        : "Distance ready";

  if (handBox) {
    const pad = mobile ? 12 : 26;
    const displayWidth = mobile ? Math.min(handBox.width, 250) : handBox.width;
    const displayHeight = mobile ? Math.min(handBox.height, 360) : handBox.height;
    const displayX = handBox.x + handBox.width / 2 - displayWidth / 2;
    const displayY = handBox.y + handBox.height / 2 - displayHeight / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = mobile ? 5 : 8;
    ctx.shadowColor = color;
    ctx.shadowBlur = mobile ? 10 : 18;
    ctx.beginPath();
    ctx.roundRect(displayX - pad, displayY - pad, displayWidth + pad * 2, displayHeight + pad * 2, mobile ? 18 : 24);
    ctx.stroke();
  }

  const panelWidth = mobile ? WIDTH - 80 : 500;
  const panelHeight = mobile ? 96 : 76;
  const panelX = WIDTH / 2 - panelWidth / 2;
  const panelY = mobile ? HEIGHT - 190 : HEIGHT - 148;
  ctx.fillStyle = good ? "rgba(18, 90, 50, 0.82)" : "rgba(105, 18, 24, 0.84)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 14);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${mobile ? 32 : 28}px Inter, system-ui, sans-serif`;
  ctx.fillText(label, WIDTH / 2, panelY + (mobile ? 42 : 34));
  ctx.fillStyle = "rgba(255, 255, 255, 0.74)";
  ctx.font = `700 ${mobile ? 18 : 16}px Inter, system-ui, sans-serif`;
  ctx.fillText(good ? "Hold steady until the round starts" : "Keep your palm in the green distance zone", WIDTH / 2, panelY + (mobile ? 70 : 58));
  ctx.restore();
}

function drawTrail(trail, pointer) {
  if (trail.length > 1) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < trail.length - 1; i += 1) {
      const alpha = i / trail.length;
      ctx.strokeStyle = `rgba(255, 239, 97, ${0.1 + alpha * 0.9})`;
      ctx.lineWidth = 2 + alpha * 7;
      ctx.beginPath();
      ctx.moveTo(trail[i].x, trail[i].y);
      ctx.lineTo(trail[i + 1].x, trail[i + 1].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (pointer) {
    ctx.save();
    ctx.shadowColor = "rgba(255, 233, 95, 0.72)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(255, 233, 95, 0.22)";
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe95f";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawHud(game, timeLeft, playCount) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  const mobile = isMobilePortrait();
  const hudHeight = mobile ? 96 : 76;
  ctx.fillRect(0, 0, WIDTH, hudHeight);
  ctx.font = `700 ${mobile ? 22 : 30}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#73ff95";
  ctx.fillText(`SCORE: ${game.score}`, mobile ? 18 : 24, mobile ? 38 : 50);
  ctx.fillStyle = "#8fb3ff";
  ctx.textAlign = "center";
  ctx.fillText(`LIVES: ${game.lives}`, WIDTH / 2, mobile ? 38 : 50);
  ctx.fillStyle = "#ffe66a";
  ctx.textAlign = "right";
  ctx.fillText(`TIME: ${timeLeft}s`, WIDTH - (mobile ? 18 : 24), mobile ? 38 : 50);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `700 ${mobile ? 16 : 20}px Inter, system-ui, sans-serif`;
  ctx.fillText(`PLAYS ON THIS DEVICE: ${playCount}`, WIDTH - (mobile ? 18 : 24), mobile ? 76 : 104);
  ctx.font = `600 ${mobile ? 17 : 22}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.textAlign = "left";
  ctx.fillText(game.waitingToStart ? "Show an open palm to start." : "Index finger slices fruit.", mobile ? 18 : 24, HEIGHT - (mobile ? 26 : 24));
  ctx.restore();
}

function drawIntro(game) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const mobile = isMobilePortrait();
  const x = mobile ? 36 : 72;
  const y = mobile ? 170 : 138;
  ctx.fillStyle = "#67ffad";
  ctx.font = `800 ${mobile ? 42 : 40}px Inter, system-ui, sans-serif`;
  ctx.fillText("GET READY", x, y);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${mobile ? 24 : 24}px Inter, system-ui, sans-serif`;
  ctx.fillText("Hold an open palm inside the green box.", x, y + 58);
  ctx.fillText("Green starts the countdown automatically.", x, y + 104);
  ctx.fillStyle = "#ffe66a";
  ctx.fillText("Use one index finger to slice fruit.", x, y + 162);
  ctx.restore();
}

function drawSurprisePortrait(snapshot, x, y, size) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
  ctx.shadowBlur = 28;
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.strokeStyle = "rgba(115, 255, 149, 0.82)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, 22);
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  if (snapshot) {
    ctx.drawImage(snapshot, x, y, size, size);
  } else {
    ctx.fillStyle = "#091015";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.font = "700 22px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("NO FACE", x + size / 2, y + size / 2 - 8);
    ctx.fillText("FOUND", x + size / 2, y + size / 2 + 24);
  }
  ctx.restore();
}

function drawWrappedText(text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = word;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, currentY);
  return currentY + lineHeight;
}

function drawGameOver(game, surpriseSnapshot) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.84)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const narrow = window.innerWidth <= 760 || window.innerHeight > window.innerWidth;
  if (narrow) {
    const gap = 24;
    const marginX = 24;
    const top = 74;
    const panelHeight = 560;
    const panelWidth = (WIDTH - marginX * 2 - gap) / 2;
    const left = { x: marginX, y: top, width: panelWidth, height: panelHeight };
    const right = { x: marginX + panelWidth + gap, y: top, width: panelWidth, height: panelHeight };
    for (const panel of [left, right]) {
      ctx.fillStyle = "rgba(8, 14, 18, 0.9)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 18);
      ctx.fill();
      ctx.stroke();
    }

    ctx.textAlign = "left";
    ctx.fillStyle = "#73ff95";
    ctx.font = "900 34px Inter, system-ui, sans-serif";
    ctx.fillText("ROUND OVER", left.x + 20, left.y + 54);
    ctx.fillStyle = "#ffe66a";
    ctx.font = "900 36px Inter, system-ui, sans-serif";
    ctx.fillText(`${game.score} POINTS`, left.x + 20, left.y + 102);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 19px Inter, system-ui, sans-serif";
    let nextY = drawWrappedText("Built for mobile, tablet, and laptop.", left.x + 20, left.y + 166, left.width - 40, 25);
    ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
    ctx.font = "600 16px Inter, system-ui, sans-serif";
    nextY = drawWrappedText(
      "The browser reads camera frames for hand tracking after permission is allowed.",
      left.x + 20,
      nextY + 18,
      left.width - 40,
      22,
    );
    ctx.fillStyle = "#8fb3ff";
    ctx.font = "700 16px Inter, system-ui, sans-serif";
    drawWrappedText("Permission is not just a popup. It is access.", left.x + 20, nextY + 16, left.width - 40, 22);

    ctx.fillStyle = "#ff9a4f";
    ctx.font = "900 32px Inter, system-ui, sans-serif";
    ctx.fillText("SURPRISE", right.x + 20, right.y + 48);
    drawSurprisePortrait(surpriseSnapshot, right.x + right.width / 2 - 78, right.y + 72, 156);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 17px Inter, system-ui, sans-serif";
    nextY = drawWrappedText(
      "Your face was detected from the active camera frame and shown with your score.",
      right.x + 20,
      right.y + 260,
      right.width - 40,
      23,
    );
    ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
    ctx.font = "600 15px Inter, system-ui, sans-serif";
    drawWrappedText(
      "This demo keeps it local and does not upload or save it.",
      right.x + 20,
      nextY + 14,
      right.width - 40,
      20,
    );
    ctx.restore();
    return;
  }

  const gap = narrow ? 24 : 44;
  const marginX = narrow ? 36 : 58;
  const top = narrow ? 54 : 72;
  const panelHeight = narrow ? 576 : 558;
  const panelWidth = (WIDTH - marginX * 2 - gap) / 2;
  const portraitSize = narrow ? 176 : SURPRISE_SIZE;
  const left = { x: marginX, y: top, width: panelWidth, height: panelHeight };
  const right = { x: marginX + panelWidth + gap, y: top, width: panelWidth, height: panelHeight };
  for (const panel of [left, right]) {
    ctx.fillStyle = "rgba(8, 14, 18, 0.82)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(panel.x, panel.y, panel.width, panel.height, 18);
    ctx.fill();
    ctx.stroke();
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#73ff95";
  ctx.font = `900 ${narrow ? 34 : 42}px Inter, system-ui, sans-serif`;
  ctx.fillText("ROUND OVER", left.x + 26, left.y + (narrow ? 50 : 60));
  ctx.fillStyle = "#ffe66a";
  ctx.font = `900 ${narrow ? 36 : 46}px Inter, system-ui, sans-serif`;
  ctx.fillText(`${game.score} POINTS`, left.x + 26, left.y + (narrow ? 106 : 124));

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${narrow ? 19 : 23}px Inter, system-ui, sans-serif`;
  let nextY = drawWrappedText(
    "Built to work on mobile, tablet, and laptop screens.",
    left.x + 26,
    left.y + (narrow ? 166 : 190),
    left.width - 52,
    narrow ? 25 : 31,
  );
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.font = `600 ${narrow ? 16 : 19}px Inter, system-ui, sans-serif`;
  nextY = drawWrappedText(
    "The browser reads camera frames for hand tracking after permission is allowed. The same permission also made the end snapshot possible.",
    left.x + 26,
    nextY + (narrow ? 16 : 20),
    left.width - 52,
    narrow ? 22 : 27,
  );
  ctx.fillStyle = "#8fb3ff";
  drawWrappedText(
    "That is the lesson: permission is not just a popup, it is access.",
    left.x + 26,
    nextY + (narrow ? 14 : 18),
    left.width - 52,
    narrow ? 22 : 27,
  );

  ctx.fillStyle = "#ff9a4f";
  ctx.font = `900 ${narrow ? 32 : 38}px Inter, system-ui, sans-serif`;
  ctx.fillText("SURPRISE", right.x + 26, right.y + (narrow ? 48 : 56));
  drawSurprisePortrait(surpriseSnapshot, right.x + right.width / 2 - portraitSize / 2, right.y + (narrow ? 68 : 78), portraitSize);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${narrow ? 17 : 21}px Inter, system-ui, sans-serif`;
  nextY = drawWrappedText(
    "Your face was detected from the active camera frame and shown with your score.",
    right.x + 26,
    right.y + (narrow ? 278 : 336),
    right.width - 52,
    narrow ? 23 : 29,
  );
  ctx.fillStyle = "rgba(255, 255, 255, 0.76)";
  ctx.font = `600 ${narrow ? 15 : 18}px Inter, system-ui, sans-serif`;
  drawWrappedText(
    "This demo keeps it local and does not upload or save it. A dishonest app could make different choices, so permissions deserve attention.",
    right.x + 26,
    nextY + (narrow ? 10 : 12),
    right.width - 52,
    narrow ? 20 : 25,
  );

  ctx.restore();
}

function rawPointFromLandmarks(landmarks) {
  if (!landmarks) return null;
  const tip = landmarks[8];
  const dip = landmarks[7];
  const x = Math.min(1, Math.max(0, tip.x + 0.35 * (tip.x - dip.x)));
  const y = Math.min(1, Math.max(0, tip.y + 0.35 * (tip.y - dip.y)));
  return { x: (1 - x) * WIDTH, y: Math.min(y * HEIGHT, HEIGHT - (isMobilePortrait() ? 92 : 0)) };
}

function fingerIsExtended(landmarks, tipIndex, pipIndex, mcpIndex) {
  const wrist = landmarks[0];
  const tip = landmarks[tipIndex];
  const pip = landmarks[pipIndex];
  const mcp = landmarks[mcpIndex];
  const tipReach = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  const pipReach = Math.hypot(pip.x - wrist.x, pip.y - wrist.y);
  return tipReach > pipReach * 1.08 && tip.y < mcp.y + 0.08;
}

function gestureFromLandmarks(landmarks) {
  if (!landmarks) return null;
  const extended = {
    index: fingerIsExtended(landmarks, 8, 6, 5),
    middle: fingerIsExtended(landmarks, 12, 10, 9),
    ring: fingerIsExtended(landmarks, 16, 14, 13),
    pinky: fingerIsExtended(landmarks, 20, 18, 17),
  };
  const count = Object.values(extended).filter(Boolean).length;

  if (count >= 4) return "restart";
  if (extended.index && !extended.middle && !extended.ring && !extended.pinky) return "slice";
  return null;
}

async function createTrackers() {
  const vision = await FilesetResolver.forVisionTasks("/wasm");
  const [handLandmarker, faceDetector] = await Promise.all([
    HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.62,
    }),
    FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    }),
  ]);
  return { handLandmarker, faceDetector };
}

function cropFaceFromVideo(faceBox) {
  if (!faceBox || !video.videoWidth || !video.videoHeight) return null;
  const padding = Math.max(faceBox.width, faceBox.height) * 0.34;
  const sourceSize = Math.min(
    video.videoWidth,
    video.videoHeight,
    Math.max(faceBox.width, faceBox.height) + padding * 2,
  );
  const centerX = faceBox.originX + faceBox.width / 2;
  const centerY = faceBox.originY + faceBox.height / 2;
  const sourceX = Math.max(0, Math.min(video.videoWidth - sourceSize, centerX - sourceSize / 2));
  const sourceY = Math.max(0, Math.min(video.videoHeight - sourceSize, centerY - sourceSize / 2));
  const snapshot = document.createElement("canvas");
  snapshot.width = SURPRISE_SIZE;
  snapshot.height = SURPRISE_SIZE;
  const snapshotCtx = snapshot.getContext("2d");
  snapshotCtx.save();
  snapshotCtx.translate(SURPRISE_SIZE, 0);
  snapshotCtx.scale(-1, 1);
  snapshotCtx.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, SURPRISE_SIZE, SURPRISE_SIZE);
  snapshotCtx.restore();
  return snapshot;
}

async function startCamera() {
  configureCanvasSize();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: WIDTH },
      height: { ideal: HEIGHT },
      frameRate: { ideal: 60 },
      facingMode: "user",
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

function showPermissionScreen(message) {
  panel.classList.remove("hidden");
  continueButton.classList.add("hidden");
  startButton.disabled = false;
  statusLabel.textContent = message;
}

async function boot() {
  configureCanvasSize();
  window.addEventListener("resize", configureCanvasSize);
  const [assets, trackers] = await Promise.all([loadAssets(), createTrackers()]);
  const { handLandmarker, faceDetector } = trackers;
  const sounds = makeSounds();
  const game = new Game(assets, sounds);
  let playCount = getLocalPlayCount();
  let lastVideoTime = -1;
  let latestLandmarks = null;
  let surpriseSnapshot = null;
  let surpriseReady = false;
  let roundActive = false;
  let requestedPermissionAgain = false;

  continueButton.addEventListener("click", () => {
    roundActive = false;
    requestedPermissionAgain = false;
    surpriseSnapshot = null;
    surpriseReady = false;
    game.prepareToStart();
    showPermissionScreen("Thanks for playing! Start again to request camera access.");
  });

  setLocalPlayCount(playCount);
  panel.classList.remove("loading");
  panel.classList.add("ready");
  statusLabel.textContent = "Ready. A small surprise appears at the end.";
  startButton.disabled = false;

  startButton.addEventListener("click", async () => {
    startButton.disabled = true;
    statusLabel.textContent = "Requesting camera...";
    try {
      await unlockSounds(sounds);
      await startCamera();
      playCount += 1;
      setLocalPlayCount(playCount);
      continueButton.classList.add("hidden");
      panel.classList.add("hidden");
      game.prepareToStart();
      roundActive = true;
      requestedPermissionAgain = false;
      requestAnimationFrame(loop);
    } catch (error) {
      startButton.disabled = false;
      statusLabel.textContent = error.message || "Camera permission was blocked.";
    }
  });

  function loop(now) {
    if (!roundActive) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = handLandmarker.detectForVideo(video, now);
      latestLandmarks = result.landmarks?.[0] ?? null;
    }

    const gesture = gestureFromLandmarks(latestLandmarks);
    const handBox = handBoxFromLandmarks(latestLandmarks);
    const handDistanceState = game.waitingToStart ? (handBox?.distanceState ?? "too-far") : "good";
    drawSensorOnlyStage();
    drawHandLandmarks(latestLandmarks, handDistanceState);
    const timeLeft = game.update(rawPointFromLandmarks(latestLandmarks), gesture, now, handBox);
    if (!game.gameOver && surpriseReady) {
      surpriseSnapshot = null;
      surpriseReady = false;
    }
    if (game.gameOver && !surpriseReady) {
      const faceResult = faceDetector.detectForVideo(video, now);
      surpriseSnapshot = cropFaceFromVideo(faceResult.detections?.[0]?.boundingBox);
      surpriseReady = true;
      stopCamera();
      latestLandmarks = null;
    }
    for (const object of game.objects) object.draw(ctx);
    drawTrail(game.trail, game.pointer);
    drawHud(game, timeLeft, playCount);
    if (game.waitingToStart && !game.gameOver) {
      drawIntro(game);
      drawStartCalibration(game, handBox, gesture);
    }
    if (game.gameOver) drawGameOver(game, surpriseSnapshot);

    if (game.gameOver && !requestedPermissionAgain) {
      requestedPermissionAgain = true;
      continueButton.classList.remove("hidden");
      return;
    }

    requestAnimationFrame(loop);
  }
}

startButton.disabled = true;
boot().catch((error) => {
  console.error(error);
  statusLabel.textContent = error.message || "Could not start the app.";
});
