// Context Tetris — app.js
(function () {
    'use strict';

    // ─── Constants ───
    const COLS = 10;
    const ROWS = 20;
    const BLOCK_SIZE = 28;
    const BOARD_W = COLS * BLOCK_SIZE;
    const BOARD_H = ROWS * BLOCK_SIZE;

    // ─── Piece definitions (SRS-like) ───
    const PIECES = {
        I: {
            shape: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
            color: '#06b6d4', name: 'Long Doc', icon: '📄'
        },
        O: {
            shape: [[1,1],[1,1]],
            color: '#eab308', name: 'Data Block', icon: '📦'
        },
        T: {
            shape: [[0,1,0],[1,1,1],[0,0,0]],
            color: '#a855f7', name: 'API Call', icon: '🔌'
        },
        S: {
            shape: [[0,1,1],[1,1,0],[0,0,0]],
            color: '#22c55e', name: 'Chat Msg', icon: '💬'
        },
        Z: {
            shape: [[1,1,0],[0,1,1],[0,0,0]],
            color: '#ef4444', name: 'Error Log', icon: '⚠️'
        },
        J: {
            shape: [[1,0,0],[1,1,1],[0,0,0]],
            color: '#3b82f6', name: 'Code Block', icon: '{ }'
        },
        L: {
            shape: [[0,0,1],[1,1,1],[0,0,0]],
            color: '#f97316', name: 'Config', icon: '⚙️'
        },
    };

    const PIECE_KEYS = Object.keys(PIECES);

    // ─── Level / Model progression ───
    const LEVELS = [
        { name: 'GPT-3.5',       ctx: '4K',   speed: 1.0 },
        { name: 'GPT-4',         ctx: '8K',   speed: 1.2 },
        { name: 'Claude 2',      ctx: '100K',  speed: 1.5 },
        { name: 'GPT-4 Turbo',   ctx: '128K',  speed: 1.8 },
        { name: 'Claude 3',      ctx: '200K',  speed: 2.2 },
        { name: 'Gemini 1.5',    ctx: '1M',    speed: 2.6 },
        { name: 'Gemini 2.0',    ctx: '2M',    speed: 3.0 },
        { name: 'Claude 4',      ctx: '∞',     speed: 3.5 },
        { name: 'GPT-5',         ctx: '???',   speed: 4.0 },
        { name: 'AGI Mode',      ctx: '♾️',    speed: 5.0 },
    ];

    // Scoring: tokens per action
    const SCORE_SOFT_DROP = 1;
    const SCORE_HARD_DROP = 2; // per cell
    const SCORE_LINES = [0, 100, 300, 500, 800]; // 0,1,2,3,4 lines
    const LINES_PER_LEVEL = 10;

    // ─── DOM ───
    const boardCanvas = document.getElementById('board-canvas');
    const boardCtx = boardCanvas.getContext('2d');
    const holdCanvas = document.getElementById('hold-canvas');
    const holdCtx = holdCanvas.getContext('2d');
    const nextCanvas = document.getElementById('next-canvas');
    const nextCtx = nextCanvas.getContext('2d');
    const overlay = document.getElementById('game-overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlaySubtitle = document.getElementById('overlay-subtitle');
    const btnStart = document.getElementById('btn-start');
    const scoreEl = document.getElementById('score-value');
    const linesEl = document.getElementById('lines-value');
    const levelEl = document.getElementById('level-value');
    const speedEl = document.getElementById('speed-value');
    const modelNameEl = document.getElementById('model-name');
    const modelCtxEl = document.getElementById('model-ctx');

    // HiDPI
    const dpr = window.devicePixelRatio || 1;

    function setupCanvas(cvs, w, h) {
        cvs.width = w * dpr;
        cvs.height = h * dpr;
        cvs.style.width = w + 'px';
        cvs.style.height = h + 'px';
        cvs.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setupCanvas(boardCanvas, BOARD_W, BOARD_H);
    setupCanvas(holdCanvas, 120, 100);
    setupCanvas(nextCanvas, 120, 280);

    // ─── Game State ───
    let board = [];       // 2D array [row][col] = null or color string
    let current = null;   // { type, shape, x, y, color }
    let holdPiece = null;
    let canHold = true;
    let nextQueue = [];
    let score = 0;
    let lines = 0;
    let level = 0;
    let gameOver = false;
    let paused = false;
    let dropInterval = 1000;
    let lastDrop = 0;
    let animFrame = null;
    let clearingLines = [];
    let clearFlashTimer = 0;
    let started = false;

    // 7-bag randomizer
    let bag = [];

    function fillBag() {
        bag = [...PIECE_KEYS].sort(() => Math.random() - 0.5);
    }

    function nextPieceType() {
        if (bag.length === 0) fillBag();
        return bag.pop();
    }

    function fillNextQueue() {
        while (nextQueue.length < 3) {
            nextQueue.push(nextPieceType());
        }
    }

    // ─── Board helpers ───
    function createBoard() {
        board = [];
        for (let r = 0; r < ROWS; r++) {
            board.push(new Array(COLS).fill(null));
        }
    }

    function rotateMatrix(matrix) {
        const n = matrix.length;
        const result = [];
        for (let i = 0; i < n; i++) {
            result[i] = [];
            for (let j = 0; j < n; j++) {
                result[i][j] = matrix[n - 1 - j][i];
            }
        }
        return result;
    }

    function rotateMatrixCCW(matrix) {
        const n = matrix.length;
        const result = [];
        for (let i = 0; i < n; i++) {
            result[i] = [];
            for (let j = 0; j < n; j++) {
                result[i][j] = matrix[j][n - 1 - i];
            }
        }
        return result;
    }

    function collides(shape, x, y) {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const newX = x + c;
                    const newY = y + r;
                    if (newX < 0 || newX >= COLS || newY >= ROWS) return true;
                    if (newY >= 0 && board[newY][newX]) return true;
                }
            }
        }
        return false;
    }

    function lockPiece() {
        const { shape, x, y, color } = current;
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const bx = x + c;
                    const by = y + r;
                    if (by < 0) { triggerGameOver(); return; }
                    board[by][bx] = color;
                }
            }
        }
        clearLines();
        canHold = true;
        spawnPiece();
    }

    function clearLines() {
        clearingLines = [];
        for (let r = ROWS - 1; r >= 0; r--) {
            if (board[r].every(cell => cell !== null)) {
                clearingLines.push(r);
            }
        }
        if (clearingLines.length > 0) {
            clearFlashTimer = 12; // frames of flash
            const linesCleared = clearingLines.length;
            lines += linesCleared;
            score += SCORE_LINES[Math.min(linesCleared, 4)] * (level + 1);
            // Remove lines after flash
            setTimeout(() => {
                clearingLines.sort((a, b) => b - a);
                for (const row of clearingLines) {
                    board.splice(row, 1);
                    board.unshift(new Array(COLS).fill(null));
                }
                clearingLines = [];
                updateLevel();
            }, 200);
        }
    }

    function updateLevel() {
        const newLevel = Math.min(Math.floor(lines / LINES_PER_LEVEL), LEVELS.length - 1);
        if (newLevel !== level) {
            level = newLevel;
            const lvl = LEVELS[level];
            modelNameEl.textContent = lvl.name;
            modelCtxEl.textContent = lvl.ctx + ' context';
        }
        // Speed increases with level
        const lvl = LEVELS[level];
        dropInterval = Math.max(80, 1000 / lvl.speed);
        updateUI();
    }

    function spawnPiece() {
        fillNextQueue();
        const type = nextQueue.shift();
        fillNextQueue();

        const def = PIECES[type];
        const shape = def.shape.map(row => [...row]);
        const x = Math.floor((COLS - shape[0].length) / 2);
        const y = -1;

        current = { type, shape, x, y, color: def.color };

        if (collides(shape, x, y + 1) && collides(shape, x, y)) {
            triggerGameOver();
        }
    }

    function triggerGameOver() {
        gameOver = true;
        cancelAnimationFrame(animFrame);
        overlayTitle.textContent = 'CONTEXT OVERFLOW';
        overlaySubtitle.textContent = `${formatTokens(score)} tokens packed · Level ${level + 1}: ${LEVELS[level].name}`;
        btnStart.textContent = 'Try Again';
        overlay.classList.remove('hidden');
    }

    // ─── Ghost piece (preview drop location) ───
    function getGhostY() {
        let gy = current.y;
        while (!collides(current.shape, current.x, gy + 1)) {
            gy++;
        }
        return gy;
    }

    // ─── Hold piece ───
    function doHold() {
        if (!canHold) return;
        canHold = false;

        const type = current.type;
        if (holdPiece) {
            const def = PIECES[holdPiece];
            const shape = def.shape.map(row => [...row]);
            const x = Math.floor((COLS - shape[0].length) / 2);
            current = { type: holdPiece, shape, x, y: -1, color: def.color };
            holdPiece = type;
        } else {
            holdPiece = type;
            spawnPiece();
        }
    }

    // ─── Movement ───
    function moveLeft() {
        if (!collides(current.shape, current.x - 1, current.y)) {
            current.x--;
        }
    }

    function moveRight() {
        if (!collides(current.shape, current.x + 1, current.y)) {
            current.x++;
        }
    }

    function softDrop() {
        if (!collides(current.shape, current.x, current.y + 1)) {
            current.y++;
            score += SCORE_SOFT_DROP;
            lastDrop = performance.now();
        }
    }

    function hardDrop() {
        let dropDist = 0;
        while (!collides(current.shape, current.x, current.y + 1)) {
            current.y++;
            dropDist++;
        }
        score += dropDist * SCORE_HARD_DROP;
        lockPiece();
        lastDrop = performance.now();
    }

    function rotateCW() {
        const rotated = rotateMatrix(current.shape);
        // Try basic rotation, then wall kicks
        const kicks = [0, -1, 1, -2, 2];
        for (const kick of kicks) {
            if (!collides(rotated, current.x + kick, current.y)) {
                current.shape = rotated;
                current.x += kick;
                return;
            }
        }
    }

    function rotateCCW() {
        const rotated = rotateMatrixCCW(current.shape);
        const kicks = [0, 1, -1, 2, -2];
        for (const kick of kicks) {
            if (!collides(rotated, current.x + kick, current.y)) {
                current.shape = rotated;
                current.x += kick;
                return;
            }
        }
    }

    // ─── Drawing ───
    function drawBlock(ctx, x, y, color, size, ghost) {
        const padding = 1;
        const bx = x * size + padding;
        const by = y * size + padding;
        const bs = size - padding * 2;

        if (ghost) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.25;
            ctx.strokeRect(bx, by, bs, bs);
            ctx.globalAlpha = 1;
            return;
        }

        // Fill
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(bx, by, bs, bs);

        // Highlight top-left
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(bx, by, bs, 2);
        ctx.fillRect(bx, by, 2, bs);

        // Shadow bottom-right
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(bx, by + bs - 2, bs, 2);
        ctx.fillRect(bx + bs - 2, by, 2, bs);

        ctx.globalAlpha = 1;
    }

    function drawBoard() {
        boardCtx.clearRect(0, 0, BOARD_W, BOARD_H);

        // Grid lines
        boardCtx.strokeStyle = '#111125';
        boardCtx.lineWidth = 0.5;
        for (let c = 1; c < COLS; c++) {
            boardCtx.beginPath();
            boardCtx.moveTo(c * BLOCK_SIZE, 0);
            boardCtx.lineTo(c * BLOCK_SIZE, BOARD_H);
            boardCtx.stroke();
        }
        for (let r = 1; r < ROWS; r++) {
            boardCtx.beginPath();
            boardCtx.moveTo(0, r * BLOCK_SIZE);
            boardCtx.lineTo(BOARD_W, r * BLOCK_SIZE);
            boardCtx.stroke();
        }

        // Locked blocks
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c]) {
                    // Flash clearing lines
                    if (clearingLines.includes(r) && clearFlashTimer > 0) {
                        drawBlock(boardCtx, c, r, '#ffffff', BLOCK_SIZE, false);
                    } else {
                        drawBlock(boardCtx, c, r, board[r][c], BLOCK_SIZE, false);
                    }
                }
            }
        }

        if (current && !gameOver) {
            // Ghost piece
            const ghostY = getGhostY();
            for (let r = 0; r < current.shape.length; r++) {
                for (let c = 0; c < current.shape[r].length; c++) {
                    if (current.shape[r][c]) {
                        const py = ghostY + r;
                        if (py >= 0) {
                            drawBlock(boardCtx, current.x + c, py, current.color, BLOCK_SIZE, true);
                        }
                    }
                }
            }

            // Active piece
            for (let r = 0; r < current.shape.length; r++) {
                for (let c = 0; c < current.shape[r].length; c++) {
                    if (current.shape[r][c]) {
                        const py = current.y + r;
                        if (py >= 0) {
                            drawBlock(boardCtx, current.x + c, py, current.color, BLOCK_SIZE, false);
                        }
                    }
                }
            }
        }
    }

    function drawPreviewPiece(ctx, canvasW, canvasH, type, offsetY) {
        if (!type) return;
        const def = PIECES[type];
        const shape = def.shape;
        const previewSize = 20;
        const w = shape[0].length * previewSize;
        const h = shape.length * previewSize;
        const ox = (canvasW - w) / 2;
        const oy = offsetY + (60 - h) / 2;

        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const bx = ox + c * previewSize + 1;
                    const by = oy + r * previewSize + 1;
                    const bs = previewSize - 2;
                    ctx.fillStyle = def.color;
                    ctx.globalAlpha = 0.8;
                    ctx.fillRect(bx, by, bs, bs);
                    ctx.fillStyle = 'rgba(255,255,255,0.12)';
                    ctx.fillRect(bx, by, bs, 2);
                    ctx.fillRect(bx, by, 2, bs);
                    ctx.globalAlpha = 1;
                }
            }
        }

        // Label
        ctx.fillStyle = '#4a5068';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(def.name, canvasW / 2, offsetY + 68);
    }

    function drawHold() {
        holdCtx.clearRect(0, 0, 120, 100);
        if (holdPiece) {
            drawPreviewPiece(holdCtx, 120, 100, holdPiece, 10);
        }
    }

    function drawNext() {
        nextCtx.clearRect(0, 0, 120, 280);
        nextQueue.forEach((type, i) => {
            drawPreviewPiece(nextCtx, 120, 280, type, i * 90 + 5);
        });
    }

    function formatTokens(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toString();
    }

    function updateUI() {
        scoreEl.textContent = formatTokens(score);
        linesEl.textContent = lines;
        levelEl.textContent = level + 1;
        const lvl = LEVELS[level];
        speedEl.textContent = lvl.speed.toFixed(1) + 'x';
        modelNameEl.textContent = lvl.name;
        modelCtxEl.textContent = lvl.ctx + ' context';
    }

    // ─── Game loop ───
    function gameLoop(time) {
        if (gameOver) return;
        if (paused) {
            animFrame = requestAnimationFrame(gameLoop);
            return;
        }

        // Auto drop
        if (time - lastDrop > dropInterval) {
            if (!collides(current.shape, current.x, current.y + 1)) {
                current.y++;
            } else {
                lockPiece();
            }
            lastDrop = time;
        }

        // Flash timer
        if (clearFlashTimer > 0) clearFlashTimer--;

        // Draw everything
        drawBoard();
        drawHold();
        drawNext();
        updateUI();

        animFrame = requestAnimationFrame(gameLoop);
    }

    // ─── Input ───
    document.addEventListener('keydown', (e) => {
        if (gameOver || !started) return;

        if (e.key === 'p' || e.key === 'P') {
            paused = !paused;
            if (paused) {
                overlayTitle.textContent = 'PAUSED';
                overlaySubtitle.textContent = 'Press P to resume';
                btnStart.textContent = 'Resume';
                overlay.classList.remove('hidden');
            } else {
                overlay.classList.add('hidden');
            }
            return;
        }

        if (paused) return;

        switch (e.key) {
            case 'ArrowLeft':
            case 'a':
                e.preventDefault();
                moveLeft();
                break;
            case 'ArrowRight':
            case 'd':
                e.preventDefault();
                moveRight();
                break;
            case 'ArrowDown':
            case 's':
                e.preventDefault();
                softDrop();
                break;
            case ' ':
                e.preventDefault();
                hardDrop();
                break;
            case 'ArrowUp':
            case 'x':
                e.preventDefault();
                rotateCW();
                break;
            case 'z':
            case 'Z':
                e.preventDefault();
                rotateCCW();
                break;
            case 'c':
            case 'C':
                e.preventDefault();
                doHold();
                break;
        }
    });

    // ─── Mobile controls ───
    document.querySelectorAll('.mobile-btn').forEach(btn => {
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (gameOver || !started || paused) return;
            const action = btn.dataset.action;
            switch (action) {
                case 'left': moveLeft(); break;
                case 'right': moveRight(); break;
                case 'down': softDrop(); break;
                case 'drop': hardDrop(); break;
                case 'rotate': rotateCW(); break;
                case 'hold': doHold(); break;
            }
        });
    });

    // ─── Start / Restart ───
    function startGame() {
        createBoard();
        score = 0;
        lines = 0;
        level = 0;
        gameOver = false;
        paused = false;
        holdPiece = null;
        canHold = true;
        bag = [];
        nextQueue = [];
        clearingLines = [];
        clearFlashTimer = 0;
        dropInterval = 1000;
        lastDrop = performance.now();
        started = true;

        const lvl = LEVELS[0];
        modelNameEl.textContent = lvl.name;
        modelCtxEl.textContent = lvl.ctx + ' context';

        fillNextQueue();
        spawnPiece();
        overlay.classList.add('hidden');

        cancelAnimationFrame(animFrame);
        animFrame = requestAnimationFrame(gameLoop);
    }

    btnStart.addEventListener('click', () => {
        if (paused) {
            paused = false;
            overlay.classList.add('hidden');
        } else {
            startGame();
        }
    });

    // ─── Initial overlay ───
    overlay.classList.remove('hidden');
    overlayTitle.textContent = 'CONTEXT TETRIS';
    overlaySubtitle.textContent = 'Pack tokens into the context window';
    btnStart.textContent = 'Start Game';

    // Draw empty board initially
    drawBoard();

})();
