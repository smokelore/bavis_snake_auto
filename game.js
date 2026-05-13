const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const boardShell = document.getElementById('boardShell');
const voidModeToggle = document.getElementById('voidModeToggle');

// Background animation setup
const bgContainer = document.getElementById('backgroundContainer');
const bavisBackgrounds = [];

class BackgroundBavis {
    constructor(index) {
        this.element = document.createElement('img');
        this.element.src = 'snake-head.png';
        this.element.className = 'bavis-bg';
        this.element.style.width = (150 + Math.random() * 200) + 'px';
        this.element.style.height = this.element.style.width;
        bgContainer.appendChild(this.element);

        this.x = Math.random() * window.innerWidth;
        this.y = Math.random() * window.innerHeight;
        this.vx = (Math.random() - 0.5) * 2;
        this.vy = (Math.random() - 0.5) * 2;
        this.angle = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.05;
        this.time = Math.random() * 1000;
        this.waveAmplitude = 100 + Math.random() * 100;
        this.waveFrequency = 0.005 + Math.random() * 0.01;
        this.update();
    }

    update() {
        this.time += 1;
        this.angle += this.rotationSpeed;

        // Weird wave motion
        this.x += this.vx + Math.sin(this.time * this.waveFrequency) * 0.5;
        this.y += this.vy + Math.cos(this.time * this.waveFrequency * 0.7) * 0.5;

        // Bounce off edges
        if (this.x > window.innerWidth + 200) this.x = -200;
        if (this.x < -200) this.x = window.innerWidth + 200;
        if (this.y > window.innerHeight + 200) this.y = -200;
        if (this.y < -200) this.y = window.innerHeight + 200;

        // Random direction changes
        if (Math.random() < 0.01) {
            this.vx = (Math.random() - 0.5) * 3;
            this.vy = (Math.random() - 0.5) * 3;
        }

        this.element.style.left = this.x + 'px';
        this.element.style.top = this.y + 'px';
        this.element.style.transform = `rotate(${this.angle}rad)`;
    }
}

// Create background Bavis instances
for (let i = 0; i < 12; i++) {
    bavisBackgrounds.push(new BackgroundBavis(i));
}

// Animate background
function animateBackground() {
    bavisBackgrounds.forEach(b => b.update());
    requestAnimationFrame(animateBackground);
}
animateBackground();

const GRID_SIZE = 20;
const TILE_COUNT = canvas.width / GRID_SIZE;
const ORIGINAL_TICK_MS = 100;
const BASE_TICK_MS = ORIGINAL_TICK_MS / 0.96;
const BOOST_SPEED_MULTIPLIER = 1.7;
const DEATH_EFFECT_MS = 2800;
const BOARD_ROTATION_SCORE = 420;
const NICE_COUNTDOWN_START = 3;

let gameRunning = false;
let boostActive = false;
let boardRotationActive = false;
let darkModeActive = localStorage.getItem('snakeVoidMode') === 'true';
let score = 0;
let highScore = localStorage.getItem('snakeHighScore') || 0;
let lastGlitchMilestone = 0;
let nicePauseActive = false;
let nicePauseIntervalId = null;
let nicePauseTimeoutId = null;

const glitchState = {
    active: false,
    level: 0,
    score: 0,
    startedAt: 0,
    endsAt: 0,
    rafId: null
};

const deathState = {
    active: false,
    startedAt: 0,
    endsAt: 0,
    score: 0,
    particles: [],
    sparks: [],
    timeoutId: null
};

document.getElementById('highScore').textContent = scoreForDisplay(Number(highScore));

function isNiceScore(scoreValue) {
    return scoreValue > 0 && scoreValue % 100 === 70;
}

function scoreForDisplay(scoreValue) {
    return isNiceScore(scoreValue) ? scoreValue - 1 : scoreValue;
}

function updateScoreDisplay() {
    document.getElementById('score').textContent = scoreForDisplay(score);
}

function setVoidMode(isActive) {
    darkModeActive = isActive;
    document.body.classList.toggle('void-mode', isActive);
    voidModeToggle.setAttribute('aria-pressed', String(isActive));
    voidModeToggle.textContent = isActive ? 'VOID ON' : 'VOID';
    localStorage.setItem('snakeVoidMode', String(isActive));
}

