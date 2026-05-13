// autobot.js — Hamiltonian shortcut autobot for BAVIS Snake.
//
// Loaded as a classic script AFTER game.js so it shares script scope and can
// read these globals directly:
//   snake, food, direction, gameRunning, nicePauseActive, deathState,
//   TILE_COUNT, BASE_TICK_MS
//
// It never touches that state — it only dispatches synthetic KeyboardEvent
// "keydown"s on document and clicks DOM buttons, which the game's own
// handlers process. The snake plays itself the same way a human would.
//
// On death the bot fills in a name, submits the score, lets the leaderboard
// modal show for VIEW_LEADERBOARD_MS, then closes it and starts a new run.

(() => {
    const FALLBACK_BOT_NAME    = 'AUTOBOT';
    const NAME_INDEX_LS_KEY    = 'autobot_name_index';
    const VIEW_LEADERBOARD_MS  = 3000;
    const AUTO_START_ON_LOAD   = true;

    // Number of bot ticks at the start of each run during which mistakes are
    // disabled. Tapsell never voluntarily dies, so this guarantees the snake
    // reaches at least ~score 20 before any mistake roll can fire. Each food
    // costs ~15 ticks, so 45 ticks ≈ 3 foods of guaranteed safe play.
    const WARMUP_TICKS         = 45;

    // --- Boost behaviour ---
    // Random short bursts of SPACE-held boost while playing. Tuned for an
    // expected duty cycle of ~9% (well under the 15% cap, leaves headroom
    // for short-window variance) with single bursts bounded to
    // BOOST_MAX_DURATION_MS so no boost stretch exceeds 2 s.
    const BOOST_CHECK_INTERVAL_MS = 1000;  // roll the boost trigger every 1 s
    const BOOST_TRIGGER_PROB      = 0.08;  // 8% chance per check
    const BOOST_MIN_DURATION_MS   = 400;
    const BOOST_MAX_DURATION_MS   = 2000;

    // --- Mistake / skill distribution (per-run) ---
    // Each new run samples a per-tick mistake probability. ZONED runs have a
    // very low rate and can push well past 600 points; "drunk" runs (the
    // common case) now use a much tighter, low-mistake band so the bot
    // mostly clears the early game. Monte Carlo (n=80k) approximates:
    //   ~15% of runs end below 100 points
    //   ~40% of runs end below 200 points
    //   ~5%  of runs cross 600 points
    //   ~1%  of runs cross 1000 points
    //
    // Note: the model floors <100 at ~15%; pulling it lower also drags <200
    // below 40%, so this is the best simultaneous fit we can hit.
    const ZONED_RUN_PROB   = 0.04;
    const ZONED_RATE_MIN   = 0.0001;   // 0.01% per tick
    const ZONED_RATE_MAX   = 0.0015;   // 0.15% per tick
    const DRUNK_RATE_MIN   = 0.008;    // 0.8%  per tick
    const DRUNK_RATE_MAX   = 0.014;    // 1.4%  per tick

    const sampleRunMistakeRate = () => {
        if (Math.random() < ZONED_RUN_PROB) {
            return ZONED_RATE_MIN + Math.random() * (ZONED_RATE_MAX - ZONED_RATE_MIN);
        }
        return DRUNK_RATE_MIN + Math.random() * (DRUNK_RATE_MAX - DRUNK_RATE_MIN);
    };

    // Pull names from autobot_names.js (loaded before this script). Each call
    // returns the next entry and advances the cursor; loops back to 0 after
    // the last entry. Cursor persists in localStorage so the rotation
    // survives page reloads.
    const nextBotName = () => {
        const names = Array.isArray(window.AUTOBOT_NAMES) && window.AUTOBOT_NAMES.length
            ? window.AUTOBOT_NAMES
            : null;
        if (!names) return FALLBACK_BOT_NAME;
        const raw = Number(localStorage.getItem(NAME_INDEX_LS_KEY));
        const i = Number.isFinite(raw) && raw >= 0 ? raw % names.length : 0;
        localStorage.setItem(NAME_INDEX_LS_KEY, String((i + 1) % names.length));
        return names[i];
    };

    const T = TILE_COUNT;
    const N = T * T;

    // ---------- Local API fallback ----------
    // If /api/scores isn't reachable (e.g. you're running with
    // `python -m http.server` instead of `vercel dev`), keep the leaderboard
    // working by serving it out of localStorage. When the real backend is
    // available (deployed on Vercel) this is a transparent pass-through.
    (function installLocalApiFallback() {
        const originalFetch = window.fetch.bind(window);
        const LS_KEY = 'autobot_local_scores';

        const readLocal = () => {
            try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
            catch { return []; }
        };
        const writeLocal = (s) => localStorage.setItem(LS_KEY, JSON.stringify(s));
        const top10 = (s) => s.slice().sort((a, b) => b.score - a.score).slice(0, 10);

        const mock = (method, bodyStr) => {
            if (method === 'GET') {
                return new Response(JSON.stringify(top10(readLocal())), {
                    status: 200, headers: { 'Content-Type': 'application/json' }
                });
            }
            if (method === 'POST') {
                let data;
                try { data = JSON.parse(bodyStr); } catch { data = {}; }
                if (!data.name || typeof data.score !== 'number') {
                    return new Response(JSON.stringify({ error: 'Invalid name or score' }), {
                        status: 400, headers: { 'Content-Type': 'application/json' }
                    });
                }
                const scores = readLocal();
                scores.push({
                    id: (crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random()}`),
                    name: String(data.name).substring(0, 20).trim(),
                    score: Math.max(0, Math.floor(data.score)),
                    date: new Date().toISOString()
                });
                writeLocal(scores);
                return new Response(JSON.stringify({ success: true, scores: top10(scores) }), {
                    status: 200, headers: { 'Content-Type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
        };

        window.fetch = async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input?.url;
            if (!url || !url.includes('/api/scores')) {
                return originalFetch(input, init);
            }
            const method = (init && init.method) || 'GET';
            try {
                const res = await originalFetch(input, init);
                const ct = res.headers.get('content-type') || '';
                if (res.ok && ct.includes('application/json')) return res;
                console.warn('[autobot] /api/scores returned', res.status, ct, '— using localStorage fallback');
                return mock(method, init?.body);
            } catch (err) {
                console.warn('[autobot] /api/scores unreachable — using localStorage fallback:', err?.message);
                return mock(method, init?.body);
            }
        };
    })();

    // game.js calls alert() if a submit fails. alert() blocks JS execution,
    // which would freeze the bot. Replace with a console warning so the bot
    // can recover. (The api fallback above means this almost never fires.)
    window._origAlert = window.alert.bind(window);
    window.alert = (msg) => console.warn('[autobot] alert suppressed:', msg);

    // ---------- Hamiltonian cycle ----------
    // T must be even for this construction. Top row L->R, then zigzag
    // down/up through columns R->L, closing back to (0,0).
    const cycle = [];
    for (let x = 0; x < T; x++) cycle.push([x, 0]);
    for (let i = 0; i < T; i++) {
        const x = T - 1 - i;
        if (i % 2 === 0) for (let y = 1; y < T; y++)     cycle.push([x, y]);
        else             for (let y = T - 1; y >= 1; y--) cycle.push([x, y]);
    }
    const idxMap = new Map();
    cycle.forEach(([x, y], i) => idxMap.set(`${x},${y}`, i));

    const cycleIdx  = (p) => idxMap.get(`${p.x},${p.y}`);
    const cycleDist = (a, b) => {
        const ai = cycleIdx(a), bi = cycleIdx(b);
        if (ai === undefined || bi === undefined) return N;
        return (bi - ai + N) % N;
    };

    // ---------- State ----------
    let running         = false;
    let tickId          = null;
    let viewTimeout     = null;
    let phase           = 'idle'; // 'play' | 'dying' | 'submitting' | 'viewing' | 'idle'
    let runMistakeRate  = 0;      // resampled at the start of each run
    let warmupRemaining = 0;      // ticks left in the no-mistakes grace period
    let boostUntil      = 0;      // performance.now() at which to stop boosting
    let boostNextCheck  = 0;      // performance.now() at which to roll next trigger

    // ---------- I/O ----------
    const send = (key) => document.dispatchEvent(
        new KeyboardEvent('keydown', { key, code: key, bubbles: true })
    );

    const setDir = (nx, ny) => {
        if (nx === 0 && ny === 0) return;
        if (nx === -direction.x && ny === -direction.y) return; // can't reverse
        if (nx ===  1) send('ArrowRight');
        if (nx === -1) send('ArrowLeft');
        if (ny ===  1) send('ArrowDown');
        if (ny === -1) send('ArrowUp');
    };

    // 1-cell snake: no body collision risk. Greedy toward food, respecting
    // the "no reverse" rule. Beats following the cycle by ~20× for first food.
    const greedyToFood = (head) => {
        const dx = food.x - head.x;
        const dy = food.y - head.y;
        const candidates = [];
        if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx !== 0) candidates.push({ x: head.x + Math.sign(dx), y: head.y });
            if (dy !== 0) candidates.push({ x: head.x, y: head.y + Math.sign(dy) });
        } else {
            if (dy !== 0) candidates.push({ x: head.x, y: head.y + Math.sign(dy) });
            if (dx !== 0) candidates.push({ x: head.x + Math.sign(dx), y: head.y });
        }
        for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            candidates.push({ x: head.x + ddx, y: head.y + ddy });
        }
        for (const n of candidates) {
            if (n.x < 0 || n.x >= T || n.y < 0 || n.y >= T) continue;
            const ndx = n.x - head.x, ndy = n.y - head.y;
            if (ndx === -direction.x && ndy === -direction.y) continue;
            return n;
        }
        return null;
    };

    // Tapsell-style Hamiltonian shortcut: take the neighbor with the biggest
    // forward cycle jump that doesn't overtake the tail or pass the food.
    const chooseNext = () => {
        const head = snake[0];

        if (snake.length === 1 && food) {
            const g = greedyToFood(head);
            if (g) return g;
        }

        const tail = snake[snake.length - 1];
        const bodySet = new Set();
        for (let i = 1; i < snake.length; i++) {
            bodySet.add(`${snake[i].x},${snake[i].y}`);
        }

        const distToTail = cycleDist(head, tail);
        const distToFood = food ? cycleDist(head, food) : N;
        const empty = N - snake.length;

        let maxShortcut = distToTail - 3;
        if (empty < N / 4) maxShortcut = 0; // late game: pure cycle
        if (food && distToFood < distToTail) {
            maxShortcut = Math.min(maxShortcut, distToFood);
        }
        if (maxShortcut < 1) maxShortcut = 1;

        const headIdx = cycleIdx(head);
        const def = cycle[(headIdx + 1) % N];
        let best = { x: def[0], y: def[1] };
        let bestJump = 1;

        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = head.x + dx, ny = head.y + dy;
            if (nx < 0 || nx >= T || ny < 0 || ny >= T) continue;
            if (bodySet.has(`${nx},${ny}`)) continue;
            const jump = cycleDist(head, { x: nx, y: ny });
            if (jump > maxShortcut) continue;
            if (jump > bestJump) { best = { x: nx, y: ny }; bestJump = jump; }
        }
        return best;
    };

    // Press/release the SPACE key via synthetic events. The game's keydown
    // handler flips boostActive on while gameRunning; keyup clears it.
    const sendBoostKey = (type) => document.dispatchEvent(
        new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true })
    );

    const stopBoost = () => {
        if (boostUntil > 0) {
            sendBoostKey('keyup');
            boostUntil = 0;
        }
    };

    // Roll for a boost burst at most once per BOOST_CHECK_INTERVAL_MS, and
    // hold each burst for a random duration up to BOOST_MAX_DURATION_MS.
    const tickBoost = () => {
        const now = performance.now();
        if (boostUntil > 0) {
            if (now >= boostUntil) stopBoost();
            return;
        }
        if (now < boostNextCheck) return;
        boostNextCheck = now + BOOST_CHECK_INTERVAL_MS;
        if (Math.random() >= BOOST_TRIGGER_PROB) return;
        const dur = BOOST_MIN_DURATION_MS
            + Math.random() * (BOOST_MAX_DURATION_MS - BOOST_MIN_DURATION_MS);
        boostUntil = now + dur;
        sendBoostKey('keydown');
    };

    // Pick a random non-reverse direction other than the "correct" one. Used
    // when the per-run mistake roll fires. Two candidates are always
    // available (4 dirs minus reverse minus correct), so this returns a
    // strictly different cell than `correct`.
    const pickMistake = (head, correct) => {
        const candidates = [];
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            if (dx === -direction.x && dy === -direction.y) continue;
            const nx = head.x + dx, ny = head.y + dy;
            if (nx === correct.x && ny === correct.y) continue;
            candidates.push({ x: nx, y: ny });
        }
        if (candidates.length === 0) return correct;
        return candidates[Math.floor(Math.random() * candidates.length)];
    };

    // ---------- State machine ----------
    const submitModalShown      = () => document.getElementById('submitScoreModal')?.classList.contains('show');
    const leaderboardModalShown = () => document.getElementById('leaderboardModal')?.classList.contains('show');

    const tick = () => {
        if (!running) return;

        if (phase === 'play') {
            if (deathState && deathState.active) { stopBoost(); phase = 'dying'; return; }
            if (!gameRunning) { stopBoost(); phase = 'idle'; return; }
            if (nicePauseActive) { stopBoost(); return; }
            tickBoost();
            const head = snake[0];
            const correct = chooseNext();
            if (!correct) return;
            const mistakesArmed = warmupRemaining <= 0;
            if (!mistakesArmed) warmupRemaining -= 1;
            const choice = (mistakesArmed && runMistakeRate > 0 && Math.random() < runMistakeRate)
                ? pickMistake(head, correct)
                : correct;
            setDir(choice.x - head.x, choice.y - head.y);
            return;
        }

        if (phase === 'dying') {
            if (deathState && deathState.active) return;
            // Wait for the NEW HIGH SCORE celebration to finish too.
            if (document.body.classList.contains('high-score-celebration-active')) return;
            if (submitModalShown()) {
                const nameInput = document.getElementById('playerName');
                const name = nextBotName();
                if (nameInput) nameInput.value = name;
                console.log('autobot: submitting as', name);
                document.getElementById('submitScoreBtn')?.click();
                phase = 'submitting';
            } else {
                // No submit modal (score was 0). Skip straight to restart.
                phase = 'idle';
            }
            return;
        }

        if (phase === 'submitting') {
            if (leaderboardModalShown()) {
                phase = 'viewing';
                if (viewTimeout) clearTimeout(viewTimeout);
                viewTimeout = setTimeout(() => {
                    document.getElementById('leaderboardModal')?.classList.remove('show');
                    viewTimeout = null;
                    phase = 'idle';
                }, VIEW_LEADERBOARD_MS);
            } else if (!submitModalShown()) {
                // Both modals closed without leaderboard opening — fall back to restart.
                phase = 'idle';
            }
            return;
        }

        if (phase === 'viewing') return; // wait for the 3s timer

        if (phase === 'idle') {
            if (!gameRunning) {
                runMistakeRate = sampleRunMistakeRate();
                warmupRemaining = WARMUP_TICKS;
                console.log(`autobot: new run, mistake rate = ${runMistakeRate.toFixed(4)} (warmup ${WARMUP_TICKS} ticks)`);
                send('Space');
            }
            phase = 'play';
            return;
        }
    };

    // ---------- Public controls ----------
    const start = () => {
        if (running) return;
        running = true;
        phase = 'idle';
        tickId = setInterval(tick, Math.max(20, Math.round(BASE_TICK_MS / 3)));
        console.log('autobot: running');
    };

    const stop = () => {
        if (!running) return;
        running = false;
        if (tickId) clearInterval(tickId);
        if (viewTimeout) clearTimeout(viewTimeout);
        stopBoost();
        tickId = null;
        viewTimeout = null;
        phase = 'idle';
        console.log('autobot: stopped');
    };

    const init = () => {
        if (AUTO_START_ON_LOAD) start();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for console too.
    window.autobot = {
        start, stop,
        get running() { return running; },
        get mistakeRate() { return runMistakeRate; },
    };
})();
