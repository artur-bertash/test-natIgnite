/*
  Parmi — Exercise Selection & Arm Bends
  - Exercise selection interface with type and intensity options
  - Uses DeviceMotion/DeviceOrientation to infer arm bend repetitions
  - Low-pass filtering + hysteresis to reduce noise and avoid double counts
  - Gamified coloring grid that fills tiles as reps are completed
  - Integrated auditory feedback with alternating beats
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

    // Audio Elements
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
        // Hysteresis
        thresholdDeg: 30,
        hysteresisDeg: 6,
        phase: 'neutral', // 'neutral' | 'bent'
        // Timing
        lastPeakTs: 0,
        minRepMs: 400,
    };

    // Populate grid
    function buildGrid(tileCount) {
        elGrid.innerHTML = '';
        const columns = Math.ceil(Math.sqrt(tileCount * (6 / 5)));
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
    }

    function updateTiltReadout(angleDeg) {
        elTiltReadout.textContent = String(Math.round(angleDeg));
    }

    function updateMotionStatus(isActive) {
        if (elMotionStatus) {
            elMotionStatus.className = `status-indicator ${isActive ? 'active' : 'inactive'}`;
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
    
    // Simplified function to play the alternating sound for each rep
    function playRepSound() {
        if (!elSound1 || !elSound2) return;
        const isEvenBeat = (state.reps - 1) % 2 === 0;
        const soundToPlay = isEvenBeat ? elSound1 : elSound2;
        soundToPlay.currentTime = 0;
        soundToPlay.play().catch(e => console.warn("Audio playback failed:", e));
    }

    // Motion permission handling
    async function requestPermissionIfNeeded() {
        try {
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                const permissionState = await DeviceMotionEvent.requestPermission();
                state.hasPermission = permissionState === 'granted';
                if (state.hasPermission) {
                    elPermissionOverlay.style.display = 'none';
                }
            } else {
                // Non-iOS 13+ browsers
                state.hasPermission = true;
                elPermissionOverlay.style.display = 'none';
            }
        } catch (error) {
            console.error('Permission request failed', error);
        }
    }

    // ... (lowPassFilter and estimateTiltDeg functions remain the same)
    function lowPassFilter(prev, next, alpha) { return prev + alpha * (next - prev); }
    let latestOrientation = { beta: 0, has: false };
    let latestAccel = { x: 0, y: 0, z: 0, has: false };
    function estimateTiltDeg() {
        if (latestOrientation.has && Number.isFinite(latestOrientation.beta)) {
            let beta = latestOrientation.beta;
            if (beta > 180) beta -= 360;
            if (beta < -180) beta += 360;
            return beta;
        }
        if (latestAccel.has) {
            const { y, z } = latestAccel;
            return Math.atan2(y, z) * (180 / Math.PI);
        }
        return 0;
    }

    // Rep detection via hysteresis
    function processAngle(angleDeg, timestampMs) {
        const relative = angleDeg - state.neutralAngleDeg;
        const absRel = Math.abs(relative);

        if (state.phase === 'neutral' && absRel >= state.thresholdDeg) {
            state.phase = 'bent';
        } else if (state.phase === 'bent' && absRel <= state.hysteresisDeg) {
            if (timestampMs - state.lastPeakTs >= state.minRepMs) {
                state.reps = Math.min(state.goal, state.reps + 1);
                state.lastPeakTs = timestampMs;
                
                // INTEGRATION POINT: Play sound on successful rep
                playRepSound();
                
                updateStats();
                colorTiles();
            }
            state.phase = 'neutral';
        }
    }

    // Event listeners
    function onOrientation(event) {
        if (state.running && typeof event.beta === 'number') {
            latestOrientation = { beta: event.beta, has: true };
        }
    }
    function onMotion(event) {
        if (state.running && event.accelerationIncludingGravity) {
            const { x, y, z } = event.accelerationIncludingGravity;
            latestAccel = { x, y, z, has: true };
        }
    }

    // Frame loop
    const alpha = 0.12;
    function tick(ts) {
        if (state.running) {
            const angle = estimateTiltDeg();
            state.filteredAngleDeg = lowPassFilter(state.filteredAngleDeg, angle, alpha);
            updateTiltReadout(state.filteredAngleDeg);
            processAngle(state.filteredAngleDeg, performance.now());
        }
        requestAnimationFrame(tick);
    }

    // Button handlers
    elPermissionOverlay.addEventListener('click', requestPermissionIfNeeded);
    elCalibrate.addEventListener('click', () => { /* ... calibration logic ... */ });

    elStart.addEventListener('click', () => {
        // *** THE FIX: PRIME THE AUDIO ON USER CLICK ***
        // This "unlocks" the audio so it can be played by the script later.
        elSound1.load();
        elSound2.load();

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
        updateStats();
        colorTiles();
    });

    // Exercise selection functions
    function checkSelectionComplete() {
        const hasExercise = elExerciseSelect.value !== "";
        const hasIntensity = elIntensitySelect.value !== "";
        elStartExercise.disabled = !(hasExercise && hasIntensity);
    }

    function showExercisePage() {
        elSelectionPage.style.display = 'none';
        elExercisePage.style.display = 'grid';

        const intensity = intensityData[elIntensitySelect.value];
        state.goal = intensity.reps;
        updateStats();
        buildGrid(state.goal);
        colorTiles();

        const exercise = exerciseData[elExerciseSelect.value];
        elExerciseSubtitle.textContent = `${exercise.name} - ${intensity.name} (${intensity.reps} reps)`;
    }

    function showSelectionPage() {
        elExercisePage.style.display = 'none';
        elSelectionPage.style.display = 'grid';
        setRunning(false);
        state.reps = 0;
        state.phase = 'neutral';
        updateStats();
    }

    elExerciseSelect.addEventListener('change', checkSelectionComplete);
    elIntensitySelect.addEventListener('change', checkSelectionComplete);
    elStartExercise.addEventListener('click', showExercisePage);
    elBackToSelection.addEventListener('click', showSelectionPage);

    // Init
    function init() {
        // Show permission overlay only if needed (iOS 13+)
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            elPermissionOverlay.style.display = 'grid';
        }

        buildGrid(state.goal);
        updateStats();
        requestAnimationFrame(tick);
        showSelectionPage();
    }

    init();
})();