// Simple JSON-based leaderboard via Vercel API
async function fetchLeaderboard() {
    try {
        const response = await fetch('/api/scores');
        if (!response.ok) throw new Error('Failed to fetch leaderboard');
        return await response.json();
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        return [];
    }
}

async function submitScore(name, scoreValue) {
    try {
        const response = await fetch('/api/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, score: scoreValue })
        });
        if (!response.ok) throw new Error('Failed to submit score');
        return await response.json();
    } catch (error) {
        console.error('Error submitting score:', error);
        return null;
    }
}

function showLeaderboard() {
    const modal = document.getElementById('leaderboardModal');
    modal.classList.add('show');
    
    fetchLeaderboard().then(scores => {
        const list = document.getElementById('leaderboardList');
        if (scores.length === 0) {
            list.innerHTML = '<p style="color: #9dd4ff; text-align: center;">No scores yet. Be the first!</p>';
            return;
        }
        
        list.innerHTML = scores.map((entry, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
            return `
                <div class="leaderboard-entry top-${Math.min(index + 1, 3)}">
                    <span class="leaderboard-rank">${medal || index + 1}.</span>
                    <span class="leaderboard-name">${entry.name}</span>
                    <span class="leaderboard-score">${entry.score}</span>
                </div>
            `;
        }).join('');
    });
}

function showSubmitScoreModal(scoreValue, isNewHighScore = false) {
    document.querySelector('#submitScoreModal h2').textContent = isNewHighScore ? 'NEW HIGH SCORE!' : 'SUBMIT SCORE';
    document.getElementById('scoreValue').textContent = `Score: ${scoreValue}`;
    document.getElementById('playerName').value = '';
    document.getElementById('playerName').focus();
    document.getElementById('submitScoreModal').classList.add('show');
}

// Snake configuration
let snake = [
    { x: Math.floor(TILE_COUNT / 2), y: Math.floor(TILE_COUNT / 2) }
];
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };

// Food configuration
let food = { x: 0, y: 0 };

// Snake head image
let snakeHeadImage = new Image();
snakeHeadImage.src = 'snake-head.png';
let imageLoaded = false;

snakeHeadImage.onload = () => {
    imageLoaded = true;
    console.log('Snake head image loaded successfully');
};

snakeHeadImage.onerror = () => {
    console.warn('Failed to load snake-head.png');
};

// Color palette from the image
const COLORS = {
    darkBg: '#0f1420',
    bodyGreen: '#4dd4ac',
    bodyDarkGreen: '#2d8b7a',
    foodRed: '#ff6b6b',
    gridGreen: '#1a4d3d'
};

function spawnFood() {
    let validSpot = false;
    while (!validSpot) {
        food.x = Math.floor(Math.random() * TILE_COUNT);
        food.y = Math.floor(Math.random() * TILE_COUNT);
        validSpot = !snake.some(segment => segment.x === food.x && segment.y === food.y);
    }
}

function resetGlitch() {
    if (glitchState.rafId) cancelAnimationFrame(glitchState.rafId);
    lastGlitchMilestone = 0;
    glitchState.active = false;
    glitchState.level = 0;
    glitchState.score = 0;
    glitchState.startedAt = 0;
    glitchState.endsAt = 0;
    glitchState.rafId = null;
    document.body.classList.remove('glitching');
    document.documentElement.style.removeProperty('--glitch-intensity');
    document.documentElement.style.removeProperty('--glitch-duration');
    document.documentElement.style.removeProperty('--glitch-small');
    document.documentElement.style.removeProperty('--glitch-small-neg');
    document.documentElement.style.removeProperty('--glitch-medium');
    document.documentElement.style.removeProperty('--glitch-medium-neg');
    document.documentElement.style.removeProperty('--glitch-large');
    document.documentElement.style.removeProperty('--glitch-large-neg');
    document.documentElement.style.removeProperty('--glitch-glow');
    document.documentElement.style.removeProperty('--glitch-line-gap');
    document.documentElement.style.removeProperty('--glitch-overlay-opacity');
    document.documentElement.style.removeProperty('--glitch-tear-opacity');
    document.documentElement.style.removeProperty('--glitch-saturation');
    document.documentElement.style.removeProperty('--glitch-contrast');
}

