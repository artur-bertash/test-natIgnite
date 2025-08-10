/*
  Parmi — Exercise Selection & Arm Bends
  - Exercise selection interface with type and intensity options
  - Uses DeviceMotion/DeviceOrientation to infer arm bend repetitions
  - Low-pass filtering + hysteresis to reduce noise and avoid double counts
  - Gamified coloring grid that fills tiles as reps are completed
  - Integrated auditory feedback with alternating beats and BPM calculation
*/

(function () {
    // Exercise selection elements
    const elSelectionPage = document.getElementById('selection-page');
    const elExercisePage = document.getElementById('exercise-page');
    const elStartExercise = document.getElementById('btn-start-exercise');
    const elBackToSelection = document.getElementById('btn-back-to-selection');
    const elExerciseSubtitle = document.getElementById('exercise-subtitle');

    // Exercise dropdowns
    const elExerciseSelect = document.getElementById('exercise-select');
    const elIntensitySelect = document.getElementById('intensity-select');

    // Exercise data
    const exerciseData = {
        'lateral-raises': { name: 'Lateral Raises', category: 'Arms' },
        'elbow-stretch': { name: 'Elbow Stretch', category: 'Arms' },
        'wrist-exercise': { name: 'Wrist Exercise', category: 'Arms' },
        'straight-leg-raise': { name: 'Straight Leg Raise', category: 'Legs' },
        'ankle-rom': { name: 'Ankle Range-of-Motion', category: 'Legs' },
        'hip-abduction': { name: 'Hip Abduction', category: 'Legs' }
    };

    const intensityData = {
        'light': { name: 'Light', reps: 10 },
        'moderate': { name: 'Moderate', reps: 15 },
        'vigorous': { name: 'Vigorous', reps: 30 }
    };

    // Original elements
    const elPermissionStatus = document.getElementById('permission-status');
    const elPermissionOverlay = document.getElementById('permission-overlay');
    const elMotionStatus = document.getElementById('motion-status');
    const elStart = document.getElementById('btn-start');
    const elStop = document.getElementById('btn-stop');
    const elReset = document.getElementById('btn-reset');
    const elCalibrate = document.getElementById('btn-calibrate');
    const elRepCount = document.getElementById('rep-count');
    const elRepGoal = document.getElementById('rep-goal');
    const elTiltReadout = document.getElementById('tilt-readout');
    const elProgressBar = document.getElementById('progress-bar');
    const elGrid = document.getElementById('coloring-grid');
    
    // NEW: BPM and Audio Elements
    const elBpmValue = document.getElementById('bpm-value');
    const elSound1 = document.getElementById('sound1');
    const elSound2 = document.getElementById('sound2');

    // Session state
    const state = {
        hasPermission: false,
        running: false,
        reps: 0,
        goal: 30,
        selectedExercise: null,
        selectedIntensity: null,
        // Orientation and filtering
        neutralAngleDeg: 0,
        filteredAngleDeg: 0,
        prevAngleDeg: 0,
        // Hysteresis
        thresholdDeg: 30,
        hysteresisDeg: 6,
        phase: 'neutral',
        // Timing
        lastPeakTs: 0,
        minRepMs: 400,
        // NEW: BPM State
        batchStartTime: 0,
        latestBPM: 0,
    };

    // Populate grid
    function buildGrid(tileCount) {
        elGrid.innerHTML = '';
        // Adjust grid columns for better visualization with more reps
        const columns = Math.ceil(Math.sqrt(tileCount * (6/5))); // aspect ratio bias
        elGrid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;

        for (let i = 0; i < tileCount; i += 1) {
            const div = document.createElement('div');
            div.className = 'tile';
            div.dataset.index = String(i);
            const fill = document.createElement('div');
            fill.className = 'tile__fill';
            div.appendChild(fill);
            elGrid.appendChild(div);
        }
    }

    // Update UI
    function updateStats() {
        elRepCount.textContent = String(state.reps);
        elRepGoal.textContent = String(state.goal);
        const pct = Math.max(0, Math.min(100, (state.reps / state.goal) * 100));
        elProgressBar.style.width = `${pct}%`;

        // NEW: Update BPM Display
        if (elBpmValue) {
            elBpmValue.textContent = state.latestBPM > 0 ? String(state.latestBPM) : '--';
        }
    }

    function updateTiltReadout(angleDeg) {
        elTiltReadout.textContent = String(Math.round(angleDeg));
    }

    function updateMotionStatus(isActive) {
        if (elMotionStatus) {
            const indicator = elMotionStatus.parentElement;
            indicator.className = `status-indicator ${isActive ? 'active' : 'inactive'}`;
        }
    }

    function colorTiles() {
        const tiles = elGrid.querySelectorAll('.tile');
        tiles.forEach((t, idx) => {
            if (idx < state.reps) {
                t.classList.add('tile--on');
            } else {
                t.classList.remove('tile--on');
            }
        });
    }

    function setRunning(isRunning) {
        state.running = isRunning;
        elStart.disabled = isRunning;
        elStop.disabled = !isRunning;
        updateMotionStatus(isRunning);
    }
    
    // NEW: Function to handle beat sounds and BPM calculation
    function playBeatAndCalcBPM() {
        // 1. Play alternating beat sound for each rep
        const isEvenBeat = (state.reps - 1) % 2 === 0;
        const sound = isEvenBeat ? elSound1 : elSound2;
        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.error("Audio playback failed. User may need to interact with the page first.", e));
        }

        // 2. Calculate BPM in batches of 30
        const repsInBatch = 30;
        // Check if this is the first rep of a new batch (e.g., rep 1, 31, 61...)
        if ((state.reps - 1) % repsInBatch === 0) {
            state.batchStartTime = performance.now();
        }
        
        // Check if this is the last rep of a batch (e.g., rep 30, 60, 90...)
        if (state.reps > 0 && state.reps % repsInBatch === 0) {
            const batchEndTime = performance.now();
            const elapsedMs = batchEndTime - state.batchStartTime;
            if (elapsedMs > 0) {
               state.latestBPM = Math.round((repsInBatch / elapsedMs) * 60000);
            }
        }
    }

    // Motion permission handling
    async function requestPermissionIfNeeded() {
        // ... (this function remains unchanged)
    }

    // Utilities
    function lowPassFilter(prev, next, alpha) {
        return prev + alpha * (next - prev);
    }

    // Determine primary angle
    let latestOrientation = { beta: 0, has: false };
    let latestAccel = { x: 0, y: 0, z: 0, has: false };
    function estimateTiltDeg() {
        // ... (this function remains unchanged)
    }

    // Rep detection via hysteresis
    function processAngle(angleDeg, timestampMs) {
        const relative = angleDeg - state.neutralAngleDeg;
        const absRel = Math.abs(relative);

        if (state.phase === 'neutral') {
            if (absRel >= state.thresholdDeg) {
                state.phase = 'bent';
            }
        } else if (state.phase === 'bent') {
            if (absRel <= state.hysteresisDeg) {
                if (timestampMs - state.lastPeakTs >= state.minRepMs) {
                    state.reps = Math.min(state.goal, state.reps + 1);
                    state.lastPeakTs = timestampMs;
                    
                    // INTEGRATION POINT: Play sound and update BPM on successful rep
                    playBeatAndCalcBPM();
                    
                    updateStats();
                    colorTiles();
                }
                state.phase = 'neutral';
            }
        }
    }

    // Event listeners
    function onOrientation(event) {
        // ... (this function remains unchanged)
    }
    function onMotion(event) {
        // ... (this function remains unchanged)
    }

    // Frame loop
    const alpha = 0.12;
    function tick(ts) {
        // ... (this function remains unchanged)
    }

    // Button handlers
    function showPermissionOverlayIfNeeded() {
        // ... (this function remains unchanged)
    }

    elCalibrate.addEventListener('click', () => {
        // ... (this function remains unchanged)
    });

    elStart.addEventListener('click', () => {
        if (!state.hasPermission) {
            if (elPermissionStatus) {
                elPermissionStatus.textContent = 'Attempting to start without explicit permission…';
            }
        }
        window.addEventListener('deviceorientation', onOrientation, true);
        window.addEventListener('devicemotion', onMotion, true);
        setRunning(true);
    });

    elStop.addEventListener('click', () => {
        setRunning(false);
    });

    elReset.addEventListener('click', () => {
        state.reps = 0;
        state.phase = 'neutral';
        state.lastPeakTs = 0;
        // NEW: Reset BPM state
        state.batchStartTime = 0;
        state.latestBPM = 0;
        updateStats();
        colorTiles();
    });

    // Exercise selection functions
    function checkSelectionComplete() {
        const hasExercise = state.selectedExercise !== null;
        const hasIntensity = state.selectedIntensity !== null;
        elStartExercise.disabled = !(hasExercise && hasIntensity);
    }

    function updateExerciseSubtitle() {
        if (state.selectedExercise && state.selectedIntensity) {
            const exercise = exerciseData[state.selectedExercise];
            const intensity = intensityData[state.selectedIntensity];
            elExerciseSubtitle.textContent = `${exercise.name} - ${intensity.name} (${intensity.reps} reps)`;
        } else {
            elExerciseSubtitle.textContent = 'Exercise in Progress';
        }
    }

    function showExercisePage() {
        elSelectionPage.style.display = 'none';
        elExercisePage.style.display = 'grid';

        if (state.selectedIntensity) {
            const intensity = intensityData[state.selectedIntensity];
            state.goal = intensity.reps;
            updateStats();
            buildGrid(state.goal);
            colorTiles();
        }
        updateExerciseSubtitle();
        showPermissionOverlayIfNeeded();
    }

    function showSelectionPage() {
        elExercisePage.style.display = 'none';
        elSelectionPage.style.display = 'grid';
        setRunning(false);

        // Reset exercise state
        state.reps = 0;
        state.phase = 'neutral';
        state.lastPeakTs = 0;
        // NEW: Reset BPM state when going back
        state.batchStartTime = 0;
        state.latestBPM = 0;
        updateStats();
    }

    // Exercise selection event listeners
    elExerciseSelect.addEventListener('change', (e) => {
        state.selectedExercise = e.target.value;
        checkSelectionComplete();
    });

    elIntensitySelect.addEventListener('change', (e) => {
        state.selectedIntensity = e.target.value;
        checkSelectionComplete();
    });

    elStartExercise.addEventListener('click', () => {
        showExercisePage();
    });

    elBackToSelection.addEventListener('click', () => {
        showSelectionPage();
    });

    // Init
    function init() {
        buildGrid(state.goal);
        updateStats();
        requestAnimationFrame(tick);
        showSelectionPage();
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && elPermissionStatus) {
        elPermissionStatus.textContent = 'iOS requires tapping Enable Motion to start';
    }

    init();
})();