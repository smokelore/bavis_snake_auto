// autobot_names.js — pool of leaderboard names for the autobot.
//
// Each name is ≤ 20 chars to fit the server-side cap on /api/scores.
// The autobot iterates this list linearly and loops back to the start
// after the last entry. The current cursor is persisted in localStorage
// under the key `autobot_name_index` so the cycle survives reloads.
//
// Add, remove, or reorder freely.

window.AUTOBOT_NAMES = [
    'AUTOBOT-1',
    'SNAVISBOT',
    'HAMILTONIAN',
    'CIRCUIT BREAKER',
    'CYCLE RIDER',
    'THE OUROBOROS',
    'CTRL+SNAKE',
    'PYTHON 3.13',
    'NAGINI',
    'SSSSSS',
    'SCALES-OF-JUSTICE',
    'SLITHER.IO REJECT',
    'RECURSIVE_BAVIS',
    'NPC #404',
    'GLITCH IN MATRIX',
    'WHO LET BOT OUT',
    'EAT.SLEEP.SLITHER',
    'NO-COLLIDE ZONE',
    'SHORTCUT TAKEN',
    'ROUTE 256',
];