function triggerScoreGlitch(scoreValue) {
    const level = scoreValue / 100;
    const duration = Math.min(850 + level * 180, 2600);
    const intensity = Math.min(1 + level * 0.35, 4.5);
    const now = performance.now();

    glitchState.active = true;
    glitchState.level = level;
    glitchState.score = scoreValue;
    glitchState.startedAt = now;
    glitchState.endsAt = now + duration;

    document.documentElement.style.setProperty('--glitch-intensity', intensity.toFixed(2));
    document.documentElement.style.setProperty('--glitch-duration', `${duration}ms`);
    document.documentElement.style.setProperty('--glitch-small', `${intensity.toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-small-neg', `${(-intensity).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-medium', `${(intensity * 2).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-medium-neg', `${(-intensity * 2).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-large', `${(intensity * 4).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-large-neg', `${(-intensity * 4).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-glow', `${(intensity * 14).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-line-gap', `${Math.max(2, 7 - intensity).toFixed(2)}px`);
    document.documentElement.style.setProperty('--glitch-overlay-opacity', Math.min(0.85, 0.22 + intensity * 0.12).toFixed(2));
    document.documentElement.style.setProperty('--glitch-tear-opacity', Math.min(0.75, 0.18 + intensity * 0.1).toFixed(2));
    document.documentElement.style.setProperty('--glitch-saturation', `${(1.2 + intensity * 0.45).toFixed(2)}`);
    document.documentElement.style.setProperty('--glitch-contrast', `${(1.05 + intensity * 0.12).toFixed(2)}`);
    document.body.classList.remove('glitching');
    void document.body.offsetWidth;
    document.body.classList.add('glitching');

    if (glitchState.rafId) cancelAnimationFrame(glitchState.rafId);
    const stopGlitch = () => {
        if (performance.now() >= glitchState.endsAt) {
            glitchState.active = false;
            document.body.classList.remove('glitching');
            glitchState.rafId = null;
            return;
        }
        glitchState.rafId = requestAnimationFrame(stopGlitch);
    };
    glitchState.rafId = requestAnimationFrame(stopGlitch);
}

function maybeTriggerScoreGlitch() {
    if (score > 0 && score % 100 === 0 && score !== lastGlitchMilestone) {
        lastGlitchMilestone = score;
        triggerScoreGlitch(score);
    }
}

function setBoardRotationActive(isActive) {
    if (boardRotationActive === isActive) return;

    boardRotationActive = isActive;
    boardShell.classList.toggle('board-rotating', isActive);
    document.body.classList.toggle('score-spinning', isActive);
}

function maybeStartBoardRotation() {
    if (score >= BOARD_ROTATION_SCORE) {
        setBoardRotationActive(true);
    }
}

function clearNicePause() {
    if (nicePauseIntervalId) clearInterval(nicePauseIntervalId);
    if (nicePauseTimeoutId) clearTimeout(nicePauseTimeoutId);

    nicePauseActive = false;
    nicePauseIntervalId = null;
    nicePauseTimeoutId = null;

    const overlay = document.getElementById('niceOverlay');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('nice-paused');
}

// Each NICE (score ending in 69) trigger increments this counter and
// progressively speeds up the global hue-shift animation. Reset only on a
// full page reload, so it carries over across deaths/restarts.
let niceTriggerCount = 0;
const HUE_SHIFT_BASE_DURATION_S = 30;   // first trigger: 30s per full hue cycle
const HUE_SHIFT_MIN_DURATION_S  = 0.6;  // floor so it never becomes seizure-fast

function bumpHueShift() {
    niceTriggerCount += 1;
    const duration = Math.max(
        HUE_SHIFT_MIN_DURATION_S,
        HUE_SHIFT_BASE_DURATION_S / niceTriggerCount
    );
    document.documentElement.style.setProperty('--hue-shift-duration', `${duration}s`);
    document.body.classList.add('hue-shifting');

    const mult = document.getElementById('niceMultiplier');
    if (mult) {
        mult.textContent = `x${niceTriggerCount}`;
        // re-trigger the pop animation by removing and re-adding the class
        mult.classList.remove('show');
        void mult.offsetWidth;
        mult.classList.add('show');
    }
}

const HIGH_SCORE_CELEBRATION_MS = 3500;

function triggerHighScoreCelebration(scoreValue, onComplete) {
    const overlay = document.getElementById('highScoreCelebration');
    if (!overlay) { onComplete(); return; }

    const scoreEl = document.getElementById('hscScore');
    if (scoreEl) scoreEl.textContent = scoreValue;

    document.body.classList.add('high-score-celebration-active');
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
        document.body.classList.remove('high-score-celebration-active');
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        onComplete();
    }, HIGH_SCORE_CELEBRATION_MS);
}

function resetHueShift() {
    niceTriggerCount = 0;
    document.body.classList.remove('hue-shifting');
    document.documentElement.style.removeProperty('--hue-shift-duration');

    const mult = document.getElementById('niceMultiplier');
    if (mult) {
        mult.classList.remove('show');
        mult.textContent = '';
    }
}

function triggerNicePause() {
    if (nicePauseActive) return;

    bumpHueShift();

    const overlay = document.getElementById('niceOverlay');
    const countdown = document.getElementById('niceCountdown');
    let remaining = NICE_COUNTDOWN_START;

    nicePauseActive = true;
    boostActive = false;
    countdown.textContent = remaining;
    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('nice-paused');
    document.getElementById('gameStatus').textContent = 'NICE pause';

    nicePauseIntervalId = setInterval(() => {
        remaining -= 1;

        if (remaining > 0) {
            countdown.textContent = remaining;
            return;
        }

        countdown.textContent = 'GO';
        clearInterval(nicePauseIntervalId);
        nicePauseIntervalId = null;
        nicePauseTimeoutId = setTimeout(() => {
            clearNicePause();
            if (gameRunning) {
                document.getElementById('gameStatus').textContent = 'Hold SPACE to boost';
            }
        }, 650);
    }, 1000);
}

function resetDeathEffect() {
    if (deathState.timeoutId) clearTimeout(deathState.timeoutId);

    deathState.active = false;
    deathState.startedAt = 0;
    deathState.endsAt = 0;
    deathState.score = 0;
    deathState.particles = [];
    deathState.sparks = [];
    deathState.timeoutId = null;
    document.body.classList.remove('death-effect');
}

function createDeathParticles() {
    const particles = [];
    const sparks = [];

    snake.forEach((segment, index) => {
        const baseX = segment.x * GRID_SIZE + GRID_SIZE / 2;
        const baseY = segment.y * GRID_SIZE + GRID_SIZE / 2;
        const pieces = index === 0 ? 18 : 8;

        for (let i = 0; i < pieces; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.6 + Math.random() * (index === 0 ? 9 : 5);
            particles.push({
                x: baseX,
                y: baseY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 8,
                spin: (Math.random() - 0.5) * 0.5,
                angle,
                color: ['#ff004c', '#00f5ff', '#fff200', '#ffffff', '#4dd4ac'][Math.floor(Math.random() * 5)]
            });
        }
    });

    for (let i = 0; i < 90; i++) {
        const edge = Math.floor(Math.random() * 4);
        sparks.push({
            x: edge === 0 ? 0 : edge === 1 ? canvas.width : Math.random() * canvas.width,
            y: edge === 2 ? 0 : edge === 3 ? canvas.height : Math.random() * canvas.height,
            length: 12 + Math.random() * 64,
            angle: Math.random() * Math.PI * 2,
            color: Math.random() > 0.5 ? '#ff004c' : '#00f5ff'
        });
    }

    deathState.particles = particles;
    deathState.sparks = sparks;
}

function triggerDeathEffect(onComplete) {
    resetGlitch();
    resetDeathEffect();
    createDeathParticles();

    const now = performance.now();
    deathState.active = true;
    deathState.startedAt = now;
    deathState.endsAt = now + DEATH_EFFECT_MS;
    deathState.score = scoreForDisplay(score);
    document.body.classList.add('death-effect');

    deathState.timeoutId = setTimeout(() => {
        deathState.active = false;
        deathState.timeoutId = null;
        document.body.classList.remove('death-effect');
        onComplete();
    }, DEATH_EFFECT_MS);
}

function update() {
    if (!gameRunning || nicePauseActive) return;

    direction = nextDirection;

    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    // Check wall collision
    if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
        endGame();
        return;
    }

    // Check self collision
    if (snake.some(segment => segment.x === head.x && segment.y === head.y)) {
        endGame();
        return;
    }

    snake.unshift(head);

    // Check food collision
    if (head.x === food.x && head.y === food.y) {
        score += 10;
        updateScoreDisplay();
        maybeTriggerScoreGlitch();
        maybeStartBoardRotation();
        spawnFood();
        if (isNiceScore(score)) {
            triggerNicePause();
        }
    } else {
        snake.pop();
    }
}

function drawGlitchEffects() {
    if (!glitchState.active) return;

    const now = performance.now();
    const duration = glitchState.endsAt - glitchState.startedAt;
    const remaining = Math.max(0, glitchState.endsAt - now);
    const fade = Math.min(1, remaining / duration);
    const level = glitchState.level;
    const intensity = Math.min(1 + level * 0.4, 5);
    const time = now * 0.02;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const channelAlpha = Math.min(0.08 + level * 0.018, 0.22) * fade;
    ctx.globalAlpha = channelAlpha;
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'hue-rotate(110deg) saturate(300%)';
    ctx.drawImage(canvas, Math.sin(time) * intensity, -intensity * 0.5);
    ctx.filter = 'hue-rotate(290deg) saturate(300%)';
    ctx.drawImage(canvas, -Math.cos(time * 1.2) * intensity, intensity * 0.5);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

    const sliceCount = Math.min(5 + Math.floor(level * 1.4), 18);
    for (let i = 0; i < sliceCount; i++) {
        const y = Math.floor(Math.random() * canvas.height);
        const h = Math.max(2, Math.floor(Math.random() * (5 + level * 2)));
        const offset = (Math.random() - 0.5) * intensity * 7;
        ctx.globalAlpha = (0.25 + Math.random() * 0.35) * fade;
        ctx.drawImage(canvas, 0, y, canvas.width, h, offset, y, canvas.width, h);
    }

    const blockCount = Math.min(3 + Math.floor(level), 12);
    for (let i = 0; i < blockCount; i++) {
        ctx.globalAlpha = (0.08 + Math.random() * 0.16) * fade;
        ctx.fillStyle = Math.random() > 0.5 ? '#ff2bd6' : '#35f5ff';
        ctx.fillRect(
            Math.random() * canvas.width,
            Math.random() * canvas.height,
            8 + Math.random() * (18 + level * 4),
            2 + Math.random() * (8 + level)
        );
    }

    if (level >= 4) {
        ctx.globalAlpha = Math.min(0.18, 0.04 + level * 0.015) * fade;
        ctx.fillStyle = '#ffffff';
        for (let y = 0; y < canvas.height; y += Math.max(5, 12 - Math.floor(level))) {
            ctx.fillRect(0, y, canvas.width, 1);
        }
    }

    ctx.globalAlpha = Math.min(0.65, 0.24 + level * 0.04) * fade;
    ctx.font = `${Math.min(18 + level * 2, 32)}px Arial Black, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#35f5ff';
    ctx.fillText(`SYSTEM SCORE ${glitchState.score}`, canvas.width / 2 + intensity, canvas.height / 2 - intensity);
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText(`SYSTEM SCORE ${glitchState.score}`, canvas.width / 2 - intensity, canvas.height / 2 + intensity);
    ctx.fillStyle = '#eaff7b';
    ctx.fillText(`SYSTEM SCORE ${glitchState.score}`, canvas.width / 2, canvas.height / 2);

    ctx.restore();
}

function drawDeathEffects() {
    if (!deathState.active) return;

    const now = performance.now();
    const elapsed = now - deathState.startedAt;
    const progress = Math.min(1, elapsed / DEATH_EFFECT_MS);
    const chaos = 1 - progress;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const flashAlpha = Math.max(0, 0.85 - progress * 1.3);
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = progress < 0.18 ? '#ffffff' : '#ff004c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = 0.22 + chaos * 0.2;
    ctx.fillStyle = '#050008';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ringCount = 8;
    for (let i = 0; i < ringCount; i++) {
        const ringProgress = (progress + i * 0.08) % 1;
        ctx.globalAlpha = (1 - ringProgress) * 0.5;
        ctx.strokeStyle = i % 2 === 0 ? '#ff004c' : '#00f5ff';
        ctx.lineWidth = 2 + (ringCount - i) * 0.45;
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringProgress * 260, 0, Math.PI * 2);
        ctx.stroke();
    }

    deathState.sparks.forEach((spark, index) => {
        const jitter = Math.sin(elapsed * 0.02 + index) * 18 * chaos;
        const x = spark.x + Math.cos(spark.angle) * elapsed * 0.06 + jitter;
        const y = spark.y + Math.sin(spark.angle) * elapsed * 0.06 - jitter;

        ctx.globalAlpha = 0.25 + chaos * 0.6;
        ctx.strokeStyle = spark.color;
        ctx.lineWidth = 1 + Math.random() * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
            x + Math.cos(spark.angle + Math.random() * 0.8) * spark.length,
            y + Math.sin(spark.angle + Math.random() * 0.8) * spark.length
        );
        ctx.stroke();
    });

    deathState.particles.forEach((particle, index) => {
        const t = elapsed / 16;
        const gravity = t * t * 0.018;
        const x = particle.x + particle.vx * t;
        const y = particle.y + particle.vy * t + gravity;
        const pulse = 1 + Math.sin(elapsed * 0.025 + index) * 0.4;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(particle.angle + particle.spin * t);
        ctx.globalAlpha = Math.max(0, chaos * 0.9);
        ctx.fillStyle = particle.color;
        ctx.fillRect(
            -particle.size / 2,
            -particle.size / 2,
            particle.size * pulse,
            particle.size * (0.5 + Math.random() * 1.2)
        );
        ctx.restore();
    });

    for (let i = 0; i < 18; i++) {
        ctx.globalAlpha = (0.08 + Math.random() * 0.18) * chaos;
        ctx.fillStyle = Math.random() > 0.5 ? '#ffffff' : '#fff200';
        ctx.fillRect(0, Math.random() * canvas.height, canvas.width, 1 + Math.random() * 4);
        ctx.fillRect(Math.random() * canvas.width, 0, 1 + Math.random() * 3, canvas.height);
    }

    ctx.globalAlpha = Math.min(1, 0.35 + chaos * 0.65);
    ctx.font = '26px Arial Black, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00f5ff';
    ctx.fillText('TOTAL SYSTEM FAILURE', centerX + 3, centerY - 12);
    ctx.fillStyle = '#ff004c';
    ctx.fillText('TOTAL SYSTEM FAILURE', centerX - 3, centerY - 8);
    ctx.fillStyle = '#fff200';
    ctx.fillText('TOTAL SYSTEM FAILURE', centerX, centerY - 10);

    ctx.font = '15px Arial Black, Arial, sans-serif';
    ctx.globalAlpha = Math.max(0, 0.82 - progress * 0.35);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`FINAL SCORE ${deathState.score}`, centerX, centerY + 22);

    ctx.restore();
}

