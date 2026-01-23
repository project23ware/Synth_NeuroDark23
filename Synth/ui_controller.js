/*
 * UI CONTROLLER MODULE (v38 - Color Swap & Drum Grid)
 * Handles DOM manipulation, Event Listeners, and Visual Feedback.
 * Implements Dynamic Drum Editor, Numeric Inputs & Config Menu.
 */

class UIController {
    constructor() {
        this.drawFrameId = null;
        this.lastDrawnStep = -1;
        // Timer references for repeater buttons
        this.repeatTimer = null;
        this.repeatInterval = null;

        // State for Color Swapping
        this.pendingColorSwap = null; // Stores channel ID of first click
        this.isDrumConfigCollapsed = true; // Start collapsed
    }

    init() {
        this.loadSettings();

        this.bindGlobalEvents();
        this.bindSynthControls();
        this.bindEditorControls();
        this.bindMenuNavigation();

        // Initial Renders
        this.renderInstrumentTabs();
        this.renderTrackBar();
        this.updateEditors();
        this.initPlayClock();

        // Render initial config menu state
        this.renderDrumConfigMenu();

        // Start Visual Loop
        this.renderLoop();

        if (window.logToScreen) window.logToScreen("UI Controller Initialized");
    }

    // --- PERSISTENCE ---
    loadSettings() {
        const sMode = localStorage.getItem('nd23_deviceMode');
        const sCols = localStorage.getItem('nd23_gridCols');
        const sSize = localStorage.getItem('nd23_stepSize');

        // 1. Device Mode (Auto-detect if missing)
        if (sMode) {
            window.AppState.deviceMode = sMode;
        } else {
            // Simple detection: width > 800 or userAgent
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 800;
            window.AppState.deviceMode = isMobile ? 'smartphone' : 'pc';
        }

        // Apply Mode Class
        if (window.AppState.deviceMode === 'pc') document.body.classList.add('pc-mode');
        else document.body.classList.remove('pc-mode');

        // 2. Grid Cols
        if (sCols) window.AppState.gridCols = parseInt(sCols);
        else window.AppState.gridCols = window.AppState.deviceMode === 'pc' ? 8 : 4;

        // 3. Step Size
        if (sSize) window.AppState.stepSize = parseInt(sSize);

        // Apply to CSS
        document.documentElement.style.setProperty('--grid-cols', window.AppState.gridCols);
        document.documentElement.style.setProperty('--step-size', `${window.AppState.stepSize}px`);

        // SYNC MATRIX: Ensure the matrix object also knows about this, or at least its next render will pick it up.
        // We can force a style update here just in case.
        if (window.timeMatrix && window.timeMatrix.container) {
            window.timeMatrix.container.style.gridTemplateColumns = `repeat(${window.AppState.gridCols}, minmax(0, 1fr))`;
        }

        // Update Inputs if they exist
        const colSlider = document.getElementById('grid-col-slider');
        if (colSlider) { colSlider.value = window.AppState.gridCols; document.getElementById('grid-col-display').innerText = window.AppState.gridCols; }

        const sizeSlider = document.getElementById('step-size-slider');
        if (sizeSlider) { sizeSlider.value = window.AppState.stepSize; document.getElementById('step-size-display').innerText = window.AppState.stepSize; }
    }

    saveSettings() {
        localStorage.setItem('nd23_deviceMode', window.AppState.deviceMode);
        localStorage.setItem('nd23_gridCols', window.AppState.gridCols);
        localStorage.setItem('nd23_stepSize', window.AppState.stepSize);
    }

    // --- 1. EVENTS ---
    bindMenuNavigation() {
        const navBtns = document.querySelectorAll('.fs-nav-btn');
        navBtns.forEach(btn => {
            btn.onclick = () => {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const targetId = btn.dataset.target;
                document.querySelectorAll('.fs-panel').forEach(p => p.classList.remove('active'));
                const targetPanel = document.getElementById(targetId);
                if (targetPanel) targetPanel.classList.add('active');
            };
        });

        // NEW: Sidebar Action Buttons
        // Export is now a main tab handled by bindMenuNavigation
        this.safeClick('btn-nav-terminal', () => {
            const p = document.getElementById('sys-log-panel');
            if (p) { p.classList.toggle('visible'); document.getElementById('btn-toggle-log-internal').innerText = p.classList.contains('visible') ? "[ HIDE ]" : "[ SHOW ]"; }
        });
        this.safeClick('btn-nav-reset', () => location.reload());
    }

