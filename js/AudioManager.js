export class AudioManager {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.setValueAtTime(0.5, this.audioContext.currentTime);
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

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(1, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

        source.connect(gainNode);
        gainNode.connect(this.masterGain);
        source.start();
        source.stop(this.audioContext.currentTime + 0.2);
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

        // White noise for the sharp 'crack'
        const bufferSize = this.audioContext.sampleRate * 0.2; // 0.2 seconds
        const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        const gainNode = this.audioContext.createGain();
        gainNode.gain.setValueAtTime(0.4, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.15);

        source.connect(gainNode);
        gainNode.connect(this.masterGain);
        source.start();
    }
}