function draw() {
    // Sync the boost visual class with the live boostActive flag so the
    // CSS chromatic / vignette / FOV / speed-line effects engage in real time.
    const motionTrailActive = boostActive && gameRunning && !nicePauseActive;
    document.body.classList.toggle('boosting', motionTrailActive);

    // Clear canvas. While boosting we use a translucent dark overlay so the
    // previous frame fades instead of being erased — the snake's old
    // positions ghost behind it as a true motion trail (each frame ~55% as
    // bright as the last; gone after ~5 frames).
    if (motionTrailActive) {
        ctx.fillStyle = 'rgba(15, 20, 32, 0.45)';
    } else {
        ctx.fillStyle = COLORS.darkBg;
    }
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = COLORS.gridGreen;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= TILE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(i * GRID_SIZE, 0);
        ctx.lineTo(i * GRID_SIZE, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * GRID_SIZE);
        ctx.lineTo(canvas.width, i * GRID_SIZE);
        ctx.stroke();
    }

    // Draw food
    ctx.fillStyle = COLORS.foodRed;
    ctx.beginPath();
    ctx.arc(
        food.x * GRID_SIZE + GRID_SIZE / 2,
        food.y * GRID_SIZE + GRID_SIZE / 2,
        GRID_SIZE / 2 - 2,
        0,
        Math.PI * 2
    );
    ctx.fill();

    // Draw snake body
    for (let i = 1; i < snake.length; i++) {
        const segment = snake[i];
        if (imageLoaded) {
            ctx.drawImage(snakeHeadImage, segment.x * GRID_SIZE, segment.y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        } else {
            // Fallback to rectangle if image not loaded
            ctx.fillStyle = COLORS.bodyGreen;
            ctx.fillRect(
                segment.x * GRID_SIZE + 1,
                segment.y * GRID_SIZE + 1,
                GRID_SIZE - 2,
                GRID_SIZE - 2
            );
        }
    }

    // Draw snake head
    const head = snake[0];
    const headX = head.x * GRID_SIZE;
    const headY = head.y * GRID_SIZE;

    // If image is loaded, draw it
    if (imageLoaded) {
        ctx.drawImage(snakeHeadImage, headX, headY, GRID_SIZE, GRID_SIZE);
    } else {
        // Fallback to styled square if image not loaded
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(headX + 1, headY + 1, GRID_SIZE - 2, GRID_SIZE - 2);
        ctx.fillStyle = '#000';
        ctx.fillRect(headX + 5, headY + 5, 3, 3);
        ctx.fillRect(headX + 12, headY + 5, 3, 3);
    }

    drawGlitchEffects();
    drawDeathEffects();
}

