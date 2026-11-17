
(() => {
    "use strict";

    let audio = null;
    let unlocked = false;

    function getAudio() {
        if (!audio) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return null;
            audio = new AudioContext();
        }
        return audio;
    }

    async function unlock() {
        const ctx = getAudio();
        if (!ctx) return;

        try {
            await ctx.resume();
            unlocked = ctx.state === "running";
        } catch (e) {
            unlocked = false;
        }
    }

    function play(name = "click") {
        const app = window.NFT_CASE;
        if (app && app.sound === false) return;

        const ctx = getAudio();
        if (!ctx || !unlocked || ctx.state !== "running") return;

        const sounds = {
            click: [520],
            open: [420, 560, 720],
            win: [660, 880, 1100],
            lose: [300, 220],
            craft: [420, 620, 820, 1040],
            upgrade: [440, 600, 780, 1000]
        };

        const notes = sounds[name] || sounds.click;
        const start = ctx.currentTime;

        notes.forEach((frequency, index) => {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            const time = start + index * 0.12;

            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency, time);

            gain.gain.setValueAtTime(0.0001, time);
            gain.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

            oscillator.connect(gain);
            gain.connect(ctx.destination);

            oscillator.start(time);
            oscillator.stop(time + 0.2);
        });
    }

    document.addEventListener("pointerdown", unlock, { once: true });

    window.GameSound = { play, unlock };
})();
