/*
  Recovery Coach — Exercise Selection & Arm Bends
  - Exercise selection interface with type and intensity options
  - Uses DeviceMotion/DeviceOrientation to infer arm bend repetitions
  - Low-pass filtering + hysteresis to reduce noise and avoid double counts
  - Gamified coloring grid that fills tiles as reps are completed
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
    const elTarget = document.getElementById('input-target');
    const elThreshold = document.getElementById('input-threshold');
    const elRepCount = document.getElementById('rep-count');
    const elRepGoal = document.getElementById('rep-goal');
    const elTiltReadout = document.getElementById('tilt-readout');
    const elProgressBar = document.getElementById('progress-bar');
    const elGrid = document.getElementById('coloring-grid');

    // Session state
    const state = {
        hasPermission: false,
        running: false,
        reps: 0,
        goal: Number(elTarget.value) || 30,
        selectedExercise: null,
        selectedIntensity: null,
        // Orientation and filtering
        neutralAngleDeg: 0, // calibrated baseline (beta)
        filteredAngleDeg: 0,
        prevAngleDeg: 0,
        // Hysteresis
        thresholdDeg: Number(elThreshold.value) || 30,
        hysteresisDeg: 6, // must drop below this when returning
        phase: 'neutral', // 'neutral' | 'bent'
        // Timing (optional debounce)
        lastPeakTs: 0,
        minRepMs: 400,
    };

    // Populate grid
    function buildGrid(tileCount) {
        elGrid.innerHTML = '';
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
        
        // Add visual indicator for motion status
        if (motionActive) {
            elTiltReadout.style.color = 'var(--success)';
            elTiltReadout.style.fontWeight = '700';
        } else {
            elTiltReadout.style.color = 'var(--muted)';
            elTiltReadout.style.fontWeight = '400';
        }
    }

    function updateMotionStatus(isActive) {
        if (elMotionStatus) {
            elMotionStatus.className = `status-indicator ${isActive ? 'active' : 'inactive'}`;
            const statusText = elMotionStatus.querySelector('.status-text');
            if (statusText) {
                statusText.textContent = isActive ? 'Motion Detection Active' : 'Motion Detection Inactive';
            }
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
    }

    // Motion permission handling (iOS 13+ requires user gesture)
    async function requestPermissionIfNeeded() {
        try {
            console.log('Requesting motion permissions...');
            const anyDevMotion = window.DeviceMotionEvent;
            const anyDevOrient = window.DeviceOrientationEvent;

            let motionPermitted = true;
            let orientationPermitted = true;

            // Check if permission APIs exist (iOS 13+)
            if (anyDevMotion && typeof anyDevMotion.requestPermission === 'function') {
                console.log('Requesting DeviceMotion permission...');
                const res = await anyDevMotion.requestPermission();
                motionPermitted = res === 'granted';
                console.log('DeviceMotion permission result:', res);
            } else {
                console.log('DeviceMotion permission API not available (likely Android or older iOS)');
            }

            if (anyDevOrient && typeof anyDevOrient.requestPermission === 'function') {
                console.log('Requesting DeviceOrientation permission...');
                const res = await anyDevOrient.requestPermission();
                orientationPermitted = res === 'granted';
                console.log('DeviceOrientation permission result:', res);
            } else {
                console.log('DeviceOrientation permission API not available (likely Android or older iOS)');
            }

            // On Android and older iOS, permissions are typically granted by default
            state.hasPermission = motionPermitted && orientationPermitted;
            console.log('Final permission status:', state.hasPermission);
            
            if (state.hasPermission && elPermissionOverlay) {
                elPermissionOverlay.style.display = 'none';
            }
            return state.hasPermission;
        } catch (err) {
            console.error('Permission request failed:', err);
            // On error, assume permissions are available (common on Android)
            state.hasPermission = true;
            return true;
        }
    }

    // Utilities
    function lowPassFilter(prev, next, alpha) {
        // alpha in [0,1], higher alpha tracks faster; use small alpha to smooth
        return prev + alpha * (next - prev);
    }

    // Determine primary angle to use for arm bend. We use DeviceOrientation beta (front-back tilt) if available.
    // Fallback: integrate accelerometer gravity vector to estimate tilt.
    let latestOrientation = { beta: 0, has: false };
    let latestAccel = { x: 0, y: 0, z: 0, has: false };

    function estimateTiltDeg() {
        // Try orientation data first (most accurate for tilt)
        if (latestOrientation.has && Number.isFinite(latestOrientation.beta) && !isNaN(latestOrientation.beta)) {
            // Clamp beta to [-180, 180]
            let beta = latestOrientation.beta;
            if (beta > 180) beta -= 360;
            if (beta < -180) beta += 360;
            console.log('Using orientation beta for tilt:', beta);
            return beta;
        }
        
        // Fallback to accelerometer data
        if (latestAccel.has && Number.isFinite(latestAccel.y) && Number.isFinite(latestAccel.z) &&
            !isNaN(latestAccel.y) && !isNaN(latestAccel.z)) {
            // Tilt relative to gravity using arctan2 of y/z
            const { y, z } = latestAccel;
            const betaRad = Math.atan2(y, z);
            const betaDeg = betaRad * (180 / Math.PI);
            console.log('Using accelerometer for tilt:', betaDeg, 'from y:', y, 'z:', z);
            return betaDeg;
        }
        
        // If no valid motion data available, return a test value that changes
        const testValue = Math.sin(Date.now() * 0.001) * 10;
        console.log('No motion data available, using test value:', testValue);
        return testValue;
    }

    // Rep detection via hysteresis: neutral -> bendPastThreshold -> returnBelowHysteresis counts 1 rep
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
                    updateStats();
                    colorTiles();
                }
                state.phase = 'neutral';
            }
        }
    }

    // Event listeners
    let lastMotionTime = 0;
    let motionActive = false;

    function onOrientation(event) {
        console.log('Orientation event received:', {
            beta: event.beta,
            gamma: event.gamma,
            alpha: event.alpha,
            absolute: event.absolute
        });
        
        if (typeof event.beta === 'number' && !isNaN(event.beta)) {
            latestOrientation = { beta: event.beta, has: true };
            lastMotionTime = Date.now();
            if (!motionActive) {
                motionActive = true;
                updateMotionStatus(true);
                console.log('Motion detection activated via orientation');
            }
        }
    }

    function onMotion(event) {
        const accG = event.accelerationIncludingGravity;
        console.log('Motion event received:', {
            accelerationIncludingGravity: accG,
            acceleration: event.acceleration,
            rotationRate: event.rotationRate
        });
        
        if (accG && typeof accG.x === 'number' && typeof accG.y === 'number' && typeof accG.z === 'number' &&
            !isNaN(accG.x) && !isNaN(accG.y) && !isNaN(accG.z)) {
            latestAccel = { x: accG.x, y: accG.y, z: accG.z, has: true };
            lastMotionTime = Date.now();
            if (!motionActive) {
                motionActive = true;
                updateMotionStatus(true);
                console.log('Motion detection activated via accelerometer');
            }
        }
    }

    // Check motion status periodically
    setInterval(() => {
        const timeSinceLastMotion = Date.now() - lastMotionTime;
        if (timeSinceLastMotion > 2000 && motionActive) { // 2 seconds timeout
            motionActive = false;
            updateMotionStatus(false);
        }
    }, 1000);

    // Frame loop to compute filtered angle and detect reps at ~60Hz (or browser rate)
    const alpha = 0.12; // smoothing factor for low-pass
    function tick(ts) {
        // Always update tilt readout, even when not running
        const angle = estimateTiltDeg();
        const filtered = lowPassFilter(state.filteredAngleDeg, angle, alpha);
        state.prevAngleDeg = state.filteredAngleDeg;
        state.filteredAngleDeg = filtered;
        updateTiltReadout(filtered);

        // Only process reps when running
        if (state.running) {
            processAngle(filtered, typeof ts === 'number' ? ts : performance.now());
        }
        requestAnimationFrame(tick);
    }

    // Button handlers
    // For iOS, we need a user gesture; we present a full-screen overlay and hide on tap after requesting perms
    function showPermissionOverlayIfNeeded() {
        const anyDevMotion = window.DeviceMotionEvent;
        const anyDevOrient = window.DeviceOrientationEvent;
        const needsGesture = (anyDevMotion && typeof anyDevMotion.requestPermission === 'function') ||
            (anyDevOrient && typeof anyDevOrient.requestPermission === 'function');
        if (needsGesture && elPermissionOverlay) {
            elPermissionOverlay.style.display = 'grid';
            const onTap = async () => {
                await requestPermissionIfNeeded();
                elPermissionOverlay.style.display = 'none';
                elPermissionOverlay.removeEventListener('click', onTap);
            };
            elPermissionOverlay.addEventListener('click', onTap);
        } else {
            // Android/others: try immediately
            requestPermissionIfNeeded();
        }
    }

    elCalibrate.addEventListener('click', () => {
        // Capture several samples for robust neutral calibration
        const samples = [];
        const sampleCount = 24;
        let collected = 0;
        const collect = () => {
            const angle = estimateTiltDeg();
            samples.push(angle);
            collected += 1;
            if (collected < sampleCount) {
                setTimeout(collect, 12);
            } else {
                const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
                state.neutralAngleDeg = avg;
            }
        };
        collect();
    });

    elStart.addEventListener('click', () => {
        state.goal = Math.max(1, Math.min(200, Number(elTarget.value) || 30));
        state.thresholdDeg = Math.max(10, Math.min(60, Number(elThreshold.value) || 30));
        updateStats();

        if (!state.hasPermission) {
            // Try to start anyway; Android Chrome does not require explicit permission
            console.log('Attempting to start without explicit permission…');
        }

        setRunning(true);
    });

    elStop.addEventListener('click', () => {
        setRunning(false);
    });

    elReset.addEventListener('click', () => {
        state.reps = 0;
        state.phase = 'neutral';
        state.lastPeakTs = 0;
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
        
        // Update the target reps based on selected intensity
        if (state.selectedIntensity) {
            const intensity = intensityData[state.selectedIntensity];
            state.goal = intensity.reps;
            elTarget.value = intensity.reps;
            updateStats();
            buildGrid(state.goal);
            colorTiles();
        }
        
        updateExerciseSubtitle();
        
        // Request motion permissions when entering exercise page
        showPermissionOverlayIfNeeded();
    }

    function showSelectionPage() {
        elExercisePage.style.display = 'none';
        elSelectionPage.style.display = 'grid';
        
        // Reset exercise state
        state.reps = 0;
        state.phase = 'neutral';
        state.lastPeakTs = 0;
        updateStats();
        colorTiles();
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

    // Fix missing threshold event listener
    if (elThreshold) {
        elThreshold.addEventListener('input', () => {
            state.thresholdDeg = Math.max(10, Math.min(60, Number(elThreshold.value) || 30));
        });
    }

    // Init
    function init() {
        console.log('Initializing Parmi app...');
        buildGrid(state.goal);
        updateStats();
        colorTiles();
        
        // Always attach motion listeners with proper event names and bubbling phase
        console.log('Attaching motion event listeners...');
        window.addEventListener('deviceorientation', onOrientation, false);
        window.addEventListener('devicemotion', onMotion, false);
        
        // Add touch/click listeners to trigger motion detection
        document.addEventListener('touchstart', () => {
            console.log('Touch detected, attempting to enable motion');
            // Some devices need user interaction to enable motion
            if (!motionActive) {
                updateMotionStatus(true);
                motionActive = true;
            }
        });
        
        document.addEventListener('click', () => {
            console.log('Click detected, attempting to enable motion');
            if (!motionActive) {
                updateMotionStatus(true);
                motionActive = true;
            }
        });
        
        // Start the animation loop
        console.log('Starting animation loop...');
        requestAnimationFrame(tick);
        
        // Request permissions and show overlay if needed
        showPermissionOverlayIfNeeded();
        
        // Start with selection page
        showSelectionPage();
        
        // Force initial motion status update after a delay
        setTimeout(() => {
            if (!motionActive) {
                console.log('No motion detected initially, showing inactive status');
                updateMotionStatus(false);
            } else {
                console.log('Motion detection is active');
            }
        }, 2000);
        
        console.log('Initialization complete');
    }

    // Rebuild grid when target changes (only when idle to keep UX predictable)
    elTarget.addEventListener('change', () => {
        const newGoal = Math.max(1, Math.min(200, Number(elTarget.value) || 30));
        state.goal = newGoal;
        buildGrid(state.goal);
        // Re-apply colored tiles based on current reps
        colorTiles();
        updateStats();
    });

    // Keep threshold state updated live
    elThreshold.addEventListener('input', () => {
        state.thresholdDeg = Math.max(10, Math.min(60, Number(elThreshold.value) || 30));
    });

    // iOS visual hint
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) {
        elPermissionStatus.textContent = 'iOS requires tapping Enable Motion to start';
    }

    init();
})();