    bindGlobalEvents() {
        const unlock = () => {
            if (window.audioEngine) window.audioEngine.resume();
            document.removeEventListener('click', unlock);
            document.removeEventListener('touchstart', unlock);
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock);

        this.safeClick('btn-play', () => this.toggleTransport());
        this.safeClick('app-logo', () => this.toggleTransport());

        // Menu
        this.safeClick('btn-open-menu', () => {
            this.renderSynthMenu();
            this.renderDrumConfigMenu(); // Refresh config on open
            this.toggleMenu();
        });
        this.safeClick('btn-menu-close', () => this.toggleMenu());
        this.safeClick('btn-toggle-ui-mode', () => this.toggleUIMode());
        this.safeClick('btn-toggle-device-mode', () => this.toggleDeviceMode());
        this.safeClick('btn-toggle-visualizer', () => this.toggleVisualizerMode());

        // Grid Controls
        const colSlider = document.getElementById('grid-col-slider');
        if (colSlider) {
            colSlider.oninput = (e) => {
                const val = parseInt(e.target.value);
                document.getElementById('grid-col-display').innerText = val;
                this.setGridCols(val);
            }
        }

        const sizeSlider = document.getElementById('step-size-slider');
        if (sizeSlider) {
            sizeSlider.oninput = (e) => {
                const val = parseInt(e.target.value);
                document.getElementById('step-size-display').innerText = val;
                this.setStepSize(val);
            };
            sizeSlider.onchange = (e) => { // Log on release/commit
                if (window.logToScreen) window.logToScreen(`Step Size set to: ${e.target.value}px`);
            }
        }

        // Modals

        // CSV Actions
        this.safeClick('btn-gen-csv', () => {
            if (window.timeMatrix) {
                document.getElementById('csv-io-area').value = window.timeMatrix.exportToCSV();
                if (window.logToScreen) window.logToScreen("CSV Generated");
            }
        });

        this.safeClick('btn-load-csv', () => {
            const area = document.getElementById('csv-io-area');
            if (area && window.timeMatrix && window.timeMatrix.importFromCSV(area.value)) {
                if (window.audioEngine && typeof window.audioEngine.syncWithMatrix === 'function') {
                    window.audioEngine.syncWithMatrix(window.timeMatrix);
                }
                this.fullRefresh();
                if (window.logToScreen) window.logToScreen("CSV Loaded");
            } else {
                if (window.logToScreen) window.logToScreen("CSV Error", 'error');
            }
        });

        this.safeClick('btn-download-csv', () => {
            const content = document.getElementById('csv-io-area').value;
            if (!content) return;
            const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url; a.download = `ND23_Patch_${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });

        const fInput = document.getElementById('file-upload-csv');
        if (fInput) {
            fInput.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = (ev) => {
                    document.getElementById('csv-io-area').value = ev.target.result;
                    document.getElementById('btn-load-csv').click();
                };
                r.readAsText(f);
                fInput.value = '';
            });
        }


        // MIDI Actions
        this.safeClick('btn-export-midi', () => {
            if (window.timeMatrix && window.MidiIO) {
                const bpm = window.AppState.bpm;
                const midiData = window.MidiIO.exportMidi(window.timeMatrix.blocks, bpm);
                if (midiData) {
                    const blob = new Blob([midiData], { type: 'audio/midi' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ND23_Pattern_${Date.now()}.mid`;
                    a.click();
                    URL.revokeObjectURL(url);
                    if (window.logToScreen) window.logToScreen("MIDI Exported Successfully");
                }
            }
        });

        const fInputMidi = document.getElementById('file-upload-midi');
        if (fInputMidi) {
            fInputMidi.addEventListener('change', (e) => {
                const f = e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = (ev) => {
                    const buffer = ev.target.result;
                    if (window.MidiIO && window.timeMatrix) {
                        const data = window.MidiIO.parseMidi(buffer);
                        // Apply Data
                        if (data) {
                            // Clear current block or what?
                            // Let's reset matrix based on length found
                            // For simplicity, we just fill current blocks or add if needed.
                            // We need to iterate the imported data step by step.

                            // Find max step
                            let maxStep = 0;
                            Object.keys(data.bass).forEach(k => maxStep = Math.max(maxStep, parseInt(k)));
                            Object.keys(data.drums).forEach(k => maxStep = Math.max(maxStep, parseInt(k)));

                            // Adjust blocks
                            const totalSteps = maxStep + 1;
                            const blocksNeeded = Math.ceil(totalSteps / 16);
                            window.timeMatrix.blocks = [];
                            for (let i = 0; i < blocksNeeded; i++) window.timeMatrix.addBlock();

                            // Fill Data
                            // Bass
                            Object.keys(data.bass).forEach(stepStr => {
                                const step = parseInt(stepStr);
                                const noteData = data.bass[stepStr];
                                const blockIdx = Math.floor(step / 16);
                                const stepIdx = step % 16;
                                if (window.timeMatrix.blocks[blockIdx]) {
                                    // Map MIDI Note to Note+Octave
                                    const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                                    const nMod = noteData.note % 12;
                                    const oct = Math.floor(noteData.note / 12) - 1;
                                    const noteName = NOTE_NAMES[nMod];

                                    // Apply to 'bass-1' (default synth)
                                    // Ideally we check if multiple synths were active in previous session but 
                                    // MIDI doesn't preserve that mapping easily without channels. 
                                    // We'll put everything on active view or bass-1.
                                    let targetId = window.AppState.activeView === 'drum' ? 'bass-1' : window.AppState.activeView;
                                    // Ensure track exists
                                    if (!window.timeMatrix.blocks[blockIdx].tracks[targetId]) window.timeMatrix.registerTrack(targetId);

                                    window.timeMatrix.blocks[blockIdx].tracks[targetId][stepIdx] = {
                                        note: noteName,
                                        octave: oct,
                                        slide: false,
                                        accent: noteData.vel > 100
                                    };
                                }
                            });

                            // Drums
                            Object.keys(data.drums).forEach(stepStr => {
                                const step = parseInt(stepStr);
                                const hits = data.drums[stepStr];
                                const blockIdx = Math.floor(step / 16);
                                const stepIdx = step % 16;
                                if (window.timeMatrix.blocks[blockIdx]) {
                                    window.timeMatrix.blocks[blockIdx].drums[stepIdx] = hits; // [1, 2, ...]
                                }
                            });

                            this.fullRefresh();
                            if (window.logToScreen) window.logToScreen("MIDI Imported Successfully");
                        }
                    }
                };
                r.readAsArrayBuffer(f);
                fInputMidi.value = '';
            });
        }

        // Render Audio
        this.safeClick('btn-start-render', async () => {
            if (window.audioEngine) {
                const btn = document.getElementById('btn-start-render');
                if (btn) { btn.innerText = "PROCESSING..."; btn.disabled = true; }
                await new Promise(r => setTimeout(r, 50));
                await window.audioEngine.renderAudio();
                if (btn) { btn.innerText = "RENDER WAV"; btn.disabled = false; }
            }
        });

        // Track Controls
        this.safeClick('btn-add-block', () => { window.timeMatrix.addBlock(); this.goToBlock(window.timeMatrix.blocks.length - 1); });
        this.safeClick('btn-del-block', () => { if (confirm("Delete Block?")) { window.timeMatrix.removeBlock(window.AppState.editingBlock); this.fullRefresh(); } });
        this.safeClick('btn-mem-copy', () => window.timeMatrix.copyToClipboard(window.AppState.editingBlock));
        this.safeClick('btn-mem-paste', () => { if (window.timeMatrix.pasteFromClipboard(window.AppState.editingBlock)) this.fullRefresh(); });
        this.safeClick('btn-move-left', () => { if (window.timeMatrix.moveBlock(window.AppState.editingBlock, -1)) this.goToBlock(window.AppState.editingBlock - 1); });
        this.safeClick('btn-move-right', () => { if (window.timeMatrix.moveBlock(window.AppState.editingBlock, 1)) this.goToBlock(window.AppState.editingBlock + 1); });

        const bpm = document.getElementById('bpm-input');
        if (bpm) bpm.onchange = (e) => window.AppState.bpm = e.target.value;

        // Export Reps
        // Export Reps
        const exportBtns = document.querySelectorAll('#panel-export .btn-option');
        exportBtns.forEach(btn => {
            btn.onclick = () => {
                exportBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.AppState.exportReps = parseInt(btn.dataset.rep);
            };
        });

        // Logs
        const logPanel = document.getElementById('sys-log-panel');
        this.safeClick('btn-toggle-log-internal', () => {
            if (logPanel) {
                logPanel.classList.toggle('visible');
                document.getElementById('btn-toggle-log-internal').innerText = logPanel.classList.contains('visible') ? "[ HIDE ]" : "[ SHOW ]";
            }
        });

        // Add Synth
        this.safeClick('btn-add-synth', () => {
            if (window.audioEngine) {
                const s = window.audioEngine.addBassSynth(`bass-${window.audioEngine.bassSynths.length + 1}`);
                if (s) { this.renderSynthMenu(); this.renderInstrumentTabs(); this.setTab(s.id); }
            }
        });
    }

    bindSynthControls() {
        const bindSlider = (id, param) => {
            const el = document.getElementById(id);
            if (el) el.oninput = (e) => this.handleParamChange(param, parseInt(e.target.value));
        };
        ['vol', 'dist', 'cutoff', 'res', 'env', 'dec', 'acc', 'tone', 'dgain'].forEach(p => {
            bindSlider(`${p}-slider`, p === 'vol' ? 'volume' : p === 'dist' ? 'distortion' : p === 'res' ? 'resonance' : p === 'env' ? 'envMod' : p === 'dec' ? 'decay' : p === 'acc' ? 'accentInt' : p === 'tone' ? 'distTone' : p === 'dgain' ? 'distGain' : p);
        });

        this.setupDigitalRepeaters();
        this.safeClick('btn-waveform', () => this.toggleWaveform());
    }

    bindEditorControls() {
        this.safeClick('btn-minimize-panel', (e) => { e.stopPropagation(); this.togglePanelState(); });
        this.safeClick('panel-header-trigger', () => this.togglePanelState());
        this.safeClick('btn-toggle-view-keys', (e) => { e.stopPropagation(); this.toggleSubPanel('keys'); });
        this.safeClick('btn-toggle-view-fx', (e) => { e.stopPropagation(); this.toggleSubPanel('fx'); });

        const octD = document.getElementById('oct-display');
        this.safeClick('oct-up', () => { if (window.AppState.currentOctave < 6) { window.AppState.currentOctave++; octD.innerText = window.AppState.currentOctave; } });
        this.safeClick('oct-down', () => { if (window.AppState.currentOctave > 1) { window.AppState.currentOctave--; octD.innerText = window.AppState.currentOctave; } });

        this.safeClick('btn-toggle-slide', () => this.toggleNoteMod('slide'));
        this.safeClick('btn-toggle-accent', () => this.toggleNoteMod('accent'));
        this.safeClick('btn-delete-note', () => {
            if (window.AppState.activeView !== 'drum') {
                const b = window.timeMatrix.blocks[window.AppState.editingBlock];
                b.tracks[window.AppState.activeView][window.AppState.selectedStep] = null;
                this.updateEditors();
            }
        });

        document.querySelectorAll('.key-w, .key-b').forEach(k => {
            k.onclick = () => this.placeNote(k.dataset.note);
        });

        window.addEventListener('stepSelect', (e) => {
            window.AppState.selectedStep = e.detail.index;
            this.updateEditors();
        });
    }

    // --- LOGIC ---

    setTab(v) {
        window.AppState.activeView = v;
        this.renderInstrumentTabs();
        this.updateEditors();
        this.syncControls(v);
    }

    handleParamChange(param, value) {
        if (!window.audioEngine) return;
        const synth = window.audioEngine.getSynth(window.AppState.activeView);
        if (!synth) return;

        let finalValue = value;
        if (param === 'cutoff') {
            finalValue = ((Math.max(100, Math.min(5000, value)) - 100) / 4900) * 100;
        }

        if (param === 'volume') synth.setVolume(finalValue);
        else if (param === 'distortion') synth.setDistortion(finalValue);
        else if (param === 'cutoff') synth.setCutoff(finalValue);
        else if (param === 'resonance') synth.setResonance(finalValue);
        else if (param === 'envMod') synth.setEnvMod(finalValue);
        else if (param === 'decay') synth.setDecay(finalValue);
        else if (param === 'accentInt') synth.setAccentInt(finalValue);
        else if (param === 'distTone') synth.setDistTone(finalValue);
        else if (param === 'distGain') synth.setDistGain(finalValue);

        this.syncControls(window.AppState.activeView);
    }

    placeNote(note) {
        if (window.AppState.activeView === 'drum') return;
        const sId = window.AppState.activeView;
        if (window.audioEngine) window.audioEngine.previewNote(sId, note, window.AppState.currentOctave);

        const block = window.timeMatrix.blocks[window.AppState.editingBlock];
        if (!block.tracks[sId]) window.timeMatrix.registerTrack(sId);

        const prev = block.tracks[sId][window.AppState.selectedStep];
        block.tracks[sId][window.AppState.selectedStep] = {
            note: note, octave: window.AppState.currentOctave,
            slide: prev ? prev.slide : false, accent: prev ? prev.accent : false
        };
        this.updateEditors();
    }

    toggleNoteMod(prop) {
        if (window.AppState.activeView === 'drum') return;
        const note = window.timeMatrix.blocks[window.AppState.editingBlock].tracks[window.AppState.activeView][window.AppState.selectedStep];
        if (note) { note[prop] = !note[prop]; this.updateEditors(); }
    }

    toggleWaveform() {
        const s = window.audioEngine.getSynth(window.AppState.activeView);
        if (s) { s.setWaveform(s.params.waveform === 'sawtooth' ? 'square' : 'sawtooth'); this.syncControls(s.id); }
    }

    toggleTransport() {
        const playing = window.audioEngine.toggleTransport();
        const btn = document.getElementById('btn-play');
        if (playing) { btn.innerHTML = "&#10074;&#10074;"; btn.classList.add('playing'); }
        else { btn.innerHTML = "&#9658;"; btn.classList.remove('playing'); window.timeMatrix.highlightPlayingStep(-1); this.renderTrackBar(); }
    }

    toggleMenu() { document.getElementById('main-menu').classList.toggle('hidden'); }
    toggleExportModal() { /* Deprecated */ }

    // --- RENDERERS ---
    renderLoop() {
        while (window.visualQueue && window.visualQueue.length > 0) {
            const now = window.audioEngine.ctx.currentTime;
            if (window.visualQueue[0].time <= now) {
                const ev = window.visualQueue.shift();
                if (ev.step === 0) this.renderTrackBar();
                if (this.lastDrawnStep !== ev.step) {
                    this.updatePlayClock(ev.step);
                    if (window.AppState.followPlayback && ev.block !== window.AppState.editingBlock) {
                        window.AppState.editingBlock = ev.block;
                        this.updateEditors();
                        this.renderTrackBar();
                    }
                    if (ev.block === window.AppState.editingBlock) {
                        window.timeMatrix.highlightPlayingStep(ev.step);
                        if (ev.step % 4 === 0) this.blinkLed();
                    } else window.timeMatrix.highlightPlayingStep(-1);
                    this.lastDrawnStep = ev.step;
                }
            } else break;
        }
        requestAnimationFrame(() => this.renderLoop());
    }

    syncControls(viewId) {
        if (viewId === 'drum') return;
        const s = window.audioEngine.getSynth(viewId);
        if (!s) return;
        const p = s.params;

        const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = Math.round(val); };
        setVal('vol-slider', p.volume); setVal('dist-slider', p.distortion);
        setVal('res-slider', p.resonance); setVal('env-slider', p.envMod);
        setVal('dec-slider', p.decay); setVal('acc-slider', p.accentInt);
        setVal('tone-slider', p.distTone); setVal('dgain-slider', p.distGain);
        setVal('cutoff-slider', ((p.cutoff / 100) * 4900) + 100);

        setVal('vol-digital', p.volume); setVal('dist-digital', p.distortion);
        setVal('cutoff-digital', p.cutoff); setVal('res-digital', p.resonance * 5);
        setVal('env-digital', p.envMod); setVal('dec-digital', p.decay);
        setVal('acc-digital', p.accentInt); setVal('tone-digital', p.distTone);
        setVal('dgain-digital', p.distGain);

        const wvBtn = document.getElementById('btn-waveform');
        if (wvBtn) wvBtn.innerHTML = p.waveform === 'square' ? '<span class="wave-symbol">Π</span> SQR' : '<span class="wave-symbol">~</span> SAW';
    }

    updateEditors() {
        const bEd = document.getElementById('editor-bass');
        const dEd = document.getElementById('editor-drum');
        document.getElementById('step-info-display').innerText = `STEP ${window.AppState.selectedStep + 1} // ${window.AppState.activeView.toUpperCase()}`;

        if (window.AppState.activeView === 'drum') {
            bEd.classList.add('hidden'); dEd.classList.remove('hidden');
            document.getElementById('btn-toggle-view-keys').style.display = 'none';
            document.getElementById('btn-toggle-view-fx').style.display = 'none';
            this.renderDrumRows();
        } else {
            bEd.classList.remove('hidden'); dEd.classList.add('hidden');
            document.getElementById('btn-toggle-view-keys').style.display = 'block';
            document.getElementById('btn-toggle-view-fx').style.display = 'block';
        }

        const slideBtn = document.getElementById('btn-toggle-slide');
        const accBtn = document.getElementById('btn-toggle-accent');
        if (slideBtn) slideBtn.classList.remove('active');
        if (accBtn) accBtn.classList.remove('active');

        if (window.AppState.activeView !== 'drum') {
            const note = window.timeMatrix.blocks[window.AppState.editingBlock].tracks[window.AppState.activeView][window.AppState.selectedStep];
            if (note) {
                if (note.slide && slideBtn) slideBtn.classList.add('active');
                if (note.accent && accBtn) accBtn.classList.add('active');
            }
        }
        window.timeMatrix.selectedStep = window.AppState.selectedStep;
        window.timeMatrix.render(window.AppState.activeView, window.AppState.editingBlock);
    }

    renderTrackBar() {
        const c = document.getElementById('track-bar');
        if (!c) return;
        c.innerHTML = '';
        document.getElementById('display-total-blocks').innerText = window.timeMatrix.blocks.length;
        document.getElementById('display-current-block').innerText = window.AppState.editingBlock + 1;

        window.timeMatrix.blocks.forEach((_, i) => {
            const el = document.createElement('div');
            let classes = 'chain-block';
            if (i === window.AppState.editingBlock) classes += ' editing';
            if (window.AppState.isPlaying && i === window.AppState.currentPlayBlock) classes += ' playing';
            el.className = classes;
            el.innerText = i + 1;
            el.onclick = () => this.goToBlock(i);
            c.appendChild(el);
        });
    }

    renderInstrumentTabs() {
        const c = document.getElementById('instrument-tabs-container');
        if (!c) return;
        c.innerHTML = '';
        window.audioEngine.bassSynths.forEach(s => {
            const b = document.createElement('button');
            b.className = `tab-pill ${window.AppState.activeView === s.id ? 'active' : ''}`;
            b.innerText = s.id;
            b.onclick = () => this.setTab(s.id);
            c.appendChild(b);
        });
        const d = document.createElement('button');
        d.className = `tab-pill ${window.AppState.activeView === 'drum' ? 'active' : ''}`;
        d.innerText = "DRUMS";
        d.onclick = () => this.setTab('drum');
        c.appendChild(d);
    }

    renderSynthMenu() {
        const c = document.getElementById('synth-list-container');
        if (!c) return;
        c.innerHTML = '';
        window.audioEngine.bassSynths.forEach(s => {
            const r = document.createElement('div');
            r.className = 'menu-item-row';
            r.innerHTML = `<span class="text-green">${s.id}</span><button class="btn-icon-del" onclick="window.removeBassSynth('${s.id}')">X</button>`;
            c.appendChild(r);
        });
    }

    // --- NEW: DRUM EDITOR & CONFIG ---

    renderDrumRows() {
        const c = document.getElementById('editor-drum');
        if (!c || !window.drumSynth) return;
        c.innerHTML = '';

        // 1. Master Volume Header
        const masterRow = document.createElement('div');
        masterRow.className = 'drum-master-panel';
        // Updated for Input support
        masterRow.innerHTML = `
            <span class="drum-master-label">MASTER VOL</span>
            <div class="drum-vol-ctrl">
                <button class="drum-vol-btn drum-rep-btn" data-target="master" data-dir="-1">-</button>
                <input type="number" class="drum-vol-input" id="drum-master-vol" value="${window.drumSynth.masterVolume}">
                <button class="drum-vol-btn drum-rep-btn" data-target="master" data-dir="1">+</button>
            </div>
        `;
        c.appendChild(masterRow);

        // Bind Master Input
        const mstInput = masterRow.querySelector('#drum-master-vol');
        mstInput.onchange = (e) => {
            const val = parseInt(e.target.value);
            window.drumSynth.setMasterVolume(val);
        };

        // 2. Channel Rows
        const cur = window.timeMatrix.blocks[window.AppState.editingBlock].drums[window.AppState.selectedStep];

        window.drumSynth.channels.forEach(ch => {
            // Skip inactive channels (Variant 0)
            if (ch.variant === 0) return;

            const act = cur.includes(ch.id);
            const colIndex = (ch.colorId !== undefined) ? ch.colorId : ch.id;
            const color = window.drumSynth.channelColors[colIndex % 9];

            const row = document.createElement('div');
            row.className = `drum-row ${act ? 'active' : ''}`;

            // Channel Info & Toggle
            const infoDiv = document.createElement('div');
            infoDiv.className = 'drum-info';
            infoDiv.innerHTML = `<div class="drum-color-tag" style="background:${color};box-shadow:0 0 5px ${color}"></div><span class="drum-label">${ch.name}</span>`;
            infoDiv.onclick = () => {
                if (window.audioEngine) window.audioEngine.resume();
                if (act) cur.splice(cur.indexOf(ch.id), 1);
                else { cur.push(ch.id); window.audioEngine.previewDrum(ch.id); }
                this.updateEditors();
            };

            // Volume Control (Inputs + Buttons)
            const volDiv = document.createElement('div');
            volDiv.className = 'drum-vol-ctrl';
            volDiv.innerHTML = `
                <button class="drum-vol-btn drum-rep-btn" data-target="${ch.id}" data-dir="-1">-</button>
                <input type="number" class="drum-vol-input" id="drum-vol-${ch.id}" value="${ch.volume}">
                <button class="drum-vol-btn drum-rep-btn" data-target="${ch.id}" data-dir="1">+</button>
            `;

            // Bind Channel Input
            const volInput = volDiv.querySelector(`#drum-vol-${ch.id}`);
            volInput.onclick = (e) => e.stopPropagation(); // Prevent row click
            volInput.onchange = (e) => {
                const val = parseInt(e.target.value);
                window.drumSynth.setChannelVolume(ch.id, val);
            };

            row.appendChild(infoDiv);
            row.appendChild(volDiv);
            c.appendChild(row);
        });

        // Re-bind repeater buttons
        this.setupDrumRepeaters();
    }

    renderDrumConfigMenu() {
        const container = document.getElementById('drum-config-container');
        if (!container || !window.drumSynth) return;
        container.innerHTML = '';

        // Header for Collapsible Logic
        const header = document.createElement('div');
        header.className = 'menu-group-header';
        header.innerHTML = `<span>DRUM CONFIGURATION</span><span>${this.isDrumConfigCollapsed ? '[+]' : '[-]'}</span>`;
        header.onclick = () => {
            this.isDrumConfigCollapsed = !this.isDrumConfigCollapsed;
            this.renderDrumConfigMenu();
        };
        container.appendChild(header);

        // Content Area
        const content = document.createElement('div');
        content.className = `menu-group-content ${this.isDrumConfigCollapsed ? 'collapsed' : ''}`;
        container.appendChild(content);

        // Grid Items
        window.drumSynth.channels.forEach(ch => {
            const row = document.createElement('div');
            row.className = 'config-row';

            const colIndex = (ch.colorId !== undefined) ? ch.colorId : ch.id;
            const color = window.drumSynth.channelColors[colIndex % 9];

            // Check if swapping this item
            const isSwapping = (this.pendingColorSwap === ch.id);

            row.innerHTML = `
                <div class="config-label">${ch.id + 1}</div>
                <div class="config-controls">
                    <select class="variant-select" id="conf-var-${ch.id}">
                        <option value="0" ${ch.variant === 0 ? 'selected' : ''}>OFF</option>
                        <option value="1" ${ch.variant === 1 ? 'selected' : ''}>${ch.name} 1</option>
                        <option value="2" ${ch.variant === 2 ? 'selected' : ''}>${ch.name} 2</option>
                        <option value="3" ${ch.variant === 3 ? 'selected' : ''}>${ch.name} 3</option>
                        <option value="4" ${ch.variant === 4 ? 'selected' : ''}>${ch.name} 4</option>
                    </select>
                    <div class="color-select ${isSwapping ? 'color-swapping' : ''}"
                         id="conf-col-${ch.id}"
                         style="background:${color}">
                    </div>
                </div>
            `;
            content.appendChild(row);

            // Bind Events
            const sel = row.querySelector(`#conf-var-${ch.id}`);
            sel.onchange = (e) => {
                const val = parseInt(e.target.value);
                window.drumSynth.setChannelVariant(ch.id, val);
                if (window.AppState.activeView === 'drum') this.updateEditors();
            };

            const colBtn = row.querySelector(`#conf-col-${ch.id}`);
            colBtn.onclick = () => this.handleColorSwap(ch.id);
        });
    }

    handleColorSwap(id) {
        if (this.pendingColorSwap === null) {
            // First click - Init swap
            this.pendingColorSwap = id;
            this.renderDrumConfigMenu(); // Re-render to show blinking border
        } else if (this.pendingColorSwap === id) {
            // Cancel swap (clicked same)
            this.pendingColorSwap = null;
            this.renderDrumConfigMenu();
        } else {
            // Execute Swap
            const srcId = this.pendingColorSwap;
            const targetId = id;

            const srcCh = window.drumSynth.channels[srcId];
            const targetCh = window.drumSynth.channels[targetId];

            // Swap ID values
            const tempCol = srcCh.colorId;
            srcCh.colorId = targetCh.colorId;
            targetCh.colorId = tempCol;

            this.pendingColorSwap = null;

            // Full refresh
            this.renderDrumConfigMenu();
            if (window.AppState.activeView === 'drum') this.updateEditors();
        }
    }

    setupDrumRepeaters() {
        document.querySelectorAll('.drum-rep-btn').forEach(btn => {
            const target = btn.dataset.target; // 'master' or channel ID
            const dir = parseInt(btn.dataset.dir);

            const change = () => {
                if (!window.drumSynth) return;

                if (target === 'master') {
                    const next = Math.max(0, Math.min(100, window.drumSynth.masterVolume + dir));
                    window.drumSynth.setMasterVolume(next);
                    const input = document.getElementById('drum-master-vol');
                    if (input) input.value = next;
                } else {
                    const id = parseInt(target);
                    const ch = window.drumSynth.channels[id];
                    if (ch) {
                        const next = Math.max(0, Math.min(100, ch.volume + dir));
                        window.drumSynth.setChannelVolume(id, next);
                        const input = document.getElementById(`drum-vol-${id}`);
                        if (input) input.value = next;
                    }
                }
            };
            this.bindRepeater(btn, change);
        });
    }

    setupDigitalRepeaters() {
        // Handles Bass Synth Digital Controls
        document.querySelectorAll('.dfx-btn').forEach(btn => {
            const changeVal = () => {
                const s = window.audioEngine.getSynth(window.AppState.activeView);
                if (!s) return;
                const p = btn.dataset.target, d = parseInt(btn.dataset.dir);
                let cur = 0;
                if (p === 'volume') cur = s.params.volume; else if (p === 'cutoff') cur = s.params.cutoff; else if (p === 'resonance') cur = s.params.resonance * 5; else cur = s.params[p];
                let next = Math.max(0, Math.min(100, cur + d));
                if (p === 'resonance') this.handleParamChange(p, next / 5); else if (p === 'cutoff') this.handleParamChange(p, ((next / 100) * 4900) + 100); else this.handleParamChange(p, next);
            };
            this.bindRepeater(btn, changeVal);
        });
    }

    bindRepeater(btn, action) {
        const stop = () => { clearTimeout(this.repeatTimer); clearInterval(this.repeatInterval); };
        const start = () => {
            action();
            this.repeatTimer = setTimeout(() => this.repeatInterval = setInterval(action, 80), 400);
        };
        btn.onmousedown = start;
        btn.onmouseup = stop;
        btn.onmouseleave = stop;
        btn.ontouchstart = (e) => { e.preventDefault(); start(); };
        btn.ontouchend = stop;
    }

    // Helpers
    goToBlock(i) { window.AppState.editingBlock = i; this.updateEditors(); this.renderTrackBar(); }
    fullRefresh() { window.AppState.editingBlock = 0; this.updateEditors(); this.renderTrackBar(); this.renderInstrumentTabs(); this.renderSynthMenu(); }
    togglePanelState() {
        window.AppState.panelCollapsed = !window.AppState.panelCollapsed;
        const p = document.getElementById('editor-panel');
        const b = document.getElementById('btn-minimize-panel');
        if (window.AppState.panelCollapsed) { p.classList.replace('expanded', 'collapsed'); b.innerHTML = "&#9650;"; }
        else { p.classList.replace('collapsed', 'expanded'); b.innerHTML = "&#9660;"; }
    }
    toggleSubPanel(p) {
        if (p === 'keys') window.AppState.viewKeys = !window.AppState.viewKeys;
        if (p === 'fx') window.AppState.viewFx = !window.AppState.viewFx;
        this.renderSubPanelStates();
    }
    renderSubPanelStates() {
        const pK = document.getElementById('subpanel-keys'), pF = document.getElementById('subpanel-fx');
        const bK = document.getElementById('btn-toggle-view-keys'), bF = document.getElementById('btn-toggle-view-fx');
        if (window.AppState.viewKeys) { pK.classList.remove('hidden'); bK.classList.add('active'); } else { pK.classList.add('hidden'); bK.classList.remove('active'); }
        if (window.AppState.viewFx) { pF.classList.remove('hidden'); bF.classList.add('active'); } else { pF.classList.add('hidden'); bF.classList.remove('active'); }
    }
    toggleVisualizerMode() { window.AppState.followPlayback = !window.AppState.followPlayback; document.getElementById('btn-toggle-visualizer').innerText = window.AppState.followPlayback ? "VISUALIZER: ON" : "VISUALIZER: OFF"; }
    toggleUIMode() {
        window.AppState.uiMode = window.AppState.uiMode === 'analog' ? 'digital' : 'analog';
        document.getElementById('btn-toggle-ui-mode').innerText = `UI MODE: ${window.AppState.uiMode.toUpperCase()}`;
        document.getElementById('fx-controls-analog').classList.toggle('hidden');
        document.getElementById('fx-controls-digital').classList.toggle('hidden');
        this.syncControls(window.AppState.activeView);
    }

    toggleDeviceMode() {
        // Toggle State
        const isPC = window.AppState.deviceMode === 'smartphone'; // If currently phone, switch to PC
        window.AppState.deviceMode = isPC ? 'pc' : 'smartphone';
        this.saveSettings();

        // Update Body Class
        if (isPC) document.body.classList.add('pc-mode');
        else document.body.classList.remove('pc-mode');

        // Update Button Text
        document.getElementById('btn-toggle-device-mode').innerText = `DEVICE: ${window.AppState.deviceMode.toUpperCase()}`;
        if (window.logToScreen) window.logToScreen(`Device Mode switched to: ${window.AppState.deviceMode.toUpperCase()}`);

        // Auto-configure Grid only if not manually set?
        // User request: "persistir... y no se cambie automáticamente al actuar sobre otras funciones no relacionadas"
        // But switching mode explicitly SHOULD probably update grid default?
        // User said: "seleccionar automaticamente AL INICIO".
        // The toggle button is explicit. Let's keep the logic that switching mode suggests a default grid, 
        // but respect the slider. Actually, typically switching device mode on the fly might want to resize.
        // Let's stick to current logic: switch mode -> set default cols (8/4).
        // Since setGridCols calls saveSettings, it will persist.
        const newCols = isPC ? 8 : 4;
        this.setGridCols(newCols);

        // Update UI Slider
        const slider = document.getElementById('grid-col-slider');
        if (slider) {
            slider.value = newCols;
            document.getElementById('grid-col-display').innerText = newCols;
        }
    }

    setGridCols(cols) {
        window.AppState.gridCols = cols;
        document.documentElement.style.setProperty('--grid-cols', cols);
        // Force direct update on matrix container if variable latency is an issue
        const grid = document.getElementById('matrix-container');
        if (grid) grid.style.gridTemplateColumns = `repeat(${cols}, var(--step-size))`;
        this.saveSettings();
    }

    setStepSize(px) {
        window.AppState.stepSize = px;
        document.documentElement.style.setProperty('--step-size', `${px}px`);
        this.saveSettings();
        // Force redraw or specific style logic if needed
    }
    initPlayClock() { /* SVG Clock Init */ const s = document.getElementById('play-clock-svg'); if (!s) return; s.innerHTML = ''; const t = 16, r = 45, c = 50, ci = 2 * Math.PI * r, g = 2, d = (ci / t) - g; for (let i = 0; i < t; i++) { const e = document.createElementNS("http://www.w3.org/2000/svg", "circle"); e.setAttribute("r", r); e.setAttribute("cx", c); e.setAttribute("cy", c); e.setAttribute("fill", "transparent"); e.setAttribute("stroke-width", "4"); e.setAttribute("stroke-dasharray", `${d} ${ci - d}`); e.setAttribute("transform", `rotate(${(360 / t) * i},${c},${c})`); e.setAttribute("id", `clock-seg-${i}`); e.setAttribute("stroke", "#333"); s.appendChild(e); } }
    updatePlayClock(step) { for (let i = 0; i < 16; i++) { const s = document.getElementById(`clock-seg-${i}`); if (s) { if (i === step) { s.setAttribute("stroke", "#00ff41"); s.setAttribute("opacity", "1"); } else if (i < step) { s.setAttribute("stroke", "#004411"); s.setAttribute("opacity", "0.5"); } else { s.setAttribute("stroke", "#222"); s.setAttribute("opacity", "0.3"); } } } }
    blinkLed() { const l = document.getElementById('activity-led'); if (l) { l.style.backgroundColor = '#fff'; l.style.boxShadow = '0 0 8px #fff'; setTimeout(() => { l.style.backgroundColor = ''; l.style.boxShadow = ''; }, 50); } }
    safeClick(id, fn) { const el = document.getElementById(id); if (el) el.onclick = fn; }
}
window.UIController = UIController;