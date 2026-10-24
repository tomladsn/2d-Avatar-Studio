import { useState, useRef, useEffect, useCallback } from 'react';
import { createMeshAvatar, loadMeshAvatar, type MeshAvatar, LIVE_EXPRESSIONS, type LiveExpression } from 'mesh-avatar';
import { localProjects, openLocalProject, openSampleAvatar } from '../editor/project';
import { readLiveProject, SAMPLE_PROJECT } from '../live/settings';
import { useTheme } from '../editor/theme';

type BackgroundType = 'transparent' | '#00ff00' | '#0000ff' | '#161e2e' | '#ffffff';

export function AudioSyncApp() {
  const { theme, toggleTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarRef = useRef<MeshAvatar | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number>(0);
  const timeDataRef = useRef<Float32Array<ArrayBuffer>>(new Float32Array(1024));

  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarName, setAvatarName] = useState('Loading...');
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioFileName, setAudioFileName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [gain, setGain] = useState(1.5);
  const [volume, setVolume] = useState(1.0);
  const [loop, setLoop] = useState(false);
  const [autoIdle, setAutoIdleState] = useState(true);
  const [background, setBackground] = useState<BackgroundType>('transparent');
  const [expression, setExpression] = useState<LiveExpression>('neutral');
  const [currentLevel, setCurrentLevel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const autoIdleRef = useRef(autoIdle); autoIdleRef.current = autoIdle;
  const expressionRef = useRef(expression); expressionRef.current = expression;

  // Initialize or re-init avatar. A project name loads the same avatar as the studio;
  // a File loads a .mavatar chosen on this page.
  const initAvatar = useCallback(async (source: string | File) => {
    if (!canvasRef.current) return;
    try {
      setAvatarReady(false);
      setErrorMsg(null);
      if (avatarRef.current) {
        avatarRef.current.destroy();
        avatarRef.current = null;
      }

      let avatar: MeshAvatar, name: string;
      if (typeof source === 'string') {
        const projects = await localProjects();
        const project = projects?.find(entry => entry.name === source);
        if (project && !project.error) {
          const loaded = await openLocalProject(project);
          if (!loaded.rig) throw new Error('Project has no rig.');
          avatar = await createMeshAvatar(canvasRef.current, { manual: false, rig: loaded.rig, assets: loaded.assets });
          name = project.readOnly ? 'Miko (Sample)' : project.name;
        } else {
          const sample = await openSampleAvatar();
          avatar = await createMeshAvatar(canvasRef.current, { manual: false, rig: sample.rig, assets: sample.assets });
          name = 'Miko (Sample)';
        }
      } else {
        avatar = await loadMeshAvatar(canvasRef.current, source, { manual: false });
        name = source.name;
      }

      avatar.setAutoIdle(autoIdleRef.current);
      avatar.setAutoMotion(autoIdleRef.current);
      avatar.setExpression(expressionRef.current);
      avatarRef.current = avatar;
      setAvatarReady(true);
      setAvatarName(name);
    } catch (err) {
      console.error('Failed to load avatar:', err);
      setErrorMsg('Failed to load avatar. Please check file format.');
    }
  }, []);

  // Load the project currently open in the studio, falling back to the sample.
  useEffect(() => {
    const query = new URLSearchParams(location.search).get('project');
    const project = query && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(query) ? query : readLiveProject();
    void initAvatar(project ?? SAMPLE_PROJECT);
    return () => {
      if (avatarRef.current) {
        avatarRef.current.destroy();
        avatarRef.current = null;
      }
    };
  }, [initAvatar]);

  useEffect(() => {
    avatarRef.current?.setAutoIdle(autoIdle);
    avatarRef.current?.setAutoMotion(autoIdle);
  }, [autoIdle]);

  useEffect(() => {
    avatarRef.current?.setExpression(expression);
  }, [expression]);

  // Setup Web Audio API and audio element
  const setupAudio = useCallback((audioUrl: string, fileName: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    audio.loop = loop;
    audio.volume = volume;

    audio.onloadedmetadata = () => {
      setDuration(audio.duration);
      setAudioLoaded(true);
      setAudioFileName(fileName);
      setCurrentTime(0);
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      if (!audio.loop) {
        setIsPlaying(false);
        if (avatarRef.current) {
          avatarRef.current.setSpeaking(false);
          avatarRef.current.setVoiceLevel(0);
        }
        setCurrentLevel(0);
      }
    };

    audioRef.current = audio;

    // Connect Web Audio API AnalyserNode
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyserRef.current = analyser;
        timeDataRef.current = new Float32Array(analyser.fftSize);
      }

      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch { /* ignore */ }
      }
      const sourceNode = ctx.createMediaElementSource(audio);
      sourceNode.connect(analyserRef.current);
      analyserRef.current.connect(ctx.destination);
      sourceNodeRef.current = sourceNode;
    } catch (err) {
      console.warn('Web Audio node setup:', err);
    }
  }, [loop, volume]);

  // Animation frame loop to sample audio loudness and update lip sync
  useEffect(() => {
    let active = true;

    const tick = () => {
      if (!active) return;
      const audio = audioRef.current;
      const analyser = analyserRef.current;
      const avatar = avatarRef.current;

      if (audio && !audio.paused && !audio.ended && analyser && avatar) {
        analyser.getFloatTimeDomainData(timeDataRef.current);
        const data = timeDataRef.current;
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        const rms = Math.sqrt(sum / data.length);
        // Calibrated formula: subtract ambient noise threshold 0.008, scale by gain * 5
        const raw = (rms - 0.008) * gain * 5;
        const level = Math.max(0, Math.min(1, raw));

        avatar.setSpeaking(level > 0.015);
        avatar.setVoiceLevel(level);
        setCurrentLevel(level);
      } else if (avatar && (!audio || audio.paused || audio.ended)) {
        avatar.setSpeaking(false);
        avatar.setVoiceLevel(0);
        setCurrentLevel(0);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [gain]);

  // Audio Play / Pause
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio || !audioLoaded) return;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (newTime: number) => {
    if (audioRef.current && audioLoaded) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
  };

  const handleLoopChange = (newLoop: boolean) => {
    setLoop(newLoop);
    if (audioRef.current) {
      audioRef.current.loop = newLoop;
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.mavatar')) {
      void initAvatar(file);
    } else if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
      const url = URL.createObjectURL(file);
      setupAudio(url, file.name);
    } else {
      setErrorMsg('Unsupported file type. Upload an audio file (.mp3, .wav, etc.) or avatar (.mavatar).');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  // Generate synthetic vowel test speech via Web Audio oscillators for immediate testing
  const playSyntheticSpeechTest = () => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const sampleRate = ctx.sampleRate;
      const totalSec = 3.5;
      const buffer = ctx.createBuffer(1, sampleRate * totalSec, sampleRate);
      const data = buffer.getChannelData(0);

      // Syllable bursts representing vowels
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const syllableIndex = Math.floor(t * 3.5);
        const syllableTime = (t * 3.5) % 1;
        const envelope = syllableTime < 0.75 ? Math.sin((syllableTime / 0.75) * Math.PI) : 0;
        // Pitch variations for natural speech feeling
        const baseFreq = 220 + (syllableIndex % 3) * 40;
        data[i] = envelope * 0.45 * (
          Math.sin(2 * Math.PI * baseFreq * t) +
          0.5 * Math.sin(2 * Math.PI * baseFreq * 2 * t) +
          0.25 * Math.sin(2 * Math.PI * baseFreq * 3 * t)
        );
      }

      // Encode buffer to WAV format
      const wavBytes = encodeWAV(data, sampleRate);
      const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setupAudio(url, 'Speech-Demo.wav');
    } catch (err) {
      console.error('Failed to create synthetic test audio:', err);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      className="audio-sync-root"
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <header className="audio-sync-header">
        <div className="brand">
          <a href="/" className="back-link">‹ Studio</a>
          <h1>2D Avatar Studio <span>Audio Lip Sync</span></h1>
        </div>
        <div className="header-nav">
          <button className="nav-btn theme-btn" onClick={toggleTheme} title="Switch Theme (Dark / Light)">
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <a href="/live.html" className="nav-btn">Live Studio (Mic/Camera)</a>
          <a href="/" className="nav-btn">Editor</a>
        </div>
      </header>

      {errorMsg && (
        <div className="error-banner">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)}>×</button>
        </div>
      )}

      <div className="audio-sync-layout">
        {/* AVATAR CANVAS VIEW */}
        <section className="avatar-section">
          <div
            className={`canvas-container ${background === 'transparent' ? 'checkerboard' : ''}`}
            style={{ backgroundColor: background === 'transparent' ? undefined : background }}
          >
            <canvas ref={canvasRef} />
            {dragging && <div className="drop-overlay">Drop audio or .mavatar here!</div>}
          </div>

          <div className="meter-panel">
            <div className="meter-info">
              <span>Mouth / Voice Level:</span>
              <span className="meter-val">{Math.round(currentLevel * 100)}%</span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{
                  width: `${currentLevel * 100}%`,
                  backgroundColor: currentLevel > 0.8 ? '#f87171' : currentLevel > 0.4 ? '#34d399' : '#a78bfa',
                }}
              />
            </div>
          </div>
        </section>

        {/* CONTROLS SIDEBAR */}
        <aside className="controls-sidebar">
          {/* Audio Track Section */}
          <section className="control-group">
            <h2>Audio Track</h2>
            <div className="file-info-box">
              <strong>{audioLoaded ? audioFileName : 'No audio loaded'}</strong>
              <small>{audioLoaded ? `${formatTime(currentTime)} / ${formatTime(duration)}` : 'Upload an MP3, WAV, or play demo'}</small>
            </div>

            <div className="buttons-row">
              <label className="btn btn-primary file-btn">
                Choose Audio File
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
                  hidden
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <button className="btn" onClick={playSyntheticSpeechTest}>
                Load Demo Voice
              </button>
            </div>

            {/* Playback Progress */}
            {audioLoaded && (
              <div className="playback-controls">
                <div className="timeline-row">
                  <span>{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    min="0"
                    max={duration || 1}
                    step="0.05"
                    value={currentTime}
                    onChange={e => handleSeek(Number(e.target.value))}
                    className="slider"
                  />
                  <span>{formatTime(duration)}</span>
                </div>

                <div className="transport-row">
                  <button className="btn btn-primary transport-play" onClick={togglePlay}>
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (audioRef.current) {
                        audioRef.current.currentTime = 0;
                        setCurrentTime(0);
                        if (!isPlaying) void togglePlay();
                      }
                    }}
                  >
                    ⏮ Restart
                  </button>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={e => handleLoopChange(e.target.checked)}
                    />
                    Loop
                  </label>
                </div>
              </div>
            )}
          </section>

          {/* Lip Sync Tuning */}
          <section className="control-group">
            <h2>Lip Sync Sensitivity</h2>
            <label className="slider-label">
              <span>Mouth Sensitivity (Gain): <strong>{gain.toFixed(1)}x</strong></span>
              <input
                type="range"
                min="0.25"
                max="4.0"
                step="0.05"
                value={gain}
                onChange={e => setGain(Number(e.target.value))}
                className="slider"
              />
            </label>
            <label className="slider-label">
              <span>Audio Volume: <strong>{Math.round(volume * 100)}%</strong></span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={e => handleVolumeChange(Number(e.target.value))}
                className="slider"
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoIdle}
                onChange={e => {
                  setAutoIdleState(e.target.checked);
                  avatarRef.current?.setAutoIdle(e.target.checked);
                  avatarRef.current?.setAutoMotion(e.target.checked);
                }}
              />
              Natural Idle Breathing & Blinking
            </label>
          </section>

          {/* Avatar Model Section */}
          <section className="control-group">
            <h2>Avatar Model</h2>
            <p className="avatar-name">Current: <strong>{avatarName}</strong> {avatarReady ? '✓' : '(Loading...)'}</p>
            <div className="buttons-row">
              <label className="btn file-btn">
                Load .mavatar
                <input
                  type="file"
                  accept=".mavatar"
                  hidden
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>
              {avatarReady && avatarName !== 'Miko (Sample)' && (
                <button className="btn" onClick={() => void initAvatar(SAMPLE_PROJECT)}>
                  Load Sample
                </button>
              )}
            </div>
          </section>

          {/* Facial Expressions */}
          <section className="control-group">
            <h2>Expression</h2>
            <div className="expression-grid">
              {LIVE_EXPRESSIONS.map(name => (
                <button
                  key={name}
                  className={`btn expr-btn ${expression === name ? 'active' : ''}`}
                  onClick={() => {
                    setExpression(name);
                    avatarRef.current?.setExpression(name);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>

          {/* Background / Chroma Key */}
          <section className="control-group">
            <h2>Background / Keying</h2>
            <select
              value={background}
              onChange={e => setBackground(e.target.value as BackgroundType)}
              className="select-input"
            >
              <option value="transparent">Transparent (Checkerboard)</option>
              <option value="#00ff00">Green Screen (#00ff00 Chroma)</option>
              <option value="#0000ff">Blue Screen (#0000ff Chroma)</option>
              <option value="#161e2e">Dark Studio (#161e2e)</option>
              <option value="#ffffff">Pure White (#ffffff)</option>
            </select>
            <small style={{ marginTop: '6px' }}>
              Green/Blue screen enables easy background removal in OBS, Premiere, or DaVinci.
            </small>
          </section>
        </aside>
      </div>

      <style>{`
        :root, [data-theme="dark"] {
          --sync-bg: #0d0b14;
          --sync-surface: #131020;
          --sync-surface-raised: #1c1830;
          --sync-ink: #f0eef8;
          --sync-muted: #8b82a8;
          --sync-line: #221e38;
          --sync-line-strong: #352f55;
          --sync-accent: #a78bfa;
          --sync-accent-soft: rgba(139, 92, 246, 0.14);
        }
        [data-theme="light"] {
          --sync-bg: #f5f3fc;
          --sync-surface: #ffffff;
          --sync-surface-raised: #ede9f8;
          --sync-ink: #1e1535;
          --sync-muted: #7c6fa0;
          --sync-line: #ddd7f0;
          --sync-line-strong: #c4bade;
          --sync-accent: #7c3aed;
          --sync-accent-soft: #ede9fe;
        }
        .audio-sync-page {
          min-height: 100vh;
          background: var(--sync-bg);
          color: var(--sync-ink);
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          -webkit-font-smoothing: antialiased;
          padding: 16px 24px;
          box-sizing: border-box;
        }
        .audio-sync-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          padding: 12px 20px;
          background: var(--sync-surface);
          border: 1px solid var(--sync-line);
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .audio-sync-header .brand {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .back-link {
          text-decoration: none;
          color: var(--sync-accent);
          font-weight: 600;
          padding: 6px 12px;
          border: 1px solid var(--sync-line);
          border-radius: 8px;
          background: var(--sync-surface-raised);
          transition: all 0.15s ease;
        }
        .back-link:hover {
          border-color: var(--sync-accent);
        }
        .audio-sync-header h1 {
          margin: 0;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        [data-theme="light"] .audio-sync-header h1 {
          background: linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .audio-sync-header h1 span {
          color: var(--sync-muted);
          font-weight: 400;
          margin-left: 8px;
          font-size: 15px;
        }
        .header-nav {
          display: flex;
          gap: 8px;
        }
        .nav-btn {
          text-decoration: none;
          color: var(--sync-ink);
          background: var(--sync-surface-raised);
          border: 1px solid var(--sync-line);
          border-radius: 8px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .nav-btn:hover {
          border-color: var(--sync-accent);
          color: var(--sync-accent);
        }
        .audio-sync-layout {
          display: grid;
          grid-template-columns: 1fr 420px;
          gap: 20px;
          align-items: start;
        }
        .avatar-section {
          position: sticky;
          top: 16px;
        }
        .canvas-container {
          width: 100%;
          height: calc(100vh - 120px);
          min-height: 480px;
          border-radius: 14px;
          overflow: hidden;
          border: 1px solid var(--sync-line);
          position: relative;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .sync-canvas {
          width: 100%;
          height: 100%;
          display: block;
        }
        .loading-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(9, 13, 22, 0.7);
          color: #ffffff;
          font-weight: 600;
        }
        .controls-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .panel-card {
          background: var(--sync-surface);
          border: 1px solid var(--sync-line);
          border-radius: 12px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .panel-card h2 {
          margin: 0 0 12px;
          font-size: 14px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          color: var(--sync-ink);
        }
        .btn {
          cursor: pointer;
          font-family: inherit;
          padding: 8px 14px;
          border-radius: 8px;
          border: 1px solid var(--sync-line);
          background: var(--sync-surface-raised);
          color: var(--sync-ink);
          font-size: 13px;
          font-weight: 500;
          transition: all 0.15s ease;
        }
        .btn:hover:not(:disabled) {
          border-color: var(--sync-accent);
          color: var(--sync-accent);
        }
        .btn-primary {
          background: linear-gradient(160deg, #a78bfa 0%, #7c3aed 100%);
          border: 1px solid #6d28d9;
          color: #ffffff !important;
          font-weight: 600;
        }
        .btn-primary:hover:not(:disabled) {
          background: linear-gradient(160deg, #8b5cf6 0%, #6d28d9 100%);
        }
        .expression-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }
        .expr-btn {
          text-transform: capitalize;
          text-align: center;
          padding: 7px 10px;
          font-size: 12px;
        }
        .expr-btn.active {
          background: var(--sync-accent-soft);
          color: var(--sync-accent);
          border-color: var(--sync-accent);
          font-weight: 600;
        }
        .select-input {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid var(--sync-line);
          border-radius: 8px;
          font-size: 13px;
          background: var(--sync-surface-raised);
          color: var(--sync-ink);
        }
        .slider-row {
          margin-bottom: 12px;
        }
        .slider-row label {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: var(--sync-muted);
          margin-bottom: 6px;
        }
        .slider-row input[type="range"] {
          width: 100%;
          accent-color: var(--sync-accent);
        }
        .drop-zone {
          border: 2px dashed var(--sync-line);
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          background: var(--sync-surface-raised);
          transition: all 0.15s ease;
        }
        .drop-zone:hover {
          border-color: var(--sync-accent);
        }
        .audio-player-box {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .player-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .progress-bar-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .progress-slider {
          flex: 1;
        }
        .time-text {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--sync-muted);
        }
`}</style>
    </div>
  );
}

// Minimal in-memory WAV encoder for the instant demo test
function encodeWAV(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Uint8Array(buffer);
}
