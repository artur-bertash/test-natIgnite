/*
  Parmi — Exercise Selection & Arm Bends
  - Exercise selection interface with type and intensity options
  - Uses DeviceMotion/DeviceOrientation to infer arm bend repetitions
  - Low-pass filtering + hysteresis to reduce noise and avoid double counts
  - Gamified coloring grid that fills tiles as reps are completed
  - Integrated auditory feedback with alternating beats synced to motion start/end
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
        'moderate': { name: 'Moderate', reps: 20 },
        'vigorous': { name: 'Vigorous', reps: 50 }
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
    const elPaintingImage = document.getElementById('painting-image');
    const elPaintingProgressText = document.getElementById('painting-progress-text');

    // Audio Elements
    const elSound1 = document.getElementById('sound1');
    const elSound2 = document.getElementById('sound2');

    // Session state
    const state = {
        hasPermission: false,
        running: false,
        reps: 0,
        goal: 20,
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

    // Initialize painting display
    function initializePainting() {
        elPaintingImage.src = 'paintLakeLuis/paint0.jpg';
        elPaintingProgressText.textContent = `0 / ${state.goal}`;
        elPaintingProgressText.classList.remove('complete', 'cycle-info');
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

    function updatePainting() {
        const currentRep = Math.min(state.reps, state.goal);
        
        // For goals > 20, cycle through the 20 painting images
        let imageIndex;
        if (state.goal <= 20) {
            imageIndex = Math.min(currentRep, 20);
        } else {
            // Cycle through images: 0-19, then repeat
            imageIndex = currentRep % 20;
            // Show final image (paint20.jpg) when complete
            if (currentRep >= state.goal) {
                imageIndex = 20;
            }
        }
        
        const imagePath = `paintLakeLuis/paint${imageIndex}.jpg`;
        
        // Add animation class
        elPaintingImage.classList.add('progressing');
        
        // Update image source
        elPaintingImage.src = imagePath;
        
        // Update progress text to show current reps vs goal
        if (state.reps >= state.goal) {
            elPaintingProgressText.textContent = `Complete! 🎨`;
            elPaintingProgressText.classList.add('complete');
            elPaintingProgressText.classList.remove('cycle-info');
        } else {
            if (state.goal > 20) {
                const currentCycle = Math.floor(currentRep / 20) + 1;
                const totalCycles = Math.ceil(state.goal / 20);
                elPaintingProgressText.textContent = `${currentRep} / ${state.goal} (Cycle ${currentCycle}/${totalCycles})`;
                elPaintingProgressText.classList.add('cycle-info');
            } else {
                elPaintingProgressText.textContent = `${currentRep} / ${state.goal}`;
                elPaintingProgressText.classList.remove('cycle-info');
            }
            elPaintingProgressText.classList.remove('complete');
        }
        
        // Remove animation class after animation completes
        setTimeout(() => {
            elPaintingImage.classList.remove('progressing');
        }, 500);
    }

    function setRunning(isRunning) {
        state.running = isRunning;
        elStart.disabled = isRunning;
        elStop.disabled = !isRunning;
        updateMotionStatus(isRunning);
    }
    
    // **FIX #2:** New function to play sound based on motion phase
    function playActionSound(action) { // action can be 'start' or 'complete'
        if (!elSound1 || !elSound2) return;
        const soundToPlay = (action === 'start') ? elSound1 : elSound2;
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
                state.hasPermission = true;
                elPermissionOverlay.style.display = 'none';
            }
        } catch (error) {
            console.error('Permission request failed', error);
        }
    }

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

    // **FIX #2:** Rep detection logic updated for two-part sounds
    function processAngle(angleDeg, timestampMs) {
        const relative = angleDeg - state.neutralAngleDeg;
        const absRel = Math.abs(relative);

        if (state.phase === 'neutral' && absRel >= state.thresholdDeg) {
            // Motion starts: play the first sound
            state.phase = 'bent';
            playActionSound('start');
        } else if (state.phase === 'bent' && absRel <= state.hysteresisDeg) {
            // Motion completes: play the second sound and count the rep
            if (timestampMs - state.lastPeakTs >= state.minRepMs) {
                state.reps = Math.min(state.goal, state.reps + 1);
                state.lastPeakTs = timestampMs;
                
                playActionSound('complete');
                
                updateStats();
                updatePainting();
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

    // **FIX #1:** Correctly implement the calibration logic
    elCalibrate.addEventListener('click', () => {
        // Set the neutral "zero" angle to the device's current filtered angle
        state.neutralAngleDeg = state.filteredAngleDeg;
        // Provide visual feedback that calibration happened
        elCalibrate.style.transform = 'scale(0.95)';
        elCalibrate.textContent = "Calibrated!";
        setTimeout(() => { 
            elCalibrate.style.transform = 'scale(1)';
            elCalibrate.textContent = "Calibrate Neutral";
         }, 750);
    });

    elStart.addEventListener('click', () => {
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
        elPaintingProgressText.classList.remove('complete', 'cycle-info');
        updateStats();
        updatePainting();
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
        initializePainting(); // Call the new function here
        updatePainting();

        const exercise = exerciseData[elExerciseSelect.value];
        elExerciseSubtitle.textContent = `${exercise.name} - ${intensity.name} (${intensity.reps} reps)`;
    }

    function showSelectionPage() {
        elExercisePage.style.display = 'none';
        elSelectionPage.style.display = 'grid';
        setRunning(false);
        state.reps = 0;
        state.phase = 'neutral';
        elPaintingProgressText.classList.remove('complete', 'cycle-info');
        updateStats();
        updatePainting();
    }

    elExerciseSelect.addEventListener('change', checkSelectionComplete);
    elIntensitySelect.addEventListener('change', checkSelectionComplete);
    elStartExercise.addEventListener('click', showExercisePage);
    elBackToSelection.addEventListener('click', showSelectionPage);

    // Init
    function init() {
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            elPermissionOverlay.style.display = 'grid';
        }
        initializePainting(); // Call the new function here
        updateStats();
        requestAnimationFrame(tick);
        showSelectionPage();
    }

    init();
})();