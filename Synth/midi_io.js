/**
 * MIDI IO MODULE (v1.0)
 * Handles MIDI File Generation and Parsing.
 * Dependency Check: None (Vanilla JS)
 */

class MidiIO {
    constructor() {
        this.MThd = [0x4D, 0x54, 0x68, 0x64];
        this.MTrk = [0x4D, 0x54, 0x72, 0x6B];
        this.ticksPerBeat = 480; // Standard PPQ
    }

    // --- HELPER: Variable Length Quantity ---
    toVLQ(val) {
        let buffer = [val & 0x7F];
        while ((val >>= 7)) {
            buffer.push((val & 0x7F) | 0x80);
        }
        return buffer.reverse();
    }

    // --- EXPORT ---
    exportMidi(blocks, bpm) {
        // 1. Header Chunk
        // Format 1 (Multi-track), Tracks = Bass Channels + 1 Drum Channel + 1 Tempo Track, Division
        const bassTracksCount = 4; // Max bass synths usually 4? Or dynamic? Let's check window.audioEngine
        // Better: We scan how many tracks actually have data or just do standard set.
        // Let's grab data structure from TimeMatrix blocks.
        if (!blocks || blocks.length === 0) return null;

        const tracks = [];

        // Track 0: Tempo and Meta
        let track0 = [
            0x00, 0xFF, 0x51, 0x03, ...this.bpmToTempoBytes(bpm), // Set Tempo
            0x00, 0xFF, 0x2F, 0x00 // End of Track
        ];
        tracks.push(track0);

        // Track 1: Drums (Channel 10 -> 0x09)
        let drumEvents = [];
        blocks.forEach((b, bIdx) => {
            const blockOffset = bIdx * 16 * (this.ticksPerBeat / 4); // 16 steps, eachstep 1/4 beat? No, 16 steps usually = 1 bar = 4 beats. So 1 step = 1/4 beat.
            b.drums.forEach((stepDrums, sIdx) => {
                if (stepDrums && stepDrums.length > 0) {
                    const time = blockOffset + (sIdx * (this.ticksPerBeat / 4));
                    // For each drum hit
                    stepDrums.forEach(chId => {
                        // Map internal channels 0-3 to MIDI notes. 
                        // General MIDI: Kick=36, Snare=38, CH=42, OH=46
                        let note = 36;
                        if (chId === 1) note = 38; // Snare
                        if (chId === 2) note = 42; // CH
                        if (chId === 3) note = 46; // OH
                        if (chId > 3) note = 48 + chId; // Toms/Percs

                        // Note On
                        drumEvents.push({ t: time, type: 0x99, note: note, vel: 100 });
                        // Note Off (short dur)
                        drumEvents.push({ t: time + 60, type: 0x89, note: note, vel: 0 });
                    });
                }
            });
        });
        if (drumEvents.length > 0) tracks.push(this.compileTrack(drumEvents));

        // Tracks 2+: Bass
        // Get all unique track keys from blocks
        const allTrackKeys = new Set();
        blocks.forEach(b => Object.keys(b.tracks).forEach(k => allTrackKeys.add(k)));

        let chCounter = 0;
        allTrackKeys.forEach(key => {
            const ch = chCounter++;
            if (ch === 9) chCounter++; // Skip drum channel if we hit it
            const midiCh = ch; // 0-15

            let events = [];
            blocks.forEach((b, bIdx) => {
                const trackData = b.tracks[key];
                if (!trackData) return;

                const blockOffset = bIdx * 16 * (this.ticksPerBeat / 4);

                trackData.forEach((noteData, sIdx) => {
                    if (noteData) {
                        const time = blockOffset + (sIdx * (this.ticksPerBeat / 4));
                        const midiNote = this.getMidiNote(noteData.note, noteData.octave);
                        // Note On
                        events.push({ t: time, type: 0x90 | midiCh, note: midiNote, vel: noteData.accent ? 127 : 90 });
                        // Note Off (1 step duration usually, or slide logic?)
                        // Simple 16th note duration
                        const dur = (this.ticksPerBeat / 4) - 10;
                        events.push({ t: time + dur, type: 0x80 | midiCh, note: midiNote, vel: 0 });
                    }
                });
            });
            tracks.push(this.compileTrack(events));
        });

        return this.buildMidiFile(tracks);
    }

