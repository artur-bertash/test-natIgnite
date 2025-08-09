/*
  Recovery Coach — Arm Bends
  - Uses DeviceMotion/DeviceOrientation to infer arm bend repetitions
  - Low-pass filtering + hysteresis to reduce noise and avoid double counts
  - Gamified coloring grid that fills tiles as reps are completed
*/

(function () {
    const elPermissionBtn = document.getElementById('btn-permission');
    const elPermissionStatus = document.getElementById('permission-status');
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
            const anyDevMotion = window.DeviceMotionEvent;
            const anyDevOrient = window.DeviceOrientationEvent;

            let motionPermitted = true;
            if (anyDevMotion && typeof anyDevMotion.requestPermission === 'function') {
                const res = await anyDevMotion.requestPermission();
                motionPermitted = res === 'granted';
            }

            let orientationPermitted = true;
            if (anyDevOrient && typeof anyDevOrient.requestPermission === 'function') {
                const res = await anyDevOrient.requestPermission();
                orientationPermitted = res === 'granted';
            }

            state.hasPermission = motionPermitted && orientationPermitted;
            elPermissionStatus.textContent = state.hasPermission ? 'Permission granted' : 'Permission denied or unavailable';
            return state.hasPermission;
        } catch (err) {
            elPermissionStatus.textContent = 'Permission request failed';
            return false;
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
        if (latestOrientation.has && Number.isFinite(latestOrientation.beta)) {
            // Clamp beta to [-180, 180]
            let beta = latestOrientation.beta;
            if (beta > 180) beta -= 360;
            if (beta < -180) beta += 360;
            return beta;
        }
        // Fallback: compute tilt from gravity (assuming stationary between samples)
        if (latestAccel.has) {
            // Tilt relative to gravity using arctan2 of y/z
            const { y, z } = latestAccel;
            const betaRad = Math.atan2(y, z);
            return betaRad * (180 / Math.PI);
        }
        return 0;
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
    function onOrientation(event) {
        if (!state.running) return;
        if (typeof event.beta === 'number') {
            latestOrientation = { beta: event.beta, has: true };
        }
    }

    function onMotion(event) {
        if (!state.running) return;
        const accG = event.accelerationIncludingGravity;
        if (accG && typeof accG.x === 'number' && typeof accG.y === 'number' && typeof accG.z === 'number') {
            latestAccel = { x: accG.x, y: accG.y, z: accG.z, has: true };
        }
    }

    // Frame loop to compute filtered angle and detect reps at ~60Hz (or browser rate)
    const alpha = 0.12; // smoothing factor for low-pass
    function tick(ts) {
        if (state.running) {
            const angle = estimateTiltDeg();
            const filtered = lowPassFilter(state.filteredAngleDeg, angle, alpha);
            state.prevAngleDeg = state.filteredAngleDeg;
            state.filteredAngleDeg = filtered;
            updateTiltReadout(filtered);

            processAngle(filtered, typeof ts === 'number' ? ts : performance.now());
        }
        requestAnimationFrame(tick);
    }

    // Button handlers
    elPermissionBtn.addEventListener('click', async () => {
        const ok = await requestPermissionIfNeeded();
        if (ok) {
            elPermissionStatus.textContent = 'Permission granted';
        }
    });

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
            elPermissionStatus.textContent = 'Attempting to start without explicit permission…';
        }

        // Attach listeners once
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
        updateStats();
        colorTiles();
    });

    // Init
    function init() {
        buildGrid(state.goal);
        updateStats();
        colorTiles();
        requestAnimationFrame(tick);
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