function gameLoop() {
    update();
    draw();
}

function getGameLoopDelay() {
    return boostActive && gameRunning ? BASE_TICK_MS / BOOST_SPEED_MULTIPLIER : BASE_TICK_MS;
}

function scheduleGameLoop() {
    setTimeout(() => {
        gameLoop();
        scheduleGameLoop();
    }, getGameLoopDelay());
}

function setStartButtonVisible(isVisible) {
    document.getElementById('startBtn').style.display = isVisible ? '' : 'none';
}

function startGame() {
    if (gameRunning) return;

    gameRunning = true;
    boostActive = false;
    snake = [{ x: Math.floor(TILE_COUNT / 2), y: Math.floor(TILE_COUNT / 2) }];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    clearNicePause();
    resetGlitch();
    resetDeathEffect();
    resetHueShift();
    setBoardRotationActive(false);
    updateScoreDisplay();
    spawnFood();
    document.getElementById('gameStatus').textContent = 'Hold SPACE to boost';
    setStartButtonVisible(false);
}

function resetGame() {
    gameRunning = false;
    boostActive = false;
    snake = [{ x: Math.floor(TILE_COUNT / 2), y: Math.floor(TILE_COUNT / 2) }];
    direction = { x: 1, y: 0 };
    nextDirection = { x: 1, y: 0 };
    score = 0;
    clearNicePause();
    resetGlitch();
    resetDeathEffect();
    resetHueShift();
    setBoardRotationActive(false);
    updateScoreDisplay();
    document.getElementById('gameStatus').textContent = 'Press SPACE to start';
    document.getElementById('startBtn').textContent = 'START GAME';
    setStartButtonVisible(true);
    spawnFood();
    draw();
}