    compileTrack(events) {
        // Sort by time
        events.sort((a, b) => a.t - b.t);

        let bytes = [];
        let lastTime = 0;

        events.forEach(e => {
            const dt = e.t - lastTime;
            lastTime = e.t;
            bytes.push(...this.toVLQ(dt));
            bytes.push(e.type);
            bytes.push(e.note);
            bytes.push(e.vel);
        });

        // End of Track
        bytes.push(0x00, 0xFF, 0x2F, 0x00);
        return bytes;
    }

    buildMidiFile(tracks) {
        let file = [...this.MThd];
        // Header Length (6)
        file.push(0, 0, 0, 6);
        // Format 1
        file.push(0, 1);
        // Track Count
        file.push((tracks.length >> 8) & 0xFF, tracks.length & 0xFF);
        // Time Division
        file.push((this.ticksPerBeat >> 8) & 0xFF, this.ticksPerBeat & 0xFF);

        tracks.forEach(t => {
            file.push(...this.MTrk);
            file.push((t.length >> 24) & 0xFF, (t.length >> 16) & 0xFF, (t.length >> 8) & 0xFF, t.length & 0xFF);
            file.push(...t);
        });

        return new Uint8Array(file);
    }

    bpmToTempoBytes(bpm) {
        const microSecs = Math.round(60000000 / bpm);
        return [(microSecs >> 16) & 0xFF, (microSecs >> 8) & 0xFF, microSecs & 0xFF];
    }

    getMidiNote(note, octave) {
        const map = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
        return (octave + 1) * 12 + map[note];
    }

    // --- IMPORT ---
    parseMidi(arrayBuffer) {
        const data = new Uint8Array(arrayBuffer);
        // Basic parser to find notes
        // This is a complex task for a single file, implementing a simplified version 
        // that looks for Note On messages in Track Chunks.

        let p = 0;
        // Check Header
        if (data[p] != 0x4D || data[p + 1] != 0x54 || data[p + 2] != 0x68 || data[p + 3] != 0x64) return null;
        p += 14; // Skip Header

        const importedData = { drums: {}, bass: {} }; // Keyed by absolute step

        // Read Tracks
        while (p < data.length) {
            if (data[p] != 0x4D || data[p + 1] != 0x54 || data[p + 2] != 0x72 || data[p + 3] != 0x6B) break; // Not MTrk
            p += 4;
            const len = (data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3];
            p += 4;
            const end = p + len;

            let absTime = 0;
            let lastStatus = 0;

            while (p < end) {
                // Read VLQ Delta Time
                let dt = 0;
                let b;
                do {
                    if (p >= end) break;
                    b = data[p++];
                    dt = (dt << 7) | (b & 0x7F);
                } while (b & 0x80);

                absTime += dt;

                // Read Event
                if (p >= end) break;
                let status = data[p];

                if (status < 0x80) {
                    status = lastStatus; // Running Status
                    p--;
                } else {
                    p++;
                    lastStatus = status;
                }

                // Note On
                if ((status & 0xF0) === 0x90) {
                    const ch = status & 0x0F;
                    const note = data[p++];
                    const vel = data[p++];

                    if (vel > 0) {
                        const step = Math.round(absTime / (this.ticksPerBeat / 4));

                        if (ch === 9) { // Drums
                            if (!importedData.drums[step]) importedData.drums[step] = [];
                            // Map General MIDI back to Simplistic 0-3
                            let internalId = 0; // Kick
                            if (note === 38 || note === 40) internalId = 1; // Snare
                            else if (note === 42 || note === 44 || note === 46) internalId = 2; // CH
                            else if (note >= 47) internalId = 3; // Perc

                            if (!importedData.drums[step].includes(internalId)) importedData.drums[step].push(internalId);
                        } else { // Bass
                            if (!importedData.bass[step]) importedData.bass[step] = {};
                            // simplistic single synth map for now, or multi-synth? 
                            // We map first found track to 'bass-1'
                            importedData.bass[step] = { note: note, vel: vel };
                        }
                    }
                }
                else if ((status & 0xF0) === 0x80) { p += 2; } // Note Off
                else if ((status & 0xF0) === 0xB0) { p += 2; } // CC
                else if ((status & 0xF0) === 0xC0) { p += 1; } // PC
                else if ((status & 0xF0) === 0xE0) { p += 2; } // Pitch
                else if (status === 0xFF) { // Meta
                    const type = data[p++];
                    let len = 0;
                    // Meta VLQ length
                    let bb;
                    do { bb = data[p++]; len = (len << 7) | (bb & 0x7F); } while (bb & 0x80);
                    p += len;
                }
            }
            p = end;
        }
        return importedData;
    }
}

window.MidiIO = new MidiIO();
