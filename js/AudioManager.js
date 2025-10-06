export class AudioManager {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.setValueAtTime(1.0, this.audioContext.currentTime); // Master volume increased
        this.masterGain.connect(this.audioContext.destination);

        this.rollingSound = null;
        this.brownNoiseBuffer = this._createBrownNoise();
    }

    // Create a buffer of brown noise for a more realistic rumble
    _createBrownNoise() {
        const bufferSize = this.audioContext.sampleRate * 2; // 2 seconds of noise
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = buffer.getChannelData(0);

        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5; // (roughly) compensate for gain
        }
        return buffer;
    }

    playThump() {
        if (!this.audioContext) return;
        const source = this.audioContext.createBufferSource();
        source.buffer = this.brownNoiseBuffer;

        // Low-pass filter to create a deep "thud"
        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime(100, this.audioContext.currentTime); // Cut off high frequencies

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(1.5, this.audioContext.currentTime); // Boosted thump volume
        // A slightly longer decay for a heavier feel
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);

        source.connect(lowpass);
        lowpass.connect(gainNode);
        gainNode.connect(this.masterGain);

        source.start();
        source.stop(this.audioContext.currentTime + 0.3);
    }

    startRollingSound() {
        if (this.rollingSound || !this.audioContext) return;

        this.rollingSound = {};

        this.rollingSound.source = this.audioContext.createBufferSource();
        this.rollingSound.source.buffer = this.brownNoiseBuffer;
        this.rollingSound.source.loop = true;

        this.rollingSound.gain = this.audioContext.createGain();
        this.rollingSound.gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.rollingSound.gain.gain.linearRampToValueAtTime(0.3, this.audioContext.currentTime + 0.1);

        this.rollingSound.lowpass = this.audioContext.createBiquadFilter();
        this.rollingSound.lowpass.type = 'lowpass';
        this.rollingSound.lowpass.frequency.setValueAtTime(200, this.audioContext.currentTime);

        this.rollingSound.source.connect(this.rollingSound.lowpass);
        this.rollingSound.lowpass.connect(this.rollingSound.gain);
        this.rollingSound.gain.connect(this.masterGain);

        this.rollingSound.source.start();
    }

    stopRollingSound() {
        if (!this.rollingSound) return;
        this.rollingSound.gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.2);
        this.rollingSound.source.stop(this.audioContext.currentTime + 0.2);
        this.rollingSound = null;
    }

    setRollRate(rate) {
        if (!this.rollingSound) return;
        // Clamp rate to avoid extreme pitch shifts
        const clampedRate = Math.max(0.5, Math.min(2.0, rate));
        this.rollingSound.source.playbackRate.setValueAtTime(clampedRate, this.audioContext.currentTime);

        // Also adjust the filter frequency slightly with the rate
        const newFreq = 200 + (clampedRate - 1) * 100;
        this.rollingSound.lowpass.frequency.setValueAtTime(newFreq, this.audioContext.currentTime);
    }

    playPinHit() {
        if (!this.audioContext) return;

        // --- Low-frequency component for "body" ---
        const brownSource = this.audioContext.createBufferSource();
        brownSource.buffer = this.brownNoiseBuffer;
        const brownGain = this.audioContext.createGain();
        brownGain.gain.setValueAtTime(0.6, this.audioContext.currentTime); // Increased gain for more bass
        brownGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
        const brownFilter = this.audioContext.createBiquadFilter();
        brownFilter.type = 'lowpass';
        brownFilter.frequency.setValueAtTime(250, this.audioContext.currentTime); // Lowered frequency for deeper bass
        brownSource.connect(brownFilter);
        brownFilter.connect(brownGain);
        brownGain.connect(this.masterGain);

        // --- High-frequency component for "crack" ---
        const whiteBufferSize = this.audioContext.sampleRate * 0.1; // Shorter crack sound
        const whiteBuffer = this.audioContext.createBuffer(1, whiteBufferSize, this.audioContext.sampleRate);
        const whiteOutput = whiteBuffer.getChannelData(0);
        for (let i = 0; i < whiteBufferSize; i++) {
            whiteOutput[i] = Math.random() * 2 - 1;
        }
        const whiteSource = this.audioContext.createBufferSource();
        whiteSource.buffer = whiteBuffer;
        const whiteGain = this.audioContext.createGain();
        whiteGain.gain.setValueAtTime(0.15, this.audioContext.currentTime); // Slightly less intense crackle
        whiteGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);
        const whiteFilter = this.audioContext.createBiquadFilter();
        whiteFilter.type = 'highpass';
        whiteFilter.frequency.setValueAtTime(1000, this.audioContext.currentTime); // Just the high frequencies
        whiteSource.connect(whiteFilter);
        whiteFilter.connect(whiteGain);
        whiteGain.connect(this.masterGain);

        // Start both sounds
        brownSource.start();
        whiteSource.start();
    }
}