function endGame() {
    const finalScore = scoreForDisplay(score);
    const isNewHighScore = finalScore > Number(highScore);

    gameRunning = false;
    boostActive = false;
    clearNicePause();
    setBoardRotationActive(false);
    document.getElementById('gameStatus').textContent = 'CRITICAL FAILURE';

    triggerDeathEffect(() => {
        if (isNewHighScore) {
            highScore = finalScore;
            localStorage.setItem('snakeHighScore', highScore);
            document.getElementById('highScore').textContent = highScore;
        }

        const proceedToSubmit = () => {
            if (finalScore > 0) {
                showSubmitScoreModal(finalScore, isNewHighScore);
            } else {
                document.getElementById('gameStatus').textContent = `Game Over! Score: ${finalScore}`;
            }
            document.getElementById('startBtn').textContent = 'START GAME';
            setStartButtonVisible(true);
        };

        if (isNewHighScore && finalScore > 0) {
            triggerHighScoreCelebration(finalScore, proceedToSubmit);
        } else {
            proceedToSubmit();
        }
    });
}

// Input handling
let touchStartX = 0;
let touchStartY = 0;

function isTextInputFocused(target) {
    if (!target) return false;

    const tagName = target.tagName;
    return (
        target.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT'
    );
}

document.addEventListener('keydown', (e) => {
    if (isTextInputFocused(e.target)) return;

    if (e.code === 'Space') {
        if (!gameRunning) {
            startGame();
        } else {
            boostActive = true;
        }
        e.preventDefault();
    }

    const key = e.key.toLowerCase();
    
    // Arrow keys
    if (e.key === 'ArrowUp' || key === 'w') {
        if (direction.y === 0) nextDirection = { x: 0, y: -1 };
        e.preventDefault();
    } else if (e.key === 'ArrowDown' || key === 's') {
        if (direction.y === 0) nextDirection = { x: 0, y: 1 };
        e.preventDefault();
    } else if (e.key === 'ArrowLeft' || key === 'a') {
        if (direction.x === 0) nextDirection = { x: -1, y: 0 };
        e.preventDefault();
    } else if (e.key === 'ArrowRight' || key === 'd') {
        if (direction.x === 0) nextDirection = { x: 1, y: 0 };
        e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (isTextInputFocused(e.target)) return;

    if (e.code === 'Space') {
        boostActive = false;
        e.preventDefault();
    }
});

// Touch controls for mobile
document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
});

document.addEventListener('touchmove', (e) => {
    if (!gameRunning) return;
    
    const touchEndX = e.touches[0].clientX;
    const touchEndY = e.touches[0].clientY;
    
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    const minSwipeDistance = 30;
    
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        // Horizontal swipe
        if (Math.abs(deltaX) > minSwipeDistance) {
            if (deltaX > 0 && direction.x === 0) {
                nextDirection = { x: 1, y: 0 };
            } else if (deltaX < 0 && direction.x === 0) {
                nextDirection = { x: -1, y: 0 };
            }
            touchStartX = touchEndX;
        }
    } else {
        // Vertical swipe
        if (Math.abs(deltaY) > minSwipeDistance) {
            if (deltaY > 0 && direction.y === 0) {
                nextDirection = { x: 0, y: 1 };
            } else if (deltaY < 0 && direction.y === 0) {
                nextDirection = { x: 0, y: -1 };
            }
            touchStartY = touchEndY;
        }
    }
});

// Button event listeners
voidModeToggle.addEventListener('click', () => {
    setVoidMode(!darkModeActive);
});
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('leaderboardBtn').addEventListener('click', showLeaderboard);

// Modal controls
document.getElementById('submitScoreBtn').addEventListener('click', async () => {
    const name = document.getElementById('playerName').value.trim();
    if (!name) {
        alert('Please enter a name!');
        return;
    }
    
    const scoreValue = parseInt(document.getElementById('scoreValue').textContent.split(': ')[1]);
    const result = await submitScore(name, scoreValue);
    if (result?.success) {
        document.getElementById('submitScoreModal').classList.remove('show');
        showLeaderboard();
    } else {
        alert('Score submission failed. The leaderboard may not be available in this deployment.');
    }
});

document.getElementById('skipSubmitBtn').addEventListener('click', () => {
    document.getElementById('submitScoreModal').classList.remove('show');
});

// Close modals
document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.addEventListener('click', (e) => {
        e.target.closest('.modal').classList.remove('show');
    });
});

document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });
});

// Allow Enter key to submit score
document.getElementById('playerName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('submitScoreBtn').click();
    }
});

// Initialize
setVoidMode(darkModeActive);
spawnFood();
draw();
scheduleGameLoop();
